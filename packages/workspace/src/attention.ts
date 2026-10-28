import { promises as fs } from "node:fs";
import { attentionFile } from "./layout";
import { checkFolders, LinkRefused, readNoLinks, TooLarge, writeNoLinks } from "./no-links";

// The Attention inbox (plugins spec §6): one JSON array at `.harness/attention.json`, never tracked. The agent can
// write the base, so the file is read and written only through no-links.ts and every item is checked on read; an
// item that doesn't fit is dropped. What callers raise is theirs to check (the broker does, Task 9): the store
// trusts its callers, not the file.

export type AttentionSeverity = "info" | "warn" | "action";
/** Who raised an item: a plugin now; a task once parallel tasks exist (C7 "waiting for you", plugins spec §6). */
export interface AttentionOrigin {
  kind: "plugin" | "task";
  id: string;
}
export type AttentionTarget = { panel: string; focus?: string } | { action: string; vars?: Record<string, unknown> };
export interface AttentionInput {
  key: string;
  severity: AttentionSeverity;
  title: string;
  body?: string;
  target?: AttentionTarget;
}
export interface AttentionItem extends AttentionInput {
  origin: AttentionOrigin;
  at: string;
  read: boolean;
  /** Set when the person dismissed it: hidden until it is raised with another severity or title. */
  dismissed?: { severity: AttentionSeverity; title: string };
}

export const ATTENTION_LIMITS = {
  /** Items kept per origin (dismissed ones count): over it, dismissed go first, then the oldest info, warn, action. */
  perOrigin: 100,
  /** Items older than this are dropped when the file is read. */
  days: 30,
  titleChars: 120,
  bodyChars: 500,
  keyChars: 200,
  idChars: 200,
  varsBytes: 4096,
  fileBytes: 4 * 1024 * 1024,
} as const;

const SEVERITIES: readonly AttentionSeverity[] = ["info", "warn", "action"];
const DAY_MS = 24 * 60 * 60 * 1000;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const isSeverity = (v: unknown): v is AttentionSeverity => SEVERITIES.includes(v as AttentionSeverity);
const sameOrigin = (a: AttentionOrigin, b: AttentionOrigin): boolean => a.kind === b.kind && a.id === b.id;

function cleanTarget(v: unknown): AttentionTarget | null {
  if (!isObject(v)) return null;
  if (v.panel !== undefined) {
    if (!text(v.panel, ATTENTION_LIMITS.idChars)) return null;
    if (v.focus === undefined) return { panel: v.panel };
    return text(v.focus, ATTENTION_LIMITS.idChars) ? { panel: v.panel, focus: v.focus } : null;
  }
  if (!text(v.action, ATTENTION_LIMITS.idChars)) return null;
  if (v.vars === undefined) return { action: v.action };
  if (!isObject(v.vars) || Buffer.byteLength(JSON.stringify(v.vars), "utf8") > ATTENTION_LIMITS.varsBytes) return null;
  return { action: v.action, vars: v.vars };
}

/** One item read back from the file, rebuilt field by field; null when anything doesn't fit. */
function cleanItem(v: unknown): AttentionItem | null {
  if (!isObject(v) || !isObject(v.origin)) return null;
  const { origin } = v;
  if ((origin.kind !== "plugin" && origin.kind !== "task") || !text(origin.id, ATTENTION_LIMITS.idChars)) return null;
  if (!text(v.key, ATTENTION_LIMITS.keyChars) || !isSeverity(v.severity) || !text(v.title, ATTENTION_LIMITS.titleChars)) return null;
  if (typeof v.at !== "string" || Number.isNaN(Date.parse(v.at)) || typeof v.read !== "boolean") return null;
  const item: AttentionItem = { origin: { kind: origin.kind, id: origin.id }, key: v.key, severity: v.severity, title: v.title, at: v.at, read: v.read };
  if (v.body !== undefined) {
    if (!text(v.body, ATTENTION_LIMITS.bodyChars)) return null;
    item.body = v.body;
  }
  if (v.target !== undefined) {
    const target = cleanTarget(v.target);
    if (!target) return null;
    item.target = target;
  }
  if (v.dismissed !== undefined) {
    const d = v.dismissed;
    if (!isObject(d) || !isSeverity(d.severity) || !text(d.title, ATTENTION_LIMITS.titleChars)) return null;
    item.dismissed = { severity: d.severity, title: d.title };
  }
  return item;
}

const EVICT_ORDER = (i: AttentionItem): number => (i.dismissed ? 0 : SEVERITIES.indexOf(i.severity) + 1);

/** Keeps at most `perOrigin` items of `origin`: dismissed ones go first, then info, warn, action; the oldest of each first. */
function capOrigin(items: AttentionItem[], origin: AttentionOrigin): AttentionItem[] {
  const own = items.filter((i) => sameOrigin(i.origin, origin));
  const over = own.length - ATTENTION_LIMITS.perOrigin;
  if (over <= 0) return items;
  // Array order is the order items were raised (or last made news), so a stable sort keeps the oldest first.
  const drop = new Set([...own].sort((a, b) => EVICT_ORDER(a) - EVICT_ORDER(b)).slice(0, over));
  return items.filter((i) => !drop.has(i));
}

interface Loaded {
  items: AttentionItem[];
  /** The file is there but unusable (not JSON, not a list, too large, a link): set it aside before writing. */
  broken: boolean;
}

export class AttentionStore {
  private readonly file: string;
  private readonly now: () => Date;
  private readonly listeners = new Set<() => void>();
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly base: string,
    private readonly opts: { now?: () => Date; log?: (m: string) => void } = {},
  ) {
    this.file = attentionFile(base);
    this.now = opts.now ?? (() => new Date());
  }

  /** Visible items (not dismissed), newest first. An unreadable file reads as empty. */
  async list(): Promise<AttentionItem[]> {
    const { items } = await this.load().catch((err: unknown) => {
      this.log(`Attention: can't read ${this.file}: ${(err as Error).message}`);
      return { items: [] as AttentionItem[], broken: false };
    });
    // Later in the array is newer; among equal times, the one raised last comes first.
    return items
      .filter((i) => !i.dismissed)
      .reverse()
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }

  /** Unread, visible `action` items. */
  async badge(): Promise<number> {
    return (await this.list()).filter((i) => i.severity === "action" && !i.read).length;
  }

  /** `shown`: visible after the call; `notify`: a new or newly unread `action` item (for the optional notification). */
  raise(origin: AttentionOrigin, input: AttentionInput): Promise<{ shown: boolean; notify: boolean }> {
    return this.change<{ shown: boolean; notify: boolean }>((items) => {
      const at = this.now().toISOString();
      const fresh: AttentionItem = { origin: { kind: origin.kind, id: origin.id }, key: input.key, severity: input.severity, title: input.title, at, read: false };
      if (input.body !== undefined) fresh.body = input.body;
      if (input.target !== undefined) fresh.target = input.target;
      const index = items.findIndex((i) => sameOrigin(i.origin, origin) && i.key === input.key);
      const was = index >= 0 ? items[index] : undefined;
      const notify = input.severity === "action";
      if (!was) return [capOrigin([...items, fresh], origin), { shown: true, notify }];
      if (was.dismissed && was.dismissed.severity === input.severity && was.dismissed.title === input.title) {
        // Still what the person dismissed: keep it hidden, but with the latest body and target.
        const kept: AttentionItem = { ...fresh, at: was.at, read: was.read, dismissed: was.dismissed };
        return [replaceAt(items, index, kept), { shown: false, notify: false }];
      }
      if (was.dismissed || was.severity !== input.severity || was.title !== input.title) {
        // News: unread again, at the end (newest), and a notification if it is an action the person hadn't seen as such.
        const unseen = was.dismissed || was.read || was.severity !== "action";
        return [capOrigin([...items.filter((_, n) => n !== index), fresh], origin), { shown: true, notify: notify && Boolean(unseen) }];
      }
      return [replaceAt(items, index, { ...fresh, at: was.at, read: was.read }), { shown: true, notify: false }];
    });
  }

  /** The condition is over: the item goes, dismissed or not. */
  async resolve(origin: AttentionOrigin, key: string): Promise<void> {
    await this.change((items) => [items.filter((i) => !(sameOrigin(i.origin, origin) && i.key === key)), undefined]);
  }

  /** Hidden until raised again with another severity or title. */
  async dismiss(origin: AttentionOrigin, key: string): Promise<void> {
    await this.change((items) => [
      items.map((i) => (sameOrigin(i.origin, origin) && i.key === key && !i.dismissed ? { ...i, dismissed: { severity: i.severity, title: i.title } } : i)),
      undefined,
    ]);
  }

  /** No arguments: every item; an origin alone: all of its items; both: that one. */
  async markRead(origin?: AttentionOrigin, key?: string): Promise<void> {
    const hit = (i: AttentionItem) => !origin || (sameOrigin(i.origin, origin) && (key === undefined || i.key === key));
    await this.change((items) => [items.map((i) => (!i.read && hit(i) ? { ...i, read: true } : i)), undefined]);
  }

  /** Every item of `origin` (a removed plugin). */
  async removeOrigin(origin: AttentionOrigin): Promise<void> {
    await this.change((items) => [items.filter((i) => !sameOrigin(i.origin, origin)), undefined]);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async load(): Promise<Loaded> {
    let raw: string | null;
    try {
      raw = await readNoLinks(this.base, this.file, ATTENTION_LIMITS.fileBytes);
    } catch (err) {
      // A folder above the file that is a link stays an error (nothing can be written there); the file itself is set aside.
      if (err instanceof TooLarge || (err instanceof LinkRefused && (await checkFolders(this.base, this.file)))) {
        this.log(`Attention: ${err.message}; it will be set aside`);
        return { items: [], broken: true };
      }
      throw err;
    }
    if (raw === null) return { items: [], broken: false };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    if (!Array.isArray(parsed)) {
      this.log(`Attention: ${this.file} is not a list; it will be set aside`);
      return { items: [], broken: true };
    }
    const oldest = this.now().getTime() - ATTENTION_LIMITS.days * DAY_MS;
    const items: AttentionItem[] = [];
    let dropped = 0;
    for (const v of parsed) {
      const item = cleanItem(v);
      if (!item || items.some((i) => sameOrigin(i.origin, item.origin) && i.key === item.key)) dropped++;
      else if (Date.parse(item.at) >= oldest) items.push(item);
    }
    if (dropped > 0) this.log(`Attention: dropped ${dropped} item(s) that don't fit in ${this.file}`);
    return { items, broken: false };
  }

  /** One change at a time: reads the file, applies `fn`, writes only when something changed, then tells listeners. */
  private change<T>(fn: (items: AttentionItem[]) => [AttentionItem[], T]): Promise<T> {
    const run = this.writes.then(async () => {
      const { items, broken } = await this.load();
      const [next, out] = fn(items);
      if (JSON.stringify(next) === JSON.stringify(items)) return out;
      if (broken) await this.setAside();
      await writeNoLinks(this.base, this.file, `${JSON.stringify(next, null, 2)}\n`, ATTENTION_LIMITS.fileBytes);
      for (const l of this.listeners) {
        try {
          l();
        } catch (err) {
          this.log(`Attention: a listener failed: ${(err as Error).message}`);
        }
      }
      return out;
    });
    this.writes = run.catch(() => undefined);
    return run;
  }

  /** Renames the unusable file to `attention.json.corrupt-<time>`; rename moves a link itself, never what it points to. */
  private async setAside(): Promise<void> {
    await checkFolders(this.base, this.file);
    await fs.rename(this.file, `${this.file}.corrupt-${Date.now()}`).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") throw err;
    });
  }

  private log(message: string): void {
    (this.opts.log ?? console.error)(message);
  }
}

function replaceAt<T>(list: T[], index: number, value: T): T[] {
  return list.map((v, n) => (n === index ? value : v));
}
