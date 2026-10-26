import type { z } from "zod";
import type { Block, SkippedAnswer } from "./block";
import type { Language } from "./index";
import { type InputField, inputFields } from "./input";

/** `<task id>:<turn>:<index of the block in the turn>` (input-blocks spec §4). */
export const BLOCK_ID = /^[A-Za-z0-9-]{1,100}:\d{1,6}:\d{1,4}$/;
export const blockIdOf = (task: string, turn: number, index: number): string => `${task}:${turn}:${index}`;

/** An answer whose JSON is longer than this is refused (the block's own bounds come first). */
export const ANSWER_MAX_CHARS = 50_000;
/** Harness code on an answer (`display`, `saveTo.records`) slower than this is logged: it can't be stopped (spec §11.3). */
export const ANSWER_CODE_SLOW_MS = 100;

/** A problem with an answer: `path` is the field (zod path joined with dots), "" for the whole answer. */
export interface InputIssue {
  path: string;
  message: string;
}

/** An answer as the chat log keeps it on its block (spec §8). */
export interface BlockAnswer {
  blockId: string;
  value: Record<string, unknown>;
  answeredAt: string;
}

/**
 * What `client.respond` resolves with: taken (with the chat's line), or refused with nothing run. `busy` and
 * `failed` are the window's own refusals (a turn runs; the call itself failed).
 */
export type RespondResult =
  | { ok: true; display: string; value: Record<string, unknown>; answeredAt: string }
  | { ok: false; reason: "stale" | "invalid" | "refused" | "stopped" | "busy" | "failed"; errors: InputIssue[] };

export const SKIPPED: SkippedAnswer = { skipped: true };

export function isSkipped(value: unknown): value is SkippedAnswer {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 1 && (value as { skipped?: unknown }).skipped === true;
}

export const inputIssues = (error: z.ZodError): InputIssue[] => error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));

/** Checks an answer against the block's input (spec D3). A skip counts only for a `skippable` block. */
export function parseAnswer(
  block: Pick<Block, "input" | "skippable">,
  raw: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; errors: InputIssue[] } {
  if (!block.input) return { ok: false, errors: [{ path: "", message: "This block takes no answer" }] };
  if (isSkipped(raw)) return block.skippable ? { ok: true, value: { ...SKIPPED } } : { ok: false, errors: [{ path: "", message: "This question can't be skipped" }] };
  const parsed = block.input.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: inputIssues(parsed.error) };
  const value = parsed.data as Record<string, unknown>;
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    // A cyclic or otherwise unserializable value (possible through z.unknown or z.record).
    return { ok: false, errors: [{ path: "", message: "The answer can't be sent as JSON" }] };
  }
  if (json.length > ANSWER_MAX_CHARS) return { ok: false, errors: [{ path: "", message: `The answer is too long: keep it under ${ANSWER_MAX_CHARS} characters` }] };
  return { ok: true, value };
}

const WORDS: Record<Language, { yes: string; no: string; skipped: string; empty: string; answer: string }> = {
  es: { yes: "sí", no: "no", skipped: "(saltado)", empty: "(respuesta vacía)", answer: "respuesta a" },
  en: { yes: "yes", no: "no", skipped: "(skipped)", empty: "(empty answer)", answer: "answer to" },
};

function textOf(field: InputField, v: unknown, language: Language): string {
  if (v === undefined || v === null) return "";
  if (field.kind === "boolean") return v === true ? WORDS[language].yes : WORDS[language].no;
  if (field.kind === "multiChoice" && Array.isArray(v)) return v.map(String).join(", ");
  if (field.kind === "pairs" && Array.isArray(v) && field.columns) {
    return v.map((row) => field.columns!.map((c) => String((row as Record<string, unknown> | null)?.[c.name] ?? "")).join(" → ")).join("; ");
  }
  return typeof v === "string" || typeof v === "number" ? String(v) : JSON.stringify(v);
}

/** The core's readable line (spec §4): one `<label>: <value>` paragraph per answered field. */
export function readableAnswer(block: Pick<Block, "input" | "inputUi" | "schema">, value: Record<string, unknown>, language: Language): string {
  if (isSkipped(value)) return WORDS[language].skipped;
  const parts = inputFields(block).flatMap((f) => {
    const text = textOf(f, value[f.name], language).trim();
    return text ? [`${f.label[language]}: ${text}`] : [];
  });
  return parts.join("\n\n") || WORDS[language].empty;
}

/**
 * Runs harness code, logging it when slow. It copies nothing: the caller hands the code a `structuredClone` of the
 * answer. (`performance` is global in Node and browsers.)
 */
export function timed<T>(what: string, run: () => T, log: (message: string) => void, now: () => number = () => performance.now()): T {
  const started = now();
  try {
    return run();
  } finally {
    const ms = now() - started;
    if (ms > ANSWER_CODE_SLOW_MS) log(`The ${what} took ${Math.round(ms)} ms: keep it small and pure`);
  }
}

/** The chat's line for an answer: the block's `display` when it gives a non-empty string, else the core's line. */
export function answerDisplay(
  name: string,
  block: Block,
  value: Record<string, unknown>,
  language: Language,
  log: (message: string) => void = console.error,
  now?: () => number,
): string {
  const core = readableAnswer(block, value, language);
  const display = block.display;
  if (!display) return core;
  try {
    const line = timed(`display of "${name}"`, () => display.call(block, structuredClone(value) as never, language), log, now);
    if (typeof line === "string" && line.trim()) return line.trim();
    log(`The display of "${name}" gave no text: the core's line is used`);
  } catch (err) {
    log(`The display of "${name}" failed (${err instanceof Error ? err.message : String(err)}): the core's line is used`);
  }
  return core;
}

/** The next turn's message (spec §4): a header, the readable line, then the exact JSON the agent relies on. */
export function answerMessage(o: { name: string; blockId: string; value: Record<string, unknown>; display: string; language: Language }): string {
  const json = JSON.stringify({ block: o.name, blockId: o.blockId, value: o.value });
  return `[${WORDS[o.language].answer} ${o.name}]\n${o.display}\n\n\`\`\`json\n${json}\n\`\`\``;
}

const ANSWER_FENCE = /```json\n([^\n]+)\n```\s*$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The answer a turn message carries (its last json fence), or null for any other message. */
export function readAnswer(message: string): { block: string; blockId: string; value: Record<string, unknown> } | null {
  const m = ANSWER_FENCE.exec(message);
  if (!m) return null;
  try {
    const parsed: unknown = JSON.parse(m[1]);
    if (isObject(parsed) && typeof parsed.block === "string" && typeof parsed.blockId === "string" && isObject(parsed.value)) {
      return { block: parsed.block, blockId: parsed.blockId, value: parsed.value };
    }
  } catch {
    // not an answer
  }
  return null;
}

/**
 * The records an answer's `saveTo` writes (spec §6): none for a skip; the value itself without `records`; else what
 * the block's `records` returns from a copy of it. Throws when that isn't a list of objects (the answer is refused).
 */
export function answerRecords(
  name: string,
  block: Block,
  value: Record<string, unknown>,
  log: (message: string) => void = console.error,
  now?: () => number,
): Record<string, unknown>[] {
  const save = block.saveTo;
  if (!save || isSkipped(value)) return [];
  if (!save.records) return [structuredClone(value)];
  const records: unknown = timed(`saveTo.records of "${name}"`, () => save.records!.call(save, structuredClone(value) as never), log, now);
  if (!Array.isArray(records) || !records.every((r) => typeof r === "object" && r !== null && !Array.isArray(r))) {
    throw new Error(`saveTo.records of "${name}" must return a list of records`);
  }
  return records as Record<string, unknown>[];
}
