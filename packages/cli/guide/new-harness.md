# /new-harness: build this harness step by step

You are helping a developer turn this repository into a Human Harness harness: a desktop app that puts a purpose-built interface and workflow on top of the person's own AI subscription. A good harness gets three pillars right:

1. **A decision UI.** The person decides through choices and cards, not by typing into a chat.
2. **An agentic flow** that keeps the AI on course: tasks with briefs, a guided path, choices that lead somewhere.
3. **Context and model management.** Each task saves what matters as a note, runs on the smallest model that does the job and gets only the permissions it needs.

Resources are part of the third pillar. A harness never names a model: each task asks for a **tier** (`light`, `standard` or `deep`), and the core maps the tier to a model, an effort and a context cap for each engine. A **cost** hint (`light`, `medium` or `heavy`) tells the person how much of their plan a task tends to use.

## How to work

- Ask **one question at a time**, in the developer's language, and wait for the answer. Offer a suggested answer when it helps.
- Write every file in English, including the harness's UI strings in `locales/en.json`.
- Read `HARNESS.md` first: it is this harness's living decision log. Never ask again what it already answers; offer to revisit it instead.
- Each phase ends with two things done together: its `HARNESS.md` section updated, and the code changed to match. Add a dated entry to **Decision log** for each decision: the decision, the reason, the alternatives rejected.
- After each phase, suggest running `corepack pnpm check` (it runs `humanharness check`), and fix every error it reports.
- When the developer is unsure, write the question under **Open questions** and move on.

## Where things are

- The core checkout is the folder `package.json` links to: `"@humanharness/cli": "link:<core>/packages/cli"`. Below, `<core>` is that folder.
- `<core>/harnesses/demo` is a complete example (custom blocks, a guided path, briefs, references). Read it for ideas; never copy it as a starting point.
- `<core>/docs/architecture/` explains how the core works: `manifest.md`, `blocks.md`, `context.md`, `modes.md`, `turn.md`, `engines.md`, `authoring.md`.
- In this repository: `harness.config.ts` (the manifest), `agent/AGENTS.md` (the instructions to the AI), `agent/tasks/*.md` (one brief per action), `ui/` (the screen and the block components), `locales/en.json` (the UI strings).
- Import the SDK from `@humanharness/cli/sdk` (`defineHarness`, `defineBlock`, `z`) and the UI kit from `@humanharness/cli/ui` (`HarnessApp`, `BlockProps`, `useTranslation`).

## Rules

- Never edit files outside this repository.
- Never read `~/.claude`, `~/.codex` or `~/.gemini`, and never touch credentials or their environment variables. People sign in through the engine's official CLI; a harness never handles accounts.
- No provider or model brands (Claude, Anthropic, Codex, OpenAI, ChatGPT, GPT, Gemini, Google, Kimi, Moonshot, Qwen, Alibaba) in the harness's name, tagline or logo.
- Minimal permissions: the AI gets only what the flow needs, and every wide permission has a written reason.

## Phase 1 — Task

Fills: HARNESS.md → Task

Ask what job the person gets done with this harness, and for whom. Insist on a concrete outcome ("a weekly meal plan with its shopping list", "a reviewed pull request"). If the answer is "a chat about X", ask what the person has in hand when they are done.

Write two or three sentences: who, the outcome, and what makes it hard without the harness.

## Phase 2 — Decisions

Fills: HARNESS.md → Decisions

Ask which choices the person makes along the way, and what they need to see in order to decide. For each one:

- When picking among up to four ways to continue is enough, it is the core `choices` block (`show_choices`).
- When they need to see structured information (a comparison, a plan, a diagram), design a custom block: `defineBlock({ description, visible: true, schema, example })` in `harness.config.ts`, a component in `ui/` registered in `ui/App.tsx`, and its strings in both locale files. Keep schemas small and bounded (maximum lengths, maximum items). A state-only block (`visible: false`) updates a side panel instead.
- When the person must answer something the task depends on (commit to an answer, explain in their own words, sum up, make flashcards), give the block an `input`: a `z.object` of the answer, checked by the app. Name each field's label in `inputUi` (in English), a `submitLabel` if "Send" doesn't fit, and `skippable: true` when skipping is fine. The core draws the form; register a component only for fields it can't draw (`check` says which), and if that component reuses `InputForm`, key it by `input.blockId`. Add `saveTo: { collection }` to keep each answer in `data`; when `saveTo.records` maps an answer to records, derive their keys from the answer, so answering again replaces them instead of adding copies. The core `annotate` block lets the agent mark the person's words. Ask what the agent does with the answer, and write it in the brief.

Replace the template's `example_card` block once the harness has its own.

## Phase 3 — Flow

Fills: HARNESS.md → Flow

Ask which tasks (actions) exist. For each one: an id, a label and a one-line description in English, a brief in `agent/tasks/<id>.md`, and a cost hint (`light`, `medium` or `heavy`).

- A brief is the first message of the task's own engine session: what to do, what to read, which blocks to show, and to end with `show_choices`. It may use `{{language}}` and `{{notesIndex}}`.
- Ask whether the actions have a natural order. If so, set `path` (the guided path).
- For each `choices` option, decide where it leads: `followUp` (stays on the task), `action` (starts another task by its id) or `next: true` (the next task of the path).
- Ask whether a task has ways of working the person should pick between (task modes: Socratic or worked examples, plan or review). If so, declare `modes` (a `label`, a `description`, a brief in `agent/modes/<id>.md`, an optional `minTier` and a `recommend` hint only the AI reads) and list them on the action with a `defaultMode`: `recommend` (the default) lets the AI suggest one with the core `recommend_mode` block, `ask` asks the person first, a mode id starts in it. A mode's own settings go in its `settings` and need the harness's `settings` for their tab. Try one with `humanharness run <action> --mode <id>`, and `m <id>` at its prompt. See `<core>/docs/architecture/modes.md`.
- Rewrite `agent/AGENTS.md`: what the AI does in this harness, and when it calls each block's tool.
- Keep the Flow table in sync, one row per action plus `(questions)` for free questions; `check` compares it with `harness.config.ts`:

  | Action | Tier | Cost | Purpose |
  |---|---|---|---|

Remove the template's `example` action and its brief once the harness has its own.

## Phase 4 — Context

Fills: HARNESS.md → Context

Every task ends with a note the app writes from the core `save_note` block (title, summary, decisions, files, open questions), and the next task starts from the index of notes. Ask:

- what each closed task must keep, and what goes in each `save_note` field for this harness;
- which folders, if any, the AI should read but never change (`folder.references`);
- what must never be lost;
- whether the work splits into scopes the person opens one at a time (a topic, a project). If it does, declare `scopes` with its label and plural; each scope then gets its own tasks, notes, chat and data. Every action runs inside the open scope, except the ones marked `scope: "none"`, which run app-wide (a welcome, a profile);
- which structured records the harness keeps besides the notes, in `data`. For each collection: its zod schema and key (or `single: true`), whether it belongs to a scope (`scoped`), what the agent may do with it (`agent`: `write`, `read` or `none`), which fields go into a task's first message and in how many tokens (`context`), and the `rules` every write must pass (a pure function that returns `true` or the reason it refuses);
- which knobs the person sets for themselves (tone, how much to explain, after how many tries a hint comes, which checks to run). Declare them in `settings`: a zod `schema`, a `default` (given here, not on the schema), a `control` (`segmented`, `select`, `toggle`, `number`, `text`), a `label`, and an `agent` sentence in English with `{{value}}` or `{{value:label}}` ("Use a {{value}} tone."; `{{value:label}}` inserts the option's label as written). A `text` setting whose sentence uses the value needs `.max(n)` on its schema, so a long answer can't flood the instructions. The core draws the tab and writes the sentences into the agent's instructions; changes apply from the next task. Leave `agent` out for a setting only the harness's screens use, and use `onlyWhenChanged: true` for sentences that only matter when the person changed the default. Try values with `humanharness run <action> --set name=value`.

Say it in the briefs where it matters, for example: "the decisions are the options the person chose, each with its reason".

## Phase 5 — Models

Fills: HARNESS.md → Models

For each action, and for free questions (`questions.tier`), choose a tier and give a one-line reason. Start low: the smallest tier that does the job well.

- `light` for mechanical or short work;
- `standard` for most tasks;
- `deep` for analysis or design.

Write the tiers in `harness.config.ts` and in the Flow table. A `heavy` action at `light`, or a `light` one at `deep`, makes `check` warn: explain it or change it.

## Phase 6 — Permissions and engines

Fills: HARNESS.md → Permissions and engines

Ask for the minimal permissions the flow needs, each with its reason:

- `edit`: `folder` (the AI may change files in the person's folder) or `none`;
- `exec`: whether it may run commands;
- `web`: whether it may use the web.

Write one line each in `HARNESS.md` (`- edit: none — reason`) and one `- engines: claude, codex` line. `check` compares them with the manifest, warns about a wide permission without a reason, and refuses an engine whose terms don't allow this use. List only the engines you test with.

## Phase 7 — Identity

Fills: HARNESS.md → Identity

Ask for the name, a one-line tagline, the author and, optionally, a logo file (SVG, PNG or JPEG) in this repository. Write them in `harness.config.ts` (`name`, `tagline`, `author`, `logo`), in English. No provider or model brands.

### Language

- Write everything in English: the manifest's texts, `locales/en.json`, the instructions and every brief. The app ships in English and translates the screens into the person's language on their own engine; the AI reads English and answers in the person's language. English is what the models reason best in.
- Don't add other `locales/*.json` files: the app doesn't read them.
- Give the manifest a `tone`: one English line on how the translated screens should sound ("warm and informal, short sentences"). Record it in `HARNESS.md`.
- In a brief, `{{language}}` is the person's language by its English name ("Brazilian Portuguese").

## Phase 8 — Verify

Fills: HARNESS.md → Open questions, Decision log

1. Run `corepack pnpm check` and fix every error.
2. Go through the warnings with the developer: fix each one, or record in the Decision log why it stays.
3. Open the app with `corepack pnpm dev`. The first time, the developer accepts the engine's notice there; `run` needs it.
4. Ask the developer before running a task for real: it uses their engine plan. If they agree, run at least one: `corepack pnpm run run <action> --engine claude` (or `codex`); the engine's official CLI must be signed in. Read its report (tokens per phase, peak context against the cap, the cost hint) and adjust tiers or briefs.
5. Leave **Open questions** empty, or with only what the developer chose to keep open.
