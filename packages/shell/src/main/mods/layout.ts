import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { type Layout, layoutSchema } from "@humanharness/mod-sdk";
import type { LayoutSource, LayoutView } from "@humanharness/protocol";
import defaultLayout from "./default-layout.json";

/** The folder of each layer's layouts, under the home folder: the person's, the harness's, the core's. */
const LAYER_DIRS: Record<LayoutSource, string> = { user: "layouts", harness: path.join("harness", "layouts"), core: path.join("core", "layouts") };
/** The home folder's own settings (0b2): today only the picked layout. */
export const SETTINGS_FILE = "settings.json";
/** A layout name is a plain file name: no folders, no dots in front. */
export const LAYOUT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** `settings.json`: `{ "layout"?: string }`; keys the app doesn't know are kept as they are. */
export const homeSettingsSchema = z.object({ layout: z.string().regex(LAYOUT_NAME).optional() }).passthrough();
export type HomeSettings = z.infer<typeof homeSettingsSchema>;

/** The core's default layout as built into the app: used when no file in the home folder parses. */
export const builtInLayout = (): Layout => layoutSchema.parse(defaultLayout);

const layoutFile = (home: string, source: LayoutSource, name: string) => path.join(home, LAYER_DIRS[source], `${name}.json`);
const issues = (e: z.ZodError) => e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));

/** Reads and checks one layout file: the layout, `null` when the file isn't there, or its problems (one per line). */
async function readLayout(file: string): Promise<{ layout: Layout } | { problems: string[] } | null> {
  const text = await fs.readFile(file, "utf8").catch(() => null);
  if (text === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { problems: [`Not valid JSON: ${(err as Error).message}`] };
  }
  const r = layoutSchema.safeParse(json);
  if (r.success) return { layout: r.data };
  return { problems: issues(r.error) };
}

/** The home folder's `settings.json`: its raw object (to keep unknown keys) and, when it parses, the settings. */
async function readSettings(home: string): Promise<{ raw: Record<string, unknown>; settings: HomeSettings; problem?: string }> {
  const text = await fs.readFile(path.join(home, SETTINGS_FILE), "utf8").catch(() => null);
  if (text === null) return { raw: {}, settings: {} };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { raw: {}, settings: {}, problem: `${SETTINGS_FILE}: not valid JSON: ${(err as Error).message}` };
  }
  const raw = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const r = homeSettingsSchema.safeParse(json);
  if (r.success) return { raw, settings: r.data };
  return { raw, settings: {}, problem: `${SETTINGS_FILE}: ${issues(r.error).join("; ")}` };
}

/** Every `*.json` layout in the three layers: the person's first, each layer by name; the core's `main` always. */
async function layoutChoices(home: string): Promise<LayoutView["choices"]> {
  const out: LayoutView["choices"] = [];
  for (const source of ["user", "harness", "core"] as const) {
    const entries = await fs.readdir(path.join(home, LAYER_DIRS[source]), { withFileTypes: true }).catch(() => []);
    const names = entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name.slice(0, -".json".length)).filter((n) => LAYOUT_NAME.test(n));
    if (source === "core" && !names.includes("main")) names.push("main");
    for (const name of names.sort()) out.push({ name, source });
  }
  return out;
}

/**
 * The layout the screen shows: the one picked in `settings.json` (`layouts/<name>.json`, then
 * `harness/layouts/<name>.json`), else `harness/layouts/main.json`, else `core/layouts/main.json`, else the built-in
 * copy. A file that doesn't parse gets `<file>.error` beside it (why, one line per problem) and the next one is used;
 * a valid file deletes its stale `.error`. `problems` are those of the files passed over (and of a pick not found), each led by its path in the home folder.
 */
export async function shownLayout(home: string): Promise<LayoutView> {
  const { settings, problem } = await readSettings(home);
  const problems: string[] = problem ? [problem] : [];
  const picked = settings.layout;
  const order: { source: LayoutSource; name: string }[] = [];
  if (picked !== undefined) order.push({ source: "user", name: picked }, { source: "harness", name: picked });
  order.push({ source: "harness", name: "main" }, { source: "core", name: "main" });
  const choices = await layoutChoices(home);
  const view = (layout: Layout, source: LayoutSource, name: string): LayoutView => ({ layout, source, name, ...(picked !== undefined ? { picked } : {}), choices, problems });
  const seen = new Set<string>();
  let pickFound = false;
  for (const [i, { source, name }] of order.entries()) {
    // The pick's two files are tried; when neither is there, that is said before falling back.
    if (picked !== undefined && i === 2 && !pickFound) problems.push(`layouts/${picked}.json: not there, nor in harness/layouts/`);
    const file = layoutFile(home, source, name);
    if (seen.has(file)) continue;
    seen.add(file);
    const r = await readLayout(file);
    if (r === null) continue;
    if (i < 2) pickFound = true;
    if ("layout" in r) {
      await fs.rm(`${file}.error`, { force: true });
      return view(r.layout, source, name);
    }
    await fs.writeFile(`${file}.error`, `${r.problems.join("\n")}\n`).catch((err: unknown) => console.error(`Could not write ${file}.error`, err));
    // In the view each line names its file (the `.error` beside it says only why).
    const rel = path.relative(home, file).split(path.sep).join("/");
    problems.push(...r.problems.map((p) => `${rel}: ${p}`));
  }
  return view(builtInLayout(), "core", "main");
}

/** Writes a file through a temp file and a rename, so a reader (the watcher) never sees half of it. */
async function writeAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, text);
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/** Picks a layout by name in `settings.json` (null removes the key; other keys stay) and answers the new view. */
export async function pickLayout(home: string, name: string | null): Promise<LayoutView> {
  if (name !== null && (typeof name !== "string" || !LAYOUT_NAME.test(name))) throw new Error("Invalid layout name");
  const { raw } = await readSettings(home);
  const next: Record<string, unknown> = { ...raw };
  if (name === null) delete next.layout;
  else next.layout = name;
  await writeAtomic(path.join(home, SETTINGS_FILE), `${JSON.stringify(next, null, 2)}\n`);
  return shownLayout(home);
}
