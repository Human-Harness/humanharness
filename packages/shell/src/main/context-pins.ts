import path from "node:path";
import { refusedShape } from "@humanharness/harness-sdk/documents";
import type { ContextItem } from "@humanharness/ui/client";
import {
  PIN_INLINE_MAX_BYTES,
  type Pin,
  type PinFacts,
  type PinLayout,
  isBinary,
  loadContext,
  pinBlock,
  pinTitleLine,
  pinnedSection,
  pinsLayout,
  readCapped,
  readPrefix,
  titleOf,
} from "@humanharness/workspace";
import { approxTokens } from "./context-record";
import { locate } from "./documents";
import { stillSafe } from "./open-path";
import { addablePath } from "./task-prompts";
import type { PersonContext } from "./task-manager";

/** Bytes looked at for a NUL (the file timeline's rule) and for a title. */
const SNIFF_BYTES = 8 * 1024;
const TITLE_BYTES = 2 * 1024;

/**
 * Where a pin or an "Add now" may point (context-panel spec §4.2): a plain relative path (no empty, `.` or `..` part, so
 * no way around a prefix), never under `.claude/` or any `.git/`, and under `.harness/` only inside `.harness/notes/`.
 * Parts are compared without case (the person's disk may not tell `.GIT` from `.git`). Prefix checks only.
 */
export function pinShapeOk(rel: unknown): rel is string {
  if (refusedShape(rel)) return false;
  const parts = (rel as string).split("/");
  for (const part of parts) {
    if (part === "" || part === "." || part === "..") return false;
    if (part.toLowerCase() === ".git") return false;
  }
  const first = parts[0].toLowerCase();
  if (first === ".claude") return false;
  if (first === ".harness") return parts[0] === ".harness" && parts[1] === "notes" && parts.length > 2;
  return true;
}

export type PinCheck = { ok: true; file: string; size: number } | { ok: false; reason: "outside" | "bad-name" | "missing" | "binary" };

/**
 * The file `rel` names in `base`: a path `pinShapeOk` takes whose name fits a prompt (`addablePath`), inside the folder
 * after links, where the real path is one `pinShapeOk` takes too (a link to `.harness/tasks.json` or `.git/config` is
 * outside), there, and (with `text`) not binary. Reference folders are never tried. Reads at most 8 KB.
 */
export async function checkPinPath(base: string, rel: unknown, opts: { text: boolean }): Promise<PinCheck> {
  if (!pinShapeOk(rel)) return { ok: false, reason: "outside" };
  if (!addablePath(rel)) return { ok: false, reason: "bad-name" };
  const at = await locate(rel, [base]);
  if (!at.ok) return at;
  if (!pinShapeOk(path.relative(at.root, at.file).split(path.sep).join("/"))) return { ok: false, reason: "outside" };
  const head = await readPrefix(at.file, SNIFF_BYTES, () => stillSafe(at.file, [base]));
  if (!head) return { ok: false, reason: "outside" };
  if (opts.text && isBinary(rel, head.bytes)) return { ok: false, reason: "binary" };
  return { ok: true, file: at.file, size: head.size };
}

/** What is known of each pin before the budget (sizes only: nothing past 8 KB is read). Checked again each time. */
export async function pinFacts(base: string, scope: string, pins: readonly Pin[]): Promise<PinFacts[]> {
  return Promise.all(
    pins.map(async (p): Promise<PinFacts> => {
      const check = await checkPinPath(base, p.path, { text: true });
      if (check.ok) return { scope, path: p.path, at: p.at, size: check.size, binary: false };
      return { scope, path: p.path, at: p.at, size: check.reason === "binary" ? 0 : null, binary: check.reason === "binary" };
    }),
  );
}

/** The layout of `scopes`' pins (in that order) for `budget`, as the panel and the next task see it. */
export async function pinsOf(base: string, scopes: readonly string[], budget: number): Promise<PinLayout[]> {
  const facts: PinFacts[] = [];
  for (const scope of scopes) facts.push(...(await pinFacts(base, scope, (await loadContext(base, scope)).pinned)));
  return pinsLayout(facts, budget);
}

/**
 * A whole pin's text, checked and read again right before it enters (no links), at most the `max` bytes the layout
 * measured. `"grew"` when the file is bigger now (it would overrun the budget); null when it can't be read now.
 */
async function wholeText(base: string, rel: string, max: number): Promise<string | "grew" | null> {
  const check = await checkPinPath(base, rel, { text: true });
  if (!check.ok) return null;
  const got = await readCapped(check.file, Math.min(max, PIN_INLINE_MAX_BYTES), () => stillSafe(check.file, [base]));
  if (!got) return null;
  return "bytes" in got ? got.bytes.toString("utf8") : "grew";
}

async function titleText(base: string, rel: string): Promise<string | null> {
  const check = await checkPinPath(base, rel, { text: true });
  if (!check.ok) return null;
  // One byte past what `titleOf` scans, so a title line cut by its edge is seen as cut.
  const head = await readPrefix(check.file, TITLE_BYTES + 1, () => stillSafe(check.file, [base]));
  return head ? head.bytes.toString("utf8") : null;
}

/**
 * What a new task in `scopes[0]` gets from the person (context-panel spec §4): the pinned section, one item per pin it
 * names, and the excluded notes of every scope given. Nothing pinned or excluded: `{ pinned: "", items: [], excluded: ∅ }`.
 */
export async function pinnedContext(base: string, scopes: readonly string[], budget: number): Promise<PersonContext> {
  const excluded = new Set<string>();
  for (const scope of scopes) for (const e of (await loadContext(base, scope)).excluded) excluded.add(e.note);
  return { ...(await pinnedText(base, await pinsOf(base, scopes, budget))), excluded };
}

/**
 * The pinned section and its items for a layout `pinsOf` gave. A whole pin is read up to the size the layout measured
 * (its `tokens` × 4 bytes): a file that grew since enters as title only, so the budget is never overrun.
 */
export async function pinnedText(base: string, layout: readonly PinLayout[]): Promise<Omit<PersonContext, "excluded">> {
  const blocks: string[] = [];
  const titles: string[] = [];
  const items: ContextItem[] = [];
  for (const pin of layout) {
    const id = `pin:${pin.scope}:${pin.path}`;
    let state = pin.state;
    if (state === "full") {
      const text = await wholeText(base, pin.path, pin.tokens * 4);
      if (text === null) continue;
      if (text === "grew") state = "title";
      else {
        const block = pinBlock(pin.path, text);
        blocks.push(block);
        items.push({ id, kind: "pinned", label: `Pinned · ${pin.path}`, path: pin.path, tokens: approxTokens(block.length), scope: pin.scope });
        continue;
      }
    }
    if (state === "title") {
      const head = await titleText(base, pin.path);
      if (head === null) continue;
      const line = pinTitleLine(titleOf(head, pin.path), pin.path);
      titles.push(line);
      items.push({ id, kind: "pinned-title", label: `Pinned · ${pin.path}`, path: pin.path, tokens: approxTokens(line.length), scope: pin.scope });
    }
  }
  return { pinned: pinnedSection(blocks, titles), items };
}
