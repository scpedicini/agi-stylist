// The production build fills the project's name, address and description (src/app/config.ts) into
// the page, with the search and link-preview tags, and ships the icons, previews, robots.txt and sitemap.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_DESCRIPTION, APP_NAME, REPO_URL, SITE_URL, X_HANDLE } from '../../src/app/config.ts';

describe('production build', () => {
  // a real build, written out, so the test sees what gets deployed (public/ files included)
  const out = mkdtempSync(join(tmpdir(), 'kq-build-'));
  let html: string;
  const asset = (name: string) => {
    expect(existsSync(join(out, name)), name).toBe(true);
    return readFileSync(join(out, name), 'utf8');
  };
  /** The content of `<meta property|name="key" content="…">`. */
  const meta = (key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1];

  beforeAll(async () => {
    await build({ logLevel: 'silent', build: { outDir: out, emptyOutDir: true } });
    html = asset('index.html');
  });
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it('writes the project name into index.html and leaves no placeholder', () => {
    expect(html).toContain(`<title>${APP_NAME}: `);
    expect(html).toContain(`<h1>${APP_NAME}</h1>`);
    expect(html).toContain(`<a href="${REPO_URL}"`);
    expect(html).not.toMatch(/%[A-Z_]+%/);
  });

  it('has the description, canonical link and structured data', () => {
    expect(SITE_URL).toMatch(/^https:\/\/.+\/$/);
    expect(meta('description')).toBe(APP_DESCRIPTION.replaceAll('"', '&quot;'));
    expect(APP_DESCRIPTION.length).toBeGreaterThanOrEqual(110);
    expect(APP_DESCRIPTION.length).toBeLessThanOrEqual(200); // X cuts descriptions at 200
    expect(html).toContain(`<link rel="canonical" href="${SITE_URL}" />`);
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]);
    expect(ld['@graph']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ '@type': 'WebSite', name: APP_NAME, url: SITE_URL }),
        expect.objectContaining({ '@type': 'WebApplication', name: APP_NAME, url: SITE_URL, description: APP_DESCRIPTION }),
      ]),
    );
  });

  it('has the Open Graph and X tags, with absolute, hash-versioned URLs to shipped images of the stated size', () => {
    for (const key of ['og:title', 'og:type', 'og:url', 'og:description', 'og:site_name', 'og:image:alt', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image:alt']) {
      expect(meta(key), key).toBeTruthy();
    }
    expect(meta('og:url')).toBe(SITE_URL);
    expect(meta('twitter:card')).toBe('summary_large_image');
    expect(X_HANDLE).toMatch(/^@\w+$/);
    expect(meta('twitter:site')).toBe(X_HANDLE);
    expect(meta('twitter:creator')).toBe(X_HANDLE);
    expect(meta('og:title')!.length).toBeLessThanOrEqual(70); // X's title limit
    const sizes: [string, number, number][] = [
      [meta('og:image')!, Number(meta('og:image:width')), Number(meta('og:image:height'))],
      [meta('twitter:image')!, 1200, 600], // X's large card is 2:1
    ];
    for (const [url, w, h] of sizes) {
      expect(url, url).toMatch(new RegExp(`^${SITE_URL.replaceAll('.', '\\.')}social/[\\w-]+\\.png\\?v=[0-9a-f]{10}$`));
      const file = join(out, new URL(url).pathname);
      const png = PNG.sync.read(readFileSync(file));
      expect([png.width, png.height], file).toEqual([w, h]);
      expect(readFileSync(file).length, file).toBeLessThan(5 * 1024 * 1024); // LinkedIn's cap
    }
    expect(meta('og:image:width')).toBe('1200');
    expect(meta('og:image:height')).toBe('630');
  });

  it('links icons that ship, at the sizes they claim', () => {
    const links = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="\/([^"]+)"/g)].map((m) => m[1]);
    expect(links).toEqual(['favicon.svg', 'favicon.ico', 'favicon-192x192.png', 'apple-touch-icon.png']);
    for (const href of links) expect(existsSync(join(out, href)), href).toBe(true);
    for (const [file, size] of [['favicon-192x192.png', 192], ['apple-touch-icon.png', 180]] as const) {
      const png = PNG.sync.read(readFileSync(join(out, file)));
      expect([png.width, png.height]).toEqual([size, size]);
    }
  });

  it('writes robots.txt and a sitemap that point at the site', () => {
    expect(asset('robots.txt')).toContain(`Sitemap: ${SITE_URL}sitemap.xml`);
    expect(asset('robots.txt')).not.toMatch(/Disallow: \/\s/);
    expect(asset('sitemap.xml')).toContain(`<loc>${SITE_URL}</loc>`);
  });
});
