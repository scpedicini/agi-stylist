import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { execute } from '../../src/engine/execute.ts';
import { Playback } from '../../src/engine/playback.ts';
import { compile } from '../../src/lang/index.ts';

const stdlib = readFileSync('app/src/lang/stdlib.pic', 'utf8');

const sceneCount = (group: string) => readdirSync(`scenes/${group}`).filter((f) => f.endsWith('.pic')).length;

const nodeOps = (id: string, variant?: string) => compile(readFileSync(`scenes/${id}.pic`, 'utf8'), { file: `scenes/${id}.pic`, variant, prelude: stdlib }).ops;

function nodeHash(id: string, variant?: string) {
  return execute(nodeOps(id, variant)).hash();
}

/** Where each of the scene's instructions starts (what +1 and -1 step between), in ops played. */
const nodeMarks = (id: string) => [...new Playback(nodeOps(id)).marks];

/** Wait until the viewer shows `id` (if given) and has finished painting it. */
async function ready(page: Page, id?: string) {
  await expect
    .poll(async () => page.evaluate(() => window.__kq?.current()), { timeout: 15_000 })
    .toMatchObject({ done: true, ...(id ? { id } : {}) });
}

const current = (page: Page) => page.evaluate(() => window.__kq.current());

test.describe('scene viewer', () => {
  test('the URL fully determines speed and compare state', async ({ page }) => {
    await page.goto('/#/scene/kq1/r01-c01?speed=instant&compare=1');
    await ready(page, 'kq1/r01-c01');
    await expect(page.locator('#compare')).toBeVisible();
    await page.goto('/#/scene/kq1/r01-c03');
    await expect(page.locator('#compare')).toBeHidden();
    await expect(page.locator('#speeds button[data-speed="paint"]')).toHaveAttribute('aria-pressed', 'true');
    await page.click('#compare-toggle');
    await expect(page).toHaveURL(/compare=1/);
  });

  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
  });
  test.afterEach(() => expect(errors).toEqual([]));

  test('lists every scene in the gallery and the picker', async ({ page }) => {
    await page.goto('/#/scene/kq1/r01-c01?speed=instant');
    await ready(page, 'kq1/r01-c01');
    const ids = await page.evaluate(() => window.__kq.scenes);
    expect(ids.filter((id) => id.startsWith('kq1/'))).toHaveLength(sceneCount('kq1'));
    await expect(page.locator('#gallery a')).toHaveCount(ids.length);
    await expect(page.locator('#scene-select option')).toHaveCount(ids.length);
    await expect(page.locator('body[data-thumbnails="true"]')).toBeAttached({ timeout: 30_000 });
  });

  test('arrow keys and buttons navigate and update the URL', async ({ page }) => {
    await page.goto('/#/scene/kq1/r01-c01?speed=instant');
    await ready(page, 'kq1/r01-c01');
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/#\/scene\/kq1\/r01-c02\?speed=instant/);
    await ready(page, 'kq1/r01-c02');
    await page.click('#prev');
    await expect(page).toHaveURL(/#\/scene\/kq1\/r01-c01/);
    await ready(page, 'kq1/r01-c01');
    const ids = await page.evaluate(() => window.__kq.scenes);
    const before = ids[ids.indexOf('kq1/r01-c01') - 1];
    expect(before).toMatch(/^kq6\//);
    await page.keyboard.press('ArrowLeft');
    // KQ6 scenes wait on their original until rasterized
    await expect.poll(() => current(page)).toMatchObject({ id: before, awaitingRasterize: true });
  });

  for (const id of ['kq1/r01-c01', 'kq1/r03-c04', 'kq1/r05-c05', 'kq1/r07-c09']) {
    test(`browser render of ${id} matches the Node render`, async ({ page }) => {
      await page.goto(`/#/scene/${id}?speed=instant`);
      await ready(page, id);
      const c = await current(page);
      expect(c.hash).toBe(nodeHash(id));
      expect(c.finalHash).toBe(c.hash);
    });
  }

  test('compare mode reports a 100% match for traced scenes', async ({ page }) => {
    await page.goto('/#/scene/kq1/r02-c03?speed=instant&compare=1');
    await ready(page, 'kq1/r02-c03');
    await expect(page.locator('#cmp-score')).toHaveAttribute('data-match', '100.00');
    await expect(page.locator('#cmp-score')).toContainText('0 px differ');
  });

  test('slow paint playback progresses and completes', async ({ page }) => {
    await page.goto('/#/scene/kq1/r05-c06');
    await expect.poll(async () => (await current(page)).id).toBe('kq1/r05-c06');
    const first = await current(page);
    expect(first.opCount).toBeGreaterThan(10);
    await expect.poll(async () => (await current(page)).position).toBeGreaterThan(0);
    await ready(page, 'kq1/r05-c06');
    const done = await current(page);
    expect(done.done).toBe(true);
    expect(done.hash).toBe(done.finalHash);
  });

  test('clicking a gallery thumbnail scrolls back up to the stage', async ({ page }) => {
    await page.goto('/#/scene/kq1/r01-c01?speed=instant');
    await ready(page, 'kq1/r01-c01');
    const thumb = page.locator('#gallery a[data-id="kq1/r07-c05"]');
    await thumb.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(1000);
    await thumb.click();
    await ready(page, 'kq1/r07-c05');
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await expect(page.locator('#stage canvas')).toBeInViewport({ ratio: 1 });

    // keyboard: Enter on a focused thumbnail scrolls up too and moves focus to the stage
    const next = page.locator('#gallery a[data-id="kq1/r07-c06"]');
    await next.focus();
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(1000);
    await page.keyboard.press('Enter');
    await ready(page, 'kq1/r07-c06');
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await expect(page.locator('#stage')).toBeFocused();

    // on a short window the toolbar and the whole stage are brought into view instead
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.locator('#gallery a[data-id="kq1/r07-c07"]').click();
    await ready(page, 'kq1/r07-c07');
    await expect(page.locator('#stage canvas')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.toolbar')).toBeInViewport({ ratio: 1 });
  });

  test('the pause button pauses and resumes painting', async ({ page }) => {
    // a long scene (~1600 ops at one per frame) so it can't finish before the clicks land
    await page.goto('/#/scene/custom/elk-valley');
    await expect.poll(async () => (await current(page)).position).toBeGreaterThan(0);
    await page.click('#pause');
    await expect(page.locator('#pause')).toHaveAttribute('aria-label', 'Play');
    const at = (await current(page)).position;
    await page.waitForTimeout(300);
    expect(await current(page)).toMatchObject({ paused: true, position: at, done: false });
    // changing speed keeps the pause
    await page.click('#speeds button[data-speed="fast"]');
    await page.waitForTimeout(300);
    expect(await current(page)).toMatchObject({ paused: true, position: at });
    // the keyboard shortcut resumes
    await page.keyboard.press('p');
    await expect(page.locator('#pause')).toHaveAttribute('aria-label', 'Pause');
    await expect.poll(async () => (await current(page)).position).toBeGreaterThan(at);
    // once finished, the button replays the painting; picking a speed only sets how fast
    await page.click('#speeds button[data-speed="instant"]');
    await ready(page, 'custom/elk-valley');
    await expect(page.locator('#pause')).toHaveAttribute('aria-label', 'Replay');
    await page.click('#speeds button[data-speed="paint"]');
    await page.waitForTimeout(300);
    expect(await current(page)).toMatchObject({ done: true });
    await page.click('#pause');
    await expect(page.locator('#pause')).toHaveAttribute('aria-label', 'Pause');
    await expect(page).not.toHaveURL(/speed=/);
    expect((await current(page)).paused).toBe(false);
  });

  test('+1 on a finished scene starts it again one instruction at a time', async ({ page }) => {
    const marks = nodeMarks('kq1/r01-c01');
    await page.goto('/#/scene/kq1/r01-c01?speed=instant');
    await ready(page, 'kq1/r01-c01');
    await page.click('#step');
    expect(await current(page)).toMatchObject({ position: marks[1], paused: true, done: false });
    await page.waitForTimeout(300); // playback doesn't carry on by itself…
    expect((await current(page)).position).toBe(marks[1]);
    await page.click('#step'); // …each press is one more
    expect((await current(page)).position).toBe(marks[2]);
    await expect(page.locator('#pause')).toHaveAttribute('aria-label', 'Play');
  });

  test('+1 paints a whole instruction (a colour and a rect: one press), and a scene finished by stepping offers a replay', async ({ page }) => {
    await page.goto('/#/scene/kq1/r05-c06?speed=instant');
    await ready(page, 'kq1/r05-c06');
    await page.click('#edit');
    await page.fill('#editor', 'color blue\nrect 0, 0, 159, 9\ncolor red\nline 0, 20, 159, 20');
    await page.click('#run');
    await expect.poll(async () => (await current(page)).opCount).toBe(13);
    await ready(page);
    await page.click('#start');
    expect(await current(page)).toMatchObject({ position: 0, paused: true });
    await page.click('#step');
    expect(await current(page)).toMatchObject({ position: 11, paused: true });
    await expect(page.locator('#source .ln.current')).toHaveText('rect 0, 0, 159, 9');
    await page.click('#step');
    expect(await current(page)).toMatchObject({ done: true, position: 13 });
    await expect(page.locator('#pause')).toHaveAttribute('aria-label', 'Replay');
    await expect(page.locator('#end')).toHaveAttribute('aria-disabled', 'true');
    await page.locator('#stage').focus();
    await page.keyboard.press(' ');
    await ready(page, 'kq1/r05-c06');
  });

  test('an old step-speed link opens paused at the start, ready for +1, which highlights its line', async ({ page }) => {
    const marks = nodeMarks('kq1/r01-c01');
    await page.goto('/#/scene/kq1/r01-c01?speed=step&compare=1');
    await expect.poll(async () => (await current(page)).id).toBe('kq1/r01-c01');
    await expect(page).toHaveURL(/#\/scene\/kq1\/r01-c01\?compare=1$/);
    await expect(page.locator('#speeds button[data-speed="paint"]')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(300);
    expect(await current(page)).toMatchObject({ position: 0, paused: true });
    await page.click('#step');
    await page.click('#step');
    expect((await current(page)).position).toBe(marks[2]);
    await expect(page.locator('#source .ln.current')).toHaveCount(1);
  });

  test('live editing recompiles the scene and reports errors with line numbers', async ({ page }) => {
    await page.goto('/#/scene/kq1/r05-c06?speed=instant');
    await ready(page, 'kq1/r05-c06');
    await page.click('#edit');
    await page.fill('#editor', 'color blue\nfill 0,0\ncolor yellow\nline 0,0 159,167');
    await page.click('#run');
    await expect.poll(async () => (await current(page)).opCount).toBe(4);
    await ready(page, 'kq1/r05-c06');
    await expect(page.locator('#source-path')).toContainText('(edited)');
    await page.fill('#editor', 'color blue\nline 0,0 (');
    await page.click('#run');
    await expect(page.locator('#messages .error')).toContainText('scenes/kq1/r05-c06.pic:2:');
  });

  test('screenshot', async ({ page }, info) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto('/#/scene/kq1/r01-c02?speed=instant&compare=1');
    await ready(page, 'kq1/r01-c02');
    await expect(page.locator('#cmp-score')).toHaveAttribute('data-match', /.+/);
    await page.screenshot({ path: info.outputPath('viewer.png') });
  });
});

test.describe('variants', () => {
  test('the variant toggle re-renders the scene and updates the URL', async ({ page }) => {
    await page.goto('/#/scene/handmade/lakeside?speed=instant');
    await expect.poll(async () => page.evaluate(() => window.__kq?.current())).toMatchObject({ id: 'handmade/lakeside', done: true, variant: 'day' });
    const day = await page.evaluate(() => window.__kq.current().hash);
    await page.click('#variants button[data-variant="night"]');
    await expect(page).toHaveURL(/variant=night/);
    await expect.poll(async () => page.evaluate(() => window.__kq.current())).toMatchObject({ variant: 'night', done: true });
    const night = await page.evaluate(() => window.__kq.current().hash);
    expect(night).not.toBe(day);
    expect(night).toBe(nodeHash('handmade/lakeside', 'night'));
  });

  test('speed and the chosen variant carry over to scenes picked from the gallery, picker and arrows', async ({ page }) => {
    await page.goto('/#/scene/handmade/lakeside');
    await page.click('#speeds button[data-speed="instant"]');
    await page.click('#variants button[data-variant="night"]');
    await expect(page).toHaveURL(/#\/scene\/handmade\/lakeside\?variant=night&speed=instant$/);
    // a gallery thumbnail - its link is up to date on hover/focus too (for middle-click / new tab)
    await page.hover('#gallery a[data-id="custom/elk-valley"]');
    await expect(page.locator('#gallery a[data-id="custom/elk-valley"]')).toHaveAttribute('href', '#/scene/custom/elk-valley?variant=night&speed=instant');
    await page.focus('#gallery a[data-id="sketches/03-cottage-kitchen"]');
    await expect(page.locator('#gallery a[data-id="sketches/03-cottage-kitchen"]')).toHaveAttribute('href', '#/scene/sketches/03-cottage-kitchen?speed=instant');
    await page.click('#gallery a[data-id="custom/steam-train"]');
    await expect(page).toHaveURL(/#\/scene\/custom\/steam-train\?variant=night&speed=instant$/);
    await expect(page.locator('#speeds button[data-speed="instant"]')).toHaveAttribute('aria-pressed', 'true');
    // a scene without a night variant falls back to its default but keeps the speed…
    await page.click('#gallery a[data-id="sketches/05-street-levels"]');
    await expect(page).toHaveURL(/#\/scene\/sketches\/05-street-levels\?speed=instant$/);
    await expect.poll(async () => (await current(page)).variant).toBe('dusk');
    // …and the next scene that has one is shown at night again
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/#\/scene\/sketches\/06-camp-scan\?variant=night&speed=instant$/);
    await page.selectOption('#scene-select', 'custom/town-square-well');
    await expect(page).toHaveURL(/#\/scene\/custom\/town-square-well\?variant=night&speed=instant$/);
    await ready(page, 'custom/town-square-well');
    expect((await current(page)).hash).toBe(nodeHash('custom/town-square-well', 'night'));
  });

  test('hand-authored scenes show their match score in compare mode', async ({ page }) => {
    await page.goto('/#/scene/handmade/castle?speed=instant&compare=1');
    await expect(page.locator('#cmp-score')).toHaveAttribute('data-match', /^(9\d|100)\.\d\d$/);
  });
});

test.describe('scene groups', () => {
  test('custom scenes are listed and render like Node; hidden groups are unlisted but still open from a link', async ({ page }) => {
    await page.goto('/#/scene/custom/golden-apple-meadow?speed=instant&variant=night');
    await expect.poll(async () => page.evaluate(() => window.__kq?.current())).toMatchObject({
      id: 'custom/golden-apple-meadow',
      variant: 'night',
      done: true,
    });
    expect(await page.evaluate(() => window.__kq.current().hash)).toBe(nodeHash('custom/golden-apple-meadow', 'night'));
    const groups = await page.locator('#gallery h2').allTextContents();
    expect(groups[0]).toBe('Custom scenes');
    // HIDDEN_GROUPS (config.ts): examples and hand-authored recreations
    expect(groups).not.toContain('Examples');
    expect(groups.some((g) => g.startsWith('Recreations'))).toBe(false);
    expect(await page.locator('#gallery a[data-id^="handmade/"], #scene-select option[value^="examples/"]').count()).toBe(0);
    expect(groups.at(-1)).toContain("King's Quest I");
    await expect(page.locator('#where')).toHaveText(/^Scene \d+ of \d+$/);

    await page.goto('/#/scene/handmade/castle?speed=instant');
    await ready(page, 'handmade/castle');
    expect((await current(page)).hash).toBe(nodeHash('handmade/castle'));
    await expect(page.locator('#where')).toHaveText('Unlisted scene');
    // → from an unlisted scene goes on to the next listed one
    await page.click('#next');
    await expect.poll(async () => (await current(page)).id).not.toBe('handmade/castle');
    expect((await current(page)).id).not.toMatch(/^(handmade|examples)\//);
  });
});

test.describe('KQ6 originals', () => {
  /** Share of the stage canvas's pixels that are see-through (showing the original beneath). */
  const transparency = (page: Page) =>
    page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('#stage canvas')!;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] === 0) n++;
      return n / (d.length / 4);
    });

  test('the gallery shows the VGA originals', async ({ page }) => {
    await page.goto('/#/scene/kq1/r01-c01?speed=instant');
    const thumbs = page.locator('#gallery a[data-id^="kq6/"] img');
    await expect(thumbs).toHaveCount(sceneCount('kq6'));
    await expect(thumbs.first()).toHaveAttribute('src', /r02-c01.*\.png/);
    await expect(page.locator('#gallery a[data-id^="kq6/"] canvas')).toHaveCount(0);
  });

  test('a KQ6 scene shows its original until rasterized, then paints over it', async ({ page }) => {
    await page.goto('/#/scene/kq1/r01-c01');
    await page.locator('#gallery a[data-id="kq6/r03-c01"]').click();
    await expect(page.locator('#original')).toBeVisible();
    await expect.poll(() => page.locator('#original').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(320);
    await expect(page.locator('#rasterize')).toBeVisible();
    await expect(page.locator('#rasterize')).toHaveText('Click to paint it', { useInnerText: true });
    await page.waitForTimeout(300);
    expect(await current(page)).toMatchObject({ id: 'kq6/r03-c01', awaitingRasterize: true, position: 0, done: false });
    expect(await transparency(page)).toBe(1);
    await expect(page.locator('#pause')).toHaveAttribute('aria-label', 'Play');

    // the button sits in the middle of the picture
    const offset = await page.evaluate(() => {
      const [s, b] = ['stage', 'rasterize'].map((id) => document.getElementById(id)!.getBoundingClientRect());
      return [b.x + b.width / 2 - (s.x + s.width / 2), b.y + b.height / 2 - (s.y + s.height / 2)].map(Math.abs);
    });
    expect(Math.max(...offset)).toBeLessThan(2);

    // painting: only what has been painted so far covers the original
    await page.click('#rasterize');
    await expect(page.locator('#rasterize')).toBeHidden();
    await expect.poll(async () => (await current(page)).position).toBeGreaterThan(5);
    await page.click('#pause');
    const partly = await transparency(page);
    expect(partly).toBeGreaterThan(0);
    expect(partly).toBeLessThan(1);

    // finished: the AGI picture is shown whole, exactly as Node renders it
    await page.click('#speeds button[data-speed="instant"]');
    await page.click('#pause');
    await ready(page, 'kq6/r03-c01');
    expect((await current(page)).hash).toBe(nodeHash('kq6/r03-c01'));
    await expect.poll(() => transparency(page)).toBe(0);
  });

  test('sketch scenes open on their sketch and are painted over it too', async ({ page }) => {
    await page.goto('/#/scene/sketches/10-lake-cabin?speed=instant');
    await expect.poll(async () => (await current(page)).id).toBe('sketches/10-lake-cabin');
    expect(await current(page)).toMatchObject({ awaitingRasterize: true, position: 0 });
    await expect(page.locator('#original')).toHaveAttribute('src', /tests\/fixtures\/sketches\/10-lake-cabin\.png/);
    await page.click('#rasterize');
    await ready(page, 'sketches/10-lake-cabin');
    expect((await current(page)).hash).toBe(nodeHash('sketches/10-lake-cabin'));
    // the gallery shows the painted scene, not the sketch
    await expect(page.locator('#gallery a[data-id="sketches/10-lake-cabin"] canvas')).toHaveCount(1);
  });

  test('compare mode shows the original and the painting laid over it', async ({ page }) => {
    await page.goto('/#/scene/kq6/r03-c01?speed=instant&compare=1');
    await expect(page.locator('#cmp-score')).toHaveText('overlay: the painting on its original');
    await expect(page.locator('#cmp-score')).toHaveAttribute('data-match', 'none');
    // the original panel has the VGA picture in it (not left blank)
    const filled = await page.locator('#cmp-original').evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
      return n / (c.width * c.height);
    });
    expect(filled).toBe(1);
  });

  test('play and +1 also start rasterizing; other scenes have no original', async ({ page }) => {
    await page.goto('/#/scene/kq6/r03-c02?speed=instant');
    await expect.poll(async () => (await current(page)).awaitingRasterize).toBe(true);
    await page.click('#step');
    expect(await current(page)).toMatchObject({ awaitingRasterize: false, position: nodeMarks('kq6/r03-c02')[1], paused: true });
    await expect(page.locator('#rasterize')).toBeHidden();
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await current(page)).awaitingRasterize).toBe(true);
    await page.keyboard.press('p');
    await ready(page, 'kq6/r03-c03');
    await page.goto('/#/scene/handmade/castle?speed=instant');
    await ready(page, 'handmade/castle');
    await expect(page.locator('#original')).toBeHidden();
    await expect(page.locator('#rasterize')).toBeHidden();
    expect(await transparency(page)).toBe(0);
  });

  test('from an old step-speed link, the paint-it button (by keyboard) starts painting and keeps focus near the stage', async ({ page }) => {
    await page.goto('/#/scene/kq6/r03-c04?speed=step');
    await expect(page.locator('#rasterize')).toBeEnabled();
    await page.locator('#rasterize').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#stage')).toBeFocused();
    await expect(page.locator('#speeds button[data-speed="paint"]')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await current(page)).position).toBeGreaterThan(0);
    // and so does Play
    await page.goto('/#/scene/kq6/r03-c05?speed=step');
    await expect(page.locator('#rasterize')).toBeEnabled();
    await page.keyboard.press('p');
    await expect.poll(async () => (await current(page)).position).toBeGreaterThan(0);
    expect((await current(page)).paused).toBe(false);
  });

  test('the transport: back to the start, +1 and -1 by whole instructions, skip to the end; delayed backdrops come last', async ({ page }) => {
    const id = 'myst/r11-c13';
    const marks = nodeMarks(id);
    await page.goto(`/#/scene/${id}`);
    await expect(page.locator('#rasterize')).toBeEnabled();
    // waiting on the original: back to the start and -1 have nothing to do
    for (const b of ['#start', '#back']) {
      await expect(page.locator(b)).toHaveAttribute('aria-disabled', 'true');
      await page.click(b, { force: true }); // (greyed out, but still focusable and clickable)
    }
    expect(await current(page)).toMatchObject({ awaitingRasterize: true, position: 0 });
    // paint a while, pause, and go back to the start: nothing painted, the whole original, paused
    await page.click('#pause');
    await expect.poll(async () => (await current(page)).position).toBeGreaterThan(20);
    await page.click('#pause');
    await page.click('#start');
    expect(await current(page)).toMatchObject({ position: 0, paused: true, awaitingRasterize: false });
    await expect(page.locator('#rasterize')).toBeHidden();
    await expect(page.locator('#start')).toHaveAttribute('aria-disabled', 'true');
    await expect.poll(() => transparency(page)).toBe(1);
    // +1 paints a whole instruction; the sky is held back (delay), so the original still shows round it
    await page.click('#step');
    expect((await current(page)).position).toBe(marks[1]);
    await expect.poll(() => transparency(page)).toBeLessThan(1);
    expect(await transparency(page)).toBeGreaterThan(0.8);
    await page.click('#step');
    expect((await current(page)).position).toBe(marks[2]);
    await page.click('#back');
    expect((await current(page)).position).toBe(marks[1]);
    // the keyboard, on the picture: . and , step, End skips to the end, Home goes back to the start
    await page.locator('#stage').focus();
    await page.keyboard.press('.');
    expect((await current(page)).position).toBe(marks[2]);
    await page.keyboard.press(',');
    expect((await current(page)).position).toBe(marks[1]);
    await page.keyboard.press('End');
    expect(await current(page)).toMatchObject({ done: true, paused: true, hash: nodeHash(id) });
    await expect(page.locator('#end')).toHaveAttribute('aria-disabled', 'true');
    await expect.poll(() => transparency(page)).toBe(0);
    await page.keyboard.press('Home');
    expect(await current(page)).toMatchObject({ position: 0, paused: true });
    // away from the picture, Home and End are the page's again
    await page.locator('#gallery a').first().focus();
    await page.keyboard.press('End');
    expect((await current(page)).position).toBe(0);
  });

  test('rasterizing waits for the original to load', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // just the picture: in dev, Vite also serves `…/r03-c08.png?url` as a JS module
    await page.route((url) => url.pathname.endsWith('/kq6/r03-c08.png') && !url.search, async (r) => {
      await gate;
      await r.continue();
    });
    await page.goto('/#/scene/kq6/r03-c08?speed=instant', { waitUntil: 'domcontentloaded' });
    await expect.poll(async () => (await current(page)).awaitingRasterize).toBe(true);
    await expect(page.locator('#rasterize')).toBeDisabled();
    await expect(page.locator('#original')).toHaveClass('loading');
    await page.keyboard.press('p');
    await page.locator('#step').click();
    expect(await current(page)).toMatchObject({ awaitingRasterize: true, position: 0 });
    release();
    await expect(page.locator('#rasterize')).toBeEnabled();
    await expect(page.locator('#original')).not.toHaveClass('loading');
    await page.click('#rasterize');
    await ready(page, 'kq6/r03-c08');
  });
});
