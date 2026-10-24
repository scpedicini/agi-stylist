import { expect, test, type Page } from '@playwright/test';
import { APP_NAME } from '../../src/app/config.ts';

test('app boots with a canvas and no console errors', async ({ page }) => {
  // ~1600 ops at one per frame takes ~27 s on its own, longer when the suite runs in parallel
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  // the landing scene paints live at one instruction per frame
  await expect(page.locator('body[data-ready="true"]')).toBeAttached({ timeout: 80_000 });
  await expect(page.locator('#stage canvas')).toBeVisible();
  // the project's name, from app/src/app/config.ts
  await expect(page).toHaveTitle(new RegExp(`^${APP_NAME}: `));
  await expect(page.locator('header h1')).toHaveText(APP_NAME);
  // the credit at the bottom, linking out in a new tab (the footer may carry other links too)
  await expect(page.locator('footer')).toContainText('Created by Shaun Pedicini');
  const credit = page.locator('footer a', { hasText: 'Shaun Pedicini' });
  await expect(credit).toHaveAttribute('href', 'https://mordenstar.com/projects');
  await expect(credit).toHaveAttribute('target', '_blank');
  await expect(credit).toHaveAttribute('rel', /noopener/);
  expect(errors).toEqual([]);
});

/**
 * How the stage and source use the page's width: beside each other with the usual gap and nothing
 * spare, or the stage across the page (centred, if a short screen caps it) with the source below.
 */
async function expectFilled(page: Page) {
  const f = await page.evaluate(() => {
    const main = document.querySelector('main')!;
    const cs = getComputedStyle(main);
    const m = main.getBoundingClientRect();
    const left = m.left + parseFloat(cs.paddingLeft);
    const right = m.right - parseFloat(cs.paddingRight);
    const v = document.querySelector('.viewer')!.getBoundingClientRect();
    const s = document.querySelector('.source')!.getBoundingClientRect();
    const stage = document.querySelector('#stage')!.getBoundingClientRect();
    const script = document.querySelector('#source')!.getBoundingClientRect();
    return { beside: s.left >= v.right, viewerLeft: v.left - left, viewerRight: right - v.right, sourceRight: right - s.right, gap: s.left - v.right, stageWidth: stage.width, viewerWidth: v.width, stageBottom: stage.bottom + scrollY, height: innerHeight, scriptTop: script.top - stage.top, scriptBottom: script.bottom - stage.bottom };
  });
  expect(Math.abs(f.sourceRight)).toBeLessThan(1);
  expect(Math.abs(f.stageWidth - f.viewerWidth)).toBeLessThan(1);
  if (f.beside) {
    expect(Math.abs(f.viewerLeft)).toBeLessThan(1);
    expect(Math.abs(f.gap - 16)).toBeLessThan(1);
    expect(f.stageBottom).toBeLessThanOrEqual(f.height); // no taller than the window
    // the script window's frame starts and ends level with the picture's
    expect(Math.abs(f.scriptTop)).toBeLessThan(1);
    expect(Math.abs(f.scriptBottom)).toBeLessThan(1);
  } else expect(Math.abs(f.viewerLeft - f.viewerRight)).toBeLessThan(1);
}

for (const [route, width, height] of [
  ['/#/scene/kq1/r01-c01?speed=instant', 1280, 900],
  ['/#/scene/kq1/r01-c01?speed=instant', 1300, 850],
  ['/#/scene/kq1/r01-c01?speed=instant', 1100, 800],
  ['/#/scene/kq1/r01-c01?speed=instant&compare=1', 1335, 900],
  ['/#/scene/kq1/r01-c01?speed=instant&compare=1', 1600, 900],
  ['/#/scene/handmade/lakeside?speed=instant', 390, 844],
  ['/#/scene/handmade/lakeside?speed=instant&compare=1', 844, 390],
  ['/#/scene/handmade/lakeside?speed=instant&compare=1', 360, 740],
] as const) {
  test(`the page holds its final layout while the app script loads (${route.split('?')[1]}, ${width}×${height})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const boxes = async () => {
      const r = (sel: string) => page.locator(sel).boundingBox();
      return { stage: await r('#stage'), source: await r('#source'), toolbar: await r('.toolbar'), galleryTop: (await r('#gallery'))?.y };
    };
    // hold the app script back: the page is styled and sized, with a loading message
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route('**/src/app/main.ts', async (r) => {
      await gate;
      await r.continue();
    });
    await page.goto(route, { waitUntil: 'commit' });
    // the page shows once its fonts are in
    await expect(page.locator('html')).not.toHaveClass(/fonts-loading/);
    await expect(page.locator('#boot-status')).toHaveText('Loading scenes…');
    await expect(page.locator('#prev')).toBeHidden();
    const before = await boxes();
    // the stage already fills its room
    await expectFilled(page);

    // once it has run: the same boxes, now filled in, with the canvas exactly filling the stage
    release();
    await expect(page.locator('body[data-ready="true"]')).toBeAttached({ timeout: 15_000 });
    await expect(page.locator('body')).not.toHaveClass('booting');
    await expect(page.locator('#boot-status')).toHaveCount(0);
    await expect(page.locator('#prev')).toBeVisible();
    // compare mode's score arrives asynchronously, after the scene is ready
    if (route.includes('compare=1')) await expect(page.locator('#cmp-score')).toHaveAttribute('data-match', /.+/);
    expect(await boxes()).toEqual(before);
    const canvas = await page.locator('#stage canvas').boundingBox();
    expect(canvas!.x).toBeCloseTo(before.stage!.x + 4, 1);
    expect(canvas!.y).toBeCloseTo(before.stage!.y + 4, 1);
    expect(canvas!.width).toBeCloseTo(before.stage!.width - 8, 1);
    expect(canvas!.height).toBeCloseTo(before.stage!.height - 8, 1);
  });
}

test('a failed app script load is reported instead of loading forever', async ({ page }) => {
  await page.route('**/src/app/main.ts', (r) => r.abort());
  await page.goto('/');
  await expect(page.locator('#boot-status')).toHaveText(/Couldn't load the viewer/);
  await expect(page.locator('#boot-status')).toHaveClass('error');
});

for (const [width, height] of [
  [1920, 1080],
  [1600, 1000],
  [1300, 850],
  [1100, 800],
  [1024, 768],
  [820, 1180],
  [390, 844],
  [360, 740],
  [844, 390],
] as const) {
  test(`the layout fits and stays put across scenes and while painting (${width}×${height})`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height });
    const boxes = () =>
      page.evaluate(() => {
        const r = (sel: string) => {
          const b = document.querySelector(sel)!.getBoundingClientRect();
          return [b.x, b.y, b.width, b.height].map((n) => Math.round(n * 10) / 10);
        };
        // the controls showing at this size (phones swap the speed and variant buttons for dropdowns)
        const shown = [...document.querySelectorAll<HTMLElement>('.toolbar button, .toolbar select, .toolbar .check')].filter((e) => e.getClientRects().length > 0);
        const controls = shown.map((e) => e.getBoundingClientRect().height);
        return {
          layout: { toolbar: r('.toolbar'), stage: r('#stage'), status: r('.status'), source: r('.source'), pause: r('#pause'), compare: r('.check'), gallery: r('#gallery')[1] },
          // the stats text differs between scenes, but mustn't move while one paints
          stats: r('#stats'),
          controlHeights: [...new Set(controls)],
          // every control lies within the page's margins (on a phone on its side the toolbar is wider
          // than the picture under it, so it fits on one row)
          outside: (() => {
            const main = document.querySelector('main')!;
            const m = main.getBoundingClientRect();
            const cs = getComputedStyle(main);
            const [left, right] = [m.left + parseFloat(cs.paddingLeft), m.right - parseFloat(cs.paddingRight)];
            return shown
              .filter((e) => {
                const b = e.getBoundingClientRect();
                return b.left < left - 0.5 || b.right > right + 0.5;
              })
              .map((e) => e.id || e.textContent);
          })(),
          overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        };
      });
    // a scene with day/night buttons, finished
    await page.goto('/#/scene/handmade/lakeside?speed=instant');
    await expect(page.locator('body[data-ready="true"]')).toBeAttached();
    const first = await boxes();
    expect(first.overflow).toBe(0);
    expect(first.controlHeights).toHaveLength(1);
    expect(first.outside).toEqual([]);
    expect(first.layout.stage[2]).toBeLessThanOrEqual(width);
    await expectFilled(page);
    // a scene without variants, caught mid-paint (pause button showing ▌▐, progress counting)
    await page.goto('/#/scene/custom/elk-valley');
    await expect.poll(() => page.evaluate(() => window.__kq.current().position)).toBeGreaterThan(10);
    expect(await page.evaluate(() => window.__kq.current().done)).toBe(false);
    const painting = await boxes();
    expect({ ...painting, stats: undefined }).toEqual({ ...first, stats: undefined });
    // and paused (►)
    await page.click('#pause');
    await expect(page.locator('#pause')).toHaveAttribute('aria-label', 'Play');
    expect(await boxes()).toEqual(painting);
  });
}

// Phones: the toolbar is a fixed grid of same-size controls with the speed as a dropdown, no day/night
// variants, and nothing squeezed to nothing. Upright: two rows, compare beside the scene's title under
// the picture, and the script window ending on screen. On its side: one row, compare included.
for (const [width, height, rows] of [[375, 667, 2], [390, 844, 2], [844, 390, 1], [667, 375, 1]] as const) {
  test(`phone toolbar layout: ${rows} row(s) of same-size controls at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/#/scene/custom/town-square-well?speed=instant');
    await expect(page.locator('body[data-ready="true"]')).toBeAttached({ timeout: 60_000 });
    const upright = rows === 2;
    const controls = page.locator('.toolbar :is(button, select, .check):visible');
    const boxes = await controls.evaluateAll((els) => els.map((e) => ({ id: e.id || e.className, ...e.getBoundingClientRect().toJSON() })));
    expect(boxes.map((b) => b.id)).toEqual(['prev', 'scene-select', 'next', 'speed-select', 'start', 'pause', 'step', ...(upright ? [] : ['check'])]);
    await expect(page.locator('#variants')).toBeHidden();
    // one height for every control, and the rows they sit on
    const heights = new Set(boxes.map((b) => Math.round(b.height)));
    expect(heights.size).toBe(1);
    expect(new Set(boxes.map((b) => Math.round(b.top))).size).toBe(rows);
    // the icon buttons are square
    for (const b of boxes.filter((x) => ['prev', 'next', 'start', 'pause', 'step'].includes(x.id))) expect(Math.round(b.width)).toBe(Math.round(b.height));
    // the scene picker shows names up to 19 characters whole upright (on its side, the smallest
    // phones cut the longest few short), and the speed picker its longest choice, "speed: instant"
    expect(boxes.find((b) => b.id === 'scene-select')!.width).toBeGreaterThan(upright ? 188 : 130);
    expect(boxes.find((b) => b.id === 'speed-select')!.width).toBeGreaterThanOrEqual(148);
    // everything is on screen, and the page doesn't scroll sideways
    for (const b of boxes) expect(b.right, b.id).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    // the speed dropdown says what it is, and drives the viewer like the buttons do
    await expect(page.locator('#speed-select option')).toHaveText(['speed: paint', 'speed: fast', 'speed: instant']);
    await page.locator('#speed-select').selectOption('fast');
    await expect(page.locator('#speeds button[data-speed="fast"]')).toHaveAttribute('aria-pressed', 'true');
    if (!upright) {
      await expect(page.locator('#status-compare')).toBeHidden();
      return;
    }
    // upright: compare is at the right end of the title's line, and turns compare mode on
    const [title, box, main] = await Promise.all(['#title', '#status-compare input', 'main'].map((s) => page.locator(s).boundingBox()));
    expect(Math.round(box!.y)).toBe(Math.round(title!.y));
    expect(box!.x).toBeGreaterThan(title!.x + title!.width);
    expect(Math.abs(main!.x + main!.width - 12 - (await page.locator('#status-compare').boundingBox())!.x - (await page.locator('#status-compare').boundingBox())!.width)).toBeLessThan(1);
    // and the header, toolbar, picture, status and the whole script window fit on the screen
    const source = (await page.locator('.source').boundingBox())!;
    expect(source.y + source.height).toBeLessThanOrEqual(height);
    expect(source.y + source.height).toBeGreaterThan(height - 20);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await page.locator('#status-compare').click();
    await expect(page.locator('#compare')).toBeVisible();
    await expect(page.locator('#compare-toggle')).toBeChecked();
    await expect(page).toHaveURL(/compare=1/);
  });
}

// p5 marks every canvas touch-action: none; a finger dragged over the picture must still scroll the page.
test('touch layout: dragging a finger over the picture scrolls the page', async ({ page }, info) => {
  test.skip(!info.project.use.hasTouch, 'needs a touch screen');
  await page.goto('/#/scene/kq1/r01-c01?speed=instant');
  await expect(page.locator('body[data-ready="true"]')).toBeAttached({ timeout: 60_000 });
  for (const sel of ['#stage canvas', '#gallery canvas']) {
    expect(await page.locator(sel).first().evaluate((e) => getComputedStyle(e).touchAction), sel).toBe('auto');
  }
  const stage = (await page.locator('#stage canvas').boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.synthesizeScrollGesture', { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2, yDistance: -300, gestureSourceType: 'touch', speed: 2000 });
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
});

// Tablets held upright: compare sits at the end of the line under the picture, and the toolbar, picture
// and the whole script window fit on the screen (however many rows the toolbar takes at that width).
for (const [width, height] of [[768, 1024], [820, 1180], [1024, 1366]] as const) {
  test(`tablet portrait layout: everything down to the script window fits at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/#/scene/custom/town-square-well?speed=instant');
    await expect(page.locator('body[data-ready="true"]')).toBeAttached({ timeout: 60_000 });
    await expect(page.locator('.toolbar .check')).toBeHidden();
    await expect(page.locator('#status-compare')).toBeVisible();
    const [title, box] = await Promise.all(['#title', '#status-compare input'].map((s) => page.locator(s).boundingBox()));
    expect(Math.round(box!.y)).toBe(Math.round(title!.y));
    const source = (await page.locator('.source').boundingBox())!;
    expect(source.y + source.height).toBeLessThanOrEqual(height);
    expect(source.y + source.height).toBeGreaterThan(height - 24);
    expect(source.height).toBeGreaterThan(300);
    // not scrolled, and no sideways scroll (tried rather than measured: the page is narrower than
    // innerWidth wherever the browser reserves a scrollbar gutter)
    expect(await page.evaluate(() => {
      const y = scrollY;
      scrollTo(50, y);
      const x = scrollX;
      scrollTo(0, y);
      return [y, x];
    })).toEqual([0, 0]);
  });
}

// The button that paints a scene over its original says how to use it: Tap on touch screens.
test('touch layout: the paint-it button over an original says Tap', async ({ page }, info) => {
  test.skip(!info.project.use.hasTouch, 'needs a touch screen');
  await page.goto('/#/scene/kq6/r03-c01');
  await expect(page.locator('#rasterize')).toBeVisible();
  await expect(page.locator('#rasterize')).toHaveText('Tap to paint it', { useInnerText: true });
  await expect(page.getByRole('button', { name: 'Tap to paint it' })).toBeVisible();
});
