// Every threshold and size of material processing (spec §3, §5, §6, §7). They are placeholders until measured
// (spec §13.6): change them here only.

/** A fragment's target size, in estimated tokens (§5). */
export const TARGET = 600;
/** Above this a section is split at paragraph breaks (§5.2). */
export const MAX = 800;
/** Below this a section is merged with the next one under the same parent (§5.3). */
export const MIN = 150;
/** A sheet above this many rows is a data dump (§3). */
export const MAX_ROWS = 2000;
/** The rows a "summary and first rows" spreadsheet keeps, and the summary fragment shows. */
export const FIRST_ROWS = 20;
/** At or above: the warning and the page-range offer (§7). */
export const WARN_PAGES = 50;
/** At or above: the whole file is not processed (§7). */
export const MAX_PAGES = 300;
/** At or above: the whole file is not processed, and a link is not fetched past it (§7). */
export const MAX_BYTES = 50 * 1024 * 1024;
/** A page of a file without pages, in estimated tokens (§7). */
export const PAGE_TOKENS = 500;
/** The share of words a repair may change (§6.2). */
export const REPAIR_MAX_WORD_DIFF = 0.02;
/** The review's sample: the first unflagged fragment plus this share of the rest, at most SAMPLE_MAX (§6.2). */
export const SAMPLE_SHARE = 0.1;
export const SAMPLE_MAX = 15;
/** Fragments per batch in the label stage and a full review. */
export const BATCH = 20;
/** Starting per-fragment token costs of each AI stage, until usage.jsonl has measured ones (§7). */
export const LABEL_TOKENS = 700;
export const REVIEW_TOKENS = 900;
export const LINK_TOKENS = 120;
export const SHEET_TOKENS = 4000;
/** Measured stages needed before averages replace the constants. */
export const MEASURED_MIN = 5;
/** Checks (§6.1). */
export const GARBLED_SHARE = 0.4;
export const NOISE_SHARE = 0.4;
/** A line repeated in this many fragments of a source is a header or footer that survived. */
export const LEFTOVER_REPEATS = 3;
/** A PDF line repeated on this share of pages is a running header or footer (§3 conversion rules). */
export const RUNNING_SHARE = 0.6;
/** A long source with no headings: above this many tokens. */
export const NO_STRUCTURE_TOKENS = 3000;
/** How long a link fetch may take. */
export const FETCH_TIMEOUT_MS = 30_000;
/** Zip containers (docx, odt, xlsx, ods, pptx, odp, epub): a file with more entries than this is a zip bomb. */
export const ZIP_MAX_ENTRIES = 10_000;
/** The uncompressed bytes a whole zip may hold (declared) and inflate (counted). */
export const ZIP_MAX_TOTAL = 20 * MAX_BYTES;
/** The uncompressed bytes one zip entry may inflate to. */
export const ZIP_MAX_ENTRY = 4 * MAX_BYTES;
