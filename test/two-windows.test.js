// Two windows of the app in one browser: the newer one takes the mouse, the older one lets go.
const { chromium } = require('playwright');
const assert = require('assert');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
  const ctx = await b.newContext();
  await ctx.addInitScript(() => {
    // fake mouse: answers every read with the matching cmd/seq and factory-like data
    const data = { 0x86: [0x3f, 1, 13, 0, 23, 0, 38, 0, 57, 0, 86, 0, 143, 0, 47, 0, 143, 0, 0, 0], 0x83: [1], 0x82: [8, 7], 0x8a: [1], 0x81: [1, 0x50, 8] };
    let last = new Uint8Array(40);
    const dev = { opened: false, productName: 'LB-M8', vendorId: 0xb6a4, productId: 0x4001, collections: [{ usagePage: 0xff01 }],
      async open() { this.opened = true; }, async close() { this.opened = false; window.__closed = true; },
      async sendFeatureReport(id, d) { if (d[2] & 0x80) { last = new Uint8Array(40); last.set(d.slice(0, 8)); last.set(data[d[2]] ?? [0], 8); if (d[2] === 0x82 && d[4] === 5) last[8] = 0x80; } },
      async receiveFeatureReport() { return new DataView(last.slice().buffer); } };
    Object.defineProperty(navigator, 'hid', { value: { async requestDevice() { return [dev]; }, addEventListener() {} } });
  });
  const url = 'file://' + require('path').resolve(__dirname, '../index.html');
  const a = await ctx.newPage(); await a.goto(url); await a.click('#connect'); await a.waitForSelector('#editor:not([hidden])');
  const bb = await ctx.newPage(); await bb.goto(url); await bb.click('#connect'); await bb.waitForSelector('#editor:not([hidden])');
  await a.waitForSelector('#welcome:not([hidden])', { timeout: 5000 });
  const msg = await a.textContent('#connectMsg');
  assert.match(msg, /open in another window/);
  assert.ok(await a.evaluate(() => window.__closed), 'first window closed its connection');
  assert.ok(await bb.isVisible('#editor'), 'second window kept the mouse');
  console.log('✓ second window took over; first says: ' + msg);
  await b.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
