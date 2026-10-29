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
- `<core>/docs/architecture/` explains how the core works: `manifest.md`, `blocks.md`, `context.md`, `modes.md`, `phases.md`, `parallel.md`, `jobs.md`, `tools.md`, `setup.md`, `profiles.md`, `turn.md`, `engines.md`, `language.md`, `authoring.md`.
- In this repository: `harness.config.ts` (the manifest), `agent/AGENTS.md` (the instructions to the AI), `agent/tasks/*.md` (one brief per action), `agent/phases/*.md` (one brief per part, when an action has parts), `ui/` (the screen and the block components), `locales/en.json` (the UI strings).
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
- Ask whether a task has parts that always come in the same order (a warm-up, the main block, a close). If so, list them as the action's `phases`: an `id`, a `label`, a brief in `agent/phases/<id>.md`, `auto: true` on the parts the AI may leave on its own (without it, the AI's request waits for the person), `close: true` on the last part when it closes the task, and which modes each part allows (`modes`: `"any"`, `"none"` or a list of the action's modes). The whole task stays one conversation; the core gives the AI a `set_phase` tool to ask for the next part.
- Ask whether the person should pick how long a task lasts. If so, set `timeBox`: the lengths in minutes (`options`), a `default` (one of them, or `null` for no limit) and when to wrap up (`wrapUpAt`; suggest 0.85, which leaves the last 15% for the close part; without it the wrap-up comes when the time is up). Near the end the AI is asked to finish its point, then the task moves to the close part.
- A part's brief is one more message in the same conversation, not a new start: say what this part is for, what to do first (often the first question to the person) and when to call `set_phase` with the next part's id (in the close part, its own id when the task is done). It may use `{{language}}`, `{{phase}}` (this part's label), `{{previousPhase}}` and `{{timeLeft}}`. Leave `brief` out for a part that needs no words; then moving there changes only what the person sees. Try it with `humanharness run <action> --time <minutes>` and `>phase <id>` at its prompt. See `<core>/docs/architecture/phases.md`.
- Ask whether the person runs several independent tasks side by side (two tickets, two chapters, material for two courses) and would rather not wait for one to finish before starting the next. If so, declare `parallel: { tasks: <n> }` (1 to 8; 2 or 3 is a good start): each open task keeps its own chat and session, turns past the cap wait in a queue, and a core inbox shows which tasks wait for the person. Don't declare it for one guided flow where each task builds on the last: that harness is simpler as it is. The caps are suggestions: the person can change them in Settings › General, and an engine not yet checked with two sessions runs one at a time. To draw your own list of open tasks instead of the core inbox, set `inbox: false` and read `client.tasks` (`list`, `onChange`, `focus`). See `<core>/docs/architecture/parallel.md`.
- Ask whether some work should happen with nobody watching: a sync that pulls new tickets in, a check after a task closes, a digest every few hours. If so, declare it in `jobs`: an id, a `label`, a brief in `jobs/<id>.md` and when it runs (`on`: `start` once per app start, `manual` for a "Run now" button, `afterTask` after a task (any, or of the listed actions) ends done with its note saved, `every` with a duration of 15 minutes or more). A job has no chat: it can't ask the person, show choices or save a note. Its brief says what to do and how to judge the outcome; the core adds the notes index and data of its scope, and how to end: one `job_result` call with `ok`, `needs-you` (naming the action the person should start, which the app offers to start) or `failed`, and a one-line summary. Give it `tier: "light"` (the default) unless the work really needs more. An `every` job needs `dailyTokens`, the most its timed runs spend in a day; the person can change the cap or turn the job off in Settings › Jobs. Give a job only the permissions it needs, narrower than the harness's: `permissions: { edit: "none" }` for a sync that only writes `data`. Pick its `scope`: `none` (app-wide), `each` (once per active scope) or `trigger` (the scope of the task or the Run now that fired it). Don't make a job of anything the person should decide or review as it happens: that is a task. Try it in the app with "Run now" (`on.manual`). See `<core>/docs/architecture/jobs.md`.
- Rewrite `agent/AGENTS.md`: what the AI does in this harness, and when it calls each block's tool.
- Keep the Flow table in sync, one row per action plus `(questions)` for free questions; `check` compares it with `harness.config.ts`:

  | Action | Tier | Cost | Purpose |
  |---|---|---|---|

Remove the template's `example` action and its brief once the harness has its own.

## Phase 4 — Mechanical work

Fills: HARNESS.md → Mechanical work

Go through the flow moment by moment with the person. For each key moment, ask what happens there and sort it:

- **Code** when the answer is fixed by the data: what is due today, which tickets changed, a count, a date, a list of files. Code is exact, instant and free.
- **AI** when it takes judgment: what a student got wrong, which CI failure matters, how to word a reply.

For each moment write a row: the moment, code or AI, the tool or step, and why it matters (time, tokens, mistakes avoided). Then propose:

- **tools** for the code parts (`tools/<id>.ts`, `defineTool`): a `description` the agent can act on, `params`, `returns` when another step reads the result, `agent: "none"` for anything with effects outside the folder (moving a ticket, commenting on a PR), and `uses` with only what it reaches;
- **pre-steps** (`pre` on an action) for what a task always needs at its start: their results go into the first message, so the AI doesn't spend turns finding them;
- **`expects`** on a phase when the AI should call a tool there (a phase that ends without it is counted);
- **job recipes** (`steps` on a job) for background work that is mostly mechanical: tool steps, at most one AI step with a `when`, then a post-step that applies the AI's judgment.

Write one fixture per tool (`tools/<id>/fixtures/<case>.json`: the `args`, the `exchanges` its fetches and commands get, the `data` and `files` it starts from, and the `expect`ed `result` or `error`) and run `humanharness tool test <id>` before wiring it. A fixture reaches no network and no keys: fetches and commands answer only from its `exchanges`, keys are `fixture-<id>`, data stays in memory and files go to a temp folder. `corepack pnpm check` runs every fixture too, and a failing one is an error.

`humanharness tool run <id> --args '{…}'` then tries the tool once, for real, and prints its result and trace: its fetches reach public hosts only, its commands run on this computer, and it reads and writes `--folder <dir>` (a new temp folder without it) with `--scope <id>` if it needs one. The terminal can't read the app's keys, so it asks for each key the tool declares, hidden; a tool that writes runs only with `--yes`. Ask the developer before running it against a real service. `tool test`, `tool run`, `check` and `run` print a note before tool code runs: it runs in the terminal's own process, not in the app's sandbox, so run only tools you trust.

`humanharness run <action>` runs the tools as the app does: the pre-steps before the first message (a required one that fails stops the task) and the agent's tool calls, one line each. With `--record`, the recording keeps the agent's tool calls and each tool's fetches and commands under `mock/tools/<tool>/`, every key replaced. In `dev --mock` the tools run for real, but their fetches and commands answer only from those files ("Not recorded: <target>" otherwise), and a recipe's AI step answers from `mock/steps/<job>.json`, which `check` compares with the step's `output`. See `<core>/docs/architecture/tools.md`.

## Phase 5 — Context

Fills: HARNESS.md → Context

Every task ends with a note the app writes from the core `save_note` block (title, summary, decisions, files, open questions), and the next task starts from the index of notes. Ask:

- what each closed task must keep, and what goes in each `save_note` field for this harness;
- which folders, if any, the AI should read but never change (`folder.references`);
- what must never be lost;
- whether the work splits into scopes the person opens one at a time (a topic, a project). If it does, declare `scopes` with its label and plural; each scope then gets its own tasks, notes, chat and data. Every action runs inside the open scope, except the ones marked `scope: "none"`, which run app-wide (a welcome, a profile);
- with scopes, whether a scope's work lives partly in folders outside the person's folder that change per scope (a project's code repositories, a manuscript folder). If so, declare `linkedFolders`: per kind a `label`, `mode` (`read`, or `write`, which needs `permissions.edit: "folder"`), `history` (`auto`: the app's history tracks a folder without git and leaves a git one to its own git; `own`: only git repositories) and `many`. The person links each folder through the system picker in Scope settings (the harness UI can open it with `client.scopes.linkFolder(scope, key)`, never with a path); the agent then gets file access to them, but its file tools can never edit their `.claude/` or `.git/` (reading them is allowed, and with `exec` the shell can still write there). Don't use it for folders every person shares and never changes: that is `folder.references`. See `<core>/docs/architecture/hatches.md`;
- which structured records the harness keeps besides the notes, in `data`. For each collection: its zod schema and key (or `single: true`), whether it belongs to a scope (`scoped`), what the agent may do with it (`agent`: `write`, `read` or `none`), which fields go into a task's first message and in how many tokens (`context`), and the `rules` every write must pass (a pure function that returns `true` or the reason it refuses);
- which knobs the person sets for themselves (tone, how much to explain, after how many tries a hint comes, which checks to run). Declare them in `settings`: a zod `schema`, a `default` (given here, not on the schema), a `control` (`segmented`, `select`, `toggle`, `number`, `text`), a `label`, and an `agent` sentence in English with `{{value}}` or `{{value:label}}` ("Use a {{value}} tone."; `{{value:label}}` inserts the option's label as written). A `text` setting whose sentence uses the value needs `.max(n)` on its schema, so a long answer can't flood the instructions. The core draws the tab and writes the sentences into the agent's instructions; changes apply from the next task. Leave `agent` out for a setting only the harness's screens use, and use `onlyWhenChanged: true` for sentences that only matter when the person changed the default. Try values with `humanharness run <action> --set name=value`.
- whether the app needs to know something before the first task. If so, which of: a short form, a short interview, a screen of your own. Declare it in `setup`, in order, each step with an `id`, a `label`, an optional `description` and `required: true` only when the app can't work without it (a skippable step can be done later from Settings):
  - a short form: `kind: "form"` with a `single`, unscoped collection and the `fields` to ask for, or `settings` with names of harness settings;
  - a short interview: `kind: "interview"` with an `action` (not in `path`, not `deep`, `scope: "none"` when the harness has scopes) and the collection it `writes` (`single`, unscoped, `agent: "write"`, with a `context` so a second run sees the first one's answers). Its brief says what to find out; the core adds how to save it. If the harness has mock recordings, record one for the action (`humanharness run <action> --record`);
  - a screen of your own: `kind: "component"` with the name of a React component in `ui/`, passed to `HarnessApp setupSteps={{ Name }}`; it calls `done()` or `skip()`.
  See `<core>/docs/architecture/setup.md`.
- whether several people use the app on one computer (a family, a classroom). If they do, declare `profiles` with its `label` (what one of them is called: "student", "player") and the `fields` its add form asks for (`name` first; a `color` field of `PROFILE_COLORS` colours each avatar), and a `profile` collection (`single: true`, `scoped: false`, a `name` string) with a `context` when the AI should know who it talks to; each profile then gets its own folder, tasks, notes, chats, data and history. Profiles keep work apart but don't protect it, and adding them later has no migration yet. See `<core>/docs/architecture/profiles.md`.
- whether the person brings their own material (a textbook chapter, class notes, a spreadsheet, a web page) that tasks should work from. If so, declare `material`: which families it `accepts` (`pdf`, `word`, `spreadsheet`, `presentation`, `ebook`, `web`, `text`; all by default), the `sheet` sections the AI writes once per scope (an `id`, a `label` and a `prompt`, in English; the core adds "Notation and conventions" and "What the material does not cover"), the `fragmentKinds` your briefs talk about, the `items` collection fragments link to (a keyed collection the agent can see, and its label field) if the harness tracks topics, and whether the person may switch `grounding` between `strict` (only the material) and `mixed`. The core converts, cuts, checks and labels the files, warns about cost before any model runs, and gives each task a short index; the agent fetches fragments with `material_read` and cites them as `[[frag:<id>]]`. Each stage is a row in Settings › Models. See `<core>/docs/architecture/material.md`.

Say it in the briefs where it matters, for example: "the decisions are the options the person chose, each with its reason".

## Phase 6 — Models

Fills: HARNESS.md → Models

For each action, and for free questions (`questions.tier`), choose a tier and give a one-line reason. Start low: the smallest tier that does the job well. Background jobs default to `light`; raise one only with a reason.

- `light` for mechanical or short work;
- `standard` for most tasks;
- `deep` for analysis or design.

Write the tiers in `harness.config.ts` and in the Flow table. A `heavy` action at `light`, or a `light` one at `deep`, makes `check` warn: explain it or change it.

## Phase 7 — Permissions and engines

Fills: HARNESS.md → Permissions and engines

Ask for the minimal permissions the flow needs, each with its reason:

- `edit`: `folder` (the AI may change files in the person's folder) or `none`;
- `exec`: whether it may run commands;
- `web`: whether it may use the web.

Write one line each in `HARNESS.md` (`- edit: none — reason`) and one `- engines: claude, codex` line. `check` compares them with the manifest, warns about a wide permission without a reason, and refuses an engine whose terms don't allow this use. List only the engines you test with.

Ask too whether the harness's own screens need work the window can't do and the agent shouldn't (convert a file, watch a folder, keep a cache). If so, declare `backend: "./backend/index.ts"`: a Node process of the harness's own that the app starts after setup and the harness UI calls with `client.backend.call` and hears with `client.backend.on`. It reads JSON-RPC 2.0 lines on stdin and writes them on stdout, every line with `"jsonrpc":"2.0"`; logs go to stderr, never stdout. A `.ts` backend uses erasable syntax only and imports the SDK with `import type`; no native modules yet. It runs as the person's user, so it gets the same care as an MCP server, and it can't write the history, notes or data: those go through the harness UI. Record it as a decision with its reason. See `<core>/docs/architecture/authoring.md` ("A backend") and `<core>/harnesses/demo/backend/index.ts`.

## Phase 8 — Identity

Fills: HARNESS.md → Identity

Ask for the name, a one-line tagline, the author and, optionally, a logo file (SVG, PNG or JPEG) in this repository. Write them in `harness.config.ts` (`name`, `tagline`, `author`, `logo`), in English. No provider or model brands.

### Language

- Write everything in English: the manifest's texts, `locales/en.json`, the instructions and every brief. The app ships in English and translates the screens into the person's language on their own engine; the AI reads English and answers in the person's language. English is what the models reason best in.
- Write one `locales/en.json`, in English. Don't add other `locales/*.json` files: the app doesn't read them. When the person picks another language, the app translates the core's and this file's strings on demand, on the person's engine, with the manifest's `tone`, and caches them.
- Keep every `{{placeholder}}` as it is, and use as little markup as you can: a translation must keep the same placeholders and tags, or that string stays English.
- Put any terms, consent or responsibility text under `legal.` in `locales/en.json` (`"legal": { "consent": "…" }`). Those strings are never translated and always show in English.
- Give the manifest a `tone`: one English line on how the translated screens should sound ("warm and informal, short sentences"). Record it in `HARNESS.md`.
- In a brief, `{{language}}` is the person's language by its English name ("Brazilian Portuguese").

## Lessons

Mistakes already seen. Read them before writing tools; add one when a harness teaches a new one.

- English ids: tool ids, step names (`as`), fields and examples are in English.
- Give a tool `returns` whenever a step reads its result (`input`, `forEach`): `check` refuses the step otherwise.
- No date or counting logic in prompts when a tool can do it: "what is due today" is a tool, not a paragraph in a brief.
- One tool per mechanical job, not one tool that does everything: small tools are easier to test, trace and reuse.
- Test every tool with a fixture before wiring it into a step.

## Phase 9 — Verify

Fills: HARNESS.md → Open questions, Decision log

1. Run `corepack pnpm check` and fix every error.
2. Go through the warnings with the developer: fix each one, or record in the Decision log why it stays.
3. Open the app with `corepack pnpm dev`. The first time, the developer accepts the engine's notice there; `run` needs it.
4. Ask the developer before running a task for real: it uses their engine plan. If they agree, run at least one: `corepack pnpm run run <action> --engine claude` (or `codex`); the engine's official CLI must be signed in. Read its report (tokens per phase, peak context against the cap, the cost hint) and adjust tiers or briefs.
5. Leave **Open questions** empty, or with only what the developer chose to keep open.
