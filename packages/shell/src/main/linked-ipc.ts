import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { promises as fs, realpath } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { LINKED_MANY_MAX, type LinkedFolderDecl, hasLinkedFolders } from "@humanharness/harness-sdk";
import type { HatchesState, LinkRefusalView, LinkedHistoryView, LinkedView } from "@humanharness/ui/client";
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

/** One live link's id in the live set: its profile ("" without profiles), scope and nonce. */
const liveId = (profile: string, scope: string, nonce: string) => JSON.stringify([profile, scope, nonce]);
const LIVE_MAX = 4096;

/**
 * The links the person has now, by nonce, in the app's data folder beside the key (outside the folder the agent can
 * write). A tag alone can be replayed: after an unlink the agent could paste the old signed entry back; its nonce is
 * no longer live. The file is made only by the first link (D0: never without linked folders); writes are atomic, 0600.
 */
export class LiveLinks {
  private set: Promise<Set<string>> | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}

  /** The live ids; a missing or unreadable file is none (never created by a read). */
  read(): Promise<ReadonlySet<string>> {
    this.set ??= fs.readFile(this.file, "utf8").then(
      (text) => {
        const raw: unknown = JSON.parse(text);
        return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string").slice(0, LIVE_MAX) : []);
      },
      () => new Set<string>(),
    ).catch(() => new Set<string>());
    return this.set;
  }

  /** Adds `add` and removes `remove`, in one atomic write. */
  change(add: string[], remove: string[]): Promise<void> {
    const run = this.writes.then(async () => {
      const next = new Set(await this.read());
      for (const r of remove) next.delete(r);
      for (const a of add) next.add(a);
      if (next.size > LIVE_MAX) throw new Error("Too many linked folders");
      await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(tmp, JSON.stringify([...next]), { mode: 0o600, flag: "wx" });
        await fs.rename(tmp, this.file);
      } catch (err) {
        await fs.rm(tmp, { force: true });
        throw err;
      }
      this.set = Promise.resolve(next);
    });
    this.writes = run.catch(() => undefined);
    return run;
  }
}

/** What signs and checks links: the key and the live set, both in `userData`. */
export interface LinkSigning {
  secret(create: boolean): Promise<Buffer | null>;
  live: LiveLinks;
}

const signings = new Map<string, LinkSigning>();
/** The one signing of `userData` (shared by the IPC and the turn's scope access, so the live set has one writer). */
export function linkedSigning(userData: string): LinkSigning {
  let s = signings.get(userData);
  if (!s) {
    s = { secret: linkedSecret(userData), live: new LiveLinks(path.join(userData, "linked-live.json")) };
    signings.set(userData, s);
  }
  return s;
}

/**
 * The tag of a link: HMAC-SHA256 with the app's key over one unambiguous encoding of what the link grants (profile,
 * scope, key, path, mode, tracked) and its nonce. `scopes.json` sits in the folder the agent can write, so only a tag
 * proves the app wrote the link (threat model L1). The profile is its id ("" without), never the folder's path, so
 * moving the folder keeps the links.
 */
export function linkTag(
  profile: string,
  scope: string,
  l: Pick<LinkedFolderEntry, "key" | "path" | "mode" | "tracked" | "nonce">,
  secret: Buffer,
): string {
  return createHmac("sha256", secret)
    .update(JSON.stringify(["hh-link-v2", profile, scope, l.key, l.path, l.mode, l.tracked, l.nonce ?? ""]))
    .digest("hex");
}

/** Whether `l` carries the tag the app made for it in `profile`/`scope`, and its nonce is live. No key: none is. */
export function linkTagValid(l: LinkedFolderEntry, profile: string, scope: string, secret: Buffer | null, live: ReadonlySet<string>): boolean {
  if (!secret || typeof l.tag !== "string" || typeof l.nonce !== "string") return false;
  if (!live.has(liveId(profile, scope, l.nonce))) return false;
  const want = Buffer.from(linkTag(profile, scope, l, secret));
  const got = Buffer.from(l.tag);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Reads the key (never making it) and the live set once: the filter of the links the app made and still holds. */
export async function linkChecker(signing: LinkSigning): Promise<(s: ScopeEntry, profile: string) => LinkedFolderEntry[]> {
  const [secret, live] = await Promise.all([signing.secret(false), signing.live.read()]);
  return (s, profile) => (s.linked ?? []).filter((l) => linkTagValid(l, profile, s.id, secret, live));
}

/** The links of `s` (in `profile`) the app made and still holds; the rest never show and never count. */
export async function signedLinks(s: ScopeEntry, profile: string, signing: LinkSigning): Promise<LinkedFolderEntry[]> {
  return (await linkChecker(signing))(s, profile);
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
  /** The open base's profile id; "" without profiles. */
  profile(): Promise<string>;
  /** Every other base's registry the app can see (with profiles, the other profiles', by id); [] without. */
  otherStores(): Promise<{ profile: string; store: ScopeStore }[]>;
  /** Home, the base and, with profiles, the app's folder. */
  context(): Promise<{ home: string; folder: string; root?: string }>;
  /** The reference folders the agent gets (real paths): a write link there would be read-only. */
  references(): Promise<string[]>;
  /** The system folder picker; null when cancelled. Nothing else ever names a folder to link (L1). */
  pick(): Promise<string | null>;
  userData: string;
  /** The tag key and live set, in the app's data folder (`linkedSigning(userData)`). */
  signing: LinkSigning;
  now(): Date;
  /** Settles once the start's prune of old histories ended: no handler runs before (a relink would race it). */
  ready: Promise<unknown>;
  /** A link changed: the scopes reach the window and AGENTS.md is rewritten. */
  changed(): Promise<void>;
  /** Codex can't take linked folders (Decision 15). */
  unsupported(): boolean;
  /** Decision 13's git check of a scope's links (`ScopeAccess.checkGit`), run as Scope settings opens. */
  checkGit?(scope: string): Promise<unknown>;
  /** What the History panel shows of the open scope's linked folders (linked-restore.ts). */
  linkedHistory?(): Promise<LinkedHistoryView>;
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
  // Link, unlink and confirm change scopes.json, the live set and the history marks: one at a time, so an unlink's
  // "is the history still used" never interleaves with a link's relink.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn);
    chain = run.catch(() => undefined);
    return run;
  };
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
  type Check = (s: ScopeEntry, profile: string) => LinkedFolderEntry[];
  const linkOf = (signed: Check, scope: ScopeEntry, profile: string, key: string, folder: unknown): LinkedFolderEntry => {
    const found = typeof folder === "string" && folder.length <= PATH_MAX ? signed(scope, profile).find((l) => l.key === key && l.path === folder) : undefined;
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
  const everyLink = async (signed: Check, profile: string, all: ScopeEntry[]): Promise<{ scope: string; base: "open" | "other"; link: LinkedFolderEntry }[]> => {
    const others = await Promise.all(
      (await d.otherStores()).map(async (o) => ({ profile: o.profile, list: await o.store.list().catch(() => [] as ScopeEntry[]) })),
    );
    return [
      ...all.flatMap((s) => signed(s, profile).map((link) => ({ scope: s.id, base: "open" as const, link }))),
      ...others.flatMap((o) => o.list.flatMap((s) => signed(s, o.profile).map((link) => ({ scope: s.id, base: "other" as const, link })))),
    ];
  };
  /** A history no tracked link uses any more is marked unlinked (pruned after 30 days); one still used is left. */
  const releaseHistory = async (profile: string, all: ScopeEntry[], folder: string): Promise<void> => {
    const signed = await linkChecker(d.signing);
    if ((await everyLink(signed, profile, all)).some((e) => e.link.tracked && samePath(e.link.path, folder))) return;
    await markUnlinked(linkedHistoryDir(d.userData, folder), d.now());
  };

  handle("hh:scopeLinked", async (scope: unknown) => {
    await d.ready;
    // Scope settings opens: a folder that gained or lost git since is marked first (Decision 13), as when the scope opens.
    const checkGit = d.checkGit;
    if (checkGit) {
      const { scope: before } = await scopeOf(scope);
      await serial(() => checkGit(before.id)).catch((err: unknown) => console.error("Could not check the linked folders' git", err));
    }
    const { scope: s } = await scopeOf(scope);
    const signed = await linkChecker(d.signing);
    // A key the manifest no longer declares is not shown (its label is gone).
    const folders = signed(s, await d.profile()).filter((l) => Object.hasOwn(d.linkedFolders, l.key)).map(view);
    return { folders, unsupported: d.unsupported() };
  });

  // The History panel's lines (hatches spec §3.4): the open scope's, never a scope the window names.
  handle("hh:linkedHistory", async (): Promise<LinkedHistoryView> => {
    await d.ready;
    return d.linkedHistory ? d.linkedHistory() : { uncovered: [], tasks: {} };
  });

  // Any argument after the key (a path, say) is ignored: the picker always opens (L1).
  handle("hh:scopeLinkFolder", async (scope: unknown, key: unknown): Promise<{ linked: LinkedView } | { refused: LinkRefusalView } | null> => {
    await d.ready;
    const k = decl(key);
    const keyName = key as string;
    // Before the picker opens: a full key is refused without asking (looked at again once a folder is picked).
    const full = async (s: ScopeEntry, profile: string): Promise<LinkRefusalView | null> => {
      const under = (await linkChecker(d.signing))(s, profile).filter((l) => l.key === keyName).length;
      if (!k.many && under >= 1) return "one-only";
      return under >= LINKED_MANY_MAX ? "too-many" : null;
    };
    {
      const { scope: s } = await scopeOf(scope);
      const refused = await full(s, await d.profile());
      if (refused) return { refused };
    }
    const picked = await d.pick();
    if (picked === null) return null;
    return serial(async () => {
      const { store, all, scope: s } = await scopeOf(scope);
      const profile = await d.profile();
      const refusedNow = await full(s, profile);
      if (refusedNow) return { refused: refusedNow };
      const secret = await d.signing.secret(true);
      if (!secret) throw new Error("Could not read the app's key");
      const signed = await linkChecker(d.signing);
      const every = await everyLink(signed, profile, all);
      const ctx = await d.context();
      const checked = await checkLink(picked, {
        ...ctx,
        sameScope: signed(s, profile).map((l) => l.path),
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
      const entry = { key: keyName, path: real, mode: k.mode, tracked: checked.tracked, nonce: randomBytes(16).toString("hex") };
      const id = liveId(profile, s.id, entry.nonce);
      // Live first: a crash in between leaves a nonce no entry carries, never an entry without one that counts.
      await d.signing.live.change([id], []);
      try {
        const live = await d.signing.live.read();
        await store.link(s.id, { ...entry, tag: linkTag(profile, s.id, entry, secret) }, { many: k.many, valid: (l) => linkTagValid(l, profile, s.id, secret, live) });
      } catch (err) {
        await d.signing.live.change([], [id]);
        throw err;
      }
      // A folder linked before (here or in another scope) continues its history.
      if (entry.tracked) await markRelinked(linkedHistoryDir(d.userData, real));
      await d.changed();
      return { linked: view(entry) };
    });
  });

  // Removes the link only: the folder and its files are never touched.
  handle("hh:scopeUnlinkFolder", async (scope: unknown, key: unknown, folder: unknown) => {
    await d.ready;
    decl(key);
    await serial(async () => {
      const { store, scope: s } = await scopeOf(scope);
      const profile = await d.profile();
      const link = linkOf(await linkChecker(d.signing), s, profile, key as string, folder);
      // The nonce stops being live first: the old entry pasted back never counts again, even after a crash here.
      await d.signing.live.change([], [liveId(profile, s.id, link.nonce as string)]);
      await store.unlink(s.id, link.key, link.path);
      if (link.tracked) await releaseHistory(profile, await store.list(), link.path);
      await d.changed();
    });
  });

  // Decision 13: the person keeps the folder tracked or leaves it to its git. Never tracked while it has git (L7).
  handle("hh:scopeConfirmGit", async (scope: unknown, key: unknown, folder: unknown, tracked: unknown) => {
    await d.ready;
    decl(key);
    if (typeof tracked !== "boolean") throw new Error("Invalid linked folder change");
    await serial(async () => {
      const { store, scope: s } = await scopeOf(scope);
      const profile = await d.profile();
      const link = linkOf(await linkChecker(d.signing), s, profile, key as string, folder);
      if (tracked && (link.mode !== "write" || (await isGitRepo(link.path)))) throw new Error("This folder can't be tracked by the app's history");
      const secret = (await d.signing.secret(false)) as Buffer; // linkOf found a signed link: the key is there
      const live = await d.signing.live.read();
      // Signed inside the store's write, from the entry as it is then (its nonce kept, so it stays live): an entry
      // changed on disk since it was read is no longer the app's, and is never signed.
      await store.setTracked(s.id, link.key, link.path, tracked, (next, current) => {
        if (!linkTagValid(current, profile, s.id, secret, live) || (tracked && current.mode !== "write")) throw new Error("Unknown linked folder");
        return linkTag(profile, s.id, next, secret);
      });
      if (tracked) await markRelinked(linkedHistoryDir(d.userData, link.path));
      else if (link.tracked) await releaseHistory(profile, await store.list(), link.path);
      await d.changed();
    });
  });
}
