import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import type { MaterialFamily } from "@humanharness/harness-sdk";
import { estimateTokens } from "@humanharness/workspace";
import { MaterialRefused } from "./blocks";
import { checkPieces } from "./checks";
import { FIRST_ROWS, MAX_PAGES } from "./constants";
import type { Measured } from "./convert";
import { type ConvertRunner, workerRunner } from "./convert/isolate";
import { sheetSummary } from "./convert/sheet";
import { type Piece, cutBlocks, cutRows } from "./cut";
import { REFUSAL_TEXT, detectType } from "./detect";
import { type MeasuredCosts, estimateCost } from "./estimate";
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

/** The pieces of a converted file: rows for spreadsheets (or the summary and first rows), sections for the rest. */
function piecesOf(c: Converted, sheets: SourceEntry["sheets"]): Piece[] {
  if (!c.sheets) return cutBlocks(c.blocks);
  if (sheets === "summary") return [{ path: "Summary", md: sheetSummary(c.sheets, FIRST_ROWS), location: c.sheets.map((s) => s.name).join(", "), pages: [1] }];
  const kept = Array.isArray(sheets) ? c.sheets.filter((s) => sheets.includes(s.name)) : c.sheets;
  return kept.flatMap(cutRows);
}

/**
 * Converts, cuts, checks and stores a source (§3, §5, §6.1): its fragments are usable at once (`not-reviewed`) and
 * the source goes `validating` at the `review` stage, with the AI stages' estimate. Any failure (a converter's
 * refusal, the worker's heap or time limit, a crash) marks it `refused`; it never throws for the file's sake.
 * Rebuilds the index.
 */
export async function processSource(store: MaterialStore, id: string, o: PipelineOptions & { settings?: ConvertSettings }): Promise<SourceEntry | null> {
  const s = await store.source(id);
  const file = s && store.originalPath(s.path);
  if (!s || !file) return null;
  await store.patch(id, (e) => ({ ...e, status: "converting" }));
  try {
    const buf = await fs.readFile(file);
    const settings = o.settings ?? s.settings;
    const runner = o.runner ?? workerRunner();
    const c = await runner.convert(s.type, buf, { name: s.path, ...(s.pageRange ? { pageRange: s.pageRange } : {}), ...(settings ? { settings } : {}) });
    const pieces = piecesOf(c, s.sheets);
    if (pieces.length === 0) throw new MaterialRefused(s.type === "pdf" ? "scanned" : "unreadable");
    const { flags, sourceIssues } = checkPieces(pieces);
    const fragments: Fragment[] = pieces.map((p, i) => ({
      meta: {
        id: fragmentId(id, i + 1),
        source: s.path,
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
    const flagged = flags.filter((f) => f.length > 0).length;
    const reviewShare = Math.min(1, (flagged + Math.ceil(fragments.length * 0.1) + 1) / fragments.length);
    const next = await store.patch(id, (e) => ({
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
    return next;
  } catch (err) {
    const reason = reasonOf(err);
    return store.patch(id, (e) => ({ ...e, status: "refused", refusal: reason }));
  }
}

/**
 * Intake (§3, §7): detect, refuse what can't be read (nothing is kept), keep the original, register the source,
 * measure, then process now or wait for the person.
 */
export async function addSource(
  store: MaterialStore,
  file: { name: string; data: Buffer; url?: string; fetchedAt?: string },
  o: PipelineOptions & { accepts: readonly MaterialFamily[]; now?: Date },
): Promise<AddResult> {
  const detected = detectType(file.name, file.data.subarray(0, 65536));
  if (!detected.ok) return { ok: false, reason: detected.reason, message: detected.message };
  if (!o.accepts.includes(detected.family)) return { ok: false, reason: "not-accepted", message: REFUSAL_TEXT["not-accepted"] };
  const runner = o.runner ?? workerRunner();
  let measured: Measured;
  try {
    measured = await runner.measure(detected.type, file.data, file.name);
  } catch (err) {
    const reason = reasonOf(err);
    return { ok: false, reason, message: refusalText(reason) };
  }
  const decision = intakeDecision({
    family: detected.family,
    pages: measured.pages,
    sizeBytes: file.data.length,
    ...(measured.textPages !== undefined ? { textPages: measured.textPages } : {}),
    ...(measured.checked !== undefined ? { checked: measured.checked } : {}),
    ...(measured.rows !== undefined ? { rows: measured.rows } : {}),
  });
  if (decision.kind === "refuse") return { ok: false, reason: decision.reason, message: refusalText(decision.reason) };
  const name = await store.addOriginal(file.name, file.data);
  const now = (o.now ?? new Date()).toISOString();
  let id = "";
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
  if (decision.kind === "wait") return { ok: true, id, waiting: true };
  await processSource(store, id, { items: o.items, runner, ...(o.measured ? { measured: o.measured } : {}) });
  return { ok: true, id, waiting: false };
}

/**
 * The person's answer to a waiting source (§7): a page range, the spreadsheet's choice, or going on as it is. A file
 * at the hard limit goes on only with a range of fewer than MAX_PAGES pages. Null when the answer doesn't apply.
 */
export async function confirmSource(
  store: MaterialStore,
  id: string,
  choice: { pageRange?: [number, number]; sheets?: string[] | "summary" },
  o: PipelineOptions,
): Promise<SourceEntry | null> {
  const s = await store.source(id);
  if (!s || s.status !== "pending" || s.notice === "full-review") return null;
  const r = choice.pageRange;
  const range =
    r && Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[0] >= 1 && r[1] >= r[0] && r[0] <= s.pages ? ([r[0], Math.min(r[1], s.pages)] as [number, number]) : undefined;
  if (s.notice === "max" && (!range || range[1] - range[0] + 1 >= MAX_PAGES)) return null;
  await store.patch(id, (e) => {
    const { notice: _n, ...rest } = e;
    return { ...rest, ...(range ? { pageRange: range } : {}), ...(choice.sheets ? { sheets: choice.sheets } : {}) };
  });
  return processSource(store, id, o);
}
