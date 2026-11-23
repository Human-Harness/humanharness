# Writer harness — how the features work (architecture v1)

Status: approved by Marco 2026-11-23 as the direction, to be validated with tests (spikes K1–K5). Open decisions D1–D4 stay open. Source of the features: `definition.md` (W1–W42) and the canvas. Base: what `origin/master` offers today (415800a4): actions, phases, tiers, data collections, blocks, tools + pre-steps, job recipes, document kinds and review anchors, hatches (linked folders, per-scope engine config), mods.

## 1. The problem

Most writer features are not "send a prompt". To rewrite a paragraph in the author's voice, the AI needs the voice guide, the cards of the people in the paragraph, what happened before, and where the book is going. To check consistency, it needs every fact about Bruno across three books. Pasting the whole novel each time is too slow and too expensive (an 80k-word novel is ~110k tokens; a saga is several times that). A long session that "remembers the book" dies at compaction.

So the harness needs three things the prompt alone cannot give:

1. **Know-how** the AI loads only when it needs it (how to read like a developmental editor, how a clash is written up): **skills**.
2. **A digested book** kept up to date in data, so tasks read summaries and facts, not chapters: **the book index**.
3. **Code that picks the context** before the AI runs, and code that does the mechanical work after: **tools and pre-steps**.

## 2. Five layers

| Layer | What it holds | Who runs it | Core piece today |
|---|---|---|---|
| L1 Instructions | Who the AI is here; the rules that always hold (never touch text outside the asked range; write in the novel's language and voice; AI text gets the margin line) | always loaded | `instructions` (AGENTS.md) |
| L2 Skills | Know-how per job: one folder per skill, `SKILL.md` + references, loaded on demand | the engine, when a task needs it | **missing at harness level** (only per-scope engine config, hatches §5.2) |
| L3 Book index | The digested book: chapter summaries, facts, mentions, entities, timeline, voice | jobs + tools write it; tasks read it | data collections |
| L4 Tools | Deterministic code: find names, pack context, split chapters, build the timeline, export | code, no model | `tools` + `pre` steps + recipes |
| L5 Flows | One action per button in the UI, with its tier, pre-steps, skills and output block | the app | actions, phases, jobs |

Rule of thumb: **code decides what the AI sees, skills decide how it works, data remembers.**

## 3. L2 — the writer's skills

Format: the open Agent Skills layout (`skills/<name>/SKILL.md`, front matter `name` + `description`, optional `references/`). Claude loads it as a plugin (`--plugin-dir`, already used by hatches); Codex and OpenCode read the same layout (to confirm in spike K1).

| Skill | Used by | What it teaches |
|---|---|---|
| `voice` | every writing action | how to read the voice guide and apply it: sentence length, register, what the author never does; how to check a draft against it before answering |
| `cowrite` | Reescribir, Seguir desde acá, Pedile algo, `/` | the edit contract: input = selection + context pack, output = only the replacement text; keep names, tense and POV; no summaries, no notes in the text |
| `story-bible` | import, Crear ficha, card edits | the card formats (character with fixed part + stages per book, place, world rule, glossary entry, timeline event); what counts as a fact; how to cite the source paragraph |
| `consistency` | consistency reading, Resolver | the method: facts vs. text, checking dates and ages arithmetically (with the timeline tool), what is a clash vs. a deliberate change; the clash block with the three proposals (W35) |
| `developmental` | structural reading | how to read structure from chapter summaries: arcs, stakes, pacing, promises kept; reading notes that point to chapters, not paragraphs |
| `line-edit` | Opinar › Prosa | prose feedback anchored to passages; suggest, never rewrite unless asked |
| `beta-reader` | reader readings, reader creation | play one reader honestly from the card (what they read, what makes them quit); first-person reading notes; where they would stop |
| `import` | Importar manuscrito | the extraction pass per chapter and the merge rules (aliases, the same person under two names) |

Each skill is short (under ~150 lines) and points to references only when needed, so a task pays for what it uses.

## 4. L3 — the book index (the key piece)

Data collections per book, plus the shared ones at saga level (W24):

| Collection | Level | Written by | Read by |
|---|---|---|---|
| `chapters` | book | tool (split, word count, order) | everything |
| `digests` | book | job `digest` (light tier): per chapter a 150-word summary, the scenes, who appears, open threads | structural and reader readings, context packs |
| `facts` | book | job `digest`: atomic, cited facts ("Bruno, 41, 1957", cap. 3 ¶12) | consistency, Resolver |
| `mentions` | book | tool `find_mentions` (no AI): where each entity appears | underline, context pack, new-name detection |
| `characters`, `places`, `world`, `glossary` | saga or book | person, import, Crear ficha | underline, context pack, consistency |
| `timeline` | saga or book | tool `build_timeline` from facts + person edits | consistency, Cronología |
| `voice` | saga or book | action `learn_voice` + person edits (W22) | every writing action |
| `structure` | book | person + import | structural reading, Estructura |
| `readers` | book | Crear lector (W21) | reader readings |
| `readings`, `notes` | book | readings (documents + anchored notes, review spec) | Lecturas, margin dots |
| `authorship` | book | the app on every AI write (who, when, which paragraph) | margin line, Deshacer (W10) |

The digest is what makes readings cheap: a structural reading of an 80k-word novel reads ~25 digests (~5k tokens) instead of ~110k tokens of text. A saga consistency check reads the facts about the people in the chapter, not three books.

The digest is refreshed per chapter when the chapter changed, never the whole book.

### 4.1 Keeping the index fresh when the author writes without the AI (key, Marco 2026-11-23)

The book lives in Markdown, one `.md` per chapter (W37); export is one-way and the app never reads an exported file back. Detection: the hoja knows every save; opening a book compares each chapter's hash with the index, which also covers a `.md` edited in another editor, with no live watcher. Paragraph hashes live in the index, never in the `.md`, so the text stays clean; a save yields the exact changed paragraphs.

Three speeds:

1. **Every save, no AI (milliseconds):** word counts, mentions and underline, new-name candidates, edited AI paragraphs lose their margin line, and every fact whose cited paragraph changed is marked "to recheck".
2. **When the author pauses, light AI:** after a few minutes idle, on leaving the chapter, or on closing the app, if the change is big enough (about 150 words, or a paragraph a fact cites) the chapter is re-digested. The model gets the previous digest plus only the changed paragraphs and returns a patch: summary, facts, open threads.
3. **Before any task that reads the index:** a pre-step compares each chapter's hash with its digest's hash and refreshes the stale ones first. This holds even if steps 1–2 never ran (app closed, offline, the `.md` edited elsewhere).

Silent: no notice or clash pops up while writing (W14); at most a small "poniéndose al día" in the bar. Cost: light tier, a daily token cap, one chapter at a time.

Core: a job trigger on file change with debounce (G3) and the freshness pre-step; the paragraph ids and hashes are the writer's.

### 4.2 How a simulated reader remembers characters (Marco 2026-11-23)

A reader never gets the cards or the facts: those are the author's truth, and a real reader does not have them. It reads in batches of 2–3 chapters and keeps its **own memory**, written by itself after each batch, in its own words:

- per character: who I think they are, what I feel about them, the chapter I last saw them in, what I still wonder;
- the story so far as I understood it; my open questions.

Before each batch, code (no AI) finds who appears in it (`find_mentions`, aliases resolved) and, for each one coming back, adds to the prompt the reader's own last note and the gap ("Rosa vuelve; la viste por última vez en el cap. 2, hace 13 capítulos; anotaste: «la madre, en un recuerdo»"). A thin or missing note is kept thin on purpose: "no me acordaba quién era Rosa" is a finding about the book, not a failure of the reader. After the batch the reader updates its memory; characters it has not seen for long are compressed to a line, as real memory fades.

The memory stays small (~1–2k tokens), so a batch costs about the same in chapter 3 as in chapter 30. A saga reader starts book 2 with its memory from book 1, compressed.

### 4.3 How the AI writes in the author's style (Marco 2026-11-23)

No fine-tuning: the engines are CLIs. Style comes from four things, only ever learned from the author's own paragraphs (never AI-marked ones, so the AI does not learn its own style back).

1. **Measures, by code:** sentence and paragraph length, dialogue share, how dialogue is punctuated (rayas or comillas), tense and point of view, vos/tú, adverbs, favourite and never-used words. Cheap, exact, recomputed with the index.
2. **The voice guide (W22):** a few traits in words, each with a real example from the text, visible and editable. Short (~800 tokens).
3. **Real examples near the task:** 2–4 passages of the author of the same kind as what is asked (dialogue, description, action, introspection), picked by code from the book, preferably near in the story. Examples carry style far better than descriptions.
4. **The author's corrections:** every time the author edits an AI paragraph, the pair (AI version → author version) is saved. Recent pairs go into the prompt as "not like this / like this"; every so often they are distilled into guide traits the author approves ("cambiás «dijo con voz suave» por «dijo»").

After writing, code compares the draft's measures with the author's (sentence length way off, rayas swapped for comillas, a banned word, typical AI phrases from a list). If it is far off, one silent retry with the gaps named; never more than one. Writing runs on the standard or deep tier; a light model does not hold a voice.

Measure (spike K5): blind test with the author, one of their paragraphs and one AI paragraph of the same scene; and how much of each AI paragraph the author ends up changing, tracked over time.

### 4.4 What is still to come: planning the novel (proposal, Marco 2026-11-23)

The app also helps plan the future of the novel, not only write and read it.

Storage, in Markdown like the book (W37), so the author owns it:

- `plan.md` per book (and one per saga): acts → chapters → beats as list items, each with a state (pendiente / escrito / cambió). Chapters already written link to their `.md`.
- In data: **threads** (a setup with the chapter where it should pay off), **arcs** (where each character should end up; in a saga, the future stages of the card, W26), **ideas** (loose notes, no place yet).

Who uses it:

- **Co-writing:** the context pack carries the plan for this chapter and the next one or two, plus threads due soon. Rule in `cowrite`: know the future, never tell it; plant, don't reveal.
- **Readers never see it,** like the cards.
- **Planning flows:** "Pensar con la IA": a free conversation, never fixed options (Marco 2026-11-23); the AI asks, proposes and turns what is said into proposed plan changes the author keeps, edits or drops; it may offer paths inside the conversation when useful; "Planificar el próximo capítulo" (beats from the plan + open threads + arcs); "Revisar el plan" (plan against what is written and against the facts: threads never paid, a stalled arc, a planned event that breaks the timeline, chapters left vs. pace).
- **Drift, silent:** after each digest, the chapter is compared with its planned beats, and each beat gets its state ("cap. 7 planeado: Bruno encuentra la carta; escrito: no pasó"). The plan is never changed by itself; changes are offered.

UI: where the plan lives on screen is not decided (Estructura extended, or its own place); round 6 with mockups.


## 5. L4 — tools (code, no model)

| Tool | Does |
|---|---|
| `split_chapters` | import only, once: manuscript (.docx/.md/.txt) → one `.md` per chapter, with titles and word counts |
| `entity_index` | names + aliases from the cards → a matcher |
| `find_mentions` | runs the matcher over a chapter → `mentions`; feeds the dotted underline (W11) |
| `new_names` | capitalised names repeated ≥3 times with no card, minus a stop list → the "Nuevo en el texto" band (W36) |
| `context_pack` | for a passage: the paragraphs around it, the cards of whoever appears, the voice guide, the chapter digest and the previous one, under a token cap |
| `facts_for` | the facts about given entities, across books in a saga, ordered by story time |
| `build_timeline` | facts with dates → ordered timeline; age arithmetic ("41 in 1957 → 44 in 1960") |
| `apply_edit` | writes a replacement into the chapter file and records `authorship` |
| `export` | .docx / EPUB / PDF / Markdown (W16), with an existing library (pandoc or `docx`/`epub-gen`; to choose) |

## 6. L5 — flows: every button, mapped

| UI moment (canvas) | Flow | Tier | Pre-steps (code) | Skills | Ends with |
|---|---|---|---|---|---|
| Writing a chapter (1.x, 7.2) | action `write`, one task per chapter session | standard | `context_pack` for the chapter | `voice`, `cowrite` | — (inline asks are turns) |
| Reescribir / Seguir / Pedile algo (2.x, 7.3, 7.4) | a turn inside the `write` task | (task's) | `context_pack` for the selection | `cowrite` | `apply_edit` → margin line |
| Opinar › selección/capítulo (2.x) | action `opinion` | standard | `context_pack` | `line-edit` or `consistency` | anchored notes (margin dots) |
| Pedir lectura › estructura (3.x) | action `reading_structure` | deep | digests + `structure` | `developmental` | reading document (Lecturas) |
| Pedir lectura › consistencia (3.x, 6.8) | action `reading_consistency` | standard | `facts_for` + `build_timeline` + mentions of the scope | `consistency` | clash blocks + notes |
| Pedir lectura › lectores (3.x) | action `reading_readers`, one task per reader | standard | reader card + digests (+ full chapters in scope) | `beta-reader` | reading document per reader |
| Resolver un choque (7.7) | action `resolve` | standard | both passages + `facts_for` | `consistency`, `voice` | 3 proposals; "Aplicar" → `apply_edit` + card update |
| Nuevo en el texto (7.8) | tool `new_names` on digest; "Crear ficha" = action `card_draft` | light | mentions of the name | `story-bible` | card block, editable |
| Importar (4.x, W18) | job recipe `import` | light per chapter, standard merge | `split_chapters` | `import`, `story-bible` | review step "Lo que encontré" |
| Aprender tu voz (5.x, W22) | action `learn_voice` | standard | sample of the author's paragraphs (not AI-marked) | `voice` | voice traits with examples |
| Crear lector (W21) | action `reader_draft` | light | — | `beta-reader` | reader card |
| Exportar (W16) | tool `export` | none | — | — | file |
| Keep the index fresh | job `digest`, per changed chapter | light | `find_mentions` | `story-bible` | `digests`, `facts` |

## 7. Saga

Proposal to confirm: the saga is the scope (a standalone book is a scope with one book). Shared collections (`characters`, `places`, `world`, `glossary`, `timeline`, `voice`) live at scope level; each book keeps its `chapters`, `digests`, `facts`, `mentions`, `readers`, `readings`, `notes`. Saga readings (W27, W32) read the earlier books' digests and facts, never their text.

## 8. What the core lacks today (gaps)

| # | Gap | Why the writer needs it | Proposed core change |
|---|---|---|---|
| G1 | A harness cannot ship skills; only a scope's engine config can, after the person approves it | §3: the writer's know-how | manifest `skills: "./skills"`; the core passes them like hatches §5.2 (snapshot + `--plugin-dir` on Claude, `.agents/skills` on Codex) with no approval, since they ship with the harness; per-action list of skills |
| G2 | An action started from a mod's UI with a payload (selection, scope) and its result written into a document instead of the chat | the hoja is a mod; Reescribir is not a chat | mod API: `runAction(id, input)` + a result channel; to check what 0c/1a already give |
| G3 | Jobs fire on start, manual, afterTask or every ≥15 min, not on file change | the author writes by hand, with no task; digests go stale | `on.fileChanged: "<glob>"` with debounce |
| G4 | A recipe has one AI step; import needs one per chapter (30+) then a merge | import, re-digesting after a big edit | `forEach` on the AI step with a concurrency cap, or a job that spawns jobs |
| G5 | History tracks turns, not who wrote each paragraph | margin line, Deshacer per paragraph (W6, W10) | `authorship` collection written by `apply_edit`; the core's history stays as is |

## 9. Spikes before planning

| # | Question |
|---|---|
| K1 | Do Codex and OpenCode load the same `skills/<name>/SKILL.md` layout, and how is it passed per session? |
| K2 | Latency and cost of a Reescribir turn inside a warm `write` task vs. a fresh session (target: first words under ~3 s) |
| K3 | Digest quality on a light tier: does a light model extract ages and dates reliably enough for consistency? (measure on La sal del faro sample) |
| K4 | Token cost of a structural reading with digests vs. full text, from `usage.jsonl` |
| K5 | Voice: blind test (author's paragraph vs. AI paragraph of the same scene) and the share of each AI paragraph the author rewrites, before and after the corrections loop |

## 10. Order (proposal)

1. Core gaps G1 and G2 (without them nothing ships).
2. Writer v1: write + Reescribir/Seguir/Pedile, voice, cards by hand, underline, export. No index yet.
3. Book index: digest job (G3), facts, mentions, new names.
4. Readings: consistency + Resolver, structural, readers.
5. Import (G4) and saga.

## 11. Open decisions for Marco

- D1 Skills as a core feature (G1) for every harness, or something only the writer has?
- D2 Inline asks as turns of one long `write` task per chapter (warm, cheap, but compaction) vs. one short task each (clean, slower)?
- D3 Saga = scope (§7)?
- D4 Order of §10.
