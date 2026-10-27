import type { MaterialFamily } from "@humanharness/harness-sdk";
import { MAX_BYTES, MAX_PAGES, MAX_ROWS, WARN_PAGES } from "./constants";
import type { Refusal, SourceEntry } from "./types";

export type IntakeDecision = { kind: "process" } | { kind: "wait"; notice: NonNullable<SourceEntry["notice"]> } | { kind: "refuse"; reason: Refusal };

/**
 * What intake does with a measured file (§7, §13.4): process now; wait for the person (the warning, a page range, the
 * spreadsheet choice, pages without text); or refuse. A PDF with no text layer at all is a scan (D4: no OCR).
 * `checked`: the PDF pages looked at for text (all of them unless the file is huge).
 */
export function intakeDecision(m: { family: MaterialFamily; pages: number; sizeBytes: number; textPages?: number; checked?: number; rows?: number }): IntakeDecision {
  if (m.textPages === 0) return { kind: "refuse", reason: "scanned" };
  if (m.pages >= MAX_PAGES || m.sizeBytes >= MAX_BYTES) return { kind: "wait", notice: "max" };
  if (m.rows !== undefined && m.rows > MAX_ROWS) return { kind: "wait", notice: "rows" };
  if (m.pages >= WARN_PAGES) return { kind: "wait", notice: "warn" };
  if (m.textPages !== undefined && m.textPages < (m.checked ?? m.pages)) return { kind: "wait", notice: "no-text-pages" };
  return { kind: "process" };
}
