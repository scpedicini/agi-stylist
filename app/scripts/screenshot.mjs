// Dev helper: node app/scripts/screenshot.mjs <url> <out.png> [waitMs]
import { chromium } from '@playwright/test';
const [url, out, wait] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: node app/scripts/screenshot.mjs <url> <out.png> [waitMs]');
  process.exit(2);
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
await page.goto(url);
// wait until the viewer reports the scene fully painted (falls back to a fixed wait for other pages)
await page
  .waitForFunction(() => window.__kq?.current().done && document.body.dataset.thumbnails === 'true', null, { timeout: 30_000 })
  .catch(() => {});
if (wait) await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
await browser.close();
