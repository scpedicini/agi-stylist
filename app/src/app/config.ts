/**
 * The project's name, in the one place it's set: the page title and header (filled into index.html
 * by vite.config.ts) and the title screen's credits read it from here. The title screen's banner is
 * lettered in its picture, app/src/app/welcome/title.pic, so a new name means relettering that too.
 */
export const APP_NAME = 'Paint Quest';

/** Where the site is served. Link previews, the canonical link and the sitemap need absolute URLs. */
export const SITE_URL = 'https://kq-styles.specr.net/';

/** The source code on GitHub, linked from the page footer. */
export const REPO_URL = 'https://github.com/scpedicini/agi-stylist';

/** The X (Twitter) account credited on link previews there (twitter:site and twitter:creator). */
export const X_HANDLE = '@wunderbaba';

/**
 * One or two sentences for search results and link previews (the description, Open Graph and X
 * tags). Run through the humanizer skill.
 */
export const APP_DESCRIPTION =
  "Watch King's Quest-style pictures paint one line and one flood fill at a time, in 16 EGA colours. Each scene is a short drawing program you can read and edit.";

/**
 * Scene groups (folders under scenes/) kept out of the gallery, the picker, ←/→ and the scene count.
 * Their scenes still open from a direct link, e.g. #/scene/handmade/lakeside.
 */
export const HIDDEN_GROUPS: readonly string[] = ['examples', 'handmade'];

/** Show each scene's estimated size as an AGI picture ("~7191 AGI bytes") in the line under it. */
export const SHOW_AGI_BYTES = false;
