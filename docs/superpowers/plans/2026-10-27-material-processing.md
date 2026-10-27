# Material Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A harness may declare `material`: the person adds their own files (PDF, Word, spreadsheets, presentations, ebooks, web pages, plain text) or a link to a scope, and the core turns each one into small Markdown fragments with a program (no model), checks them, and lets the AI review only what the checks flag plus a bounded sample, repair structure (never content), label the fragments, write a short sheet and link fragments to the harness's items. A task in that scope starts with the sheet and a short index, and fetches full fragments on demand through a `material` MCP server (`material_read`, `material_search`, `material_flag`). The person is warned about cost before any model runs. Everything lives in the active profile's folder, so each profile processes its own material. A harness that declares no `material` works exactly as today (D0 below).

**Architecture:**
- **Contract (harness-sdk).** New `material.ts`: `MATERIAL_FAMILIES`, `GROUNDING_MODES`, `MATERIAL_STAGES`, `materialSchema`, `hasMaterial`, `materialStageKey`. `index.ts`: the manifest's optional `material` and its rules in the `superRefine`.
- **Paths (workspace).** `layout.ts`: `MATERIAL_DIR`, `materialDir(base, scope)`, `materialStoreDir(base, scope)`, `materialReadsFile(base)`, `MATERIAL_KEEP` (the hidden files the history tracks). `history.ts`: `keep` also takes a pattern entry `{ prefix, match, depth }`.
- **The program (new package `@humanharness/material`, no UI, no model).**
  - `constants.ts` (every threshold), `types.ts` (`MdBlock`, `FragmentMeta`, `SourceEntry`, …), `detect.ts` (magic bytes, then extension; refusals with their reason).
  - Converters to one block model (`MdBlock[]`): `convert/text.ts`, `convert/html.ts` (linkedom + `@mozilla/readability` + a small DOM walker), `convert/pdf.ts` (`pdfjs-dist`), `convert/word.ts` (`mammoth`, `jszip` + `fast-xml-parser`, RTF), `convert/sheet.ts` (`exceljs`, ODS, CSV), `convert/slides.ts` (PPTX, ODP), `convert/epub.ts`, `convert/index.ts` (dispatch).
  - `cut.ts` (§5), `checks.ts` (§6.1), `word-diff.ts`, `fragment.ts` (front matter in and out), `store.ts` (`MaterialStore`: `sources.json`, fragments, `.orig`, `index.md`, `sheet.md`, `conflicts.md`, `grounding.json`), `estimate.ts` (§7), `intake.ts` (measure, thresholds, the warning), `pipeline.ts` (convert → cut → check → store), `search.ts` (`minisearch`), `context.ts` (the first message's material section), `review.ts`, `stages.ts` (the AI stages' prompts and how their answers apply), `server.ts` + `server-bin.ts` (the `material` MCP server), `launch.ts` (`materialServerSpec`).
- **Runtime.** `RuntimeOptions.material` adds the `material` MCP server next to `ui` and `data` for the person's tasks; the history keeps `MATERIAL_KEEP`. New `system.ts`: `runSystemTask`, one short session in an empty temporary folder with only the `material` server, `edit: none`, `web: none`, `exec: false`.
- **Shell main.** New `material.ts`: `MaterialService` (one per base: the active profile's folder, or the folder), intake from a file dialog or a link, the queue of AI stages (`material-jobs.ts`: one at a time, never started while a person's turn runs, stopped by `closeRuntime`), the agent's requests (`material-requests.ts`), the `hh:material*` IPC and the `hh:materialStatus` / `hh:materialAsk` channels. `index.ts` wires it only when the harness has `material`. The first message of a task in a scope gets the material section (`TaskDeps.materialContext`).
- **The window (ui).** `client.material`; new `MaterialPanel.tsx` (add a file or a link, the estimate and warning, one status line per source, ask cards, the grounding toggle), drawn in the flow side panel by default and replaceable through `HarnessApp materialPanel`; citations `[[frag:<id>]]` drawn as "<source>, <location>" (`markdown.tsx`, `CitationContext`); Settings › Modelos lists the material stages.
- **Fixture.** `packages/fake-agent/fixtures/material-harness` (id `reader`, with scopes, a `concepts` collection and profiles) drives the unit and end-to-end tests.

**Tech Stack:**
- Unchanged: TypeScript, pnpm via corepack, Electron 44 + electron-vite 5, React 19, i18next, zod 4, isomorphic-git, the MCP SDK, Vitest + happy-dom, and Playwright with the fake agents.
- New, in `@humanharness/material` only (each added in the task that first needs it, with its licence checked; spec §13.8): `pdfjs-dist` (Apache-2.0), `mammoth` (BSD-2), `jszip` (MIT or GPL-3, used under MIT), `fast-xml-parser` (MIT), `exceljs` (MIT), `@mozilla/readability` (Apache-2.0), `linkedom` (ISC), `minisearch` (MIT). Not `turndown` (see Decisions).

Spec: `docs/superpowers/specs/2026-10-25-material-processing-design.md` (source of truth; "§" and "D" numbers below refer to it), with the process definition in `docs/discovery/2026-10-25-core-material-processing.md`. It builds on plans 1–7, especially `2026-10-25-scopes-and-data.md` (scopes, collections, the data MCP server), `2026-10-12-03c-resources.md` (tiers, Settings › Modelos, usage), `2026-10-27-harness-setup-steps.md` and `2026-10-27-profiles.md` (everything per profile).

---

## Conventions

**Code**
- Same as plans 1–7:
  - English everywhere (code, comments, docs, UI strings, manifest texts, prompts, fragment front matter);
  - packages export TS source;
  - extensionless imports;
  - tests in `packages/<name>/test/`;
  - one commit per task.
- React tests are `*.test.tsx` with `// @vitest-environment happy-dom` on the first line. Find elements by role and visible text.
- `@humanharness/ui` only imports **types** from other packages (`import type`). The UI's own small helpers live in `packages/ui/src/`.
- Colours only through `--hh-*` tokens. This plan adds no new token family.
- Every lookup by a name that comes from a person, a harness, the agent, a file or IPC (a source id, a fragment id, a scope, a sheet name, a collection) goes through `Object.hasOwn`, a list's `find`/`some`/`includes`, or a pattern check (`isScopeId`, `SOURCE_ID`, `FRAGMENT_ID`) first.
- Errors over IPC travel as data (`MaterialResult`), never as thrown errors (Electron flattens thrown errors).
- Nothing here reads a model's answer as instructions: the AI stages answer only through the `material` server's tools, each checked against its zod schema in the server **and** again in the main process.
- Files the person adds are untrusted data. Converters never execute anything from them (no macros, no scripts, no remote fetch from inside a document); the HTML converter drops `script`, `style`, `iframe`, `object` and `form` before reading. `pdfjs-dist` runs with `isEvalSupported: false` and no font loading.
- **Names.** "Profile" means a person's profile only where plan 7 put it; the material code never says "profile" for a model profile either: a stage's model settings are its `ModelProfile`, in variables named `model…`.

**Commands and git**
- The worktree is `/Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data`. Create branch `feat/material` from `feat/profiles` (plan 7) and implement there: `git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data switch -c feat/material feat/profiles`.
- Run every `corepack pnpm …` command from the worktree root. A single test file: `corepack pnpm vitest run <path>`.
- Adding a dependency: `corepack pnpm --filter @humanharness/material add <name>` (the newest version the workspace's `minimumReleaseAge` allows). Before the commit, read its `license` field in `node_modules/<name>/package.json` and stop if it is not the one listed in the Tech Stack.
- Git: always `git -C <worktree> …`, one simple command per call. Never use bare `git stash`. Never push.
- Every commit message ends with these two lines, with a blank line before them:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7
  ```
- Every task ends with `corepack pnpm typecheck` and `corepack pnpm test` green before its commit.
  - Tasks that touch the shell's main process, the preload, the build config or the UI also run `corepack pnpm app:build`.
  - Task 28 runs `corepack pnpm e2e`.

**Compliance (core spec §5), restated for this plan**
- Never read `~/.claude`, `~/.codex`, `~/.gemini` or any account, token or credential file. The AI stages use the engine exactly as a task does: the official CLI, the person's sign-in, no API key.
- Material touches only the person's folder (`<base>/material/<scope>/…`, `<base>/.harness/material/<scope>/…`, `<base>/.harness/material-reads.jsonl`, `<base>/.harness/usage.jsonl`) and the system temporary folder (the AI stages' empty working folder, removed after each stage). Removing a source moves its original to the system Trash (`shell.trashItem`); nothing is deleted for good.
- A link is fetched only when the person adds it, only over `http:` or `https:`, with a size cap (`MAX_BYTES`) and a timeout, and never with the person's cookies (Node's `fetch`, not the window's session).
- The person is told, once per source, that checking and labelling send parts of the material to the engine's provider (§13.3, below).

**D0 is a hard rule (like plans 1–7).** A harness whose manifest has no `material` must keep, byte for byte:
- `AppState` (no `material`), `ModelsView` (no material stages in `recommended`), `UsageSummary`;
- the folder: no `material/` folder, no `.harness/material/`, no `.harness/material-reads.jsonl`;
- the runtime: the same MCP servers (`ui`, `data` when visible, the harness's own), the same `AGENTS.md`, the same history ignore and keep lists;
- a task's first message (no material section), `tasks.json`, `usage.jsonl`, the chat log, the history's commits;
- the window: the flow side panel, Settings › Modelos rows, the chat's Markdown (a literal `[[frag:x]]` stays text);
- `check`'s findings for the untouched template and every existing fixture; the manifest rules for every existing fixture;
- `closeRuntime`, the profile switch, the folder move and quitting: the same steps (the material queue does not exist).

Tasks 1, 6, 14, 15, 16, 17, 24 and 26 hold the regression tests. Every other change keeps D0 by adding fields only when `material` exists (conditional spreads, `null` controllers), never by changing a default.

## Decisions this plan takes where the spec leaves room, or where the code moved

**Manifest (§8), English-only (plan 5a)**
- `material: { accepts, sheet, fragmentKinds, items?, grounding, budget, tiers }`. Every label and prompt is one English string. The spec's `scopeLabel: { es, en }` is gone: the scope is the harness's own (`scopes.label`, plan 5); without scopes there is one scope, `main` (§13.1).
- `accepts` defaults to every family. `sheet.sections` (1–8, ids unique, `label` ≤ 80, `prompt` ≤ 400), `sheet.maxTokens` (200–3000, default 800). `fragmentKinds` (1–12, ids, default `["explanation", "definition", "example", "exercise"]`). `grounding.default` `strict` or `mixed` (default `mixed`), `personCanChange` (default `true`). `budget.indexTokens` (100–3000, default 600). `tiers` overrides per stage (`review`, `repair`, `label`, `sheet`, `link`), defaults `standard`, `light`, `light`, `light`, `standard` (§6.2, §8).
- `items: { collection, label }`: a declared collection with a `key` (not `single`), visible to the agent, whose `label` is a field of its schema. Without `items` there is no linking stage (§8).
- With `material`, the action ids `material-review`, `material-repair`, `material-label`, `material-sheet` and `material-link` are reserved: Settings › Modelos keys each stage's setting by them (`config.json` → `models.tasks`).

**Scopes and profiles (§4, §13.1, plan 7 Q2)**
- The material scope is the task's scope. Without `scopes` it is `main`. With `scopes`, material belongs to a registered scope; `_app` never has material (an app-wide task gets no material section and its `material_*` tools answer "This task has no material").
- Everything is under the base (`baseOf`): in a harness with profiles that is the active profile's folder, so each person adds and processes their own material. A profile switch, a folder change, an engine change, a folder move and quitting stop the material queue first (`closeRuntime` stops it); the new base's unfinished sources resume after arrival or at start.

**Storage (§4)**
- `<base>/material/<scope>/<original>` holds the originals as the person gave them (a name already used gets ` (2)` before its extension). A link's page is saved there as `<slug>.html` (or `.pdf` when the link serves a PDF) with `url` and `fetchedAt` in the registry, so reprocessing works offline and the history keeps what was read (flagged, technical).
- `<base>/.harness/material/<scope>/` holds `sources.json`, `index.md`, `sheet.md`, `conflicts.md`, `grounding.json` (the scope's grounding mode, when the person changed it), `fragments/<id>.md` and `fragments/.orig/<id>.md`.
- The history tracks the originals (they are visible files) plus `sources.json`, `conflicts.md` and `grounding.json` (`MATERIAL_KEEP`). Fragments, the index and the sheet are rebuilt from the originals and are never tracked (§4 "History").
- A source id is a slug of the file name or the link's host and path (`fractions-ch2`), unique in the scope; a fragment id is `<source id>-<nnn>` (three digits, from `001`).

**Formats and converters (§3)**
- One block model for every family: `MdBlock { kind: "heading" | "para" | "list" | "table" | "code" | "image", level?, md, loc, page }`. `md` is already Markdown; `loc` is the location mark; `page` is the page (PDF), the slide (presentations), or an estimated page of 500 tokens (everything else), so a page range works for every family.
- The location marks are English: `p.4`, `§ Heading › Sub ¶3`, `Sheet1!A1:F40`, `slide 3`, `ch. 2 › Heading`, `lines 10–40`; an image becomes `[image, <location>]`; a slide's notes go under "Notes".
- HTML (files, links, Word's HTML from `mammoth`, an ebook's chapters) goes through one DOM walker over `linkedom`, not `turndown`: the cutter needs blocks with locations, and a Markdown string would have to be parsed again (flagged, technical). Links use `@mozilla/readability` first; files do not (a saved page is the person's whole file).
- Old Office formats (`.doc`, `.xls`, `.ppt`) are refused with "Save it as .docx, .xlsx or .pptx and add it again." (§13.7, decided).
- Spreadsheets above `MAX_ROWS` offer "Summary and first rows", "All of it" and "Cancel"; picking single sheets is `confirm(id, { sheets })` from a harness's own UI; the default panel does not draw a sheet picker (flagged, product).

**When processing runs (§7, §13.4)**
- Right after intake (the spec's proposal).
- Below `WARN_PAGES` (and below `MAX_ROWS` for a spreadsheet): intake converts, cuts, checks and stores at once (free), then queues the AI stages, with a one-line notice.
- At or above `WARN_PAGES` or `MAX_ROWS`: intake only measures; the source waits (`pending`) with the estimate and the warning. At or above `MAX_PAGES` or `MAX_BYTES` only a page range (or Cancel) goes on. The person's answer (`confirm`) converts (with the range or the spreadsheet choice) and queues the AI stages. Converting waits for the answer because a range changes what is converted.

**The AI stages (§6.2, §10)**
- Stages per source, in order: `review` (standard), `repair` (light, only when the review asked for repairs), `label` (light, batches of 20 fragments), then per scope `sheet` (light) and `link` (standard, only with `items`). A source's stages run one at a time; the scope's `sheet` and `link` run once after the last source of a burst is labelled.
- Each stage is one short session (`runSystemTask`): an empty temporary folder as its working folder, the `material` server in system mode as its only MCP server (with the stage's tools only), `edit: none`, `web: none`, `exec: false`, Claude with `--no-session-persistence`. No `save_note`, no chat entry, no history commit of its own.
- The spec's "hidden core block `material_review`" and the agent's "`material_repair`" are **tools of the `material` server** in system mode (`material_review`, `material_repair`, `material_label`, `material_sheet`, `material_link`), schema-checked like blocks. They never reach `allBlocks`, `AGENTS.md` or a person's task (flagged, technical: the system session has no `ui` server and no bridge).
- The queue runs one stage at a time, never **starts** a stage while a person's turn or task operation runs, and waits between stages for the person's turn to end. A stage already running is not stopped by a person's turn (flagged, product: "pre-empts the queue between stages").
- A stage that fails (out of quota, the engine missing, a crash, an answer that never calls its tool) is not retried on its own: the source goes `ready` with its fragments `not-reviewed` (or unlabelled), and its status line says "Not checked by the AI" with a "Try again" (`retry(sourceId)`). Mock mode (`humanharness dev --mock`) runs the stages like any turn; without a recording they fail this way (flagged, technical).
- A stage's usage line: `{ at, engine, phase: "material", stage, source?, scope?, tier, model, effort, cap, ok, usage }` in the base's `usage.jsonl`. Settings › Usage leaves these lines out of the per-action estimates and adds them up under `UsageSummary.material` only when there is at least one (D0).

**Review and repairs (§6.2)**
- The sample: the first unflagged fragment plus 10% of the rest (rounded up), at most `SAMPLE_MAX` (15), spread evenly.
- `merge` (with `with`), `split` (at `at`, a line of the fragment), `drop`: carried out by the program, which writes the new fragments and keeps the old ones in `.orig/`. `reconvert`: the program converts once more with the other settings (PDF: column mode on or off and the heading rule by font size or by weight; other families: none, so it counts as `not-usable`), then checks and review run again. A second `not-usable` sends the source to the person (`needs-person`). `ask`: the person decides.
- A repair (`material_repair { id, markdown }`) is accepted only when the words differ by at most `REPAIR_MAX_WORD_DIFF` (2%) and the fragment's decision was `repair`; otherwise it is refused, the tool says why, and the decision becomes `ask`.
- `fullReview: true` puts the source back to `pending` with the full review's estimate and the warning (§7 "A full review is needed"). Its `confirm` reviews every fragment in batches of 20.
- An ask (`material-ask`): `{ source, fragment?, question, choices }`. The person's choices: for a fragment, "Keep it", "Drop it", "Keep the program's version" (when a repair was refused); for a `needs-person` source, "Use it as it is", "Remove it". `decide(sourceId, fragmentId | null, choice)`.

**Labels, sheet, links (§8, §9)**
- `material_label { fragments: [{ id, summary, keywords, kind }] }`: `summary` one English sentence ≤ 200 characters, `keywords` 1–8 words or short phrases in the material's own language (they feed the search), `kind` one of the harness's `fragmentKinds`. The labelling session may also call `material_flag`.
- `material_sheet { sections: [{ id, markdown }] }`: the harness's sections plus the two core ones, `notation` ("Notation and conventions") and `not-covered` ("What the material does not cover"), in English, cut to `sheet.maxTokens` (the program cuts, at a line).
- `material_link { links: [{ fragment, items }] }`: item keys of the `items` collection in the scope (or app-wide when the collection is not scoped), given in the prompt as `key: label` lines. Unknown keys are dropped. Coverage = the items with no fragment; the panel lists them ("No material yet for: …"). New items are not suggested in v1 (flagged, product).
- Language (§13.5): the sheet and the summaries are English (the AI reads them; plan 5a); keywords stay in the material's language (the person's queries and the text are in it). (Flagged, product.)

**Use inside tasks (§9)**
- **Load.** A task in a scope that has ready material gets, after the notes index and the data tables, a `## Material` section: the grounding rule of the scope's mode, how to fetch, the sheet, then index rows (`| id | where | path | kind | summary |`) cut to `budget.indexTokens`. The task has no "items" of its own in the code, so every task gets the first rows of the index (the spec's case "a task with no items"); the search finds the rest (flagged, product).
- **Fetch.** The `material` server (person mode) offers `material_read(id)`, `material_search(query)`, `material_flag(id, reason)`, in the running task's scope. Every read is logged in `.harness/material-reads.jsonl` (`{ at, task, scope, id }`).
- **Ground.** `AGENTS.md`'s managed section gets a short "Material" part only when the harness has `material`: the citation form `[[frag:<id>]]`, "when the material and your own knowledge disagree, follow the material, say so once, and call `material_conflict`", and "fetch fragments with `material_read`; never open the hidden material files". The scope's mode (`strict` or `mixed`) is per scope, so its rule rides in the task's first message, not in `AGENTS.md`, which is one per folder (see conflicts).
- `material_conflict { fragment, claim, resolution }` (person mode) appends to the scope's `conflicts.md`, which the history tracks.
- **Citations** `[[frag:<id>]]` are drawn as "<source name>, <location>"; clicking opens the original (`client.material.open(id)` → `shell.openPath` on the original, after checking it is inside the base's `material/` folder).

**Cost warning (§7)**
- Estimate: `fragments × (LABEL_TOKENS + REVIEW_TOKENS × reviewShare) + SHEET_TOKENS + (items ? fragments × LINK_TOKENS : 0)`, where `fragments ≈ tokens ÷ TARGET` and `reviewShare` is the expected share of fragments the review reads (flagged + sample; before conversion, `SAMPLE_SHARE`). Until 5 measured stages exist in the base's `usage.jsonl`, the constants are used; afterwards the per-fragment averages measured per stage replace them (Task 25).
- The warning shows "About N tokens" and, when the engine reports a usage window, "Your plan's <window> window is at X% now." No prices.
- The privacy line (§13.3): every confirmation card and every one-line notice says "Checking and labelling send parts of this material to <provider>." (flagged, product: per source, not once).

**Spec §13 open questions (simplest default consistent with the spec, flagged)**
- Q1 (scopes and items): scopes and data landed (plan 5): material scope = harness scope, `main` without scopes; `items` is a data collection.
- Q3 (privacy notice): per source, on the notice or the confirmation card.
- Q4 (when processing runs): right after intake.
- Q5 (language): sheet and summaries English; keywords in the material's language.
- Q6 (thresholds): the spec's placeholders, all in `packages/material/src/constants.ts`.
- Q8 (libraries): listed in Tech Stack; `turndown` not needed.

**Not in this plan (flagged)**
- OCR, AI transcription, describing images (D4).
- A sheet picker in the default panel; a row range for spreadsheets.
- Suggesting new items from the material.
- `humanharness run`: it gets no `material` server and no material section (a known gap in the docs). `check` validates the manifest field and the guide asks about material.
- A shared library across profiles (plan 7 Q2).

## What in the code conflicts with the spec (and how this plan handles it)

| Conflict | Where | Handling |
|---|---|---|
| §8 `scopeLabel: { es, en }`; Spanish UI strings ("Hoja", "diap.", "Notas", "imagen", "subí solo…", "La app solo trabaja…") | The core is English-only since plan 5a | No `scopeLabel` (the scope is the harness's); every string and mark in English (Tasks 1, 3–11, 16) |
| §6.2 "a hidden core block `material_review`"; "the agent sends `material_repair`" | Hidden blocks reach the app through the `ui` server and the runtime's bridge, which only a person's runtime has; `allBlocks` would also put them in every task's `AGENTS.md` | Tools of the `material` server in system mode, schema-checked, answered over RPC (Tasks 13, 17–19, 21–23) |
| §10 "system tasks … a new task kind `system`; the `TaskManager` starts these tasks" | `TaskManager` owns one task at a time, its `tasks.json`, the person's chat, notes and history trailers | A separate queue (`MaterialJobs`) beside `TaskManager`; stages never enter `tasks.json` (Task 17) |
| §10 "Permissions: `edit: none`, `web: none`; tools: the `material` server" | A runtime's transport has the harness's permissions, `AGENTS.md` and the person's folder as its working folder | `runSystemTask`: an empty temp folder, fixed permissions, only the `material` server (Task 17) |
| §9 "The managed section of `AGENTS.md` adds the rules of the scope's mode" | `AGENTS.md` is one file per folder; scopes switch inside one runtime, and its text change would cost the cache | Fixed material rules in `AGENTS.md`; the scope's mode in the first message's material section (Tasks 15, 24) |
| §9 "the index rows linked to the task's items" | A task has no items in the code (only collections with `context`) | The first rows of the index within the budget; search for the rest (Task 13) |
| §4 "the history skips it, except `sources.json` and `conflicts.md`" | `History.keep` takes path prefixes only | `keep` also takes a pattern entry `{ prefix, match, depth }` (`MATERIAL_KEEP`) (Task 6) |
| §4 "`TaskManager` gets `scope` with the action" | It already does (plan 5) | Nothing new |
| §10 `add(scope, file \| url)` | A sandboxed window has no file paths (`File.path` is gone in Electron) | `add(scope)` opens the main process's file dialog; `addLink(scope, url)` (Task 14) |
| §7 "shown against the engine's reported usage window (plan 3b)" | Plan 3b's estimates are window shares per action, measured after the fact; tokens can't be turned into a share beforehand | Tokens, plus the window's current share when the engine reports one (Task 16) |
| §11 `usage.jsonl` "one line per stage and source" | `summarizeUsage` counts a line with no `action` as a free question | Material lines carry `phase: "material"`; `summarizeUsage` leaves them out of per-action estimates (Task 17) |
| §8 "Each processing stage shows up in Settings › Modelos as a process" | Rows come from `AppState.actions` and `questions` | `ModelsView.recommended` and the rows get the five stage keys only with `material` (Task 26) |
| §3 `turndown` | The cutter needs blocks, not a Markdown string | A DOM walker over `linkedom` (Task 8) |
| Profiles plan "each profile processes its own material" | `baseOf` already points at the active profile | `MaterialService` per base; `closeRuntime` stops the queue; resume after arrival (Tasks 14, 17) |

**Reuse, and why.**
- **Reused:**
  - `layout.ts` as the one place for paths; `scopeDir` for the scope's folder name; `estimateTokens` (characters ÷ 4) from `notes-index.ts`;
  - `openRpc`/`callRpc` and `Launcher` from `@humanharness/blocks` for the `material` server, exactly like the `data` server;
  - `ClaudeCliTransport`/`AcpTransport` with `persistSession: false` in an empty temp folder, the pattern of `engine-check.ts`'s `testPrompt`, for the AI stages;
  - `resolveProfile`, `firstOffered`, `supportedEffort` and `nextFallback` for each stage's model, keyed by the stage's reserved id;
  - `UsageLog`, `profileMeta` for the stage's usage line;
  - `dataStoreFor(base)` to read the `items` collection; `ScopeStore` (through `activeScope`) to check a scope;
  - `writeAtomic`'s pattern (temp file + rename, one write at a time) for `sources.json`;
  - `shell.trashItem` for removing an original; `openIfStillSafe`'s checks for opening one.
- **Not reused:**
  - `TaskManager` for system stages (one person's task at a time, notes, chat, trailers);
  - `allBlocks`/`ui` server for the stages' answers (see conflicts);
  - `DataStore` for the registry: `sources.json` is the core's, not a harness collection, and must not show in the agent's data tools.

## File Structure

```
packages/harness-sdk/src/material.ts            NEW. MATERIAL_FAMILIES, GROUNDING_MODES, MATERIAL_STAGES, materialSchema, hasMaterial, materialStageKey (Task 1)
packages/harness-sdk/src/index.ts               manifest `material`, superRefine rules, exports                               (Task 1)
packages/fake-agent/fixtures/material-harness/  NEW. The `reader` fixture (ui/ and test files in Task 28)                     (Task 1)
packages/material/package.json                  NEW. @humanharness/material; deps added task by task                          (Task 2)
packages/material/src/constants.ts              NEW. Every threshold and size                                                 (Task 2)
packages/material/src/types.ts                  NEW. Family, MdBlock, FragmentMeta, SourceEntry, SourceStatus, …              (Task 2)
packages/material/src/detect.ts                 NEW. detectType (magic bytes, extension), refusals                            (Task 2)
packages/material/src/convert/text.ts           NEW. Plain text, Markdown, structured data, code; decode                     (Task 3)
packages/material/src/blocks.ts                 NEW. markdownBlocks, estimated pages, locRange                                (Task 3)
packages/material/src/cut.ts                    NEW. cutBlocks (§5), cutRows (§3)                                             (Task 4)
packages/material/src/checks.ts                 NEW. checkPieces (§6.1)                                                      (Task 5)
packages/material/src/fragment.ts               NEW. renderFragment, parseFragment                                           (Task 7)
packages/material/src/store.ts                  NEW. MaterialStore                                                            (Task 7)
packages/workspace/src/layout.ts                MATERIAL_DIR, materialDir, materialStoreDir, materialReadsFile, MATERIAL_KEEP (Task 6)
packages/workspace/src/history.ts               keep takes a pattern keep ({ prefix, match, depth })                          (Task 6)
packages/material/src/convert/html.ts           NEW. htmlBlocks (linkedom walker), readablePage                               (Task 8)
packages/material/src/convert/pdf.ts            NEW. pdfBlocks (pdfjs-dist), PDF measure                                      (Task 9)
packages/material/src/convert/word.ts           NEW. docx (mammoth), odt, rtf                                                 (Task 10)
packages/material/src/convert/sheet.ts          NEW. xlsx (exceljs), ods, csv/tsv                                             (Task 11)
packages/material/src/convert/slides.ts         NEW. pptx, odp                                                                (Task 11)
packages/material/src/convert/epub.ts           NEW. epub                                                                      (Task 11)
packages/material/src/convert/index.ts          NEW. convertFile dispatch, measureFile                                        (Task 12)
packages/material/src/estimate.ts               NEW. estimateCost (§7)                                                        (Task 12)
packages/material/src/intake.ts                 NEW. intakeDecision (thresholds, warning)                                     (Task 12)
packages/material/src/pipeline.ts               NEW. processSource (convert → cut → check → store)                            (Task 12)
packages/material/src/search.ts                 NEW. MaterialSearch (minisearch)                                              (Task 13)
packages/material/src/context.ts                NEW. materialSection (first message)                                          (Task 13)
packages/material/src/server.ts, server-bin.ts  NEW. The `material` MCP server (person mode)                                  (Task 13; system tools 17–23)
packages/material/src/launch.ts                 NEW. materialServerSpec                                                       (Task 13)
packages/material/src/use.ts                    NEW. readForTask, flagFragment (the person-mode tools' effects)              (Task 13)
packages/material/src/stages.ts                 NEW. Job, nextJob, failStage, retryStage, StageDef, STAGES               (Task 17; stages 18–23)
packages/material/src/review.ts                 NEW. reviewSet, reviewPrompt, applyReview                                     (Task 18)
packages/material/src/word-diff.ts, decide.ts   NEW. wordDiff; decide, removeSource                                           (Task 19)
packages/material/src/label.ts                  NEW. unlabelled, labelPrompt                                                  (Task 21)
packages/material/src/sheet.ts                  NEW. composeSheet, sheetPrompt                                                (Task 22)
packages/material/src/link.ts                   NEW. linkPrompt, uncovered                                                    (Task 23)
packages/runtime/src/runtime.ts                 RuntimeOptions.material (the person-mode server), MATERIAL_KEEP              (Task 15)
packages/runtime/src/system.ts                  NEW. runSystemTask                                                            (Task 17)
packages/workspace/src/instructions.ts          the Material part of the managed section                                      (Task 15)
packages/shell/electron.vite.config.ts          @humanharness/material bundled; `material-server` entry                       (Task 14)
packages/shell/src/main/material.ts             NEW. MaterialService                                                          (Tasks 14, 18–25)
packages/shell/src/main/material-requests.ts    NEW. The agent's and the stages' requests                                    (Tasks 15, 17–24)
packages/shell/src/main/material-jobs.ts        NEW. MaterialJobs                                                             (Task 17)
packages/shell/src/main/material-fetch.ts       NEW. fetchLink                                                                (Task 14)
packages/shell/src/main/index.ts                wiring (14), tasks and runtime (15), queue (17), models (26)
packages/shell/src/main/task-manager.ts         TaskDeps.materialContext                                                      (Task 15)
packages/shell/src/main/usage-log.ts            "material" lines                                                              (Tasks 17, 25)
packages/shell/src/preload/index.ts             client.material                                                               (Task 14)
packages/ui/src/client.ts                       Material* types, AppState.material, client.material                          (Task 14)
packages/ui/test/fake-client.ts                 client.material                                                               (Task 14)
packages/ui/src/MaterialPanel.tsx               NEW. The default panel                                                        (Tasks 16, 20, 24)
packages/ui/src/FlowSide.tsx, ChatView.tsx, HarnessApp.tsx  the panel's place, `materialPanel` prop                           (Task 16)
packages/ui/src/markdown.tsx, citations.ts      [[frag:id]] citations                                                         (Task 24)
packages/ui/src/UsageTab.tsx                    material's total tokens                                                       (Task 25)
packages/ui/src/ModelsTab.tsx                   material stage rows                                                           (Task 26)
packages/i18n/src/locales/en.json               material.*                                                                    (Tasks 16, 20, 24, 26)
packages/cli/src/check.ts, guide/new-harness.md material                                                                      (Task 26)
docs/architecture/material.md                   NEW                                                                           (Task 27)
docs/architecture/{manifest,context,data,profiles,blocks}.md                                                                  (Task 27)
packages/e2e/tests/material.spec.ts             NEW                                                                           (Task 28)
```

Task list:
1. The manifest declares material
2. The material package: constants, types, file type detection
3. Plain text, and the block model
4. Cutting
5. Program checks
6. Paths in `layout.ts`; the history keeps the person's material decisions
7. Fragments on disk: the store
8. Web pages and HTML
9. PDF
10. Word processing: docx, odt, rtf
11. Spreadsheets, presentations, ebooks
12. Intake, the cost estimate, and the program pipeline
13. Search, the material section, and the `material` MCP server
14. The app: `MaterialService`, IPC, the client contract
15. Tasks use the material: the first message, the server, `AGENTS.md`
16. `MaterialPanel`: add, warn, status
17. System stages: `runSystemTask` and the queue
18. Review
19. Repairs, asks and the full review
20. The panel: ask cards and review results
21. Labels
22. The sheet
23. Links to items and coverage
24. Grounding and citations
25. Update, removal, and measured estimates
26. Settings › Modelos, `check` and the guide
27. Docs
28. End to end: a student adds a chapter, works with it, and another student doesn't see it

---
## Phase 1 — The program pipeline (spec §12 slice 1)

### Task 1: The manifest declares material

**Files:**
- Create: `packages/harness-sdk/src/material.ts`, `packages/fake-agent/fixtures/material-harness/harness.config.ts`, `packages/fake-agent/fixtures/material-harness/agent/AGENTS.md`, `packages/fake-agent/fixtures/material-harness/agent/tasks/study.md`
- Modify: `packages/harness-sdk/src/index.ts`
- Test: `packages/harness-sdk/test/material.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/harness-sdk/test/material.test.ts`:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAGE_TIERS,
  type HarnessInput,
  MATERIAL_FAMILIES,
  MATERIAL_STAGE_KEYS,
  TIERS,
  defineHarness,
  hasMaterial,
  loadHarness,
  materialStageKey,
  stageTier,
  z,
} from "../src";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/material-harness/harness.config.ts");

const concepts = {
  scoped: true,
  key: "id",
  schema: z.object({ id: z.string(), name: z.string().min(1).max(80) }),
  agent: "write" as const,
};
const base: HarnessInput = {
  id: "reader",
  name: "Reader",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Reader" },
  instructions: "./AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  actions: { study: { label: "Study", prompt: "tasks/study.md", cost: "light" } },
  scopes: { label: "topic", plural: "topics" },
  data: { concepts },
  author: "t",
};
const sheet = { sections: [{ id: "terms", label: "Terms", prompt: "The key terms, one line each." }] };
const withMaterial: HarnessInput = { ...base, material: { sheet, items: { collection: "concepts", label: "name" } } };

function issues(input: HarnessInput): string[] {
  try {
    defineHarness(input);
    return [];
  } catch (e) {
    return (e as { issues: { path: PropertyKey[]; message: string }[] }).issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`);
  }
}

describe("material in the manifest (material spec §8)", () => {
  it("D0: a manifest without material has none", () => {
    const h = defineHarness(base);
    expect(h).not.toHaveProperty("material");
    expect(hasMaterial(h)).toBe(false);
  });

  it("fills the defaults", () => {
    const h = defineHarness(withMaterial);
    expect(hasMaterial(h)).toBe(true);
    expect(h.material).toEqual({
      accepts: [...MATERIAL_FAMILIES],
      sheet: { sections: sheet.sections, maxTokens: 800 },
      fragmentKinds: ["explanation", "definition", "example", "exercise"],
      items: { collection: "concepts", label: "name" },
      grounding: { default: "mixed", personCanChange: true },
      budget: { indexTokens: 600 },
      tiers: {},
    });
  });

  it("each stage has a tier, overridable, and a reserved models key", () => {
    const h = defineHarness({ ...withMaterial, material: { sheet, tiers: { label: "standard" } } });
    expect(stageTier(h.material!, "label")).toBe("standard");
    expect(stageTier(h.material!, "review")).toBe(DEFAULT_STAGE_TIERS.review);
    expect(DEFAULT_STAGE_TIERS).toEqual({ review: "standard", repair: "light", label: "light", sheet: "light", link: "standard" });
    expect(materialStageKey("review")).toBe("material-review");
    expect(MATERIAL_STAGE_KEYS).toEqual(["material-review", "material-repair", "material-label", "material-sheet", "material-link"]);
    // The stage tiers are the core's tiers.
    for (const t of Object.values(DEFAULT_STAGE_TIERS)) expect(TIERS).toContain(t);
  });

  it("items name a keyed collection and one of its fields", () => {
    expect(issues({ ...withMaterial, material: { sheet, items: { collection: "cards", label: "name" } } })).toContain(
      'material.items.collection: Collection "cards" is not declared in data',
    );
    expect(issues({ ...withMaterial, material: { sheet, items: { collection: "concepts", label: "title" } } })).toContain(
      'material.items.label: "title" is not a field of "concepts"',
    );
    const single = { scoped: false, single: true, schema: z.object({ name: z.string() }), agent: "read" as const };
    expect(issues({ ...withMaterial, data: { concepts, single }, material: { sheet, items: { collection: "single", label: "name" } } })).toContain(
      'material.items.collection: Fragments link to records by key: "single" needs a key, not single: true',
    );
  });

  it("sheet sections and kinds are unique, and the core's sheet sections are reserved", () => {
    const twice = { sections: [sheet.sections[0], sheet.sections[0]] };
    expect(issues({ ...withMaterial, material: { sheet: twice } })).toContain('material.sheet.sections: Section "terms" is declared twice');
    const core = { sections: [{ id: "notation", label: "Notation", prompt: "x" }] };
    expect(issues({ ...withMaterial, material: { sheet: core } })).toContain('material.sheet.sections: "notation" is a core sheet section');
    expect(issues({ ...withMaterial, material: { sheet, fragmentKinds: ["example", "example"] } })).toContain('material.fragmentKinds: "example" is listed twice');
    expect(issues({ ...withMaterial, material: { sheet, accepts: ["pdf", "pdf"] } })).toContain('material.accepts: "pdf" is listed twice');
  });

  it("with material, the stages' model keys are not action ids", () => {
    const actions = { ...base.actions, "material-review": { label: "Review", prompt: "tasks/study.md", cost: "light" as const } };
    expect(issues({ ...withMaterial, actions })).toContain('actions.material-review: "material-review" is reserved for a material stage: use another action id');
    // Without material the id is free (D0).
    expect(issues({ ...base, actions })).toEqual([]);
  });

  it("refuses bad bounds", () => {
    expect(issues({ ...withMaterial, material: { sheet, budget: { indexTokens: 10 } } }).some((i) => i.startsWith("material.budget"))).toBe(true);
    expect(issues({ ...withMaterial, material: { sheet: { sections: [] } } }).some((i) => i.startsWith("material.sheet.sections"))).toBe(true);
    expect(issues({ ...withMaterial, material: { sheet, accepts: ["images" as never] } }).some((i) => i.startsWith("material.accepts"))).toBe(true);
  });

  it("the fixture loads", async () => {
    const h = await loadHarness(fixture);
    expect(h.id).toBe("reader");
    expect(h.material?.items).toEqual({ collection: "concepts", label: "name" });
    expect(h.profiles?.label).toBe("student");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run packages/harness-sdk/test/material.test.ts`
Expected: FAIL (`hasMaterial` is not exported; the fixture doesn't exist).

- [ ] **Step 3: Write the contract**

Create `packages/harness-sdk/src/material.ts`:

```ts
import { z } from "zod";

/** The kinds of files the core reads (material spec §3). A harness may accept fewer. */
export const MATERIAL_FAMILIES = ["pdf", "word", "spreadsheet", "presentation", "ebook", "web", "text"] as const;
export type MaterialFamily = (typeof MATERIAL_FAMILIES)[number];
/** How a task in a scope uses its material (§9 "Ground"). */
export const GROUNDING_MODES = ["strict", "mixed"] as const;
export type GroundingMode = (typeof GROUNDING_MODES)[number];
/** The AI stages, in the order they run (§6.2, §8). */
export const MATERIAL_STAGES = ["review", "repair", "label", "sheet", "link"] as const;
export type MaterialStage = (typeof MATERIAL_STAGES)[number];
/** The two sections every sheet gets from the core (§8). */
export const CORE_SHEET_SECTIONS = { notation: "Notation and conventions", "not-covered": "What the material does not cover" } as const;
const ID = /^[a-z][a-z0-9-]{0,31}$/;
/** The tiers (index.ts `TIERS`; repeated here to avoid an import cycle, and tested to match). */
const tier = z.enum(["light", "standard", "deep"]);
type StageTier = z.output<typeof tier>;
/** What each stage runs at unless the harness says otherwise (§6.2: review standard, repairs light; §8). */
export const DEFAULT_STAGE_TIERS: Record<MaterialStage, StageTier> = { review: "standard", repair: "light", label: "light", sheet: "light", link: "standard" };

/** The key a stage's model setting lives under in `config.json` → `models.tasks`, next to the action ids. */
export const materialStageKey = (stage: MaterialStage): string => `material-${stage}`;
export const MATERIAL_STAGE_KEYS: readonly string[] = MATERIAL_STAGES.map(materialStageKey);

const sectionSchema = z.object({
  id: z.string().regex(ID),
  /** The heading the sheet shows (English). */
  label: z.string().min(1).max(80),
  /** What the AI writes in it (English). */
  prompt: z.string().min(1).max(400),
});

/** The manifest's `material` (§8). The rules that need the whole manifest are in its superRefine. */
export const materialSchema = z.object({
  accepts: z.array(z.enum(MATERIAL_FAMILIES)).min(1).default([...MATERIAL_FAMILIES]),
  sheet: z.object({ sections: z.array(sectionSchema).min(1).max(8), maxTokens: z.number().int().min(200).max(3000).default(800) }),
  fragmentKinds: z.array(z.string().regex(ID)).min(1).max(12).default(["explanation", "definition", "example", "exercise"]),
  /** Where the harness keeps the things fragments link to; absent: no linking stage. */
  items: z.object({ collection: z.string().min(1), label: z.string().min(1) }).optional(),
  grounding: z
    .object({ default: z.enum(GROUNDING_MODES).default("mixed"), personCanChange: z.boolean().default(true) })
    .default({ default: "mixed", personCanChange: true }),
  budget: z.object({ indexTokens: z.number().int().min(100).max(3000).default(600) }).default({ indexTokens: 600 }),
  tiers: z.object({ review: tier.optional(), repair: tier.optional(), label: tier.optional(), sheet: tier.optional(), link: tier.optional() }).default({}),
});
export type HarnessMaterial = z.output<typeof materialSchema>;

/** Whether the harness takes material; without it nothing of this feature exists (D0). */
export const hasMaterial = (h: { material?: unknown }): boolean => h.material !== undefined;

/** The tier a stage runs at: the harness's override, else the core's. */
export const stageTier = (m: Pick<HarnessMaterial, "tiers">, stage: MaterialStage): StageTier => m.tiers[stage] ?? DEFAULT_STAGE_TIERS[stage];
```

- [ ] **Step 4: Add it to the manifest**

In `packages/harness-sdk/src/index.ts`:

1. Import it, next to the profiles import, and export it after `export * from "./profiles";`:

```ts
import { CORE_SHEET_SECTIONS, MATERIAL_STAGE_KEYS, materialSchema } from "./material";
```

```ts
export * from "./material";
```

2. In `manifestSchema`, after `profiles`:

```ts
  /** The person's own files, cut into small fragments the agent fetches on demand (material spec). Absent: none (D0). */
  material: materialSchema.optional(),
```

3. At the end of the `superRefine`, after the profiles block:

```ts
  // Material (material spec §8).
  if (m.material) {
    const issue = (p: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path: ["material", ...p], message });
    const once = (list: readonly string[], key: string) => {
      const seen = new Set<string>();
      for (const v of list) {
        if (seen.has(v)) issue([key], `"${v}" is listed twice`);
        seen.add(v);
      }
    };
    once(m.material.accepts, "accepts");
    once(m.material.fragmentKinds, "fragmentKinds");
    const sections = new Set<string>();
    for (const s of m.material.sheet.sections) {
      if (Object.hasOwn(CORE_SHEET_SECTIONS, s.id)) issue(["sheet", "sections"], `"${s.id}" is a core sheet section`);
      else if (sections.has(s.id)) issue(["sheet", "sections"], `Section "${s.id}" is declared twice`);
      sections.add(s.id);
    }
    const items = m.material.items;
    if (items) {
      if (!Object.hasOwn(m.data, items.collection)) issue(["items", "collection"], `Collection "${items.collection}" is not declared in data`);
      else {
        const c = m.data[items.collection];
        if (c.single || c.key === undefined) issue(["items", "collection"], `Fragments link to records by key: "${items.collection}" needs a key, not single: true`);
        if (!Object.hasOwn(c.schema.shape, items.label)) issue(["items", "label"], `"${items.label}" is not a field of "${items.collection}"`);
      }
    }
    // Settings › Modelos keys each stage's setting next to the action ids.
    for (const key of MATERIAL_STAGE_KEYS) {
      if (Object.hasOwn(m.actions, key)) ctx.addIssue({ code: "custom", path: ["actions", key], message: `"${key}" is reserved for a material stage: use another action id` });
    }
  }
```

- [ ] **Step 5: Write the fixture**

Create `packages/fake-agent/fixtures/material-harness/harness.config.ts`:

```ts
// Test fixture for material processing: a reader. Each student adds their own chapters to a topic; fragments link to
// the topic's concepts.
import { z } from "zod";
import { PROFILE_COLORS, defineHarness } from "@humanharness/harness-sdk";

export default defineHarness({
  id: "reader",
  name: "Reader",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Reader" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  actions: {
    study: { label: "Study", prompt: "./agent/tasks/study.md", cost: "light" },
  },
  path: ["study"],
  scopes: { label: "topic", plural: "topics" },
  data: {
    profile: {
      scoped: false,
      single: true,
      schema: z.object({ name: z.string().min(1).max(40), color: z.enum(PROFILE_COLORS).optional() }),
      agent: "read",
    },
    concepts: {
      scoped: true,
      key: "id",
      schema: z.object({ id: z.string(), name: z.string().min(1).max(80) }),
      agent: "write",
      context: { fields: ["id", "name"], tokens: 200 },
    },
  },
  profiles: { label: "student", fields: ["name", "color"] },
  material: {
    sheet: { sections: [{ id: "terms", label: "Terms", prompt: "The key terms and what each means, one line each." }], maxTokens: 800 },
    items: { collection: "concepts", label: "name" },
    budget: { indexTokens: 600 },
  },
  author: "Human Harness tests",
});
```

Create `packages/fake-agent/fixtures/material-harness/agent/AGENTS.md`:

```markdown
# Reader

You help one student study their own material, one topic at a time.
```

Create `packages/fake-agent/fixtures/material-harness/agent/tasks/study.md`:

```markdown
# Task: study

Ask the student one short question about the material of this topic, citing the fragment it comes from.
```

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/harness-sdk/test/material.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS (every other manifest, fixture and `check` test is unchanged: D0).

- [ ] **Step 7: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/harness-sdk/src/material.ts packages/harness-sdk/src/index.ts packages/harness-sdk/test/material.test.ts packages/fake-agent/fixtures/material-harness
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(sdk): the manifest declares material"
```

(With the two attribution lines, as in Conventions; every commit below too.)

---

### Task 2: The material package: constants, types, file type detection

**Files:**
- Create: `packages/material/package.json`, `packages/material/src/index.ts`, `packages/material/src/constants.ts`, `packages/material/src/types.ts`, `packages/material/src/detect.ts`
- Test: `packages/material/test/detect.test.ts` (new)

`tsconfig.json` and `vitest.config.ts` already include `packages/*/src` and `packages/*/test`.

- [ ] **Step 1: Create the package**

Create `packages/material/package.json`:

```json
{
  "name": "@humanharness/material",
  "version": "0.1.0",
  "type": "module",
  "license": "Apache-2.0",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@humanharness/blocks": "workspace:*",
    "@humanharness/harness-sdk": "workspace:*",
    "@humanharness/workspace": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.32.1",
    "zod": "^4.6.5"
  }
}
```

Run: `corepack pnpm install`
Expected: the workspace links `@humanharness/material`.

- [ ] **Step 2: Write the failing test**

Create `packages/material/test/detect.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectType } from "../src";

const bytes = (...b: number[]) => Buffer.from(b);
const zip = Buffer.concat([bytes(0x50, 0x4b, 0x03, 0x04), Buffer.alloc(40)]);

describe("detectType (material spec §3: content first, extension second)", () => {
  it("reads a PDF by its magic bytes, even renamed", () => {
    expect(detectType("notes.txt", Buffer.from("%PDF-1.7\n…"))).toEqual({ ok: true, type: "pdf", family: "pdf" });
  });

  it("tells zip-based formats apart by their extension (the zip's own files are checked later)", () => {
    expect(detectType("a.docx", zip)).toEqual({ ok: true, type: "docx", family: "word" });
    expect(detectType("a.ODT", zip)).toEqual({ ok: true, type: "odt", family: "word" });
    expect(detectType("a.xlsx", zip)).toEqual({ ok: true, type: "xlsx", family: "spreadsheet" });
    expect(detectType("a.ods", zip)).toEqual({ ok: true, type: "ods", family: "spreadsheet" });
    expect(detectType("a.pptx", zip)).toEqual({ ok: true, type: "pptx", family: "presentation" });
    expect(detectType("a.odp", zip)).toEqual({ ok: true, type: "odp", family: "presentation" });
    expect(detectType("a.epub", zip)).toEqual({ ok: true, type: "epub", family: "ebook" });
    expect(detectType("a.zip", zip)).toMatchObject({ ok: false, reason: "unreadable" });
  });

  it("refuses images, audio and video with the reason the person reads", () => {
    for (const [name, b] of [
      ["photo.jpg", bytes(0xff, 0xd8, 0xff, 0xe0)],
      ["scan.png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
      ["a.gif", Buffer.from("GIF89a")],
      ["clip.mp4", Buffer.concat([bytes(0, 0, 0, 0x18), Buffer.from("ftypmp42")])],
      ["voice.mp3", Buffer.from("ID3\u0004")],
      ["a.wav", Buffer.concat([Buffer.from("RIFF"), bytes(0, 0, 0, 0), Buffer.from("WAVE")])],
      ["a.webp", Buffer.concat([Buffer.from("RIFF"), bytes(0, 0, 0, 0), Buffer.from("WEBP")])],
    ] as const) {
      expect(detectType(name, b)).toEqual({ ok: false, reason: "media", message: "The app only works with files that have text." });
    }
  });

  it("refuses old Office formats with the way out", () => {
    const ole = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
    expect(detectType("old.doc", ole)).toEqual({ ok: false, reason: "old-office", message: "Save it as .docx, .xlsx or .pptx and add it again." });
    expect(detectType("old.xls", Buffer.from("anything"))).toMatchObject({ ok: false, reason: "old-office" });
  });

  it("reads web pages, RTF, CSV and every text file; an unknown extension that decodes as text is text", () => {
    expect(detectType("page.html", Buffer.from("<!doctype html><p>Hi</p>"))).toEqual({ ok: true, type: "html", family: "web" });
    expect(detectType("page.txt", Buffer.from("<html><body>x</body></html>"))).toEqual({ ok: true, type: "html", family: "web" });
    expect(detectType("a.rtf", Buffer.from("{\\rtf1\\ansi Hello}"))).toEqual({ ok: true, type: "rtf", family: "word" });
    expect(detectType("a.csv", Buffer.from("a,b\n1,2\n"))).toEqual({ ok: true, type: "csv", family: "spreadsheet" });
    expect(detectType("a.tsv", Buffer.from("a\tb\n"))).toEqual({ ok: true, type: "tsv", family: "spreadsheet" });
    expect(detectType("a.md", Buffer.from("# Hi"))).toEqual({ ok: true, type: "md", family: "text" });
    expect(detectType("a.json", Buffer.from("{}"))).toEqual({ ok: true, type: "json", family: "text" });
    expect(detectType("a.py", Buffer.from("def f(): pass"))).toEqual({ ok: true, type: "code", family: "text" });
    expect(detectType("README", Buffer.from("Just words."))).toEqual({ ok: true, type: "txt", family: "text" });
  });

  it("refuses anything that is not text: NUL bytes or mostly unprintable", () => {
    expect(detectType("a.bin", bytes(0x41, 0x00, 0x42))).toMatchObject({ ok: false, reason: "binary" });
    expect(detectType("a.dat", Buffer.from(Array.from({ length: 100 }, (_, i) => (i % 2 ? 0x01 : 0x41))))).toMatchObject({ ok: false, reason: "binary" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `corepack pnpm vitest run packages/material/test/detect.test.ts`
Expected: FAIL (`../src` doesn't exist yet).

- [ ] **Step 4: Write the constants and types**

Create `packages/material/src/constants.ts`:

```ts
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
```

Create `packages/material/src/types.ts`:

```ts
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
export type Refusal = "media" | "old-office" | "binary" | "unreadable" | "scanned" | "protected" | "too-big" | "not-accepted" | "fetch";

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
  addedAt: string;
}
```

- [ ] **Step 5: Write the detection**

Create `packages/material/src/detect.ts`:

```ts
import path from "node:path";
import type { Detected, MaterialType } from "./types";

const MEDIA = "The app only works with files that have text.";
const OLD_OFFICE = "Save it as .docx, .xlsx or .pptx and add it again.";
const BINARY = "This file has no text the app can read.";

const starts = (b: Buffer, sig: number[] | string, at = 0) => {
  const s = typeof sig === "string" ? Buffer.from(sig, "latin1") : Buffer.from(sig);
  return b.length >= at + s.length && b.subarray(at, at + s.length).equals(s);
};

const ZIP_TYPES: Record<string, Exclude<Detected, { ok: false }>> = {
  ".docx": { ok: true, type: "docx", family: "word" },
  ".odt": { ok: true, type: "odt", family: "word" },
  ".xlsx": { ok: true, type: "xlsx", family: "spreadsheet" },
  ".ods": { ok: true, type: "ods", family: "spreadsheet" },
  ".pptx": { ok: true, type: "pptx", family: "presentation" },
  ".odp": { ok: true, type: "odp", family: "presentation" },
  ".epub": { ok: true, type: "epub", family: "ebook" },
};
const OLD = new Set([".doc", ".xls", ".ppt"]);
const MEDIA_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".tif", ".tiff", ".bmp", ".svg", ".mp3", ".wav", ".m4a", ".ogg", ".flac", ".mp4", ".mov", ".avi", ".mkv", ".webm"]);
const TEXT_EXT: Record<string, MaterialType> = { ".md": "md", ".markdown": "md", ".txt": "txt", ".json": "json", ".xml": "xml", ".yaml": "yaml", ".yml": "yaml" };
const CODE_EXT = new Set([".js", ".ts", ".tsx", ".jsx", ".py", ".java", ".c", ".h", ".cpp", ".cs", ".go", ".rs", ".rb", ".php", ".swift", ".kt", ".sql", ".sh", ".css", ".scss"]);

/** Image, audio and video signatures (§3 "Refused at intake"). */
function isMedia(b: Buffer): boolean {
  if (starts(b, [0xff, 0xd8, 0xff]) || starts(b, [0x89, 0x50, 0x4e, 0x47]) || starts(b, "GIF8") || starts(b, "II*\0") || starts(b, "MM\0*") || starts(b, "BM")) return true;
  if (starts(b, "RIFF") && (starts(b, "WEBP", 8) || starts(b, "WAVE", 8) || starts(b, "AVI ", 8))) return true;
  if (starts(b, "ftyp", 4)) return true; // mp4, mov, heic, m4a
  if (starts(b, "ID3") || starts(b, [0xff, 0xfb]) || starts(b, "OggS") || starts(b, "fLaC") || starts(b, [0x1a, 0x45, 0xdf, 0xa3])) return true;
  return false;
}

/** Text: no NUL byte, and at most 10% control characters (tabs, line and page breaks excepted) in the first 64 KB. */
export function looksLikeText(b: Buffer): boolean {
  const head = b.subarray(0, 65536);
  if (head.includes(0)) return false;
  let control = 0;
  for (const c of head) if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d && c !== 0x0c) control++;
  return head.length === 0 || control / head.length <= 0.1;
}

/**
 * The file's type from its content first (magic bytes), its extension second (§3), or why it is refused. Zip-based
 * formats are told apart by their extension here; their converter refuses a zip that lacks the expected parts.
 * `head` is the file's first bytes (64 KB are enough).
 */
export function detectType(name: string, head: Buffer): Detected {
  const ext = path.extname(name).toLowerCase();
  if (starts(head, "%PDF-")) return { ok: true, type: "pdf", family: "pdf" };
  if (isMedia(head)) return { ok: false, reason: "media", message: MEDIA };
  if (OLD.has(ext) || starts(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return { ok: false, reason: "old-office", message: OLD_OFFICE };
  if (starts(head, [0x50, 0x4b, 0x03, 0x04])) {
    return Object.hasOwn(ZIP_TYPES, ext) ? ZIP_TYPES[ext] : { ok: false, reason: "unreadable", message: BINARY };
  }
  if (MEDIA_EXT.has(ext)) return { ok: false, reason: "media", message: MEDIA };
  if (!looksLikeText(head)) return { ok: false, reason: "binary", message: BINARY };
  if (starts(head, "{\\rtf")) return { ok: true, type: "rtf", family: "word" };
  const start = head.subarray(0, 1024).toString("latin1").trimStart().toLowerCase();
  if (ext === ".html" || ext === ".htm" || start.startsWith("<!doctype html") || start.startsWith("<html")) return { ok: true, type: "html", family: "web" };
  if (ext === ".csv") return { ok: true, type: "csv", family: "spreadsheet" };
  if (ext === ".tsv") return { ok: true, type: "tsv", family: "spreadsheet" };
  if (Object.hasOwn(TEXT_EXT, ext)) return { ok: true, type: TEXT_EXT[ext], family: "text" };
  if (CODE_EXT.has(ext)) return { ok: true, type: "code", family: "text" };
  return { ok: true, type: "txt", family: "text" };
}

/** Refusal messages the pipeline uses beyond detection (§3, §7). English, shown to the person. */
export const REFUSAL_TEXT = {
  scanned: "This PDF is scanned: it has no text the app can read.",
  protected: "This file is protected by a password or damaged.",
  unreadable: "This file is damaged or not what its name says.",
  "too-big": "This file is too big. Add only the chapters you need.",
  "not-accepted": "This app doesn't take this kind of file.",
  fetch: "The page couldn't be read. Check the link and try again.",
} as const;
```

Create `packages/material/src/index.ts`:

```ts
export * from "./constants";
export * from "./types";
export * from "./detect";
```

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/material/test/detect.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/material pnpm-lock.yaml
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(material): the package, its thresholds, and file type detection"
```

---

### Task 3: Plain text, and the block model

Every converter gives `MdBlock[]`. Markdown text (a `.md` file, and later what other converters build) is read into blocks here; plain text, structured data and code get their own rules (§3 "Plain text").

**Files:**
- Create: `packages/material/src/blocks.ts`, `packages/material/src/convert/text.ts`
- Modify: `packages/material/src/index.ts`
- Test: `packages/material/test/text.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/material/test/text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decodeText, locRange, markdownBlocks, textBlocks, withEstimatedPages } from "../src";

describe("decodeText (§3: UTF-8, falling back to Windows-1252)", () => {
  it("reads UTF-8, drops a BOM, and falls back for a Windows-1252 file", () => {
    expect(decodeText(Buffer.from("﻿café", "utf8"))).toBe("café");
    expect(decodeText(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
  });
});

describe("markdownBlocks", () => {
  it("reads headings, paragraphs, lists, tables, code and images, with line locations", () => {
    const md = ["# Fractions", "", "A fraction has two parts.", "It is written a/b.", "", "- one", "- two", "", "| a | b |", "|---|---|", "| 1 | 2 |", "", "```", "x = 1", "```", "", "![diagram](d.png)"].join("\n");
    const blocks = markdownBlocks(md);
    expect(blocks.map((b) => [b.kind, b.level ?? null, b.loc])).toEqual([
      ["heading", 1, "lines 1"],
      ["para", null, "lines 3–4"],
      ["list", null, "lines 6–7"],
      ["table", null, "lines 9–11"],
      ["code", null, "lines 13–15"],
      ["image", null, "lines 17"],
    ]);
    expect(blocks[1].md).toBe("A fraction has two parts.\nIt is written a/b.");
    expect(blocks[5].md).toBe("[image, lines 17]");
  });

  it("estimated pages: every PAGE_TOKENS tokens is a page", () => {
    const blocks = withEstimatedPages(markdownBlocks(Array.from({ length: 6 }, (_, i) => `${"word ".repeat(300)}${i}`).join("\n\n")));
    // Each paragraph is 376 tokens; a block's page is where it starts: 0, 376, 752, 1128, 1504, 1880 tokens in.
    expect(blocks.map((b) => b.page)).toEqual([1, 1, 2, 3, 4, 4]);
  });
});

describe("locRange", () => {
  it("joins two marks with the same prefix into a range", () => {
    expect(locRange("p.4", "p.5")).toBe("p.4–5");
    expect(locRange("p.4", "p.4")).toBe("p.4");
    expect(locRange("lines 3–4", "lines 9–11")).toBe("lines 3–11");
    expect(locRange("slide 2", "slide 3")).toBe("slide 2–3");
    expect(locRange("§ A ¶2", "§ B ¶1")).toBe("§ A ¶2");
  });
});

describe("textBlocks (§3 plain text)", () => {
  it("plain text: paragraphs at blank lines, no headings", () => {
    const blocks = textBlocks("txt", Buffer.from("First line.\nStill first.\n\nSecond."));
    expect(blocks.map((b) => [b.kind, b.md])).toEqual([
      ["para", "First line.\nStill first."],
      ["para", "Second."],
    ]);
  });

  it("JSON: one heading and one fenced block per top-level key", () => {
    const blocks = textBlocks("json", Buffer.from('{"name":"a","items":[1,2]}'));
    expect(blocks.map((b) => [b.kind, b.md])).toEqual([
      ["heading", "## name"],
      ["code", '```json\n"a"\n```'],
      ["heading", "## items"],
      ["code", "```json\n[\n  1,\n  2\n]\n```"],
    ]);
  });

  it("YAML is cut at top-level keys; code at top-level definitions", () => {
    const yaml = textBlocks("yaml", Buffer.from("a: 1\nb:\n  c: 2\n"));
    expect(yaml.filter((b) => b.kind === "heading").map((b) => b.md)).toEqual(["## a", "## b"]);
    const code = textBlocks("code", Buffer.from("import x from 'y';\n\nexport function add(a, b) {\n  return a + b;\n}\n\nclass Box {}\n"));
    expect(code.filter((b) => b.kind === "heading").map((b) => b.md)).toEqual(["## export function add(a, b) {", "## class Box {}"]);
    expect(code[0]).toMatchObject({ kind: "code", md: "```\nimport x from 'y';\n```" });
  });

  it("an empty file has no blocks", () => {
    expect(textBlocks("txt", Buffer.from("  \n\n"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run packages/material/test/text.test.ts`
Expected: FAIL (`markdownBlocks` is not exported).

- [ ] **Step 3: Write the block model**

Create `packages/material/src/blocks.ts`:

```ts
import { estimateTokens } from "@humanharness/workspace";
import { PAGE_TOKENS } from "./constants";
import type { MdBlock } from "./types";

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST = /^ {0,3}([-*+]|\d{1,9}[.)])\s+/;
const TABLE = /^ {0,3}\|/;
const IMAGE = /^ {0,3}!\[[^\]]*\]\([^)]*\)\s*$/;

/** `lines 3–4`, or `lines 3` for one line. */
const lines = (from: number, to: number) => (from === to ? `lines ${from}` : `lines ${from}–${to}`);

/**
 * Markdown into blocks (one pass, no nesting): ATX headings, fenced code, lists (a run of list lines and their
 * indented continuations), tables (a run of `|` lines), a lone image (a placeholder, never described: §3), and
 * paragraphs. `loc` defaults to the line range; a converter that knows better passes `locOf`.
 */
export function markdownBlocks(md: string, locOf: (from: number, to: number) => string = lines, page = 1): MdBlock[] {
  const all = md.replace(/\r\n?/g, "\n").split("\n");
  const out: MdBlock[] = [];
  let i = 0;
  const push = (kind: MdBlock["kind"], from: number, to: number, text: string, level?: number) =>
    out.push({ kind, ...(level !== undefined ? { level } : {}), md: text, loc: locOf(from + 1, to + 1), page });
  while (i < all.length) {
    const line = all[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const start = i;
      const close = new RegExp(`^ {0,3}${fence[1][0] === "`" ? "`" : "~"}{${fence[1].length},}\\s*$`);
      for (i++; i < all.length && !close.test(all[i]); i++);
      push("code", start, Math.min(i, all.length - 1), all.slice(start, i + 1).join("\n"));
      i++;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      push("heading", i, i, `${heading[1]} ${heading[2]}`, heading[1].length);
      i++;
      continue;
    }
    if (IMAGE.test(line)) {
      out.push({ kind: "image", md: `[image, ${locOf(i + 1, i + 1)}]`, loc: locOf(i + 1, i + 1), page });
      i++;
      continue;
    }
    const start = i;
    const kind: MdBlock["kind"] = LIST.test(line) ? "list" : TABLE.test(line) ? "table" : "para";
    for (i++; i < all.length && all[i].trim(); i++) {
      const next = all[i];
      if (FENCE.test(next) || HEADING.test(next)) break;
      if (kind === "table" && !TABLE.test(next)) break;
      if (kind === "para" && (LIST.test(next) || TABLE.test(next))) break;
    }
    push(kind, start, i - 1, all.slice(start, i).join("\n"));
  }
  return out;
}

/** Blocks with an estimated page each (§7: a page is about PAGE_TOKENS tokens), for files without pages. */
export function withEstimatedPages(blocks: MdBlock[]): MdBlock[] {
  let tokens = 0;
  return blocks.map((b) => {
    const page = Math.floor(tokens / PAGE_TOKENS) + 1;
    tokens += estimateTokens(b.md);
    return { ...b, page };
  });
}

/** The pages a converted list spans. */
export const pagesOf = (blocks: MdBlock[]): number => blocks.reduce((n, b) => Math.max(n, b.page), 0);

/**
 * One location for a run of blocks: `p.4–5` when both marks end in a number after the same prefix (a range's own
 * end counts: `lines 3–4` to `lines 9–11` is `lines 3–11`); else the first mark.
 */
export function locRange(first: string, last: string): string {
  const a = /^(.*?)(\d+)(?:–\d+)?$/.exec(first);
  const b = /^(.*?)(?:\d+–)?(\d+)$/.exec(last);
  if (!a || !b || a[1] !== b[1]) return first;
  return a[2] === b[2] ? `${a[1]}${a[2]}` : `${a[1]}${a[2]}–${b[2]}`;
}
```

- [ ] **Step 4: Write the text converter**

Create `packages/material/src/convert/text.ts`:

```ts
import { markdownBlocks, withEstimatedPages } from "../blocks";
import type { MaterialType, MdBlock } from "../types";

/** UTF-8 (strict), else Windows-1252 (§3); a BOM goes. */
export function decodeText(b: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    text = new TextDecoder("windows-1252").decode(b);
  }
  return text.replace(/^﻿/, "");
}

const lines = (from: number, to: number) => (from === to ? `lines ${from}` : `lines ${from}–${to}`);
const fenced = (lang: string, body: string) => `\`\`\`${lang}\n${body.replace(/\n+$/, "")}\n\`\`\``;
const DEFINITION = /^(export\s+)?(default\s+)?(async\s+)?(function|class|def|interface|type|enum|struct|impl|fn|func|pub\s+fn|const|let|var)\b/;
const YAML_KEY = /^[A-Za-z0-9_"'][^:#]*:(\s|$)/;

/** Splits `text` at the lines `isStart` marks; each part becomes a heading (the start line) and a fenced block. */
function cutAt(text: string, lang: string, isStart: (line: string) => boolean, title: (line: string) => string): MdBlock[] {
  const all = text.replace(/\r\n?/g, "\n").split("\n");
  const out: MdBlock[] = [];
  let start = 0;
  const flush = (end: number, headed: boolean) => {
    const body = all.slice(start, end).join("\n");
    if (!body.trim()) return;
    if (headed) out.push({ kind: "heading", level: 2, md: `## ${title(all[start]).slice(0, 80)}`, loc: lines(start + 1, start + 1), page: 1 });
    out.push({ kind: "code", md: fenced(lang, body.trim()), loc: lines(start + 1, end), page: 1 });
  };
  let headed = false;
  for (let i = 0; i < all.length; i++) {
    if (i > start && isStart(all[i])) {
      flush(i, headed);
      start = i;
      headed = true;
    } else if (i === 0 && isStart(all[i])) headed = true;
  }
  flush(all.length, headed);
  return out;
}

/** Plain text, Markdown, structured data and code into blocks (§3 "Plain text"). */
export function textBlocks(type: Extract<MaterialType, "md" | "txt" | "json" | "xml" | "yaml" | "code">, buf: Buffer): MdBlock[] {
  const text = decodeText(buf);
  if (!text.trim()) return [];
  switch (type) {
    case "md":
      return withEstimatedPages(markdownBlocks(text));
    case "txt": {
      // Plain text has no Markdown: every run of lines is a paragraph, kept as written.
      const out: MdBlock[] = [];
      const all = text.replace(/\r\n?/g, "\n").split("\n");
      for (let i = 0; i < all.length; ) {
        if (!all[i].trim()) {
          i++;
          continue;
        }
        const start = i;
        while (i < all.length && all[i].trim()) i++;
        out.push({ kind: "para", md: all.slice(start, i).join("\n"), loc: lines(start + 1, i), page: 1 });
      }
      return withEstimatedPages(out);
    }
    case "json": {
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return withEstimatedPages([{ kind: "code", md: fenced("json", text.trim()), loc: "lines 1", page: 1 }]);
      }
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return withEstimatedPages([{ kind: "code", md: fenced("json", JSON.stringify(value, null, 2)), loc: "lines 1", page: 1 }]);
      }
      return withEstimatedPages(
        Object.entries(value).flatMap(([k, v]): MdBlock[] => [
          { kind: "heading", level: 2, md: `## ${k.slice(0, 80)}`, loc: `key ${k.slice(0, 40)}`, page: 1 },
          { kind: "code", md: fenced("json", JSON.stringify(v, null, 2)), loc: `key ${k.slice(0, 40)}`, page: 1 },
        ]),
      );
    }
    case "yaml":
      return withEstimatedPages(cutAt(text, "yaml", (l) => YAML_KEY.test(l), (l) => l.split(":")[0].replace(/["']/g, "")));
    case "xml":
      return withEstimatedPages(cutAt(text, "xml", () => false, (l) => l));
    case "code":
      return withEstimatedPages(cutAt(text, "", (l) => DEFINITION.test(l), (l) => l.trim()));
  }
}
```

Add to `packages/material/src/index.ts`:

```ts
export * from "./blocks";
export * from "./convert/text";
```

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/material/test/text.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/material
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(material): plain text, structured data, code, and the block model"
```

---

### Task 4: Cutting

The cutter turns blocks into fragments (§5) and a sheet's rows into table fragments (§3). It never reads or writes files.

**Files:**
- Create: `packages/material/src/cut.ts`
- Modify: `packages/material/src/index.ts`
- Test: `packages/material/test/cut.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/material/test/cut.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type MdBlock, cutBlocks, cutRows, estimateTokens } from "../src";

const h = (level: number, text: string, loc = "p.1", page = 1): MdBlock => ({ kind: "heading", level, md: `${"#".repeat(level)} ${text}`, loc, page });
const p = (words: number, loc = "p.1", page = 1): MdBlock => ({ kind: "para", md: `${"word ".repeat(words).trim()}.`, loc, page });

describe("cutBlocks (material spec §5)", () => {
  it("cuts at headings #–###, carrying the heading path", () => {
    const pieces = cutBlocks([h(1, "Fractions"), p(200), h(2, "Equivalent"), p(200), h(3, "Example 2"), p(200), h(4, "Deep"), p(10)]);
    expect(pieces.map((x) => x.path)).toEqual(["Fractions", "Fractions › Equivalent", "Fractions › Equivalent › Example 2"]);
    // A level-4 heading stays inside its section.
    expect(pieces[2].md).toContain("#### Deep");
  });

  it("splits a section above MAX at paragraph breaks into pieces near TARGET, never inside a paragraph", () => {
    const pieces = cutBlocks([h(1, "Long"), ...Array.from({ length: 8 }, () => p(240))]);
    expect(pieces.length).toBeGreaterThan(1);
    for (const x of pieces) expect(estimateTokens(x.md)).toBeLessThanOrEqual(900);
    // Every piece after the first repeats no heading but keeps the path.
    expect(pieces.every((x) => x.path === "Long")).toBe(true);
  });

  it("merges a section below MIN with the next one under the same parent; a heading with no text joins its first child", () => {
    const pieces = cutBlocks([h(1, "A"), h(2, "Short"), p(20), h(2, "Next"), p(200), h(1, "B"), p(20)]);
    expect(pieces.map((x) => x.path)).toEqual(["A › Short", "B"]);
    expect(pieces[0].md).toContain("## Next");
  });

  it("keeps examples and exercises whole, even above MAX", () => {
    const pieces = cutBlocks([h(2, "Exercise 3"), ...Array.from({ length: 6 }, () => p(240))]);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].whole).toBe(true);
  });

  it("a range of locations and the pages it spans", () => {
    const pieces = cutBlocks([h(1, "A", "p.4", 4), p(200, "p.4", 4), p(200, "p.5", 5)]);
    expect(pieces[0]).toMatchObject({ location: "p.4–5", pages: [4, 5] });
  });

  it("text before the first heading is a piece with an empty path", () => {
    expect(cutBlocks([p(200), h(1, "A"), p(200)]).map((x) => x.path)).toEqual(["", "A"]);
  });
});

describe("cutRows (§3: spreadsheets are cut by rows)", () => {
  it("fragments of about TARGET tokens, each repeating the header row", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ md: `| ${i} | some value here | another value |`, loc: `Data!A${i + 2}:C${i + 2}` }));
    const pieces = cutRows({ name: "Data", header: "| n | a | b |\n|---|---|---|", columns: ["n", "a", "b"], rows });
    expect(pieces.length).toBeGreaterThan(2);
    for (const x of pieces) {
      expect(x.md.startsWith("| n | a | b |\n|---|---|---|\n")).toBe(true);
      expect(estimateTokens(x.md)).toBeLessThanOrEqual(700);
    }
    expect(pieces[0].location).toMatch(/^Data!A2:C\d+$/);
    expect(pieces[0].path).toBe("Data");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run packages/material/test/cut.test.ts`
Expected: FAIL (`cutBlocks` is not exported).

- [ ] **Step 3: Write the cutter**

Create `packages/material/src/cut.ts`:

```ts
import { estimateTokens } from "@humanharness/workspace";
import { locRange } from "./blocks";
import { MAX, MIN, TARGET } from "./constants";
import type { MdBlock, SheetRows } from "./types";

/** A fragment before it gets an id and front matter. */
export interface Piece {
  /** Heading path: "Fractions › Equivalent fractions › Example 2"; "" before the first heading. */
  path: string;
  md: string;
  location: string;
  /** The pages it spans, in order. */
  pages: number[];
  /** An example or exercise kept whole (§5.4); the size check doesn't flag it. */
  whole?: true;
  /** The program's guess before labelling (§4.1 `kind`): "example" or "exercise" from the heading. */
  kind?: string;
}

/** A heading that starts an example or an exercise (§5.4), in English and in the languages the material may use. */
const WHOLE = /^(example|exercise|problem|worked example|ejemplo|ejercicio|problema|exemple|exercice|beispiel|aufgabe|esempio|esercizio|exemplo|exerc[ií]cio)\b/i;

interface Section {
  path: string[];
  level: number;
  blocks: MdBlock[];
}

const headingText = (b: MdBlock) => b.md.replace(/^#+\s*/, "").trim();

function sections(blocks: MdBlock[]): Section[] {
  const out: Section[] = [];
  const stack: string[] = [];
  let current: Section = { path: [], level: 0, blocks: [] };
  for (const b of blocks) {
    if (b.kind === "heading" && (b.level ?? 1) <= 3) {
      if (current.blocks.length > 0) out.push(current);
      const level = b.level ?? 1;
      stack.length = level - 1;
      stack[level - 1] = headingText(b);
      current = { path: stack.filter((s) => s !== undefined), level, blocks: [b] };
    } else current.blocks.push(b);
  }
  if (current.blocks.length > 0) out.push(current);
  return out;
}

const tokensOf = (bs: MdBlock[]) => estimateTokens(bs.map((b) => b.md).join("\n\n"));

function piece(path: string[], bs: MdBlock[], extra: Partial<Piece> = {}): Piece {
  const pages = [...new Set(bs.map((b) => b.page))].sort((a, b) => a - b);
  return { path: path.join(" › "), md: bs.map((b) => b.md).join("\n\n"), location: locRange(bs[0].loc, bs[bs.length - 1].loc), pages, ...extra };
}

/** A section above MAX split at block boundaries (paragraphs, lists, tables stay whole) into pieces near TARGET (§5.2). */
function split(s: Section): Section[] {
  const out: Section[] = [];
  let run: MdBlock[] = [];
  for (const b of s.blocks) {
    if (run.length > 0 && tokensOf([...run, b]) > TARGET && tokensOf(run) >= MIN) {
      out.push({ ...s, blocks: run });
      run = [];
    }
    run.push(b);
  }
  if (run.length > 0) out.push({ ...s, blocks: run });
  return out;
}

const parentOf = (s: Section) => s.path.slice(0, Math.max(0, s.level - 1)).join(" › ");

/** Blocks into fragments (§5): cut at #–###, split above MAX, merge below MIN, examples and exercises whole. */
export function cutBlocks(blocks: MdBlock[]): Piece[] {
  const merged: Section[] = [];
  for (const s of sections(blocks)) {
    const prev = merged[merged.length - 1];
    // A heading with nothing under it but its children ("# Fractions" then "## Equivalent…") joins its first child,
    // which gives the path.
    if (prev && prev.blocks.every((b) => b.kind === "heading") && s.path.length > prev.path.length) {
      prev.blocks.push(...s.blocks);
      prev.path = s.path;
      prev.level = s.level;
      continue;
    }
    // §5.3: a short section joins the next one under the same parent; the first keeps its path.
    if (prev && tokensOf(prev.blocks) < MIN && !isWhole(prev) && !isWhole(s) && parentOf(prev) === parentOf(s) && prev.level <= s.level) {
      prev.blocks.push(...s.blocks);
      continue;
    }
    merged.push({ ...s, blocks: [...s.blocks] });
  }
  return merged.flatMap((s): Piece[] => {
    const whole = isWhole(s);
    const kind = whole ? (/exerc|problem|aufgabe|esercizio/i.test(s.path.at(-1) ?? "") ? "exercise" : "example") : undefined;
    if (whole) return [piece(s.path, s.blocks, { whole: true, ...(kind ? { kind } : {}) })];
    if (tokensOf(s.blocks) <= MAX) return [piece(s.path, s.blocks)];
    return split(s).map((part) => piece(s.path, part.blocks));
  });
}

function isWhole(s: Section): boolean {
  const last = s.path[s.path.length - 1];
  return last !== undefined && s.blocks[0]?.kind === "heading" && WHOLE.test(last);
}

/** A sheet's rows into table fragments of about TARGET tokens, each repeating the header row (§3). */
export function cutRows(sheet: SheetRows): Piece[] {
  const out: Piece[] = [];
  let run: { md: string; loc: string }[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const first = run[0].loc;
    const last = run[run.length - 1].loc;
    // "Data!A2:C2" … "Data!A9:C9" → "Data!A2:C9".
    const location = `${first.split(":")[0]}:${last.split(":")[1] ?? last}`;
    out.push({ path: sheet.name, md: `${sheet.header}\n${run.map((r) => r.md).join("\n")}`, location, pages: [1] });
    run = [];
  };
  for (const r of sheet.rows) {
    if (run.length > 0 && estimateTokens(`${sheet.header}\n${[...run, r].map((x) => x.md).join("\n")}`) > TARGET) flush();
    run.push(r);
  }
  flush();
  return out;
}
```

Add `export * from "./cut";` to `packages/material/src/index.ts`, and re-export `estimateTokens` for the tests and callers:

```ts
export { estimateTokens } from "@humanharness/workspace";
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/material/test/cut.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/material
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(material): cut blocks into fragments, and sheets by rows"
```

---

### Task 5: Program checks

**Files:**
- Create: `packages/material/src/checks.ts`
- Modify: `packages/material/src/index.ts`
- Test: `packages/material/test/checks.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/material/test/checks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type Piece, checkPieces } from "../src";

const piece = (md: string, path = "A", extra: Partial<Piece> = {}): Piece => ({ path, md, location: "p.1", pages: [1], ...extra });
const prose = (n: number) => Array.from({ length: n }, (_, i) => `Sentence number ${i} explains one idea clearly.`).join(" ");

describe("checkPieces (material spec §6.1)", () => {
  it("passes clean prose", () => {
    const r = checkPieces([piece(`## A\n\n${prose(30)}`), piece(`## B\n\n${prose(30)}`, "B"), piece(`## C\n\n${prose(30)}`, "C")]);
    expect(r.flags).toEqual([[], [], []]);
    expect(r.sourceIssues).toEqual([]);
  });

  it("garbled: replacement characters, or mostly non-letters", () => {
    const r = checkPieces([piece(`${prose(20)} ��`), piece("%%$$##@@ 12 ;; ** ++ == -- !! ^^ && $$ %% @@ ## ;; ** ++ =="), piece(prose(30))]);
    expect(r.flags[0]).toContain("garbled");
    expect(r.flags[1]).toContain("garbled");
  });

  it("reading-order: paragraphs that stop mid-sentence and go on in lowercase", () => {
    const md = ["The numerator tells how many", "", "parts we take, and the denominator", "", "how many parts make the whole."].join("\n");
    expect(checkPieces([piece(md), piece(prose(30)), piece(prose(30))]).flags[0]).toContain("reading-order");
  });

  it("size: far outside the range, unless kept whole; and a long source cut into one or two pieces", () => {
    const tiny = checkPieces([piece("Hi."), piece(prose(30)), piece(prose(30))]);
    expect(tiny.flags[0]).toContain("size");
    const whole = checkPieces([piece(prose(400), "Example 1", { whole: true }), piece(prose(30)), piece(prose(30))]);
    expect(whole.flags[0]).not.toContain("size");
    const two = checkPieces([piece(prose(300)), piece(prose(300))]);
    expect(two.sourceIssues).toContain("The whole file became only 2 fragments.");
  });

  it("no-structure: a long source with no headings", () => {
    const r = checkPieces(Array.from({ length: 6 }, () => piece(prose(60), "")));
    expect(r.sourceIssues).toContain("The file has no headings.");
    expect(r.flags.every((f) => f.includes("no-structure"))).toBe(true);
  });

  it("table: rows with different column counts", () => {
    expect(checkPieces([piece("| a | b |\n|---|---|\n| 1 | 2 | 3 |"), piece(prose(30)), piece(prose(30))]).flags[0]).toContain("table");
  });

  it("noise: a table of contents, an index or a bibliography", () => {
    const toc = Array.from({ length: 12 }, (_, i) => `Chapter ${i} .......... ${i * 10}`).join("\n");
    expect(checkPieces([piece(toc, "Contents"), piece(prose(30)), piece(prose(30))]).flags[0]).toContain("noise");
    expect(checkPieces([piece(prose(30), "Bibliography"), piece(prose(30)), piece(prose(30))]).flags[0]).toContain("noise");
  });

  it("leftover: a line repeated in three or more fragments", () => {
    const running = "Mathematics 6 — Chapter 2";
    const r = checkPieces([piece(`${running}\n\n${prose(30)}`), piece(`${running}\n\n${prose(30)}`), piece(`${running}\n\n${prose(30)}`), piece(prose(30))]);
    expect(r.flags.slice(0, 3).every((f) => f.includes("leftover"))).toBe(true);
    expect(r.flags[3]).not.toContain("leftover");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run packages/material/test/checks.test.ts`
Expected: FAIL (`checkPieces` is not exported).

- [ ] **Step 3: Write the checks**

Create `packages/material/src/checks.ts`:

```ts
import { estimateTokens } from "@humanharness/workspace";
import { GARBLED_SHARE, LEFTOVER_REPEATS, MAX, MIN, NOISE_SHARE, NO_STRUCTURE_TOKENS } from "./constants";
import type { Piece } from "./cut";
import type { CheckName } from "./types";

const LETTER = /\p{L}/u;
const NOISE_PATH = /^(contents|table of contents|index|bibliography|references|works cited|sources|índice|indice|bibliografía|bibliografia|sommaire|inhalt|inhaltsverzeichnis|literatur)$/i;
const TOC_LINE = /(\.{3,}|…{2,}|\s{3,})\s*\d+\s*$|,\s*\d+(\s*[-–]\s*\d+)?(,\s*\d+)*\s*$/;
const ENDS_SENTENCE = /[.!?:;)"'»”’\]]\s*$/;

function garbled(md: string): boolean {
  if (md.includes("�")) return true;
  const chars = [...md.replace(/\s/g, "")];
  if (chars.length < 20) return false;
  const nonLetters = chars.filter((c) => !LETTER.test(c) && !/\d/.test(c)).length;
  return nonLetters / chars.length > GARBLED_SHARE;
}

function readingOrder(md: string): boolean {
  const paras = md.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p && !p.startsWith("#") && !p.startsWith("|") && !p.startsWith("```"));
  let breaks = 0;
  for (let i = 0; i + 1 < paras.length; i++) if (!ENDS_SENTENCE.test(paras[i]) && /^\p{Ll}/u.test(paras[i + 1])) breaks++;
  return breaks >= 2;
}

function badTable(md: string): boolean {
  const rows = md.split("\n").filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l));
  if (rows.length < 2) return false;
  const counts = new Set(rows.map((r) => r.trim().replace(/^\||\|$/g, "").split("|").length));
  return counts.size > 1;
}

function noise(p: Piece): boolean {
  if (NOISE_PATH.test(p.path.split(" › ").at(-1) ?? "")) return true;
  const lines = p.md.split("\n").filter((l) => l.trim());
  if (lines.length >= 5 && lines.filter((l) => TOC_LINE.test(l)).length / lines.length > NOISE_SHARE) return true;
  const chars = [...p.md.replace(/\s/g, "")];
  return chars.length > 40 && chars.filter((c) => /[\d.]/.test(c)).length / chars.length > 0.5;
}

/**
 * The program's checks on every fragment of one source (§6.1). `flags[i]` lists what piece `i` failed; `sourceIssues`
 * are the source-wide findings as English lines (they go to `sources.json` → `issues` and the review's input).
 */
export function checkPieces(pieces: Piece[]): { flags: CheckName[][]; sourceIssues: string[] } {
  const flags: CheckName[][] = pieces.map(() => []);
  const sourceIssues: string[] = [];
  const total = pieces.reduce((n, p) => n + estimateTokens(p.md), 0);
  // Source-wide: one or two fragments out of a long file; a long file with no headings.
  if (pieces.length > 0 && pieces.length <= 2 && total > MAX) sourceIssues.push(`The whole file became only ${pieces.length} fragment${pieces.length === 1 ? "" : "s"}.`);
  const noHeadings = total > NO_STRUCTURE_TOKENS && pieces.every((p) => p.path === "");
  if (noHeadings) sourceIssues.push("The file has no headings.");
  // Lines that repeat across fragments: headers and footers the removal missed.
  const seen = new Map<string, Set<number>>();
  pieces.forEach((p, i) => {
    // Only short lines: a running header or footer is one, prose never repeats whole lines.
    const short = p.md.split("\n").map((l) => l.trim()).filter((l) => l.length >= 8 && l.length <= 120 && !l.startsWith("|") && !l.startsWith("#"));
    for (const line of new Set(short)) {
      const at = seen.get(line) ?? new Set<number>();
      at.add(i);
      seen.set(line, at);
    }
  });
  const repeated = new Set<number>();
  for (const at of seen.values()) if (at.size >= LEFTOVER_REPEATS) for (const i of at) repeated.add(i);
  pieces.forEach((p, i) => {
    const f = flags[i];
    const tokens = estimateTokens(p.md);
    if (garbled(p.md)) f.push("garbled");
    if (readingOrder(p.md)) f.push("reading-order");
    if (!p.whole && (tokens < MIN / 3 || tokens > MAX * 2)) f.push("size");
    if (sourceIssues.length > 0 && pieces.length <= 2 && !f.includes("size")) f.push("size");
    if (noHeadings) f.push("no-structure");
    if (badTable(p.md)) f.push("table");
    if (noise(p)) f.push("noise");
    if (repeated.has(i)) f.push("leftover");
  });
  return { flags, sourceIssues };
}
```

Add `export * from "./checks";` to `packages/material/src/index.ts`.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/material/test/checks.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/material
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(material): the program's checks on every fragment"
```

---

### Task 6: Paths in `layout.ts`; the history keeps the person's material decisions

**Files:**
- Modify: `packages/workspace/src/layout.ts`, `packages/workspace/src/history.ts`
- Test: `packages/workspace/test/layout.test.ts`, `packages/workspace/test/history.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/workspace/test/layout.test.ts` (keep its existing imports; add the new names to the `../src` import):

```ts
import { APP_SCOPE, MATERIAL_KEEP, materialDir, materialReadsFile, materialStoreDir } from "../src";

describe("material paths (material spec §4)", () => {
  it("the originals are visible, the rest is hidden, both per scope", () => {
    expect(materialDir("/w", "fractions")).toBe(path.join("/w", "material", "fractions"));
    expect(materialStoreDir("/w", "main")).toBe(path.join("/w", ".harness", "material", "main"));
    expect(materialReadsFile("/w")).toBe(path.join("/w", ".harness", "material-reads.jsonl"));
  });

  it("app-wide work has no material, and a bad scope names no folder", () => {
    expect(() => materialDir("/w", APP_SCOPE)).toThrow();
    expect(() => materialStoreDir("/w", "../x")).toThrow();
  });

  it("MATERIAL_KEEP: the registry, the conflicts and the grounding mode, nothing else", () => {
    const keeps = (p: string) => MATERIAL_KEEP.match.test(p);
    expect(keeps(".harness/material/main/sources.json")).toBe(true);
    expect(keeps(".harness/material/fractions/conflicts.md")).toBe(true);
    expect(keeps(".harness/material/fractions/grounding.json")).toBe(true);
    expect(keeps(".harness/material/main/index.md")).toBe(false);
    expect(keeps(".harness/material/main/fragments/a-001.md")).toBe(false);
    expect(keeps(".harness/material/main/sources.json.1234.tmp")).toBe(false);
  });
});
```

Add to `packages/workspace/test/history.test.ts` (add `MATERIAL_KEEP` to the `../src` import):

```ts
describe("History keep patterns (material spec §4)", () => {
  it("tracks files a keep pattern names inside an ignored folder, and skips the rest of it", async () => {
    const kept = new History(folder, `${gitdir}-keep`, [".harness/", "AGENTS.md"], [NOTES_PREFIX, DATA_PREFIX, MATERIAL_KEEP]);
    await kept.init();
    write(".harness/material/main/sources.json", "{}");
    write(".harness/material/main/conflicts.md", "# Conflicts");
    write(".harness/material/main/index.md", "| id |");
    write(".harness/material/main/fragments/a-001.md", "x");
    write("material/main/ch2.pdf", "%PDF-1.7");
    const sha = await kept.save("first");
    const files = await git.listFiles({ fs, gitdir: `${gitdir}-keep`, ref: sha! });
    expect(files.sort()).toEqual([".harness/material/main/conflicts.md", ".harness/material/main/sources.json", "material/main/ch2.pdf"]);
  });

  it("D0: without the pattern nothing under .harness/material is tracked", async () => {
    write(".harness/material/main/sources.json", "{}");
    write("a.md", "1");
    const sha = await history.save("first");
    expect(await git.listFiles({ fs, gitdir, ref: sha! })).toEqual(["a.md"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm vitest run packages/workspace/test/layout.test.ts packages/workspace/test/history.test.ts`
Expected: FAIL (`MATERIAL_KEEP` is not exported; `History` takes only strings in `keep`).

- [ ] **Step 3: Add the paths**

In `packages/workspace/src/layout.ts`, after the data paths:

```ts
/** The person's originals, visible and theirs (material spec §4): `material/<scope>/`. */
export const MATERIAL_DIR = "material";

/** A material scope: a scope id, never `_app` (app-wide work has no material). Throws otherwise: it names a folder. */
function materialScope(scope: string): string {
  if (!isScopeId(scope)) throw new Error(`Invalid material scope: "${scope}"`);
  return scope;
}

export const materialDir = (base: string, scope: string): string => path.join(base, MATERIAL_DIR, materialScope(scope));
/** Everything the program builds from the originals, plus the person's decisions (§4). */
export const materialStoreDir = (base: string, scope: string): string => path.join(base, ".harness", "material", materialScope(scope));
/** Which fragments each task opened (§11). Never tracked. */
export const materialReadsFile = (base: string): string => path.join(base, ".harness", "material-reads.jsonl");

/**
 * The hidden material files the history tracks (§4 "History"): the registry, the conflicts and the grounding mode hold
 * the person's decisions; fragments, the index and the sheet are rebuilt from the originals.
 */
export const MATERIAL_KEEP = {
  prefix: ".harness/material/",
  match: /^\.harness\/material\/[a-z0-9][a-z0-9-]{0,63}\/(sources\.json|conflicts\.md|grounding\.json)$/,
  depth: 1,
} as const;
```

- [ ] **Step 4: Let `keep` take a pattern**

In `packages/workspace/src/history.ts`:

1. Above the class:

```ts
/**
 * A path the history tracks inside an ignored folder: a prefix (the notes, the data), or the files `match` names at
 * most `depth` folders below `prefix` (material spec §4: `MATERIAL_KEEP`).
 */
export type HistoryKeep = string | { prefix: string; match: RegExp; depth: number };

const keeps = (k: HistoryKeep, file: string): boolean => (typeof k === "string" ? file.startsWith(k) : k.match.test(file));
```

2. The constructor's `keep` becomes `private readonly keep: HistoryKeep[] = []`.

3. `tracked`:

```ts
  private tracked = (file: string): boolean =>
    !file.endsWith(".DS_Store") &&
    !isAppTempFile(file) &&
    (this.keep.some((k) => keeps(k, file)) || !this.ignore.some((i) => (i.endsWith("/") ? file.startsWith(i) : file === i)));
```

4. `skipsFolder`:

```ts
  /** A folder the history never tracks anything in: ignored, and no `keep` entry can name a file inside it. */
  private skipsFolder(dir: string): boolean {
    const prefix = `${dir}/`;
    const keepsInside = (k: HistoryKeep): boolean => {
      if (typeof k === "string") return k.startsWith(prefix) || prefix.startsWith(k);
      if (k.prefix.startsWith(prefix)) return true;
      if (!prefix.startsWith(k.prefix)) return false;
      // Folders deeper than `depth` below the prefix hold nothing the pattern names (the fragments folder).
      return prefix.slice(k.prefix.length).split("/").filter(Boolean).length <= k.depth;
    };
    return this.ignore.some((i) => i.endsWith("/") && prefix.startsWith(i)) && !this.keep.some(keepsInside);
  }
```

Search `history.ts` for any other use of `this.keep` and make it use `keeps(k, file)` the same way; `rg -n "keep" packages/workspace/src/history.ts` must show no `startsWith` on a keep entry left.

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/workspace/test/layout.test.ts packages/workspace/test/history.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS (every existing `History` caller passes strings: D0).

- [ ] **Step 6: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/workspace
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(workspace): material paths, and history keep patterns"
```

---

### Task 7: Fragments on disk: the store

**Files:**
- Create: `packages/material/src/fragment.ts`, `packages/material/src/store.ts`
- Modify: `packages/material/src/index.ts`
- Test: `packages/material/test/store.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/material/test/store.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { type Fragment, MaterialStore, type SourceEntry, parseFragment, renderFragment, sourceSlug } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-material-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let base: string;
let store: MaterialStore;
beforeEach(() => {
  base = fs.mkdtempSync(path.join(root, "b-"));
  store = new MaterialStore(base, "fractions");
});

const frag = (id: string, extra: Partial<Fragment["meta"]> = {}): Fragment => ({
  meta: {
    id,
    source: "ch2.pdf",
    location: "p.4–5",
    path: "Fractions › Equivalent",
    summary: "Gets 6/15 from 2/5.",
    keywords: ["equivalent", "numerator"],
    tokens: 240,
    items: [],
    checks: "ok",
    validated: "not-reviewed",
    ...extra,
  },
  md: "## Example 2\n\nMultiply both by 3.",
});
const entry = (id: string, extra: Partial<SourceEntry> = {}): SourceEntry => ({
  id,
  scope: "fractions",
  path: `${id}.pdf`,
  hash: "h",
  type: "pdf",
  family: "pdf",
  pages: 2,
  sizeBytes: 10,
  skippedPages: [],
  status: "ready",
  issues: [],
  fixes: [],
  estimate: 0,
  used: 0,
  fragments: [],
  addedAt: "2026-10-27T10:00:00.000Z",
  ...extra,
});

describe("fragment files (material spec §4.1)", () => {
  it("round-trips the front matter", () => {
    const f = frag("ch2-007", { kind: "example", checks: ["size", "noise"], items: ["equivalent-fractions"] });
    const text = renderFragment(f);
    expect(text.startsWith("---\nid: ch2-007\nsource: \"ch2.pdf\"\n")).toBe(true);
    expect(parseFragment(text)).toEqual(f);
  });

  it("a hand-broken file reads as null", () => {
    expect(parseFragment("no front matter")).toBeNull();
  });
});

describe("MaterialStore", () => {
  it("registry: empty at first, atomic updates, a broken file set aside", async () => {
    expect(await store.sources()).toEqual([]);
    await store.update((list) => [...list, entry("ch2")]);
    expect((await store.sources()).map((s) => s.id)).toEqual(["ch2"]);
    const file = path.join(base, ".harness", "material", "fractions", "sources.json");
    fs.writeFileSync(file, "{broken");
    expect(await store.sources()).toEqual([]);
    expect(fs.readdirSync(path.dirname(file)).some((f) => f.startsWith("sources.json.corrupt-"))).toBe(true);
  });

  it("writes a source's fragments, drops the ones it no longer has, and keeps a program version once", async () => {
    await store.update(() => [entry("ch2")]);
    await store.writeFragments("ch2", [frag("ch2-001"), frag("ch2-002")]);
    expect((await store.sources())[0].fragments).toEqual(["ch2-001", "ch2-002"]);
    expect((await store.readFragment("ch2-002"))?.meta.id).toBe("ch2-002");
    await store.keepOriginal("ch2-001");
    await store.writeFragments("ch2", [frag("ch2-001", { validated: "repaired" })]);
    expect(await store.readFragment("ch2-002")).toBeNull();
    expect(fs.existsSync(path.join(base, ".harness", "material", "fractions", "fragments", ".orig", "ch2-001.md"))).toBe(true);
    expect((await store.readOriginalVersion("ch2-001"))?.meta.validated).toBe("not-reviewed");
  });

  it("refuses ids that aren't fragment ids", async () => {
    expect(await store.readFragment("../../x")).toBeNull();
  });

  it("the index lists the fragments of usable sources, without pending ones", async () => {
    await store.update(() => [entry("ch2", { status: "ready" }), entry("old", { status: "removed" })]);
    await store.writeFragments("ch2", [frag("ch2-001", { kind: "example" }), frag("ch2-002", { validated: "pending" })]);
    await store.writeIndex();
    const index = fs.readFileSync(path.join(base, ".harness", "material", "fractions", "index.md"), "utf8");
    expect(index).toContain("| id | where | path | kind | summary | items |");
    expect(index).toContain("| ch2-001 | ch2.pdf, p.4–5 | Fractions › Equivalent | example | Gets 6/15 from 2/5. |  |");
    expect(index).not.toContain("ch2-002");
    expect((await store.indexRows()).map((r) => r.id)).toEqual(["ch2-001"]);
  });

  it("originals: kept under material/<scope>, a name in use gets a number", async () => {
    expect(await store.addOriginal("Ch 2.pdf", Buffer.from("a"))).toBe("Ch 2.pdf");
    expect(await store.addOriginal("Ch 2.pdf", Buffer.from("b"))).toBe("Ch 2 (2).pdf");
    expect(fs.readFileSync(path.join(base, "material", "fractions", "Ch 2 (2).pdf"), "utf8")).toBe("b");
  });

  it("the sheet, the conflicts and the grounding mode", async () => {
    expect(await store.sheet()).toBe("");
    await store.writeSheet("## Terms\n\n- fraction: a part");
    expect(await store.sheet()).toContain("fraction");
    await store.appendConflict({ fragment: "ch2-001", claim: "x", resolution: "followed the material" });
    expect(fs.readFileSync(path.join(base, ".harness", "material", "fractions", "conflicts.md"), "utf8")).toContain("ch2-001");
    expect(await store.grounding()).toBeNull();
    await store.setGrounding("strict");
    expect(await store.grounding()).toBe("strict");
  });

  it("source ids are slugs of the name, numbered when taken", () => {
    expect(sourceSlug("Fracciones – Cap 2.pdf", new Set())).toBe("fracciones-cap-2");
    expect(sourceSlug("Fracciones – Cap 2.pdf", new Set(["fracciones-cap-2"]))).toBe("fracciones-cap-2-2");
    expect(sourceSlug("???.pdf", new Set())).toBe("source");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run packages/material/test/store.test.ts`
Expected: FAIL (`MaterialStore` is not exported).

- [ ] **Step 3: Write the fragment format**

Create `packages/material/src/fragment.ts`:

```ts
import type { CheckName, Fragment, FragmentMeta, Validation } from "./types";

/** A source id: a slug of its name. A fragment id: `<source id>-<nnn>`. */
export const SOURCE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const FRAGMENT_ID = /^[a-z0-9][a-z0-9-]{0,63}-\d{3,4}$/;
export const isFragmentId = (v: unknown): v is string => typeof v === "string" && FRAGMENT_ID.test(v);
export const isSourceId = (v: unknown): v is string => typeof v === "string" && SOURCE_ID.test(v);

/** `fractions-ch2-007`. */
export const fragmentId = (source: string, n: number): string => `${source}-${String(n).padStart(3, "0")}`;

const VALIDATIONS: readonly Validation[] = ["sample", "flagged-reviewed", "repaired", "not-reviewed", "pending"];
const CHECKS: readonly CheckName[] = ["garbled", "reading-order", "size", "no-structure", "table", "noise", "leftover"];
const ORDER: (keyof FragmentMeta)[] = ["id", "source", "location", "path", "kind", "summary", "keywords", "tokens", "items", "checks", "validated"];

/** A value as one YAML line: plain for ids, numbers and the enums; JSON (valid YAML) for any other text and lists. */
function yamlValue(key: keyof FragmentMeta, v: unknown): string {
  if (key === "id" || key === "kind" || key === "validated" || typeof v === "number") return String(v);
  if (key === "checks" && v === "ok") return "ok";
  return JSON.stringify(v);
}

/** The fragment file (§4.1): front matter, a blank line, the Markdown. */
export function renderFragment(f: Fragment): string {
  const lines = ORDER.filter((k) => f.meta[k] !== undefined).map((k) => `${k}: ${yamlValue(k, f.meta[k])}`);
  return `---\n${lines.join("\n")}\n---\n\n${f.md.trim()}\n`;
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** A fragment file read back; null when it has no front matter or no valid id (a hand edit broke it). */
export function parseFragment(text: string): Fragment | null {
  const m = /^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  if (!m) return null;
  const raw: Record<string, unknown> = {};
  for (const line of m[1].split("\n")) {
    const at = line.indexOf(": ");
    if (at < 0) continue;
    const value = line.slice(at + 2);
    try {
      raw[line.slice(0, at)] = JSON.parse(value);
    } catch {
      raw[line.slice(0, at)] = value;
    }
  }
  const id = String(raw.id ?? "");
  if (!isFragmentId(id)) return null;
  const checks = raw.checks === "ok" ? "ok" : strs(raw.checks).filter((c): c is CheckName => (CHECKS as string[]).includes(c));
  const validated = VALIDATIONS.find((v) => v === raw.validated) ?? "not-reviewed";
  const meta: FragmentMeta = {
    id,
    source: str(raw.source),
    location: str(raw.location),
    path: str(raw.path),
    ...(typeof raw.kind === "string" && raw.kind ? { kind: raw.kind } : {}),
    summary: str(raw.summary),
    keywords: strs(raw.keywords),
    tokens: typeof raw.tokens === "number" ? raw.tokens : 0,
    items: strs(raw.items),
    checks: Array.isArray(checks) && checks.length === 0 ? "ok" : checks,
    validated,
  };
  return { meta, md: m[2].trim() };
}
```

- [ ] **Step 4: Write the store**

Create `packages/material/src/store.ts`:

```ts
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { GroundingMode } from "@humanharness/harness-sdk";
import { materialDir, materialStoreDir } from "@humanharness/workspace";
import { isFragmentId, parseFragment, renderFragment } from "./fragment";
import type { Fragment, FragmentMeta, SourceEntry } from "./types";

/** One row of the index (§4.3). */
export interface IndexRow {
  id: string;
  where: string;
  path: string;
  kind: string;
  summary: string;
  items: string[];
}

/** Sources whose fragments a task may load (§9): ready, or still being checked (their fragments are usable meanwhile). */
const USABLE = new Set(["ready", "validating"]);

async function writeAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, text);
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();

/** A slug of a file name or a link (`fractions-ch-2`), numbered when `taken` holds it; "source" when nothing is left. */
export function sourceSlug(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .replace(/\.[A-Za-z0-9]{1,5}$/, "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/, "") || "source";
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

/**
 * One scope's material in one base (spec §4): the originals under `material/<scope>/`, the rest under
 * `.harness/material/<scope>/`. Registry writes are atomic and one at a time. Nothing is cached: a hand edit shows at once.
 */
export class MaterialStore {
  readonly dir: string;
  readonly originals: string;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    readonly base: string,
    readonly scope: string,
  ) {
    this.dir = materialStoreDir(base, scope);
    this.originals = materialDir(base, scope);
  }

  private get registry() {
    return path.join(this.dir, "sources.json");
  }
  private fragmentFile(id: string) {
    return path.join(this.dir, "fragments", `${id}.md`);
  }
  private origFile(id: string) {
    return path.join(this.dir, "fragments", ".orig", `${id}.md`);
  }

  /** In the order they were added. A missing file is empty; one that isn't JSON is set aside as `sources.json.corrupt-<time>`. */
  async sources(): Promise<SourceEntry[]> {
    let text: string;
    try {
      text = await fs.readFile(this.registry, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      await fs.rename(this.registry, `${this.registry}.corrupt-${Date.now()}`).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") throw err;
      });
      return [];
    }
    const list = typeof raw === "object" && raw !== null && Array.isArray((raw as { sources?: unknown }).sources) ? (raw as { sources: unknown[] }).sources : [];
    // Entries the app wrote; one a hand edit broke (no id, no status) is skipped.
    return list.filter((s): s is SourceEntry => typeof s === "object" && s !== null && typeof (s as SourceEntry).id === "string" && typeof (s as SourceEntry).status === "string");
  }

  async source(id: string): Promise<SourceEntry | null> {
    return (await this.sources()).find((s) => s.id === id) ?? null;
  }

  /** Changes the registry, one change at a time; `fn` gets a copy. Returns the new list. */
  update(fn: (list: SourceEntry[]) => SourceEntry[]): Promise<SourceEntry[]> {
    const run = this.writes.then(async () => {
      const next = fn(structuredClone(await this.sources()));
      await writeAtomic(this.registry, `${JSON.stringify({ version: 1, sources: next }, null, 2)}\n`);
      return next;
    });
    this.writes = run.catch(() => undefined);
    return run;
  }

  /** Changes one entry (no-op when it is gone). */
  patch(id: string, fn: (s: SourceEntry) => SourceEntry): Promise<SourceEntry | null> {
    return this.update((list) => list.map((s) => (s.id === id ? fn(s) : s))).then((list) => list.find((s) => s.id === id) ?? null);
  }

  /** Writes a source's fragments and records their ids; files of fragments it no longer has go. */
  async writeFragments(sourceId: string, fragments: Fragment[]): Promise<void> {
    const before = (await this.source(sourceId))?.fragments ?? [];
    for (const f of fragments) await writeAtomic(this.fragmentFile(f.meta.id), renderFragment(f));
    const now = new Set(fragments.map((f) => f.meta.id));
    for (const id of before) if (!now.has(id) && isFragmentId(id)) await fs.rm(this.fragmentFile(id), { force: true });
    await this.patch(sourceId, (s) => ({ ...s, fragments: fragments.map((f) => f.meta.id) }));
  }

  /** One fragment; null for an id that isn't one, a missing file or a broken one. */
  async readFragment(id: string): Promise<Fragment | null> {
    if (!isFragmentId(id)) return null;
    const text = await fs.readFile(this.fragmentFile(id), "utf8").catch(() => null);
    return text === null ? null : parseFragment(text);
  }

  /** Writes one fragment in place (labels, a repair, a flag). */
  async writeFragment(f: Fragment): Promise<void> {
    if (!isFragmentId(f.meta.id)) throw new Error("Invalid fragment id");
    await writeAtomic(this.fragmentFile(f.meta.id), renderFragment(f));
  }

  /** Changes one fragment's front matter; null when it is gone. */
  async patchFragment(id: string, fn: (meta: FragmentMeta) => FragmentMeta): Promise<Fragment | null> {
    const f = await this.readFragment(id);
    if (!f) return null;
    const next = { ...f, meta: fn(f.meta) };
    await this.writeFragment(next);
    return next;
  }

  /** Keeps the program's version of a fragment before the AI changes it (§6.2), once. */
  async keepOriginal(id: string): Promise<void> {
    if (!isFragmentId(id)) return;
    const file = this.origFile(id);
    if (await fs.stat(file).then(() => true, () => false)) return;
    const text = await fs.readFile(this.fragmentFile(id), "utf8").catch(() => null);
    if (text !== null) await writeAtomic(file, text);
  }

  async readOriginalVersion(id: string): Promise<Fragment | null> {
    if (!isFragmentId(id)) return null;
    const text = await fs.readFile(this.origFile(id), "utf8").catch(() => null);
    return text === null ? null : parseFragment(text);
  }

  /** Every fragment of the sources a task may load, in source order (pending ones included; callers filter). */
  async fragments(): Promise<Fragment[]> {
    const out: Fragment[] = [];
    for (const s of await this.sources()) {
      if (!USABLE.has(s.status)) continue;
      for (const id of s.fragments) {
        const f = await this.readFragment(id);
        if (f) out.push(f);
      }
    }
    return out;
  }

  /** The index rows (§4.3): usable sources' fragments, leaving out those flagged during use (§6.2 "Flags during use"). */
  async indexRows(): Promise<IndexRow[]> {
    return (await this.fragments())
      .filter((f) => f.meta.validated !== "pending")
      .map((f) => ({ id: f.meta.id, where: `${f.meta.source}, ${f.meta.location}`, path: f.meta.path, kind: f.meta.kind ?? "", summary: f.meta.summary, items: f.meta.items }));
  }

  /** Rebuilds `index.md` (§4.3). */
  async writeIndex(): Promise<void> {
    const rows = await this.indexRows();
    const text = [
      "| id | where | path | kind | summary | items |",
      "|---|---|---|---|---|---|",
      ...rows.map((r) => `| ${r.id} | ${cell(r.where)} | ${cell(r.path)} | ${cell(r.kind)} | ${cell(r.summary)} | ${cell(r.items.join(", "))} |`),
    ].join("\n");
    await writeAtomic(path.join(this.dir, "index.md"), `${text}\n`);
  }

  /** Copies an original into `material/<scope>/`, never over another: `Ch 2.pdf`, `Ch 2 (2).pdf`… Returns its file name. */
  async addOriginal(name: string, data: Buffer): Promise<string> {
    await fs.mkdir(this.originals, { recursive: true });
    const clean = path.basename(name).replace(/[\0/\\]/g, "_").trim() || "file";
    const ext = path.extname(clean);
    const stem = clean.slice(0, clean.length - ext.length);
    for (let i = 1; ; i++) {
      const candidate = i === 1 ? clean : `${stem} (${i})${ext}`;
      try {
        await fs.writeFile(path.join(this.originals, candidate), data, { flag: "wx" });
        return candidate;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    }
  }

  /** An original's absolute path; null when the name would leave the scope's folder. */
  originalPath(name: string): string | null {
    const file = path.resolve(this.originals, name);
    return path.dirname(file) === path.resolve(this.originals) ? file : null;
  }

  async sheet(): Promise<string> {
    return fs.readFile(path.join(this.dir, "sheet.md"), "utf8").catch(() => "");
  }

  async writeSheet(md: string): Promise<void> {
    await writeAtomic(path.join(this.dir, "sheet.md"), `${md.trim()}\n`);
  }

  /** One line per disagreement between the material and the AI's knowledge (§9 "Ground"). */
  async appendConflict(c: { fragment: string; claim: string; resolution: string }, at = new Date()): Promise<void> {
    const file = path.join(this.dir, "conflicts.md");
    await fs.mkdir(this.dir, { recursive: true });
    const head = (await fs.stat(file).then(() => true, () => false)) ? "" : "# Material vs AI knowledge\n\n";
    await fs.appendFile(file, `${head}- ${at.toISOString().slice(0, 10)} [[frag:${c.fragment}]] ${cell(c.claim)} → ${cell(c.resolution)}\n`);
  }

  /** The scope's grounding mode when the person changed it; null: the harness's default. */
  async grounding(): Promise<GroundingMode | null> {
    const raw = await fs.readFile(path.join(this.dir, "grounding.json"), "utf8").catch(() => null);
    try {
      const mode = raw === null ? null : (JSON.parse(raw) as { mode?: unknown }).mode;
      return mode === "strict" || mode === "mixed" ? mode : null;
    } catch {
      return null;
    }
  }

  async setGrounding(mode: GroundingMode): Promise<void> {
    await writeAtomic(path.join(this.dir, "grounding.json"), `${JSON.stringify({ mode })}\n`);
  }
}
```

Add to `packages/material/src/index.ts`:

```ts
export * from "./fragment";
export * from "./store";
```

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/material/test/store.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/material
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(material): fragment files and the scope's store"
```

---

### Task 8: Web pages and HTML

One DOM walker reads every HTML the material brings: an `.html` file, a fetched page, Word's HTML from `mammoth` (Task 10) and an ebook's chapters (Task 11).

**Files:**
- Create: `packages/material/src/convert/html.ts`
- Modify: `packages/material/src/index.ts`, `packages/material/package.json` (dependencies)
- Test: `packages/material/test/html.test.ts` (new)

- [ ] **Step 1: Add the dependencies**

Run: `corepack pnpm --filter @humanharness/material add linkedom @mozilla/readability`
Then check the licences: `node -p "require('./packages/material/node_modules/linkedom/package.json').license"` prints `ISC`, and the same for `@mozilla/readability` prints `Apache-2.0`. Stop if not.

- [ ] **Step 2: Write the failing test**

Create `packages/material/test/html.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { htmlBlocks, readablePage } from "../src";

describe("htmlBlocks", () => {
  it("headings, paragraphs, lists, tables, code and images, with heading-path locations", () => {
    const html = `<h1>Fractions</h1><p>A <strong>fraction</strong> has two parts.</p>
      <ul><li>numerator</li><li>denominator<ul><li>below</li></ul></li></ul>
      <h2>Table</h2><table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>
      <pre>x = 1</pre><p><img src="d.png"></p><script>alert(1)</script><style>p{}</style>`;
    const blocks = htmlBlocks(html);
    expect(blocks.map((b) => [b.kind, b.md])).toEqual([
      ["heading", "# Fractions"],
      ["para", "A **fraction** has two parts."],
      ["list", "- numerator\n- denominator\n  - below"],
      ["heading", "## Table"],
      ["table", "| a | b |\n|---|---|\n| 1 | 2 |"],
      ["code", "```\nx = 1\n```"],
      ["image", "[image, § Fractions › Table ¶3]"],
    ]);
    expect(blocks.map((b) => b.loc)).toEqual(["§ Fractions", "§ Fractions ¶1", "§ Fractions ¶2", "§ Fractions › Table", "§ Fractions › Table ¶1", "§ Fractions › Table ¶2", "§ Fractions › Table ¶3"]);
  });

  it("a prefix for every location (an ebook's chapter)", () => {
    expect(htmlBlocks("<p>Hi.</p>", { prefix: "ch. 2" })[0].loc).toBe("ch. 2 ¶1");
  });

  it("drops forms, frames and objects, and never keeps raw HTML", () => {
    const blocks = htmlBlocks(`<form><input value="x"></form><iframe src="x"></iframe><p>Kept &lt;b&gt; as text.</p>`);
    expect(blocks.map((b) => b.md)).toEqual(["Kept <b> as text."]);
  });
});

describe("readablePage (a fetched link: §3 Web)", () => {
  it("keeps the main content and its title", () => {
    const long = Array.from({ length: 12 }, (_, i) => `<p>Paragraph ${i} explains equivalent fractions with care and with several clear words in it.</p>`).join("");
    const html = `<html><head><title>Equivalent fractions</title></head><body><nav><a href="/">Home</a><a href="/x">Menu item</a></nav><article><h1>Equivalent fractions</h1>${long}</article><footer>Copyright</footer></body></html>`;
    const { title, blocks } = readablePage(html);
    expect(title).toBe("Equivalent fractions");
    expect(blocks.some((b) => b.md.includes("Paragraph 3 explains"))).toBe(true);
    expect(blocks.some((b) => b.md.includes("Menu item"))).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `corepack pnpm vitest run packages/material/test/html.test.ts`
Expected: FAIL (`htmlBlocks` is not exported).

- [ ] **Step 4: Write the converter**

Create `packages/material/src/convert/html.ts`:

```ts
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { withEstimatedPages } from "../blocks";
import type { MdBlock } from "../types";

/** Never read: they hold code, chrome or inputs, not the material (Conventions: files are untrusted). */
const DROP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "SVG", "CANVAS", "TEMPLATE", "HEAD"]);
const HEADINGS: Record<string, number> = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };
const BLOCKS = new Set(["P", "BLOCKQUOTE", "DD", "DT", "FIGCAPTION", "CAPTION", "ADDRESS"]);

type El = { tagName: string; childNodes: ArrayLike<Node>; textContent: string | null; querySelectorAll(s: string): ArrayLike<El>; getAttribute(n: string): string | null };
type Node = { nodeType: number; nodeName: string; textContent: string | null } & Partial<El>;

const squash = (s: string) => s.replace(/\s+/g, " ");

/** Inline Markdown of an element: bold, italics, code, line breaks; links keep their text; images are placeholders. */
function inline(node: Node, image: () => string): string {
  if (node.nodeType === 3) return squash(node.textContent ?? "");
  if (node.nodeType !== 1) return "";
  const tag = node.nodeName.toUpperCase();
  if (DROP.has(tag)) return "";
  if (tag === "BR") return "\n";
  if (tag === "IMG") return image();
  const inner = Array.from(node.childNodes ?? []).map((c) => inline(c, image)).join("");
  if (!inner.trim()) return inner;
  if (tag === "STRONG" || tag === "B") return `**${inner.trim()}**`;
  if (tag === "EM" || tag === "I") return `*${inner.trim()}*`;
  if (tag === "CODE") return `\`${inner.trim()}\``;
  return inner;
}

function listMd(el: El, depth: number, image: () => string): string {
  const ordered = el.tagName.toUpperCase() === "OL";
  let n = 0;
  const lines: string[] = [];
  for (const li of Array.from(el.childNodes) as Node[]) {
    if (li.nodeName.toUpperCase() !== "LI") continue;
    n++;
    const own = Array.from(li.childNodes ?? []).filter((c) => !["UL", "OL"].includes(c.nodeName.toUpperCase()));
    const text = squash(own.map((c) => inline(c, image)).join("")).trim();
    lines.push(`${"  ".repeat(depth)}${ordered ? `${n}.` : "-"} ${text}`);
    for (const sub of Array.from(li.childNodes ?? []) as Node[]) {
      if (["UL", "OL"].includes(sub.nodeName.toUpperCase())) lines.push(listMd(sub as unknown as El, depth + 1, image));
    }
  }
  return lines.join("\n");
}

function tableMd(el: El, image: () => string): string {
  const rows = Array.from(el.querySelectorAll("tr")).map((tr) =>
    Array.from(tr.childNodes as ArrayLike<Node>)
      .filter((c) => ["TD", "TH"].includes(c.nodeName.toUpperCase()))
      .map((c) => squash(inline(c, image)).trim().replace(/\|/g, "\\|")),
  );
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${[...r, ...Array(width - r.length).fill("")].join(" | ")} |`;
  return [line(rows[0]), `|${Array(width).fill("---").join("|")}|`, ...rows.slice(1).map(line)].join("\n");
}

/**
 * HTML into blocks. Locations are the heading path and the block's number under its heading (§3 Word: "heading path +
 * paragraph number"): `§ Fractions › Table ¶2`, after `prefix` when one is given (`ch. 2`). Pages are estimated.
 */
export function htmlBlocks(html: string, opts: { prefix?: string } = {}): MdBlock[] {
  const doc = parseHTML(/<body[\s>]/i.test(html) ? html : `<!doctype html><html><body>${html}</body></html>`).document;
  const out: MdBlock[] = [];
  const path: string[] = [];
  let n = 0;
  const where = () => [opts.prefix, path.length ? `§ ${path.join(" › ")}` : ""].filter(Boolean).join(" › ");
  const loc = () => `${where()}${where() ? " " : ""}¶${n}`.trim();
  const add = (kind: MdBlock["kind"], md: string, level?: number) => {
    if (!md.trim()) return;
    if (kind === "heading") out.push({ kind, level, md, loc: where() || "start", page: 1 });
    else {
      n++;
      out.push({ kind, md, loc: loc(), page: 1 });
    }
  };
  // An image is a block of its own, numbered like one.
  const image = () => {
    n++;
    const mark = `[image, ${loc()}]`;
    out.push({ kind: "image", md: mark, loc: loc(), page: 1 });
    return "";
  };
  let loose = "";
  const flush = () => {
    if (loose.trim()) add("para", squash(loose).trim());
    loose = "";
  };
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      loose += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.nodeName.toUpperCase();
    if (DROP.has(tag)) return;
    if (Object.hasOwn(HEADINGS, tag)) {
      flush();
      const level = HEADINGS[tag];
      const text = squash(inline(node, () => "")).trim();
      if (!text) return;
      path.length = level - 1;
      path[level - 1] = text;
      for (let i = 0; i < path.length; i++) path[i] ??= "";
      const clean = path.filter(Boolean);
      path.length = 0;
      path.push(...clean);
      n = 0;
      add("heading", `${"#".repeat(level)} ${text}`, level);
      return;
    }
    if (tag === "UL" || tag === "OL") return void (flush(), add("list", listMd(node as unknown as El, 0, image)));
    if (tag === "TABLE") return void (flush(), add("table", tableMd(node as unknown as El, image)));
    if (tag === "PRE") return void (flush(), add("code", `\`\`\`\n${(node.textContent ?? "").replace(/\n+$/, "")}\n\`\`\``));
    if (tag === "IMG") return void (flush(), image());
    if (BLOCKS.has(tag)) {
      flush();
      const text = inline(node, image).split("\n").map((l) => l.trim()).join("\n").trim();
      add("para", tag === "BLOCKQUOTE" ? text.split("\n").map((l) => `> ${l}`).join("\n") : text);
      return;
    }
    // Containers (div, section, article, li outside a list…) and inline runs.
    const isInline = ["SPAN", "A", "STRONG", "B", "EM", "I", "CODE", "SUB", "SUP", "SMALL", "U", "MARK", "BR"].includes(tag);
    if (isInline) {
      loose += inline(node, image);
      return;
    }
    flush();
    for (const c of Array.from(node.childNodes ?? [])) walk(c);
    flush();
  };
  for (const c of Array.from(doc.body?.childNodes ?? []) as Node[]) walk(c);
  flush();
  return withEstimatedPages(out);
}

/**
 * A fetched page: `@mozilla/readability` keeps the main content (§3 Web), then the walker reads it. A page it can't
 * read (too little content) is read whole.
 */
export function readablePage(html: string): { title: string; blocks: MdBlock[] } {
  const { document } = parseHTML(html);
  const title = squash(document.querySelector("title")?.textContent ?? "").trim();
  let content: string | null = null;
  try {
    content = new Readability(document as unknown as Document).parse()?.content ?? null;
  } catch {
    content = null;
  }
  const blocks = htmlBlocks(content && content.length > 200 ? content : html);
  // The title as the first heading when the content has none.
  if (title && !blocks.some((b) => b.kind === "heading")) blocks.unshift({ kind: "heading", level: 1, md: `# ${title}`, loc: "start", page: 1 });
  return { title, blocks };
}
```

Add `export * from "./convert/html";` to `packages/material/src/index.ts`.

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/material/test/html.test.ts`
Expected: PASS. If linkedom reports `nodeName` in lowercase for some nodes, the walker already upper-cases it; if a test still fails on the heading path, print `blocks` and fix the walker, not the test.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/material pnpm-lock.yaml
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(material): web pages and HTML into blocks"
```

---

### Task 9: PDF

`pdfjs-dist` reads the text items with their size and position (§3 PDF). The program finds headings by relative font size (or by weight on a reconversion), reads two columns left then right, removes running headers, footers and page numbers, joins words split by an end-of-line hyphen, and records pages with no text layer.

**Files:**
- Create: `packages/material/src/convert/pdf.ts`, `packages/material/test/make-pdf.ts` (a test helper that writes small real PDFs)
- Modify: `packages/material/src/index.ts`, `packages/material/package.json`
- Test: `packages/material/test/pdf.test.ts` (new)

- [ ] **Step 1: Add the dependency**

Run: `corepack pnpm --filter @humanharness/material add pdfjs-dist`
Check: `node -p "require('./packages/material/node_modules/pdfjs-dist/package.json').license"` prints `Apache-2.0`.

- [ ] **Step 2: Write the test helper**

Create `packages/material/test/make-pdf.ts`:

```ts
/** One run of text on a page, in PDF points from the bottom-left corner. */
export interface PdfText {
  x: number;
  y: number;
  size: number;
  text: string;
  bold?: boolean;
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/**
 * A small, valid PDF with real text items (Helvetica and Helvetica-Bold, WinAnsi): enough for pdfjs to read sizes and
 * positions. A page with no items has no text layer (a scanned page).
 */
export function makePdf(pages: PdfText[][]): Buffer {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 1;
  const catalog = add("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = add("PAGES");
  const regular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const bold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  for (const items of pages) {
    const stream = items.map((t) => `BT /${t.bold ? "F2" : "F1"} ${t.size} Tf ${t.x} ${t.y} Td (${esc(t.text)}) Tj ET`).join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** A page of body text: `lines` lines of 11 pt from y = 700 down, at x. */
export const body = (lines: string[], x = 72, top = 700): PdfText[] => lines.map((text, i) => ({ x, y: top - i * 14, size: 11, text }));
```

- [ ] **Step 3: Write the failing test**

Create `packages/material/test/pdf.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { measurePdf, pdfBlocks } from "../src";
import { body, makePdf } from "./make-pdf";

const footer = (n: number) => [
  { x: 72, y: 760, size: 9, text: "Mathematics 6 - Chapter 2" },
  { x: 300, y: 40, size: 9, text: String(n) },
];

describe("pdfBlocks (material spec §3 PDF)", () => {
  it("headings from relative font size, paragraphs from line gaps, page marks", async () => {
    const pdf = makePdf([
      [{ x: 72, y: 720, size: 20, text: "Fractions" }, ...body(["A fraction has two parts: the numerator", "and the denominator."], 72, 690), { x: 72, y: 620, size: 15, text: "Equivalent fractions" }, ...body(["Two fractions are equivalent when they name the same amount."], 72, 595)],
      body(["The second page goes on with more text."]),
    ]);
    const r = await pdfBlocks(pdf);
    expect(r.pages).toBe(2);
    expect(r.blocks.map((b) => [b.kind, b.level ?? null, b.md, b.loc])).toEqual([
      ["heading", 1, "# Fractions", "p.1"],
      ["para", null, "A fraction has two parts: the numerator and the denominator.", "p.1"],
      ["heading", 2, "## Equivalent fractions", "p.1"],
      ["para", null, "Two fractions are equivalent when they name the same amount.", "p.1"],
      ["para", null, "The second page goes on with more text.", "p.2"],
    ]);
  });

  it("removes running headers, footers and page numbers, and joins hyphenated words", async () => {
    const pages = [1, 2, 3].map((n) => [...footer(n), ...body([`Page ${n} talks about frac-`, "tions and nothing else."])]);
    const r = await pdfBlocks(makePdf(pages));
    const text = r.blocks.map((b) => b.md).join("\n");
    expect(text).not.toContain("Mathematics 6");
    expect(text).not.toMatch(/^\d+$/m);
    expect(text).toContain("Page 2 talks about fractions and nothing else.");
  });

  it("reads two columns left, then right", async () => {
    const left = body(["Left column first line", "left column second line."], 72, 700);
    const right = body(["Right column first line", "right column second line."], 330, 700);
    const r = await pdfBlocks(makePdf([[...left, ...right]]));
    const text = r.blocks.map((b) => b.md).join("\n");
    expect(text.indexOf("Left column first")).toBeLessThan(text.indexOf("Right column first"));
    expect(text.indexOf("left column second")).toBeLessThan(text.indexOf("Right column first"));
  });

  it("records pages with no text layer; a page range keeps only those pages", async () => {
    const pdf = makePdf([body(["One."]), [], body(["Three."])]);
    const all = await pdfBlocks(pdf);
    expect(all.skippedPages).toEqual([2]);
    const ranged = await pdfBlocks(pdf, { pageRange: [3, 3] });
    expect(ranged.blocks.map((b) => b.md)).toEqual(["Three."]);
  });

  it("measure: pages and pages with text, without reading the text", async () => {
    expect(await measurePdf(makePdf([body(["One."]), []]))).toEqual({ pages: 2, textPages: 1 });
    await expect(measurePdf(Buffer.from("%PDF-1.4 broken"))).rejects.toMatchObject({ reason: "unreadable" });
  });

  it("headings by weight on a reconversion", async () => {
    const pdf = makePdf([[{ x: 72, y: 720, size: 11, text: "Bold heading", bold: true }, ...body(["Plain text follows it here."], 72, 700)]]);
    expect((await pdfBlocks(pdf)).blocks[0].kind).toBe("para");
    expect((await pdfBlocks(pdf, { settings: { headingsByWeight: true } })).blocks[0]).toMatchObject({ kind: "heading", md: "## Bold heading" });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `corepack pnpm vitest run packages/material/test/pdf.test.ts`
Expected: FAIL (`pdfBlocks` is not exported).

- [ ] **Step 5: Write the converter**

Create `packages/material/src/convert/pdf.ts`:

```ts
import { RUNNING_SHARE } from "../constants";
import type { ConvertSettings, MdBlock } from "../types";

/** A refusal a converter throws; the pipeline turns it into the source's `refused` status. */
export class MaterialRefused extends Error {
  constructor(readonly reason: "unreadable" | "protected" | "scanned") {
    super(reason);
    this.name = "MaterialRefused";
  }
}

interface Item {
  str: string;
  x: number;
  y: number;
  size: number;
  width: number;
  bold: boolean;
}
interface Line {
  text: string;
  x: number;
  y: number;
  size: number;
  bold: boolean;
  page: number;
}

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let lib: Promise<PdfJs> | null = null;
/** pdfjs in Node: the worker module is imported first so pdfjs runs it in this thread (no worker file to ship). */
function pdfjs(): Promise<PdfJs> {
  lib ??= (async () => {
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    return import("pdfjs-dist/legacy/build/pdf.mjs");
  })();
  return lib;
}

async function open(data: Buffer) {
  const { getDocument } = await pdfjs();
  try {
    return await getDocument({ data: new Uint8Array(data), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  } catch (err) {
    throw new MaterialRefused((err as { name?: string }).name === "PasswordException" ? "protected" : "unreadable");
  }
}

async function pageItems(doc: Awaited<ReturnType<typeof open>>, n: number): Promise<Item[]> {
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  const styles = content.styles as Record<string, { fontFamily?: string }>;
  const out: Item[] = [];
  for (const raw of content.items as { str?: string; transform?: number[]; width?: number; fontName?: string }[]) {
    if (typeof raw.str !== "string" || !raw.transform || !raw.str.trim()) continue;
    const [a, b, , , e, f] = raw.transform;
    const font = `${raw.fontName ?? ""} ${styles[raw.fontName ?? ""]?.fontFamily ?? ""}`;
    // The font's own name says bold for most PDFs; pdfjs keeps it in `commonObjs`, read below when it is loaded.
    let bold = /bold|black|heavy|semibold/i.test(font);
    try {
      const obj = page.commonObjs.has(raw.fontName ?? "") ? (page.commonObjs.get(raw.fontName ?? "") as { name?: string; bold?: boolean }) : null;
      bold ||= obj?.bold === true || /bold|black|heavy/i.test(obj?.name ?? "");
    } catch {
      // Not loaded: keep what the style said.
    }
    out.push({ str: raw.str, x: e, y: f, size: Math.round(Math.hypot(a, b) * 10) / 10, width: raw.width ?? 0, bold });
  }
  return out;
}

/** Items into lines: same baseline (±2 pt), left to right. Two columns: everything left of the gutter first. */
function lines(items: Item[], page: number, columns: boolean | undefined, pageWidth = 612): Line[] {
  const mid = pageWidth / 2;
  const leftOnly = items.filter((i) => i.x + i.width < mid - 10).length;
  const rightOnly = items.filter((i) => i.x > mid - 10).length;
  const twoColumns = columns ?? (leftOnly > 3 && rightOnly > 3 && items.every((i) => i.x + i.width < mid + 10 || i.x > mid - 10));
  const groups = twoColumns ? [items.filter((i) => i.x < mid - 10), items.filter((i) => i.x >= mid - 10)] : [items];
  const out: Line[] = [];
  for (const group of groups) {
    const sorted = [...group].sort((p, q) => q.y - p.y || p.x - q.x);
    let current: Item[] = [];
    const flush = () => {
      if (current.length === 0) return;
      current.sort((p, q) => p.x - q.x);
      const text = current.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
      out.push({ text, x: current[0].x, y: current[0].y, size: Math.max(...current.map((i) => i.size)), bold: current.every((i) => i.bold), page });
      current = [];
    };
    for (const it of sorted) {
      if (current.length > 0 && Math.abs(current[0].y - it.y) > 2) flush();
      current.push(it);
    }
    flush();
  }
  return out;
}

/** Lines that repeat on most pages (by their text with digits blanked) or that are only a page number. */
function running(all: Line[][]): Set<string> {
  const key = (l: Line) => l.text.replace(/\d+/g, "#");
  const count = new Map<string, number>();
  for (const page of all) for (const k of new Set(page.map(key))) count.set(k, (count.get(k) ?? 0) + 1);
  const pages = all.filter((p) => p.length > 0).length;
  return new Set([...count].filter(([k, n]) => pages >= 3 && n / pages >= RUNNING_SHARE && k.length <= 120).map(([k]) => k));
}

const ENDS = /[.!?:;)"'»”’]$/;

/**
 * A PDF into blocks (§3). Body size is the most common line size; a line at least 1.25× it is a heading (level 1 from
 * 1.6×, else 2; 3 from 1.15× when bold), or, with `headingsByWeight`, a short bold line on its own is a level-2
 * heading. Paragraphs end at a gap larger than 1.5 lines, a size change, or a line that ends a sentence and is short.
 */
export async function pdfBlocks(data: Buffer, opts: { pageRange?: [number, number]; settings?: ConvertSettings } = {}): Promise<{ blocks: MdBlock[]; pages: number; skippedPages: number[] }> {
  const doc = await open(data);
  try {
    const pages = doc.numPages;
    const [from, to] = opts.pageRange ?? [1, pages];
    const perPage: Line[][] = [];
    const skippedPages: number[] = [];
    for (let n = 1; n <= pages; n++) {
      const items = await pageItems(doc, n);
      if (items.length === 0) skippedPages.push(n);
      perPage.push(n >= from && n <= to ? lines(items, n, opts.settings?.columns) : []);
    }
    const drop = running(perPage);
    const kept = perPage.map((p) => p.filter((l) => !drop.has(l.text.replace(/\d+/g, "#")) && !/^\s*(page\s*)?\d+(\s*(of|\/)\s*\d+)?\s*$/i.test(l.text)));
    const sizes = new Map<number, number>();
    for (const l of kept.flat()) sizes.set(l.size, (sizes.get(l.size) ?? 0) + l.text.length);
    const bodySize = [...sizes].sort((p, q) => q[1] - p[1])[0]?.[0] ?? 11;
    const level = (l: Line): number | null => {
      if (opts.settings?.headingsByWeight) return l.bold && l.text.length <= 80 && !ENDS.test(l.text) ? 2 : null;
      if (l.size >= bodySize * 1.6) return 1;
      if (l.size >= bodySize * 1.25) return 2;
      if (l.size >= bodySize * 1.15 && l.bold) return 3;
      return null;
    };
    const blocks: MdBlock[] = [];
    let para: Line[] = [];
    const flush = () => {
      if (para.length === 0) return;
      let text = "";
      for (const l of para) {
        // §3: a word split by an end-of-line hyphen is joined.
        if (/[\p{L}]-$/u.test(text) && /^\p{Ll}/u.test(l.text)) text = text.slice(0, -1) + l.text;
        else text = text ? `${text} ${l.text}` : l.text;
      }
      blocks.push({ kind: "para", md: text, loc: `p.${para[0].page}`, page: para[0].page });
      para = [];
    };
    for (const page of kept) {
      for (const l of page) {
        const h = level(l);
        if (h !== null) {
          flush();
          blocks.push({ kind: "heading", level: h, md: `${"#".repeat(h)} ${l.text}`, loc: `p.${l.page}`, page: l.page });
          continue;
        }
        const prev = para[para.length - 1];
        const gap = prev && prev.page === l.page ? prev.y - l.y : 0;
        if (prev && (prev.page !== l.page ? ENDS.test(prev.text) : gap > l.size * 1.5 * 1.2 || Math.abs(prev.size - l.size) > 0.5)) flush();
        para.push(l);
      }
    }
    flush();
    return { blocks, pages, skippedPages };
  } finally {
    await doc.destroy();
  }
}

/** Pages, and pages with a text layer, without converting: intake measures before it warns (§7). */
export async function measurePdf(data: Buffer): Promise<{ pages: number; textPages: number }> {
  const doc = await open(data);
  try {
    let textPages = 0;
    for (let n = 1; n <= doc.numPages; n++) if ((await pageItems(doc, n)).length > 0) textPages++;
    return { pages: doc.numPages, textPages };
  } finally {
    await doc.destroy();
  }
}
```

Add `export * from "./convert/pdf";` to `packages/material/src/index.ts`.

If the type import `typeof import("pdfjs-dist/legacy/build/pdf.mjs")` fails to resolve types in this pdfjs version, declare the few members used (`getDocument`) in a local `type PdfJs = { getDocument(o: object): { promise: Promise<any> } }` with a comment, rather than adding `@types`.

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/material/test/pdf.test.ts`
Expected: PASS.

- If the two-column test fails because the gutter rule misses: print `lines(...)` for that page and tune the column detection, keeping the single-column tests green.
- If "headings by weight" can't see bold: pdfjs names standard fonts `g_d0_f2`-style; log `page.commonObjs.get(fontName)` once and read the bold flag from what it holds (`.bold` or a `name` like `Helvetica-Bold`).

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/material pnpm-lock.yaml
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(material): PDF with pdfjs: headings, columns, running lines, hyphens, empty pages"
```

---

### Task 10: Word processing: docx, odt, rtf

`.docx` goes through `mammoth` to HTML, `.odt` through a small reader of its `content.xml` to HTML, and both through the walker from Task 8. `.rtf` is read by a small text extractor. Comments and tracked-change marks never reach the text; footnotes come last (§3 Word).

**Files:**
- Create: `packages/material/src/convert/word.ts`, `packages/material/test/make-office.ts` (test helper: small real docx, odt, pptx, odp, ods and epub files)
- Modify: `packages/material/src/index.ts`, `packages/material/package.json`
- Test: `packages/material/test/word.test.ts` (new)

- [ ] **Step 1: Add the dependencies**

Run: `corepack pnpm --filter @humanharness/material add mammoth jszip fast-xml-parser`
Check the licences: `mammoth` is `BSD-2-Clause`, `jszip` is `(MIT OR GPL-3.0-or-later)`, `fast-xml-parser` is `MIT`. Stop if not.

- [ ] **Step 2: Write the test helper**

Create `packages/material/test/make-office.ts`:

```ts
import JSZip from "jszip";

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const zip = async (files: Record<string, string>): Promise<Buffer> => {
  const z = new JSZip();
  // `mimetype` first and stored, as ODF and EPUB require.
  if (files.mimetype) z.file("mimetype", files.mimetype, { compression: "STORE" });
  for (const [name, text] of Object.entries(files)) if (name !== "mimetype") z.file(name, text);
  return z.generateAsync({ type: "nodebuffer" });
};

/** A docx: each paragraph with an optional built-in style (`Heading1`, `Heading2`, `ListParagraph`). */
export function makeDocx(paras: { text: string; style?: string; bold?: boolean }[], comment?: string): Promise<Buffer> {
  const body = paras
    .map((p) => {
      const pPr = p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : "";
      const rPr = p.bold ? "<w:rPr><w:b/></w:rPr>" : "";
      return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${xmlEsc(p.text)}</w:t></w:r></w:p>`;
    })
    .join("");
  const commentRef = comment ? `<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Commented text.</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>` : "";
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  return zip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${comment ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' : ""}</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${comment ? '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>' : ""}</Relationships>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}${commentRef}</w:body></w:document>`,
    ...(comment ? { "word/comments.xml": `<?xml version="1.0" encoding="UTF-8"?><w:comments ${W}><w:comment w:id="0" w:author="T"><w:p><w:r><w:t>${xmlEsc(comment)}</w:t></w:r></w:p></w:comment></w:comments>` } : {}),
  });
}

const ODF_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"';
const odf = (mimetype: string, body: string) =>
  zip({
    mimetype,
    "META-INF/manifest.xml": `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mimetype}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`,
    "content.xml": `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODF_NS}><office:body>${body}</office:body></office:document-content>`,
  });

/** An odt from raw `office:text` children. */
export const makeOdt = (inner: string) => odf("application/vnd.oasis.opendocument.text", `<office:text>${inner}</office:text>`);
/** An ods from raw `office:spreadsheet` children. */
export const makeOds = (inner: string) => odf("application/vnd.oasis.opendocument.spreadsheet", `<office:spreadsheet>${inner}</office:spreadsheet>`);
/** An odp from raw `office:presentation` children. */
export const makeOdp = (inner: string) => odf("application/vnd.oasis.opendocument.presentation", `<office:presentation>${inner}</office:presentation>`);

/** A pptx: one entry per slide, a title, body paragraphs and optional speaker notes. */
export function makePptx(slides: { title?: string; body: string[]; notes?: string }[]): Promise<Buffer> {
  const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const sp = (text: string[], ph?: string) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="1" name="s"/><p:cNvSpPr/><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ""}</p:nvPr></p:nvSpPr><p:txBody>${text.map((t) => `<a:p><a:r><a:t>${xmlEsc(t)}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp>`;
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`,
    "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${P}><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldIdLst></p:presentation>`,
    // Listed in reverse on purpose: the order is the presentation's, not the file names'.
    "ppt/_rels/presentation.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${slides.length - i}.xml"/>`).join("")}</Relationships>`,
  };
  slides.forEach((s, i) => {
    const file = slides.length - i;
    files[`ppt/slides/slide${file}.xml`] = `<?xml version="1.0" encoding="UTF-8"?><p:sld ${P}><p:cSld><p:spTree>${s.title ? sp([s.title], "title") : ""}${sp(s.body)}</p:spTree></p:cSld></p:sld>`;
    if (s.notes) {
      files[`ppt/slides/_rels/slide${file}.xml.rels`] = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${file}.xml"/></Relationships>`;
      files[`ppt/notesSlides/notesSlide${file}.xml`] = `<?xml version="1.0" encoding="UTF-8"?><p:notes ${P}><p:cSld><p:spTree>${sp(["1"], "sldNum")}${sp([s.notes], "body")}</p:spTree></p:cSld></p:notes>`;
    }
  });
  return zip(files);
}

/** An epub with chapters in spine order (each chapter an XHTML body). */
export function makeEpub(chapters: string[]): Promise<Buffer> {
  const files: Record<string, string> = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    "OEBPS/book.opf": `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest>${chapters.map((_, i) => `<item id="c${i + 1}" href="text/c${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join("")}</spine></package>`,
  };
  chapters.forEach((body, i) => {
    files[`OEBPS/text/c${i + 1}.xhtml`] = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c</title></head><body>${body}</body></html>`;
  });
  return zip(files);
}
```

- [ ] **Step 3: Write the failing test**

Create `packages/material/test/word.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { docxBlocks, odtBlocks, rtfBlocks } from "../src";
import { makeDocx, makeOdt } from "./make-office";

describe("docx (mammoth)", () => {
  it("headings from styles, paragraphs, and no comments", async () => {
    const buf = await makeDocx([{ text: "Fractions", style: "Heading1" }, { text: "A fraction has two parts." }, { text: "Equivalent", style: "Heading2" }, { text: "Same amount." }], "A reviewer's remark");
    const blocks = await docxBlocks(buf);
    const md = blocks.map((b) => b.md).join("\n");
    expect(blocks.slice(0, 4).map((b) => [b.kind, b.md])).toEqual([
      ["heading", "# Fractions"],
      ["para", "A fraction has two parts."],
      ["heading", "## Equivalent"],
      ["para", "Same amount."],
    ]);
    expect(blocks[3].loc).toBe("§ Fractions › Equivalent ¶1");
    expect(md).not.toContain("reviewer's remark");
  });

  it("a broken file is refused as unreadable", async () => {
    await expect(docxBlocks(Buffer.from("PK\u0003\u0004 broken"))).rejects.toMatchObject({ reason: "unreadable" });
  });
});

describe("odt", () => {
  it("outline levels are headings; lists, tables and images", async () => {
    const buf = await makeOdt(
      `<text:h text:outline-level="1">Fractions</text:h><text:p>Two parts.</text:p>` +
        `<text:list><text:list-item><text:p>numerator</text:p></text:list-item><text:list-item><text:p>denominator</text:p></text:list-item></text:list>` +
        `<table:table><table:table-row><table:table-cell><text:p>a</text:p></table:table-cell><table:table-cell><text:p>b</text:p></table:table-cell></table:table-row></table:table>` +
        `<text:p><draw:frame><draw:image/></draw:frame></text:p><office:annotation><text:p>hidden comment</text:p></office:annotation>`,
    );
    const blocks = await odtBlocks(buf);
    expect(blocks.map((b) => [b.kind, b.md])).toEqual([
      ["heading", "# Fractions"],
      ["para", "Two parts."],
      ["list", "- numerator\n- denominator"],
      ["table", "| a | b |\n|---|---|"],
      ["image", "[image, § Fractions ¶4]"],
    ]);
  });
});

describe("rtf", () => {
  it("text, paragraphs, escapes and Unicode; control words and hidden groups dropped", () => {
    const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Times;}}{\colortbl;\red0\green0\blue0;}{\*\generator Word;}{\info{\title Secret}}\pard Una fracci\'f3n tiene dos partes.\par Caf\u233?. \tab Fin.\par}`;
    expect(rtfBlocks(Buffer.from(rtf, "latin1")).map((b) => b.md)).toEqual(["Una fracción tiene dos partes.\nCafé. \tFin."]);
  });
});
```

The RTF expectation is one paragraph block because `markdownBlocks` joins consecutive non-empty lines into one paragraph; `\par` ends a line, and a blank line (two `\par`) ends a paragraph.

- [ ] **Step 4: Run test to verify it fails**

Run: `corepack pnpm vitest run packages/material/test/word.test.ts`
Expected: FAIL (`docxBlocks` is not exported).

- [ ] **Step 5: Write the converters**

Create `packages/material/src/convert/word.ts`:

```ts
import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import mammoth from "mammoth";
import { markdownBlocks, withEstimatedPages } from "../blocks";
import type { MdBlock } from "../types";
import { decodeText } from "./text";
import { htmlBlocks } from "./html";
import { MaterialRefused } from "./pdf";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * docx: mammoth maps Word's heading styles to h1–h6 and drops comments and tracked-change marks (it reads the
 * accepted text). Images become empty `<img>` (no data URIs: nothing is described, D4). Footnotes come last, as
 * mammoth puts them.
 */
export async function docxBlocks(buf: Buffer): Promise<MdBlock[]> {
  let html: string;
  try {
    const result = await mammoth.convertToHtml({ buffer: buf }, { convertImage: mammoth.images.imgElement(async () => ({ src: "" })), ignoreEmptyParagraphs: true });
    html = result.value;
  } catch {
    throw new MaterialRefused("unreadable");
  }
  return htmlBlocks(html);
}

/** An XML part of a zip, parsed keeping order (`preserveOrder`): each node is `{ tag: children, ":@": attrs }`. */
export type XNode = Record<string, unknown> & { ":@"?: Record<string, string> };
export async function zipXml(buf: Buffer | JSZip, name: string): Promise<XNode[] | null> {
  let zip: JSZip;
  try {
    zip = buf instanceof JSZip ? buf : await JSZip.loadAsync(buf);
  } catch {
    throw new MaterialRefused("unreadable");
  }
  const file = zip.file(name);
  if (!file) return null;
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "", trimValues: false, processEntities: true, htmlEntities: false });
  return parser.parse(await file.async("string")) as XNode[];
}

/** A node's tag name (the one key that isn't `:@`). */
export const tagOf = (n: XNode): string => Object.keys(n).find((k) => k !== ":@") ?? "";
export const kids = (n: XNode): XNode[] => (Array.isArray(n[tagOf(n)]) ? (n[tagOf(n)] as XNode[]) : []);
export const attr = (n: XNode, name: string): string | undefined => n[":@"]?.[name];

/** The text of a node: text runs, `text:s` (spaces), `text:tab`, `text:line-break`; annotations and notes' citations left out. */
export function odfText(n: XNode): string {
  const tag = tagOf(n);
  if (tag === "#text") return String(n["#text"] ?? "");
  if (tag === "text:s") return " ".repeat(Number(attr(n, "text:c") ?? 1));
  if (tag === "text:tab") return "\t";
  if (tag === "text:line-break") return "\n";
  if (tag === "office:annotation" || tag === "office:annotation-end" || tag === "text:tracked-changes" || tag === "text:deletion") return "";
  return kids(n).map(odfText).join("");
}

/** ODF text content as HTML (headings, paragraphs, lists, tables, images), for the walker. */
export function odfHtml(nodes: XNode[]): string {
  return nodes
    .map((n) => {
      const tag = tagOf(n);
      if (tag === "text:h") {
        const level = Math.min(6, Math.max(1, Number(attr(n, "text:outline-level") ?? 1)));
        return `<h${level}>${esc(odfText(n))}</h${level}>`;
      }
      if (tag === "text:p") {
        const image = kids(n).some((k) => tagOf(k) === "draw:frame") ? "<img>" : "";
        const text = odfText(n).trim();
        return `${text ? `<p>${esc(text)}</p>` : ""}${image}`;
      }
      if (tag === "text:list") {
        const items = kids(n)
          .filter((k) => tagOf(k) === "text:list-item")
          .map((li) => `<li>${kids(li).map((c) => (tagOf(c) === "text:list" ? odfHtml([c]) : esc(odfText(c)))).join("")}</li>`);
        return `<ul>${items.join("")}</ul>`;
      }
      if (tag === "table:table") {
        const rows = kids(n)
          .flatMap((k) => (tagOf(k) === "table:table-header-rows" || tagOf(k) === "table:table-rows" ? kids(k) : [k]))
          .filter((k) => tagOf(k) === "table:table-row")
          .map((r) => `<tr>${kids(r).filter((c) => tagOf(c) === "table:table-cell").map((c) => `<td>${esc(odfText(c).trim())}</td>`).join("")}</tr>`);
        return `<table>${rows.join("")}</table>`;
      }
      if (tag === "text:section" || tag === "office:text" || tag === "office:body" || tag === "office:document-content") return odfHtml(kids(n));
      return "";
    })
    .join("");
}

/** The first node with `tag`, depth first. */
export function findNode(nodes: XNode[], tag: string): XNode | null {
  for (const n of nodes) {
    if (tagOf(n) === tag) return n;
    const inner = findNode(kids(n), tag);
    if (inner) return inner;
  }
  return null;
}

export async function odtBlocks(buf: Buffer): Promise<MdBlock[]> {
  const content = await zipXml(buf, "content.xml");
  const text = content && findNode(content, "office:text");
  if (!text) throw new MaterialRefused("unreadable");
  return htmlBlocks(odfHtml(kids(text)));
}

/** Groups whose text is never content: fonts, colours, styles, document info, pictures, and every `{\*…}` group. */
const SKIP = /^(fonttbl|colortbl|stylesheet|info|pict|object|header|footer|headerl|headerr|footerl|footerr|listtable|listoverridetable|rsidtbl|generator|xmlnstbl|themedata|datastore|latentstyles)$/;

/** RTF into plain text: `\par` ends a line, `\'hh` is Windows-1252, `\uN?` is Unicode (its fallback skipped). */
export function rtfText(src: string): string {
  let out = "";
  const stack: boolean[] = [];
  let skip = false;
  let skipNext = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") {
      stack.push(skip);
      if (src.startsWith("{\\*", i)) skip = true;
      continue;
    }
    if (ch === "}") {
      skip = stack.pop() ?? false;
      continue;
    }
    if (ch === "\\") {
      const next = src[i + 1];
      if (next === "\\" || next === "{" || next === "}") {
        if (!skip) out += next;
        i++;
        continue;
      }
      if (next === "'") {
        const byte = Number.parseInt(src.slice(i + 2, i + 4), 16);
        if (!skip && skipNext === 0) out += new TextDecoder("windows-1252").decode(Uint8Array.of(byte));
        else if (skipNext > 0) skipNext--;
        i += 3;
        continue;
      }
      const m = /^([a-z]+)(-?\d+)? ?/.exec(src.slice(i + 1));
      if (!m) {
        i++;
        continue;
      }
      const [all, word, num] = m;
      i += all.length;
      if (SKIP.test(word) && src[i - all.length - 1] === "{") skip = true;
      if (skip) continue;
      if (word === "par" || word === "line") out += "\n";
      else if (word === "tab") out += "\t";
      else if (word === "u" && num !== undefined) {
        const code = Number(num) < 0 ? Number(num) + 65536 : Number(num);
        out += String.fromCharCode(code);
        skipNext = 1;
      }
      continue;
    }
    if (ch === "\r" || ch === "\n") continue;
    if (skip) continue;
    if (skipNext > 0) {
      skipNext--;
      continue;
    }
    out += ch;
  }
  return out.replace(/[ \t]+\n/g, "\n").trim();
}

export function rtfBlocks(buf: Buffer): MdBlock[] {
  return withEstimatedPages(markdownBlocks(rtfText(decodeText(buf))));
}
```

`SKIP` checks the brace right before the control word: `{\fonttbl …}` starts a skipped group, a bare `\info` elsewhere doesn't. If the RTF test shows a leftover `Times;` or `Secret`, print `rtfText` and fix the group detection, not the test.

Add `export * from "./convert/word";` to `packages/material/src/index.ts`.

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/material/test/word.test.ts`
Expected: PASS. If mammoth names the heading paragraphs `h1`/`h2` only when the styles exist in `styles.xml`, add a minimal `word/styles.xml` with `Heading1` and `Heading2` paragraph styles (`<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>`) to `makeDocx`, and its relationship and content type.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/material pnpm-lock.yaml
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(material): Word, OpenDocument text and RTF"
```

---

### Task 11: Spreadsheets, presentations, ebooks

**Files:**
- Create: `packages/material/src/convert/sheet.ts`, `packages/material/src/convert/slides.ts`, `packages/material/src/convert/epub.ts`
- Modify: `packages/material/src/index.ts`, `packages/material/package.json`
- Test: `packages/material/test/sheet.test.ts`, `packages/material/test/slides.test.ts` (new)

- [ ] **Step 1: Add the dependency**

Run: `corepack pnpm --filter @humanharness/material add exceljs`
Check: `exceljs` is `MIT`.

- [ ] **Step 2: Write the failing tests**

Create `packages/material/test/sheet.test.ts`:

```ts
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { csvSheets, odsSheets, sheetSummary, xlsxSheets } from "../src";
import { makeOds } from "./make-office";

async function makeXlsx(sheets: Record<string, unknown[][]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) wb.addWorksheet(name).addRows(rows);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("spreadsheets (§3)", () => {
  it("xlsx: header row, data rows with cell ranges, formulas as their values, dates as ISO", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Data");
    ws.addRows([["name", "value", "when"], ["a", 1, new Date(Date.UTC(2026, 0, 2))], ["b|c", 2]]);
    ws.getCell("B4").value = { formula: "B2+B3", result: 3 };
    ws.getCell("A4").value = "total";
    const sheets = await xlsxSheets(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toMatchObject({ name: "Data", header: "| name | value | when |\n|---|---|---|", columns: ["name", "value", "when"] });
    expect(sheets[0].rows).toEqual([
      { md: "| a | 1 | 2026-01-02 |", loc: "Data!A2:C2" },
      { md: "| b\\|c | 2 |  |", loc: "Data!A3:C3" },
      { md: "| total | 3 |  |", loc: "Data!A4:C4" },
    ]);
  });

  it("empty sheets are skipped; several sheets keep their order", async () => {
    const sheets = await xlsxSheets(await makeXlsx({ One: [["x"], [1]], Empty: [], Two: [["y"], [2]] }));
    expect(sheets.map((s) => s.name)).toEqual(["One", "Two"]);
  });

  it("csv and tsv: quotes, commas and new lines inside quotes", () => {
    const [s] = csvSheets(Buffer.from('a,b\n"x, y","line\nnext"\n'), ",", "notes.csv");
    expect(s.name).toBe("notes.csv");
    expect(s.rows).toEqual([{ md: "| x, y | line next |", loc: "notes.csv!A2:B2" }]);
    expect(csvSheets(Buffer.from("a\tb\n1\t2\n"), "\t", "t.tsv")[0].rows[0].md).toBe("| 1 | 2 |");
  });

  it("ods: repeated rows and cells", async () => {
    const buf = await makeOds(
      `<table:table table:name="S"><table:table-row><table:table-cell><text:p>k</text:p></table:table-cell><table:table-cell><text:p>v</text:p></table:table-cell></table:table-row>` +
        `<table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="2"><text:p>z</text:p></table:table-cell></table:table-row>` +
        `<table:table-row table:number-rows-repeated="1000"><table:table-cell/></table:table-row></table:table>`,
    );
    const [s] = await odsSheets(buf);
    expect(s.rows.map((r) => r.md)).toEqual(["| z | z |", "| z | z |"]);
  });

  it("the summary fragment: sheets, columns, row counts and the first rows", () => {
    const md = sheetSummary([{ name: "Data", header: "| a |\n|---|", columns: ["a"], rows: Array.from({ length: 30 }, (_, i) => ({ md: `| ${i} |`, loc: `Data!A${i + 2}:A${i + 2}` })) }], 2);
    expect(md).toBe("## Data\n\nColumns: a. Rows: 30.\n\n| a |\n|---|\n| 0 |\n| 1 |");
  });
});
```

Create `packages/material/test/slides.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { epubBlocks, odpBlocks, pptxBlocks } from "../src";
import { makeEpub, makeOdp, makePptx } from "./make-office";

describe("presentations (§3)", () => {
  it("pptx: one heading per slide in presentation order, body, then notes under 'Notes'", async () => {
    const buf = await makePptx([{ title: "Fractions", body: ["Two parts"], notes: "Say it slowly." }, { body: ["No title here"] }]);
    const blocks = await pptxBlocks(buf);
    expect(blocks.map((b) => [b.kind, b.md, b.loc, b.page])).toEqual([
      ["heading", "## Fractions", "slide 1", 1],
      ["para", "Two parts", "slide 1", 1],
      ["para", "**Notes:** Say it slowly.", "slide 1", 1],
      ["heading", "## Slide 2", "slide 2", 2],
      ["para", "No title here", "slide 2", 2],
    ]);
  });

  it("odp: pages, titles and notes", async () => {
    const buf = await makeOdp(
      `<draw:page draw:name="p1"><draw:frame presentation:class="title"><draw:text-box><text:p>Intro</text:p></draw:text-box></draw:frame><draw:frame><draw:text-box><text:p>Hello</text:p></draw:text-box></draw:frame>` +
        `<presentation:notes><draw:frame><draw:text-box><text:p>Remember</text:p></draw:text-box></draw:frame></presentation:notes></draw:page>`,
    );
    expect((await odpBlocks(buf)).map((b) => b.md)).toEqual(["## Intro", "Hello", "**Notes:** Remember"]);
  });
});

describe("ebooks (§3)", () => {
  it("chapters in spine order, locations under the chapter", async () => {
    const blocks = await epubBlocks(await makeEpub(["<h1>One</h1><p>First.</p>", "<h1>Two</h1><p>Second.</p>"]));
    expect(blocks.map((b) => [b.md, b.loc])).toEqual([
      ["# One", "ch. 1 › § One"],
      ["First.", "ch. 1 › § One ¶1"],
      ["# Two", "ch. 2 › § Two"],
      ["Second.", "ch. 2 › § Two ¶1"],
    ]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `corepack pnpm vitest run packages/material/test/sheet.test.ts packages/material/test/slides.test.ts`
Expected: FAIL (`xlsxSheets` is not exported).

- [ ] **Step 4: Write the spreadsheet converter**

Create `packages/material/src/convert/sheet.ts`:

```ts
import ExcelJS from "exceljs";
import type { SheetRows } from "../types";
import { decodeText } from "./text";
import { MaterialRefused } from "./pdf";
import { attr, findNode, kids, odfText, tagOf, zipXml } from "./word";

const cellMd = (v: string) => v.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
const colName = (n: number): string => (n <= 0 ? "" : colName(Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26)));

/** Rows (arrays of cell text) into one sheet: the first non-empty row is the header, empty rows are dropped. */
export function toSheet(name: string, raw: string[][], firstRow = 1): SheetRows | null {
  const rows = raw.map((r, i) => ({ cells: r, n: firstRow + i })).filter((r) => r.cells.some((c) => c.trim() !== ""));
  if (rows.length === 0) return null;
  const [head, ...data] = rows;
  const width = Math.max(...rows.map((r) => r.cells.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")].map(cellMd);
  const line = (r: string[]) => `| ${pad(r).join(" | ")} |`;
  const last = colName(width);
  return {
    name,
    header: `${line(head.cells)}\n|${Array(width).fill("---").join("|")}|`,
    columns: pad(head.cells),
    rows: data.map((r) => ({ md: line(r.cells), loc: `${name}!A${r.n}:${last}${r.n}` })),
  };
}

/** A cell's shown value: formulas give their cached result, dates an ISO date, rich text and links their text. */
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v) return cellText((v as { result?: ExcelJS.CellValue }).result ?? null);
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join("");
    if ("text" in v) return String((v as { text: unknown }).text);
    if ("error" in v) return String((v as { error: unknown }).error);
    return "";
  }
  return String(v);
}

export async function xlsxSheets(buf: Buffer): Promise<SheetRows[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf);
  } catch {
    throw new MaterialRefused("unreadable");
  }
  const out: SheetRows[] = [];
  wb.eachSheet((ws) => {
    const raw: string[][] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= Math.max(row.cellCount, ws.columnCount); c++) cells.push(cellText(row.getCell(c).value));
      while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
      raw.push(cells);
    }
    const sheet = toSheet(ws.name, raw);
    if (sheet) out.push(sheet);
  });
  return out;
}

/** CSV/TSV with RFC 4180 quotes. The sheet is named after the file. */
export function csvSheets(buf: Buffer, sep: "," | "\t", name: string): SheetRows[] {
  const text = decodeText(buf);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) rows.push([...row, cell]);
  const sheet = toSheet(name, rows);
  return sheet ? [sheet] : [];
}

/** ODS: `number-rows-repeated` and `number-columns-repeated` expand; trailing empty runs (often 1 000 000 rows) don't. */
export async function odsSheets(buf: Buffer): Promise<SheetRows[]> {
  const content = await zipXml(buf, "content.xml");
  const book = content && findNode(content, "office:spreadsheet");
  if (!book) throw new MaterialRefused("unreadable");
  const out: SheetRows[] = [];
  for (const t of kids(book).filter((k) => tagOf(k) === "table:table")) {
    const raw: string[][] = [];
    const rowNodes = kids(t).flatMap((k) => (["table:table-header-rows", "table:table-rows", "table:table-row-group"].includes(tagOf(k)) ? kids(k) : [k]));
    for (const r of rowNodes.filter((k) => tagOf(k) === "table:table-row")) {
      const cells: string[] = [];
      for (const c of kids(r).filter((k) => ["table:table-cell", "table:covered-table-cell"].includes(tagOf(k)))) {
        const n = Math.min(Number(attr(c, "table:number-columns-repeated") ?? 1), 1024);
        const v = odfText(c).trim();
        for (let i = 0; i < n; i++) cells.push(v);
      }
      while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
      const times = Number(attr(r, "table:number-rows-repeated") ?? 1);
      // An empty run adds nothing; a filled one is repeated (capped, a file can claim a million).
      if (cells.length > 0) for (let i = 0; i < Math.min(times, 100_000); i++) raw.push(cells);
      else raw.push([]);
    }
    const sheet = toSheet(attr(t, "table:name") ?? `Sheet${out.length + 1}`, raw);
    if (sheet) out.push(sheet);
  }
  return out;
}

/** "Summary and first rows" (§3): per sheet, its columns, its row count and its first `first` rows. */
export function sheetSummary(sheets: SheetRows[], first: number): string {
  return sheets
    .map((s) => [`## ${s.name}`, `Columns: ${s.columns.filter(Boolean).join(", ")}. Rows: ${s.rows.length}.`, [s.header, ...s.rows.slice(0, first).map((r) => r.md)].join("\n")].join("\n\n"))
    .join("\n\n");
}

export const rowCount = (sheets: SheetRows[]): number => sheets.reduce((n, s) => n + s.rows.length, 0);
```

- [ ] **Step 5: Write the presentation and ebook converters**

Create `packages/material/src/convert/slides.ts`:

```ts
import path from "node:path";
import JSZip from "jszip";
import type { MdBlock } from "../types";
import { MaterialRefused } from "./pdf";
import { type XNode, attr, findNode, kids, odfText, tagOf, zipXml } from "./word";

/** Every `a:t` text under a node, paragraph by paragraph (`a:p`). */
function drawingParas(n: XNode): string[] {
  const out: string[] = [];
  const walk = (x: XNode) => {
    if (tagOf(x) === "a:p") {
      const text = collect(x).trim();
      if (text) out.push(text);
      return;
    }
    kids(x).forEach(walk);
  };
  const collect = (x: XNode): string => (tagOf(x) === "#text" ? String(x["#text"]) : tagOf(x) === "a:br" ? "\n" : kids(x).map(collect).join(""));
  walk(n);
  return out;
}

/** A shape's placeholder type (`title`, `ctrTitle`, `body`, `sldNum`…), if any. */
const placeholder = (sp: XNode): string | undefined => {
  const ph = findNode([sp], "p:ph");
  return ph ? (attr(ph, "type") ?? "body") : undefined;
};

const relsTarget = (rels: XNode[] | null, pred: (r: XNode) => boolean): string | undefined => {
  const list = rels ? kids(findNode(rels, "Relationships") ?? ({} as XNode)) : [];
  const r = list.find((x) => tagOf(x) === "Relationship" && pred(x));
  return r ? attr(r, "Target") : undefined;
};

/** One slide's blocks: `## <title or Slide n>`, its text, images, then `**Notes:** …` (§3 Presentations). */
function slideBlocks(n: number, title: string | undefined, paras: string[], images: number, notes: string[]): MdBlock[] {
  const loc = `slide ${n}`;
  return [
    { kind: "heading", level: 2, md: `## ${title || `Slide ${n}`}`, loc, page: n },
    ...paras.map((md): MdBlock => ({ kind: "para", md, loc, page: n })),
    ...Array.from({ length: images }, (): MdBlock => ({ kind: "image", md: `[image, ${loc}]`, loc, page: n })),
    ...(notes.length ? [{ kind: "para", md: `**Notes:** ${notes.join(" ")}`, loc, page: n } as MdBlock] : []),
  ];
}

export async function pptxBlocks(buf: Buffer): Promise<MdBlock[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new MaterialRefused("unreadable");
  }
  const pres = await zipXml(zip, "ppt/presentation.xml");
  const rels = await zipXml(zip, "ppt/_rels/presentation.xml.rels");
  if (!pres) throw new MaterialRefused("unreadable");
  const ids = kids(findNode(pres, "p:sldIdLst") ?? ({} as XNode)).map((s) => attr(s, "r:id")).filter((x): x is string => !!x);
  const out: MdBlock[] = [];
  let n = 0;
  for (const rid of ids) {
    const target = relsTarget(rels, (r) => attr(r, "Id") === rid);
    if (!target) continue;
    const file = path.posix.join("ppt", target);
    const slide = await zipXml(zip, file);
    if (!slide) continue;
    n++;
    const tree = findNode(slide, "p:spTree");
    const shapes = tree ? kids(tree) : [];
    let title: string | undefined;
    const paras: string[] = [];
    let images = 0;
    for (const sp of shapes) {
      if (tagOf(sp) === "p:pic") images++;
      if (tagOf(sp) !== "p:sp") continue;
      const ph = placeholder(sp);
      const text = drawingParas(sp);
      if ((ph === "title" || ph === "ctrTitle") && !title) title = text.join(" ");
      else if (ph !== "sldNum" && ph !== "dt" && ph !== "ftr") paras.push(...text);
    }
    const slideRels = await zipXml(zip, path.posix.join(path.posix.dirname(file), "_rels", `${path.posix.basename(file)}.rels`));
    const notesTarget = relsTarget(slideRels, (r) => (attr(r, "Type") ?? "").endsWith("/notesSlide"));
    const notesXml = notesTarget ? await zipXml(zip, path.posix.join(path.posix.dirname(file), notesTarget)) : null;
    const notesTree = notesXml ? findNode(notesXml, "p:spTree") : null;
    const notes = notesTree ? kids(notesTree).filter((sp) => tagOf(sp) === "p:sp" && placeholder(sp) === "body").flatMap(drawingParas) : [];
    out.push(...slideBlocks(n, title, paras, images, notes));
  }
  return out;
}

export async function odpBlocks(buf: Buffer): Promise<MdBlock[]> {
  const content = await zipXml(buf, "content.xml");
  const pres = content && findNode(content, "office:presentation");
  if (!pres) throw new MaterialRefused("unreadable");
  const out: MdBlock[] = [];
  let n = 0;
  for (const page of kids(pres).filter((k) => tagOf(k) === "draw:page")) {
    n++;
    let title: string | undefined;
    const paras: string[] = [];
    let images = 0;
    const notes: string[] = [];
    for (const f of kids(page)) {
      if (tagOf(f) === "presentation:notes") {
        notes.push(...kids(f).flatMap((x) => textParas(x)));
        continue;
      }
      if (tagOf(f) !== "draw:frame") continue;
      if (findNode([f], "draw:image")) images++;
      const text = textParas(f);
      if (attr(f, "presentation:class") === "title" && !title) title = text.join(" ");
      else paras.push(...text);
    }
    out.push(...slideBlocks(n, title, paras, images, notes));
  }
  return out;
}

/** Each `text:p` under a node, trimmed, empty ones left out. */
function textParas(n: XNode): string[] {
  if (tagOf(n) === "text:p") {
    const t = odfText(n).trim();
    return t ? [t] : [];
  }
  return kids(n).flatMap(textParas);
}
```

Create `packages/material/src/convert/epub.ts`:

```ts
import path from "node:path";
import JSZip from "jszip";
import { withEstimatedPages } from "../blocks";
import type { MdBlock } from "../types";
import { htmlBlocks } from "./html";
import { MaterialRefused } from "./pdf";
import { attr, findNode, kids, tagOf, zipXml } from "./word";

/** EPUB: the chapters in spine order, each read by the HTML walker under `ch. N` (§3 Ebooks). DRM-locked: refused. */
export async function epubBlocks(buf: Buffer): Promise<MdBlock[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new MaterialRefused("unreadable");
  }
  if (zip.file("META-INF/encryption.xml")) throw new MaterialRefused("protected");
  const container = await zipXml(zip, "META-INF/container.xml");
  const rootfile = container && findNode(container, "rootfile");
  const opfPath = rootfile && attr(rootfile, "full-path");
  const opf = opfPath ? await zipXml(zip, opfPath) : null;
  if (!opf || !opfPath) throw new MaterialRefused("unreadable");
  const manifest = new Map(
    kids(findNode(opf, "manifest") ?? ({} as never))
      .filter((i) => tagOf(i) === "item")
      .map((i) => [attr(i, "id") ?? "", attr(i, "href") ?? ""]),
  );
  const out: MdBlock[] = [];
  let ch = 0;
  for (const ref of kids(findNode(opf, "spine") ?? ({} as never)).filter((i) => tagOf(i) === "itemref")) {
    const href = manifest.get(attr(ref, "idref") ?? "");
    if (!href) continue;
    const file = zip.file(path.posix.join(path.posix.dirname(opfPath), decodeURIComponent(href)));
    if (!file) continue;
    ch++;
    out.push(...htmlBlocks(await file.async("string"), { prefix: `ch. ${ch}` }));
  }
  return withEstimatedPages(out);
}
```

Add to `packages/material/src/index.ts`:

```ts
export * from "./convert/sheet";
export * from "./convert/slides";
export * from "./convert/epub";
```

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/material/test/sheet.test.ts packages/material/test/slides.test.ts`
Expected: PASS. If `htmlBlocks` reads the XHTML's `<title>` into the blocks, its `DROP` already holds `HEAD`; check linkedom parses the XHTML as HTML (it does with `parseHTML`) before changing the walker.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/material pnpm-lock.yaml
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(material): spreadsheets, presentations and ebooks"
```

---

### Task 12: Intake, the cost estimate, and the program pipeline

One place converts any accepted file (`convertFile`), one measures it without converting (`measureFile`), one decides what intake does (`intakeDecision`), one estimates the AI stages (`estimateCost`), and `processSource` runs convert → cut → check → store. `addSource` and `confirmSource` are the two entry points the app calls (Task 14).

**Files:**
- Create: `packages/material/src/convert/index.ts`, `packages/material/src/estimate.ts`, `packages/material/src/intake.ts`, `packages/material/src/pipeline.ts`
- Modify: `packages/material/src/index.ts`
- Test: `packages/material/test/pipeline.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/material/test/pipeline.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MaterialStore, addSource, confirmSource, estimateCost, intakeDecision } from "../src";
import { body, makePdf } from "./make-pdf";

let base: string;
let store: MaterialStore;
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "hh-pipe-"));
  store = new MaterialStore(base, "fractions");
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

const chapter = ["# Fractions", "", ...Array.from({ length: 6 }, (_, i) => `## Part ${i + 1}\n\n${"A fraction names a part of a whole. ".repeat(60)}`)].join("\n\n");

describe("intakeDecision (§7)", () => {
  it("small files run at once; big ones wait with the warning; huge ones need a range", () => {
    expect(intakeDecision({ family: "pdf", pages: 10, sizeBytes: 1000, textPages: 10 })).toEqual({ kind: "process" });
    expect(intakeDecision({ family: "pdf", pages: 60, sizeBytes: 1000, textPages: 60 })).toEqual({ kind: "wait", notice: "warn" });
    expect(intakeDecision({ family: "pdf", pages: 400, sizeBytes: 1000, textPages: 400 })).toEqual({ kind: "wait", notice: "max" });
    expect(intakeDecision({ family: "pdf", pages: 10, sizeBytes: 60 * 1024 * 1024, textPages: 10 })).toEqual({ kind: "wait", notice: "max" });
    expect(intakeDecision({ family: "spreadsheet", pages: 1, sizeBytes: 1000, rows: 5000 })).toEqual({ kind: "wait", notice: "rows" });
  });
  it("no text at all is refused as scanned; some pages without text wait for the person", () => {
    expect(intakeDecision({ family: "pdf", pages: 3, sizeBytes: 1000, textPages: 0 })).toEqual({ kind: "refuse", reason: "scanned" });
    expect(intakeDecision({ family: "pdf", pages: 3, sizeBytes: 1000, textPages: 2 })).toEqual({ kind: "wait", notice: "no-text-pages" });
  });
});

describe("estimateCost (§7)", () => {
  it("per fragment, plus the sheet, plus links when the harness has items", () => {
    // 6000 tokens → 10 fragments; label 700, review 900 × 0.1, sheet 4000.
    expect(estimateCost({ tokens: 6000, items: false })).toBe(10 * (700 + 90) + 4000);
    expect(estimateCost({ tokens: 6000, items: true })).toBe(10 * (700 + 90 + 120) + 4000);
    expect(estimateCost({ tokens: 6000, items: false, reviewShare: 1 })).toBe(10 * (700 + 900) + 4000);
    expect(estimateCost({ tokens: 6000, items: false, measured: { label: 100, review: 200, sheet: 50 } })).toBe(10 * (100 + 20) + 50);
  });
});

describe("addSource and confirmSource", () => {
  it("a small Markdown file: original kept, fragments written, validating for review, index rebuilt", async () => {
    const r = await addSource(store, { name: "Fractions.md", data: Buffer.from(chapter) }, { accepts: ["text"], items: false });
    expect(r).toMatchObject({ ok: true, waiting: false });
    if (!r.ok) throw new Error("unreachable");
    const s = (await store.source(r.id))!;
    expect(s).toMatchObject({ id: "fractions", status: "validating", stage: "review", type: "md", family: "text", path: "Fractions.md" });
    expect(s.fragments.length).toBeGreaterThanOrEqual(5);
    expect(s.estimate).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(base, "material", "fractions", "Fractions.md"))).toBe(true);
    const f = (await store.readFragment(s.fragments[1]))!;
    expect(f.meta).toMatchObject({ source: "Fractions.md", validated: "not-reviewed", checks: "ok", items: [], keywords: [] });
    // The heading-only "# Fractions" joins its first part (Task 4), so the second fragment is a later part.
    expect(f.meta.path).toMatch(/^Fractions › Part \d$/);
    expect(f.meta.summary).toBe("A fraction names a part of a whole.");
    expect(fs.readFileSync(path.join(store.dir, "index.md"), "utf8")).toContain(s.fragments[1]);
  });

  it("refusals keep nothing", async () => {
    const r = await addSource(store, { name: "song.mp3", data: Buffer.from("ID3...") }, { accepts: ["text"], items: false });
    expect(r).toMatchObject({ ok: false, reason: "media" });
    const r2 = await addSource(store, { name: "a.md", data: Buffer.from("# A") }, { accepts: ["pdf"], items: false });
    expect(r2).toMatchObject({ ok: false, reason: "not-accepted" });
    expect(fs.existsSync(path.join(base, "material"))).toBe(false);
  });

  it("a long PDF waits; confirming with a page range converts only those pages", async () => {
    const pages = Array.from({ length: 60 }, (_, i) => body([`Page ${i + 1} has its own sentence about fractions.`]));
    const r = await addSource(store, { name: "book.pdf", data: makePdf(pages) }, { accepts: ["pdf"], items: false });
    expect(r).toMatchObject({ ok: true, waiting: true });
    if (!r.ok) throw new Error("unreachable");
    expect(await store.source(r.id)).toMatchObject({ status: "pending", notice: "warn", pages: 60, fragments: [] });
    await confirmSource(store, r.id, { pageRange: [2, 3] }, { items: false });
    const s = (await store.source(r.id))!;
    expect(s).toMatchObject({ status: "validating", pageRange: [2, 3] });
    const text = (await store.fragments()).map((f) => f.md).join("\n");
    expect(text).toContain("Page 2 has");
    expect(text).not.toContain("Page 4 has");
  });

  it("a fragment the checks flag carries its checks in the front matter", async () => {
    const garbled = `# T\n\n${"Text \uFFFD with broken \uFFFD characters. ".repeat(40)}`;
    const r = await addSource(store, { name: "bad.md", data: Buffer.from(garbled) }, { accepts: ["text"], items: false });
    if (!r.ok) throw new Error("unreachable");
    const [f] = await store.fragments();
    expect(f.meta.checks).toContain("garbled");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run packages/material/test/pipeline.test.ts`
Expected: FAIL (`addSource` is not exported).

- [ ] **Step 3: Write the dispatch**

Create `packages/material/src/convert/index.ts`:

```ts
import { estimateTokens } from "@humanharness/workspace";
import { PAGE_TOKENS } from "../constants";
import { pagesOf } from "../blocks";
import type { ConvertSettings, Converted, MaterialType, SheetRows } from "../types";
import { epubBlocks } from "./epub";
import { htmlBlocks } from "./html";
import { measurePdf, pdfBlocks } from "./pdf";
import { csvSheets, odsSheets, rowCount, xlsxSheets } from "./sheet";
import { odpBlocks, pptxBlocks } from "./slides";
import { decodeText, textBlocks } from "./text";
import { docxBlocks, odtBlocks, rtfBlocks } from "./word";

export interface ConvertOptions {
  pageRange?: [number, number];
  settings?: ConvertSettings;
  /** The original's file name (a CSV's sheet is named after it). */
  name: string;
}

async function sheetsOf(type: MaterialType, buf: Buffer, name: string): Promise<SheetRows[]> {
  if (type === "xlsx") return xlsxSheets(buf);
  if (type === "ods") return odsSheets(buf);
  return csvSheets(buf, type === "tsv" ? "\t" : ",", name);
}

/** Any accepted file into blocks (or sheets), with a page range applied to every family (§7 "Page range"). */
export async function convertFile(type: MaterialType, buf: Buffer, opts: ConvertOptions): Promise<Converted> {
  if (type === "xlsx" || type === "ods" || type === "csv" || type === "tsv") {
    const sheets = await sheetsOf(type, buf, opts.name);
    return { blocks: [], pages: 1, skippedPages: [], sheets };
  }
  if (type === "pdf") return pdfBlocks(buf, { ...(opts.pageRange ? { pageRange: opts.pageRange } : {}), ...(opts.settings ? { settings: opts.settings } : {}) });
  const blocks =
    type === "docx" ? await docxBlocks(buf)
    : type === "odt" ? await odtBlocks(buf)
    : type === "rtf" ? rtfBlocks(buf)
    : type === "pptx" ? await pptxBlocks(buf)
    : type === "odp" ? await odpBlocks(buf)
    : type === "epub" ? await epubBlocks(buf)
    : type === "html" ? htmlBlocks(decodeText(buf))
    : textBlocks(type, buf);
  const pages = pagesOf(blocks);
  const [from, to] = opts.pageRange ?? [1, pages];
  return { blocks: blocks.filter((b) => b.page >= from && b.page <= to), pages, skippedPages: [] };
}

export interface Measured {
  pages: number;
  tokens: number;
  /** PDFs: pages with a text layer. */
  textPages?: number;
  /** Spreadsheets: rows across all sheets. */
  rows?: number;
}

/**
 * The size of a file before anything is converted for good (§7): a PDF's pages without reading their text twice, a
 * spreadsheet's rows; for the rest it converts (fast, no model) and counts.
 */
export async function measureFile(type: MaterialType, buf: Buffer, name: string): Promise<Measured> {
  if (type === "pdf") {
    const { pages, textPages } = await measurePdf(buf);
    return { pages, textPages, tokens: textPages * PAGE_TOKENS };
  }
  if (type === "xlsx" || type === "ods" || type === "csv" || type === "tsv") {
    const sheets = await sheetsOf(type, buf, name);
    return { pages: 1, rows: rowCount(sheets), tokens: sheets.reduce((n, s) => n + estimateTokens([s.header, ...s.rows.map((r) => r.md)].join("\n")), 0) };
  }
  const c = await convertFile(type, buf, { name });
  return { pages: c.pages, tokens: estimateTokens(c.blocks.map((b) => b.md).join("\n\n")) };
}
```

- [ ] **Step 4: Write the estimate and the intake decision**

Create `packages/material/src/estimate.ts`:

```ts
import { LABEL_TOKENS, LINK_TOKENS, REVIEW_TOKENS, SAMPLE_SHARE, SHEET_TOKENS, TARGET } from "./constants";

/** Per-fragment token costs measured in the base's usage.jsonl (Task 25); a stage without measures uses the constant. */
export interface MeasuredCosts {
  label?: number;
  review?: number;
  link?: number;
  /** Per run, not per fragment. */
  sheet?: number;
}

/**
 * The AI stages' cost in tokens (§7): fragments × (label + review × share) + the sheet + links when the harness has
 * items. `reviewShare`: the share of fragments the review reads (flagged + sample); before conversion, SAMPLE_SHARE.
 */
export function estimateCost(o: { tokens: number; items: boolean; reviewShare?: number; fragments?: number; measured?: MeasuredCosts }): number {
  const n = o.fragments ?? Math.max(1, Math.ceil(o.tokens / TARGET));
  const m = o.measured ?? {};
  const per = (m.label ?? LABEL_TOKENS) + (m.review ?? REVIEW_TOKENS) * (o.reviewShare ?? SAMPLE_SHARE) + (o.items ? (m.link ?? LINK_TOKENS) : 0);
  return Math.round(n * per + (m.sheet ?? SHEET_TOKENS));
}
```

Create `packages/material/src/intake.ts`:

```ts
import type { MaterialFamily } from "@humanharness/harness-sdk";
import { MAX_BYTES, MAX_PAGES, MAX_ROWS, WARN_PAGES } from "./constants";
import type { Refusal, SourceEntry } from "./types";

export type IntakeDecision = { kind: "process" } | { kind: "wait"; notice: NonNullable<SourceEntry["notice"]> } | { kind: "refuse"; reason: Refusal };

/**
 * What intake does with a measured file (§7, §13.4): process now; wait for the person (the warning, a page range, the
 * spreadsheet choice, pages without text); or refuse. A PDF with no text layer at all is a scan (D4: no OCR).
 */
export function intakeDecision(m: { family: MaterialFamily; pages: number; sizeBytes: number; textPages?: number; rows?: number }): IntakeDecision {
  if (m.textPages === 0) return { kind: "refuse", reason: "scanned" };
  if (m.pages >= MAX_PAGES || m.sizeBytes >= MAX_BYTES) return { kind: "wait", notice: "max" };
  if (m.rows !== undefined && m.rows > MAX_ROWS) return { kind: "wait", notice: "rows" };
  if (m.pages >= WARN_PAGES) return { kind: "wait", notice: "warn" };
  if (m.textPages !== undefined && m.textPages < m.pages) return { kind: "wait", notice: "no-text-pages" };
  return { kind: "process" };
}
```

- [ ] **Step 5: Write the pipeline**

Create `packages/material/src/pipeline.ts`:

```ts
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import type { MaterialFamily } from "@humanharness/harness-sdk";
import { estimateTokens } from "@humanharness/workspace";
import { FIRST_ROWS } from "./constants";
import { checkPieces } from "./checks";
import { convertFile, measureFile } from "./convert";
import { MaterialRefused } from "./convert/pdf";
import { sheetSummary } from "./convert/sheet";
import { type Piece, cutBlocks, cutRows } from "./cut";
import { REFUSAL_TEXT, detectType } from "./detect";
import { type MeasuredCosts, estimateCost } from "./estimate";
import { fragmentId } from "./fragment";
import { intakeDecision } from "./intake";
import { type MaterialStore, sourceSlug } from "./store";
import type { ConvertSettings, Fragment, Refusal, SourceEntry } from "./types";

/** The message for a refusal the pipeline makes (detection gives its own). */
export const refusalText = (r: Refusal): string => (Object.hasOwn(REFUSAL_TEXT, r) ? REFUSAL_TEXT[r as keyof typeof REFUSAL_TEXT] : REFUSAL_TEXT.unreadable);

export type AddResult = { ok: true; id: string; waiting: boolean } | { ok: false; reason: Refusal; message: string };

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
function piecesOf(c: Awaited<ReturnType<typeof convertFile>>, sheets: SourceEntry["sheets"]): Piece[] {
  if (!c.sheets) return cutBlocks(c.blocks);
  if (sheets === "summary") {
    const summary: Piece = { path: "Summary", md: sheetSummary(c.sheets, FIRST_ROWS), location: c.sheets.map((s) => s.name).join(", "), pages: [1] };
    return [summary];
  }
  const kept = sheets ? c.sheets.filter((s) => sheets.includes(s.name)) : c.sheets;
  return kept.flatMap(cutRows);
}

/**
 * Converts, cuts, checks and stores a source (§3, §5, §6.1): its fragments are usable at once (`not-reviewed`) and
 * the source goes `validating` at the `review` stage, with the AI stages' estimate. A converter's refusal marks it
 * `refused`. Rebuilds the index.
 */
export async function processSource(
  store: MaterialStore,
  id: string,
  o: { items: boolean; measured?: MeasuredCosts; settings?: ConvertSettings },
): Promise<SourceEntry | null> {
  const s = await store.source(id);
  const file = s && store.originalPath(s.path);
  if (!s || !file) return null;
  await store.patch(id, (e) => ({ ...e, status: "converting" }));
  try {
    const buf = await fs.readFile(file);
    const settings = o.settings ?? s.settings;
    const c = await convertFile(s.type, buf, { name: s.path, ...(s.pageRange ? { pageRange: s.pageRange } : {}), ...(settings ? { settings } : {}) });
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
    const reason: Refusal = err instanceof MaterialRefused ? err.reason : "unreadable";
    if (!(err instanceof MaterialRefused)) console.error("Could not convert the material", err);
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
  o: { accepts: readonly MaterialFamily[]; items: boolean; measured?: MeasuredCosts; now?: Date },
): Promise<AddResult> {
  const detected = detectType(file.name, file.data.subarray(0, 4096));
  if (!detected.ok) return { ok: false, reason: detected.reason, message: detected.message };
  if (!o.accepts.includes(detected.family)) return { ok: false, reason: "not-accepted", message: REFUSAL_TEXT["not-accepted"] };
  let measured;
  try {
    measured = await measureFile(detected.type, file.data, file.name);
  } catch (err) {
    const reason: Refusal = err instanceof MaterialRefused ? err.reason : "unreadable";
    return { ok: false, reason, message: refusalText(reason) };
  }
  const decision = intakeDecision({ family: detected.family, pages: measured.pages, sizeBytes: file.data.length, ...(measured.textPages !== undefined ? { textPages: measured.textPages } : {}), ...(measured.rows !== undefined ? { rows: measured.rows } : {}) });
  if (decision.kind === "refuse") return { ok: false, reason: decision.reason, message: refusalText(decision.reason) };
  const name = await store.addOriginal(file.name, file.data);
  const taken = new Set((await store.sources()).map((s) => s.id));
  const id = sourceSlug(file.url ? file.url.replace(/^https?:\/\//, "") : name, taken);
  const entry: SourceEntry = {
    id,
    scope: store.scope,
    path: name,
    ...(file.url ? { url: file.url, fetchedAt: file.fetchedAt ?? (o.now ?? new Date()).toISOString() } : {}),
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
    addedAt: (o.now ?? new Date()).toISOString(),
  };
  await store.update((list) => [...list, entry]);
  if (decision.kind === "wait") return { ok: true, id, waiting: true };
  await processSource(store, id, { items: o.items, ...(o.measured ? { measured: o.measured } : {}) });
  return { ok: true, id, waiting: false };
}

/** The person's answer to a waiting source (§7): a page range, the spreadsheet's choice, or going on as it is. */
export async function confirmSource(
  store: MaterialStore,
  id: string,
  choice: { pageRange?: [number, number]; sheets?: string[] | "summary" },
  o: { items: boolean; measured?: MeasuredCosts },
): Promise<SourceEntry | null> {
  const s = await store.source(id);
  if (!s || s.status !== "pending") return null;
  const range = choice.pageRange && choice.pageRange[0] >= 1 && choice.pageRange[1] >= choice.pageRange[0] ? ([choice.pageRange[0], Math.min(choice.pageRange[1], s.pages)] as [number, number]) : undefined;
  // A file at the hard limit goes on only with a range (§7).
  if (s.notice === "max" && !range) return null;
  await store.patch(id, (e) => {
    const { notice: _n, ...rest } = e;
    return { ...rest, ...(range ? { pageRange: range } : {}), ...(choice.sheets ? { sheets: choice.sheets } : {}) };
  });
  return processSource(store, id, o);
}
```

The full review's `pending` (notice `full-review`, Task 19) is confirmed through the app, not `confirmSource`: it doesn't convert again.

Add to `packages/material/src/index.ts`:

```ts
export * from "./convert";
export * from "./estimate";
export * from "./intake";
export * from "./pipeline";
```

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/material/test/pipeline.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/material
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(material): intake, cost estimate and the program pipeline"
```

---

### Task 13: Search, the material section, and the `material` MCP server

`MaterialSearch` finds fragments by their words, summary, keywords and heading path. `materialSection` is the first message's `## Material`. The `material` MCP server asks the app over RPC, like the `data` server; in person mode it offers `material_read`, `material_search` and `material_flag`. System mode (Task 17) offers only the tools the stage names. `use.ts` holds what those three tools do to a store, so the app's handler (Task 15) stays small.

**Files:**
- Create: `packages/material/src/search.ts`, `packages/material/src/context.ts`, `packages/material/src/use.ts`, `packages/material/src/server.ts`, `packages/material/src/server-bin.ts`, `packages/material/src/launch.ts`
- Modify: `packages/material/src/index.ts`, `packages/material/package.json`
- Test: `packages/material/test/use.test.ts`, `packages/material/test/server.test.ts` (new)

- [ ] **Step 1: Add the dependency**

Run: `corepack pnpm --filter @humanharness/material add minisearch`
Check: `minisearch` is `MIT`.

- [ ] **Step 2: Write the failing tests**

Create `packages/material/test/use.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Fragment, MaterialSearch, MaterialStore, type SourceEntry, flagFragment, materialSection, readForTask } from "../src";

let base: string;
let store: MaterialStore;
const frag = (n: number, md: string, extra: Partial<Fragment["meta"]> = {}): Fragment => ({
  meta: { id: `ch2-00${n}`, source: "ch2.pdf", location: `p.${n}`, path: `Fractions › Part ${n}`, summary: `Summary ${n}.`, keywords: [], tokens: 100, items: [], checks: "ok", validated: "not-reviewed", ...extra },
  md,
});
const entry: SourceEntry = { id: "ch2", scope: "fractions", path: "ch2.pdf", hash: "x", type: "pdf", family: "pdf", pages: 3, sizeBytes: 1, skippedPages: [], status: "ready", issues: [], fixes: [], estimate: 0, used: 0, fragments: [], addedAt: "2026-10-27T00:00:00.000Z" };

beforeEach(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "hh-use-"));
  store = new MaterialStore(base, "fractions");
  await store.update(() => [entry]);
  await store.writeFragments("ch2", [frag(1, "Equivalent fractions name the same amount."), frag(2, "Simplify by dividing both terms.", { keywords: ["simplificar"] }), frag(3, "Mixed numbers.")]);
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("MaterialSearch", () => {
  it("finds by words, keywords and prefixes; ranks; caps", async () => {
    const s = MaterialSearch.of(await store.fragments());
    expect(s.search("equivalent").map((h) => h.id)).toEqual(["ch2-001"]);
    expect(s.search("simplificar").map((h) => h.id)).toEqual(["ch2-002"]);
    expect(s.search("simpl")[0].id).toBe("ch2-002");
    expect(s.search("nothing here at all")).toEqual([]);
  });
});

describe("readForTask and flagFragment", () => {
  it("reads a fragment with where it comes from; counts the use", async () => {
    expect(await readForTask(store, "ch2-002")).toBe("[[frag:ch2-002]] ch2.pdf, p.2 (Fractions › Part 2)\n\nSimplify by dividing both terms.");
    expect((await store.source("ch2"))?.used).toBe(1);
    expect(await readForTask(store, "ch2-009")).toBeNull();
    expect(await readForTask(store, "../x")).toBeNull();
  });

  it("a flag leaves the fragment out of the index and sends its source back to review", async () => {
    expect(await flagFragment(store, "ch2-001", "The table is broken")).toBe(true);
    expect((await store.readFragment("ch2-001"))?.meta.validated).toBe("pending");
    expect((await store.indexRows()).map((r) => r.id)).toEqual(["ch2-002", "ch2-003"]);
    expect(await store.source("ch2")).toMatchObject({ status: "validating", stage: "review", issues: ["Flagged in use: ch2-001: The table is broken"] });
    expect(await flagFragment(store, "nope-001", "x")).toBe(false);
  });
});

describe("materialSection (§9 Load)", () => {
  it("the grounding rule, how to fetch, the sheet, then index rows within the budget", async () => {
    const rows = await store.indexRows();
    const text = materialSection({ mode: "strict", sheet: "## Key terms\n- fraction", rows, budgetTokens: 600 });
    expect(text.startsWith("## Material\n\n")).toBe(true);
    expect(text).toContain("Answer from the material only");
    expect(text).toContain("material_read");
    expect(text).toContain("[[frag:<id>]]");
    expect(text).toContain("## Key terms");
    expect(text).toContain("| ch2-001 | ch2.pdf, p.1 | Fractions › Part 1 |  | Summary 1. |");
    const small = materialSection({ mode: "mixed", sheet: "", rows, budgetTokens: 100 });
    expect(small).toContain("Prefer the material");
    expect(small).toMatch(/\d+ more fragments: find them with `material_search`\./);
  });

  it("nothing usable: no section", () => {
    expect(materialSection({ mode: "mixed", sheet: "", rows: [], budgetTokens: 600 })).toBe("");
  });
});
```

Create `packages/material/test/server.test.ts`:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { type Rpc, devLauncher, openRpc } from "@humanharness/blocks";
import { afterEach, describe, expect, it } from "vitest";
import { materialServerSpec } from "../src";

let rpc: Rpc | undefined;
let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  await rpc?.close();
  client = undefined;
  rpc = undefined;
});

async function connect(handler: (r: unknown) => Promise<unknown>, mode: "person" | "system" = "person", tools: string[] = []) {
  rpc = await openRpc(handler);
  const spec = materialServerSpec({ rpc: { path: rpc.path, token: rpc.token }, launcher: devLauncher(), mode, tools });
  expect(spec.name).toBe("material");
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: spec.command, args: spec.args, env: { ...(process.env as Record<string, string>), ...spec.env } }));
  return client;
}

describe("material MCP server", () => {
  it("person mode: read, search and flag, each sent to the app", async () => {
    const seen: unknown[] = [];
    const c = await connect(async (r) => {
      seen.push(r);
      return (r as { op: string }).op === "read" ? "[[frag:a-001]] a.pdf, p.1\n\nText" : [{ id: "a-001", where: "a.pdf, p.1", summary: "S." }];
    });
    expect((await c.listTools()).tools.map((t) => t.name).sort()).toEqual(["material_flag", "material_read", "material_search"]);
    const read = await c.callTool({ name: "material_read", arguments: { id: "a-001" } });
    expect((read.content as { text: string }[])[0].text).toContain("Text");
    await c.callTool({ name: "material_search", arguments: { query: "fractions" } });
    await c.callTool({ name: "material_flag", arguments: { id: "a-001", reason: "Broken table" } });
    expect(seen).toEqual([{ op: "read", id: "a-001" }, { op: "search", query: "fractions" }, { op: "flag", id: "a-001", reason: "Broken table" }]);
  });

  it("a refusal comes back as a tool error", async () => {
    const c = await connect(async () => {
      throw new Error("This task has no material");
    });
    const r = await c.callTool({ name: "material_read", arguments: { id: "a-001" } });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0].text).toBe("Refused: This task has no material");
  });

  it("system mode with no stage tools offers only reading", async () => {
    const c = await connect(async () => null, "system", []);
    expect((await c.listTools()).tools.map((t) => t.name)).toEqual(["material_read"]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `corepack pnpm vitest run packages/material/test/use.test.ts packages/material/test/server.test.ts`
Expected: FAIL (`MaterialSearch` is not exported).

- [ ] **Step 4: Write search, use and the section**

Create `packages/material/src/search.ts`:

```ts
import MiniSearch from "minisearch";
import type { Fragment } from "./types";

export interface SearchHit {
  id: string;
  where: string;
  path: string;
  summary: string;
}

/** Search over one scope's fragments (§9 Fetch): text, summary, keywords and heading path; prefix and fuzzy matches. */
export class MaterialSearch {
  private constructor(private readonly index: MiniSearch<{ id: string; md: string; summary: string; keywords: string; path: string; where: string }>) {}

  /** Built per call: a scope holds hundreds of fragments at most, and a hand edit shows at once. */
  static of(fragments: Fragment[]): MaterialSearch {
    const index = new MiniSearch({
      fields: ["md", "summary", "keywords", "path"],
      storeFields: ["where", "path", "summary"],
      searchOptions: { boost: { keywords: 3, summary: 2, path: 2 }, prefix: true, fuzzy: 0.2 },
    });
    index.addAll(fragments.filter((f) => f.meta.validated !== "pending").map((f) => ({ id: f.meta.id, md: f.md, summary: f.meta.summary, keywords: f.meta.keywords.join(" "), path: f.meta.path, where: `${f.meta.source}, ${f.meta.location}` })));
    return new MaterialSearch(index);
  }

  search(query: string, limit = 8): SearchHit[] {
    return this.index
      .search(query.slice(0, 200))
      .slice(0, limit)
      .map((r) => ({ id: String(r.id), where: String(r.where), path: String(r.path), summary: String(r.summary) }));
  }
}
```

Create `packages/material/src/use.ts`:

```ts
import { isFragmentId } from "./fragment";
import type { MaterialStore } from "./store";

/** `material_read` (§9 Fetch): the fragment with its citation and where it comes from; counts the source's use. */
export async function readForTask(store: MaterialStore, id: string): Promise<string | null> {
  if (!isFragmentId(id)) return null;
  const f = await store.readFragment(id);
  if (!f) return null;
  const owner = (await store.sources()).find((s) => s.fragments.includes(id));
  if (!owner) return null;
  await store.patch(owner.id, (s) => ({ ...s, used: s.used + 1 }));
  return `[[frag:${id}]] ${f.meta.source}, ${f.meta.location}${f.meta.path ? ` (${f.meta.path})` : ""}\n\n${f.md}`;
}

/**
 * `material_flag` (§6.2 "Flags during use"): the fragment goes `pending` (out of the index) and its source back to
 * the review stage, which the queue picks up after the person's turn.
 */
export async function flagFragment(store: MaterialStore, id: string, reason: string): Promise<boolean> {
  if (!isFragmentId(id)) return false;
  const owner = (await store.sources()).find((s) => s.fragments.includes(id));
  if (!owner || !(await store.patchFragment(id, (m) => ({ ...m, validated: "pending" })))) return false;
  const line = `Flagged in use: ${id}: ${reason.replace(/\s+/g, " ").trim().slice(0, 200)}`;
  await store.patch(owner.id, (s) => ({ ...s, status: "validating", stage: "review", issues: [...s.issues, line] }));
  await store.writeIndex();
  return true;
}
```

Create `packages/material/src/context.ts`:

```ts
import type { GroundingMode } from "@humanharness/harness-sdk";
import { estimateTokens } from "@humanharness/workspace";
import type { IndexRow } from "./store";

/** The grounding rule of each mode (§9 Ground), in the task's first message: the mode is per scope. */
export const GROUNDING_RULES: Record<GroundingMode, string> = {
  strict: "Answer from the material only. When it doesn't cover something, say so; don't fill the gap from your own knowledge.",
  mixed: "Prefer the material. You may add your own knowledge; say when you do.",
};

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();

/**
 * The first message's `## Material` (§9 Load): the scope's rule, how to fetch, the sheet, then index rows until
 * `budgetTokens`; the rest is found with `material_search`. Empty when nothing is usable.
 */
export function materialSection(o: { mode: GroundingMode; sheet: string; rows: IndexRow[]; budgetTokens: number }): string {
  if (o.rows.length === 0) return "";
  const head = [
    "## Material",
    "",
    `The person's own material for this scope. ${GROUNDING_RULES[o.mode]}`,
    "Fetch a fragment with `material_read` (its id), find more with `material_search`. Cite what you use as [[frag:<id>]].",
  ].join("\n");
  const table = ["| id | where | path | kind | summary |", "|---|---|---|---|---|"];
  let used = estimateTokens(table.join("\n"));
  let shown = 0;
  for (const r of o.rows) {
    const line = `| ${r.id} | ${cell(r.where)} | ${cell(r.path)} | ${cell(r.kind)} | ${cell(r.summary)} |`;
    const cost = estimateTokens(line);
    if (shown > 0 && used + cost > o.budgetTokens) break;
    table.push(line);
    used += cost;
    shown++;
  }
  const more = o.rows.length - shown;
  return [head, o.sheet.trim(), table.join("\n"), more > 0 ? `${more} more fragments: find them with \`material_search\`.` : ""].filter(Boolean).join("\n\n");
}
```

- [ ] **Step 5: Write the server and its launch spec**

Create `packages/material/src/server.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RpcRefused, callRpc } from "@humanharness/blocks";
import { z } from "zod";

/** A tool only the AI stages get (system mode): its name, what it says, and its input (Tasks 18–23 add theirs). */
export interface StageTool {
  description: string;
  input: z.ZodRawShape;
}

/** Filled by `stages.ts` (Task 17 on); empty until then. */
export const STAGE_TOOLS: Record<string, StageTool> = {};

const ID = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}-\d{3,4}$/);

/**
 * The `material` MCP server (§9, §10). Person mode: a task's `material_read`, `material_search`, `material_flag`
 * (and `material_conflict`, Task 24). System mode: `material_read` plus the stage's own tools. Every call goes to the
 * app over `rpc` as `{ op, ...args }`; a refusal comes back as a tool error.
 */
export function createMaterialServer(rpc: { path: string; token: string }, mode: "person" | "system", tools: readonly string[]): McpServer {
  const server = new McpServer({ name: "material", version: "0.1.0" });
  const call = (op: string) => async (args: Record<string, unknown>) => {
    try {
      const result = await callRpc(rpc, { op, ...args }, 60_000);
      return { content: [{ type: "text" as const, text: typeof result === "string" ? result : JSON.stringify(result) }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const text = e instanceof RpcRefused ? `Refused: ${message}` : `Could not reach the app (${message}). Do not retry in a loop.`;
      return { isError: true, content: [{ type: "text" as const, text }] };
    }
  };
  server.registerTool(
    "material_read",
    { description: "Reads one fragment of the person's material by its id (from the index or a search). Cite it as [[frag:<id>]].", inputSchema: { id: ID } },
    call("read"),
  );
  if (mode === "person") {
    server.registerTool(
      "material_search",
      { description: "Searches the person's material in this task's scope. Returns up to 8 fragments: id, where, path, summary.", inputSchema: { query: z.string().min(1).max(200) } },
      call("search"),
    );
    server.registerTool(
      "material_flag",
      { description: "Reports a fragment that reads wrong (garbled, cut, a broken table). It is checked again later.", inputSchema: { id: ID, reason: z.string().min(1).max(300) } },
      call("flag"),
    );
  }
  if (mode === "system") {
    for (const name of tools) {
      if (!Object.hasOwn(STAGE_TOOLS, name)) continue;
      const t = STAGE_TOOLS[name];
      server.registerTool(name, { description: t.description, inputSchema: t.input }, call(name));
    }
  }
  return server;
}
```

Create `packages/material/src/server-bin.ts`:

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMaterialServer } from "./server";
import "./stages";

try {
  const rpcPath = process.env.HH_RPC;
  const token = process.env.HH_RPC_TOKEN;
  const mode = process.env.HH_MATERIAL_MODE === "system" ? "system" : "person";
  const tools = (process.env.HH_MATERIAL_TOOLS ?? "").split(",").filter(Boolean);
  if (!rpcPath || !token) {
    console.error("HH_RPC and HH_RPC_TOKEN are required");
    process.exit(2);
  }
  await createMaterialServer({ path: rpcPath, token }, mode, tools).connect(new StdioServerTransport());
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
```

Create `packages/material/src/stages.ts` (Task 17 fills it; the import above registers its tools):

```ts
// The AI stages' tools and prompts (Tasks 17–23).
export {};
```

Create `packages/material/src/launch.ts`:

```ts
import { fileURLToPath } from "node:url";
import type { Launcher, McpServerSpec } from "@humanharness/blocks";

/** The `material` MCP server (§9, §10): its tools ask the app over `rpc`. */
export function materialServerSpec(o: {
  rpc: { path: string; token: string };
  launcher: Launcher;
  mode: "person" | "system";
  /** System mode: the stage's tools. */
  tools?: readonly string[];
  /** Built entry (app); defaults to the TS source (dev). */
  entry?: string;
}): McpServerSpec {
  const entry = o.entry ?? fileURLToPath(new URL("./server-bin.ts", import.meta.url));
  return {
    name: "material",
    command: o.launcher.command,
    args: [...o.launcher.args, entry],
    env: { ...o.launcher.env, HH_RPC: o.rpc.path, HH_RPC_TOKEN: o.rpc.token, HH_MATERIAL_MODE: o.mode, HH_MATERIAL_TOOLS: (o.tools ?? []).join(",") },
  };
}
```

Add `zod` is already a dependency (Task 2). Add to `packages/material/src/index.ts`:

```ts
export * from "./search";
export * from "./use";
export * from "./context";
export * from "./server";
export * from "./launch";
export * from "./stages";
```

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/material/test/use.test.ts packages/material/test/server.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/material pnpm-lock.yaml
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(material): search, the material section and the material MCP server"
```

---

## Phase 2 — The app (spec §12 slice 1, continued)

### Task 14: The app: `MaterialService`, IPC, the client contract

The main process gets one `MaterialService`, built only when the harness has `material`. It works in the current base (`baseOf`: the active profile's folder), checks the scope, adds files from the main process's file dialog and links through `fetchLink`, and sends each change to the window as `hh:materialStatus`. The window gets `AppState.material` and `client.material`.

**Files:**
- Create: `packages/shell/src/main/material.ts`, `packages/shell/src/main/material-fetch.ts`
- Modify: `packages/shell/src/main/index.ts`, `packages/shell/src/preload/index.ts`, `packages/shell/package.json`, `packages/shell/electron.vite.config.ts`, `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts`
- Test: `packages/shell/test/material.test.ts`, `packages/shell/test/material-fetch.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `packages/shell/test/material-fetch.test.ts`:

```ts
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchLink } from "../src/main/material-fetch";

let server: http.Server;
let url: string;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/page") return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<html><head><title>Halves</title></head><body><p>Hi</p></body></html>");
    if (req.url === "/doc.pdf") return res.writeHead(200, { "content-type": "application/pdf" }).end("%PDF-1.4");
    if (req.url === "/big") return res.writeHead(200, { "content-type": "text/html", "content-length": String(10 ** 9) }).end("x");
    if (req.url === "/cookie") return res.writeHead(200, { "content-type": "text/plain" }).end(String(req.headers.cookie ?? "none"));
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe("fetchLink (§3 Web)", () => {
  it("a page is saved as <slug>.html, a PDF as .pdf", async () => {
    expect(await fetchLink(`${url}/page`)).toMatchObject({ ok: true, name: "127-0-0-1-page.html", url: `${url}/page` });
    expect(await fetchLink(`${url}/doc.pdf`)).toMatchObject({ ok: true, name: "127-0-0-1-doc-pdf.pdf" });
  });
  it("only http and https; errors, oversize and timeouts are refusals", async () => {
    expect(await fetchLink("file:///etc/passwd")).toEqual({ ok: false });
    expect(await fetchLink("javascript:alert(1)")).toEqual({ ok: false });
    expect(await fetchLink(`${url}/missing`)).toEqual({ ok: false });
    expect(await fetchLink(`${url}/big`)).toEqual({ ok: false });
  });
  it("sends no cookies", async () => {
    const r = await fetchLink(`${url}/cookie`);
    expect(r.ok && r.data.toString()).toBe("none");
  });
});
```

Create `packages/shell/test/material.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MaterialService } from "../src/main/material";

let root: string;
let base: string;
let picked: string[] | null;
const sent: unknown[] = [];
let service: MaterialService;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-mat-"));
  base = path.join(root, "anna");
  fs.mkdirSync(base);
  picked = null;
  sent.length = 0;
  service = new MaterialService({
    material: { accepts: ["text", "pdf"], items: false, grounding: { default: "mixed", personCanChange: true }, budget: { indexTokens: 600 } },
    base: async () => base,
    scopeOk: async (s) => s === "fractions",
    pickFiles: async () => picked,
    fetchLink: async () => ({ ok: false }),
    send: (channel, value) => sent.push([channel, value]),
    provider: async () => "Anthropic",
    window: async () => null,
    afterChange: async () => {},
  });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("MaterialService", () => {
  it("adds a picked file to the scope, in the base, and sends the scope's view", async () => {
    const file = path.join(root, "Fractions.md");
    fs.writeFileSync(file, `# Fractions\n\n${"A fraction names a part. ".repeat(40)}`);
    picked = [file];
    expect(await service.add("fractions")).toEqual({ ok: true, added: ["fractions"], refused: [] });
    expect(fs.existsSync(path.join(base, "material", "fractions", "Fractions.md"))).toBe(true);
    const view = await service.list("fractions");
    expect(view).toMatchObject({ scope: "fractions", grounding: { mode: "mixed", canChange: true }, provider: "Anthropic" });
    expect(view.sources[0]).toMatchObject({ id: "fractions", name: "Fractions.md", status: "validating", stage: "review" });
    expect(sent.at(-1)).toEqual(["hh:materialStatus", view]);
  });

  it("refused files come back with their message; nothing is kept", async () => {
    const file = path.join(root, "song.mp3");
    fs.writeFileSync(file, "ID3....");
    picked = [file];
    expect(await service.add("fractions")).toEqual({ ok: true, added: [], refused: [{ name: "song.mp3", message: expect.stringContaining("") }] });
    expect(fs.existsSync(path.join(base, "material"))).toBe(false);
  });

  it("unknown scopes, `_app` and a cancelled dialog", async () => {
    expect(await service.add("other")).toEqual({ ok: false, reason: "unknown-scope" });
    expect(await service.add("_app")).toEqual({ ok: false, reason: "unknown-scope" });
    expect(await service.add("fractions")).toEqual({ ok: true, added: [], refused: [] });
  });

  it("a profile switch changes the base: each profile sees its own material", async () => {
    const file = path.join(root, "a.md");
    fs.writeFileSync(file, "# A\n\nText.");
    picked = [file];
    await service.add("fractions");
    base = path.join(root, "ben");
    fs.mkdirSync(base);
    expect((await service.list("fractions")).sources).toEqual([]);
  });

  it("the grounding mode is per scope, and only when the person may change it", async () => {
    expect(await service.setGrounding("fractions", "strict")).toEqual({ ok: true });
    expect((await service.list("fractions")).grounding.mode).toBe("strict");
    expect(await service.setGrounding("fractions", "loose" as never)).toEqual({ ok: false, reason: "invalid" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm vitest run packages/shell/test/material.test.ts packages/shell/test/material-fetch.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write `fetchLink`**

Create `packages/shell/src/main/material-fetch.ts`:

```ts
import { FETCH_TIMEOUT_MS, MAX_BYTES, sourceSlug } from "@humanharness/material";

export type Fetched = { ok: true; name: string; data: Buffer; url: string; fetchedAt: string } | { ok: false };

/**
 * A link the person adds (§3 Web): fetched once, now, with Node's `fetch` (never the window's session, so no cookies),
 * only over http(s), at most MAX_BYTES and FETCH_TIMEOUT_MS. The page is kept as the original (`<slug>.html`, or
 * `.pdf` when the link serves a PDF) so reprocessing works offline.
 */
export async function fetchLink(raw: string, now = new Date()): Promise<Fetched> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow", credentials: "omit", headers: { accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5" } });
    if (!res.ok || !res.body) return { ok: false };
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return { ok: false };
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > MAX_BYTES) return { ok: false };
      chunks.push(Buffer.from(chunk));
    }
    const pdf = (res.headers.get("content-type") ?? "").includes("application/pdf");
    const slug = sourceSlug(`${url.host}${url.pathname}`.replace(/\./g, "-"), new Set());
    return { ok: true, name: `${slug}.${pdf ? "pdf" : "html"}`, data: Buffer.concat(chunks), url: url.toString(), fetchedAt: now.toISOString() };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}
```

A fetched HTML page goes through `readablePage` (Task 8): in `MaterialService.addLink`, the `html` original is converted with the readability pass by passing `url` to `addSource`; `convertFile` reads `.html` with `htmlBlocks` for files. Make the difference explicit in `packages/material/src/convert/index.ts`: add `link?: boolean` to `ConvertOptions` and use `readablePage(decodeText(buf)).blocks` when `type === "html" && opts.link`; in `pipeline.ts` pass `link: s.url !== undefined` to `convertFile` and to `measureFile` (add the same parameter there). Add a test to `packages/material/test/pipeline.test.ts`:

```ts
  it("a link's page is read with readability; a saved page as a whole", async () => {
    const html = `<html><head><title>T</title></head><body><nav>Menu item</nav><article><h1>T</h1>${"<p>Real content sentence about fractions here.</p>".repeat(12)}</article></body></html>`;
    const r = await addSource(store, { name: "t.html", data: Buffer.from(html), url: "https://example.org/t" }, { accepts: ["web"], items: false });
    if (!r.ok) throw new Error("unreachable");
    expect((await store.fragments()).map((f) => f.md).join("\n")).not.toContain("Menu item");
  });
```

- [ ] **Step 4: Write `MaterialService`**

Create `packages/shell/src/main/material.ts`:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import type { GroundingMode, HarnessMaterial } from "@humanharness/harness-sdk";
import { GROUNDING_MODES } from "@humanharness/harness-sdk";
import { type MaterialStore as Store, MaterialStore, type SourceEntry, addSource, confirmSource, isFragmentId, isSourceId } from "@humanharness/material";
import { APP_SCOPE, isScopeId } from "@humanharness/workspace";
import type { Fetched } from "./material-fetch";

/** One source as the window shows it (§11). */
export interface MaterialSourceView {
  id: string;
  name: string;
  url?: string;
  status: SourceEntry["status"];
  stage?: SourceEntry["stage"];
  notice?: SourceEntry["notice"];
  refusal?: SourceEntry["refusal"];
  pages: number;
  rows?: number;
  pageRange?: [number, number];
  estimate: number;
  issues: string[];
  fixes: string[];
  fragments: number;
  verdict?: SourceEntry["verdict"];
  failed: boolean;
}

export interface MaterialView {
  scope: string;
  sources: MaterialSourceView[];
  grounding: { mode: GroundingMode; canChange: boolean };
  /** The engine's provider, for the privacy line (§13.3). */
  provider: string;
  /** The engine's usage window now, when it reports one (§7). */
  window: { kind: string; utilization: number } | null;
  /** Items with no fragment (Task 23); absent without `items`. */
  uncovered?: string[];
}

export type MaterialResult = { ok: true } | { ok: false; reason: "not-ready" | "unknown-scope" | "unknown-source" | "invalid" | "fetch" };
export type AddResult = { ok: true; added: string[]; refused: { name: string; message: string }[] } | { ok: false; reason: "not-ready" | "unknown-scope" | "fetch" };

export interface MaterialDeps {
  material: Pick<HarnessMaterial, "accepts" | "items" | "grounding" | "budget">;
  /** The current base (the active profile's folder, or the folder); null when the app isn't set up. */
  base(): Promise<string | null>;
  /** Registered and not archived (`main` without scopes). `_app` is never asked. */
  scopeOk(scope: string): Promise<boolean>;
  /** The main process's open dialog; null when cancelled. */
  pickFiles(): Promise<string[] | null>;
  fetchLink(url: string): Promise<Fetched>;
  send(channel: string, value: unknown): void;
  provider(): Promise<string>;
  window(): Promise<{ kind: string; utilization: number } | null>;
  /** After a change on disk: the queue looks for work (Task 17), the history records it. */
  afterChange(scope: string, what: string): Promise<void>;
}

const view = (s: SourceEntry): MaterialSourceView => ({
  id: s.id,
  name: s.path,
  ...(s.url ? { url: s.url } : {}),
  status: s.status,
  ...(s.stage ? { stage: s.stage } : {}),
  ...(s.notice ? { notice: s.notice } : {}),
  ...(s.refusal ? { refusal: s.refusal } : {}),
  pages: s.pages,
  ...(s.rows !== undefined ? { rows: s.rows } : {}),
  ...(s.pageRange ? { pageRange: s.pageRange } : {}),
  estimate: s.estimate,
  issues: s.issues,
  fixes: s.fixes,
  fragments: s.fragments.length,
  ...(s.verdict ? { verdict: s.verdict } : {}),
  failed: s.failed !== undefined,
});

/**
 * The person's material (material spec §10, §11), in whatever base is current: with profiles each profile's folder
 * holds its own, and nothing here caches a base. Changes are sent to the window as `hh:materialStatus`.
 */
export class MaterialService {
  constructor(private readonly d: MaterialDeps) {}

  /** The store of a scope in the current base, or why not. */
  async store(scope: unknown): Promise<Store | "not-ready" | "unknown-scope"> {
    if (typeof scope !== "string" || scope === APP_SCOPE || !isScopeId(scope)) return "unknown-scope";
    const base = await this.d.base();
    if (!base) return "not-ready";
    if (!(await this.d.scopeOk(scope))) return "unknown-scope";
    return new MaterialStore(base, scope);
  }

  async list(scope: string): Promise<MaterialView> {
    const store = await this.store(scope);
    const sources = typeof store === "string" ? [] : await store.sources();
    const chosen = typeof store === "string" ? null : await store.grounding();
    return {
      scope,
      sources: sources.filter((s) => s.status !== "removed").map(view),
      grounding: { mode: chosen ?? this.d.material.grounding.default, canChange: this.d.material.grounding.personCanChange },
      provider: await this.d.provider(),
      window: await this.d.window(),
    };
  }

  /** Sends the scope's view to the window. */
  async changed(scope: string): Promise<void> {
    this.d.send("hh:materialStatus", await this.list(scope));
  }

  private async measured() {
    return undefined; // Task 25: the averages measured in usage.jsonl.
  }

  /** `client.material.add(scope)`: the file dialog, then intake of each file (§3, §7). */
  async add(scope: unknown): Promise<AddResult> {
    const store = await this.store(scope);
    if (typeof store === "string") return { ok: false, reason: store };
    const files = (await this.d.pickFiles()) ?? [];
    const added: string[] = [];
    const refused: { name: string; message: string }[] = [];
    for (const file of files) {
      const name = path.basename(file);
      const data = await fs.readFile(file).catch(() => null);
      if (!data) {
        refused.push({ name, message: "This file couldn't be read." });
        continue;
      }
      const measured = await this.measured();
      const r = await addSource(store, { name, data }, { accepts: this.d.material.accepts, items: this.d.material.items !== undefined, ...(measured ? { measured } : {}) });
      if (r.ok) added.push(r.id);
      else refused.push({ name, message: r.message });
    }
    if (added.length > 0) await this.d.afterChange(store.scope, `added ${added.join(", ")}`);
    await this.changed(store.scope);
    return { ok: true, added, refused };
  }

  /** `client.material.addLink(scope, url)`: fetched now, then intake like a file (§3 Web). */
  async addLink(scope: unknown, url: unknown): Promise<AddResult> {
    const store = await this.store(scope);
    if (typeof store === "string") return { ok: false, reason: store };
    if (typeof url !== "string" || url.length > 2048) return { ok: false, reason: "fetch" };
    const page = await this.d.fetchLink(url);
    if (!page.ok) return { ok: false, reason: "fetch" };
    const r = await addSource(store, page, { accepts: this.d.material.accepts, items: this.d.material.items !== undefined });
    if (r.ok) await this.d.afterChange(store.scope, `added ${r.id}`);
    await this.changed(store.scope);
    return r.ok ? { ok: true, added: [r.id], refused: [] } : { ok: true, added: [], refused: [{ name: page.name, message: r.message }] };
  }

  /** The person's answer to a waiting source (§7). */
  async confirm(scope: unknown, id: unknown, choice: unknown): Promise<MaterialResult> {
    const store = await this.store(scope);
    if (typeof store === "string") return { ok: false, reason: store };
    if (!isSourceId(id)) return { ok: false, reason: "unknown-source" };
    const c = typeof choice === "object" && choice !== null ? (choice as Record<string, unknown>) : {};
    const range = Array.isArray(c.pageRange) && c.pageRange.length === 2 && c.pageRange.every((n) => Number.isInteger(n) && (n as number) >= 1) ? (c.pageRange as [number, number]) : undefined;
    const sheets = c.sheets === "summary" ? "summary" : Array.isArray(c.sheets) && c.sheets.every((s) => typeof s === "string") ? (c.sheets as string[]) : undefined;
    const measured = await this.measured();
    const next = await confirmSource(store, id, { ...(range ? { pageRange: range } : {}), ...(sheets ? { sheets } : {}) }, { items: this.d.material.items !== undefined, ...(measured ? { measured } : {}) });
    if (!next) return { ok: false, reason: "invalid" };
    await this.d.afterChange(store.scope, `processed ${id}`);
    await this.changed(store.scope);
    return { ok: true };
  }

  /** §9 Ground: the scope's mode, when the harness lets the person change it. */
  async setGrounding(scope: unknown, mode: unknown): Promise<MaterialResult> {
    const store = await this.store(scope);
    if (typeof store === "string") return { ok: false, reason: store };
    if (!this.d.material.grounding.personCanChange || typeof mode !== "string" || !(GROUNDING_MODES as readonly string[]).includes(mode)) return { ok: false, reason: "invalid" };
    await store.setGrounding(mode as GroundingMode);
    await this.d.afterChange(store.scope, `grounding ${mode}`);
    await this.changed(store.scope);
    return { ok: true };
  }

  /**
   * The original a citation or a source line points at (§9): its path, only when it is a file inside the scope's
   * `material/` folder. The caller opens it.
   */
  async originalOf(scope: unknown, id: unknown): Promise<string | null> {
    const store = await this.store(scope);
    if (typeof store === "string") return null;
    const sources = await store.sources();
    const s = isSourceId(id) ? sources.find((x) => x.id === id) : isFragmentId(id) ? sources.find((x) => x.fragments.includes(id)) : undefined;
    const file = s ? store.originalPath(s.path) : null;
    if (!file) return null;
    const stat = await fs.lstat(file).catch(() => null);
    return stat?.isFile() ? file : null;
  }
}
```

`isSourceId` and `isFragmentId` come from `fragment.ts` (Task 7); `GROUNDING_MODES` and `HarnessMaterial` from `material.ts` (Task 1).

- [ ] **Step 5: Run the service tests**

Run: `corepack pnpm vitest run packages/shell/test/material.test.ts packages/shell/test/material-fetch.test.ts packages/material/test/pipeline.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire it into the main process**

In `packages/shell/package.json` `dependencies`, add `"@humanharness/material": "workspace:*"` and `"pdfjs-dist"` with the same version as `packages/material/package.json` (`pdfjs-dist` stays external: its worker module is loaded at run time, Task 9). Run `corepack pnpm install`.

In `packages/shell/electron.vite.config.ts`:
- add `"@humanharness/material"` to `workspacePackages`;
- add the entry `"material-server": path.join(__dirname, "../material/src/server-bin.ts"),` after `"data-server"`.

In `packages/shell/src/main/index.ts`:

1. Imports:

```ts
import { hasMaterial } from "@humanharness/harness-sdk";
import { MATERIAL_KEEP } from "@humanharness/workspace";
import { MaterialService } from "./material";
import { fetchLink } from "./material-fetch";
```

(`hasMaterial` joins the existing `@humanharness/harness-sdk` import; `MATERIAL_KEEP` the existing `@humanharness/workspace` import.)

2. After `const scoped = …`, the keep list every history uses, so a harness without material keeps today's list (D0):

```ts
/** What the history keeps under `.harness/`: notes and data; with material, its registry and decisions (spec §4). */
const historyKeep = () => [NOTES_PREFIX, DATA_PREFIX, ...(hasMaterial(harness) ? [MATERIAL_KEEP] : [])];
```

Replace `[NOTES_PREFIX, DATA_PREFIX]` in `standaloneHistory` with `historyKeep()`.

3. After `const tasks = new TaskManager({…});`, the service (null without material, D0):

```ts
/** The person's material (material spec); null without `material` (D0). Built once the harness is loaded. */
let materialSvc: MaterialService | null = null;

function buildMaterial(): MaterialService | null {
  const m = harness.material;
  if (!m) return null;
  return new MaterialService({
    material: m,
    base: async () => {
      const c = await validConfig();
      return c ? baseOf(c) : null;
    },
    scopeOk: async (scope) => (scoped() ? activeScope(scope) : scope === MAIN_SCOPE),
    pickFiles: async () => {
      if (!window) return null;
      const r = await dialog.showOpenDialog(window, { properties: ["openFile", "multiSelections"] });
      return r.canceled ? null : r.filePaths;
    },
    fetchLink: (url) => fetchLink(url),
    send: sendToWindow,
    provider: async () => getEngine((await config.load()).engineId).provider,
    window: async () => {
      const c = await validConfig();
      if (!c) return null;
      const last = (await new UsageLog(baseOf(c)).load(50)).filter((r) => r.limits?.length).at(-1);
      const w = last?.limits?.[0];
      return w && Date.parse(w.resetsAt) > Date.now() ? { kind: w.kind, utilization: w.utilization } : null;
    },
    afterChange: async (scope, what) => {
      const history = await currentHistory();
      await history?.save(`Material: ${what}`, await tasks.trailerNow()).catch((err: unknown) => console.error("Could not record the material change", err));
    },
  });
}
```

`EngineDef.provider` is the provider's name ("Anthropic", "OpenAI").

Call `materialSvc = buildMaterial();` right after `profilesCtl = new Profiles({…})`, where the other controllers are built once the harness is loaded.

4. In `registerIpc()`, after the profiles handlers:

```ts
  // The person's material (material spec §10). Answers are data; without material every call is "not-ready" (D0).
  const noMaterial = { ok: false, reason: "not-ready" } as const;
  handle("hh:materialList", async (scope: unknown) => (materialSvc && typeof scope === "string" ? materialSvc.list(scope) : null));
  handle("hh:materialAdd", (scope: unknown) => materialSvc?.add(scope) ?? noMaterial);
  handle("hh:materialAddLink", (scope: unknown, url: unknown) => materialSvc?.addLink(scope, url) ?? noMaterial);
  handle("hh:materialConfirm", (scope: unknown, id: unknown, choice: unknown) => materialSvc?.confirm(scope, id, choice) ?? noMaterial);
  handle("hh:materialGrounding", (scope: unknown, mode: unknown) => materialSvc?.setGrounding(scope, mode) ?? noMaterial);
  handle("hh:materialOpen", async (scope: unknown, id: unknown) => {
    const file = await materialSvc?.originalOf(scope, id);
    if (!file) return noMaterial;
    const error = await shell.openPath(file);
    return error ? { ok: false, reason: "invalid" } : { ok: true };
  });
```

5. In the function that builds `AppState`, after the `profiles` spread (`...(harness.profiles ? { profiles: … } : {})`), add, only with material:

```ts
    ...(harness.material
      ? { material: { accepts: harness.material.accepts, items: harness.material.items !== undefined, grounding: harness.material.grounding } }
      : {}),
```

- [ ] **Step 7: The client contract**

In `packages/ui/src/client.ts`, after the profiles types:

```ts
/** A source of the person's material as the window shows it (material spec §11). */
export interface MaterialSourceView {
  id: string;
  name: string;
  url?: string;
  status: "pending" | "converting" | "validating" | "needs-person" | "ready" | "refused" | "removed";
  stage?: "review" | "repair" | "label";
  notice?: "warn" | "max" | "rows" | "full-review" | "no-text-pages";
  refusal?: string;
  pages: number;
  rows?: number;
  pageRange?: [number, number];
  estimate: number;
  issues: string[];
  fixes: string[];
  fragments: number;
  verdict?: "good" | "usable-with-fixes" | "not-usable";
  failed: boolean;
}

export interface MaterialView {
  scope: string;
  sources: MaterialSourceView[];
  grounding: { mode: "strict" | "mixed"; canChange: boolean };
  provider: string;
  window: { kind: string; utilization: number } | null;
  uncovered?: string[];
}

/** What the harness takes (manifest `material`). Absent: no material (D0). */
export interface MaterialInfo {
  accepts: string[];
  items: boolean;
  grounding: { default: "strict" | "mixed"; personCanChange: boolean };
}

export type MaterialResult = { ok: true } | { ok: false; reason: "not-ready" | "unknown-scope" | "unknown-source" | "invalid" | "fetch" };
export type MaterialAddResult = { ok: true; added: string[]; refused: { name: string; message: string }[] } | { ok: false; reason: "not-ready" | "unknown-scope" | "fetch" };

export interface MaterialClient {
  list(scope: string): Promise<MaterialView | null>;
  add(scope: string): Promise<MaterialAddResult>;
  addLink(scope: string, url: string): Promise<MaterialAddResult>;
  confirm(scope: string, id: string, choice: { pageRange?: [number, number]; sheets?: string[] | "summary" }): Promise<MaterialResult>;
  setGrounding(scope: string, mode: "strict" | "mixed"): Promise<MaterialResult>;
  /** Opens the original of a source or a fragment's source. */
  open(scope: string, id: string): Promise<MaterialResult>;
  onChange(listener: (view: MaterialView) => void): () => void;
}
```

Add to `AppState`, after `profiles`:

```ts
  /** The harness takes the person's material (manifest `material`). Absent: none (D0). */
  material?: MaterialInfo;
```

Add to `HarnessClient`, after `profiles`: `material: MaterialClient;`.

In `packages/shell/src/preload/index.ts`, after `profiles`:

```ts
  material: {
    list: (scope) => ipcRenderer.invoke("hh:materialList", scope),
    add: (scope) => ipcRenderer.invoke("hh:materialAdd", scope),
    addLink: (scope, url) => ipcRenderer.invoke("hh:materialAddLink", scope, url),
    confirm: (scope, id, choice) => ipcRenderer.invoke("hh:materialConfirm", scope, id, choice),
    setGrounding: (scope, mode) => ipcRenderer.invoke("hh:materialGrounding", scope, mode),
    open: (scope, id) => ipcRenderer.invoke("hh:materialOpen", scope, id),
    onChange: (listener) => subscribe<MaterialView>("hh:materialStatus", listener),
  },
```

(and `MaterialView` in its `import type` list).

In `packages/ui/test/fake-client.ts`, a fake that keeps views per scope and records calls:

```ts
  /** Calls to material, in order: "add:<scope>", "link:<scope>:<url>", "confirm:<id>", "grounding:<mode>", "open:<id>". */
  materialCalls: string[] = [];
  materialViews: Record<string, MaterialView> = {};
  private materialListeners = new Set<(v: MaterialView) => void>();
  /** Pushes a view as the main process would. */
  pushMaterial(view: MaterialView) {
    this.materialViews[view.scope] = view;
    for (const l of this.materialListeners) l(view);
  }
  material = {
    list: async (scope: string) => this.materialViews[scope] ?? null,
    add: async (scope: string) => {
      this.materialCalls.push(`add:${scope}`);
      return { ok: true as const, added: [], refused: [] };
    },
    addLink: async (scope: string, url: string) => {
      this.materialCalls.push(`link:${scope}:${url}`);
      return { ok: true as const, added: [], refused: [] };
    },
    confirm: async (_scope: string, id: string) => {
      this.materialCalls.push(`confirm:${id}`);
      return { ok: true as const };
    },
    setGrounding: async (_scope: string, mode: "strict" | "mixed") => {
      this.materialCalls.push(`grounding:${mode}`);
      return { ok: true as const };
    },
    open: async (_scope: string, id: string) => {
      this.materialCalls.push(`open:${id}`);
      return { ok: true as const };
    },
    onChange: (l: (v: MaterialView) => void) => {
      this.materialListeners.add(l);
      return () => this.materialListeners.delete(l);
    },
  };
```

- [ ] **Step 8: D0 regression test**

Add to `packages/shell/test/material.test.ts`:

```ts
import { hasMaterial } from "@humanharness/harness-sdk";
import { MATERIAL_KEEP, NOTES_PREFIX, DATA_PREFIX } from "@humanharness/workspace";

describe("D0", () => {
  it("a harness without material keeps today's keep list", () => {
    const keep = (h: { material?: unknown }) => [NOTES_PREFIX, DATA_PREFIX, ...(hasMaterial(h) ? [MATERIAL_KEEP] : [])];
    expect(keep({})).toEqual([NOTES_PREFIX, DATA_PREFIX]);
    expect(keep({ material: {} })).toContain(MATERIAL_KEEP);
  });
});
```

The end-to-end check (Task 28) confirms that a harness without `material` gets no `hh:material*` traffic and no `material/` folder.

- [ ] **Step 9: Run everything**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`
Expected: PASS, and `packages/shell/out/main/material-server.js` exists.

If the main bundle fails on a library of `@humanharness/material` (a dynamic `require` in `exceljs` or `mammoth`), add that library to `packages/shell/package.json` `dependencies` with the version `@humanharness/material` uses, so electron-vite leaves it external, and note it in the commit message.

- [ ] **Step 10: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell packages/ui packages/material pnpm-lock.yaml
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): MaterialService, links, IPC and the client contract"
```

---

### Task 15: Tasks use the material: the first message, the server, `AGENTS.md`

A task in a scope with usable material gets the `## Material` section after the notes and data. The runtime adds the `material` server (person mode) and keeps `MATERIAL_KEEP`. `AGENTS.md` gets a fixed "Material" part. Each read is logged in `.harness/material-reads.jsonl`.

**Files:**
- Create: `packages/shell/src/main/material-requests.ts`
- Modify: `packages/shell/src/main/task-manager.ts`, `packages/shell/src/main/index.ts`, `packages/runtime/src/runtime.ts`, `packages/runtime/package.json`, `packages/workspace/src/instructions.ts`
- Test: `packages/shell/test/material-requests.test.ts` (new), `packages/shell/test/task-manager.test.ts`, `packages/workspace/test/instructions.test.ts`, `packages/runtime/test/runtime.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/shell/test/material-requests.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MaterialStore, type SourceEntry } from "@humanharness/material";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { personMaterialRequest } from "../src/main/material-requests";

let base: string;
const entry: SourceEntry = { id: "ch2", scope: "fractions", path: "ch2.pdf", hash: "x", type: "pdf", family: "pdf", pages: 1, sizeBytes: 1, skippedPages: [], status: "ready", issues: [], fixes: [], estimate: 0, used: 0, fragments: [], addedAt: "2026-10-27T00:00:00.000Z" };
beforeEach(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "hh-mreq-"));
  const store = new MaterialStore(base, "fractions");
  await store.update(() => [entry]);
  await store.writeFragments("ch2", [{ meta: { id: "ch2-001", source: "ch2.pdf", location: "p.1", path: "Fractions", summary: "Halves.", keywords: ["half"], tokens: 10, items: [], checks: "ok", validated: "sample" }, md: "A half is one of two equal parts." }]);
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

const deps = (scope: string | null) => ({ base: async () => base, runningTask: async () => (scope ? { id: "t1", scope } : null), now: () => new Date("2026-10-27T10:00:00.000Z") });

describe("personMaterialRequest", () => {
  it("read: the fragment, and a line in material-reads.jsonl", async () => {
    expect(await personMaterialRequest(deps("fractions"), { op: "read", id: "ch2-001" })).toContain("A half is one of two equal parts.");
    expect(fs.readFileSync(path.join(base, ".harness", "material-reads.jsonl"), "utf8")).toBe('{"at":"2026-10-27T10:00:00.000Z","task":"t1","scope":"fractions","id":"ch2-001"}\n');
  });
  it("search and flag", async () => {
    expect(await personMaterialRequest(deps("fractions"), { op: "search", query: "half" })).toEqual([{ id: "ch2-001", where: "ch2.pdf, p.1", path: "Fractions", summary: "Halves." }]);
    expect(await personMaterialRequest(deps("fractions"), { op: "flag", id: "ch2-001", reason: "cut" })).toBe("Thanks: it will be checked again.");
  });
  it("refusals: no task, `_app`, an unknown fragment, an unknown op", async () => {
    await expect(personMaterialRequest(deps(null), { op: "read", id: "ch2-001" })).rejects.toThrow("No task is running");
    await expect(personMaterialRequest(deps("_app"), { op: "read", id: "ch2-001" })).rejects.toThrow("This task has no material");
    await expect(personMaterialRequest(deps("fractions"), { op: "read", id: "ch2-009" })).rejects.toThrow("No fragment ch2-009");
    await expect(personMaterialRequest(deps("fractions"), { op: "drop" })).rejects.toThrow("Unknown request");
  });
});
```

In `packages/workspace/test/instructions.test.ts`, add:

```ts
  it("the Material part only with material (material spec §9)", () => {
    const without = managedSection({ language: "en", blocks: {} });
    expect(without).not.toContain("### Material");
    const withIt = managedSection({ language: "en", blocks: {}, material: true });
    expect(withIt).toContain("### Material");
    expect(withIt).toContain("[[frag:<id>]]");
    expect(withIt).toContain("material_conflict");
    expect(withIt).toContain("never open the files under `.harness/material/`");
  });
```

In `packages/shell/test/task-manager.test.ts`, next to the `dataContext` tests, add one that gives the deps `materialContext: async (scope) => (scope === "fractions" ? "## Material\n\nrows" : "")` and checks that a task's first message holds `## Material` after the data section, and that a manager without `materialContext` builds the same first message as before (copy the existing first-message assertion of the data test, without the hook). Follow the existing `dataContext` test's setup exactly; it shows how the first message is captured.

In `packages/runtime/test/runtime.test.ts`, add a test next to the `data` server test: with `material: { request: async () => "x" }` the transport options' `mcp` hold a server named `material` with `HH_MATERIAL_MODE: "person"`; without it, the `mcp` names are exactly what they were (the existing D0 assertion).

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm vitest run packages/shell/test/material-requests.test.ts packages/workspace/test/instructions.test.ts packages/shell/test/task-manager.test.ts packages/runtime/test/runtime.test.ts`
Expected: FAIL (module not found; `material` option unknown).

- [ ] **Step 3: The agent's requests**

Create `packages/shell/src/main/material-requests.ts`:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { MaterialSearch, MaterialStore, flagFragment, isFragmentId, readForTask } from "@humanharness/material";
import { APP_SCOPE, materialReadsFile } from "@humanharness/workspace";

/** A refusal whose message goes back to the agent. */
export class MaterialRefusal extends Error {}

export interface PersonMaterialDeps {
  base(): Promise<string | null>;
  runningTask(): Promise<{ id: string; scope: string } | null>;
  now?: () => Date;
}

/**
 * The `material` server's person-mode tools (§9 Fetch), in the running task's scope. Each read is logged as
 * `{ at, task, scope, id }` in `.harness/material-reads.jsonl`. Messages are safe for the agent; anything else is
 * logged and answered with a plain line.
 */
export async function personMaterialRequest(d: PersonMaterialDeps, request: unknown): Promise<unknown> {
  try {
    const task = await d.runningTask();
    if (!task) throw new MaterialRefusal("No task is running");
    if (task.scope === APP_SCOPE) throw new MaterialRefusal("This task has no material");
    const base = await d.base();
    if (!base) throw new MaterialRefusal("The app is not set up yet");
    const store = new MaterialStore(base, task.scope);
    const r = typeof request === "object" && request !== null ? (request as Record<string, unknown>) : {};
    if (r.op === "read") {
      const text = isFragmentId(r.id) ? await readForTask(store, r.id) : null;
      if (text === null) throw new MaterialRefusal(`No fragment ${String(r.id).slice(0, 80)}`);
      const file = materialReadsFile(base);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, `${JSON.stringify({ at: (d.now?.() ?? new Date()).toISOString(), task: task.id, scope: task.scope, id: r.id })}\n`);
      return text;
    }
    if (r.op === "search" && typeof r.query === "string") return MaterialSearch.of(await store.fragments()).search(r.query);
    if (r.op === "flag" && typeof r.reason === "string") {
      if (!(await flagFragment(store, String(r.id), r.reason))) throw new MaterialRefusal(`No fragment ${String(r.id).slice(0, 80)}`);
      return "Thanks: it will be checked again.";
    }
    throw new MaterialRefusal("Unknown request");
  } catch (err) {
    if (err instanceof MaterialRefusal) throw err;
    console.error("The agent's material request failed", err);
    throw new Error("Something went wrong with the material");
  }
}
```

- [ ] **Step 4: `AGENTS.md`**

In `packages/workspace/src/instructions.ts`:

1. In `TEXT`, after `referencesIntro`:

```ts
  material: "### Material",
  materialRules: [
    "The person's own material is cut into fragments. Your task's first message lists the ones in its scope; fetch a fragment with `material_read` and find more with `material_search`; never open the files under `.harness/material/`.",
    "Cite each fragment you use as [[frag:<id>]], right after what it supports.",
    "When the material and your own knowledge disagree, follow the material, say so once, and call `material_conflict` with the fragment, the claim and how you resolved it.",
    "If a fragment reads wrong (garbled, cut, a broken table), call `material_flag` and go on.",
  ],
```

2. `managedSection`'s options get `material?: boolean`; before `lines.push(MANAGED_END, "")`:

```ts
  // Only a harness with material gets this part (material spec D0).
  if (opts.material) lines.push("", t.material, "", ...t.materialRules.map((r) => `- ${r}`));
```

3. `InstructionsText` gets `material?: boolean` (doc: "The harness takes material: the Material part. Absent: none (D0)."), and `agentsText` passes `material: opts.material` to `managedSection`.

- [ ] **Step 5: The runtime**

In `packages/runtime/package.json` `dependencies`, add `"@humanharness/material": "workspace:*"`.

In `packages/runtime/src/runtime.ts`:

1. Import `materialServerSpec` from `@humanharness/material`, `hasMaterial` from `@humanharness/harness-sdk`, `MATERIAL_KEEP` from `@humanharness/workspace`.

2. In `RuntimeOptions`, after `data`:

```ts
  /**
   * Answers the `material` server's tools (material spec §9) for the running task. Only with `material` in the
   * manifest; absent: no `material` server, no Material part in AGENTS.md, the same history keep list (D0).
   */
  material?: { request: (request: unknown) => Promise<unknown>; entry?: string };
```

3. In `createRuntime`:
- `const material = opts.material && hasMaterial(harness) ? opts.material : undefined;`
- pass `...(material ? { material: true } : {})` to `writeInstructions` and, in `refreshInstructions`, to the `refreshInstructions({...})` call;
- the history: `new History(folder, opts.gitdir, [".harness/", ...generated], [NOTES_PREFIX, DATA_PREFIX, ...(material ? [MATERIAL_KEEP] : [])])`;
- open a second RPC next to `rpc`: `let materialRpc: Rpc | null = null;` and in the `try`, `if (material) materialRpc = await openRpc(material.request);`; close it in the `catch` and in `close()` (after `rpc?.close()`, in its own `finally`);
- `buildRuntime(bridge, rpc, materialRpc)`, and in `mcp`, after the data server:

```ts
        ...(materialRpc ? [materialServerSpec({ rpc: materialRpc, launcher, mode: "person", entry: material?.entry })] : []),
```

- [ ] **Step 6: The first message**

In `packages/shell/src/main/task-manager.ts`, `TaskDeps` gets, after `dataContext`:

```ts
  /** The scope's material section (material spec §9 Load). Absent without material (D0). */
  materialContext?(scope: string): Promise<string>;
```

and `contextFor` adds, after the data part:

```ts
    if (this.d.materialContext) {
      parts.push(
        await this.d.materialContext(scope).catch((err: unknown) => {
          console.error("Could not load the material for the task", err);
          return "";
        }),
      );
    }
```

In `packages/shell/src/main/index.ts`:

1. `TaskManager` deps, after the `dataContext` getter:

```ts
  // Material spec §9: only a harness with material gets the hook (D0). A getter: the harness loads later.
  get materialContext() {
    const m = harness.material;
    if (!m) return undefined;
    return async (scope: string) => {
      const c = await validConfig();
      if (!c || scope === APP_SCOPE) return "";
      const store = new MaterialStore(baseOf(c), scope);
      const rows = await store.indexRows();
      return materialSection({ mode: (await store.grounding()) ?? m.grounding.default, sheet: await store.sheet(), rows, budgetTokens: m.budget.indexTokens });
    };
  },
```

2. In `createRuntime({...})`, after `data:`:

```ts
    // The person's material in this folder, for the running task's scope (material spec §9). Absent without it (D0).
    ...(harness.material
      ? { material: { request: (request: unknown) => personMaterialRequest({ base: async () => base, runningTask: () => tasks.runningTask() }, request), entry: path.join(here, "material-server.js") } }
      : {}),
```

Imports: `MaterialStore`, `materialSection` from `@humanharness/material`; `personMaterialRequest` from `./material-requests`.

`closeRuntime` stops the runtime's `material` server with the runtime. The person-mode handler reads the base the runtime was built for (`base`), so a request can never reach another profile's material.

- [ ] **Step 7: Run everything**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`
Expected: PASS. The existing runtime and instructions D0 tests still pass unchanged.

- [ ] **Step 8: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell packages/runtime packages/workspace pnpm-lock.yaml
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat: tasks load, fetch and cite the person's material"
```

---

### Task 16: `MaterialPanel`: add, warn, status

The default panel (§11): "Add a file", "Add a link", the warning card for a waiting source (estimate, usage window, privacy line, page range), and one status line per source. It is drawn in the flow side panel when the harness has `material` and a scope is open (`main` without scopes). A harness can draw its own through `HarnessApp materialPanel`.

**Files:**
- Create: `packages/ui/src/MaterialPanel.tsx`
- Modify: `packages/ui/src/FlowSide.tsx`, `packages/ui/src/ChatView.tsx`, `packages/ui/src/HarnessApp.tsx`, `packages/ui/src/index.ts`, `packages/ui/src/styles.css`, `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/material-panel.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/material-panel.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp, type MaterialView } from "../src";
import { MaterialPanel } from "../src/MaterialPanel";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const info = { accepts: ["pdf", "text"], items: false, grounding: { default: "mixed" as const, personCanChange: true } };
const src = (over: Partial<MaterialView["sources"][number]>): MaterialView["sources"][number] => ({
  id: "ch2", name: "ch2.pdf", status: "ready", pages: 12, estimate: 9000, issues: [], fixes: [], fragments: 18, failed: false, ...over,
});
const view = (sources: MaterialView["sources"]): MaterialView => ({ scope: "fractions", sources, grounding: { mode: "mixed", canChange: true }, provider: "Anthropic", window: { kind: "five_hour", utilization: 0.42 } });

async function panel(v: MaterialView) {
  const client = new FakeClient({ language: "en", folder: "/f", engineId: "claude" });
  client.materialViews.fractions = v;
  await renderIn("en", <MaterialPanel client={client} scope="fractions" info={info} disabled={false} />);
  return client;
}

describe("MaterialPanel (material spec §11)", () => {
  it("adds a file and a link", async () => {
    const client = await panel(view([]));
    fireEvent.click(await screen.findByRole("button", { name: "Add a file" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a link" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Link" }), { target: { value: "https://example.org/halves" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(client.materialCalls).toEqual(["add:fractions", "link:fractions:https://example.org/halves"]));
  });

  it("a waiting source: the estimate, the window, the privacy line, a page range", async () => {
    const client = await panel(view([src({ status: "pending", notice: "warn", pages: 180, estimate: 154000, fragments: 0 })]));
    expect(await screen.findByText("ch2.pdf has 180 pages. Checking and labelling it will use about 154,000 tokens.")).toBeTruthy();
    expect(screen.getByText("Your plan's five_hour window is at 42% now.")).toBeTruthy();
    expect(screen.getByText("Checking and labelling send parts of this material to Anthropic.")).toBeTruthy();
    fireEvent.change(screen.getByRole("spinbutton", { name: "From page" }), { target: { value: "40" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "To page" }), { target: { value: "62" } });
    fireEvent.click(screen.getByRole("button", { name: "Only these pages" }));
    fireEvent.click(screen.getByRole("button", { name: "All of it" }));
    await waitFor(() => expect(client.materialCalls).toEqual(["confirm:ch2", "confirm:ch2"]));
  });

  it("at the hard limit only a page range goes on", async () => {
    await panel(view([src({ status: "pending", notice: "max", pages: 420, fragments: 0 })]));
    expect(await screen.findByRole("button", { name: "Only these pages" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "All of it" })).toBeNull();
  });

  it("a big spreadsheet: summary and first rows, or all of it", async () => {
    await panel(view([src({ name: "data.xlsx", status: "pending", notice: "rows", rows: 4000, fragments: 0 })]));
    expect(await screen.findByRole("button", { name: "Summary and first rows" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "All of it" })).toBeTruthy();
  });

  it("status lines", async () => {
    await panel(
      view([
        src({ id: "a", name: "a.pdf", status: "validating", stage: "review" }),
        src({ id: "b", name: "b.pdf", status: "validating", stage: "label" }),
        src({ id: "c", name: "c.pdf", status: "ready" }),
        src({ id: "d", name: "d.mp3", status: "refused", refusal: "media" }),
        src({ id: "e", name: "e.pdf", status: "ready", failed: true }),
      ]),
    );
    expect(await screen.findByText("a.pdf: checking the conversion…")).toBeTruthy();
    expect(screen.getByText("b.pdf: labelling…")).toBeTruthy();
    expect(screen.getByText("c.pdf: ready, 18 fragments")).toBeTruthy();
    expect(screen.getByText("d.mp3: the app only works with files that have text.")).toBeTruthy();
    expect(screen.getByText("e.pdf: ready, not checked by the AI")).toBeTruthy();
  });

  it("follows the main process's updates", async () => {
    const client = await panel(view([]));
    client.pushMaterial(view([src({})]));
    expect(await screen.findByText("ch2.pdf: ready, 18 fragments")).toBeTruthy();
  });
});

describe("where the panel goes", () => {
  it("in the flow side panel with material and an open scope; never without material (D0)", async () => {
    const client = new FakeClient({ language: "en", folder: "/f", engineId: "claude" });
    client.state = { ...client.state, actions: { study: { label: "Study" } }, material: info };
    await renderIn("en", <HarnessApp client={client} />);
    expect(await screen.findByRole("heading", { name: "Material" })).toBeTruthy();
    cleanup();
    const plain = new FakeClient({ language: "en", folder: "/f", engineId: "claude" });
    plain.state = { ...plain.state, actions: { study: { label: "Study" } } };
    await renderIn("en", <HarnessApp client={plain} />);
    await screen.findByRole("navigation", { name: "Guided path" });
    expect(screen.queryByRole("heading", { name: "Material" })).toBeNull();
  });

  it("a harness's own panel replaces the default", async () => {
    const client = new FakeClient({ language: "en", folder: "/f", engineId: "claude" });
    client.state = { ...client.state, actions: { study: { label: "Study" } }, material: info };
    await renderIn("en", <HarnessApp client={client} materialPanel={({ scope }) => <p>Own panel for {scope}</p>} />);
    expect(await screen.findByText("Own panel for main")).toBeTruthy();
  });
});
```

The two `HarnessApp` tests start on the work screen the way `flow.test.tsx` does; copy its setup (configured state, `tasks` view) if `HarnessApp` opens Home first in the fake client, and click into the work screen the same way.

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/material-panel.test.tsx`
Expected: FAIL (`MaterialPanel` not found).

- [ ] **Step 3: The strings**

In `packages/i18n/src/locales/en.json`, add a top-level `material` object (after `flow`):

```json
  "material": {
    "title": "Material",
    "addFile": "Add a file",
    "addLink": "Add a link",
    "link": "Link",
    "add": "Add",
    "cancel": "Cancel",
    "linkFailed": "The page couldn't be read. Check the link and try again.",
    "refusedFile": "{{name}}: {{message}}",
    "warn": "{{name}} has {{pages}} pages. Checking and labelling it will use about {{tokens}} tokens.",
    "max": "{{name}} has {{pages}} pages: too many to process whole. Choose the pages you need.",
    "rows": "{{name}} has {{rows}} rows. Checking and labelling all of it will use about {{tokens}} tokens.",
    "noTextPages": "Some pages of {{name}} have no text (they are scanned). Those pages will be skipped.",
    "window": "Your plan's {{window}} window is at {{percent}}% now.",
    "privacy": "Checking and labelling send parts of this material to {{provider}}.",
    "from": "From page",
    "to": "To page",
    "range": "Only these pages",
    "all": "All of it",
    "summary": "Summary and first rows",
    "goOn": "Go on",
    "status": {
      "pending": "{{name}}: waiting for you",
      "converting": "{{name}}: converting…",
      "review": "{{name}}: checking the conversion…",
      "repair": "{{name}}: fixing what the check found…",
      "label": "{{name}}: labelling…",
      "needs-person": "{{name}}: needs your decision",
      "ready": "{{name}}: ready, {{count}} fragments",
      "readyFailed": "{{name}}: ready, not checked by the AI",
      "refused": "{{name}}: {{message}}"
    },
    "refusal": {
      "media": "the app only works with files that have text.",
      "old-office": "save it as .docx, .xlsx or .pptx and add it again.",
      "binary": "this file has no text the app can read.",
      "unreadable": "this file is damaged or not what its name says.",
      "scanned": "this PDF is scanned: it has no text the app can read.",
      "protected": "this file is protected by a password or damaged.",
      "too-big": "this file is too big. Add only the chapters you need.",
      "not-accepted": "this app doesn't take this kind of file.",
      "fetch": "the page couldn't be read."
    }
  },
```

- [ ] **Step 4: Write the panel**

Create `packages/ui/src/MaterialPanel.tsx`:

```tsx
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, MaterialInfo, MaterialSourceView, MaterialView } from "./client";
import { shownLanguage } from "./language";

export interface MaterialPanelProps {
  client: HarnessClient;
  /** The scope whose material is shown (`main` without scopes). */
  scope: string;
  info: MaterialInfo;
  /** A turn or a switch runs: adding waits. */
  disabled: boolean;
}

/** The scope's material, kept up to date from the main process (`hh:materialStatus`). */
export function useMaterial(client: HarnessClient, scope: string): MaterialView | null {
  const [view, setView] = useState<MaterialView | null>(null);
  useEffect(() => {
    let live = true;
    const off = client.material.onChange((v) => {
      if (v.scope === scope) setView(v);
    });
    client.material.list(scope).then(
      (v) => live && setView((now) => now ?? v),
      () => {},
    );
    return () => {
      live = false;
      off();
    };
  }, [client, scope]);
  return view;
}

function WaitingCard({ client, scope, source, view }: { client: HarnessClient; scope: string; source: MaterialSourceView; view: MaterialView }) {
  const { t, i18n } = useTranslation();
  const fmt = (n: number) => n.toLocaleString(shownLanguage(i18n));
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(Math.min(source.pages, 50));
  const vars = { name: source.name, pages: fmt(source.pages), rows: fmt(source.rows ?? 0), tokens: fmt(source.estimate) };
  const text =
    source.notice === "max" ? t("material.max", vars) : source.notice === "rows" ? t("material.rows", vars) : source.notice === "no-text-pages" ? t("material.noTextPages", vars) : t("material.warn", vars);
  const ranged = source.notice === "warn" || source.notice === "max";
  return (
    <div className="hh-material-card" role="group" aria-label={source.name}>
      <p>{text}</p>
      {view.window && <p>{t("material.window", { window: view.window.kind, percent: Math.round(view.window.utilization * 100) })}</p>}
      <p className="hh-material-privacy">{t("material.privacy", { provider: view.provider })}</p>
      {ranged && (
        <div className="hh-material-range">
          <label>
            {t("material.from")}
            <input type="number" min={1} max={source.pages} value={from} onChange={(e) => setFrom(Number(e.target.value))} />
          </label>
          <label>
            {t("material.to")}
            <input type="number" min={1} max={source.pages} value={to} onChange={(e) => setTo(Number(e.target.value))} />
          </label>
          <button type="button" onClick={() => void client.material.confirm(scope, source.id, { pageRange: [from, to] })}>
            {t("material.range")}
          </button>
        </div>
      )}
      <div className="hh-material-actions">
        {source.notice === "rows" && (
          <button type="button" onClick={() => void client.material.confirm(scope, source.id, { sheets: "summary" })}>
            {t("material.summary")}
          </button>
        )}
        {source.notice !== "max" && (
          <button type="button" onClick={() => void client.material.confirm(scope, source.id, {})}>
            {source.notice === "no-text-pages" ? t("material.goOn") : t("material.all")}
          </button>
        )}
      </div>
    </div>
  );
}

/** One line per source (§11). */
export function statusLine(t: (k: string, o?: Record<string, unknown>) => string, s: MaterialSourceView): string {
  if (s.status === "refused") return t("material.status.refused", { name: s.name, message: t(`material.refusal.${s.refusal ?? "unreadable"}`) });
  if (s.status === "ready") return s.failed ? t("material.status.readyFailed", { name: s.name }) : t("material.status.ready", { name: s.name, count: s.fragments });
  if (s.status === "validating") return t(`material.status.${s.stage ?? "review"}`, { name: s.name });
  return t(`material.status.${s.status}`, { name: s.name });
}

/** The default material panel (material spec §11). */
export function MaterialPanel({ client, scope, disabled }: MaterialPanelProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const view = useMaterial(client, scope);
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState("");
  const [notice, setNotice] = useState<string[]>([]);
  const report = (r: Awaited<ReturnType<HarnessClient["material"]["add"]>>) => {
    if (!r.ok) setNotice(r.reason === "fetch" ? [t("material.linkFailed")] : []);
    else
      setNotice([
        ...r.refused.map((x) => t("material.refusedFile", { name: x.name, message: x.message })),
        // §13.3: a source processed at once still tells the person, once, where its parts go.
        ...(r.added.length > 0 && view ? [t("material.privacy", { provider: view.provider })] : []),
      ]);
  };
  const sources = view?.sources ?? [];
  return (
    <section className="hh-material" aria-labelledby={headingId}>
      <h2 id={headingId} className="hh-flow-heading">
        {t("material.title")}
      </h2>
      <div className="hh-material-actions">
        <button type="button" disabled={disabled} onClick={() => void client.material.add(scope).then(report)}>
          {t("material.addFile")}
        </button>
        <button type="button" disabled={disabled} onClick={() => setLinking((v) => !v)}>
          {t("material.addLink")}
        </button>
      </div>
      {linking && (
        <form
          className="hh-material-link"
          onSubmit={(e) => {
            e.preventDefault();
            void client.material.addLink(scope, url).then(report);
            setLinking(false);
            setUrl("");
          }}
        >
          <input type="url" aria-label={t("material.link")} value={url} onChange={(e) => setUrl(e.target.value)} />
          <button type="submit" disabled={!url.trim()}>
            {t("material.add")}
          </button>
        </form>
      )}
      {notice.map((n) => (
        <p key={n} className="hh-material-notice" role="status">
          {n}
        </p>
      ))}
      {sources.map((s) =>
        s.status === "pending" && view ? (
          <WaitingCard key={s.id} client={client} scope={scope} source={s} view={view} />
        ) : (
          <p key={s.id} className="hh-material-line">
            {statusLine(t, s)}
          </p>
        ),
      )}
    </section>
  );
}
```

The privacy line (§13.3) is on every waiting card, and in the notice after a source that was processed at once.

In `packages/ui/src/index.ts`, export `MaterialPanel`, `useMaterial`, `type MaterialPanelProps`, and the material types from `client.ts`.

- [ ] **Step 5: Place it**

`packages/ui/src/FlowSide.tsx`: a new optional prop `material?: ReactNode` (import `type ReactNode` from `react`), rendered right after the notes section:

```tsx
      {material}
```

`packages/ui/src/ChatView.tsx`:
1. Props: `materialPanel?: ComponentType<MaterialPanelProps>` (doc: "Replaces the default material panel; only with `state.material`").
2. Before the return:

```tsx
  // Material spec §11: the scope's material panel, only when the harness takes material (D0) and a scope is open.
  const materialScope = state.material ? (state.scopes ? openScope : "main") : null;
  const Panel = materialPanel ?? MaterialPanel;
  const material =
    state.material && materialScope ? <Panel client={client} scope={materialScope} info={state.material} disabled={blocked() || !loaded} /> : null;
```

3. `<FlowSide … material={material} />`. Without actions there is no flow side panel: render `{!flow && !slim && material && <nav className="hh-flow-side" aria-label={t("material.title")}>{material}</nav>}` in the same place.

`packages/ui/src/HarnessApp.tsx`: `HarnessAppProps` gets `materialPanel?: ComponentType<MaterialPanelProps>` (doc: "A harness's own material panel; absent: the core's"), passed through to `ChatView`.

`packages/ui/src/styles.css`, next to `.hh-flow-side` rules, with existing tokens only:

```css
.hh-material { display: grid; gap: 8px; }
.hh-material-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.hh-material-card { display: grid; gap: 6px; padding: 10px; border: 1px solid var(--hh-line); border-radius: 10px; background: var(--hh-surface); }
.hh-material-range { display: flex; flex-wrap: wrap; gap: 6px; align-items: end; }
.hh-material-range input { width: 5em; }
.hh-material-privacy, .hh-material-notice { color: var(--hh-muted); font-size: 0.9em; }
.hh-material-line { margin: 0; font-size: 0.95em; }
.hh-material-link { display: flex; gap: 6px; }
.hh-material-link input { flex: 1; min-width: 0; }
```

Check `--hh-line`, `--hh-surface` and `--hh-muted` exist in `styles.css` (`grep -n "\-\-hh-" packages/ui/src/styles.css | head`); use the names the file defines for a border, a raised surface and muted text, and let `styles.test.ts` (colours only through tokens) pass.

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test/material-panel.test.tsx`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`
Expected: PASS; every existing UI test passes unchanged (D0: no `material` in their states).

- [ ] **Step 7: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/ui packages/i18n
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(ui): the material panel: add, warn, status"
```

---

## Phase 3 — The AI stages (spec §12 slices 2–3)

### Task 17: System stages: `runSystemTask` and the queue

`runSystemTask` runs one short engine session for one stage. `MaterialJobs` runs the stages one at a time, only while no person's turn or task operation runs and no hold is set, in the current base. `closeRuntime` stops it; a new runtime, a material change and a profile's arrival start it again. Each stage writes one usage line. This task builds the frame; Tasks 18–23 add the stages.

**Files:**
- Create: `packages/runtime/src/system.ts`, `packages/shell/src/main/material-jobs.ts`
- Modify: `packages/runtime/src/index.ts`, `packages/material/src/stages.ts`, `packages/material/src/store.ts`, `packages/shell/src/main/material.ts`, `packages/shell/src/main/usage-log.ts`, `packages/shell/src/main/index.ts`, `packages/shell/src/main/material-requests.ts`
- Test: `packages/runtime/test/system.test.ts`, `packages/shell/test/material-jobs.test.ts`, `packages/material/test/stages.test.ts` (new), `packages/shell/test/usage-log.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/runtime/test/system.test.ts`, using the fake Claude CLI exactly as `packages/runtime/test/claude-cli.test.ts` starts it (copy its `fakeClaude(script)` helper: a script file and `command: [process.execPath, <fake-claude entry>, <script>]`):

```ts
import { getEngine } from "@humanharness/engines";
import { describe, expect, it } from "vitest";
import { runSystemTask } from "../src";
// fakeClaude(script): copied from claude-cli.test.ts (writes the script, returns the command).

describe("runSystemTask (material spec §10)", () => {
  it("one session in an empty folder with only the material server; the stage's tool answers over RPC", async () => {
    const seen: unknown[] = [];
    const command = fakeClaude({
      steps: [
        { mcp: { server: "material", tool: "material_read", args: { id: "x-001" } } },
        { line: { type: "result", subtype: "success", is_error: false, result: "done", usage: { input_tokens: 100, output_tokens: 20 } } },
      ],
    });
    const r = await runSystemTask({
      engine: getEngine("claude"),
      command,
      prompt: "material-review: check these",
      tools: [],
      handle: async (req) => {
        seen.push(req);
        return "Saved.";
      },
    });
    expect(r.ok).toBe(true);
    expect(r.usage?.inputTokens).toBe(100);
    expect(seen).toEqual([{ op: "read", id: "x-001" }]);
  });

  it("a crash or a timeout is a failed stage, never a throw", async () => {
    const r = await runSystemTask({ engine: getEngine("claude"), command: fakeClaude({ steps: [], exitCode: 1, stderr: "boom" }), prompt: "x", tools: [], handle: async () => null });
    expect(r.ok).toBe(false);
  });
});
```

The server runs in its own process, so only tools registered in `STAGE_TOOLS` by `stages.ts` exist there; this task's test uses `material_read`, which system mode always offers. Task 18 adds a test with `material_review`.

Create `packages/shell/test/material-jobs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MaterialJobs } from "../src/main/material-jobs";

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("MaterialJobs", () => {
  it("runs jobs one at a time, only while idle", async () => {
    const queue = ["a", "b"];
    let idle = false;
    const ran: string[] = [];
    const jobs = new MaterialJobs<string>({ idle: () => idle, next: async () => queue.shift() ?? null, run: async (j) => void ran.push(j), pollMs: 2 });
    jobs.kick();
    await tick();
    expect(ran).toEqual([]);
    idle = true;
    await jobs.settled();
    expect(ran).toEqual(["a", "b"]);
  });

  it("stop aborts the running job and waits for it; a kick starts again", async () => {
    let aborted = false;
    let calls = 0;
    const jobs = new MaterialJobs<string>({
      idle: () => true,
      next: async () => (calls++ < 1 ? "long" : null),
      run: (_j, signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve();
          });
        }),
      pollMs: 2,
    });
    jobs.kick();
    await tick();
    await jobs.stop();
    expect(aborted).toBe(true);
    calls = 0;
    jobs.kick();
    await tick();
    await jobs.stop();
  });

  it("a failing job doesn't stop the queue", async () => {
    const queue = ["bad", "good"];
    const ran: string[] = [];
    const jobs = new MaterialJobs<string>({
      idle: () => true,
      next: async () => queue.shift() ?? null,
      run: async (j) => {
        if (j === "bad") throw new Error("x");
        ran.push(j);
      },
      pollMs: 2,
    });
    jobs.kick();
    await jobs.settled();
    expect(ran).toEqual(["good"]);
  });
});
```

Create `packages/material/test/stages.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MaterialStore, type SourceEntry, failStage, nextJob } from "../src";

let base: string;
let store: MaterialStore;
const entry = (id: string, over: Partial<SourceEntry>): SourceEntry => ({ id, scope: "fractions", path: `${id}.pdf`, hash: "x", type: "pdf", family: "pdf", pages: 1, sizeBytes: 1, skippedPages: [], status: "ready", issues: [], fixes: [], estimate: 0, used: 0, fragments: [], addedAt: "2026-10-27T00:00:00.000Z", ...over });
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "hh-stages-"));
  store = new MaterialStore(base, "fractions");
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("nextJob", () => {
  it("a validating source's stage first, in the order sources were added; then the scope's sheet and links", async () => {
    await store.update(() => [entry("a", { status: "ready" }), entry("b", { status: "validating", stage: "label" }), entry("c", { status: "validating", stage: "review" })]);
    expect(await nextJob(store, { items: true })).toEqual({ scope: "fractions", source: "b", stage: "label" });
    await store.update((l) => l.map((s) => ({ ...s, status: "ready" as const, stage: undefined })));
    expect(await nextJob(store, { items: true })).toBeNull();
    await store.setStale("sheet");
    expect(await nextJob(store, { items: true })).toEqual({ scope: "fractions", stage: "sheet" });
    await store.setStale("link");
    expect(await nextJob(store, { items: true })).toEqual({ scope: "fractions", stage: "link" });
    expect(await nextJob(store, { items: false })).toBeNull();
  });

  it("a failed stage leaves the source usable and not retried (§13 failures)", async () => {
    await store.update(() => [entry("a", { status: "validating", stage: "review" })]);
    await failStage(store, { scope: "fractions", source: "a", stage: "review" });
    expect(await store.source("a")).toMatchObject({ status: "ready", failed: "review" });
    expect((await store.source("a"))?.stage).toBeUndefined();
    expect(await nextJob(store, { items: false })).toEqual({ scope: "fractions", stage: "sheet" });
  });
});
```

In `packages/shell/test/usage-log.test.ts`, add:

```ts
  it("material lines: their own record, left out of the per-action estimates (material spec §11)", () => {
    const line = materialRecord({ engine: "claude", stage: "label", scope: "fractions", source: "ch2", profile: { engine: "claude", tier: "light", effort: "low", cap: 100000 }, ok: true, usage: { inputTokens: 900, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 } }, "2026-10-27T10:00:00.000Z");
    expect(line).toMatchObject({ at: "2026-10-27T10:00:00.000Z", engine: "claude", phase: "material", stage: "label", scope: "fractions", source: "ch2", tier: "light", ok: true });
    const before = summarizeUsage([], undefined);
    const after = summarizeUsage([line], undefined);
    expect(after.estimates).toEqual(before.estimates);
    expect(after.tokens).toEqual(before.tokens);
  });
```

(`ModelProfile` needs every field the existing tests give it; copy a profile from the file's other tests if `cap` or `effort` are spelled differently.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm vitest run packages/runtime/test/system.test.ts packages/shell/test/material-jobs.test.ts packages/material/test/stages.test.ts packages/shell/test/usage-log.test.ts`
Expected: FAIL (modules and exports missing).

- [ ] **Step 3: `runSystemTask`**

Create `packages/runtime/src/system.ts`:

```ts
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Launcher, devLauncher, openRpc } from "@humanharness/blocks";
import type { EngineDef, ModelProfile } from "@humanharness/engines";
import { materialServerSpec } from "@humanharness/material";
import { AcpTransport } from "./acp";
import { ClaudeCliTransport } from "./claude-cli";
import type { EngineError, Event, LimitWindow } from "./events";
import type { Transport, TransportOptions } from "./transport";

export interface SystemTaskOptions {
  engine: EngineDef;
  /** The engine's CLI (from `engineCommand`, or a fake one in tests). */
  command: string[];
  env?: Record<string, string>;
  launcher?: Launcher;
  /** Built `material` server entry (app); defaults to the TS source. */
  entry?: string;
  prompt: string;
  /** The stage's tools on the `material` server (system mode). */
  tools: readonly string[];
  /** Answers the server's calls (`{ op, ...args }`); a throw is a refusal the AI reads. */
  handle: (request: unknown) => Promise<unknown>;
  profile?: ModelProfile;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SystemTaskResult {
  ok: boolean;
  error?: EngineError;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  model?: string;
  limits?: LimitWindow[];
}

const TIMEOUT_MS = 10 * 60_000;

/**
 * One AI stage of material processing (spec §10): a short session in an empty temporary folder, with only the
 * `material` server (system mode), no edits, no web, no commands, and no saved session. Never throws.
 */
export async function runSystemTask(o: SystemTaskOptions): Promise<SystemTaskResult> {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "hh-material-"));
  const rpc = await openRpc(o.handle).catch(() => null);
  if (!rpc) {
    await fs.rm(folder, { recursive: true, force: true }).catch(() => undefined);
    return { ok: false, error: { code: "agent-crashed", detail: "rpc" } };
  }
  const options: TransportOptions = {
    folder,
    session: { id: randomUUID(), started: false },
    mcp: [materialServerSpec({ rpc, launcher: o.launcher ?? devLauncher(), mode: "system", tools: o.tools, ...(o.entry ? { entry: o.entry } : {}) })],
    permissions: { edit: "none", exec: false, web: false },
    sessionMode: o.engine.transport.kind === "acp" ? o.engine.transport.modes?.readOnly : undefined,
    minAdapterVersion: o.engine.transport.kind === "acp" ? o.engine.transport.minAdapterVersion : undefined,
    persistSession: false,
    command: o.command,
    env: o.env,
    onSessionStarted: () => {},
  };
  const transport: Transport = o.engine.transport.kind === "claude-cli" ? new ClaudeCliTransport(options) : new AcpTransport(options);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  o.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? TIMEOUT_MS);
  const result: SystemTaskResult = { ok: false };
  const add = (e: Extract<Event, { type: "usage" }>) => {
    const u = result.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    result.usage = { inputTokens: u.inputTokens + e.inputTokens, outputTokens: u.outputTokens + e.outputTokens, cacheReadTokens: u.cacheReadTokens + e.cacheReadTokens, cacheWriteTokens: u.cacheWriteTokens + e.cacheWriteTokens };
    if (e.model) result.model = e.model;
  };
  try {
    await transport.turn(
      o.prompt,
      (e) => {
        if (e.type === "usage") add(e);
        else if (e.type === "limits") result.limits = e.windows;
        else if (e.type === "done") {
          result.ok = e.ok;
          if (!e.ok) result.error = e.error;
        }
      },
      controller.signal,
      o.profile,
    );
  } catch (err) {
    result.ok = false;
    result.error = { code: "agent-crashed", detail: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", onAbort);
    await transport.close().catch(() => undefined);
    await rpc.close().catch(() => undefined);
    await fs.rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
  return result;
}
```

Export it from `packages/runtime/src/index.ts`: `export { runSystemTask, type SystemTaskOptions, type SystemTaskResult } from "./system";`.

- [ ] **Step 4: The stage frame in the material package**

In `packages/material/src/store.ts`, add to `MaterialStore`:

```ts
  /**
   * The scope's next scope stage (§10): "sheet" after a source finished or went away, "link" once the sheet is done
   * and the harness has items; null when both are current. Not tracked by the history.
   */
  async stale(): Promise<"sheet" | "link" | null> {
    const text = await fs.readFile(path.join(this.dir, ".stale"), "utf8").catch(() => null);
    return text === null ? null : text.trim() === "link" ? "link" : "sheet";
  }

  async setStale(next: "sheet" | "link" | false): Promise<void> {
    const file = path.join(this.dir, ".stale");
    if (next) await writeAtomic(file, next);
    else await fs.rm(file, { force: true });
  }
```

Replace `packages/material/src/stages.ts` with:

```ts
import type { MaterialStage } from "@humanharness/harness-sdk";
import type { MaterialStore } from "./store";

/** One unit of AI work (§6.2, §10): a source's stage, or the scope's sheet or links. */
export interface Job {
  scope: string;
  source?: string;
  stage: MaterialStage;
}

/**
 * The next job in a scope (§10 order): the first validating source's stage, in the order sources were added; once
 * none is left, what the scope's `.stale` marker says: the sheet, then (with items) the links.
 */
export async function nextJob(store: MaterialStore, o: { items: boolean }): Promise<Job | null> {
  const s = (await store.sources()).find((x) => x.status === "validating" && x.stage);
  if (s?.stage) return { scope: store.scope, source: s.id, stage: s.stage };
  const stale = await store.stale();
  if (stale === "sheet") return { scope: store.scope, stage: "sheet" };
  return stale === "link" && o.items ? { scope: store.scope, stage: "link" } : null;
}

/**
 * A stage that failed (out of quota, the engine missing, a crash, no answer): not retried on its own (§13). The
 * source stays usable with what it has (`ready`, fragments `not-reviewed` or unlabelled) and says so; Try again
 * (`retry`) sends it back. The scope's sheet and links still run.
 */
export async function failStage(store: MaterialStore, job: Job): Promise<void> {
  if (job.source) {
    await store.patch(job.source, (s) => {
      const { stage: _stage, ...rest } = s;
      return { ...rest, status: "ready", failed: job.stage };
    });
    await store.setStale("sheet");
  }
  await store.writeIndex();
}

/** Try again (§11): the failed stage runs once more. */
export async function retryStage(store: MaterialStore, sourceId: string): Promise<boolean> {
  const s = await store.source(sourceId);
  if (!s?.failed) return false;
  const stage = s.failed === "sheet" || s.failed === "link" ? undefined : s.failed;
  await store.patch(sourceId, (e) => {
    const { failed: _f, ...rest } = e;
    return stage ? { ...rest, status: "validating", stage } : rest;
  });
  if (!stage) await store.setStale("sheet");
  return true;
}

/**
 * What a stage needs to run: its tools, its prompt, how to take each tool call, and what to do with the answers.
 * Stage tasks (18–23) register theirs in STAGES; tools in STAGE_TOOLS (server.ts).
 */
export interface StageDef {
  tools: readonly string[];
  /** Null: nothing to do (the stage is skipped as done). */
  prompt(store: MaterialStore, job: Job, ctx: StageContext): Promise<string | null>;
  /** One tool call from the AI; the answer goes back to it. A throw is a refusal it reads. */
  accept(name: string, args: Record<string, unknown>, state: StageState): Promise<string>;
  /** After the session ended well: apply what was accepted. False: no usable answer (the stage failed). */
  apply(store: MaterialStore, job: Job, state: StageState, ctx: StageContext): Promise<boolean>;
}

/** What the harness says about material, for prompts. */
export interface StageContext {
  fragmentKinds: string[];
  sheetSections: { id: string; label: string; prompt: string }[];
  sheetMaxTokens: number;
  /** `key: label` lines of the items collection in this scope (links stage). */
  items?: { key: string; label: string }[];
}

/** What a stage's tool calls left, per run. */
export interface StageState {
  store: MaterialStore;
  job: Job;
  answers: Record<string, unknown>[];
}

export const STAGES: Partial<Record<MaterialStage, StageDef>> = {};
```

`STAGE_TOOLS` stays in `server.ts`; `stages.ts` imports nothing from the server so the server-bin can import `./stages` to register tools (Tasks 18–23 add `STAGE_TOOLS[...] = …` lines next to each `STAGES[...] = …`). Change `stages.ts` to import `STAGE_TOOLS` from `./server` when the first stage registers a tool (Task 18).

- [ ] **Step 5: The queue**

Create `packages/shell/src/main/material-jobs.ts`:

```ts
export interface MaterialJobsDeps<J> {
  /** No person's turn or task operation, no hold, not quitting (spec §10: the queue never starts a stage then). */
  idle(): boolean;
  /** The next job in the current base; null: nothing to do. */
  next(): Promise<J | null>;
  run(job: J, signal: AbortSignal): Promise<void>;
  pollMs?: number;
}

/**
 * Runs material stages one at a time (spec §10). It waits while the person works, starts a stage only when idle, and
 * stops when `stop()` is called (closeRuntime: an engine change, a folder change or move, a profile switch, quitting).
 * `kick()` starts it again; it ends on its own when there is nothing to do.
 */
export class MaterialJobs<J> {
  private loop: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private stopped = false;
  private again = false;

  constructor(private readonly d: MaterialJobsDeps<J>) {}

  kick(): void {
    this.stopped = false;
    if (this.loop) {
      this.again = true;
      return;
    }
    this.loop = this.run().finally(() => {
      this.loop = null;
      if (this.again && !this.stopped) this.kick();
    });
  }

  private async run(): Promise<void> {
    this.again = false;
    while (!this.stopped) {
      while (!this.d.idle()) {
        if (this.stopped) return;
        await new Promise((r) => setTimeout(r, this.d.pollMs ?? 1000));
      }
      const job = await this.d.next().catch((err: unknown) => {
        console.error("Could not look for material work", err);
        return null;
      });
      if (!job || this.stopped) return;
      this.controller = new AbortController();
      try {
        await this.d.run(job, this.controller.signal);
      } catch (err) {
        console.error("A material stage failed", err);
      } finally {
        this.controller = null;
      }
    }
  }

  /** Stops the running stage (its session ends) and waits; nothing runs until the next kick. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.controller?.abort();
    await this.loop;
  }

  /** Resolves once the queue has nothing to do (tests). */
  async settled(): Promise<void> {
    while (this.loop) await this.loop;
  }
}
```

- [ ] **Step 6: Usage lines**

In `packages/shell/src/main/usage-log.ts`:
1. `TurnKind` gets `"material"` (doc: "an AI stage of material processing; not a task's turn").
2. `UsageRecord` gets `stage?: string;` and `source?: string;` (doc: "material lines only").
3. New:

```ts
/** One AI stage of material processing (material spec §11). */
export function materialRecord(
  o: { engine: string; stage: string; scope: string; source?: string; profile: ModelProfile; ok: boolean; usage?: TurnUsage; limits?: LimitWindow[] },
  at: string = new Date().toISOString(),
): UsageRecord {
  return {
    at,
    engine: o.engine,
    phase: "material",
    stage: o.stage,
    scope: o.scope,
    ...(o.source ? { source: o.source } : {}),
    ...profileMeta(o.profile),
    ok: o.ok,
    ...(o.usage ? { usage: o.usage } : {}),
    ...(o.limits ? { limits: o.limits } : {}),
  };
}
```

4. In `summarizeUsage`, first line: `records = records.filter((r) => r.kind !== "compaction" && r.phase !== "material");` (material lines are not tasks; Task 25 sums them on their own).

- [ ] **Step 7: Wire the queue**

In `packages/shell/src/main/material.ts`, add to `MaterialDeps`:

```ts
  /** Runs one stage session (runSystemTask with the stage's model). */
  runStage?(job: Job, prompt: string, tools: readonly string[], handle: (r: unknown) => Promise<unknown>, signal: AbortSignal): Promise<{ ok: boolean }>;
  /** Wakes the queue. */
  kick?(): void;
```

and to `MaterialService` (imports from `@humanharness/material`: `STAGES`, `type Job`, `type StageState`, `type StageContext`, `nextJob`, `failStage`, `retryStage`):

```ts
  /** The next job in the current base, over every scope that has material (spec §10). */
  async nextJob(): Promise<Job | null> {
    const base = await this.d.base();
    if (!base) return null;
    const scopes = await fs.readdir(path.join(base, ".harness", "material")).catch(() => [] as string[]);
    for (const scope of scopes.sort()) {
      const store = await this.store(scope);
      if (typeof store === "string") continue;
      const job = await nextJob(store, { items: this.d.material.items !== undefined });
      if (job) return job;
    }
    return null;
  }

  /** Runs one job: the stage's session, then its answers applied; a failure marks the source (§13). */
  async runJob(job: Job, signal: AbortSignal): Promise<void> {
    const store = await this.store(job.scope);
    const def = STAGES[job.stage];
    if (typeof store === "string" || !def || !this.d.runStage) return;
    const ctx = await this.stageContext(job.scope);
    const prompt = await def.prompt(store, job, ctx);
    let ok = true;
    const state: StageState = { store, job, answers: [] };
    if (prompt !== null) {
      const handle = async (request: unknown) => {
        const r = typeof request === "object" && request !== null ? (request as Record<string, unknown>) : {};
        if (r.op === "read" && typeof r.id === "string") {
          const f = await store.readFragment(r.id);
          if (!f) throw new Error(`No fragment ${r.id.slice(0, 80)}`);
          return f.md;
        }
        if (typeof r.op === "string" && def.tools.includes(r.op)) {
          const { op, ...args } = r;
          return def.accept(op, args, state);
        }
        throw new Error("Unknown request");
      };
      const result = await this.d.runStage(job, prompt, def.tools, handle, signal);
      if (signal.aborted) return; // Stopped by closeRuntime: the stage runs again later, from the start.
      ok = result.ok && (await def.apply(store, job, state, ctx));
    } else ok = await def.apply(store, job, state, ctx);
    if (!ok) await failStage(store, job);
    // The scope's stages in order (§10): a sheet done hands over to the links (with items); links done clear the marker.
    if (ok && job.stage === "sheet") await store.setStale(this.d.material.items !== undefined ? "link" : false);
    if (ok && job.stage === "link") await store.setStale(false);
    await this.changed(job.scope);
  }

  /** What prompts need from the manifest (Tasks 21–23 fill items). */
  async stageContext(_scope: string): Promise<StageContext> {
    return { fragmentKinds: this.d.material.fragmentKinds, sheetSections: this.d.material.sheet.sections, sheetMaxTokens: this.d.material.sheet.maxTokens };
  }

  /** Try again (§11). */
  async retry(scope: unknown, id: unknown): Promise<MaterialResult> {
    const store = await this.store(scope);
    if (typeof store === "string") return { ok: false, reason: store };
    if (!isSourceId(id) || !(await retryStage(store, id))) return { ok: false, reason: "unknown-source" };
    this.d.kick?.();
    await this.changed(store.scope);
    return { ok: true };
  }
```

`MaterialDeps.material` widens to `Pick<HarnessMaterial, "accepts" | "items" | "grounding" | "budget" | "fragmentKinds" | "sheet" | "tiers">` (update the test's deps object with `fragmentKinds: ["explanation"], sheet: { sections: [{ id: "terms", label: "Key terms", prompt: "List them." }], maxTokens: 800 }, tiers: {}`). `afterChange` in `index.ts` also calls `materialJobs?.kick()`.

A scope stage (sheet, links) that fails leaves `.stale` set, so it runs again at the next kick, not in a loop: the service skips, until the next kick, the scopes whose stage failed in this run. Add to `MaterialService`:

```ts
  /** Scope stages that failed since the last kick (`scope:stage`): skipped until then, so a failure doesn't loop. */
  private failedScopes = new Set<string>();
  resetFailures(): void {
    this.failedScopes.clear();
  }
```

In `nextJob`, `if (job && !job.source && this.failedScopes.has(`${scope}:${job.stage}`)) continue;` before `return job`; in `runJob`, when `!ok && !job.source`, `this.failedScopes.add(`${job.scope}:${job.stage}`)`. `MaterialJobs.kick` is wrapped in `index.ts` as `const kickMaterial = () => { materialSvc?.resetFailures(); materialJobs?.kick(); };`, and every `materialJobs?.kick()` below goes through `kickMaterial()`.

In `packages/shell/src/main/index.ts`:

1. Imports: `runSystemTask` from `@humanharness/runtime`, `MaterialJobs` from `./material-jobs`, `materialRecord` from `./usage-log`, `materialStageKey`, `stageTier` from `@humanharness/harness-sdk`, `type Job` from `@humanharness/material`.

2. After `materialSvc` is built:

```ts
/** The material queue (spec §10); null without material (D0). */
let materialJobs: MaterialJobs<Job> | null = null;
```

and in `buildMaterial()` deps:

```ts
    kick: () => materialJobs?.kick(),
    runStage: async (job, prompt, tools, handle, signal) => {
      const c = await validConfig();
      if (!c || !harness.material) return { ok: false };
      const engine = getEngine(c.engineId);
      const fake = hooks.engines?.[engine.id];
      const cmd = fake ?? (await engineCommand(engine, commandDeps).catch(() => null));
      if (!cmd) return { ok: false };
      const models = cleanModels(c.models);
      const saved = await savedOffer(engine.id);
      const profile = await supportedEffort(firstOffered(resolveProfile({ engine: engine.id, action: materialStageKey(job.stage), manifestTier: stageTier(harness.material, job.stage), models }), models, saved.models), saved);
      const r = await runSystemTask({ engine, command: cmd.command, env: cmd.env, launcher: electronLauncher(process.execPath), entry: path.join(here, "material-server.js"), prompt, tools, handle, profile, signal });
      if (!signal.aborted) {
        await new UsageLog(baseOf(c))
          .append(materialRecord({ engine: engine.id, stage: job.stage, scope: job.scope, ...(job.source ? { source: job.source } : {}), profile, ok: r.ok, ...(r.usage ? { usage: r.usage } : {}), ...(r.limits ? { limits: r.limits } : {}) }))
          .catch((err: unknown) => console.error("Could not record the material stage", err));
      }
      return { ok: r.ok };
    },
```

A stage needs the engine's notice accepted, like a turn: in `runStage`, return `{ ok: false }` when `!(await hasNotice(c.engineId))`.

3. After `materialSvc = buildMaterial();`:

```ts
    materialJobs = materialSvc
      ? new MaterialJobs<Job>({
          idle: () => !quitting && !tasks.isBusy() && hold.turnBlocked() === null && !hold.folderBusy(),
          next: () => materialSvc!.nextJob(),
          run: (job, signal) => materialSvc!.runJob(job, signal),
        })
      : null;
    if (await validConfig()) materialJobs?.kick();
```

(`quitting` is the module flag set on the first before-quit; use its real name from the file.)

4. `closeRuntime()`: first line `await materialJobs?.stop();` (D0: `null` without material, nothing changes). The runtime memoise's factory, after `createRuntime(...)` resolves, calls `materialJobs?.kick()`: wrap the return as `const rt = await createRuntime({...}); materialJobs?.kick(); return rt;`. `arrivedInProfile()` ends with `materialJobs?.kick();`.

5. IPC: `handle("hh:materialRetry", (scope: unknown, id: unknown) => materialSvc?.retry(scope, id) ?? noMaterial);`; preload `retry: (scope, id) => ipcRenderer.invoke("hh:materialRetry", scope, id)`; `MaterialClient.retry(scope: string, id: string): Promise<MaterialResult>`; the fake client records `retry:<id>`.

6. `personMaterialRequest`'s flag answer wakes the queue: `PersonMaterialDeps` gets `flagged?(): void`, called after a flag; `index.ts` passes `flagged: () => materialJobs?.kick()`.

In `MaterialPanel.tsx`, a failed source's line gets a "Try again" button (`material.retry`: "Try again") that calls `client.material.retry(scope, s.id)`; add the string and a test case to `material-panel.test.tsx` (click it, expect `retry:e`).

- [ ] **Step 8: Run everything**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/runtime packages/material packages/shell packages/ui packages/i18n
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat: system stages for material: runSystemTask and the queue"
```

---

### Task 18: Review

The review stage (§6.2) reads what the checks flagged plus a bounded sample, and answers once per batch with `material_review`: a verdict, a decision per fragment, issues, and whether a reconversion or a full review is needed. The program carries out `merge`, `split` and `drop`, keeps the old fragments in `.orig/`, converts again once on `reconvert`, and sends a source that stays `not-usable` to the person.

**Files:**
- Create: `packages/material/src/review.ts`
- Modify: `packages/material/src/stages.ts`, `packages/material/src/types.ts`, `packages/material/src/index.ts`
- Test: `packages/material/test/review.test.ts` (new), `packages/runtime/test/system.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/material/test/review.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Fragment, MaterialStore, STAGES, STAGE_TOOLS, type SourceEntry, applyReview, reviewSet } from "../src";
import "../src/stages";

let base: string;
let store: MaterialStore;
const frag = (n: number, md: string, checks: Fragment["meta"]["checks"] = "ok"): Fragment => ({
  meta: { id: `ch2-${String(n).padStart(3, "0")}`, source: "ch2.md", location: `lines ${n}`, path: `T › P${n}`, summary: "", keywords: [], tokens: 50, items: [], checks, validated: "not-reviewed" },
  md,
});
const entry: SourceEntry = { id: "ch2", scope: "fractions", path: "ch2.md", hash: "x", type: "md", family: "text", pages: 1, sizeBytes: 1, skippedPages: [], status: "validating", stage: "review", issues: [], fixes: [], estimate: 0, used: 0, fragments: [], addedAt: "2026-10-27T00:00:00.000Z" };

beforeEach(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "hh-review-"));
  store = new MaterialStore(base, "fractions");
  await store.update(() => [entry]);
  const list = Array.from({ length: 30 }, (_, i) => frag(i + 1, `Paragraph ${i + 1}.\n\nSecond line ${i + 1}.`, i === 4 ? ["table"] : "ok"));
  await store.writeFragments("ch2", list);
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("reviewSet (§6.2 sample)", () => {
  it("flagged ones, the first unflagged, and 10% of the rest spread evenly, at most 15", async () => {
    const ids = await reviewSet(store, (await store.source("ch2"))!);
    expect(ids[0]).toBe("ch2-005");
    expect(ids).toContain("ch2-001");
    expect(ids.length).toBe(1 + 1 + 3);
  });
  it("after a first review, only the fragments flagged in use", async () => {
    await store.patch("ch2", (s) => ({ ...s, verdict: "good" }));
    await store.patchFragment("ch2-010", (m) => ({ ...m, validated: "pending" }));
    expect(await reviewSet(store, (await store.source("ch2"))!)).toEqual(["ch2-010"]);
  });
});

describe("the review stage", () => {
  it("offers material_review; the prompt starts with the stage's marker and holds the fragments", async () => {
    expect(Object.hasOwn(STAGE_TOOLS, "material_review")).toBe(true);
    const prompt = await STAGES.review!.prompt(store, { scope: "fractions", source: "ch2", stage: "review" }, { fragmentKinds: ["example"], sheetSections: [], sheetMaxTokens: 800 });
    expect(prompt?.startsWith("material-review\n")).toBe(true);
    expect(prompt).toContain("[ch2-005] (checks: table; lines 5; T › P5)");
    expect(prompt).toContain("Paragraph 5.");
  });

  it("accept refuses fragments outside the batch", async () => {
    const state = { store, job: { scope: "fractions", source: "ch2", stage: "review" as const }, answers: [] };
    await STAGES.review!.prompt(store, state.job, { fragmentKinds: [], sheetSections: [], sheetMaxTokens: 800 });
    await expect(STAGES.review!.accept("material_review", { verdict: "good", fragments: [{ id: "ch2-029", decision: "ok" }] }, state)).rejects.toThrow("not in this batch");
  });
});

describe("applyReview", () => {
  const job = { scope: "fractions", source: "ch2", stage: "review" as const };

  it("good: reviewed fragments are marked; the source goes to labelling", async () => {
    const batch = await reviewSet(store, (await store.source("ch2"))!);
    await store.patch("ch2", (s) => ({ ...s, reviewQueue: batch }));
    await applyReview(store, job, { verdict: "good", fragments: batch.map((id) => ({ id, decision: "ok" })), issues: [] }, { items: false });
    expect((await store.readFragment("ch2-005"))?.meta.validated).toBe("flagged-reviewed");
    expect((await store.readFragment("ch2-001"))?.meta.validated).toBe("sample");
    expect((await store.readFragment("ch2-002"))?.meta.validated).toBe("not-reviewed");
    expect(await store.source("ch2")).toMatchObject({ verdict: "good", stage: "label", status: "validating" });
  });

  it("merge, split and drop are carried out by the program; old versions kept", async () => {
    await store.patch("ch2", (s) => ({ ...s, reviewQueue: ["ch2-001", "ch2-003", "ch2-005"] }));
    await applyReview(
      store,
      job,
      {
        verdict: "usable-with-fixes",
        fragments: [
          { id: "ch2-001", decision: "merge", with: "ch2-002" },
          { id: "ch2-003", decision: "split", at: 2 },
          { id: "ch2-005", decision: "drop" },
        ],
        issues: ["Two fragments cut mid-sentence"],
      },
      { items: false },
    );
    const s = (await store.source("ch2"))!;
    expect(s.fragments.slice(0, 4)).toEqual(["ch2-001", "ch2-003", "ch2-031", "ch2-004"]);
    expect(s.fragments).not.toContain("ch2-005");
    expect((await store.readFragment("ch2-001"))?.md).toBe("Paragraph 1.\n\nSecond line 1.\n\nParagraph 2.\n\nSecond line 2.");
    expect((await store.readFragment("ch2-003"))?.md).toBe("Paragraph 3.");
    expect((await store.readFragment("ch2-031"))?.md).toBe("Second line 3.");
    expect(await store.readOriginalVersion("ch2-005")).not.toBeNull();
    expect(s.fixes).toEqual(["Merged ch2-001 and ch2-002", "Split ch2-003", "Dropped ch2-005"]);
    expect(s.issues).toEqual(["Two fragments cut mid-sentence"]);
  });

  it("repairs and asks wait for the next stage", async () => {
    await store.patch("ch2", (s) => ({ ...s, reviewQueue: ["ch2-005"] }));
    await applyReview(store, job, { verdict: "usable-with-fixes", fragments: [{ id: "ch2-005", decision: "repair", issue: "The table lost its columns" }], issues: [] }, { items: false });
    expect(await store.source("ch2")).toMatchObject({ stage: "repair", repairs: [{ id: "ch2-005", issue: "The table lost its columns" }] });
  });

  it("not-usable: one reconversion for a PDF, then the person decides", async () => {
    await store.patch("ch2", (s) => ({ ...s, type: "pdf", family: "pdf", reviewQueue: ["ch2-001"] }));
    const reconverted: unknown[] = [];
    const reconvert = async (settings: unknown) => void reconverted.push(settings);
    await applyReview(store, job, { verdict: "not-usable", fragments: [], issues: ["Columns are mixed"], reconvert: true }, { items: false, reconvert });
    expect(reconverted).toEqual([{ columns: true }]);
    expect((await store.source("ch2"))?.reconverted).toBe(1);
    await store.patch("ch2", (s) => ({ ...s, reviewQueue: ["ch2-001"] }));
    await applyReview(store, job, { verdict: "not-usable", fragments: [], issues: [] }, { items: false, reconvert });
    expect(await store.source("ch2")).toMatchObject({ status: "needs-person", asks: [{ question: expect.stringContaining("ch2.md"), choices: ["use", "remove"] }] });
  });
});
```

In `packages/runtime/test/system.test.ts`, add one test like the first, with `tools: ["material_review"]` and the fake CLI calling `material_review` with `{ verdict: "good", fragments: [], issues: [] }`; `seen` is `[{ op: "material_review", verdict: "good", fragments: [], issues: [] }]`.

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run packages/material/test/review.test.ts`
Expected: FAIL (`reviewSet` is not exported).

- [ ] **Step 3: The new source fields**

In `packages/material/src/types.ts`, `SourceEntry` gets:

```ts
  /** Review (§6.2): the fragments still to review, in batches of BATCH. */
  reviewQueue?: string[];
  /** Repairs the review asked for, waiting for the repair stage. */
  repairs?: { id: string; issue: string }[];
  /** Questions for the person (§6.2 `ask`); `choices` are ids the window names. */
  asks?: MaterialAsk[];
  /** The person agreed to a full review (§7). */
  fullReview?: boolean;
```

and:

```ts
/** A question for the person: about one fragment, or the whole source. */
export interface MaterialAsk {
  fragment?: string;
  question: string;
  choices: ("keep" | "drop" | "program" | "use" | "remove")[];
}
```

- [ ] **Step 4: Write the review**

Create `packages/material/src/review.ts`:

```ts
import { z } from "zod";
import { BATCH, SAMPLE_MAX, SAMPLE_SHARE } from "./constants";
import { fragmentId, isFragmentId } from "./fragment";
import type { Job } from "./stages";
import type { MaterialStore } from "./store";
import type { ConvertSettings, Fragment, SourceEntry } from "./types";

export const reviewAnswer = z.object({
  verdict: z.enum(["good", "usable-with-fixes", "not-usable"]),
  fragments: z
    .array(
      z.object({
        id: z.string(),
        decision: z.enum(["ok", "repair", "merge", "split", "drop", "ask"]),
        /** merge: the fragment it joins (the next one). */
        with: z.string().optional(),
        /** split: the line the second part starts at (1-based). */
        at: z.number().int().min(2).optional(),
        /** repair: what is wrong. ask: the question. */
        issue: z.string().max(300).optional(),
        question: z.string().max(300).optional(),
      }),
    )
    .max(BATCH),
  issues: z.array(z.string().max(200)).max(10),
  reconvert: z.boolean().optional(),
  fullReview: z.boolean().optional(),
});
export type ReviewAnswer = z.infer<typeof reviewAnswer>;

const flagged = (f: Fragment) => f.meta.checks !== "ok" || f.meta.validated === "pending";

/**
 * What the review reads (§6.2). First review: every flagged fragment, the first unflagged one, and SAMPLE_SHARE of the
 * rest (rounded up, at most SAMPLE_MAX) spread evenly. After that: only the fragments flagged in use. A full review:
 * all of them.
 */
export async function reviewSet(store: MaterialStore, s: SourceEntry): Promise<string[]> {
  const list = (await Promise.all(s.fragments.map((id) => store.readFragment(id)))).filter((f): f is Fragment => f !== null);
  if (s.fullReview) return list.map((f) => f.meta.id);
  if (s.verdict) return list.filter((f) => f.meta.validated === "pending").map((f) => f.meta.id);
  const bad = list.filter(flagged).map((f) => f.meta.id);
  const fine = list.filter((f) => !flagged(f));
  if (fine.length === 0) return bad;
  const [first, ...rest] = fine;
  const n = Math.min(SAMPLE_MAX, Math.ceil(rest.length * SAMPLE_SHARE));
  const step = rest.length / Math.max(n, 1);
  const sample = Array.from({ length: n }, (_, i) => rest[Math.floor(i * step + step / 2)]?.meta.id).filter((x): x is string => !!x);
  return [...bad, first.meta.id, ...sample];
}

/** The review prompt for one batch (English; the stage's marker on the first line). */
export async function reviewPrompt(store: MaterialStore, s: SourceEntry, batch: string[]): Promise<string> {
  const parts: string[] = [];
  for (const id of batch) {
    const f = await store.readFragment(id);
    if (!f) continue;
    parts.push(`[${id}] (checks: ${f.meta.checks === "ok" ? "none" : f.meta.checks.join(", ")}; ${f.meta.location}; ${f.meta.path || "no heading"})\n${f.md}`);
  }
  return [
    "material-review",
    `You check how a program converted "${s.path}" (${s.type}) into Markdown fragments. You never judge or change what the material says: only whether the conversion kept it readable.`,
    s.issues.length ? `The program's checks found: ${s.issues.join("; ")}.` : "",
    "For each fragment below decide: ok; repair (headings, lists, tables or line breaks are broken: say what in `issue`); merge (it was cut off and goes on in the next fragment: give `with`); split (two unrelated parts: give `at`, the line the second starts at); drop (no content: a menu, a header, an empty table); ask (only the person can say: give `question`).",
    "Then give the verdict for the whole source: good, usable-with-fixes, or not-usable. Set `reconvert` when the text order or the headings are wrong throughout. Set `fullReview` only if the sample suggests many fragments outside it are broken.",
    "Answer once, by calling `material_review`. Fragments:",
    parts.join("\n\n---\n\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Which settings a reconversion tries (§6.2): PDFs only; the order problem toggles columns, else headings by weight. */
export function reconvertSettings(s: SourceEntry): ConvertSettings | null {
  if (s.type !== "pdf" || (s.reconverted ?? 0) >= 1) return null;
  const columns = s.settings?.columns;
  return columns === undefined || columns === false ? { columns: true } : { headingsByWeight: !s.settings?.headingsByWeight };
}

/**
 * Applies one batch's answer (§6.2). The program carries out merge, split and drop (old fragments kept in `.orig/`),
 * records repairs and asks, marks reviewed fragments, and moves the source on: more batches, repair, label, a
 * reconversion, or the person.
 */
export async function applyReview(
  store: MaterialStore,
  job: Job,
  a: ReviewAnswer,
  o: { items: boolean; reconvert?: (settings: ConvertSettings) => Promise<void> },
): Promise<void> {
  const s = await store.source(job.source ?? "");
  if (!s) return;
  const batch = new Set((s.reviewQueue ?? []).slice(0, BATCH));
  const rest = (s.reviewQueue ?? []).slice(BATCH);
  const issues = [...s.issues, ...a.issues];

  if (a.verdict === "not-usable" || a.reconvert) {
    const settings = reconvertSettings(s);
    if (settings && o.reconvert) {
      await store.patch(s.id, (e) => ({ ...e, issues, reconverted: (e.reconverted ?? 0) + 1, reviewQueue: undefined }));
      await o.reconvert({ ...s.settings, ...settings });
      return;
    }
    if (a.verdict === "not-usable") {
      await store.patch(s.id, (e) => {
        const { stage: _st, reviewQueue: _q, ...rest2 } = e;
        return { ...rest2, verdict: "not-usable", issues, status: "needs-person", asks: [...(e.asks ?? []), { question: `The AI couldn't make "${e.path}" readable. Use it as it is, or remove it?`, choices: ["use", "remove"] }] };
      });
      return;
    }
  }

  let list = s.fragments.slice();
  const fixes = [...s.fixes];
  const repairs = [...(s.repairs ?? [])];
  const asks = [...(s.asks ?? [])];
  let next = Math.max(0, ...list.map((id) => Number(id.slice(id.lastIndexOf("-") + 1)))) + 1;

  for (const d of a.fragments) {
    if (!batch.has(d.id) || !list.includes(d.id)) continue;
    const f = await store.readFragment(d.id);
    if (!f) continue;
    if (d.decision === "ok") {
      await store.patchFragment(d.id, (m) => ({ ...m, validated: m.checks !== "ok" || m.validated === "pending" ? "flagged-reviewed" : "sample" }));
    } else if (d.decision === "drop") {
      await store.keepOriginal(d.id);
      list = list.filter((x) => x !== d.id);
      fixes.push(`Dropped ${d.id}`);
    } else if (d.decision === "merge" && d.with && isFragmentId(d.with) && list.indexOf(d.with) === list.indexOf(d.id) + 1) {
      const other = await store.readFragment(d.with);
      if (!other) continue;
      await store.keepOriginal(d.id);
      await store.keepOriginal(d.with);
      await store.writeFragment({ meta: { ...f.meta, tokens: f.meta.tokens + other.meta.tokens, validated: "flagged-reviewed" }, md: `${f.md}\n\n${other.md}` });
      list = list.filter((x) => x !== d.with);
      fixes.push(`Merged ${d.id} and ${d.with}`);
    } else if (d.decision === "split" && d.at) {
      const lines = f.md.split("\n");
      if (d.at > lines.length) continue;
      const head = lines.slice(0, d.at - 1).join("\n").trim();
      const tail = lines.slice(d.at - 1).join("\n").trim();
      if (!head || !tail) continue;
      await store.keepOriginal(d.id);
      const id2 = fragmentId(s.id, next++);
      await store.writeFragment({ meta: { ...f.meta, validated: "flagged-reviewed", tokens: Math.ceil(head.length / 4) }, md: head });
      await store.writeFragment({ meta: { ...f.meta, id: id2, validated: "flagged-reviewed", tokens: Math.ceil(tail.length / 4) }, md: tail });
      list.splice(list.indexOf(d.id) + 1, 0, id2);
      fixes.push(`Split ${d.id}`);
    } else if (d.decision === "repair") {
      repairs.push({ id: d.id, issue: d.issue ?? "Structure" });
    } else if (d.decision === "ask") {
      asks.push({ fragment: d.id, question: d.question ?? `Is ${d.id} right?`, choices: ["keep", "drop"] });
    }
  }
  // Fragments written above stay; the ones left out of `list` go (writeFragments removes their files).
  const kept = (await Promise.all(list.map((id) => store.readFragment(id)))).filter((f): f is Fragment => f !== null);
  await store.writeFragments(s.id, kept);

  if (a.fullReview && !s.fullReview) {
    await store.patch(s.id, (e) => {
      const { stage: _st, reviewQueue: _q, ...r } = e;
      return { ...r, issues, fixes, repairs, asks, verdict: a.verdict, status: "pending", notice: "full-review" };
    });
    await store.writeIndex();
    return;
  }
  const stage = rest.length > 0 ? "review" : repairs.length > 0 ? "repair" : "label";
  await store.patch(s.id, (e) => ({ ...e, issues, fixes, repairs, asks, verdict: a.verdict, stage, status: "validating", reviewQueue: rest.length ? rest : undefined }));
  await store.writeIndex();
}
```

`writeFragments` replaces the list and removes the files of ids it no longer has; `merge` and `split` fragments are written before it, so it writes them again with the same text (harmless). The full review's estimate is set by the app (Task 19).

- [ ] **Step 5: Register the stage**

In `packages/material/src/stages.ts`, add at the end:

```ts
import { STAGE_TOOLS } from "./server";
import { applyReview, reviewAnswer, reviewPrompt, reviewSet } from "./review";
import { BATCH } from "./constants";

STAGE_TOOLS.material_review = {
  description: "Your answer for this batch: the verdict, a decision per fragment, the issues. Call it once.",
  input: reviewAnswer.shape,
};

STAGES.review = {
  tools: ["material_review"],
  async prompt(store, job) {
    const s = await store.source(job.source ?? "");
    if (!s) return null;
    let queue = s.reviewQueue;
    if (!queue || queue.length === 0) {
      queue = await reviewSet(store, s);
      await store.patch(s.id, (e) => ({ ...e, reviewQueue: queue }));
    }
    return queue.length === 0 ? null : reviewPrompt(store, s, queue.slice(0, BATCH));
  },
  async accept(name, args, state) {
    const a = reviewAnswer.parse(args);
    const s = await state.store.source(state.job.source ?? "");
    const batch = new Set((s?.reviewQueue ?? []).slice(0, BATCH));
    const outside = a.fragments.find((d) => !batch.has(d.id));
    if (outside) throw new Error(`${outside.id} is not in this batch`);
    state.answers.push({ name, ...a });
    return "Saved.";
  },
  async apply(store, job, state, ctx) {
    const s = await store.source(job.source ?? "");
    if (s && (s.reviewQueue ?? []).length === 0) {
      // Nothing to review (no fragments): straight to labelling.
      await store.patch(s.id, (e) => ({ ...e, stage: "label" }));
      return true;
    }
    const answer = state.answers.at(-1);
    if (!answer) return false;
    await applyReview(store, job, reviewAnswer.parse(answer), { items: ctx.items !== undefined, ...(ctx.reconvert ? { reconvert: ctx.reconvert } : {}) });
    return true;
  },
};
```

Move the imports to the top of the file. `StageContext` gets `reconvert?: (settings: ConvertSettings) => Promise<void>;` (the app passes `(settings) => processSource(store, id, { items, settings })`, which resets the source to `validating`/`review`: in `MaterialService.stageContext`, take the job and return `{ ..., reconvert: async (settings) => void (await processSource(store, job.source!, { items, settings })) }` — change its signature to `stageContext(job: Job)`).

`accept` and the server both check the answer with the same zod schema (Conventions).

Add `export * from "./review";` to `packages/material/src/index.ts`.

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/material/test/review.test.ts packages/runtime/test/system.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/material packages/runtime packages/shell
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(material): the review stage"
```

---

### Task 19: Repairs, asks and the full review

The repair stage (§6.2) fixes structure only: a repair is accepted when its words differ from the program's version by at most `REPAIR_MAX_WORD_DIFF`; otherwise it is refused and becomes a question for the person. The person answers questions with `decide`. A full review waits for the person with its own estimate.

**Files:**
- Create: `packages/material/src/word-diff.ts`, `packages/material/src/decide.ts`
- Modify: `packages/material/src/stages.ts`, `packages/material/src/index.ts`, `packages/shell/src/main/material.ts`, `packages/shell/src/main/index.ts`, `packages/shell/src/preload/index.ts`, `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts`
- Test: `packages/material/test/repair.test.ts` (new), `packages/shell/test/material.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/material/test/repair.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Fragment, MaterialStore, STAGES, type SourceEntry, decide, wordDiff } from "../src";

let base: string;
let store: MaterialStore;
const f5: Fragment = { meta: { id: "ch2-005", source: "ch2.pdf", location: "p.5", path: "T", summary: "", keywords: [], tokens: 50, items: [], checks: ["table"], validated: "not-reviewed" }, md: "a b c\n1 2 3\n4 5 6" };
const entry: SourceEntry = { id: "ch2", scope: "fractions", path: "ch2.pdf", hash: "x", type: "pdf", family: "pdf", pages: 9, sizeBytes: 1, skippedPages: [], status: "validating", stage: "repair", repairs: [{ id: "ch2-005", issue: "Table lost its columns" }], issues: [], fixes: [], estimate: 0, used: 0, fragments: [], addedAt: "2026-10-27T00:00:00.000Z" };
const job = { scope: "fractions", source: "ch2", stage: "repair" as const };
const ctx = { fragmentKinds: [], sheetSections: [], sheetMaxTokens: 800 };

beforeEach(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "hh-repair-"));
  store = new MaterialStore(base, "fractions");
  await store.update(() => [entry]);
  await store.writeFragments("ch2", [f5]);
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("wordDiff", () => {
  it("counts changed words, ignoring Markdown marks and spacing", () => {
    expect(wordDiff("a b c\n1 2 3", "| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |")).toBe(0);
    expect(wordDiff("one two three four", "one two three five")).toBe(0.25);
  });
});

describe("the repair stage", () => {
  it("accepts a structure-only repair; keeps the program's version", async () => {
    const state = { store, job, answers: [] };
    expect(await STAGES.repair!.prompt(store, job, ctx)).toContain("Table lost its columns");
    expect(await STAGES.repair!.accept("material_repair", { id: "ch2-005", markdown: "| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |" }, state)).toBe("Saved.");
    expect(await STAGES.repair!.apply(store, job, state, ctx)).toBe(true);
    expect((await store.readFragment("ch2-005"))?.meta.validated).toBe("repaired");
    expect((await store.readOriginalVersion("ch2-005"))?.md).toBe("a b c\n1 2 3\n4 5 6");
    expect(await store.source("ch2")).toMatchObject({ stage: "label", fixes: ["Repaired ch2-005: Table lost its columns"] });
  });

  it("refuses a repair that changes words, and asks the person", async () => {
    const state = { store, job, answers: [] };
    await STAGES.repair!.prompt(store, job, ctx);
    await expect(STAGES.repair!.accept("material_repair", { id: "ch2-005", markdown: "x y z\n7 8 9\n4 5 6" }, state)).rejects.toThrow("changes the words");
    await STAGES.repair!.apply(store, job, state, ctx);
    expect((await store.source("ch2"))?.asks).toEqual([{ fragment: "ch2-005", question: expect.stringContaining("ch2-005"), choices: ["program", "drop"] }]);
  });

  it("refuses a fragment the review didn't ask to repair", async () => {
    const state = { store, job, answers: [] };
    await expect(STAGES.repair!.accept("material_repair", { id: "ch2-001", markdown: "x" }, state)).rejects.toThrow("not to repair");
  });
});

describe("decide (§6.2 ask)", () => {
  it("drop a fragment; keep one; use or remove a source", async () => {
    await store.patch("ch2", (s) => ({ ...s, asks: [{ fragment: "ch2-005", question: "?", choices: ["keep", "drop"] }] }));
    expect(await decide(store, "ch2", "ch2-005", "drop", async () => {})).toBe(true);
    expect((await store.source("ch2"))?.fragments).toEqual([]);
    expect((await store.source("ch2"))?.asks).toEqual([]);
    await store.patch("ch2", (s) => ({ ...s, status: "needs-person", asks: [{ question: "?", choices: ["use", "remove"] }] }));
    expect(await decide(store, "ch2", null, "use", async () => {})).toBe(true);
    expect((await store.source("ch2"))?.status).toBe("ready");
    expect(await decide(store, "ch2", null, "keep", async () => {})).toBe(false);
  });

  it("remove: the original goes to the Trash, the fragments go, the source is marked removed", async () => {
    await store.patch("ch2", (s) => ({ ...s, status: "needs-person", asks: [{ question: "?", choices: ["use", "remove"] }] }));
    const trashed: string[] = [];
    expect(await decide(store, "ch2", null, "remove", async (file) => void trashed.push(file))).toBe(true);
    expect(trashed).toEqual([path.join(base, "material", "fractions", "ch2.pdf")]);
    expect(await store.source("ch2")).toMatchObject({ status: "removed", fragments: [] });
  });
});
```

In `packages/shell/test/material.test.ts`, add: a source `pending` with `notice: "full-review"` is confirmed through `service.confirm(scope, id, {})` into `validating`/`review` with `fullReview: true`, without converting again (its fragments keep their ids); and `service.decide("fractions", id, null, "use")` answers `{ ok: true }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run packages/material/test/repair.test.ts`
Expected: FAIL (`wordDiff` is not exported).

- [ ] **Step 3: Word difference and decisions**

Create `packages/material/src/word-diff.ts`:

```ts
const words = (md: string): string[] =>
  md
    .replace(/[#*_`>|~\-\[\]()]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

/**
 * The share of words a repair changed (§6.2): words added plus words removed, over the longer text's words. Markdown
 * marks and spacing don't count, so a table rebuilt from loose lines counts 0.
 */
export function wordDiff(before: string, after: string): number {
  const a = words(before);
  const b = words(after);
  const count = new Map<string, number>();
  for (const w of a) count.set(w, (count.get(w) ?? 0) + 1);
  let added = 0;
  for (const w of b) {
    const n = count.get(w) ?? 0;
    if (n > 0) count.set(w, n - 1);
    else added++;
  }
  const removed = [...count.values()].reduce((x, y) => x + y, 0);
  return (added + removed) / Math.max(a.length, b.length, 1) / 2;
}
```

(`/ 2`: a replaced word counts once, not as one added and one removed; `one two three four` → `one two three five` is 0.25.)

Create `packages/material/src/decide.ts`:

```ts
import type { MaterialStore } from "./store";
import type { Fragment, MaterialAsk } from "./types";

/**
 * The person's answer to a question (§6.2 `ask`): `keep`, `drop` or `program` for a fragment; `use` or `remove` for a
 * whole source. False when there is no such question or choice. `trash` moves the original to the system Trash.
 */
export async function decide(store: MaterialStore, sourceId: string, fragment: string | null, choice: MaterialAsk["choices"][number], trash: (file: string) => Promise<void>): Promise<boolean> {
  const s = await store.source(sourceId);
  const ask = s?.asks?.find((a) => (a.fragment ?? null) === fragment && a.choices.includes(choice));
  if (!s || !ask) return false;
  const others = (s.asks ?? []).filter((a) => a !== ask);
  if (choice === "remove") {
    await removeSource(store, sourceId, trash);
    return true;
  }
  if (choice === "use") {
    await store.patch(sourceId, (e) => ({ ...e, asks: others, status: "ready" }));
    await store.setStale("sheet");
  } else if (choice === "drop" && fragment) {
    await store.keepOriginal(fragment);
    const kept = (await Promise.all(s.fragments.filter((id) => id !== fragment).map((id) => store.readFragment(id)))).filter((f): f is Fragment => f !== null);
    await store.writeFragments(sourceId, kept);
    await store.patch(sourceId, (e) => ({ ...e, asks: others, fixes: [...e.fixes, `Dropped ${fragment} (your decision)`] }));
  } else {
    // keep / program: the fragment stays as the program made it, reviewed by the person.
    if (fragment) await store.patchFragment(fragment, (m) => ({ ...m, validated: "flagged-reviewed" }));
    await store.patch(sourceId, (e) => ({ ...e, asks: others }));
  }
  await store.writeIndex();
  return true;
}

/**
 * Removes a source (§11): its original to the system Trash (never deleted for good), its fragments and their kept
 * versions gone, its entry marked `removed` (kept in `sources.json` so the history shows it went). The scope's sheet
 * and links run again.
 */
export async function removeSource(store: MaterialStore, sourceId: string, trash: (file: string) => Promise<void>): Promise<boolean> {
  const s = await store.source(sourceId);
  if (!s || s.status === "removed") return false;
  const file = store.originalPath(s.path);
  if (file) await trash(file).catch((err: unknown) => console.error("Could not move the original to the Trash", err));
  await store.writeFragments(sourceId, []);
  await store.patch(sourceId, (e) => {
    const { stage: _s, reviewQueue: _q, repairs: _r, ...rest } = e;
    return { ...rest, status: "removed", fragments: [], asks: [] };
  });
  await store.setStale("sheet");
  await store.writeIndex();
  return true;
}
```

- [ ] **Step 4: The repair stage**

In `packages/material/src/stages.ts`, add:

```ts
import { z } from "zod";
import { REPAIR_MAX_WORD_DIFF } from "./constants";
import { wordDiff } from "./word-diff";

const repairAnswer = z.object({ id: z.string(), markdown: z.string().min(1).max(20_000) });

STAGE_TOOLS.material_repair = {
  description: "The repaired Markdown of one fragment: structure only (headings, lists, tables, line breaks), the same words. Call it once per fragment.",
  input: repairAnswer.shape,
};

STAGES.repair = {
  tools: ["material_repair"],
  async prompt(store, job) {
    const s = await store.source(job.source ?? "");
    if (!s?.repairs?.length) return null;
    const parts: string[] = [];
    for (const r of s.repairs) {
      const f = await store.readFragment(r.id);
      if (f) parts.push(`[${r.id}] Problem: ${r.issue}\n${f.md}`);
    }
    return [
      "material-repair",
      `Fix the structure of these fragments of "${s.path}": headings, lists, tables and line breaks. Keep every word as it is: don't add, remove, translate or correct words. A repair that changes the words is refused.`,
      "For each fragment, call `material_repair` with its id and the whole repaired Markdown.",
      parts.join("\n\n---\n\n"),
    ].join("\n\n");
  },
  async accept(name, args, state) {
    const a = repairAnswer.parse(args);
    const s = await state.store.source(state.job.source ?? "");
    if (!s?.repairs?.some((r) => r.id === a.id)) throw new Error(`${a.id} is not to repair`);
    const f = await state.store.readFragment(a.id);
    if (!f) throw new Error(`No fragment ${a.id}`);
    if (wordDiff(f.md, a.markdown) > REPAIR_MAX_WORD_DIFF) {
      state.answers.push({ name, id: a.id, refused: true });
      throw new Error("This repair changes the words; it was not kept");
    }
    state.answers.push({ name, ...a });
    return "Saved.";
  },
  async apply(store, job, state) {
    const s = await store.source(job.source ?? "");
    if (!s) return false;
    const fixes = [...s.fixes];
    const asks = [...(s.asks ?? [])];
    for (const r of s.repairs ?? []) {
      const done = state.answers.filter((a) => a.id === r.id).at(-1);
      if (done && !done.refused && typeof done.markdown === "string") {
        await store.keepOriginal(r.id);
        const f = await store.readFragment(r.id);
        if (f) await store.writeFragment({ meta: { ...f.meta, validated: "repaired", tokens: Math.ceil(done.markdown.length / 4) }, md: done.markdown });
        fixes.push(`Repaired ${r.id}: ${r.issue}`);
      } else if (done?.refused) {
        asks.push({ fragment: r.id, question: `The AI's fix of ${r.id} changed its words, so it wasn't kept. Keep the program's version, or drop the fragment?`, choices: ["program", "drop"] });
      }
    }
    await store.patch(s.id, (e) => {
      const { repairs: _r, ...rest } = e;
      return { ...rest, fixes, asks, stage: "label" };
    });
    await store.writeIndex();
    return true;
  },
};
```

(Imports at the top of the file, merged with the existing ones.) A repair session that answers nothing still moves the source on to labelling: its fragments stay `not-reviewed`.

Add `export * from "./word-diff";` and `export * from "./decide";` to `packages/material/src/index.ts`.

- [ ] **Step 5: The full review and `decide` in the app**

In `packages/shell/src/main/material.ts`:

1. `confirm`: when the source waits with `notice: "full-review"`, don't convert:

```ts
    const waiting = await store.source(id);
    if (waiting?.notice === "full-review") {
      await store.patch(id, (e) => {
        const { notice: _n, reviewQueue: _q, ...rest } = e;
        return { ...rest, fullReview: true, status: "validating", stage: "review" };
      });
      this.d.kick?.();
      await this.changed(store.scope);
      return { ok: true };
    }
```

2. The full review's estimate (§7 "A full review is needed"): `runJob`, after applying a review whose source went `pending` with `full-review`, sets `estimate: fragments × REVIEW_TOKENS` (measured average when Task 25 has one):

```ts
    const after = job.source ? await store.source(job.source) : null;
    if (after?.notice === "full-review") await store.patch(after.id, (e) => ({ ...e, estimate: e.fragments.length * REVIEW_TOKENS }));
```

3. `decide`:

```ts
  async decide(scope: unknown, id: unknown, fragment: unknown, choice: unknown): Promise<MaterialResult> {
    const store = await this.store(scope);
    if (typeof store === "string") return { ok: false, reason: store };
    const choices = ["keep", "drop", "program", "use", "remove"] as const;
    if (!isSourceId(id) || (fragment !== null && !isFragmentId(fragment)) || !choices.includes(choice as never)) return { ok: false, reason: "invalid" };
    if (!(await decide(store, id, fragment as string | null, choice as (typeof choices)[number], (file) => this.d.trash(file)))) return { ok: false, reason: "invalid" };
    await this.d.afterChange(store.scope, `decided ${id}`);
    await this.changed(store.scope);
    return { ok: true };
  }
```

`MaterialDeps` gets `trash(file: string): Promise<void>`; `index.ts` passes `trash: (file) => shell.trashItem(file)`; the test deps pass a function that records the path.

4. The view carries the questions: `MaterialSourceView` gets `asks: { fragment?: string; question: string; choices: string[] }[]`, filled from `s.asks ?? []`.

IPC: `handle("hh:materialDecide", (scope: unknown, id: unknown, fragment: unknown, choice: unknown) => materialSvc?.decide(scope, id, fragment, choice) ?? noMaterial);`. Preload: `decide: (scope, id, fragment, choice) => ipcRenderer.invoke("hh:materialDecide", scope, id, fragment, choice)`. `ui/src/client.ts`: `MaterialSourceView.asks: { fragment?: string; question: string; choices: ("keep" | "drop" | "program" | "use" | "remove")[] }[]`, `MaterialClient.decide(scope: string, id: string, fragment: string | null, choice: "keep" | "drop" | "program" | "use" | "remove"): Promise<MaterialResult>`. The fake client records `decide:<id>:<fragment ?? "-">:<choice>`. Update `material-panel.test.tsx`'s `src()` with `asks: []`.

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/material/test/repair.test.ts packages/shell/test/material.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/material packages/shell packages/ui
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(material): repairs within a word budget, questions for the person, full review"
```

---

### Task 20: The panel: ask cards and review results

**Files:**
- Modify: `packages/ui/src/MaterialPanel.tsx`, `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/material-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `packages/ui/test/material-panel.test.tsx`:

```tsx
describe("questions and results (§6.2, §11)", () => {
  it("a question about a fragment, and one about the whole source", async () => {
    const client = await panel(
      view([
        src({ id: "a", name: "a.pdf", asks: [{ fragment: "a-005", question: "Is this table right?", choices: ["keep", "drop"] }] }),
        src({ id: "b", name: "b.pdf", status: "needs-person", asks: [{ question: "The AI couldn't make b.pdf readable.", choices: ["use", "remove"] }] }),
      ]),
    );
    expect(await screen.findByText("Is this table right?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Drop it" }));
    fireEvent.click(screen.getByRole("button", { name: "Use it as it is" }));
    await waitFor(() => expect(client.materialCalls).toEqual(["decide:a:a-005:drop", "decide:b:-:use"]));
    expect(screen.getByText("b.pdf: needs your decision")).toBeTruthy();
  });

  it("what the check found and fixed, folded under the status line", async () => {
    await panel(view([src({ verdict: "usable-with-fixes", issues: ["Two fragments cut mid-sentence"], fixes: ["Merged ch2-001 and ch2-002"] })]));
    fireEvent.click(await screen.findByText("What the check found"));
    expect(screen.getByText("Two fragments cut mid-sentence")).toBeTruthy();
    expect(screen.getByText("Merged ch2-001 and ch2-002")).toBeTruthy();
  });

  it("a full review waits with its own estimate", async () => {
    await panel(view([src({ status: "pending", notice: "full-review", estimate: 16200, fragments: 18 })]));
    expect(await screen.findByText("The check found problems beyond its sample. Checking every fragment of ch2.pdf will use about 16,200 tokens.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check everything" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/material-panel.test.tsx`
Expected: FAIL (no question text).

- [ ] **Step 3: Strings**

In `en.json` → `material`:

```json
    "choice": {
      "keep": "Keep it",
      "drop": "Drop it",
      "program": "Keep the program's version",
      "use": "Use it as it is",
      "remove": "Remove it"
    },
    "found": "What the check found",
    "fullReview": "The check found problems beyond its sample. Checking every fragment of {{name}} will use about {{tokens}} tokens.",
    "checkAll": "Check everything",
```

- [ ] **Step 4: The panel**

In `MaterialPanel.tsx`:

1. `WaitingCard`: for `notice === "full-review"`, the text is `t("material.fullReview", vars)` (with `tokens: fmt(source.estimate)`), no page range, and one button `t("material.checkAll")` that calls `confirm(scope, source.id, {})`.

2. A component for a source's questions and results, drawn under each non-waiting status line:

```tsx
function SourceDetails({ client, scope, source }: { client: HarnessClient; scope: string; source: MaterialSourceView }) {
  const { t } = useTranslation();
  return (
    <>
      {source.asks.map((a) => (
        <div key={`${a.fragment ?? "-"}:${a.question}`} className="hh-material-card" role="group" aria-label={a.question}>
          <p>{a.question}</p>
          <div className="hh-material-actions">
            {a.choices.map((c) => (
              <button key={c} type="button" onClick={() => void client.material.decide(scope, source.id, a.fragment ?? null, c)}>
                {t(`material.choice.${c}`)}
              </button>
            ))}
          </div>
        </div>
      ))}
      {(source.issues.length > 0 || source.fixes.length > 0) && (
        <details className="hh-material-found">
          <summary>{t("material.found")}</summary>
          <ul>
            {[...source.issues, ...source.fixes].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
```

and in the source list, a non-waiting source renders `<p className="hh-material-line">…</p>` followed by `<SourceDetails … />` inside a `<div key={s.id}>`.

`styles.css`: `.hh-material-found summary { cursor: pointer; color: var(--hh-muted); }` (the muted-text token the file uses).

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test/material-panel.test.tsx`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/ui packages/i18n
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(ui): material questions and what the check found"
```

---

### Task 21: Labels

The label stage (§6.2, §8) gives each fragment an English one-sentence summary, keywords in the material's own language and one of the harness's `fragmentKinds`, in batches of `BATCH`. When the last batch is done the source is `ready` and the scope's sheet is due.

**Files:**
- Create: `packages/material/src/label.ts`
- Modify: `packages/material/src/stages.ts`, `packages/material/src/index.ts`, `packages/shell/src/main/material.ts`
- Test: `packages/material/test/label.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/material/test/label.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Fragment, MaterialStore, STAGES, STAGE_TOOLS, type SourceEntry, unlabelled } from "../src";

let base: string;
let store: MaterialStore;
const frag = (n: number): Fragment => ({
  meta: { id: `ch2-${String(n).padStart(3, "0")}`, source: "ch2.pdf", location: `p.${n}`, path: `T › P${n}`, summary: `First sentence ${n}.`, keywords: [], tokens: 50, items: [], checks: "ok", validated: "not-reviewed" },
  md: `Texto ${n} sobre fracciones.`,
});
const entry: SourceEntry = { id: "ch2", scope: "fractions", path: "ch2.pdf", hash: "x", type: "pdf", family: "pdf", pages: 9, sizeBytes: 1, skippedPages: [], status: "validating", stage: "label", issues: [], fixes: [], estimate: 0, used: 0, fragments: [], addedAt: "2026-10-27T00:00:00.000Z" };
const job = { scope: "fractions", source: "ch2", stage: "label" as const };
const ctx = { fragmentKinds: ["explanation", "example"], sheetSections: [], sheetMaxTokens: 800 };

beforeEach(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "hh-label-"));
  store = new MaterialStore(base, "fractions");
  await store.update(() => [entry]);
  await store.writeFragments("ch2", Array.from({ length: 25 }, (_, i) => frag(i + 1)));
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("the label stage", () => {
  it("batches of 20; the prompt lists the kinds and asks for keywords in the material's language", async () => {
    expect(Object.hasOwn(STAGE_TOOLS, "material_label")).toBe(true);
    expect((await unlabelled(store, "ch2")).length).toBe(25);
    const prompt = (await STAGES.label!.prompt(store, job, ctx))!;
    expect(prompt.startsWith("material-label\n")).toBe(true);
    expect(prompt).toContain("explanation, example");
    expect(prompt).toContain("in the material's own language");
    expect(prompt).toContain("[ch2-020]");
    expect(prompt).not.toContain("[ch2-021]");
  });

  it("applies labels; refuses unknown kinds and ids outside the batch; ready after the last batch", async () => {
    const state = { store, job, answers: [], ctx };
    await STAGES.label!.prompt(store, job, ctx);
    const labels = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ id: `ch2-${String(from + i).padStart(3, "0")}`, summary: "Explains equivalent fractions.", keywords: ["fracciones equivalentes"], kind: "explanation" }));
    await expect(STAGES.label!.accept("material_label", { fragments: [{ ...labels(1, 1)[0], kind: "poem" }] }, state)).rejects.toThrow('"poem" is not a fragment kind');
    await expect(STAGES.label!.accept("material_label", { fragments: labels(21, 21) }, state)).rejects.toThrow("not in this batch");
    expect(await STAGES.label!.accept("material_label", { fragments: labels(1, 20) }, state)).toBe("Saved.");
    expect(await STAGES.label!.apply(store, job, state, ctx)).toBe(true);
    expect((await store.readFragment("ch2-001"))?.meta).toMatchObject({ summary: "Explains equivalent fractions.", keywords: ["fracciones equivalentes"], kind: "explanation" });
    expect(await store.source("ch2")).toMatchObject({ status: "validating", stage: "label" });

    const state2 = { store, job, answers: [], ctx };
    await STAGES.label!.prompt(store, job, ctx);
    await STAGES.label!.accept("material_label", { fragments: labels(21, 25) }, state2);
    await STAGES.label!.apply(store, job, state2, ctx);
    expect((await store.source("ch2"))?.status).toBe("ready");
    expect((await store.source("ch2"))?.stage).toBeUndefined();
    expect(await store.stale()).toBe("sheet");
  });

  it("no answer: the stage fails", async () => {
    await STAGES.label!.prompt(store, job, ctx);
    expect(await STAGES.label!.apply(store, job, { store, job, answers: [], ctx }, ctx)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run packages/material/test/label.test.ts`
Expected: FAIL (`unlabelled` is not exported).

- [ ] **Step 3: The stage state carries the context**

`StageState` (in `stages.ts`) gets `ctx: StageContext`; `MaterialService.runJob` builds `const state: StageState = { store, job, answers: [], ctx };`. Update the `state` objects in `review.test.ts` and `repair.test.ts` with `ctx`.

- [ ] **Step 4: Write the labels**

Create `packages/material/src/label.ts`:

```ts
import { z } from "zod";
import { BATCH } from "./constants";
import type { MaterialStore } from "./store";
import type { Fragment } from "./types";

export const labelAnswer = z.object({
  fragments: z
    .array(
      z.object({
        id: z.string(),
        summary: z.string().min(1).max(200),
        keywords: z.array(z.string().min(1).max(40)).min(1).max(8),
        kind: z.string().min(1).max(64),
      }),
    )
    .min(1)
    .max(BATCH),
});

/** A source's fragments without labels yet (labelling always gives at least one keyword). */
export async function unlabelled(store: MaterialStore, sourceId: string): Promise<Fragment[]> {
  const s = await store.source(sourceId);
  if (!s) return [];
  const list = await Promise.all(s.fragments.map((id) => store.readFragment(id)));
  return list.filter((f): f is Fragment => f !== null && f.meta.keywords.length === 0);
}

export function labelPrompt(path: string, batch: Fragment[], kinds: readonly string[]): string {
  return [
    "material-label",
    `Label these fragments of "${path}". For each one give: a summary, one English sentence of at most 200 characters saying what it covers; 1 to 8 keywords or short phrases in the material's own language, the words someone would search for; and its kind, one of: ${kinds.join(", ")}.`,
    "If a fragment reads wrong (garbled, cut, a broken table), call `material_flag` with its id and why, then label it anyway.",
    "Answer by calling `material_label` once with every fragment below.",
    batch.map((f) => `[${f.meta.id}] (${f.meta.path || f.meta.location})\n${f.md}`).join("\n\n---\n\n"),
  ].join("\n\n");
}
```

- [ ] **Step 5: Register the stage**

In `packages/material/src/stages.ts` add (imports at the top):

```ts
import { labelAnswer, labelPrompt, unlabelled } from "./label";
import { flagFragment } from "./use";

STAGE_TOOLS.material_label = {
  description: "The labels of this batch: for every fragment its summary, keywords and kind.",
  input: labelAnswer.shape,
};
STAGE_TOOLS.material_flag = {
  description: "Reports a fragment that reads wrong (garbled, cut, a broken table). It is checked again later.",
  input: { id: z.string(), reason: z.string().min(1).max(300) },
};

STAGES.label = {
  tools: ["material_label", "material_flag"],
  async prompt(store, job, ctx) {
    const s = await store.source(job.source ?? "");
    const batch = (await unlabelled(store, job.source ?? "")).slice(0, BATCH);
    return !s || batch.length === 0 ? null : labelPrompt(s.path, batch, ctx.fragmentKinds);
  },
  async accept(name, args, state) {
    if (name === "material_flag") {
      const id = String(args.id ?? "");
      if (!(await flagFragment(state.store, id, String(args.reason ?? "")))) throw new Error(`No fragment ${id.slice(0, 80)}`);
      return "Thanks: it will be checked again.";
    }
    const a = labelAnswer.parse(args);
    const batch = new Set((await unlabelled(state.store, state.job.source ?? "")).slice(0, BATCH).map((f) => f.meta.id));
    const outside = a.fragments.find((f) => !batch.has(f.id));
    if (outside) throw new Error(`${outside.id} is not in this batch`);
    const kind = a.fragments.find((f) => !state.ctx.fragmentKinds.includes(f.kind));
    if (kind) throw new Error(`"${kind.kind}" is not a fragment kind`);
    state.answers.push({ name, ...a });
    return "Saved.";
  },
  async apply(store, job, state) {
    const s = await store.source(job.source ?? "");
    if (!s) return false;
    const left = await unlabelled(store, s.id);
    if (left.length > 0) {
      const given = state.answers.flatMap((a) => labelAnswer.safeParse(a).data?.fragments ?? []);
      if (given.length === 0) return false;
      for (const l of given) {
        await store.patchFragment(l.id, (m) => ({ ...m, summary: l.summary, keywords: l.keywords, kind: l.kind }));
      }
    }
    if ((await unlabelled(store, s.id)).length > 0) {
      await store.writeIndex();
      return true;
    }
    // The last batch (§10): the source is ready; the scope's sheet and links are due. A flag during labelling has
    // sent it back to review (Task 13): then it stays there.
    await store.patch(s.id, (e) => {
      if (e.stage !== "label") return e;
      const { stage: _stage, ...rest } = e;
      return { ...rest, status: "ready", estimate: 0 };
    });
    await store.setStale("sheet");
    await store.writeIndex();
    return true;
  },
};
```

`labelAnswer.safeParse(a)` reads an accepted answer back (zod drops its extra `name` key).

Add `export * from "./label";` to `packages/material/src/index.ts`.

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/material/test/label.test.ts packages/material/test/review.test.ts packages/material/test/repair.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/material packages/shell
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(material): the label stage"
```

---

### Task 22: The sheet

Once per scope after a burst of sources (§8): a short English sheet with the harness's sections plus "Notation and conventions" and "What the material does not cover", cut to `sheet.maxTokens`. Its input is the index (summaries, paths, kinds), never whole fragments, so it stays cheap; the stage may read single fragments with `material_read`.

**Files:**
- Create: `packages/material/src/sheet.ts`
- Modify: `packages/material/src/stages.ts`, `packages/material/src/index.ts`
- Test: `packages/material/test/sheet-stage.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/material/test/sheet-stage.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MaterialStore, STAGES, type SourceEntry, composeSheet } from "../src";

let base: string;
let store: MaterialStore;
const entry: SourceEntry = { id: "ch2", scope: "fractions", path: "ch2.pdf", hash: "x", type: "pdf", family: "pdf", pages: 9, sizeBytes: 1, skippedPages: [], status: "ready", issues: [], fixes: [], estimate: 0, used: 0, fragments: [], addedAt: "2026-10-27T00:00:00.000Z" };
const sections = [{ id: "terms", label: "Key terms", prompt: "List the key terms with a one-line definition." }];
const ctx = { fragmentKinds: ["explanation"], sheetSections: sections, sheetMaxTokens: 200 };
const job = { scope: "fractions", stage: "sheet" as const };

beforeEach(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "hh-sheet-"));
  store = new MaterialStore(base, "fractions");
  await store.update(() => [entry]);
  await store.writeFragments("ch2", [{ meta: { id: "ch2-001", source: "ch2.pdf", location: "p.1", path: "Fractions", kind: "explanation", summary: "Defines a fraction.", keywords: ["fracción"], tokens: 50, items: [], checks: "ok", validated: "sample" }, md: "Una fracción…" }]);
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("composeSheet", () => {
  it("the harness's sections, then the core ones, under their labels, cut at a line to the budget", () => {
    const md = composeSheet(sections, [{ id: "not-covered", markdown: "Decimals." }, { id: "terms", markdown: "- fraction: a part of a whole" }, { id: "notation", markdown: "a/b" }], 800);
    expect(md).toBe("## Key terms\n\n- fraction: a part of a whole\n\n## Notation and conventions\n\na/b\n\n## What the material does not cover\n\nDecimals.");
    const long = composeSheet(sections, [{ id: "terms", markdown: Array.from({ length: 100 }, (_, i) => `- term ${i}: something`).join("\n") }], 100);
    expect(long.length).toBeLessThanOrEqual(100 * 4);
    expect(long.endsWith("something")).toBe(true);
  });
});

describe("the sheet stage", () => {
  it("prompts with the index and the sections; writes sheet.md", async () => {
    const prompt = (await STAGES.sheet!.prompt(store, job, ctx))!;
    expect(prompt.startsWith("material-sheet\n")).toBe(true);
    expect(prompt).toContain("terms: Key terms: List the key terms");
    expect(prompt).toContain("notation: Notation and conventions");
    expect(prompt).toContain("| ch2-001 | ch2.pdf, p.1 | Fractions | explanation | Defines a fraction. |");
    const state = { store, job, answers: [], ctx };
    expect(await STAGES.sheet!.accept("material_sheet", { sections: [{ id: "terms", markdown: "- fraction" }] }, state)).toBe("Saved.");
    await expect(STAGES.sheet!.accept("material_sheet", { sections: [{ id: "poems", markdown: "x" }] }, state)).rejects.toThrow('"poems" is not a sheet section');
    expect(await STAGES.sheet!.apply(store, job, state, ctx)).toBe(true);
    expect(await store.sheet()).toBe("## Key terms\n\n- fraction\n");
  });

  it("no usable fragments: an empty sheet, no session", async () => {
    await store.update((l) => l.map((s) => ({ ...s, status: "removed" as const })));
    expect(await STAGES.sheet!.prompt(store, job, ctx)).toBeNull();
    expect(await STAGES.sheet!.apply(store, job, { store, job, answers: [], ctx }, ctx)).toBe(true);
    expect(await store.sheet()).toBe("");
  });
});
```

`store.sheet()` is `""` for a missing file, so an empty sheet is a removed file (`clearSheet`, Step 3).

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run packages/material/test/sheet-stage.test.ts`
Expected: FAIL (`composeSheet` is not exported).

- [ ] **Step 3: Write the sheet**

Add to `MaterialStore` (`store.ts`):

```ts
  async clearSheet(): Promise<void> {
    await fs.rm(path.join(this.dir, "sheet.md"), { force: true });
  }
```

Create `packages/material/src/sheet.ts`:

```ts
import { CORE_SHEET_SECTIONS } from "@humanharness/harness-sdk";
import { estimateTokens } from "@humanharness/workspace";
import { z } from "zod";
import type { IndexRow } from "./store";

export const sheetAnswer = z.object({ sections: z.array(z.object({ id: z.string(), markdown: z.string().max(8000) })).min(1).max(10) });

type Section = { id: string; label: string; prompt: string };

const ordered = (sections: readonly Section[]): { id: string; label: string }[] => [
  ...sections,
  ...Object.entries(CORE_SHEET_SECTIONS).map(([id, label]) => ({ id, label })),
];

/** The sheet (§8): sections in the harness's order, then the core ones; cut at a line once `maxTokens` is reached. */
export function composeSheet(sections: readonly Section[], given: { id: string; markdown: string }[], maxTokens: number): string {
  const lines: string[] = [];
  for (const s of ordered(sections)) {
    const g = given.find((x) => x.id === s.id);
    if (!g?.markdown.trim()) continue;
    if (lines.length) lines.push("");
    lines.push(`## ${s.label}`, "", ...g.markdown.trim().split("\n"));
  }
  const out: string[] = [];
  for (const line of lines) {
    if (estimateTokens([...out, line].join("\n")) > maxTokens) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

export function sheetPrompt(sections: readonly Section[], rows: IndexRow[], maxTokens: number): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|");
  return [
    "material-sheet",
    `Write a short sheet about the person's material in this scope, in English, at most about ${maxTokens} tokens in all. A task reads it before anything else, so it says what the material is and how it talks. Sections (id: title: what to write):`,
    [...sections.map((s) => `- ${s.id}: ${s.label}: ${s.prompt}`), `- notation: ${CORE_SHEET_SECTIONS.notation}: the symbols, units and conventions the material uses.`, `- not-covered: ${CORE_SHEET_SECTIONS["not-covered"]}: what someone would expect here that the material doesn't cover.`].join("\n"),
    "Use the index below; read a fragment with `material_read` only when a summary isn't enough. Answer once with `material_sheet`.",
    ["| id | where | path | kind | summary |", "|---|---|---|---|---|", ...rows.map((r) => `| ${r.id} | ${cell(r.where)} | ${cell(r.path)} | ${cell(r.kind)} | ${cell(r.summary)} |`)].join("\n"),
  ].join("\n\n");
}
```

- [ ] **Step 4: Register the stage**

In `packages/material/src/stages.ts` (imports at the top):

```ts
import { CORE_SHEET_SECTIONS } from "@humanharness/harness-sdk";
import { composeSheet, sheetAnswer, sheetPrompt } from "./sheet";

STAGE_TOOLS.material_sheet = { description: "The sheet: one Markdown text per section id.", input: sheetAnswer.shape };

STAGES.sheet = {
  tools: ["material_sheet"],
  async prompt(store, _job, ctx) {
    const rows = await store.indexRows();
    return rows.length === 0 ? null : sheetPrompt(ctx.sheetSections, rows, ctx.sheetMaxTokens);
  },
  async accept(name, args, state) {
    const a = sheetAnswer.parse(args);
    const known = new Set([...state.ctx.sheetSections.map((s) => s.id), ...Object.keys(CORE_SHEET_SECTIONS)]);
    const bad = a.sections.find((s) => !known.has(s.id));
    if (bad) throw new Error(`"${bad.id}" is not a sheet section`);
    state.answers.push({ name, ...a });
    return "Saved.";
  },
  async apply(store, _job, state, ctx) {
    if ((await store.indexRows()).length === 0) {
      await store.clearSheet();
      return true;
    }
    const a = state.answers.at(-1);
    const parsed = a ? sheetAnswer.safeParse(a) : null;
    if (!parsed?.success) return false;
    const md = composeSheet(ctx.sheetSections, parsed.data.sections, ctx.sheetMaxTokens);
    if (md) await store.writeSheet(md);
    else await store.clearSheet();
    return true;
  },
};
```

Add `export * from "./sheet";` to `packages/material/src/index.ts`.

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/material/test/sheet-stage.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/material
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(material): the scope's sheet"
```

---

### Task 23: Links to items and coverage

With `material.items`, the link stage (§8) ties fragments to the keys of the items collection, given as `key: label` lines. Unknown keys are dropped. Coverage is the items with no fragment; the panel lists them.

**Files:**
- Create: `packages/material/src/link.ts`
- Modify: `packages/material/src/stages.ts`, `packages/material/src/index.ts`, `packages/shell/src/main/material.ts`, `packages/shell/src/main/index.ts`, `packages/ui/src/MaterialPanel.tsx`, `packages/i18n/src/locales/en.json`
- Test: `packages/material/test/link.test.ts` (new), `packages/shell/test/material.test.ts`, `packages/ui/test/material-panel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/material/test/link.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MaterialStore, STAGES, type SourceEntry, uncovered } from "../src";

let base: string;
let store: MaterialStore;
const entry: SourceEntry = { id: "ch2", scope: "fractions", path: "ch2.pdf", hash: "x", type: "pdf", family: "pdf", pages: 9, sizeBytes: 1, skippedPages: [], status: "ready", issues: [], fixes: [], estimate: 0, used: 0, fragments: [], addedAt: "2026-10-27T00:00:00.000Z" };
const items = [{ key: "halves", label: "Halves" }, { key: "equivalent", label: "Equivalent fractions" }, { key: "decimals", label: "Decimals" }];
const ctx = { fragmentKinds: [], sheetSections: [], sheetMaxTokens: 800, items };
const job = { scope: "fractions", stage: "link" as const };
const meta = (id: string) => ({ id, source: "ch2.pdf", location: "p.1", path: "F", summary: `About ${id}.`, keywords: ["x"], tokens: 50, items: [], checks: "ok" as const, validated: "sample" as const });

beforeEach(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "hh-link-"));
  store = new MaterialStore(base, "fractions");
  await store.update(() => [entry]);
  await store.writeFragments("ch2", [{ meta: meta("ch2-001"), md: "a" }, { meta: meta("ch2-002"), md: "b" }]);
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("the link stage", () => {
  it("lists items as key: label and fragments by summary; keeps known keys only", async () => {
    const prompt = (await STAGES.link!.prompt(store, job, ctx))!;
    expect(prompt.startsWith("material-link\n")).toBe(true);
    expect(prompt).toContain("halves: Halves");
    expect(prompt).toContain("[ch2-001] About ch2-001.");
    const state = { store, job, answers: [], ctx };
    await STAGES.link!.accept("material_link", { links: [{ fragment: "ch2-001", items: ["halves", "nope"] }, { fragment: "ch2-002", items: ["equivalent"] }] }, state);
    expect(await STAGES.link!.apply(store, job, state, ctx)).toBe(true);
    expect((await store.readFragment("ch2-001"))?.meta.items).toEqual(["halves"]);
    expect(await uncovered(store, items)).toEqual(["Decimals"]);
  });

  it("without items there is no prompt", async () => {
    expect(await STAGES.link!.prompt(store, job, { ...ctx, items: undefined })).toBeNull();
  });
});
```

In `packages/shell/test/material.test.ts`, with deps `material.items = { collection: "concepts", label: "name" }` and a new dep `items: async () => [{ key: "halves", label: "Halves" }]`, `service.list("fractions")` has `uncovered: ["Halves"]` once a source is ready; without `items` in the manifest the view has no `uncovered` key.

In `packages/ui/test/material-panel.test.tsx`: a view with `uncovered: ["Decimals", "Percent"]` shows "No material yet for: Decimals, Percent".

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm vitest run packages/material/test/link.test.ts`
Expected: FAIL (`uncovered` is not exported).

- [ ] **Step 3: Write the links**

Create `packages/material/src/link.ts`:

```ts
import { z } from "zod";
import type { MaterialStore } from "./store";

export const linkAnswer = z.object({ links: z.array(z.object({ fragment: z.string(), items: z.array(z.string()).max(10) })).max(500) });

export function linkPrompt(items: { key: string; label: string }[], rows: { id: string; summary: string; path: string }[]): string {
  return [
    "material-link",
    "Link each fragment of the person's material to the items it teaches or uses, from this list (key: label). Use only these keys; leave a fragment with no items when none fits.",
    items.map((i) => `${i.key}: ${i.label}`).join("\n"),
    "Fragments:",
    rows.map((r) => `[${r.id}] ${r.summary} (${r.path})`).join("\n"),
    "Answer once with `material_link`.",
  ].join("\n\n");
}

/** Items no fragment links to, by label (§8 coverage). */
export async function uncovered(store: MaterialStore, items: { key: string; label: string }[]): Promise<string[]> {
  const linked = new Set((await store.fragments()).flatMap((f) => f.meta.items));
  return items.filter((i) => !linked.has(i.key)).map((i) => i.label);
}
```

In `stages.ts` (imports at the top):

```ts
import { linkAnswer, linkPrompt } from "./link";

STAGE_TOOLS.material_link = { description: "The links: for each fragment, the item keys it covers.", input: linkAnswer.shape };

STAGES.link = {
  tools: ["material_link"],
  async prompt(store, _job, ctx) {
    if (!ctx.items || ctx.items.length === 0) return null;
    const rows = await store.indexRows();
    return rows.length === 0 ? null : linkPrompt(ctx.items, rows);
  },
  async accept(name, args, state) {
    state.answers.push({ name, ...linkAnswer.parse(args) });
    return "Saved.";
  },
  async apply(store, _job, state, ctx) {
    if (!ctx.items || ctx.items.length === 0 || (await store.indexRows()).length === 0) return true;
    const a = state.answers.at(-1);
    const parsed = a ? linkAnswer.safeParse(a) : null;
    if (!parsed?.success) return false;
    const keys = new Set(ctx.items.map((i) => i.key));
    for (const l of parsed.data.links) {
      await store.patchFragment(l.fragment, (m) => ({ ...m, items: [...new Set(l.items.filter((k) => keys.has(k)))] }));
    }
    await store.writeIndex();
    return true;
  },
};
```

Add `export * from "./link";` to the index.

- [ ] **Step 4: Items in the app**

`MaterialDeps` gets `items?(scope: string): Promise<{ key: string; label: string }[]>`. `stageContext(job)` adds `...(this.d.items ? { items: await this.d.items(job.scope) } : {})`. `list(scope)` adds, only when `this.d.material.items` and `this.d.items` exist and the scope has a usable source, `uncovered: await uncovered(store, await this.d.items(scope))`.

In `index.ts`, `buildMaterial()` passes, only when `m.items` is set:

```ts
    ...(m.items
      ? {
          items: async (scope: string) => {
            const c = await validConfig();
            if (!c) return [];
            const { collection, label } = m.items!;
            const r = await dataStoreFor(baseOf(c)).query(collection, { fields: [label], limit: 200 }, { who: "person", scope });
            const key = harness.data[collection]?.key;
            return key ? r.records.map((rec) => ({ key: String(rec[key]), label: String(rec[label] ?? rec[key]) })) : [];
          },
        }
      : {}),
```

(The manifest rule from Task 1 guarantees the collection has a `key` and the label field. At most 200 items are linked; a harness with more gets the first 200: flagged in the docs.)

- [ ] **Step 5: The panel**

`en.json` → `material.uncovered`: `"No material yet for: {{list}}"`. In `MaterialPanel`, after the source lines: `{view?.uncovered && view.uncovered.length > 0 && <p className="hh-material-notice">{t("material.uncovered", { list: view.uncovered.join(", ") })}</p>}`.

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/material/test/link.test.ts packages/shell/test/material.test.ts packages/ui/test/material-panel.test.tsx`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/material packages/shell packages/ui packages/i18n
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(material): links to the harness's items and coverage"
```

---

## Phase 4 — Grounding, upkeep and the edges (spec §12 slices 4–5)

### Task 24: Grounding and citations

The grounding toggle in the panel (strict or mixed, per scope, when the harness lets the person change it); `material_conflict` for the agent; citations `[[frag:<id>]]` drawn as "<source>, <location>", which open the original.

**Files:**
- Create: `packages/ui/src/citations.ts`
- Modify: `packages/material/src/server.ts`, `packages/shell/src/main/material-requests.ts`, `packages/shell/src/main/material.ts`, `packages/shell/src/main/index.ts`, `packages/shell/src/preload/index.ts`, `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts`, `packages/ui/src/markdown.tsx`, `packages/ui/src/ChatView.tsx`, `packages/ui/src/MaterialPanel.tsx`, `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/markdown.test.tsx`, `packages/ui/test/material-panel.test.tsx`, `packages/shell/test/material-requests.test.ts`, `packages/material/test/server.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/ui/test/markdown.test.tsx`, add:

```tsx
import { CitationContext } from "../src/citations";

describe("citations (material spec §9)", () => {
  it("[[frag:id]] is a button with the source and the location; clicking opens it", async () => {
    const opened: string[] = [];
    const cite = { label: async (id: string) => (id === "ch2-007" ? "ch2.pdf, p.4–5" : null), open: (id: string) => void opened.push(id) };
    render(
      <CitationContext.Provider value={cite}>
        <Markdown text="Equivalent fractions name the same amount [[frag:ch2-007]]." />
      </CitationContext.Provider>,
    );
    const button = await screen.findByRole("button", { name: "ch2.pdf, p.4–5" });
    fireEvent.click(button);
    expect(opened).toEqual(["ch2-007"]);
  });

  it("without material the text stays as it is (D0)", () => {
    render(<Markdown text="Look [[frag:ch2-007]]." />);
    expect(screen.getByText("Look [[frag:ch2-007]].")).toBeTruthy();
  });

  it("an unknown fragment stays text", async () => {
    render(
      <CitationContext.Provider value={{ label: async () => null, open: () => {} }}>
        <Markdown text="See [[frag:zz-001]]." />
      </CitationContext.Provider>,
    );
    expect(await screen.findByText("[[frag:zz-001]]")).toBeTruthy();
  });
});
```

(Use the file's existing imports for `render`, `screen` and `fireEvent`.)

In `packages/ui/test/material-panel.test.tsx`:

```tsx
  it("the grounding toggle, only when the person may change it", async () => {
    const client = await panel(view([src({})]));
    fireEvent.click(await screen.findByRole("radio", { name: "Only the material" }));
    await waitFor(() => expect(client.materialCalls).toContain("grounding:strict"));
    cleanup();
    await panel({ ...view([src({})]), grounding: { mode: "mixed", canChange: false } });
    await screen.findByText("ch2.pdf: ready, 18 fragments");
    expect(screen.queryByRole("radio", { name: "Only the material" })).toBeNull();
  });
```

In `packages/shell/test/material-requests.test.ts`:

```ts
  it("conflict: one line in conflicts.md", async () => {
    expect(await personMaterialRequest(deps("fractions"), { op: "conflict", fragment: "ch2-001", claim: "1/2 > 2/3", resolution: "Followed the material" })).toBe("Noted.");
    expect(fs.readFileSync(path.join(base, ".harness", "material", "fractions", "conflicts.md"), "utf8")).toContain("[[frag:ch2-001]] 1/2 > 2/3 → Followed the material");
  });
```

In `packages/material/test/server.test.ts`, the person-mode tool list becomes `["material_conflict", "material_flag", "material_read", "material_search"]`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm vitest run packages/ui/test/markdown.test.tsx packages/ui/test/material-panel.test.tsx packages/shell/test/material-requests.test.ts packages/material/test/server.test.ts`
Expected: FAIL.

- [ ] **Step 3: `material_conflict`**

In `packages/material/src/server.ts`, person mode, after `material_flag`:

```ts
    server.registerTool(
      "material_conflict",
      {
        description: "Records that the material and your own knowledge disagree: the fragment, the claim, and how you resolved it (you follow the material).",
        inputSchema: { fragment: ID, claim: z.string().min(1).max(300), resolution: z.string().min(1).max(300) },
      },
      call("conflict"),
    );
```

In `personMaterialRequest`, before the "Unknown request" line:

```ts
    if (r.op === "conflict" && isFragmentId(r.fragment) && typeof r.claim === "string" && typeof r.resolution === "string") {
      if (!(await store.readFragment(r.fragment))) throw new MaterialRefusal(`No fragment ${r.fragment}`);
      await store.appendConflict({ fragment: r.fragment, claim: r.claim.slice(0, 300), resolution: r.resolution.slice(0, 300) }, d.now?.());
      return "Noted.";
    }
```

`conflicts.md` is in `MATERIAL_KEEP`, so the turn's commit records it.

- [ ] **Step 4: Citations**

Create `packages/ui/src/citations.ts`:

```ts
import { createContext } from "react";

/** How the chat draws `[[frag:<id>]]` (material spec §9): the label "<source>, <location>" and opening the original. */
export interface CitationResolver {
  /** Null: no such fragment (the text stays as it is). */
  label(id: string): Promise<string | null>;
  open(id: string): void;
}

/** Null outside a harness with material: citations stay text (D0). */
export const CitationContext = createContext<CitationResolver | null>(null);

export const CITATION = /\[\[frag:([a-z0-9][a-z0-9-]{0,63}-\d{3,4})\]\]/g;

/** Text into plain runs and citation ids. */
export function splitCitations(text: string): (string | { id: string })[] {
  const out: (string | { id: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(CITATION)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ id: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
```

In `packages/ui/src/markdown.tsx`:

```tsx
import { Fragment, type ReactNode, useContext, useEffect, useState } from "react";
import { CitationContext, splitCitations } from "./citations";

function Citation({ id }: { id: string }) {
  const cite = useContext(CitationContext);
  const [label, setLabel] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    cite?.label(id).then(
      (l) => live && setLabel(l),
      () => live && setLabel(null),
    );
    return () => {
      live = false;
    };
  }, [cite, id]);
  if (!cite || label === null) return <>{`[[frag:${id}]]`}</>;
  return (
    <button type="button" className="hh-citation" onClick={() => cite.open(id)}>
      {label ?? "…"}
    </button>
  );
}

/** A text run with its citations drawn (only inside a CitationContext). */
function CitedText({ text, fade }: { text: string; fade: boolean }) {
  const cite = useContext(CitationContext);
  if (!cite || !text.includes("[[frag:")) return <>{fade ? fadingWords(text) : text}</>;
  return (
    <>
      {splitCitations(text).map((part, i) => (typeof part === "string" ? <Fragment key={i}>{fade ? fadingWords(part) : part}</Fragment> : <Citation key={i} id={part.id} />))}
    </>
  );
}
```

and in `renderInline`, the `"text"` case becomes `return <CitedText key={i} text={n.v} fade={fade} />;`. Without a provider `CitedText` renders exactly what the text case rendered before (D0).

`styles.css`: `.hh-citation { border: 0; background: none; padding: 0; color: var(--hh-accent); text-decoration: underline; cursor: pointer; font: inherit; }` (the accent token the file defines).

- [ ] **Step 5: The app side of citations**

`MaterialService.cite(scope, id)`: `{ label: "<source>, <location>" } | null` for a fragment of the scope (`readFragment`, after `isFragmentId`). IPC `hh:materialCite` (scope, id) → `materialSvc?.cite(scope, id) ?? null`. Preload `cite: (scope, id) => ipcRenderer.invoke("hh:materialCite", scope, id)`. `MaterialClient.cite(scope: string, id: string): Promise<{ label: string } | null>`. The fake client answers from a `citeLabels: Record<string, string>` map. `hh:materialOpen` already opens a fragment's original (Task 14).

In `ChatView.tsx`, wrap the chat's message list in a provider only when `state.material && materialScope`:

```tsx
  const citations = useMemo<CitationResolver | null>(() => {
    if (!state.material || !materialScope) return null;
    const cache = new Map<string, Promise<string | null>>();
    return {
      label: (id) => {
        if (!cache.has(id)) cache.set(id, client.material.cite(materialScope, id).then((r) => r?.label ?? null, () => null));
        return cache.get(id)!;
      },
      open: (id) => void client.material.open(materialScope, id),
    };
  }, [client, state.material, materialScope]);
```

and `{citations ? <CitationContext.Provider value={citations}>{messages}</CitationContext.Provider> : messages}` where `messages` is the existing list element (keep its JSX unchanged; assign it to a const first).

- [ ] **Step 6: The grounding toggle**

`en.json` → `material.grounding`: `{ "label": "How the AI uses this material", "strict": "Only the material", "mixed": "The material first" }`.

In `MaterialPanel`, after the actions, when `view?.grounding.canChange`:

```tsx
        <fieldset className="hh-material-grounding">
          <legend>{t("material.grounding.label")}</legend>
          {(["strict", "mixed"] as const).map((mode) => (
            <label key={mode}>
              <input type="radio" name={`grounding-${scope}`} checked={view.grounding.mode === mode} disabled={disabled} onChange={() => void client.material.setGrounding(scope, mode)} />
              {t(`material.grounding.${mode}`)}
            </label>
          ))}
        </fieldset>
```

The mode applies from the next task: the first message carries it (Task 15).

- [ ] **Step 7: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test/markdown.test.tsx packages/ui/test/material-panel.test.tsx packages/shell/test/material-requests.test.ts packages/material/test/server.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`
Expected: PASS; every existing markdown test passes unchanged.

- [ ] **Step 8: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/material packages/shell packages/ui packages/i18n
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat: grounding per scope, conflicts, and citations that open the original"
```

---

### Task 25: Update, removal, and measured estimates

- **Update (§11):** an original the person changed by hand in `material/<scope>/` (its hash differs) is converted again under the same source id; one that is gone is marked `removed`.
- **Removal:** a "Remove" button per source (with a confirmation), and Cancel on a waiting card. The original goes to the system Trash.
- **Measured estimates (§7):** once the base's `usage.jsonl` has `MEASURED_MIN` material lines for a stage, its measured tokens per fragment replace the constant.
- **Usage:** Settings › Usage shows the material's total tokens.

**Files:**
- Modify: `packages/material/src/pipeline.ts`, `packages/shell/src/main/material.ts`, `packages/shell/src/main/usage-log.ts`, `packages/shell/src/main/index.ts`, `packages/shell/src/preload/index.ts`, `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts`, `packages/ui/src/MaterialPanel.tsx`, `packages/ui/src/UsageTab.tsx`, `packages/i18n/src/locales/en.json`
- Test: `packages/material/test/pipeline.test.ts`, `packages/shell/test/material.test.ts`, `packages/shell/test/usage-log.test.ts`, `packages/ui/test/material-panel.test.tsx`, `packages/ui/test/usage-tab.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `packages/material/test/pipeline.test.ts`:

```ts
describe("refreshSources (§11 update)", () => {
  it("a changed original is converted again under the same id; a missing one is removed", async () => {
    const r = await addSource(store, { name: "a.md", data: Buffer.from(`# A\n\n${"First version. ".repeat(40)}`) }, { accepts: ["text"], items: false });
    if (!r.ok) throw new Error("unreachable");
    fs.writeFileSync(path.join(base, "material", "fractions", "a.md"), `# A\n\n${"Second version. ".repeat(40)}`);
    expect(await refreshSources(store, { items: false })).toEqual(["a"]);
    expect((await store.fragments()).map((f) => f.md).join("")).toContain("Second version.");
    expect(await refreshSources(store, { items: false })).toEqual([]);
    fs.rmSync(path.join(base, "material", "fractions", "a.md"));
    expect(await refreshSources(store, { items: false })).toEqual(["a"]);
    expect((await store.source("a"))?.status).toBe("removed");
  });
});
```

In `packages/shell/test/usage-log.test.ts`:

```ts
  it("measured material costs per fragment, once there are enough lines (material spec §7)", () => {
    const line = (stage: string, tokens: number, fragments: number) =>
      materialRecord({ engine: "claude", stage, scope: "s", profile: { engine: "claude", tier: "light", effort: "low", cap: 1 }, ok: true, fragments, usage: { inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } });
    expect(measuredMaterialCosts([line("label", 2000, 20)])).toBeUndefined();
    const five = Array.from({ length: 5 }, () => line("label", 2000, 20));
    expect(measuredMaterialCosts(five)).toEqual({ label: 100 });
    expect(summarizeUsage(five, undefined).material).toBe(10000);
    expect(summarizeUsage([], undefined).material).toBeUndefined();
  });
```

In `packages/shell/test/material.test.ts`: `service.remove("fractions", id)` answers `{ ok: true }`, the recorded trash path is the original, and the view no longer lists the source.

In `packages/ui/test/material-panel.test.tsx`:

```tsx
  it("remove asks first; Cancel on a waiting card removes it", async () => {
    const client = await panel(view([src({}), src({ id: "w", name: "w.pdf", status: "pending", notice: "warn", fragments: 0 })]));
    fireEvent.click(await screen.findByRole("button", { name: "Remove ch2.pdf" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(client.materialCalls).toEqual(["remove:ch2", "remove:w"]));
  });
```

In `packages/ui/test/usage-tab.test.tsx`: a summary with `material: 12000` shows "Material processing: about 12,000 tokens"; one without shows no such line.

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm vitest run packages/material/test/pipeline.test.ts packages/shell/test/usage-log.test.ts packages/shell/test/material.test.ts packages/ui/test/material-panel.test.tsx packages/ui/test/usage-tab.test.tsx`
Expected: FAIL.

- [ ] **Step 2b: Material lines carry their fragment count**

`materialRecord`'s options and `UsageRecord` get `fragments?: number` (doc: "material lines: the fragments the stage handled"). In `MaterialService.runJob`, count the fragments a prompt lists — every stage's prompt lists each fragment on a line starting `[<id>]` — and pass it on: `const fragments = prompt ? (prompt.match(/^\[[a-z0-9][a-z0-9-]*-\d{3,4}\]/gm) ?? []).length : 0;`. `MaterialDeps.runStage` gets a `fragments: number` argument after `signal`, and `index.ts` writes it into `materialRecord({ …, fragments })`.

- [ ] **Step 3: Refresh in the pipeline**

In `packages/material/src/pipeline.ts`:

```ts
/**
 * Originals the person changed or removed by hand (§11 update): a changed one is converted again under the same id
 * (its fragments renumbered, the AI stages queued again); a missing one is marked removed. Returns the ids touched.
 */
export async function refreshSources(store: MaterialStore, o: { items: boolean; measured?: MeasuredCosts }): Promise<string[]> {
  const touched: string[] = [];
  for (const s of await store.sources()) {
    if (s.status === "removed" || s.status === "refused" || s.status === "pending") continue;
    const file = store.originalPath(s.path);
    const data = file ? await fs.readFile(file).catch(() => null) : null;
    if (!data) {
      await store.writeFragments(s.id, []);
      await store.patch(s.id, (e) => ({ ...e, status: "removed", fragments: [] }));
      await store.setStale("sheet");
      touched.push(s.id);
      continue;
    }
    const hash = createHash("sha256").update(data).digest("hex");
    if (hash === s.hash) continue;
    await store.patch(s.id, (e) => {
      const { verdict: _v, reviewQueue: _q, repairs: _r, failed: _f, ...rest } = e;
      return { ...rest, hash, sizeBytes: data.length, issues: [], fixes: [], asks: [], reconverted: 0 };
    });
    await processSource(store, s.id, o);
    touched.push(s.id);
  }
  if (touched.length) await store.writeIndex();
  return touched;
}
```

- [ ] **Step 4: The app**

In `packages/shell/src/main/material.ts`:

1. `remove`:

```ts
  async remove(scope: unknown, id: unknown): Promise<MaterialResult> {
    const store = await this.store(scope);
    if (typeof store === "string") return { ok: false, reason: store };
    if (!isSourceId(id) || !(await removeSource(store, id, (file) => this.d.trash(file)))) return { ok: false, reason: "unknown-source" };
    await this.d.afterChange(store.scope, `removed ${id}`);
    await this.changed(store.scope);
    return { ok: true };
  }
```

2. Refresh once per kick per scope, inside `nextJob`, before looking for work: keep `private refreshed = new Set<string>()`, cleared in `resetFailures()`; for each scope not yet in it, `if ((await refreshSources(store, { items, ...(measured ? { measured } : {}) })).length) await this.changed(scope);` then add it.

3. `measured()` reads the averages: `MaterialDeps` gets `measured?(): Promise<MeasuredCosts | undefined>`; `private async measured()` returns `this.d.measured?.()`. `index.ts` passes `measured: async () => { const c = await validConfig(); return c ? measuredMaterialCosts(await new UsageLog(baseOf(c)).load()) : undefined; }`. The full review's estimate (Task 19) uses `(await this.measured())?.review ?? REVIEW_TOKENS`.

In `packages/shell/src/main/usage-log.ts`:

```ts
/**
 * Per-fragment token costs of each material stage, measured from its lines (§7): a stage with at least MEASURED_MIN
 * lines that report usage and fragments gets its average; the sheet, per run. Undefined when no stage has enough.
 */
export function measuredMaterialCosts(records: UsageRecord[]): MeasuredCosts | undefined {
  const out: MeasuredCosts = {};
  for (const stage of ["label", "review", "link", "sheet"] as const) {
    const lines = records.filter((r) => r.phase === "material" && r.stage === stage && r.ok && r.usage && (stage === "sheet" || (r.fragments ?? 0) > 0));
    if (lines.length < MEASURED_MIN) continue;
    const per = lines.map((r) => turnTokens(r.usage!) / (stage === "sheet" ? 1 : r.fragments!));
    out[stage] = Math.round(per.reduce((a, b) => a + b, 0) / per.length);
  }
  return Object.keys(out).length ? out : undefined;
}
```

(`MEASURED_MIN` and `type MeasuredCosts` from `@humanharness/material`; `turnTokens` is the file's existing helper.) In `summarizeUsage`, before filtering material lines out, `const material = records.filter((r) => r.phase === "material" && r.usage).reduce((n, r) => n + turnTokens(r.usage!), 0);`, and the returned object gets `...(material > 0 ? { material } : {})`. `UsageSummary` (shell and `ui/src/client.ts`) gets `material?: number` (doc: "tokens the material's AI stages used; absent when none").

IPC `hh:materialRemove`; preload `remove`; `MaterialClient.remove(scope, id)`; the fake client records `remove:<id>`. `index.ts`'s deps already pass `trash` (Task 19).

- [ ] **Step 5: The window**

`en.json` → `material`: `"remove": "Remove {{name}}"`, `"removeConfirm": "Remove {{name}}? Its file goes to the Trash."`, `"removeYes": "Remove"`; and `usage.material`: `"Material processing: about {{tokens}} tokens"` (in the `usage` object the Usage tab already reads).

In `MaterialPanel`, each non-waiting source line ends with a small button (`aria-label={t("material.remove", { name })}`) that turns into the confirmation (`t("material.removeConfirm")` with a "Remove" button calling `client.material.remove(scope, s.id)` and a "Cancel" button that closes it). The waiting card gets a "Cancel" button (`t("material.cancel")`) that calls `remove` directly: nothing was processed yet.

In `UsageTab.tsx`, after the per-action estimates: `{summary.material !== undefined && <p>{t("usage.material", { tokens: fmt(summary.material) })}</p>}` (with the tab's own number formatting).

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/material/test/pipeline.test.ts packages/shell/test/usage-log.test.ts packages/shell/test/material.test.ts packages/ui/test/material-panel.test.tsx packages/ui/test/usage-tab.test.tsx`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/material packages/shell packages/ui packages/i18n
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(material): updates, removal to the Trash, measured estimates and usage"
```

---

### Task 26: Settings › Modelos, `check` and the guide

Each stage is a row in Settings › Modelos (§8), keyed by its reserved id, only with material. `check` warns about two risky choices; the `/new-harness` guide asks about material.

**Files:**
- Modify: `packages/shell/src/main/index.ts` (`modelsView`), `packages/ui/src/ModelsTab.tsx`, `packages/i18n/src/locales/en.json`, `packages/cli/src/check.ts`, `packages/cli/guide/new-harness.md`
- Test: `packages/ui/test/models-tab.test.tsx`, `packages/cli/test/check.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/ui/test/models-tab.test.tsx`:

```tsx
  it("material stages are rows only when the harness takes material (D0)", () => {
    const base = { actions: { study: { label: "Study" } } } as unknown as AppState;
    const q = { key: "questions", label: "Questions" };
    expect(taskRows(base, q).map((r) => r.key)).toEqual(["study", "questions"]);
    const withMaterial = { ...base, material: { accepts: [], items: true, grounding: { default: "mixed", personCanChange: true } } } as unknown as AppState;
    const labels = { "material-review": "Material: checking", "material-repair": "Material: fixing", "material-label": "Material: labelling", "material-sheet": "Material: summary sheet", "material-link": "Material: linking" };
    expect(taskRows(withMaterial, q, labels).map((r) => r.key)).toEqual(["study", "questions", "material-review", "material-repair", "material-label", "material-sheet", "material-link"]);
    const noItems = { ...withMaterial, material: { ...withMaterial.material!, items: false } } as AppState;
    expect(taskRows(noItems, q, labels).map((r) => r.key)).not.toContain("material-link");
  });
```

In `packages/cli/test/check.test.ts`, following the file's fixture pattern (a temp copy of a fixture with an edited manifest):
- the `material-harness` fixture with `material.tiers.review: "light"` gives a `material-review-tier` warning;
- with `scopes` and an `items` collection that is not `scoped`, a `material-items-scope` warning;
- the untouched template and every existing fixture give the same findings as before (the existing D0 assertions stay green).

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm vitest run packages/ui/test/models-tab.test.tsx packages/cli/test/check.test.ts`
Expected: FAIL.

- [ ] **Step 3: Models**

`modelsView()` in `index.ts`, in `recommended`, after `[QUESTIONS]`:

```ts
      // Material spec §8: each AI stage is a process, only with material (D0); links only with items.
      ...(harness.material
        ? Object.fromEntries(
            MATERIAL_STAGES.filter((s) => s !== "link" || harness.material!.items).map((s) => [materialStageKey(s), stageTier(harness.material!, s)]),
          )
        : {}),
```

`ModelsTab.tsx`:

```tsx
/** The actions in path order, then the others, then free questions, then (with material) the material stages. */
export function taskRows(state: AppState, questions: TaskRowInfo, material: Record<string, string> = {}): TaskRowInfo[] {
  const path = (state.path ?? []).filter((id) => state.actions[id]);
  const ids = [...path, ...Object.keys(state.actions).filter((id) => !path.includes(id))];
  const stages = state.material ? ["review", "repair", "label", "sheet", ...(state.material.items ? ["link"] : [])].map((s) => `material-${s}`) : [];
  return [
    ...ids.map((id) => ({ key: id, label: state.actions[id].label, description: state.actions[id].description })),
    questions,
    ...stages.map((key) => ({ key, label: material[key] ?? key })),
  ];
}
```

and its caller passes the labels: `taskRows(state, {…}, { "material-review": t("models.material.review"), … })`. `en.json` → `models.material`: `{ "review": "Material: checking the conversion", "repair": "Material: fixing structure", "label": "Material: labelling", "sheet": "Material: the summary sheet", "link": "Material: linking to topics" }`. `TaskRowInfo.description` stays optional.

- [ ] **Step 4: `check`**

In `packages/cli/src/check.ts`, a new `materialFindings(h)` added to `checkHarness` after `tierCostFindings`:

```ts
function materialFindings(h: LoadedHarness): Finding[] {
  const m = h.material;
  if (!m) return [];
  const out: Finding[] = [];
  if (m.tiers.review === "light")
    out.push(warning("material-review-tier", "material.tiers.review is light: the check that keeps broken conversions out of tasks reads better at standard.", MANIFEST));
  if (m.items && h.scopes && !h.data[m.items.collection]?.scoped)
    out.push(warning("material-items-scope", `material.items uses "${m.items.collection}", which is app-wide: every scope's material links to the same items. Make it \`scoped\` if each scope has its own.`, MANIFEST));
  return out;
}
```

- [ ] **Step 5: The guide**

In `packages/cli/guide/new-harness.md`, Phase 4 — Context, after the profiles bullet:

```markdown
- whether the person brings their own material (a textbook chapter, class notes, a spreadsheet, a web page) that tasks should work from. If so, declare `material`: which families it `accepts` (`pdf`, `word`, `spreadsheet`, `presentation`, `ebook`, `web`, `text`; all by default), the `sheet` sections the AI writes once per scope (an `id`, a `label` and a `prompt`, in English; the core adds "Notation and conventions" and "What the material does not cover"), the `fragmentKinds` your briefs talk about, the `items` collection fragments link to (a keyed collection and its label field) if the harness tracks topics, and whether the person may switch `grounding` between `strict` (only the material) and `mixed`. The core converts, cuts, checks and labels the files, warns about cost before any model runs, and gives each task a short index; the agent fetches fragments with `material_read` and cites them as `[[frag:<id>]]`. Each stage is a row in Settings › Modelos. See `<core>/docs/architecture/material.md`.
```

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test/models-tab.test.tsx packages/cli/test/check.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell packages/ui packages/i18n packages/cli
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat: material stages in Settings › Modelos, check warnings, the guide"
```

---

### Task 27: Docs

**Files:**
- Create: `docs/architecture/material.md`
- Modify: `docs/architecture/manifest.md`, `docs/architecture/context.md`, `docs/architecture/data.md`, `docs/architecture/profiles.md`, `docs/architecture/blocks.md`

- [ ] **Step 1: Write `docs/architecture/material.md`**

In English, the same style as `data.md` and `profiles.md` (short sections, file paths in backticks). Sections:
1. **What it is.** The person's own files become small fragments a task fetches on demand; nothing exists without `material` (D0).
2. **The manifest.** Every field of `material` with its default (copy the Decisions → Manifest bullets), and the reserved action ids.
3. **Where things live.** `<base>/material/<scope>/` (originals) and `<base>/.harness/material/<scope>/` (`sources.json`, `index.md`, `sheet.md`, `conflicts.md`, `grounding.json`, `fragments/`, `fragments/.orig/`, `.stale`); `material-reads.jsonl`; what the history tracks (`MATERIAL_KEEP`) and why fragments are not tracked. With profiles, `<base>` is the active profile's folder: each profile has its own material.
4. **The program pipeline.** Formats and converters (one line each, with the libraries), refusals and their messages, location marks, cutting (§5 rules and the constants in `packages/material/src/constants.ts`), the checks.
5. **Cost.** The estimate formula, when the person is asked, page ranges, spreadsheets, measured costs, the privacy line.
6. **The AI stages.** `runSystemTask` (empty folder, only the `material` server, no edits, no web, no commands, no saved session), the stage order, `MaterialJobs` (never starts during a person's turn; `closeRuntime` stops it; a new runtime, a change and a profile's arrival start it), failures and Try again, usage lines (`phase: "material"`).
7. **Use inside tasks.** The `## Material` section, the person-mode tools, citations, `material_conflict`, grounding per scope.
8. **The window.** `MaterialPanel`, `HarnessApp materialPanel`, `client.material` (every method), `hh:materialStatus`.
9. **Not yet.** OCR, image descriptions, transcription, a sheet picker, row ranges, suggesting items, `humanharness run` (no material), more than 200 items, a shared library across profiles.

- [ ] **Step 2: Update the other docs**

- `manifest.md`: the `material` field, one paragraph and a link to `material.md`.
- `context.md`: the first message's order is now notes index → app-wide notes → data → material; the Material part of `AGENTS.md`.
- `data.md`: `material.items` links fragments to a keyed collection; `sources.json` is the core's, not a collection, and never shows in the data tools.
- `profiles.md`: material is per profile; the switch stops the material queue first (`closeRuntime`) and the new profile's unfinished stages resume after arrival.
- `blocks.md`: the `material` MCP server sits next to `ui` and `data`; it is not a block server (no `allBlocks`, no bridge).

- [ ] **Step 3: Check and commit**

Run: `corepack pnpm test` (the docs have no tests; this keeps the tree green).

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add docs/architecture
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "docs: material processing"
```

---

### Task 28: End to end: a student adds a chapter, works with it, and another student doesn't see it

**Files:**
- Create: `packages/e2e/tests/material.spec.ts`, `packages/fake-agent/fixtures/material-harness/ui/App.tsx`, `packages/e2e/fixtures/fractions.md`

- [ ] **Step 1: The fixture's window and material**

`packages/fake-agent/fixtures/material-harness/ui/App.tsx`: the same lines as `packages/fake-agent/fixtures/profiles-harness/ui/App.tsx` (`HarnessApp` with the client), so the default panel is used.

`packages/e2e/fixtures/fractions.md`: a chapter in Spanish whose cut is known, six fragments:
- `# Fracciones` with no text of its own (it joins its first section);
- four `##` sections ("Qué es una fracción", "Fracciones equivalentes", "Simplificar", "Comparar"), each 1 000 to 2 000 characters of plain paragraphs;
- `## Ejercicios` with no text of its own, then `### Ejercicio 1` and `### Ejercicio 2`, each 1 000 to 2 000 characters (kept whole, §5.4).

That is 150–800 tokens per section, so no section merges or splits: fragments `fractions-001` (Fracciones › Qué es una fracción) to `fractions-006` (Ejercicio 2). About 2 500 tokens in all, far below `WARN_PAGES`, so intake processes it at once.

- [ ] **Step 2: Write the test**

Create `packages/e2e/tests/material.spec.ts`:

```ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, type Page, expect, test } from "@playwright/test";
import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";
import { closeAndClean, launch, makeSandbox, shellDir } from "./helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../../fake-agent/fixtures");
const chapter = path.resolve(here, "../fixtures/fractions.md");
const result = {
  line: { type: "result", subtype: "success", is_error: false, result: "", session_id: "fake-session", usage: { input_tokens: 900, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
};
const tool = (server: string, name: string, args: Record<string, unknown>) => ({ mcp: { server, tool: name, args } });
const ids = Array.from({ length: 6 }, (_, i) => `fractions-${String(i + 1).padStart(3, "0")}`);

const script: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    // The stages answer through the material server (system mode); each prompt starts with its stage's marker.
    { match: "^material-review", steps: [tool("material", "material_review", { verdict: "good", fragments: [], issues: [] }), result] },
    { match: "^material-label", steps: [tool("material", "material_label", { fragments: ids.map((id) => ({ id, summary: "About fractions.", keywords: ["fracciones"], kind: "explanation" })) }), result] },
    { match: "^material-sheet", steps: [tool("material", "material_sheet", { sections: [{ id: "terms", markdown: "- fracción: a part of a whole" }] }), result] },
    // A task reads a fragment and cites it.
    { match: "# Task: study", steps: [tool("material", "material_read", { id: "fractions-002" }), ...claudeTextLines("Two fractions are equivalent when they name the same amount [[frag:fractions-002]]."), result] },
    { match: "save_note", steps: [tool("ui", "save_note", { title: "Fractions", summary: ["Equivalent"], decisions: [], files: [], open: [] }), ...claudeTextLines("Guardé."), result] },
  ],
};

/** Adds a student from the profile screen (profiles.spec.ts): the fixture has no setup steps. */
async function addStudent(page: Page, name: string) {
  await expect(page.getByRole("heading", { name: "Who's using Reader?" })).toBeVisible();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("contentinfo").getByRole("button", { name: "Next" }).click();
}

/** Creates and opens the topic "Fractions" (ScopePicker). */
async function openFractions(page: Page) {
  await page.getByRole("button", { name: "New topic" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Fractions");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("combobox", { name: "Choose topic" })).toHaveValue("fractions");
}

function build(name: string, fixture: string): string {
  const outDir = path.join(shellDir, "out", name);
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: outDir };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
  return outDir;
}

test("material: add a chapter, the stages run, a task cites it, another student has their own", async () => {
  test.setTimeout(300_000);
  const s = makeSandbox("material");
  const outDir = build("material", path.join(fixtures, "material-harness"));
  let app: ElectronApplication | undefined;
  try {
    const launched = await launch(s, { claude: script }, path.join(outDir, "main", "index.js"));
    app = launched.app;
    const page = launched.page;

    await page.getByRole("button", { name: "Set up Reader" }).click();
    await addStudent(page, "Ana");
    await page.getByRole("button", { name: "Start Reader" }).click();
    await openFractions(page);

    // No dialog in tests: the main process's dialog answers with the chapter.
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as unknown as typeof dialog.showOpenDialog;
    }, chapter);
    await page.getByRole("button", { name: "Add a file" }).click();
    await expect(page.getByText("Checking and labelling send parts of this material to Anthropic.")).toBeVisible();
    await expect(page.getByText("fractions.md: ready, 6 fragments")).toBeVisible({ timeout: 60_000 });

    const ana = path.join(s.folder, "ana");
    const store = path.join(ana, ".harness", "material", "fractions");
    expect(fs.existsSync(path.join(ana, "material", "fractions", "fractions.md"))).toBe(true);
    const registry = JSON.parse(fs.readFileSync(path.join(store, "sources.json"), "utf8"));
    expect(registry.sources[0]).toMatchObject({ id: "fractions", status: "ready", verdict: "good", fragments: ids });
    await expect.poll(() => fs.existsSync(path.join(store, "sheet.md"))).toBe(true);
    expect(fs.readFileSync(path.join(store, "sheet.md"), "utf8")).toContain("## Terms");
    const usage = fs.readFileSync(path.join(ana, ".harness", "usage.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    // No concepts in the topic yet: the link stage has nothing to do and runs no session.
    expect(usage.filter((u) => u.phase === "material").map((u) => u.stage)).toEqual(["review", "label", "sheet"]);

    // A task: the first message holds the material section; the citation shows its source and location.
    await page.getByRole("button", { name: "Study" }).click();
    await expect(page.getByRole("button", { name: /^fractions\.md, / })).toBeVisible();
    const prompts = fs.readFileSync(s.claudePrompts, "utf8");
    expect(prompts).toContain("## Material");
    expect(prompts).toContain("## Terms");
    expect(fs.readFileSync(path.join(ana, ".harness", "material-reads.jsonl"), "utf8")).toContain('"id":"fractions-002"');

    // Another student: their own topic, no material of Ana's.
    await page.getByRole("button", { name: "Add student" }).click();
    await addStudent(page, "Ben");
    await page.getByRole("button", { name: "Start Reader" }).click();
    await openFractions(page);
    await expect(page.getByRole("button", { name: "Add a file" })).toBeVisible();
    await expect(page.getByText(/fractions\.md: ready/)).toHaveCount(0);
    expect(fs.existsSync(path.join(s.folder, "ben", "material"))).toBe(false);
  } finally {
    try {
      if (app) await closeAndClean(app, s);
      else fs.rmSync(s.root, { recursive: true, force: true });
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
});

test("D0: a harness without material has no panel and no material files", async () => {
  test.setTimeout(300_000);
  const s = makeSandbox("material-d0");
  const outDir = build("material-d0", path.join(fixtures, "profiles-harness"));
  const plain: ClaudeScript = { steps: [...claudeTextLines("Una pregunta corta."), result] };
  let app: ElectronApplication | undefined;
  try {
    const launched = await launch(s, { claude: plain }, path.join(outDir, "main", "index.js"));
    app = launched.app;
    const page = launched.page;
    const next = page.getByRole("contentinfo").getByRole("button", { name: "Next" });
    await page.getByRole("button", { name: "Set up Family Tutor" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill("Sofi");
    await next.click();
    await page.getByRole("textbox").first().fill("Fractions");
    await next.click();
    await expect(page.getByRole("heading", { name: "All set" })).toBeVisible();
    await page.getByRole("button", { name: "Start Family Tutor" }).click();
    await page.getByRole("button", { name: /Practice/ }).first().click();
    await expect(page.getByText("Una pregunta corta.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Material" })).toHaveCount(0);
    const sofi = path.join(s.folder, "sofi");
    expect(fs.existsSync(path.join(sofi, "material"))).toBe(false);
    expect(fs.existsSync(path.join(sofi, ".harness", "material"))).toBe(false);
    expect(fs.existsSync(path.join(sofi, ".harness", "material-reads.jsonl"))).toBe(false);
  } finally {
    try {
      if (app) await closeAndClean(app, s);
      else fs.rmSync(s.root, { recursive: true, force: true });
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
});
```

The screens' exact texts come from the profiles spec and the strings in `en.json` (`profiles.heading`, `scopes.add`, `scopes.pick`); if a heading differs for a harness without setup steps (for example the work screen opens straight after "Next"), follow what `profiles.spec.ts` and the app show, and keep every assertion about files as written. If the cutter makes a different number of fragments from `fractions.md`, fix the chapter (section sizes), not `ids`.

- [ ] **Step 3: Run it**

Run: `corepack pnpm e2e -- material.spec.ts`
Expected: PASS. Then the whole suite: `corepack pnpm e2e`.
Expected: PASS (every earlier spec unchanged).

- [ ] **Step 4: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/e2e packages/fake-agent
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "test(e2e): material per profile: add, stages, a cited task, another profile"
```

---

## Self-review

**Spec coverage** (spec section → task):
- §3 formats, refusals, conversion rules → Tasks 2, 3, 8–12; links → 8, 14.
- §4 storage, registry, fragments, index, history → Tasks 6, 7, 12, 13.
- §5 cutting → Task 4. §6.1 checks → Task 5. §6.2 review, repairs, asks, reconvert, full review, flags in use → Tasks 13, 18, 19, 20.
- §7 estimate, warning, page range, spreadsheets, measured costs → Tasks 12, 16, 25.
- §8 manifest, sheet, kinds, items, links, coverage, Modelos → Tasks 1, 21, 22, 23, 26.
- §9 load, fetch, ground, citations, conflicts → Tasks 13, 15, 24.
- §10 system stages, queue, contract → Tasks 14, 17. §11 panel, statuses, update, removal, usage → Tasks 16, 20, 25.
- §12 slices → the four phases. §13 open questions → Decisions (defaults flagged).
- Profiles (each profile its own material) → Tasks 14 (base per call), 15 (runtime base), 17 (stop and resume), 28.
- D0 → Tasks 1, 6, 14, 15, 16, 17, 24, 26, 28.

**Placeholders.** None left: every step has its code or its exact text. Task 28 relies on screen texts from `en.json` and `profiles.spec.ts`, and says what to keep fixed if a screen differs.

**Type consistency.** `SourceEntry` grows in Tasks 2, 18 (`reviewQueue`, `repairs`, `asks`, `fullReview`); `StageState` gets `ctx` in Task 21 (Task 18/19 tests updated there); `MaterialStore.stale()` returns the next scope stage (Task 17); `MaterialService.stageContext` takes the job from Task 18 on; `MaterialDeps` grows in Tasks 17 (`runStage`, `kick`), 19 (`trash`), 23 (`items`), 25 (`measured`, `runStage`'s `fragments`).
