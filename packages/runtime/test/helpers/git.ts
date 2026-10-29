import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The slice of isomorphic-git the runtime tests read a history with. */
export interface GitRead {
  log(o: { fs: typeof fs; gitdir: string }): Promise<{ oid: string; commit: { message: string } }[]>;
  TREE(o: { ref: string }): unknown;
  walk(o: {
    fs: typeof fs;
    gitdir: string;
    trees: unknown[];
    map: (p: string, entries: ({ type(): Promise<string>; content(): Promise<Uint8Array | undefined> } | null)[]) => Promise<undefined>;
  }): Promise<unknown>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
// The runtime package doesn't depend on isomorphic-git: borrow the workspace package's copy, the one History writes with.
const gitEntry = createRequire(path.resolve(here, "../../../workspace/package.json")).resolve("isomorphic-git");
export const git = ((await import(pathToFileURL(gitEntry).href)) as { default: GitRead }).default;

/** Each commit's whole message (trimmed), oldest first. */
export async function messages(gitdir: string): Promise<string[]> {
  return (await git.log({ fs, gitdir })).map((e) => e.commit.message.trim()).reverse();
}

/** The tree of `oid` as path → content. */
export async function treeOf(gitdir: string, oid: string): Promise<Record<string, string>> {
  const tree: Record<string, string> = {};
  await git.walk({
    fs,
    gitdir,
    trees: [git.TREE({ ref: oid })],
    map: async (p, [t]) => {
      if (p !== "." && t && (await t.type()) === "blob") tree[p] = Buffer.from((await t.content()) ?? []).toString("utf8");
      return undefined;
    },
  });
  return tree;
}
