import { promises as fs } from "node:fs";
import path from "node:path";
import { type Layout, layoutSchema } from "@humanharness/mod-sdk";
import type { LayoutView } from "@humanharness/protocol";
import defaultLayout from "./default-layout.json";

/** The layout files, in the order they win (minimal-core spec §5.2): the harness's, then the core's. */
const ORDER = [
  { source: "harness", rel: path.join("harness", "layouts", "main.json") },
  { source: "core", rel: path.join("core", "layouts", "main.json") },
] as const;

/** The core's default layout as built into the app: used when no file in the home folder parses. */
export const builtInLayout = (): Layout => layoutSchema.parse(defaultLayout);

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
  return { problems: r.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)) };
}

/**
 * The layout the screen shows: `harness/layouts/main.json`, else `core/layouts/main.json`, else the built-in copy. A
 * file that doesn't parse gets `<file>.error` beside it (why, one line per problem) and the next one is used; a valid
 * file deletes its stale `.error`. `problems` are those of the files passed over.
 */
export async function shownLayout(home: string): Promise<LayoutView> {
  const problems: string[] = [];
  for (const { source, rel } of ORDER) {
    const file = path.join(home, rel);
    const r = await readLayout(file);
    if (r === null) continue;
    if ("layout" in r) {
      await fs.rm(`${file}.error`, { force: true });
      return { layout: r.layout, source, problems };
    }
    await fs.writeFile(`${file}.error`, `${r.problems.join("\n")}\n`).catch((err: unknown) => console.error(`Could not write ${file}.error`, err));
    problems.push(...r.problems);
  }
  return { layout: builtInLayout(), source: "core", problems };
}
