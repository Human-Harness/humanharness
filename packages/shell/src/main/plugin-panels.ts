import { PLUGIN_ID } from "@humanharness/harness-sdk";
import { readPluginFile, resolvePluginFile } from "./plugin-protocol";

/**
 * Plugin panels in the app window (plugins spec §5; threat model P1–P3, P7): which hh-plugin: files the app window's
 * session serves, which requests a plugin frame may make, and where a subframe may navigate. Pure functions over
 * plain inputs: `plugin-host.ts` only plugs them into Electron. A panel is plugin code, as hostile as a backend.
 */

/** Sent as a header on every panel response (P2). No 'unsafe-inline' (spike P-S7). */
export const PANEL_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'";

/** What the app window may know of a running plugin: its dist folder and its declared panel ids. */
export type RunningPanels = (id: string) => { dist: string; panels: readonly string[] } | null;

const PANEL_FILE = /^panel-([a-z][a-z0-9_-]{0,39})\.(html|js|css)$/;
const PANEL_PAGE = /^panel-[a-z][a-z0-9_-]{0,39}\.html$/;
const ASSET = /^assets\/[A-Za-z0-9_-]{1,64}\.(svg|png)$/;
/** Where nothing is: `_hh/` names the core's files, which the app window never serves. */
const NO_CORE = "/nonexistent";

/**
 * `url` split into a valid plugin id and its path as written (no leading `/`, no query or fragment), or null when it
 * isn't an hh-plugin: URL with nothing but scheme, host and path. As written, not as `new URL` normalized it: a
 * `x/../panel-a.html` must not pass as `panel-a.html`.
 */
function pluginUrl(url: string | undefined): { id: string; path: string } | null {
  if (typeof url !== "string") return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "hh-plugin:" || u.username !== "" || u.password !== "" || u.port !== "" || !PLUGIN_ID.test(u.hostname)) return null;
  const prefix = `hh-plugin://${u.hostname}/`;
  if (!url.startsWith(prefix)) return null;
  return { id: u.hostname, path: url.slice(prefix.length).split(/[?#]/, 1)[0] ?? "" };
}

/**
 * A panel file for the app window's session (P7): only `panel-<declared>.{html,js,css}` and `assets/*.{svg,png}` of a
 * running plugin. Part 1's resolver then applies every path rule (B3); never `backend.js`, `plugin.json` or `_hh/`.
 */
export async function resolvePanelFile(url: string, running: RunningPanels): Promise<{ file: string; type: string } | null> {
  const p = pluginUrl(url);
  if (!p) return null;
  const plugin = running(p.id);
  if (!plugin) return null;
  const m = PANEL_FILE.exec(p.path);
  if (!(m && plugin.panels.includes(m[1]!)) && !ASSET.test(p.path)) return null;
  return resolvePluginFile(url, { id: p.id, dist: plugin.dist, core: NO_CORE });
}

/** The bytes of a panel file (resolvePanelFile), read the way part 1 reads any plugin file (no links, size cap). */
export async function readPanelFile(url: string, running: RunningPanels): Promise<{ body: Buffer; type: string } | null> {
  const p = pluginUrl(url);
  const plugin = p && running(p.id);
  if (!p || !plugin || !(await resolvePanelFile(url, running))) return null;
  return readPluginFile(url, { id: p.id, dist: plugin.dist, core: NO_CORE });
}

/** Deeper than any real page nests: a chain that doesn't end by then is not trusted. */
const MAX_FRAME_DEPTH = 32;
/** Ends a chain that went deeper: it reads as a plugin's frame that may load nothing (a panel can nest blank frames). */
const TOO_DEEP = "hh-plugin:";

/**
 * A frame's URL followed by each ancestor's, from Electron's `details.frame` (spike P-S3): `[]` with no frame, null
 * when a frame can't be read (a disposed frame throws). A chain that doesn't end by `MAX_FRAME_DEPTH` ends in a marker
 * that refuses every request (Task 7 review: a panel could nest 33 blank frames to drop out of the filter).
 */
export function frameChain(frame: { readonly url: string; readonly parent: unknown } | null | undefined): string[] | null {
  const out: string[] = [];
  try {
    let f = frame as { readonly url: string; readonly parent: unknown } | null | undefined;
    while (f) {
      if (out.length >= MAX_FRAME_DEPTH) return [...out, TOO_DEEP];
      out.push(String(f.url));
      f = f.parent as typeof f;
    }
  } catch {
    return null;
  }
  return out;
}

/**
 * The app window's request filter (P2). A request is a plugin's when its frame or any ancestor is on `hh-plugin://<id>/`
 * (a frame a panel nests reads `""` on its first load; spike P-S3). Such a request may load only that plugin's own
 * hh-plugin: files, and a `subFrame` only its panel page; two plugins in one chain may load nothing. A frame that
 * can't be read (`frames` null) may not load a plugin file; anything else is left to the app's own CSP.
 */
export function allowPanelRequest(r: { frames: readonly string[] | null; resourceType: string; url: string }): boolean {
  const target = pluginUrl(r.url);
  if (r.frames === null || r.frames.length === 0) return target === null && !r.url.toLowerCase().startsWith("hh-plugin:");
  const from = new Set<string>();
  for (const f of r.frames) {
    if (f.toLowerCase().startsWith("hh-plugin:")) from.add(pluginUrl(f)?.id ?? "");
  }
  if (from.size === 0) return true;
  if (from.size > 1 || !target || !from.has(target.id)) return false;
  return r.resourceType !== "subFrame" || PANEL_PAGE.test(target.path);
}

/**
 * Subframe navigation in the app window (P3). A main-frame navigation is the app's own rule (`will-navigate`). A
 * subframe may go only to a panel page: its own page again (same plugin and panel, any query), or a first load
 * (`""` or `about:blank`) framed by the app's main frame itself, never by a panel. An error page left by a refused
 * navigation is neither: the renderer remounts the iframe instead.
 */
export function allowFrameNavigation(n: { isMainFrame: boolean; parentIsMain: boolean; frameUrl: string; url: string }): boolean {
  if (n.isMainFrame) return true;
  const to = pluginUrl(n.url);
  if (!to || !PANEL_PAGE.test(to.path)) return false;
  if (n.frameUrl === "" || n.frameUrl === "about:blank") return n.parentIsMain;
  const from = pluginUrl(n.frameUrl);
  return from !== null && from.id === to.id && from.path === to.path;
}
