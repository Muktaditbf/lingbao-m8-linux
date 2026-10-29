// Protocol unit tests, using bytes read from a real LB-M8. Run: npm test
const assert = require('assert');
const L = require('../lbm8.js');

const real = [0x3f,0x01,0x0d,0,0x17,0,0x26,0,0x39,0,0x56,0,0x8f,0,0x2f,0,0x8f,0,0,0];
const s = L.parseDpi(real);
assert.deepStrictEqual(s.levels, L.FACTORY);
assert.strictEqual(s.active, 0); // wire byte 1 = level 1, confirmed against the mouse's display
// current mouse: wire active byte 2 while the display shows 1600 = level 2
const now = L.parseDpi([0xff,2,11,0,18,0,23,0,30,0,42,0,57,0,71,0,143,0,0,0]);
assert.strictEqual(now.levels[now.active], 1600);
assert.deepStrictEqual(L.encodeDpi(s), real);
assert.deepStrictEqual([...L.packet(0x86, 1, 0, 0x14).slice(0, 9)], [0,0,0x86,1,0,0,0,0x14,0]);
assert.throws(() => L.encodeDpi({ ...s, levels: [1250, ...s.levels.slice(1)] }));
assert.throws(() => L.encodeDpi({ ...s, mask: 0x01, active: 3 }));
// settings as read from the real mouse
const raw = { rate: [1], sleep: [0x08, 0x07], sensor: [0x80], debounce: [1], wake: [1] };
const v = L.parseSettings(raw);
assert.deepStrictEqual(v, { rate: 1000, sleepMin: 30, angleSnap: false, ripple: false, debounce: 1, wake: true });
assert.deepStrictEqual(L.encodeSettings(v, raw), raw);
const on = L.encodeSettings({ ...v, rate: 500, angleSnap: true, ripple: true, sleepMin: 5 }, raw);
assert.deepStrictEqual(on.sensor, [0x83]); // unknown bit 7 kept
assert.deepStrictEqual(on.rate, [2]);
assert.deepStrictEqual(on.sleep, [0x2c, 0x01]);
assert.throws(() => L.encodeSettings({ ...v, rate: 2000 }, raw));
// status replies seen on the real mouse: cable (charging) and 2.4 GHz
assert.deepStrictEqual(L.parseStatus([0x00, 0xe4, 0x08]), { battery: 100, charging: true });
assert.deepStrictEqual(L.parseStatus([0x01, 0x64, 0x08]), { battery: 100, charging: false });
console.log('ok');
