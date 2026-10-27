import type { MaterialFamily } from "@humanharness/harness-sdk";

/** A detected file type (spec §3). */
export type MaterialType =
  | "pdf"
  | "docx"
  | "odt"
  | "rtf"
  | "xlsx"
  | "ods"
  | "csv"
  | "tsv"
  | "pptx"
  | "odp"
  | "epub"
  | "html"
  | "md"
  | "txt"
  | "json"
  | "xml"
  | "yaml"
  | "code";

/** Why a file is refused at intake (§3 "Refused at intake"). */
export type Refusal = "media" | "old-office" | "binary" | "unreadable" | "scanned" | "protected" | "too-big" | "not-accepted" | "fetch" | "storage";

export type Detected = { ok: true; type: MaterialType; family: MaterialFamily } | { ok: false; reason: Refusal; message: string };

/**
 * One piece of converted text, already Markdown (`md`), with its location mark (`loc`) and its page: the PDF page,
 * the slide, or an estimated page of PAGE_TOKENS for files without pages, so a page range works for every family.
 */
export interface MdBlock {
  kind: "heading" | "para" | "list" | "table" | "code" | "image";
  /** Headings only: 1–6. */
  level?: number;
  md: string;
  loc: string;
  page: number;
}

/** What a converter gives back. */
export interface Converted {
  blocks: MdBlock[];
  /** Pages (PDF), slides, or estimated pages. */
  pages: number;
  /** PDF pages with no text layer (accepted only when the person agreed). */
  skippedPages: number[];
  /** Spreadsheets: each sheet's header row and data rows, cut by rows, not headings (§3). */
  sheets?: SheetRows[];
}

/** One sheet of a spreadsheet: its name, its header row and its data rows as Markdown table rows. */
export interface SheetRows {
  name: string;
  /** `| a | b |\n|---|---|` */
  header: string;
  rows: { md: string; loc: string }[];
  /** The columns' names, for the summary fragment. */
  columns: string[];
  /** The file held more than a spreadsheet may read (cells, rows, columns): only its first part is here. */
  cut?: true;
}

/** How a converter may run a second time (§6.2 `reconvert`). */
export interface ConvertSettings {
  /** PDF: read two columns left then right. Absent: detected. */
  columns?: boolean;
  /** PDF: headings by font weight instead of size. */
  headingsByWeight?: boolean;
}

/** `validated` in a fragment's front matter (§4.1). */
export type Validation = "sample" | "flagged-reviewed" | "repaired" | "not-reviewed" | "pending";

/** The checks a fragment failed (§6.1). */
export type CheckName = "garbled" | "reading-order" | "size" | "no-structure" | "table" | "noise" | "leftover";

/** A fragment's front matter (§4.1), English. */
export interface FragmentMeta {
  id: string;
  source: string;
  location: string;
  path: string;
  kind?: string;
  summary: string;
  keywords: string[];
  tokens: number;
  items: string[];
  checks: "ok" | CheckName[];
  validated: Validation;
}

export interface Fragment {
  meta: FragmentMeta;
  md: string;
}

/** A source's status (§4.2). */
export type SourceStatus = "pending" | "converting" | "validating" | "needs-person" | "ready" | "refused" | "removed";

/** The per-source stage a validating source waits for, or runs. */
export type SourceStage = "review" | "repair" | "label";

/** One `sources.json` entry (§4.2). */
export interface SourceEntry {
  id: string;
  scope: string;
  /** The original's file name inside the scope's material folder. */
  path: string;
  /** A link: where it came from, and when. */
  url?: string;
  fetchedAt?: string;
  hash: string;
  type: MaterialType;
  family: MaterialFamily;
  pages: number;
  sizeBytes: number;
  /** Spreadsheets: rows across all sheets. */
  rows?: number;
  pageRange?: [number, number];
  /** Spreadsheets: the sheets kept, or only the summary and first rows. */
  sheets?: string[] | "summary";
  skippedPages: number[];
  status: SourceStatus;
  stage?: SourceStage;
  /** Why it waits (`pending`). */
  notice?: "warn" | "max" | "rows" | "full-review" | "no-text-pages";
  refusal?: Refusal;
  verdict?: "good" | "usable-with-fixes" | "not-usable";
  /** What the checks and the review found, one English line each. */
  issues: string[];
  /** What was fixed, one English line each. */
  fixes: string[];
  /** Estimated tokens of the AI stages still to run. */
  estimate: number;
  /** How many times a task read one of its fragments. */
  used: number;
  fragments: string[];
  /** Reconversions done (§6.2: a second `not-usable` goes to the person). */
  reconverted?: number;
  /** The settings the last conversion used (§6.2 `reconvert`). */
  settings?: ConvertSettings;
  /** An AI stage failed: the status line says "Not checked by the AI" and offers Try again. */
  failed?: SourceStage | "sheet" | "link";
  /** Review (§6.2): the fragments still to review, in batches of BATCH. */
  reviewQueue?: string[];
  /** Repairs the review asked for, waiting for the repair stage. */
  repairs?: { id: string; issue: string }[];
  /** Questions for the person (§6.2 `ask`); `choices` are ids the window names. */
  asks?: MaterialAsk[];
  /** Labelling (§10): how many fragments have their labels so far; gone once the source is ready. */
  labelled?: number;
  /** The person agreed to a full review (§7). */
  fullReview?: boolean;
  addedAt: string;
}

/** A question for the person: about one fragment, or the whole source. */
export interface MaterialAsk {
  fragment?: string;
  question: string;
  choices: ("keep" | "drop" | "program" | "use" | "remove")[];
}
