import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import type { MaterialFamily } from "@humanharness/harness-sdk";
import { estimateTokens } from "@humanharness/workspace";
import { MaterialRefused } from "./blocks";
import { checkPieces } from "./checks";
import { FIRST_ROWS, MAX_BYTES, MAX_PAGES } from "./constants";
import type { Measured } from "./convert";
import { ConvertStopped, type ConvertRunner, workerRunner } from "./convert/isolate";
import { sheetSummary } from "./convert/sheet";
import { type Piece, cutBlocks, cutRows } from "./cut";
import { REFUSAL_TEXT, detectType } from "./detect";
import { type MeasuredCosts, estimateCost, sampleSize } from "./estimate";
import { fragmentId } from "./fragment";
import { intakeDecision } from "./intake";
import { type MaterialStore, sourceSlug } from "./store";
import type { ConvertSettings, Converted, Fragment, Refusal, SourceEntry } from "./types";

/** The message for a refusal the pipeline makes (detection gives its own). */
export const refusalText = (r: Refusal): string => (Object.hasOwn(REFUSAL_TEXT, r) ? REFUSAL_TEXT[r as keyof typeof REFUSAL_TEXT] : REFUSAL_TEXT.unreadable);

export type AddResult = { ok: true; id: string; waiting: boolean } | { ok: false; reason: Refusal; message: string };

/** What every pipeline call may take: the measured stage costs, and where converters run (default: a worker per file). */
export interface PipelineOptions {
  items: boolean;
  measured?: MeasuredCosts;
  runner?: ConvertRunner;
}

const reasonOf = (err: unknown): Refusal => {
  if (err instanceof MaterialRefused) return err.reason;
  console.error("Could not convert the material", err);
  return "unreadable";
};

/** The program's summary until labelling (§4.1): the first sentence of the text, at most 200 characters. */
export function firstSentence(md: string): string {
  const text = md
    .split("\n")
    .filter((l) => !/^\s*(#|\||```|\[image)/.test(l))
    .join(" ")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const m = /^.{10,}?[.!?](?=\s|$)/.exec(text);
  return (m ? m[0] : text).slice(0, 200);
}

/** A sheet choice that names none of the file's sheets: the choice is undone and the source keeps waiting. */
class NoSuchSheets extends Error {}

/** The pieces of a converted file: rows for spreadsheets (or the summary and first rows), sections for the rest. */
function piecesOf(c: Converted, sheets: SourceEntry["sheets"]): Piece[] {
  if (!c.sheets) return cutBlocks(c.blocks);
  if (sheets === "summary") return [{ path: "Summary", md: sheetSummary(c.sheets, FIRST_ROWS), location: c.sheets.map((s) => s.name).join(", "), pages: [1] }];
  if (!Array.isArray(sheets)) return c.sheets.flatMap(cutRows);
  const kept = c.sheets.filter((s) => sheets.includes(s.name));
  if (kept.length === 0) throw new NoSuchSheets();
  return kept.flatMap(cutRows);
}

/** A refused source loads nothing: its fragments' files go and the index forgets them. Best effort; never throws. */
async function refuse(store: MaterialStore, id: string, reason: Refusal): Promise<SourceEntry | null> {
  try {
    await store.writeFragments(id, []);
  } catch (err) {
    console.error("Could not remove a refused source's fragments", err);
  }
  try {
    const next = await store.patch(id, (e) => {
      if (e.status === "removed") return e;
      const { stage: _s, ...rest } = e;
      return { ...rest, status: "refused", refusal: reason, fragments: [] };
    });
    await store.writeIndex().catch((err: unknown) => console.error("Could not rebuild the material index", err));
    return next;
  } catch (err) {
    console.error("Could not record a refused source", err);
    return null;
  }
}

/**
 * Converts, cuts, checks and stores a source (§3, §5, §6.1): its fragments are usable at once (`not-reviewed`) and
 * the source goes `validating` at the `review` stage, with the AI stages' estimate. Any failure (a converter's
 * refusal, the worker's heap or time limit, a crash, the disk) marks it `refused` with no fragments; it never throws.
 * A stopped conversion (`ConvertStopped`) leaves it `converting` and returns null: it is converted again later.
 * `restore`: the entry before the person's sheet choice, put back when the choice names none of the file's sheets
 * (the result is then null). Rebuilds the index.
 */
export async function processSource(
  store: MaterialStore,
  id: string,
  o: PipelineOptions & { settings?: ConvertSettings; restore?: SourceEntry },
): Promise<SourceEntry | null> {
  let s: SourceEntry | null;
  try {
    s = await store.source(id);
  } catch (err) {
    console.error("Could not read the material registry", err);
    return null;
  }
  const file = s && store.originalPath(s.path);
  if (!s || !file) return null;
  const entry = s;
  try {
    // Atomically: a source removed meanwhile (a reconversion after the person removed it) is never brought back.
    let started = false;
    await store.patch(id, (e) => {
      if (e.status === "removed") return e;
      started = true;
      return { ...e, status: "converting" };
    });
    if (!started) return null;
    const buf = await fs.readFile(file);
    const settings = o.settings ?? entry.settings;
    const runner = o.runner ?? workerRunner();
    const c = await runner.convert(entry.type, buf, {
      name: entry.path,
      ...(entry.pageRange ? { pageRange: entry.pageRange } : {}),
      ...(settings ? { settings } : {}),
      ...(entry.url !== undefined ? { link: true } : {}),
    });
    const pieces = piecesOf(c, entry.sheets);
    if (pieces.length === 0) throw new MaterialRefused(entry.type === "pdf" ? "scanned" : "unreadable");
    const { flags, sourceIssues } = checkPieces(pieces);
    const fragments: Fragment[] = pieces.map((p, i) => ({
      meta: {
        id: fragmentId(id, i + 1),
        source: entry.path,
        location: p.location,
        path: p.path,
        ...(p.kind ? { kind: p.kind } : {}),
        summary: firstSentence(p.md),
        keywords: [],
        tokens: estimateTokens(p.md),
        items: [],
        checks: flags[i].length ? flags[i] : "ok",
        validated: "not-reviewed",
      },
      md: p.md,
    }));
    await store.writeFragments(id, fragments);
    // The review reads every flagged fragment plus its sample of the rest (§6.2).
    const flagged = flags.filter((f) => f.length > 0).length;
    const reviewShare = (flagged + sampleSize(fragments.length, flagged)) / fragments.length;
    // Removed while it converted: it stays removed.
    const next = await store.patch(id, (e) => e.status === "removed" ? e : ({
      ...e,
      status: "validating",
      stage: "review",
      pages: c.pages,
      skippedPages: c.skippedPages,
      issues: sourceIssues,
      ...(settings ? { settings } : {}),
      estimate: estimateCost({ tokens: 0, items: o.items, fragments: fragments.length, reviewShare, ...(o.measured ? { measured: o.measured } : {}) }),
    }));
    await store.writeIndex();
    return next?.status === "removed" ? null : next;
  } catch (err) {
    // Stopped on purpose (a profile switch, closeRuntime): it stays `converting` and is converted again later.
    if (err instanceof ConvertStopped) return null;
    if (err instanceof NoSuchSheets && o.restore) {
      const before = o.restore;
      await store.patch(id, () => before).catch((e: unknown) => console.error("Could not undo a sheet choice", e));
      return null;
    }
    return refuse(store, id, err instanceof NoSuchSheets ? "unreadable" : reasonOf(err));
  }
}

/**
 * Intake (§3, §7): detect, refuse what can't be read (nothing is kept), keep the original, register the source,
 * measure, then process now or wait for the person. Never throws: a disk failure is the "storage" refusal, and an
 * original copied before it is removed again.
 */
export async function addSource(
  store: MaterialStore,
  file: { name: string; data: Buffer; url?: string; fetchedAt?: string },
  o: PipelineOptions & { accepts: readonly MaterialFamily[]; now?: Date },
): Promise<AddResult> {
  const refused = (reason: Refusal): AddResult => ({ ok: false, reason, message: refusalText(reason) });
  const detected = detectType(file.name, file.data.subarray(0, 65536));
  if (!detected.ok) return { ok: false, reason: detected.reason, message: detected.message };
  if (!o.accepts.includes(detected.family)) return refused("not-accepted");
  // Past the hard limit, measuring isn't worth it (nor copying the file into a worker).
  if (file.data.length > MAX_BYTES) return refused("too-big");
  const runner = o.runner ?? workerRunner();
  let measured: Measured;
  try {
    measured = await runner.measure(detected.type, file.data, file.name, file.url !== undefined);
  } catch (err) {
    return refused(reasonOf(err));
  }
  const decision = intakeDecision({
    family: detected.family,
    pages: measured.pages,
    sizeBytes: file.data.length,
    ...(measured.textPages !== undefined ? { textPages: measured.textPages } : {}),
    ...(measured.checked !== undefined ? { checked: measured.checked } : {}),
    ...(measured.rows !== undefined ? { rows: measured.rows } : {}),
  });
  if (decision.kind === "refuse") return refused(decision.reason);
  let name: string;
  try {
    name = await store.addOriginal(file.name, file.data);
  } catch (err) {
    console.error("Could not keep the original", err);
    return refused("storage");
  }
  const now = (o.now ?? new Date()).toISOString();
  let id = "";
  try {
    await store.update((list) => {
      // Chosen inside the registry queue, so two files added at once can't take the same id.
      id = sourceSlug(file.url ? file.url.replace(/^https?:\/\//, "") : name, new Set(list.map((s) => s.id)));
      const entry: SourceEntry = {
        id,
        scope: store.scope,
        path: name,
        ...(file.url ? { url: file.url, fetchedAt: file.fetchedAt ?? now } : {}),
        hash: createHash("sha256").update(file.data).digest("hex"),
        type: detected.type,
        family: detected.family,
        pages: measured.pages,
        sizeBytes: file.data.length,
        ...(measured.rows !== undefined ? { rows: measured.rows } : {}),
        skippedPages: [],
        status: "pending",
        ...(decision.kind === "wait" ? { notice: decision.notice } : {}),
        issues: [],
        fixes: [],
        estimate: estimateCost({ tokens: measured.tokens, items: o.items, ...(o.measured ? { measured: o.measured } : {}) }),
        used: 0,
        fragments: [],
        addedAt: now,
      };
      return [...list, entry];
    });
  } catch (err) {
    console.error("Could not register the source", err);
    // No entry names the copy: it goes, so nothing is kept.
    const orphan = store.originalPath(name);
    if (orphan) await fs.rm(orphan, { force: true }).catch(() => undefined);
    return refused("storage");
  }
  if (decision.kind === "wait") return { ok: true, id, waiting: true };
  await processSource(store, id, { items: o.items, runner, ...(o.measured ? { measured: o.measured } : {}) });
  return { ok: true, id, waiting: false };
}

/**
 * The person's answer to a waiting source (§7): a page range, the spreadsheet's choice, or going on as it is. A file
 * at the hard limit goes on only with a range of fewer than MAX_PAGES pages. The check and the move to `converting`
 * are one registry change, so a second answer finds the source no longer waiting. Null when the answer doesn't apply
 * (nothing changes) or the registry can't be written; never throws.
 */
export async function confirmSource(
  store: MaterialStore,
  id: string,
  choice: { pageRange?: [number, number]; sheets?: string[] | "summary" },
  o: PipelineOptions,
): Promise<SourceEntry | null> {
  const sheets = choice.sheets;
  if (sheets !== undefined && sheets !== "summary" && (!Array.isArray(sheets) || sheets.length === 0 || !sheets.every((n) => typeof n === "string"))) return null;
  let before: SourceEntry | undefined;
  try {
    await store.update((list) =>
      list.map((s) => {
        if (s.id !== id || s.status !== "pending" || s.notice === "full-review") return s;
        const r = choice.pageRange;
        const range =
          r && Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[0] >= 1 && r[1] >= r[0] && r[0] <= s.pages ? ([r[0], Math.min(r[1], s.pages)] as [number, number]) : undefined;
        if (s.notice === "max" && (!range || range[1] - range[0] + 1 >= MAX_PAGES)) return s;
        before = structuredClone(s);
        const { notice: _n, ...rest } = s;
        return { ...rest, status: "converting", ...(range ? { pageRange: range } : {}), ...(sheets ? { sheets } : {}) };
      }),
    );
  } catch (err) {
    console.error("Could not record the answer", err);
    return null;
  }
  if (!before) return null;
  return processSource(store, id, { ...o, restore: before });
}
