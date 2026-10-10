import { estimateAgiBytes, execute } from '../engine/execute.ts';
import { Framebuffer, PIC_HEIGHT, PIC_WIDTH } from '../engine/framebuffer.ts';
import type { Op } from '../engine/ops.ts';
import { rgbToIndex } from '../engine/palette.ts';
import { compileProgram, declaredVariants, formatDiagnostic, parse, PicError, type CompileResult } from '../lang/index.ts';
import { SHOW_AGI_BYTES } from './config.ts';
import { LISTED, SCENES, stdlibProgram, type SceneEntry } from './scenes.ts';
import { Stage } from './sketch.ts';
import { openWelcome, welcomeSeen } from './welcome/welcome.ts';

type Speed = 'paint' | 'fast' | 'instant';
const SPEEDS: Record<Speed, number> = { paint: 1, fast: 8, instant: Infinity };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const state = {
  index: 0,
  variant: undefined as string | undefined,
  /** The variant last picked for the session; carried to every scene that declares it. */
  preferredVariant: undefined as string | undefined,
  speed: 'paint' as Speed,
  compare: false,
  /** Playback paused by the user (or by stepping). Cleared when a scene loads. */
  paused: false,
  /** A scene with an original picture waits, showing it, until the user rasterizes it. */
  awaitingRasterize: false,
  /** Whether the original has loaded (or failed to), so rasterizing can start. */
  originalReady: false,
  editing: false,
  result: undefined as CompileResult | undefined,
  ops: [] as Op[],
  finalHash: '',
  overrides: new Map<string, string>(),
};

// drawn at the screen's own 320×168 and scaled up by CSS to whatever size the stage is
const stage = new Stage($('stage'), {
  scale: 1,
  onProgress: (i, n, last) => {
    document.body.dataset.ready = String(i >= n);
    $('progress').textContent = n ? `${i}/${n} ops` : '';
    highlight(last);
    renderTransport();
  },
});

// ---------------------------------------------------------------------------
// helpers

/** Declared variants per scene id, filled as scenes are parsed (thumbnails parse them all). */
const variantCache = new Map<string, string[]>();

function parseScene(scene: SceneEntry) {
  const program = parse(state.overrides.get(scene.id) ?? scene.source, scene.path);
  variantCache.set(scene.id, declaredVariants(program));
  return program;
}

function compileScene(scene: SceneEntry, variant?: string): CompileResult {
  return compileProgram(parseScene(scene), { variant, prelude: stdlibProgram() });
}

/** The session's preferred variant, if `scene` declares it; otherwise the scene's default. */
function variantFor(scene: SceneEntry): string | undefined {
  const pref = state.preferredVariant;
  if (!pref) return undefined;
  if (!variantCache.has(scene.id)) {
    try {
      parseScene(scene);
    } catch {
      variantCache.set(scene.id, []);
    }
  }
  return variantCache.get(scene.id)!.includes(pref) ? pref : undefined;
}

function drawFramebuffer(canvas: HTMLCanvasElement, fb: Framebuffer, mask?: Uint8Array) {
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(framebufferCanvas(fb, mask), 0, 0, canvas.width, canvas.height);
}

/** The framebuffer as a 160×168 canvas, `mask`ed pixels in magenta. */
function framebufferCanvas(fb: Framebuffer, mask?: Uint8Array): HTMLCanvasElement {
  const off = document.createElement('canvas');
  off.width = PIC_WIDTH;
  off.height = PIC_HEIGHT;
  const octx = off.getContext('2d')!;
  const img = octx.createImageData(PIC_WIDTH, PIC_HEIGHT);
  fb.toRGBA(img.data);
  if (mask) {
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      img.data.set([255, 0, 255, 255], i * 4);
    }
  }
  octx.putImageData(img, 0, 0);
  return off;
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();
function loadImage(url: string): Promise<HTMLImageElement> {
  let p = imageCache.get(url);
  if (!p) {
    const img = new Image();
    img.src = url;
    p = img.decode().then(() => img);
    p.catch(() => imageCache.delete(url)); // let a later try fetch it again
    imageCache.set(url, p);
  }
  return p;
}

const referenceCache = new Map<string, Promise<Framebuffer>>();
function loadReference(url: string): Promise<Framebuffer> {
  let p = referenceCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = PIC_WIDTH;
        c.height = PIC_HEIGHT;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, PIC_WIDTH, PIC_HEIGHT).data;
        const fb = new Framebuffer();
        for (let i = 0; i < fb.pixels.length; i++) {
          const idx = rgbToIndex(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
          fb.pixels[i] = idx < 0 ? 0 : idx;
        }
        resolve(fb);
      };
      img.onerror = () => reject(new Error(`could not load ${url}`));
      img.src = url;
    });
    referenceCache.set(url, p);
  }
  return p;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// rendering the current scene

let currentLine = -1;
function highlight(op: Op | undefined) {
  const scene = SCENES[state.index];
  const line = op?.src && op.src.file === scene.path ? op.src.line : -1;
  if (line === currentLine) return;
  $('source').querySelector('.ln.current')?.classList.remove('current');
  currentLine = line;
  if (line < 0) return;
  const el = $('source').querySelector<HTMLElement>(`.ln[data-n="${line}"]`);
  if (!el) return;
  el.classList.add('current');
  const pre = $('source');
  if (el.offsetTop < pre.scrollTop || el.offsetTop > pre.scrollTop + pre.clientHeight - 20) {
    pre.scrollTop = el.offsetTop - pre.clientHeight / 3;
  }
}

function renderSource(source: string) {
  $('source').innerHTML = source
    .split('\n')
    .map((l, i) => `<span class="ln" data-n="${i + 1}">${escapeHtml(l) || ' '}</span>`)
    .join('');
  currentLine = -1;
}

function showMessages(errors: string[], warnings: string[], logs: string[]) {
  const box = $('messages');
  // it scrolls when long, so keyboard users need to be able to reach it
  if (errors.length + warnings.length + logs.length) box.tabIndex = 0;
  else box.removeAttribute('tabindex');
  box.innerHTML = [
    ...errors.map((e) => `<div class="error">✖ ${escapeHtml(e)}</div>`),
    ...warnings.map((w) => `<div class="warning">⚠ ${escapeHtml(w)}</div>`),
    ...logs.map((l) => `<div>› ${escapeHtml(l)}</div>`),
  ].join('');
}

function renderVariants(variants: string[]) {
  const box = $('variants');
  box.innerHTML = '';
  if (variants.length < 2) return;
  for (const v of variants) {
    const b = document.createElement('button');
    b.textContent = v;
    b.dataset.variant = v;
    b.setAttribute('aria-pressed', String(v === state.result?.variant));
    b.onclick = () => {
      state.preferredVariant = v;
      navigate(state.index, v);
    };
    box.append(b);
  }
}

/** The diff caption is kept to one line (so it can't re-wrap); a tooltip has the whole of it. */
function setScore(text: string) {
  $('cmp-score').textContent = $('cmp-score').title = text;
}

async function renderCompare() {
  const scene = SCENES[state.index];
  $('compare').hidden = !state.compare;
  delete $('cmp-score').dataset.match;
  if (!state.compare) return;
  const rendered = execute(state.ops);
  drawFramebuffer($<HTMLCanvasElement>('cmp-rendered'), rendered);
  const origCanvas = $<HTMLCanvasElement>('cmp-original');
  const diffCanvas = $<HTMLCanvasElement>('cmp-diff');
  if (!scene.referenceUrl) {
    origCanvas.getContext('2d')!.clearRect(0, 0, origCanvas.width, origCanvas.height);
    diffCanvas.getContext('2d')!.clearRect(0, 0, diffCanvas.width, diffCanvas.height);
    $('cmp-score').dataset.match = 'none';
    if (!scene.originalUrl) return setScore('no reference picture');
    // Translated by eye from a full-colour picture or composed from a sketch, so a pixel score means
    // nothing: show the original, and the painting laid over it at half strength.
    setScore('overlay');
    const img = await loadImage(scene.originalUrl).catch(() => undefined);
    if (SCENES[state.index] !== scene || !state.compare) return;
    if (!img) return setScore("couldn't load the original");
    for (const c of [origCanvas, diffCanvas]) {
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, 0, 0, c.width, c.height);
    }
    const ctx = diffCanvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.5;
    ctx.drawImage(framebufferCanvas(rendered), 0, 0, diffCanvas.width, diffCanvas.height);
    ctx.globalAlpha = 1;
    setScore('overlay: the painting on its original');
    return;
  }
  const ref = await loadReference(scene.referenceUrl);
  if (SCENES[state.index] !== scene) return;
  drawFramebuffer(origCanvas, ref);
  const mask = new Uint8Array(ref.pixels.length);
  let diff = 0;
  for (let i = 0; i < mask.length; i++) if (ref.pixels[i] !== rendered.pixels[i]) (mask[i] = 1), diff++;
  drawFramebuffer(diffCanvas, rendered, mask);
  const match = (100 * (mask.length - diff)) / mask.length;
  setScore(`${match.toFixed(2)}% match · ${diff} px differ`);
  $('cmp-score').dataset.match = match.toFixed(2);
}

function loadScene() {
  const scene = SCENES[state.index];
  const edited = state.overrides.has(scene.id);
  const source = state.overrides.get(scene.id) ?? scene.source;
  $<HTMLSelectElement>('scene-select').value = scene.id;
  $('source-path').textContent = scene.path + (edited ? ' (edited)' : '');
  renderSource(source);
  if (state.editing) $<HTMLTextAreaElement>('editor').value = source;

  let errors: string[] = [];
  try {
    state.result = compileScene(scene, state.variant);
    state.ops = state.result.ops;
  } catch (e) {
    if (!(e instanceof PicError)) throw e;
    errors = [e.message];
    state.result = undefined;
    state.ops = [];
    const el = $('source').querySelector<HTMLElement>(`.ln[data-n="${e.loc.line}"]`);
    el?.classList.add('current');
  }
  const r = state.result;
  $('title').textContent = r?.title ?? scene.name;
  const listed = LISTED.indexOf(state.index);
  $('where').textContent = listed >= 0 ? `Scene ${listed + 1} of ${LISTED.length}` : 'Unlisted scene';
  // (the op count is in #progress already)
  $('stats').textContent = r && SHOW_AGI_BYTES ? `~${estimateAgiBytes(r.ops)} AGI bytes` : '';
  showMessages(errors, r?.warnings.map(formatDiagnostic) ?? [], r?.logs ?? []);
  renderVariants(r?.variants ?? []);
  state.finalHash = execute(state.ops).hash();
  document.body.dataset.scene = scene.id;
  document.body.dataset.variant = r?.variant ?? '';
  document.body.dataset.error = String(errors.length > 0);

  stage.opsPerFrame = SPEEDS[state.speed];
  state.paused = false;
  state.awaitingRasterize = !!scene.originalUrl && state.ops.length > 0;
  stage.overlay = !!scene.originalUrl;
  // a layout sketch is a drawing, so it's scaled smoothly; Myst's and KQ6's screens stay pixelated
  $('original').classList.toggle('smooth', scene.group === 'sketches');
  showOriginal(scene.originalUrl);
  $('rasterize').hidden = !state.awaitingRasterize;
  setPaused(false);
  stage.load(state.ops);
  if (stage.delaysIgnored) {
    $('messages').insertAdjacentHTML('beforeend', `<div class="warning">⚠ too much to hold back for delay blocks: this scene plays in script order</div>`);
    $('messages').tabIndex = 0;
  }
  document.querySelectorAll('#gallery a').forEach((a) => a.classList.toggle('active', (a as HTMLElement).dataset.id === scene.id));
  void renderCompare();
}

// ---------------------------------------------------------------------------
// navigation (hash routes: #/scene/<id>?variant=night&speed=instant)

function routeFor(index: number, variant?: string) {
  const params = new URLSearchParams();
  if (variant) params.set('variant', variant);
  if (state.speed !== 'paint') params.set('speed', state.speed);
  if (state.compare) params.set('compare', '1');
  const q = params.toString();
  return `#/scene/${SCENES[index].id}${q ? `?${q}` : ''}`;
}

function navigate(i: number, variant?: string) {
  const target = routeFor(i, variant ?? variantFor(SCENES[i]));
  if (location.hash === target) applyRoute();
  else location.hash = target;
}

/** Go `delta` listed scenes along (wrapping); from an unlisted scene, to its listed neighbours. */
function moveBy(delta: 1 | -1) {
  let pos = LISTED.indexOf(state.index);
  if (pos < 0) {
    const after = LISTED.findIndex((i) => i > state.index);
    pos = (after < 0 ? LISTED.length : after) - (delta > 0 ? 1 : 0);
  }
  navigate(LISTED[(pos + delta + LISTED.length) % LISTED.length]);
}

function applyRoute() {
  const m = /^#\/scene\/([^?]+)(?:\?(.*))?$/.exec(location.hash);
  const params = new URLSearchParams(m?.[2] ?? '');
  const idx = m ? SCENES.findIndex((s) => s.id === decodeURIComponent(m[1])) : -1;
  state.index = idx >= 0 ? idx : LISTED[0];
  // The URL fully determines the view: absent or invalid parameters mean defaults.
  state.variant = params.get('variant') ?? undefined;
  if (state.variant) state.preferredVariant = state.variant;
  const speed = params.get('speed');
  state.speed = speed && speed in SPEEDS ? (speed as Speed) : 'paint';
  state.compare = params.get('compare') === '1';
  $<HTMLInputElement>('compare-toggle').checked = $<HTMLInputElement>('compare-toggle-status').checked = state.compare;
  renderSpeeds();
  loadScene();
  // there used to be a "step" speed: such a link opens paused at the start, ready for +1
  if (speed === 'step') {
    setPaused(true);
    history.replaceState(null, '', routeFor(state.index, state.variant));
  }
}

/** The speed buttons are in the page from the start (so the toolbar never re-wraps); this marks the current one. */
function renderSpeeds() {
  for (const b of $('speeds').querySelectorAll<HTMLButtonElement>('button[data-speed]')) {
    b.setAttribute('aria-pressed', String(b.dataset.speed === state.speed));
  }
  $<HTMLSelectElement>('speed-select').value = state.speed;
}

function setSpeed(s: Speed) {
  state.speed = s;
  history.replaceState(null, '', routeFor(state.index, state.variant));
  renderSpeeds();
  // only how fast it plays: where it is, and whether it's paused, stay as they are
  stage.opsPerFrame = SPEEDS[s];
}

function setPaused(paused: boolean) {
  state.paused = paused;
  stage.paused = paused || state.awaitingRasterize;
  renderTransport();
}

/** Show `url` under the stage; rasterizing is held back until it has loaded (or failed to). */
function showOriginal(url: string | undefined) {
  const img = $<HTMLImageElement>('original');
  const button = $<HTMLButtonElement>('rasterize');
  img.hidden = !url;
  state.originalReady = !url;
  if (!url) return;
  img.classList.add('loading'); // don't show the previous scene's original meanwhile
  button.disabled = true;
  img.src = url;
  const settle = (loaded: boolean) => {
    if (img.src !== new URL(url, location.href).href) return; // superseded by another scene
    img.classList.remove('loading');
    state.originalReady = true;
    button.disabled = false;
    if (!loaded) {
      $('messages').insertAdjacentHTML('beforeend', `<div class="warning">⚠ couldn't load the original picture</div>`);
      $('messages').tabIndex = 0;
    }
  };
  img.decode().then(() => settle(true), () => settle(false));
}

/** Leave the original on show and start painting over it: playing, or `paused` one op at a time. */
function rasterize(paused: boolean): boolean {
  if (!state.originalReady) return false;
  const hadFocus = document.activeElement === $('rasterize');
  state.awaitingRasterize = false;
  $('rasterize').hidden = true;
  if (hadFocus) $('stage').focus({ preventScroll: true });
  setPaused(paused);
  return true;
}

/**
 * The transport: the play button shows ▌▐ while painting and ► when paused or finished, and the
 * buttons that would do nothing just now (back at the start, forward at the end) are greyed out.
 * They stay focusable (aria-disabled, not disabled), so the keyboard focus isn't lost.
 */
function renderTransport() {
  const b = $('pause');
  const label = stage.done ? 'Replay' : stage.paused ? 'Play' : 'Pause';
  if (b.dataset.state !== label) {
    b.dataset.state = label;
    b.textContent = label === 'Pause' ? '▌▐' : '►'; // (both in the PC's own character set)
    b.title = `${label} (p / space)`;
    b.setAttribute('aria-label', label);
  }
  const atStart = state.awaitingRasterize || stage.position === 0;
  const empty = state.ops.length === 0;
  const off: Record<string, boolean> = { start: atStart, back: atStart, step: empty, end: empty || (stage.done && !state.awaitingRasterize) };
  for (const [id, disabled] of Object.entries(off)) {
    const el = $(id);
    if (el.getAttribute('aria-disabled') !== String(disabled)) el.setAttribute('aria-disabled', String(disabled));
  }
}

function togglePause() {
  if (state.awaitingRasterize) rasterize(false);
  else if (!stage.paused && !stage.done) setPaused(true);
  else {
    setPaused(false);
    if (stage.done) stage.restart();
  }
}

/** Paint the scene again from the start (r); on an original still waiting, start painting over it. */
function restart() {
  if (state.awaitingRasterize) return void rasterize(false);
  setPaused(false);
  stage.restart();
}

// The transport buttons below do nothing while greyed out (see renderTransport). Waiting on an
// original, +1 and skip-to-the-end start painting over it, paused, as Play does playing.

/** Back to the start, paused, with nothing painted (an original shows whole again): ready for +1 or Play. */
function toStart() {
  if (state.awaitingRasterize || stage.position === 0) return;
  setPaused(true);
  stage.restart();
}

/** One instruction back, paused (partway through one, back to its start). */
function back() {
  if (state.awaitingRasterize || stage.position === 0) return;
  setPaused(true);
  stage.backInstruction();
}

/**
 * One more instruction (a whole statement: a rect, a tree…, or the rest of the one under way),
 * paused; a finished scene starts again.
 */
function step() {
  if (state.ops.length === 0) return;
  if (state.awaitingRasterize && !rasterize(true)) return;
  setPaused(true);
  if (stage.done) stage.restart();
  stage.stepInstruction();
}

/** Show the finished picture now, whatever the speed. */
function toEnd() {
  if (state.ops.length === 0 || (stage.done && !state.awaitingRasterize)) return;
  if (state.awaitingRasterize && !rasterize(true)) return;
  setPaused(true);
  stage.finish();
}

// ---------------------------------------------------------------------------
// gallery

function buildGallery() {
  const gallery = $('gallery');
  const select = $<HTMLSelectElement>('scene-select');
  const labels: Record<string, string> = {
    custom: 'Custom scenes',
    examples: 'Examples',
    handmade: 'Recreations - hand-authored (some tracer-assisted)',
    sketches: 'Layout sketches: each opens on its sketch',
    myst: 'Myst: each opens on its original render',
    kq6: "King's Quest VI: each opens on its VGA original",
    kq1: "King's Quest I - auto-traced",
  };
  let group = '';
  let optgroup: HTMLOptGroupElement | undefined;
  const pending: Array<[SceneEntry, HTMLCanvasElement]> = [];
  for (const i of LISTED) {
    const scene = SCENES[i];
    if (scene.group !== group) {
      group = scene.group;
      const h = document.createElement('h2');
      h.textContent = labels[group] ?? group;
      gallery.append(h);
      optgroup = document.createElement('optgroup');
      optgroup.label = labels[group] ?? group;
      select.append(optgroup);
    }
    const opt = document.createElement('option');
    opt.value = scene.id;
    opt.textContent = scene.name;
    optgroup!.append(opt);

    const a = document.createElement('a');
    a.href = routeFor(i);
    a.dataset.id = scene.id;
    a.dataset.index = String(i);
    if (scene.originalThumbnail) {
      // scenes translated from a full-colour original show that original
      const img = document.createElement('img');
      img.src = scene.originalUrl!;
      img.alt = '';
      img.loading = 'lazy';
      a.append(img, scene.name);
    } else {
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = 84;
      a.append(c, scene.name);
      pending.push([scene, c]);
    }
    gallery.append(a);
  }
  // paint thumbnails in small batches so the page stays responsive
  const batch = () => {
    for (const [scene, canvas] of pending.splice(0, 8)) {
      try {
        drawFramebuffer(canvas, execute(compileScene(scene).ops));
      } catch {
        canvas.getContext('2d')!.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
    if (pending.length) setTimeout(batch, 0);
    else document.body.dataset.thumbnails = 'true';
  };
  setTimeout(batch, 0);
  // Links carry the session's speed, compare and variant settings. They're refreshed just before
  // use (hover, focus, press) so they also hold for middle-click and "open in new tab".
  const refresh = (e: Event) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[data-index]');
    if (a) a.href = routeFor(Number(a.dataset.index), variantFor(SCENES[Number(a.dataset.index)]));
  };
  for (const type of ['pointerover', 'pointerdown', 'focusin', 'click']) gallery.addEventListener(type, refresh);
  // picking a scene in this tab scrolls back up to the stage so it's in view
  gallery.addEventListener('click', (e) => {
    if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!(e.target as Element).closest('a[data-index]')) return;
    scrollToStage();
    // keyboard activation (detail 0): move focus along so the next Tab doesn't jump back down
    if (e.detail === 0) $('stage').focus({ preventScroll: true });
  });
}

/** Scroll to the top of the page, or as far as the toolbar if the whole stage wouldn't fit. */
function scrollToStage() {
  const viewerTop = document.querySelector('.viewer')!.getBoundingClientRect().top + scrollY;
  const stageBottom = $('stage').getBoundingClientRect().bottom + scrollY;
  const top = stageBottom <= innerHeight ? 0 : viewerTop - 8;
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top, behavior: smooth ? 'smooth' : 'instant' });
}

// ---------------------------------------------------------------------------
// wiring

function setEditing(on: boolean) {
  state.editing = on;
  $('source').hidden = on;
  $('editor').hidden = !on;
  $('run').hidden = !on;
  $('edit').textContent = on ? 'view' : 'edit';
  if (on) {
    const scene = SCENES[state.index];
    $<HTMLTextAreaElement>('editor').value = state.overrides.get(scene.id) ?? scene.source;
    $('editor').focus();
  }
}

function runEditor() {
  const scene = SCENES[state.index];
  const text = $<HTMLTextAreaElement>('editor').value;
  if (text === scene.source) state.overrides.delete(scene.id);
  else state.overrides.set(scene.id, text);
  variantCache.delete(scene.id);
  loadScene();
}

$('prev').onclick = () => moveBy(-1);
$('next').onclick = () => moveBy(1);
$<HTMLSelectElement>('scene-select').onchange = (e) => navigate(SCENES.findIndex((s) => s.id === (e.target as HTMLSelectElement).value));
for (const b of $('speeds').querySelectorAll<HTMLButtonElement>('button[data-speed]')) b.onclick = () => setSpeed(b.dataset.speed as Speed);
$<HTMLSelectElement>('speed-select').onchange = (e) => setSpeed((e.target as HTMLSelectElement).value as Speed);
$('pause').onclick = togglePause;
$('start').onclick = toStart;
$('back').onclick = back;
$('step').onclick = step;
$('end').onclick = toEnd;
$('rasterize').onclick = () => rasterize(false);
// the toolbar's compare box, and the one beside the title that phones show instead
for (const id of ['compare-toggle', 'compare-toggle-status']) {
  $<HTMLInputElement>(id).onchange = (e) => {
    state.compare = (e.target as HTMLInputElement).checked;
    $<HTMLInputElement>('compare-toggle').checked = $<HTMLInputElement>('compare-toggle-status').checked = state.compare;
    history.replaceState(null, '', routeFor(state.index, state.variant));
    void renderCompare();
  };
}
$('welcome-open').onclick = () => openWelcome(() => $('welcome-open').focus());
$('edit').onclick = () => setEditing(!state.editing);
$('run').onclick = runEditor;
$('editor').addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') runEditor();
});
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
  // Home and End scroll the page, unless the keyboard is on the picture or its controls
  const inViewer = !!t.closest?.('.viewer');
  if (e.key === 'ArrowLeft') moveBy(-1);
  else if (e.key === 'ArrowRight') moveBy(1);
  else if (e.key === 'r') restart();
  else if (e.key === 'p' || (e.key === ' ' && t.tagName !== 'BUTTON' && t.tagName !== 'A')) {
    e.preventDefault();
    togglePause();
  }
  else if (e.key === 's' || e.key === '.') step();
  else if (e.key === ',') back();
  else if (e.key === 'Home' && inViewer) {
    e.preventDefault();
    toStart();
  } else if (e.key === 'End' && inViewer) {
    e.preventDefault();
    toEnd();
  }
  else if (e.key === 'c') $('compare-toggle').click();
});
window.addEventListener('hashchange', applyRoute);

/** Test/debug hook used by the Playwright suite. */
declare global {
  interface Window {
    __kq: {
      scenes: string[];
      current(): { id: string; variant: string; done: boolean; paused: boolean; awaitingRasterize: boolean; position: number; opCount: number; hash: string; finalHash: string };
    };
  }
}
window.__kq = {
  scenes: LISTED.map((i) => SCENES[i].id),
  current: () => ({
    id: SCENES[state.index].id,
    variant: state.result?.variant ?? '',
    done: stage.done,
    paused: stage.paused,
    awaitingRasterize: state.awaitingRasterize,
    position: stage.position,
    opCount: state.ops.length,
    hash: stage.framebuffer.hash(),
    finalHash: state.finalHash,
  }),
};

buildGallery();
applyRoute();
$('boot-status').remove();
$('app').removeAttribute('aria-busy');
document.body.classList.remove('booting');
// first visit: the title screen, then on to the stage, painting its scene afresh now it's in view
if (!welcomeSeen()) {
  openWelcome(() => {
    $('stage').focus({ preventScroll: true });
    restart();
  });
}
