# Material

Spec: `docs/superpowers/specs/2026-10-25-material-processing-design.md` ("§" below). The process is defined in `docs/discovery/2026-10-25-core-material-processing.md`.

## What it is

- The person's own files (a textbook chapter, class notes, a spreadsheet, slides, an ebook, a web page) become small Markdown fragments. A task in a scope starts with a short sheet and an index of them, and fetches whole fragments on demand through the `material` MCP server.
- A program (no model) converts, cuts and checks each file. Then AI stages review a bounded part of it, repair structure (never content), label the fragments, write the scope's sheet and link fragments to the harness's items. The person is told the cost before any model runs on a big file.
- Nothing of this exists without `material` in the manifest (D0): no `AppState.material`, no `material/` or `.harness/material/` folder, no `material` server, no Material part in `AGENTS.md`, no section in the first message, no Settings › Models rows, no queue, the same history keep list and the same usage summary. `hasMaterial(h)` (`packages/harness-sdk/src/material.ts`) is the gate.
- D0 holds for the code that loads too. The app and the runtime import `@humanharness/material/light` (`packages/material/src/light.ts`): storage, search, the material section, the server's spec, the stages and the worker runner, without the converters. The shell's `MaterialService` (`./material`) and `fetchLink` (`./material-fetch`) are imported lazily in `buildMaterial()` (`packages/shell/src/main/index.ts`), only for a harness with `material`. The converters (pdfjs, exceljs, mammoth, linkedom…) load only in the converter worker. Keep it that way: a new import from `@humanharness/material` (the barrel) in the shell main process, the runtime, `material-requests.ts` or `material-fetch.ts` breaks D0.

## The manifest

`material` (`materialSchema` in `packages/harness-sdk/src/material.ts`). Every label and prompt is one English string.

- `accepts`: the families the harness takes: `pdf`, `word`, `spreadsheet`, `presentation`, `ebook`, `web`, `text`. Default: all of them. Each at most once.
- `sheet.sections`: 1–8 sections the AI writes once per scope, each `{ id, label (≤ 80), prompt (≤ 400) }`, ids unique. The core adds two of its own (`CORE_SHEET_SECTIONS`): `notation` ("Notation and conventions") and `not-covered` ("What the material does not cover"); a harness can't declare those ids. `sheet.maxTokens`: 200–3000, default 800.
- `fragmentKinds`: 1–12 ids, default `["explanation", "definition", "example", "exercise"]`. The label stage picks one per fragment.
- `items` (optional): `{ collection, label }`. A collection declared in `data`, with a `key` (not `single`), visible to the agent (not `agent: "none"`: linking sends its labels to the engine's provider), and `label` a field of its schema. Without `items` there is no links stage and no coverage.
- `grounding`: `default` `strict` or `mixed` (default `mixed`), `personCanChange` (default `true`).
- `budget.indexTokens`: 100–3000, default 600. The index rows' budget in a task's first message.
- `tiers`: a tier per stage, overriding the core's defaults: `review` standard, `repair` light, `label` light, `sheet` light, `link` standard (`DEFAULT_STAGE_TIERS`, `stageTier`).
- Reserved action ids: `material-review`, `material-repair`, `material-label`, `material-sheet`, `material-link` (`MATERIAL_STAGE_KEYS`, `materialStageKey`). With `material`, an action can't use them: Settings › Models keys each stage's setting by them (`config.json` → `models.tasks`).
- The scope is the harness's own (`scopes`); without scopes there is one, `main`. `_app` never has material.
- `humanharness check` warns about `material.tiers.review` set to `light` (`material-review-tier`) and an `items` collection that is app-wide in a harness with scopes (`material-items-scope`).

## Where things live

Paths come from `packages/workspace/src/layout.ts`. `<base>` is `baseOf(config)`: the folder, or in a harness with profiles the active profile's folder, so each profile has its own material, processes it with its own runs and pays for it in its own `usage.jsonl`. There is no shared library across profiles.

```
<base>/material/<scope>/<original>          visible, the person's (materialDir)
<base>/.harness/material/<scope>/           (materialStoreDir)
  sources.json        the registry: one entry per original (SourceEntry)
  index.md            one row per usable fragment
  sheet.md            the scope's sheet
  conflicts.md        material vs the AI's knowledge, one line each
  grounding.json      the scope's mode, once the person changed it
  fragments/<id>.md   a fragment: front matter + Markdown
  fragments/.orig/<id>.md   the program's version of a fragment the AI merged, split, dropped or repaired
  .stale              the scope's next stage (sheet or link) and a token
<base>/.harness/material-reads.jsonl        every material_read: { at, task, scope, id } (materialReadsFile)
```

- An original keeps its name; a name already used gets ` (2)` before its extension. A link's page is saved as `<slug>.html` (or `.pdf` when the link serves a PDF), with `url` and `fetchedAt` in the registry, so reprocessing works offline.
- A source id is a slug of the file name or of the link's host and path, unique in the scope; a fragment id is `<source id>-<nnn>` (`001` on).
- `MaterialStore` (`packages/material/src/store.ts`) is the only code that writes these files. Writes are atomic. Registry changes run one at a time inside one store object: `update`/`patch` for a single change, `transact(job)` when fragment files and the registry change together. Inside `transact` the job changes the registry only through the `rewrite` it receives; calling `update` from inside waits on itself.
- The registry owner is the app. The `material` MCP server writes nothing: its tools go to the app over RPC. `MaterialService` keeps one `MaterialStore` per (base, scope) (`storeAt`) and everything uses that one (the window, the agent's tools, the queue), since a second object would bypass the write queue.
- `.stale` moves only through `moveStale(seen, next)` (compare and set), so a mark set again while a scope stage runs is not lost.
- **History.** The originals are visible files, so the history tracks them. Under `.harness/` it keeps `sources.json`, `conflicts.md` and `grounding.json` of each scope (`MATERIAL_KEEP`, a pattern entry `{ prefix, match, depth }` of `History`'s keep list, `packages/workspace/src/history.ts`): they hold the person's decisions. Fragments, `.orig/`, `index.md`, `sheet.md` and `.stale` are rebuilt from the originals and are never tracked. `MATERIAL_KEEP` is in the keep list only for a harness with material: `historyKeep(harness)` in `packages/shell/src/main/material-ipc.ts` (the shell's history) and `runtime.ts` (the runtime's).
- Each change the app makes (an intake, an answer, a removal, a stage's result, the grounding mode) is one `Material: <what>` commit under the open task's trailer (`afterChange` in `buildMaterial()`).

## The program pipeline

`packages/material/src/pipeline.ts`: `addSource` (intake), `confirmSource` (the person's answer), `processSource` (convert → cut → check → store), `refreshSources` (originals changed by hand). None of them throws: a failure is a refusal or a logged no-op.

**Detection** (`detect.ts`): magic bytes first, the extension second. Images, audio and video are refused ("The app only works with files that have text."); old Office formats (`.doc`, `.xls`, `.ppt`, or the OLE header) are refused ("Save it as .docx, .xlsx or .pptx and add it again."); a file with NUL bytes or more than 10% control characters is binary. A BOM says text: UTF-16 with a BOM is decoded, a UTF-8 BOM is skipped. A family the harness doesn't accept is refused ("This app doesn't take this kind of file.").

**Converters** (`convert/`), all into one block model, `MdBlock { kind, level?, md, loc, page }`. `page` is the PDF page, the slide, or an estimated page of `PAGE_TOKENS` (500), so a page range works for every family.

- Text, Markdown, JSON, XML, YAML, code (`text.ts`): UTF-8, else Windows-1252; code and structured data are fenced, split by lines when long.
- HTML (`html.ts`): a DOM walker over `linkedom`; `script`, `style`, `iframe`, `object` and `form` are dropped. A link goes through `@mozilla/readability` first; a saved file is read whole.
- PDF (`pdf.ts`): `pdfjs-dist` in the converter's thread, no font loading, no system fonts, no XFA. Running headers and footers are dropped, two columns are read left then right only with a real empty gutter, headings by font size (or by weight on a reconversion). Pages without text are skipped (with the person's consent); a PDF with none is "scanned".
- Word (`word.ts`): docx through `mammoth` (its HTML into the walker); odt through `jszip` + `fast-xml-parser`; RTF by a small reader of its own (`rtfText`).
- Spreadsheets (`sheet.ts`): xlsx through `exceljs` (values only, formulas give their cached result), ods, csv/tsv (RFC 4180 quotes). Empty columns go; a file reads at most `SHEET_MAX_ROWS` (100,000) rows, `SHEET_MAX_CELLS` (1,000,000) cells and `SHEET_MAX_COLUMNS` (1,024) columns per sheet, and a sheet cut there says so.
- Presentations (`slides.ts`): pptx in the presentation's order, odp; each slide is `## <title or Slide n>`, its text, image placeholders, then its notes.
- Ebooks (`epub.ts`): chapters in spine order through the HTML walker under `ch. N`. A DRM lock is refused; standard font obfuscation is not a lock.
- Zip containers (docx, odt, xlsx, ods, pptx, odp, epub) open through one guard (`zip.ts`): at most `ZIP_MAX_ENTRIES` entries, `ZIP_MAX_TOTAL` bytes in all, `ZIP_MAX_ENTRY` per counted entry and `ZIP_MAX_PART` per parsed one, the inflated bytes counted as they come.
- Nothing in a file runs: no macros, no scripts, no remote fetch from inside a document. An image becomes `[image, <location>]` (no description, D4).

**Location marks** are English: `p.4`, `§ Heading › Sub ¶3`, `Sheet1!A1:F40` (sheet names unquoted), `slide 3`, `ch. 2 › Heading`, `lines 10–40`.

**Worker isolation** (`convert/isolate.ts`, `convert/worker.ts`). Files are untrusted, and pdfjs decodes images, zip and XML parsers build big trees, so every conversion and measure runs in a `worker_threads` Worker with `resourceLimits` (`CONVERT_HEAP_MB`, 1,536 MB of heap) and a time limit (`CONVERT_TIMEOUT_MS`, 120 s). A heap overflow or a timeout is the "too-big" refusal, a crash "unreadable"; the app lives on. `limitRunner` lets at most `CONVERT_AT_ONCE` (2) workers run at once, the rest wait in order; the app shares one runner. The shell builds the worker as its own entry (`material-worker.js` in `packages/shell/electron.vite.config.ts`, next to `material-server.js`); in tests `workerRunner()` runs the TypeScript source through tsx. A stop (`closeRuntime`) ends the workers (`ConvertStopped`): their sources stay `converting` and are converted again on the base's next use.

**Intake** (`addSource`, `intakeDecision` in `intake.ts`):

- Above `MAX_BYTES` (50 MB) a file is refused before it is measured ("This file is too big. Add only the chapters you need.").
- Measure (`measureFile`): a PDF's pages and text pages, a spreadsheet's rows, any other file's estimated pages.
- No text page at all: refused ("This PDF is scanned: it has no text the app can read.").
- At or above `MAX_PAGES` (300): the source waits (`pending`, notice `max`) until the person picks a range shorter than `MAX_PAGES`, or cancels.
- More than `MAX_ROWS` (2,000) rows: it waits (`rows`) for "Summary and first rows" (`FIRST_ROWS`, 20, per sheet) or "All of it". Single sheets are `confirm(id, { sheets })` from a harness's own UI; the default panel has no sheet picker.
- At or above `WARN_PAGES` (50): it waits (`warn`) for "Go on" or a range.
- Some pages without text: it waits (`no-text-pages`); those pages are skipped.
- Otherwise it is processed at once (free) and the AI stages are queued.
- The original is kept and the source registered before processing; a disk failure is the "storage" refusal and leaves nothing behind. Refusals at detection keep nothing.

**Cutting** (`cut.ts`, §5): sections at headings `#`–`###`; a section above `MAX` (800 tokens) is split at block boundaries into pieces near `TARGET` (600) (tables, lists and paragraphs stay whole, code splits by lines); a section below `MIN` (150) merges with the next under the same parent; an example or an exercise stays whole. Spreadsheet rows are cut into tables near `TARGET`, each repeating the header row, with their own `Sheet!A2:C9` location. Tokens are characters ÷ 4 (`estimateTokens`).

**Checks** (`checks.ts`, §6.1), on every fragment, free: `garbled` (a replacement character, or more than `GARBLED_SHARE` of the prose neither letters nor digits), `reading-order` (paragraphs that break mid-sentence), `size` (above `MAX` or far below `MIN`, unless kept whole; or the whole file became too few fragments), `no-structure` (a long source with no headings, `NO_STRUCTURE_TOKENS`), `table` (rows of different widths), `noise` (a contents, index or bibliography section, or prose that is mostly page numbers or digits; `NOISE_SHARE`), `leftover` (a line repeated in `LEFTOVER_REPEATS` fragments: a header or footer that survived). Tables and fenced code are not read as prose. Source-wide findings go to the entry's `issues`.

**Storing.** Fragments are written `validated: not-reviewed` and are usable at once; the source goes `validating` at the `review` stage, with the AI stages' estimate; `index.md` is rebuilt. Any failure marks the source `refused` with no fragments.

**Updates** (`refreshSources`, §11), once per kick per scope: an original whose size or time changed is hashed; a changed one goes through intake again under the same id (above `MAX_BYTES` refused, a size that needs the person's answer waits again with a new estimate), its stages and `.orig/` copies cleared. A missing one (`ENOENT`, `ENOTDIR`) is removed like the person's Remove; any other read error is logged and skipped.

**Removal** (`removeSource` in `decide.ts`): the original goes to the system Trash (`shell.trashItem`), never deleted for good; the fragments and `.orig/` copies go; the source stays in the registry as `removed`; `.stale` is set so the sheet and links run again.

## Cost

- Estimate (`estimateCost` in `estimate.ts`, §7): `fragments × (LABEL_TOKENS + REVIEW_TOKENS × reviewShare + (items ? LINK_TOKENS : 0)) + SHEET_TOKENS`. Before conversion `fragments` is tokens ÷ `TARGET` and `reviewShare` is `SAMPLE_SHARE`; after it, the real count and the share the review will read (flagged + `sampleSize(n, flagged)`).
- Measured costs (`measuredMaterialCosts` in `packages/shell/src/main/usage-log.ts`): once a stage has `MEASURED_MIN` (5) lines in the base's `usage.jsonl` that ran, report usage and count their fragments, its average per fragment (the sheet's per run) replaces the constant.
- The person is asked at `WARN_PAGES`, `MAX_PAGES` and `MAX_ROWS` (above), and before a full review. The card says "About N tokens" and, when the engine reports a usage window, "Your plan's <window> window is at X% now." No prices.
- A page range applies to every family (estimated pages for files without pages). A spreadsheet's choice is the summary and first rows, all of it, or (from a harness's UI) some sheets.
- The privacy line (§13.3) is on every waiting card and every notice: "Checking and labelling send parts of this material to <provider>."

## The AI stages

- **One stage, one session** (`runSystemTask`, `packages/runtime/src/system.ts`): an empty temporary folder (`hh-material-*`, removed after) as the working folder, only the `material` server in system mode with the stage's tools, `edit: none`, no web, no commands, `persistSession: false`, ten minutes at most. No `AGENTS.md`, no notes, no chat entry, no `tasks.json`. It never throws: a crash, a timeout or a stop is a failed result. `persistSession: false` only means something for Claude (`--no-session-persistence`); ACP engines (Codex, OpenCode) keep their own session files of the system task.
- **The model**: the engine in use and the stage's `ModelProfile`, resolved like a task's, keyed by the stage's reserved id (`material-review`…), from the manifest's tier or the person's Settings › Models row (`runMaterialStage` in `packages/shell/src/main/material-stage.ts`). A stage needs what a turn needs (a set-up app, the engine's notice accepted, its CLI) or it fails.
- **Order** (§10; `nextJob` in `packages/material/src/stages.ts`): per source, in the order sources were added, `review` (flagged fragments plus a sample, batches of `BATCH`, 20), `repair` (only when the review asked for repairs), `label` (batches of 20); then per scope, once no source is validating, what `.stale` says: `sheet`, then `link` (only with `items`). Each stage is a `StageDef` in `STAGES` with its tools in `STAGE_TOOLS` (`material_review`, `material_repair`, `material_label` with `material_flag`, `material_sheet`, `material_link`). Every answer is checked against its zod schema in the server and again in the app; nothing a model writes is read as instructions; the fragments in a prompt are marked as data.
- **Review** (`review.ts`): a verdict and a decision per fragment: `merge`, `split`, `drop` (the program does it, keeping the old fragments in `.orig/`), `repair`, `ask`, `reconvert` (PDF only: the other column mode or headings by weight; then the review starts over; a second `not-usable` sends the source to the person, `needs-person`) and `fullReview` (the source waits again with the full review's estimate: "Check all of it" or "Go on without it").
- **Repairs**: `material_repair { id, markdown }` is accepted only for a fragment the review sent to repair and when the words differ by at most `REPAIR_MAX_WORD_DIFF` (2%, `wordDiff`); otherwise it becomes a question.
- **Questions** (`asksOf`, `decide` in `decide.ts`): for a fragment "Keep it", "Drop it", "Keep the program's version"; for a `needs-person` source "Use it as it is" (it goes on to labelling) or "Remove it".
- **Labels** (`label.ts`): per fragment one English summary sentence (≤ 200 characters), 1–8 keywords in the material's own language (they feed the search), and a kind from `fragmentKinds`. The labelling session may flag a fragment of its own source; it goes back to review once.
- **Sheet** (`sheet.ts`): the harness's sections plus the two core ones, from the index rows, in English, cut at a line to `sheet.maxTokens`.
- **Links** (`link.ts`): `key: label` lines of the `items` collection in the scope (or app-wide when the collection isn't scoped), only the first `LINK_MAX_ITEMS` (200) records (`materialItems` in `material-ipc.ts`, which returns none for a collection hidden from the agent), and only the first `LINK_MAX_FRAGMENTS` (500) index rows; there is no batching, so further rows keep the links they have. Unknown keys are dropped. Only the links stage reads the items.
- **The queue** (`MaterialJobs`, `packages/shell/src/main/material-jobs.ts`): one stage at a time. It never starts a stage while a person's turn or task operation, a hold, a folder move or quitting is under way, and checks again after finding a job (an update may convert for minutes). A running stage is not stopped by a person's turn. `closeRuntime` (a profile switch, an engine or folder change, a move, quitting) stops the queue, then the service's conversions (`MaterialService.stop`); the stopped stage runs again later from the start and logs no usage line. `kick()` starts it: a new runtime, any material change, a flag, a profile's arrival, a valid start. A job that can't run or didn't move the source on is skipped until the next kick, so it never loops.
- **Failures** (§13): a failed stage is not retried on its own. The source goes `ready` with what it has (fragments `not-reviewed` or unlabelled) and `failed: <stage>`; the panel says "ready, not checked by the AI" with "Try again" (`retry`). The scope's sheet and links still run.
- **Usage**: each stage writes one line in the base's `usage.jsonl`: `{ at, engine, phase: "material", stage, scope, source?, tier, model, effort, cap, ok, fragments?, usage?, limits? }` (`materialRecord`). Per-action estimates and task totals leave them out; the latest usage window still reads them. `summarizeUsage` adds them up as `UsageSummary.material` only when there is at least one (D0); with profiles that total is the active profile's, and each person's total includes their material.

## Use inside tasks

- **Load** (§9). A new session's first message is, in order: the scope's notes index, the app-wide notes (with scopes), the data tables, then the material section (`TaskDeps.materialContext` in `task-manager.ts`, `materialSection` in `packages/material/src/context.ts`): `## Material`, the scope's grounding rule, how to fetch and cite, the sheet, then index rows (`| id | where | path | kind | summary |`) within `budget.indexTokens` (the first row always shows), and "N more fragments: find them with `material_search`." Only usable sources (`validating` or `ready`, `isUsable`) give rows, and fragments flagged during use are left out. No usable rows, `_app`, or no material: no section. Every task gets the first rows: tasks have no items of their own.
- **Grounding per scope.** The strict or mixed rule rides in the first message, per scope (`GROUNDING_RULES`, `groundingMode`: the person's choice in `grounding.json` only while `personCanChange`, else the manifest's default). `AGENTS.md` is one per folder and scopes switch inside one runtime, so its Material part (`packages/workspace/src/instructions.ts`, only with `material`) holds only the mode-independent rules: fetch with `material_read`/`material_search` and never open `.harness/material/`; cite as `[[frag:<id>]]`; when the material and your knowledge disagree, follow the material, say so once and call `material_conflict`; call `material_flag` on a fragment that reads wrong.
- **Tools** (person mode, `server.ts`; answered by `personMaterialRequest` in `packages/shell/src/main/material-requests.ts`, in the running task's scope and the runtime's base): `material_read(id)` (the fragment with its citation, where it comes from, and its path; logged in `material-reads.jsonl`; counts the source's `used`), `material_search(query)` (`minisearch` over text, summary, keywords and path, accents folded, prefix and fuzzy, at most 8 hits), `material_flag(id, reason)` (the fragment goes `pending`, out of the index and search, and its source back to review after the turn), `material_conflict(fragment, claim, resolution)` (a line in `conflicts.md`). Only fragments of usable sources. An app-wide task gets "This task has no material". A refusal reaches the agent as `Refused: <why>`; anything else is logged and answered with a plain line.
- **Citations**: `[[frag:<id>]]` in the chat is drawn as "<source>, <location>" (`citations.ts`, `CitedText` in `markdown.tsx`, labels from `client.material.cite`); clicking opens the original (`client.material.open`, which checks it is a file inside the scope's `material/` folder before `shell.openPath`). An unknown id, and any chat without material, keeps the text as it is.

## The window

- `MaterialPanel` (`packages/ui/src/MaterialPanel.tsx`, `useMaterial`) sits in the flow side panel after the notes, only with `state.material` and an open scope (`main` without scopes), keyed by scope. It offers "Add a file" and "Add a link", one status line per source (with Remove and its confirm), waiting cards (the estimate, the window share, the privacy line, a page range, the spreadsheet choice, the full review), question cards, "What the check found", "Try again", the grounding choice (only when `canChange`), and "No material yet for: …" (coverage, only with `items`, hidden while a source is validating or the sheet or links are due). Adding and answering wait while a turn runs.
- A harness replaces it with `HarnessApp materialPanel` (a component taking `MaterialPanelProps`: `client`, `scope`, `info`, `disabled`).
- `AppState.material` (`MaterialInfo`: `accepts`, `items`, `grounding`, `maxPages`), absent without material.
- `client.material` (`packages/ui/src/client.ts`, preload `hh:material*`; results travel as data, never thrown):
  - `list(scope)`: the scope's `MaterialView` (sources, grounding, provider, usage window, `uncovered`); null without material.
  - `add(scope)`: the main process's file dialog, then intake of each file picked (`{ added, refused }`).
  - `addLink(scope, url)`: fetched once with Node's `fetch` (no cookies), http(s) only, public addresses only (checked with `dns.lookup`, again on each of at most 5 manual redirects), at most `MAX_BYTES` within `FETCH_TIMEOUT_MS` (30 s) (`material-fetch.ts`).
  - `confirm(scope, id, { pageRange?, sheets? })`: the answer to a waiting card.
  - `decide(scope, id, fragment | null, choice)`: the answer to a question; `use` on a full-review card goes on without it.
  - `remove(scope, id)`: Remove, or Cancel on a waiting card.
  - `retry(scope, id)`, `setGrounding(scope, mode)`, `open(scope, id)` (a source or a fragment's source), `cite(scope, id)`.
  - `onChange(listener)`: `hh:materialStatus`, the scope's view after every change.
- Without material every call answers `not-ready` (or null).
- Settings › Models lists the stages (review, repair, label, sheet, and link with `items`), each recommended at its tier (`materialRecommended`). Settings › Usage shows the material total.

## Licences

`@humanharness/material`'s dependencies (spec §13.8), checked from each package's `license` field:

| Package | Licence |
|---|---|
| `pdfjs-dist` | Apache-2.0 |
| `mammoth` | BSD-2-Clause |
| `jszip` | MIT or GPL-3.0-or-later (used under MIT) |
| `fast-xml-parser` | MIT |
| `exceljs` | MIT |
| `@mozilla/readability` | Apache-2.0 |
| `linkedom` | ISC |
| `minisearch` | MIT |

`exceljs` brings these in: `big-integer` (Unlicense), `buffers` (MIT/X11), `chainsaw` (MIT/X11), `pako` (MIT AND Zlib). `pdfjs-dist` pulls the optional native `@napi-rs/canvas`. `pdfjs-dist` is an external dependency of the shell build, and `@napi-rs/canvas` is never bundled.

## Not yet

- OCR, image descriptions, audio and video transcription (D4).
- A sheet picker in the default panel; a row range for spreadsheets.
- Suggesting new items from the material.
- `humanharness run`: no `material` server and no material section. `check` validates the field and the guide asks about material.
- Linking more than 200 items, or more than the first 500 index rows, per scope (no batching).
- A shared library across profiles.

## Known gaps

- PDFs that need predefined CMaps (many CJK files) are read without `cMapUrl`: their text may come out empty, so they look scanned.
- Packaging pdfjs's optional native `@napi-rs/canvas` for a distributed app is not handled.
- `resourceLimits` caps the worker's heap, not memory outside it (pdfjs's image buffers).
- DNS rebinding is not blocked in the link fetch: the address is checked with a lookup before each request, and `fetch` looks it up again.
- ACP engines keep the system task's session files (`persistSession` is Claude-only; no `session/close` before the transport closes).
- `material_read` counts a use in `sources.json`, which the history tracks, so reads make history commits noisy; moving the count to `material-reads.jsonl` is planned. History saves also walk `fragments/`, which slows them with big stores.
- `material_read` still serves a fragment flagged `pending` when asked by its id.
- The sheet's prompt carries every index row, uncapped.
