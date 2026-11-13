import { promises as fs } from "node:fs";
import path from "node:path";
import { MOD_ID } from "@humanharness/mod-sdk";
import type { ResolvedMod } from "./resolve";

/**
 * `hh-mod://<id>/ui.js`: a mod's built ui part, for the window (minimal-core 0b2). Registered before "ready"; no
 * bypassCSP. CORS-enabled: the window (file://) imports it as a module, a cross-origin request.
 */
export const MOD_SCHEME = { scheme: "hh-mod", privileges: { standard: true, secure: true, corsEnabled: true } } as const;

export interface SchemeMod {
  mod: ResolvedMod;
  on: boolean;
}

const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain", "cache-control": "no-store" } });

/**
 * Answers one `hh-mod` request: the built ui of mod `<id>` when it is on and not a core mod (the core's ui ships with
 * the window), from the user layer's build or else the mod folder's `ui` file. Anything else is 404.
 */
export async function serveModUi(url: string, d: { mod(id: string): SchemeMod | undefined; buildDir(id: string): string }): Promise<Response> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return notFound();
  }
  if (u.protocol !== `${MOD_SCHEME.scheme}:` || u.pathname !== "/ui.js" || u.username || u.port) return notFound();
  // The only query is the window's cache buster, `?v=<version>`: a new one makes it import the rebuilt ui again.
  const keys = [...u.searchParams.keys()];
  if (u.search && (keys.length !== 1 || keys[0] !== "v" || !u.searchParams.get("v"))) return notFound();
  const id = u.hostname;
  if (!MOD_ID.test(id)) return notFound();
  const m = d.mod(id);
  if (!m || !m.on || m.mod.shipped === "core" || m.mod.json.id !== id || m.mod.json.ui === undefined) return notFound();
  // `ui` is checked inside the folder by mod.json's schema; the user layer's build has a fixed name.
  const file = m.mod.user ? path.join(d.buildDir(id), "ui.js") : path.join(m.mod.dir, m.mod.json.ui);
  try {
    const body = await fs.readFile(file);
    return new Response(body, { status: 200, headers: { "content-type": "text/javascript", "cache-control": "no-store", "access-control-allow-origin": "*" } });
  } catch {
    return notFound();
  }
}
