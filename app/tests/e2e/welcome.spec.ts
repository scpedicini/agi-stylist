import { expect, test, type Page } from '@playwright/test';
import { APP_NAME } from '../../src/app/config.ts';

// a first visit: nothing in storage, so the title screen greets it
test.use({ storageState: { cookies: [], origins: [] } });

const dialog = (page: Page) => page.locator('dialog#welcome');

/** White pixels on the scroll (picture columns 36-125, rows 43-151): the credits. */
const creditPixels = (page: Page) =>
  page.locator('#welcome canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(72, 43, 180, 109).data;
    const white: number[] = [];
    for (let i = 0; i < d.length; i += 4) if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 255) white.push(i / 4);
    return white;
  });

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(() => expect(errors).toEqual([]));

test('a first visit opens on the title screen, which paints and then rolls the credits up the scroll', async ({ page }) => {
  await page.goto('/#/scene/kq1/r01-c01?speed=instant');
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toBeFocused();
  await expect(dialog(page).locator('button')).toHaveCount(0); // just the picture
  await expect(page.locator('#welcome canvas')).toHaveAttribute('data-phase', 'scrolling', { timeout: 15_000 });
  // the credits come up from below the roll: nothing at first, then text that keeps moving
  await expect.poll(async () => (await creditPixels(page)).length, { timeout: 10_000 }).toBeGreaterThan(50);
  const before = await creditPixels(page);
  await expect.poll(async () => (await creditPixels(page)).join()).not.toBe(before.join());
  // a picture row at a time
  const canvas = page.locator('#welcome canvas');
  const top = Number(await canvas.getAttribute('data-top'));
  await expect.poll(async () => Number(await canvas.getAttribute('data-top'))).toBeLessThan(top);
  // the credits are there for screen readers too
  await expect(dialog(page)).toContainText(`Welcome to ${APP_NAME}`);
});

test('with reduced motion the picture appears whole and the credits still roll smoothly', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  // the picture appears whole, not stroke by stroke
  const canvas = page.locator('#welcome canvas');
  await expect(canvas).toHaveAttribute('data-phase', 'scrolling', { timeout: 1_000 });
  // the credits roll a row at a time, as without reduced motion (no turning over a page at a time)
  const tops: number[] = [];
  for (let i = 0; i < 12; i++) {
    tops.push(Number(await canvas.getAttribute('data-top')));
    await page.waitForTimeout(150);
  }
  for (let i = 1; i < tops.length; i++) {
    const step = tops[i - 1] - tops[i];
    expect(step).toBeGreaterThanOrEqual(0);
    expect(step).toBeLessThanOrEqual(10); // a page turn would jump ~100 rows
  }
  expect(tops[0] - tops.at(-1)!).toBeGreaterThan(0);
});

test('the viewer stays put behind it; Enter dismisses it for good, "intro" brings it back, and Escape or a click off the picture closes it', async ({ page }) => {
  await page.goto('/#/scene/kq1/r01-c01?speed=instant');
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('ArrowRight'); // not the viewer's "next scene" while the dialog is up
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(/kq1\/r01-c01/);
  await expect(page.locator('#stage')).toBeFocused();
  // no focus ring around the stage's frame (it would look like the source pane is misaligned)
  await expect(page.locator('#stage')).toHaveCSS('outline-style', 'none');
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__kq?.current().done)).toBe(true);
  await expect(dialog(page)).toHaveCount(0);

  await page.click('#welcome-open');
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('#welcome-open')).toBeFocused();

  // clicks on the picture don't close it; a click off it does
  await page.click('#welcome-open');
  await page.locator('#welcome canvas').click();
  await expect(dialog(page)).toBeVisible();
  await page.mouse.click(3, 3);
  await expect(dialog(page)).toHaveCount(0);
});

test('Greensleeves plays by itself when opened by a click, or from the first click on the picture', async ({ page }) => {
  await page.goto('/');
  await expect(dialog(page)).toBeVisible();
  // a first visit has had no click yet, so the browser may hold the sound back; clicking the picture lets it go
  await page.locator('#welcome canvas').click();
  await expect(dialog(page)).toHaveAttribute('data-music', 'on');
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toHaveCount(0);

  // opened from the "intro" button (a click), it plays straight away
  await page.click('#welcome-open');
  await expect(dialog(page)).toHaveAttribute('data-music', 'on');
});

for (const [width, height] of [
  [1280, 800],
  [390, 844],
  [360, 740],
  [844, 390],
] as const) {
  test(`the title screen's layout fits the window and holds still, and the page under it doesn't move (${width}×${height})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/#/scene/kq1/r01-c01?speed=instant');
    await expect(dialog(page)).toBeVisible();
    const frame = page.locator('#welcome .welcome-frame');
    const painting = (await frame.boundingBox())!;
    expect(painting.x).toBeGreaterThanOrEqual(0);
    expect(painting.y).toBeGreaterThanOrEqual(0);
    expect(painting.x + painting.width).toBeLessThanOrEqual(width);
    expect(painting.y + painting.height).toBeLessThanOrEqual(height);
    // centred across the window
    // (the page's width, which leaves out the scrollbar gutter kept while the dialog is up)
    const room = await page.evaluate(() => document.body.getBoundingClientRect().width);
    expect(Math.abs(painting.x - (room - painting.x - painting.width))).toBeLessThanOrEqual(1);
    const under = () => page.evaluate(() => ['.toolbar', '#stage', '.source'].map((sel) => JSON.stringify(document.querySelector(sel)!.getBoundingClientRect())));
    const before = await under();
    await expect(page.locator('#welcome canvas')).toHaveAttribute('data-phase', 'scrolling', { timeout: 15_000 });
    expect(await frame.boundingBox()).toEqual(painting);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    expect(await under()).toEqual(before);
  });
}
