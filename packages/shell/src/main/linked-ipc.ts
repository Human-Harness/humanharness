import { createHmac, timingSafeEqual } from "node:crypto";
import { realpath } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { LINKED_MANY_MAX, type LinkedFolderDecl, hasLinkedFolders } from "@humanharness/harness-sdk";
import type { HatchesState, LinkRefusalView, LinkedView } from "@humanharness/ui/client";
import { type LinkedFolderEntry, type ScopeEntry, type ScopeStore, isScopeId } from "@humanharness/workspace";
import { checkLink, isGitRepo } from "./linked-folders";
import { linkedHistoryDir, markRelinked, markUnlinked } from "./linked-history";
import { sourceTagKey } from "./sidekick-import";

/** The longest linked-folder key the window may send (the manifest's pattern allows 64). */
const KEY_MAX = 64;
const PATH_MAX = 4096;
/** realpath(3): the case on disk on macOS, where `fs.realpath` keeps the case as given. */
const realpathNative = promisify(realpath.native);

/**
 * The links' tag key: its own file in the app's data folder (`userData`), never in the folder the agent works in; made
 * (as the Attention and Sidekick keys are) only when `create`. Only a harness with linked folders ever asks (D0).
 */
export const linkedSecret =
  (userData: string) =>
  (create: boolean): Promise<Buffer | null> =>
    sourceTagKey(path.join(userData, "linked-key"), create);

/**
 * The tag of a link: HMAC-SHA256 with the app's key over one unambiguous encoding of what the link grants (scope,
 * key, path, mode, tracked). `scopes.json` sits in the folder the agent can write, so only a tag proves the person
 * made the link through the picker (threat model L1).
 */
export function linkTag(scope: string, l: Pick<LinkedFolderEntry, "key" | "path" | "mode" | "tracked">, secret: Buffer): string {
  return createHmac("sha256", secret).update(JSON.stringify(["hh-link-v1", scope, l.key, l.path, l.mode, l.tracked])).digest("hex");
}

/** Whether `l` carries the tag the app made for it in scope `scope`. No key: nothing is valid. */
export function linkTagValid(l: LinkedFolderEntry, scope: string, secret: Buffer | null): boolean {
  if (!secret || typeof l.tag !== "string") return false;
  const want = Buffer.from(linkTag(scope, l, secret));
  const got = Buffer.from(l.tag);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The links of `s` the app signed; the rest (a hand-added or changed entry) never show and never count. */
export function signedLinks(s: ScopeEntry, secret: Buffer | null): LinkedFolderEntry[] {
  return (s.linked ?? []).filter((l) => linkTagValid(l, s.id, secret));
}

/** What the window gets of the hatches a harness declares; undefined without any (D0: AppState has no `hatches`). */
export function hatchesState(h: { linkedFolders?: Record<string, LinkedFolderDecl> }): HatchesState | undefined {
  if (!hasLinkedFolders(h)) return undefined;
  const linkedFolders: NonNullable<HatchesState["linkedFolders"]> = {};
  for (const [key, d] of Object.entries(h.linkedFolders ?? {})) linkedFolders[key] = { label: d.label, mode: d.mode, history: d.history, many: d.many };
  return { linkedFolders };
}

export interface LinkedIpcDeps {
  /** The manifest's declarations (keys looked up with Object.hasOwn only). */
  linkedFolders: Record<string, LinkedFolderDecl>;
  /** The open base's scope registry; throws before setup. */
  store(): Promise<ScopeStore>;
  /** Every other base's registry the app can see (with profiles, the other profiles'); [] without. */
  otherStores(): Promise<ScopeStore[]>;
  /** Home, the base and, with profiles, the app's folder. */
  context(): Promise<{ home: string; folder: string; root?: string }>;
  /** The reference folders the agent gets (real paths): a write link there would be read-only. */
  references(): Promise<string[]>;
  /** The system folder picker; null when cancelled. Nothing else ever names a folder to link (L1). */
  pick(): Promise<string | null>;
  userData: string;
  /** The tag key, in the app's data folder; made only when `create`. Null: none (nothing is signed yet). */
  secret(create: boolean): Promise<Buffer | null>;
  now(): Date;
  /** Settles once the start's prune of old histories ended: no handler runs before (a relink would race it). */
  ready: Promise<unknown>;
  /** A link changed: the scopes reach the window and AGENTS.md is rewritten. */
  changed(): Promise<void>;
  /** Codex can't take linked folders (Decision 15). */
  unsupported(): boolean;
}

// macOS file systems are usually case-insensitive: two spellings of one folder share its history (safe side).
const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const insideOf = (child: string, parent: string) => {
  const c = path.resolve(child).toLowerCase();
  const p = path.resolve(parent).toLowerCase();
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
};

/**
 * The linked-folder channels (hatches spec §3.2), registered only for a harness that declares `linkedFolders` (D0).
 * Every id from the window is checked here (L9); a folder is only ever the picker's answer (L1).
 */
export function registerLinkedIpc(handle: (channel: string, fn: (...args: never[]) => unknown) => void, d: LinkedIpcDeps): void {
  const decl = (key: unknown): LinkedFolderDecl => {
    if (typeof key !== "string" || key.length > KEY_MAX || !Object.hasOwn(d.linkedFolders, key)) throw new Error("Unknown linked folder kind");
    return d.linkedFolders[key];
  };
  /** The open base's registry and the scope `id`: registered and not archived. */
  const scopeOf = async (id: unknown): Promise<{ store: ScopeStore; all: ScopeEntry[]; scope: ScopeEntry }> => {
    if (!isScopeId(id)) throw new Error("Unknown scope");
    const store = await d.store();
    const all = await store.list();
    const scope = all.find((s) => s.id === id && !s.archived);
    if (!scope) throw new Error("Unknown scope");
    return { store, all, scope };
  };
  const linkOf = (scope: ScopeEntry, secret: Buffer | null, key: string, folder: unknown): LinkedFolderEntry => {
    const found = typeof folder === "string" && folder.length <= PATH_MAX ? signedLinks(scope, secret).find((l) => l.key === key && l.path === folder) : undefined;
    if (!found) throw new Error("Unknown linked folder");
    return found;
  };
  const view = (l: LinkedFolderEntry): LinkedView => ({
    key: l.key,
    label: d.linkedFolders[l.key].label,
    path: l.path,
    mode: l.mode,
    tracked: l.tracked,
    ...(l.gitChanged ? { gitChanged: true as const } : {}),
  });
  /** Every signed link of every base the app can see, the open one's as `all` holds them now. */
  const everyLink = async (all: ScopeEntry[], secret: Buffer | null): Promise<{ scope: string; base: "open" | "other"; link: LinkedFolderEntry }[]> => {
    const others = await Promise.all((await d.otherStores()).map((s) => s.list().catch(() => [] as ScopeEntry[])));
    return [
      ...all.flatMap((s) => signedLinks(s, secret).map((link) => ({ scope: s.id, base: "open" as const, link }))),
      ...others.flat().flatMap((s) => signedLinks(s, secret).map((link) => ({ scope: s.id, base: "other" as const, link }))),
    ];
  };
  /** A history no tracked link uses any more is marked unlinked (pruned after 30 days); one still used is left. */
  const releaseHistory = async (all: ScopeEntry[], secret: Buffer | null, folder: string): Promise<void> => {
    if ((await everyLink(all, secret)).some((e) => e.link.tracked && samePath(e.link.path, folder))) return;
    await markUnlinked(linkedHistoryDir(d.userData, folder), d.now());
  };

  handle("hh:scopeLinked", async (scope: unknown) => {
    await d.ready;
    const { scope: s } = await scopeOf(scope);
    const secret = await d.secret(false);
    // A key the manifest no longer declares is not shown (its label is gone).
    const folders = signedLinks(s, secret).filter((l) => Object.hasOwn(d.linkedFolders, l.key)).map(view);
    return { folders, unsupported: d.unsupported() };
  });

  // Any argument after the key (a path, say) is ignored: the picker always opens (L1).
  handle("hh:scopeLinkFolder", async (scope: unknown, key: unknown): Promise<{ linked: LinkedView } | { refused: LinkRefusalView } | null> => {
    await d.ready;
    const k = decl(key);
    const keyName = key as string;
    const { store, all, scope: s } = await scopeOf(scope);
    const secret = await d.secret(true);
    if (!secret) throw new Error("Could not read the app's key");
    const mine = signedLinks(s, secret);
    const under = mine.filter((l) => l.key === keyName).length;
    if (!k.many && under >= 1) return { refused: "one-only" };
    if (under >= LINKED_MANY_MAX) return { refused: "too-many" };
    const picked = await d.pick();
    if (picked === null) return null;
    const every = await everyLink(all, secret);
    const ctx = await d.context();
    const checked = await checkLink(picked, {
      ...ctx,
      sameScope: mine.map((l) => l.path),
      otherScopesWrite: every.filter((e) => !(e.base === "open" && e.scope === s.id) && e.link.mode === "write").map((e) => e.link.path),
      mode: k.mode,
      history: k.history,
    });
    if ("refused" in checked) return checked;
    // One stable spelling (the case on disk, on macOS): every reader of the link hashes the same history folder.
    const real = await realpathNative(checked.path).catch(() => checked.path);
    // A reference's read-only rules win over a write link's: it would silently be read-only.
    if (k.mode === "write") {
      const refs = await Promise.all((await d.references()).map((r) => realpathNative(r).catch(() => r)));
      if (refs.some((r) => insideOf(real, r))) return { refused: "reference" };
    }
    const entry = { key: keyName, path: real, mode: k.mode, tracked: checked.tracked };
    await store.link(s.id, { ...entry, tag: linkTag(s.id, entry, secret) }, { many: k.many, valid: (l) => linkTagValid(l, s.id, secret) });
    // A folder linked before (here or in another scope) continues its history.
    if (entry.tracked) await markRelinked(linkedHistoryDir(d.userData, real));
    await d.changed();
    return { linked: view(entry) };
  });

  // Removes the link only: the folder and its files are never touched.
  handle("hh:scopeUnlinkFolder", async (scope: unknown, key: unknown, folder: unknown) => {
    await d.ready;
    decl(key);
    const { store, scope: s } = await scopeOf(scope);
    const secret = await d.secret(false);
    const link = linkOf(s, secret, key as string, folder);
    await store.unlink(s.id, link.key, link.path);
    if (link.tracked) await releaseHistory(await store.list(), secret, link.path);
    await d.changed();
  });

  // Decision 13: the person keeps the folder tracked or leaves it to its git. Never tracked while it has git (L7).
  handle("hh:scopeConfirmGit", async (scope: unknown, key: unknown, folder: unknown, tracked: unknown) => {
    await d.ready;
    decl(key);
    if (typeof tracked !== "boolean") throw new Error("Invalid linked folder change");
    const { store, scope: s } = await scopeOf(scope);
    const secret = await d.secret(false);
    const link = linkOf(s, secret, key as string, folder);
    if (tracked && (link.mode !== "write" || (await isGitRepo(link.path)))) throw new Error("This folder can't be tracked by the app's history");
    await store.setTracked(s.id, link.key, link.path, tracked, linkTag(s.id, { ...link, tracked }, secret as Buffer));
    if (tracked) await markRelinked(linkedHistoryDir(d.userData, link.path));
    else if (link.tracked) await releaseHistory(await store.list(), secret, link.path);
    await d.changed();
  });
}
