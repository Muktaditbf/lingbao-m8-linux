// LB-M8 settings protocol, read from the official Windows driver (LB-M8 v1.0.3).
// Feature report 6, 40 bytes: 00 00 cmd seq arg addrLo addrHi len data…
// Reads are cmd|0x80; the mouse puts its answer in the next feature report read.
const LBM8 = (() => {
  // PAW3311 DPI -> sensor code, from DeviceFeature.ini [chip8]
  const CODE = {100:0,200:2,300:3,400:4,500:5,600:6,700:7,800:9,900:10,1000:11,1100:12,1200:13,1300:14,1400:16,1500:17,1600:18,1700:19,1800:20,1900:22,2000:23,2100:24,2200:25,2300:26,2400:27,2500:29,2600:30,2700:31,2800:32,2900:33,3000:35,3100:37,3200:38,3300:39,3400:40,3500:41,3600:42,3700:44,3800:45,3900:46,4000:47,4100:48,4200:50,4300:51,4400:52,4500:53,4600:54,4700:56,4800:57,4900:58,5000:59,5100:60,5200:62,5300:63,5400:64,5500:65,5600:66,5700:68,5800:69,5900:70,6000:71,6100:72,6200:74,6300:75,6400:76,6500:77,6600:78,6700:80,6800:81,6900:82,7000:83,7100:84,7200:86,7300:87,7400:88,7500:89,7600:90,7700:92,7800:93,7900:94,8000:95,8100:96,8200:98,8300:99,8400:100,8500:101,8600:102,8700:104,8800:105,8900:106,9000:107,9100:108,9200:110,9300:111,9400:112,9500:113,9600:114,9700:116,9800:117,9900:118,10000:119,10100:120,10200:122,10300:123,10400:124,10500:125,10600:126,10700:128,10800:129,10900:130,11000:131,11100:132,11200:134,11300:135,11400:136,11500:137,11600:138,11700:140,11800:141,11900:142,12000:143};
  const DPI = Object.fromEntries(Object.entries(CODE).map(([d, c]) => [c, +d]));
  const STEPS = Object.keys(CODE).map(Number);
  const FACTORY = [1200, 2000, 3200, 4800, 7200, 12000, 4000, 12000]; // [ChipReset8]
  const CMD_DPI = 0x06, DPI_LEN = 0x14;

  // shortcut: buttons, macros and lighting are not decoded; DPI, polling, sleep and sensor options only
  function packet(cmd, seq, arg, len, data = []) {
    const b = new Uint8Array(40);
    b.set([0, 0, cmd, seq & 0xff, arg, 0, 0, len]);
    b.set(data, 8);
    return b;
  }

  // DPI block: enabled-levels bitmask, active level (1-based on the wire), 8 × u16 sensor code, 2 bytes kept as-is
  function parseDpi(d) {
    const levels = [];
    for (let i = 0; i < 8; i++) {
      const code = d[2 + i * 2] | (d[3 + i * 2] << 8);
      if (!(code in DPI)) throw new Error(`Unknown DPI code ${code} in slot ${i + 1}`);
      levels.push(DPI[code]);
    }
    return { mask: d[0], active: d[1] - 1, levels, tail: [d[18], d[19]] };
  }

  function encodeDpi({ mask, active, levels, tail }) {
    if (!(mask & (1 << active))) throw new Error('The active level must be switched on');
    const d = [mask, active + 1];
    for (const dpi of levels) {
      if (!(dpi in CODE)) throw new Error(`${dpi} DPI is not supported (100–12000, steps of 100)`);
      d.push(CODE[dpi] & 0xff, CODE[dpi] >> 8);
    }
    return [...d, ...tail];
  }

  // Other settings, each a separate cmd/arg (read = cmd|0x80, same arg and length)
  const SETTINGS = {
    rate:     { cmd: 0x03, arg: 0, len: 1 }, // 1000 / Hz: 8,4,2,1
    sleep:    { cmd: 0x02, arg: 3, len: 2 }, // seconds, u16 LE; the app offers 1–30 min
    sensor:   { cmd: 0x02, arg: 5, len: 1 }, // bit0 angle snapping, bit1 ripple control; other bits kept
    debounce: { cmd: 0x0a, arg: 2, len: 1 }, // ms; the app offers 1–20
    wake:     { cmd: 0x0a, arg: 6, len: 1 }, // move to wake up, 0/1
  };
  const RATES = [125, 250, 500, 1000];
  const PRODUCTS = { 0x4000: 'USB cable', 0x4001: '2.4 GHz receiver' };
  const STATUS = { cmd: 0x01, arg: 0, len: 3 }; // [link, battery% | charging<<7, ?]

  const parseStatus = d => ({ battery: Math.min(d[1] & 0x7f, 100), charging: d[1] >= 0x80 });

  function parseSettings(raw) {
    return {
      rate: 1000 / raw.rate[0],
      sleepMin: Math.round((raw.sleep[0] | (raw.sleep[1] << 8)) / 60),
      angleSnap: !!(raw.sensor[0] & 1),
      ripple: !!(raw.sensor[0] & 2),
      debounce: raw.debounce[0],
      wake: !!raw.wake[0],
    };
  }

  function encodeSettings(v, raw) {
    if (!RATES.includes(v.rate)) throw new Error(`${v.rate} Hz is not supported`);
    if (!(v.sleepMin >= 1 && v.sleepMin <= 30)) throw new Error('Sleep time must be 1–30 minutes');
    if (!(v.debounce >= 1 && v.debounce <= 20)) throw new Error('Debounce must be 1–20 ms');
    const s = v.sleepMin * 60;
    return {
      rate: [1000 / v.rate],
      sleep: [s & 0xff, s >> 8],
      sensor: [(raw.sensor[0] & ~3) | (v.angleSnap ? 1 : 0) | (v.ripple ? 2 : 0)],
      debounce: [v.debounce],
      wake: [v.wake ? 1 : 0],
    };
  }

  return { CODE, STEPS, FACTORY, CMD_DPI, DPI_LEN, SETTINGS, RATES, PRODUCTS, STATUS, packet, parseDpi, encodeDpi, parseSettings, encodeSettings, parseStatus };
})();

if (typeof module !== 'undefined') module.exports = LBM8;
