// Hardware end-to-end test: the real page in a headless browser, talking to a real LB-M8 through hidraw.
// Only navigator.hid is swapped for a bridge, because a headless browser can't click the device chooser.
// It changes every setting, checks what the mouse stored, then restores the original bytes.
// Run with the mouse plugged in (cable or 2.4 GHz receiver) and no other LB-M8 window open: npm run test:hardware
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const assert = require('assert');
const path = require('path');

const PAGE = 'file://' + path.resolve(__dirname, '../../index.html');
const OUT = path.join(__dirname, 'out');
require('fs').mkdirSync(OUT, { recursive: true });
const shot = n => path.join(OUT, n + '.png');

// --- bridge to the mouse, with a lock so a send+receive pair is never interleaved ---
const py = spawn('python3', ['-I', path.join(__dirname, 'bridge.py')]);
let buf = '', waiters = [], writes = 0;
py.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); waiters.shift()(l); } });
const ask = line => new Promise(r => { waiters.push(r); py.stdin.write(line + '\n'); });
let lockQ = Promise.resolve();
const lock = () => { let rel; const p = new Promise(r => (rel = r)); const prev = lockQ; lockQ = prev.then(() => p); return prev.then(() => rel); };
const hex = a => Buffer.from(a).toString('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let seq = 0xa0;
async function direct(cmd, arg, len, data = []) {
  const rel = await lock();
  try {
    const b = new Array(40).fill(0);
    seq = (seq + 1) & 0xff;
    b.splice(0, 8 + data.length, 0, 0, cmd, seq, arg, 0, 0, len, ...data);
    for (let attempt = 0; attempt < 3; attempt++) {
      assert.strictEqual(await ask('S ' + hex(b)), 'ok');
      await sleep(80);
      if (cmd < 0x80) return null; // writes get no reply
      for (let t = 0; t < 8; t++) {
        const r = Buffer.from(await ask('R'), 'hex');
        if (r[2] === cmd && r[3] === seq) return r;
        await sleep(30);
      }
    }
    return Buffer.from(await ask('R'), 'hex');
  } finally { rel(); }
}
async function dread(cmd, arg, len) {
  const r = await direct(cmd | 0x80, arg, len);
  assert.strictEqual(r[2], cmd | 0x80, 'reply cmd'); assert.strictEqual(r[3], seq, 'reply seq');
  return [...r.subarray(8, 8 + len)];
}
const ITEMS = { dpi: [0x06, 0, 0x14], rate: [0x03, 0, 1], sleep: [0x02, 3, 2], sensor: [0x02, 5, 1], debounce: [0x0a, 2, 1], wake: [0x0a, 6, 1] };
async function snapshot() { const o = {}; for (const [k, [c, a, l]] of Object.entries(ITEMS)) o[k] = await dread(c, a, l); return o; }

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };

(async () => {
  const original = await snapshot();
  console.log('original:', JSON.stringify(original));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
  try {
    const ctx = await browser.newContext({ colorScheme: 'light', viewport: { width: 820, height: 1500 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    // the page holds the lock from a read request until its matching reply arrives (or 2 s pass)
    let held = null, want = null, timer = null;
    const drop = () => { clearTimeout(timer); const r = held; held = null; if (r) r(); };
    await page.exposeFunction('__hidSend', async (id, data) => {
      if (id !== 6 || data.length !== 40) throw new Error('bad send');
      if (!held) { held = await lock(); timer = setTimeout(drop, 2000); }
      want = [data[2], data[3]];
      if (data[2] < 0x80) writes++;
      const r = await ask('S ' + hex(data));
      if (r !== 'ok' || data[2] < 0x80) drop();
      if (r !== 'ok') throw new Error(r);
    });
    await page.exposeFunction('__hidRecv', async () => {
      const r = await ask('R'); if (r.startsWith('err')) { drop(); throw new Error(r); }
      const b = Buffer.from(r, 'hex');
      if (want && b[2] === want[0] && b[3] === want[1]) drop();
      return [6, ...b];
    });
    await page.addInitScript(() => {
      const dev = { opened: false, productName: 'LB-M8', vendorId: 0xb6a4, productId: 0x4001, collections: [{ usagePage: 0xff01 }],
        async open() { this.opened = true; },
        sendFeatureReport: (id, d) => window.__hidSend(id, Array.from(d)),
        async receiveFeatureReport(id) { return new DataView(new Uint8Array(await window.__hidRecv(id)).buffer); } };
      Object.defineProperty(navigator, 'hid', { value: {
        async requestDevice(o) { window.__filters = o.filters; return [dev]; },
        async getDevices() { return sessionStorage.remember ? [dev] : []; },
        addEventListener() {} } });
    });
    await page.goto(PAGE);
    await page.screenshot({ path: shot('0-welcome') });

    const status = () => page.textContent('#status');
    const waitStatus = re => page.waitForFunction(r => new RegExp(r).test(document.getElementById('status').textContent), re.source, { timeout: 15000 });
    const ui = () => page.evaluate(() => ({
      levels: [...document.querySelectorAll('#bars .bar')].map(b => +b.dataset.dpi),
      on: [...document.querySelectorAll('#bars .bar')].map(b => b.dataset.on === 'true'),
      use: [...document.querySelectorAll('#bars .bar')].findIndex(b => b.classList.contains('use')),
      now: document.getElementById('nowDpi').textContent,
      rate: +document.querySelector('#rate input:checked').value, sleepMin: +sleepMin.value, debounce: +debounce.value,
      angleSnap: angleSnap.checked, ripple: ripple.checked, wake: wake.checked,
      saveOn: !apply.disabled, link: document.getElementById('link').textContent.replace(/\s+/g, ' ').trim() }));
    const pick = i => page.click(`#bars .bar:nth-child(${i})`);
    const setDpi = async v => { await page.fill('#lvlDpi', String(v)); };

    console.log('1. connect and read');
    await page.click('#connect');
    await page.waitForSelector('#editor:not([hidden])', { timeout: 15000 }).catch(async e => { throw new Error('connect failed, page says: ' + await page.textContent('#connectMsg')); });
    const fl = await page.evaluate(() => window.__filters);
    ok(fl.length === 2 && fl.every(f => f.vendorId === 0xb6a4 && f.usagePage === 0xff01) && fl.map(f => f.productId).join() === '16384,16385', 'asks the browser for the LB-M8 on cable or 2.4 GHz receiver');
    let u = await ui();
    ok(/^\d+%(, charging)? 2\.4 GHz receiver Reload$/.test(u.link), 'shows battery and connection: ' + u.link);
    ok(u.levels.join() === '1000,1600,2000,2600,3600,4800,6000,12000', 'ladder shows the 8 levels on the mouse: ' + u.levels.join(', '));
    ok(u.on.every(Boolean), 'all 8 levels shown as in the cycle');
    ok(u.use === original.dpi[1] - 1 && u.now === '1600', `big readout shows ${u.now} DPI, level ${u.use + 1} marked in use`);
    ok(u.rate === 1000 && u.sleepMin === 30 && u.debounce === 1 && !u.angleSnap && !u.ripple && u.wake, 'performance settings match the mouse');
    ok(!u.saveOn, 'Save is off until something changes');
    await sleep(800);
    await page.screenshot({ path: shot('1-connected'), fullPage: true });

    console.log('2. change everything and save');
    await pick(3); await setDpi(2100);
    ok(/1 unsaved change$/.test(await status()), 'save bar counts the change: ' + await status());
    await pick(8); await page.uncheck('#inCycle');
    await pick(1); await page.click('#useNow');
    ok(/Changes to 1000 DPI when you save/.test(await page.textContent('#pending')), 'readout warns the in-use DPI changes on save');
    await page.check('#rate input[value="500"]');
    await page.click('[data-for=sleepMin][data-d="-1"]'); await page.fill('#sleepMin', '10');
    await page.click('[data-for=debounce][data-d="1"]'); await page.click('[data-for=debounce][data-d="1"]'); await page.click('[data-for=debounce][data-d="1"]');
    await page.check('#angleSnap'); await page.check('#ripple'); await page.uncheck('#wake');
    ok(/9 unsaved changes/.test(await status()), 'save bar counts 9 changes: ' + await status());
    await page.screenshot({ path: shot('2-editing'), fullPage: true });
    await page.click('#apply');
    await waitStatus(/Saved|didn’t|must|not supported|unexpected/);
    ok(await status() === 'Saved to the mouse.', 'page says: ' + await status());
    const now = await snapshot();
    ok(now.dpi[0] === 0x7f && now.dpi[1] === 1 && now.dpi[6] === 24, 'mouse has level 8 off, level 1 in use, level 3 = 2100 DPI');
    ok(now.rate[0] === 2 && now.sleep[0] + (now.sleep[1] << 8) === 600 && now.debounce[0] === 4, 'mouse has 500 Hz, 10 min sleep, 4 ms debounce');
    ok(now.sensor[0] === ((original.sensor[0] & ~3) | 3) && now.wake[0] === 0, 'mouse has angle snapping + ripple on (unknown bits kept), wake off');
    u = await ui();
    ok(u.now === '1000' && !u.saveOn, 'readout now shows 1000 DPI and Save is off again');

    console.log('3. page follows the mouse');
    const pressed = [...now.dpi]; pressed[1] = 2; // as if the DPI button moved to level 2
    await direct(0x06, 0, 0x14, pressed);
    await page.waitForFunction(() => document.getElementById('nowDpi').textContent === '1600', null, { timeout: 6000 });
    ok(true, 'level changed on the mouse, readout followed to 1600 DPI by itself');

    console.log('4. bad input is refused before anything is sent');
    await page.fill('#debounce', '25'); let before = writes;
    await page.click('#apply'); await waitStatus(/must/);
    ok(writes === before, 'debounce 25 ms refused, nothing written: ' + await status());
    await page.fill('#debounce', '4');
    await pick(2); await setDpi(1250);
    before = writes; await page.click('#apply'); await waitStatus(/not supported/);
    ok(writes === before, '1250 DPI refused, nothing written: ' + await status());
    await page.click('#discard');
    u = await ui();
    ok(u.levels[1] === 1600 && u.debounce === 4 && !u.saveOn, 'Discard puts the page back to what the mouse has');

    console.log('5. the level in use cannot be taken out of the cycle');
    await pick(2);
    ok(await page.isDisabled('#inCycle') && await page.isDisabled('#useNow'), 'cycle switch and Use button are locked for the level in use');

    console.log('6. factory button fills in, does not write');
    before = writes; await page.click('#factory'); u = await ui();
    ok(u.levels.join() === '1200,2000,3200,4800,7200,12000,4000,12000' && writes === before && u.saveOn, 'factory levels shown, nothing written until Save');
    await page.click('#discard');

    console.log('7. keyboard: arrow keys move between levels');
    await page.focus('#bars .bar:nth-child(2)'); await page.keyboard.press('ArrowRight');
    ok(await page.textContent('#lvlTitle') === 'Level 3' && await page.evaluate(() => document.activeElement.matches('#bars .bar:nth-child(3)')), 'ArrowRight selects and focuses level 3');

    console.log('8. put your settings back through the page');
    await pick(8); await page.check('#inCycle');
    await pick(3); await setDpi(2000);
    await pick(original.dpi[1]); if (!(await page.isDisabled('#useNow'))) await page.click('#useNow');
    await page.check('#rate input[value="1000"]'); await page.fill('#sleepMin', '30'); await page.fill('#debounce', '1');
    await page.uncheck('#angleSnap'); await page.uncheck('#ripple'); await page.check('#wake');
    await page.click('#apply');
    await waitStatus(/Saved|didn’t|must|unexpected/);
    ok(await status() === 'Saved to the mouse.', 'page saved the original settings');
    ok(JSON.stringify(await snapshot()) === JSON.stringify(original), 'mouse is byte-for-byte back to how it started');

    console.log('9. opens already connected when Brave remembers the mouse');
    await page.evaluate(() => { sessionStorage.remember = '1'; }); await sleep(2100);
    await page.reload();
    await page.waitForSelector('#editor:not([hidden])', { timeout: 15000 });
    ok((await ui()).now === '1600', 'reloaded page connected by itself, no click needed');

    console.log('10. narrow window');
    await sleep(500); await page.screenshot({ path: shot('3-restored'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 1500 }); await sleep(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await page.screenshot({ path: shot('4-narrow'), fullPage: true });
    ok(!overflow, 'no sideways scrolling at 375 px wide');
    ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join('; ') : ''));
    console.log(`\nALL ${passed} CHECKS PASSED`);
  } catch (e) {
    console.error('\nFAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
    const cur = await snapshot();
    for (const [k, [c, a, l]] of Object.entries(ITEMS)) if (cur[k].join() !== original[k].join()) { await direct(c, a, l, original[k]); console.log('restored ' + k + ' directly'); }
    const fin = await snapshot();
    console.log(JSON.stringify(fin) === JSON.stringify(original) ? 'mouse settings: same as before the test' : 'WARNING: mouse differs from original: ' + JSON.stringify(fin));
    py.stdin.end();
  }
})();
