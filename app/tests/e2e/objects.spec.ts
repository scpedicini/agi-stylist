import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { Framebuffer } from '../../src/engine/framebuffer.ts';
import { ObjectModel } from '../../src/engine/objects.ts';
import { compile } from '../../src/lang/index.ts';

// The cottage kitchen's objects: hover the finished picture to name them, click to hide them.
const ID = 'sketches/03-cottage-kitchen';
const r = compile(readFileSync(`scenes/${ID}.pic`, 'utf8'), { file: `scenes/${ID}.pic`, prelude: readFileSync('app/src/lang/stdlib.pic', 'utf8') });
const model = ObjectModel.create(r.ops, r.objects)!;
const hashWithout = (...ids: string[]) => new Framebuffer(model.compose(ids).pixels).hash();

const current = (page: Page) => page.evaluate(() => window.__kq.current());

/** Open the kitchen, paint it over its sketch and wait until it's finished. */
async function openKitchen(page: Page) {
  await page.goto(`/#/scene/${ID}?speed=instant`);
  await page.click('#rasterize');
  await expect.poll(async () => (await current(page)).done, { timeout: 15_000 }).toBe(true);
}

/** Where picture pixel (x, y) is on the page. */
async function at(page: Page, x: number, y: number) {
  const box = (await page.locator('#stage canvas').boundingBox())!;
  return { x: box.x + ((x + 0.5) / 160) * box.width, y: box.y + ((y + 0.5) / 168) * box.height };
}

test.describe('scene objects', () => {
  test('hovering names the object in an AGI tooltip and lights it up; clicking hides it', async ({ page }) => {
    await openKitchen(page);
    expect((await current(page)).objects).toEqual(['window', 'moon', 'fireplace', 'fire', 'jug', 'plate', 'door', 'latch', 'rug', 'table', 'loaf', 'chandelier']);
    const tip = page.locator('#object-tip');
    await expect(tip).toBeHidden();

    // the loaf, where it lies on the table top
    const loaf = await at(page, 80, 121);
    await page.mouse.move(loaf.x, loaf.y);
    await expect(tip).toBeVisible();
    await expect(tip.locator('.name')).toHaveText('loaf');
    await expect(tip).toContainText('click to hide');
    await expect(page.locator('#stage')).toHaveClass(/picking/);
    await expect(page.locator('#objects button[data-id="loaf"]')).toHaveClass(/lit/);
    // the tooltip is the page's own, styled like the rest, not the browser's
    expect(await tip.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('IBM');

    // a part names what it's part of
    const fire = await at(page, 98, 104);
    await page.mouse.move(fire.x, fire.y);
    await expect(tip.locator('.name')).toHaveText('fire');
    await expect(tip).toContainText('part of the fireplace');

    // click the loaf: the table top shows where it was, and the pointer is over the table now
    await page.mouse.move(loaf.x, loaf.y);
    await page.mouse.click(loaf.x, loaf.y);
    await expect.poll(async () => (await current(page)).hidden).toEqual(['loaf']);
    await expect.poll(async () => (await current(page)).hash).toBe(hashWithout('loaf'));
    expect((await current(page)).finalHash).toBe(hashWithout('loaf'));
    await expect(tip.locator('.name')).toHaveText('table');
    await expect(page.locator('#objects button[data-id="loaf"]')).toHaveAttribute('aria-pressed', 'false');

    // the background isn't an object: no tooltip, no pointer
    const wall = await at(page, 130, 60);
    await page.mouse.move(wall.x, wall.y);
    await expect(tip).toBeHidden();
    await expect(page.locator('#stage')).not.toHaveClass(/picking/);
    await page.mouse.click(wall.x, wall.y);
    expect((await current(page)).hidden).toEqual(['loaf']);
  });

  test('the objects bar hides and shows them, parts with their object, and survives a replay', async ({ page }) => {
    await openKitchen(page);
    const key = (id: string) => page.locator(`#objects button[data-id="${id}"]`);
    await expect(page.locator('#objects')).toBeVisible();
    await expect(key('fire')).toHaveText('└ fire');
    await key('fireplace').click();
    await expect.poll(async () => (await current(page)).hash).toBe(hashWithout('fireplace'));
    await expect(key('fireplace')).toHaveAttribute('aria-pressed', 'false');
    await expect(key('fire')).toHaveAttribute('aria-pressed', 'false'); // hidden with it
    await expect(key('jug')).toHaveAttribute('aria-pressed', 'true'); // a sibling stays
    // showing the fire shows its fireplace again
    await key('fire').click();
    await expect.poll(async () => (await current(page)).hidden).toEqual([]);
    await key('table').click();
    await key('rug').click();
    await expect.poll(async () => (await current(page)).hash).toBe(hashWithout('table', 'rug'));
    // replaying paints the scene again with them still hidden
    await page.keyboard.press('r');
    await expect.poll(async () => (await current(page)).done, { timeout: 15_000 }).toBe(true);
    expect((await current(page)).hash).toBe(hashWithout('table', 'rug'));
    // show all
    await page.locator('#objects button.all').click();
    await expect.poll(async () => (await current(page)).hash).toBe(hashWithout());
    await expect(page.locator('#objects button.all')).toBeHidden();
    // another scene has no objects: no bar, and the hidden set doesn't follow
    await key('loaf').click();
    await page.goto('/#/scene/kq1/r01-c01?speed=instant');
    await expect.poll(async () => (await current(page)).id).toBe('kq1/r01-c01');
    await expect(page.locator('#objects')).toBeHidden();
    expect((await current(page)).hidden).toEqual([]);
  });

  test('hidden objects survive a failed edit and a rerun; picking waits for the finished picture', async ({ page }) => {
    await openKitchen(page);
    await page.locator('#objects button[data-id="loaf"]').click();
    const source = readFileSync(`scenes/${ID}.pic`, 'utf8');
    await page.click('#edit');
    await page.locator('#editor').fill(source + '\nline 0, 0 (');
    await page.click('#run');
    await expect.poll(async () => (await current(page)).opCount).toBe(0);
    await page.locator('#editor').fill(source);
    await page.click('#run');
    await page.click('#rasterize'); // a sketch scene waits on its sketch again
    await expect.poll(async () => (await current(page)).done, { timeout: 15_000 }).toBe(true);
    expect((await current(page)).hidden).toEqual(['loaf']);
    await expect.poll(async () => (await current(page)).hash).toBe(hashWithout('loaf'));
    await page.click('#edit'); // back to viewing

    // painting slowly: nothing to pick until it's finished
    await page.goto(`/#/scene/${ID}?speed=paint`);
    const loaf = await at(page, 80, 121);
    await page.mouse.move(loaf.x, loaf.y);
    await expect(page.locator('#rasterize')).toBeVisible();
    await page.mouse.click(loaf.x, loaf.y + 40); // the paint-it button, not a pick
    await page.mouse.move(loaf.x, loaf.y);
    expect((await current(page)).done).toBe(false);
    await expect(page.locator('#object-tip')).toBeHidden();
    await page.click('#end');
    await expect.poll(async () => (await current(page)).done).toBe(true);
    await page.mouse.move(loaf.x + 1, loaf.y);
    // (the loaf is still hidden: the same scene keeps its hidden objects)
    await expect(page.locator('#object-tip .name')).toHaveText('table');
    // a new scene puts the tooltip and the highlight out
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await current(page)).id).not.toBe(ID);
    await expect(page.locator('#object-tip')).toBeHidden();
    expect((await current(page)).lit).toBeNull();
  });

  test('the keyboard can work the objects bar, and a key keeps the focus', async ({ page }) => {
    await openKitchen(page);
    const loaf = page.locator('#objects button[data-id="loaf"]');
    await loaf.focus();
    expect((await current(page)).lit).toBe('loaf');
    const loafPixels = model.visible(model.compose(), model.indexOf('loaf')).reduce((a, b) => a + b, 0);
    expect((await current(page)).highlighted).toBe(loafPixels);
    await page.keyboard.press('Enter');
    await expect(loaf).toHaveAttribute('aria-pressed', 'false');
    await expect(loaf).toBeFocused();
    // hidden, it lights up only in the bar: nothing of it is left to light on the picture
    expect((await current(page)).highlighted).toBeNull();
    await page.keyboard.press('Enter');
    await expect(loaf).toHaveAttribute('aria-pressed', 'true');
    await expect(loaf).toBeFocused();
    expect((await current(page)).highlighted).toBe(loafPixels);
    await page.keyboard.press('Space');
    await page.locator('#objects button.all').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#objects button.all')).toBeHidden();
    await expect(page.locator('#objects button[data-id="window"]')).toBeFocused();
    expect((await current(page)).hidden).toEqual([]);
  });
});

// The objects bar is one row under the status line, so a scene with objects still fits the window.
for (const [width, height] of [[2200, 1080], [1920, 1080], [1300, 850], [375, 667], [390, 844]] as const) {
  test(`objects layout: the bar is one row and the scene still fits at ${width}×${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await openKitchen(page);
    const bar = (await page.locator('#objects').boundingBox())!;
    const key = (await page.locator('#objects button[data-id="window"]').boundingBox())!;
    expect(bar.height).toBeLessThan(key.height * 1.5 + 12); // one row (and maybe a thin scrollbar)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width >= 1200) {
      // side by side: the picture and everything under it fit the window's height (with a mouse:
      // a touch screen's taller controls everywhere don't promise that)
      if (!info.project.use.hasTouch) expect(bar.y + bar.height).toBeLessThanOrEqual(height);
    } else {
      // upright phones: down to the end of the script window
      const source = (await page.locator('.source').boundingBox())!;
      expect(source.y + source.height).toBeLessThanOrEqual(height);
    }
  });
}

test('touch layout: tapping an object hides it, with no highlight or tooltip left behind', async ({ page }, info) => {
  test.skip(!info.project.use.hasTouch, 'needs a touch screen');
  await page.goto(`/#/scene/${ID}?speed=instant`);
  await page.locator('#rasterize').tap();
  await expect.poll(async () => (await current(page)).done, { timeout: 15_000 }).toBe(true);
  const loaf = await at(page, 80, 121);
  await page.touchscreen.tap(loaf.x, loaf.y);
  await expect.poll(async () => (await current(page)).hidden).toEqual(['loaf']);
  expect((await current(page)).lit).toBeNull();
  await expect(page.locator('#object-tip')).toBeHidden();
  await expect(page.locator('#stage')).not.toHaveClass(/picking/);
  // a key in the bar, tapped: hidden, nothing left lit
  await page.locator('#objects button[data-id="rug"]').tap();
  await expect.poll(async () => (await current(page)).hidden).toEqual(['loaf', 'rug']);
  expect((await current(page)).lit).toBeNull();
  expect((await current(page)).highlighted).toBeNull();
});
