# Material processing — design

Status: approved by Marco on 2026-10-25, with every open question resolved by its proposal (where a question had none, the simplest option, noted in place). Not in the roadmap yet. Comes from harness discovery: the process definition, with the reasoning behind it, is `docs/discovery/2026-10-25-core-material-processing.md`.

## 1. Why

Several harnesses work on the person's own material: a student's textbook, a project's docs, a writer's sources. Without a core feature, each harness would reinvent the same pipeline, and most would get it wrong in one of two ways:

- **Too big.** The agent reads whole files on every turn. That costs tokens, fills the context and pushes out the task's decisions.
- **Not trustworthy.** Nothing checks that the converted text is right, so the AI builds on garbled pages, wrong reading order or broken tables.

This is pillar 3 applied to material: the best result with close to the best use of the person's resources.

## 2. Decisions (Marco, 2026-10-25)

- **D1. Core, not harness.** Every harness that takes material uses this feature. A harness only declares what it needs (§8).
- **D2. Process, not screens.** The core defines the process, the storage, the contracts and the events. It also ships one default UI component, which a harness may replace (§10).
- **D3. Small, easy-to-read pieces.** Material is converted to Markdown and cut into small fragments. No large converted copy is ever kept.
- **D4. Any file that already has text; nothing that needs reading from an image.**
  - Accepted: PDF, Word, spreadsheets, presentations, OpenDocument, ebooks, web pages, and any plain-text file (txt, md, csv, html, json, code…).
  - Refused, with the reason shown: photos, images, scanned pages, audio and video.
  - No OCR, and no AI transcription.
- **D5. A program does the work; the AI validates and decides.**
  - Converting, cutting and checking are deterministic and free.
  - The AI reviews only what the checks flag, plus a bounded sample.
  - It decides the fix. It may change structure, never content.
- **D6. The person is warned about cost** before any model runs. A large file triggers a warning and the offer of a page range.
- **D7. Load little, fetch on demand.** A task gets a short sheet plus an index of the fragments that concern it. It opens full fragments only when it needs them.

## 3. Formats

Every converter is a program, with no model, and its output is Markdown with location marks. The type is detected from the file's content (its magic bytes) first and its extension second, so a renamed file is still read correctly.

| Family | Formats | Converter | Location mark |
|---|---|---|---|
| PDF | `.pdf` with a text layer | `pdfjs-dist` (Apache-2.0). It reads text items with font size, weight and position. Headings come from relative font size and weight. Two columns are detected from the item positions. | `p.N` |
| Word processing | `.docx`, `.odt`, `.rtf` | `.docx`: `mammoth` (BSD-2), which maps Word heading styles to `#`/`##`, and lists and tables to Markdown. `.odt`: unzip (`jszip`, MIT) and read `content.xml` (`fast-xml-parser`, MIT), with headings taken from the outline levels. `.rtf`: a small text extractor. | heading path + paragraph number (these formats have no fixed pages) |
| Spreadsheet | `.xlsx`, `.ods`, `.csv`, `.tsv` | `exceljs` (MIT) for `.xlsx`; `jszip` + XML for `.ods`; a CSV parser for `.csv`/`.tsv`. Each sheet becomes a Markdown table. Formulas use their stored values. Empty rows and columns are dropped, and merged cells are repeated. | `Hoja!A1:F40` |
| Presentation | `.pptx`, `.odp` | `jszip` + XML. One section per slide: the title as heading, then text boxes in order, then speaker notes under "Notas". | `diap. N` |
| Ebook | `.epub` | `jszip`. The chapters' HTML goes through the web converter below. | chapter + heading |
| Web | a link, or an `.html` / `.htm` file | A link is fetched by the main process. `@mozilla/readability` (Apache-2.0) keeps the main content, and `turndown` (MIT) converts it. The fetch date is stored. | heading anchors |
| Plain text | `.txt`, `.md`, `.json`, `.xml`, `.yaml`, code files, and any unknown extension that decodes as text | Decoded as UTF-8, falling back to Windows-1252. `.md` is used as is. Structured data (`json`, `xml`, `yaml`) and code go in fenced blocks, cut at top-level keys or definitions. | line range |

**Conversion rules** (all by program):
- PDF: remove running headers, footers and page numbers that repeat on most pages, and join words split by an end-of-line hyphen.
- All families:
  - bullets become lists and tables become Markdown tables;
  - images inside any file become a placeholder `[imagen, <location>]`; they are not described;
  - comments and tracked changes in Word are dropped, and the accepted text is kept.

**Spreadsheets are cut by rows, not by headings.**
- A sheet becomes table fragments of about 600 tokens, and each fragment repeats the header row.
- Each sheet also gets one summary fragment, built by the program: its columns, the number of rows, and the first rows.
- A sheet above `MAX_ROWS` (2,000 to start) is a data dump, not reading material. The person is warned, and chooses: keep only the summary fragment plus the first rows, pick sheets or ranges, or go on with all of it at its cost.

**Refused at intake (D4), with the reason shown to the person:**
- Images, photos, audio and video: "La app solo trabaja con archivos que tienen texto."
- A PDF with no text layer on any page (scanned).
  - A PDF where only some pages have no text is accepted if the person agrees. Those pages are skipped and recorded as `skipped: no-text`.
- Password-protected or damaged files.
- Old binary Office formats (`.doc`, `.xls`, `.ppt`): "Guardalo como .docx / .xlsx / .pptx y subilo de nuevo." Open question §13.7.
- Any other file that does not decode as text (it contains NUL bytes, or mostly non-printable characters).

## 4. Storage

```
<folder>/material/<scope>/<original files>     ← visible, the person's, never changed
<folder>/.harness/material/<scope>/
  sources.json        registry: one entry per original
  sheet.md            the material sheet
  index.md            one line per fragment
  conflicts.md        material vs AI knowledge, and how each was resolved
  fragments/<sourceSlug>-<nnn>.md
  fragments/.orig/<id>.md                      ← the program's version of a fragment the AI repaired
```

- **Scope.** The harness's unit of material: a topic, a project. It is an id the harness passes when it adds material (§8).
- **History.**
  - Originals live in the visible folder, so the hidden history and the backup cover them.
  - `.harness/material/` can be rebuilt from the originals, so the history skips it, except `sources.json` and `conflicts.md`, which hold the person's decisions.
- **Token counts** are estimated as characters ÷ 4. No tokenizer dependency.

### 4.1 Fragment file

```markdown
---
id: fracciones-cap2-007
source: Fracciones-cap2.pdf
location: p.4–5
path: Fracciones › Fracciones equivalentes › Ejemplo 2
kind: example
summary: Obtiene 6/15 a partir de 2/5 multiplicando numerador y denominador por 3.
keywords: [equivalentes, multiplicar, numerador, denominador]
tokens: 240
items: [fracciones-equivalentes]
checks: ok
validated: sample
---

## Ejemplo 2
…
```

- `checks`: `ok`, or `flagged` with the reasons (§6.1).
- `validated`: one of
  - `sample`;
  - `flagged-reviewed`;
  - `repaired`;
  - `not-reviewed`;
  - `pending` (flagged during use, waiting for review).

### 4.2 `sources.json` entry

`{ id, scope, path | url, fetchedAt?, hash, type, pages, sizeBytes, pageRange?, skippedPages[], status, verdict?, issues[], fixes[], estimate, used, fragments[] }`

`status` is one of:
- `pending`;
- `converting`;
- `validating`;
- `needs-person`;
- `ready`;
- `refused`;
- `removed`.

### 4.3 `index.md`

One table row per fragment: `| id | where | path | kind | summary | items |`. A 60-page PDF gives about 80 rows, about 2,500 tokens.

## 5. Cutting (program)

These rules are for text. Spreadsheets are cut by rows (§3). Presentations start from one section per slide, and then the same merge rule applies.

1. Cut at headings (`#`–`###`). Each section is a candidate fragment.
2. More than 800 tokens: split at paragraph breaks into pieces of about 600. Never cut inside a paragraph, a list, a table, or a numbered exercise with its solution.
3. Fewer than 150 tokens: merge with the next section under the same parent heading.
4. Examples and exercises stay whole, even above the target size.
5. Every fragment carries its heading path.

The sizes are constants in the package (`TARGET`, `MAX`, `MIN`), to tune with measurements.

## 6. Validation

### 6.1 Program checks (every fragment, free)

| Check | Flags when |
|---|---|
| `garbled` | The share of non-letter characters is above a threshold, or the encoding is broken (replacement characters) |
| `reading-order` | Lines stop mid-sentence and continue elsewhere (the two-column symptom) |
| `size` | The fragment is far outside the size range, or the source produced only one or two fragments |
| `no-structure` | A long source has no headings |
| `table` | A table's rows have different column counts |
| `noise` | The fragment looks like a table of contents, an index or a bibliography, or is mostly numbers and dots |
| `leftover` | Repeated text survived header and footer removal |

### 6.2 AI review (one system task per source)

- **Tier:** `standard`. Repairs run at `light`.
- **Input:**
  - the list of fragments (id, path, size, first line);
  - every flagged fragment, in full;
  - a sample of unflagged ones: the first one plus 10%, at most 15.
- **Output:** a hidden core block `material_review` (schema-checked like any block):
  ```ts
  { source: string,
    verdict: "good" | "usable-with-fixes" | "not-usable",
    decisions: { id: string,
                 action: "ok" | "repair" | "merge" | "split" | "drop" | "reconvert" | "ask",
                 reason: string,
                 at?: string /* split point */,
                 with?: string /* merge target */ }[],
    fullReview?: boolean }
  ```
- **Repairs:** the agent sends `material_repair { id, markdown }`.
  - The program compares the words of the old and new text. If they differ by more than `REPAIR_MAX_WORD_DIFF` (2% to start), the repair is refused and the decision becomes `ask`.
  - The previous version is kept in `fragments/.orig/`.
- **Who carries out each decision:**
  - `merge`, `split` and `drop`: the program.
  - `reconvert`: the program converts once more with the other settings (column mode, another heading rule), then checks and review run again. A second `not-usable` sends the source to the person.
  - `ask`: the person decides (§10).
- **`fullReview: true`:** the sample found a problem the checks missed. The cost warning (§7) applies again, then every fragment of that source is reviewed in batches.
- **Flags during use.** The labelling step, or any agent in a task, can call `material_flag { id, reason }`. The fragment goes to `pending` and is left out of loading (§9) until it is reviewed again.

## 7. Cost warning

Before any model runs, intake measures the source and computes an estimate:

`fragments × (label + review share) tokens`

- The per-fragment costs come from measured averages in `usage.jsonl`. Until enough data exists, starting constants are used.
- The estimate is shown against the engine's reported usage window (plan 3b), with no prices.

Size is measured in pages for PDF, in estimated tokens for other files (a page is counted as about 500 tokens), and in rows for spreadsheets (`MAX_ROWS`, §3).

| Condition | What happens |
|---|---|
| Below `WARN_PAGES` (50) | Processing starts. A one-line notice says it uses the AI. |
| At or above `WARN_PAGES` | Warning with the estimate and the tip "subí solo los capítulos que necesitás". The person chooses: go on, a page range, or cancel. |
| At or above `MAX_PAGES` (300) or `MAX_BYTES` (50 MB) | The whole file is not processed. The person must pick a page range or cancel. |
| A full review is needed (§6.2) | Warning again, with that cost. |

The constants are placeholders until measured.

## 8. What a harness declares

```ts
material: {
  accepts: ["pdf", "word", "spreadsheet", "presentation", "ebook", "web", "text"],  // families from §3; default: all
  scopeLabel: { es: "tema", en: "topic" },
  sheet: {
    sections: [{ id: "terms", label: "Términos", prompt: "…" }, …],
    maxTokens: 800,
  },
  fragmentKinds: ["explanation", "definition", "example", "exercise"],
  items: { collection: "concepts", label: "name" },  // optional; a data collection (scopes-and-data spec)
  grounding: { default: "mixed", personCanChange: true },
  budget: { indexTokens: 600 },
  tiers: { review: "standard", label: "light", sheet: "light", link: "standard" },  // optional overrides
}
```

- **The sheet** always adds two sections: "notation and conventions" and "what the material does not cover".
- **`items`** tells the core where the harness keeps the things that fragments link to. Without it, there is no linking stage.
- **Tiers.** Each processing stage shows up in Settings › Modelos as a process the person can change, like any action.
- **`check`** (plan 4a) validates the field, and the guide asks about material in its "context" phase.

## 9. Use inside tasks

- **Load.** A task opened with a scope (`TaskManager` gets `scope` with the action) gets `sheet.md` plus the index rows linked to the task's items, cut to `budget.indexTokens`, in its first message, next to the notes index. A task with no items gets the sheet and the first rows of the index.
- **Fetch.** A `material` MCP server is added next to `ui` when the harness declares `material`. It offers:
  - `material_read(id)`;
  - `material_search(query, scope?)`, a local keyword search over summaries, keywords and text with `minisearch` (MIT), with no embeddings and no API key;
  - `material_flag(id, reason)`.

  The agent can also open a fragment file with its own read tool.
- **Ground.** The managed section of `AGENTS.md` adds the rules of the scope's mode:
  - `strict`: answer only from fragments, cite them, and say when the material does not cover something.
  - `mixed`: fragments first and cited; anything from the AI's own knowledge is marked apart.
  - Any mode: when the material and the AI disagree, follow the material, say so once, and record it in `conflicts.md`.

  Citations are written `[[frag:<id>]]`. The UI renders them as "<source>, <location>", linked to the original.
- **Update.**
  - A new or changed file (different hash) runs the pipeline for that source only.
  - Linking runs again, and changes to items go to the person.
  - A removed original retires its fragments and flags the items it leaves without material.

## 10. Runtime pieces

- **System tasks.**
  - Processing stages run as a new task kind, `system`. The `TaskManager` starts these tasks, never the person.
  - Each has its own short session, no `save_note` and no chat entry.
  - Each records `usage.jsonl` lines with `phase: "material"`, the stage and the source.
  - Permissions: `edit: none`, `web: none`; tools: the `material` server plus the hidden material blocks.
  - They run one at a time and never while a person's turn is live. A person's turn pre-empts the queue between stages.
  - This is the first instance of the "background/system jobs" candidate from dev discovery.
- **Package.** `packages/material`: converters, cutter, checks, word-diff guard, store, search, cost estimate and the MCP server. It has no UI.
- **Client contract** (`HarnessClient.material`):
  - `add(scope, file | url)` → estimate;
  - `confirm(sourceId, { pageRange? } | "cancel")`;
  - `decide(sourceId, fragmentId, choice)`;
  - `list(scope)`;
  - `remove(sourceId)`;
  - `setGrounding(scope, mode)`;
  - events: `material-status` and `material-ask`.
- **Default UI.** `@humanharness/ui` ships `MaterialPanel`:
  - add file or link;
  - the estimate and warning;
  - one status line per source ("Listo: 82 fragmentos, 3 páginas de índice descartadas, 2 tablas corregidas");
  - `ask` cards;
  - the grounding toggle.

  A harness may place it, restyle it or build its own on the same contract.

## 11. Measuring

- `usage.jsonl` gets one line per stage and source: tokens, tier and model.
- The core also counts how many fragments were flagged, repaired, dropped and asked about.
- `material-reads.jsonl` logs which fragments each task opened.
- What the numbers are for:
  - the cost estimate;
  - tuning the thresholds and sizes;
  - checking that sheet + index is enough (few fetches per task).

## 12. Delivery slices

1. **Program pipeline.**
   - Intake with refusals and cost warning.
   - Converters, cutter, checks and storage.
   - Load and fetch: the `material` MCP server, `read`, `search` and `flag`.
   - It works with no AI step: every fragment is `not-reviewed`.
2. **Validation.** System tasks, `material_review`, `material_repair` with the word-diff guard, `reconvert`, `ask` through the client contract, and `MaterialPanel`.
3. **Labels, sheet and linking.** Labelling, the sheet, `items` linking, coverage, `conflicts.md`, and the grounding rules in `AGENTS.md`.
4. **Update and measure.** Hash-based reprocessing, removal, `material-reads.jsonl`, and estimates from measured averages.

## 13. Open questions

1. **Scopes and items.** These depend on `2026-10-25-scopes-and-data-design.md`:
   - the scope id;
   - `material.items` as a data collection.

   That spec lands first. Without it, material works with the single scope `main` and with no linking stage.
2. *(merged into 1)*
3. **Privacy notice.** Validation and labelling send parts of the material to the engine's provider. Show it once at the first intake, or in setup?
4. **When processing runs.** Right after intake (proposed), or only when the person asks.
5. **Language.** The sheet's language when the material and the app differ.
6. **Thresholds.** `WARN_PAGES`, `MAX_PAGES`, `MAX_BYTES`, `MAX_ROWS`, the sample size, `REPAIR_MAX_WORD_DIFF` and the cut sizes are placeholders until measured.
7. ~~Old Office formats.~~ **Decided (Marco, 2026-10-25):** `.doc`, `.xls` and `.ppt` are refused in the first version, with the "guardalo como…" message.
8. **Libraries.** Their licenses and the bundle size: check them when planning slice 1.
