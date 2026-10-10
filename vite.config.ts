/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { APP_DESCRIPTION, APP_NAME, REPO_URL, SITE_URL, X_HANDLE } from './src/app/config.ts';

const escapeHtml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/**
 * A link-preview image's absolute URL, with a hash of its bytes, so a regenerated image (`pnpm
 * social`) has a new URL and the platforms that cache previews by URL fetch it again.
 */
const previewUrl = (file: string) => `${SITE_URL}${file}?v=${createHash('sha256').update(readFileSync(`public/${file}`)).digest('hex').slice(0, 10)}`;
const OG_IMAGE = previewUrl('social/og-1200x630.png');
const X_IMAGE = previewUrl('social/x-1200x600.png');

/** Schema.org description of the site for search engines (JSON-LD; `<` escaped so it can't close the script). */
const jsonLd = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    // the site's name, for search results
    { '@type': 'WebSite', '@id': `${SITE_URL}#website`, name: APP_NAME, url: SITE_URL, description: APP_DESCRIPTION },
    {
      '@type': 'WebApplication',
      name: APP_NAME,
      url: SITE_URL,
      description: APP_DESCRIPTION,
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Any',
      image: OG_IMAGE,
      isPartOf: { '@id': `${SITE_URL}#website` },
    },
  ],
}).replaceAll('<', '\\u003c');

export default defineConfig({
  server: { port: 5250, strictPort: true },
  plugins: [
    {
      // index.html writes the name, address, description, repository and X account as %APP_NAME%,
      // %SITE_URL%, %APP_DESCRIPTION%, %REPO_URL% and %X_HANDLE% (all set in src/app/config.ts), %OG_IMAGE% and %X_IMAGE% for the
      // preview images' URLs, and %JSON_LD% for the structured data
      name: 'site-config',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) =>
          html.replaceAll('%APP_NAME%', escapeHtml(APP_NAME)).replaceAll('%SITE_URL%', SITE_URL).replaceAll('%APP_DESCRIPTION%', escapeHtml(APP_DESCRIPTION))
            .replaceAll('%REPO_URL%', escapeHtml(REPO_URL))
            .replaceAll('%X_HANDLE%', escapeHtml(X_HANDLE))
            .replaceAll('%OG_IMAGE%', OG_IMAGE)
            .replaceAll('%X_IMAGE%', X_IMAGE)
            .replaceAll('%JSON_LD%', jsonLd),
      },
      // robots.txt and sitemap.xml, built from SITE_URL (the app is one page; scenes are #/ routes)
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml\n` });
        this.emitFile({
          type: 'asset',
          fileName: 'sitemap.xml',
          source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE_URL}</loc></url>\n</urlset>\n`,
        });
      },
    },
  ],
  // every scene's PicScript source is bundled as text (≈1.3 MB for the 82 traced KQ1 scenes)
  build: { chunkSizeWarningLimit: 4000 },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/golden/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
