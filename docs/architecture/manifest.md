# The manifest

A harness is a folder whose `harness.config.ts` default-exports `defineHarness({...})` from `@humanharness/harness-sdk`. `defineHarness` validates the object with zod and fills the defaults; `loadHarness` imports it from plain Node (so the manifest holds no React), records the harness folder as `root` and checks every action's, mode's and phase's brief.

A harness in its own repository imports the same functions from `@humanharness/cli/sdk`, its only dependency (see `authoring.md`); harnesses inside this repository, like the demo, import `@humanharness/harness-sdk` directly.

## What each field does

Every text in the manifest is one English string.

| Field | What the core does with it |
|---|---|
| `id`, `name`, `tagline`, `logo` | The app's name and data folder, the Home screen |
| `author`, `donate` | Settings → About |
| `tone` | One English line on how the translated screens should sound; the app ships in English and will translate (plan 5b) on the person's engine |
| `engines` | Engines the harness was tested with; `availableEngines` in `packages/engines` keeps the ones whose legal status allows it |
| `folder.suggested`, `folder.seed` | Where the person's work lives; the seed is copied there when the folder is empty (`prepareFolder`) |
| `folder.references` | Folders the agent may read but never change; `"app-source"` is the repository the app runs from, in development only |
| `instructions` | The base `AGENTS.md`; the core appends a managed section (`writeInstructions`) |
| `permissions` | `edit` (`folder` or `none`), `exec`, `web`: turned into Claude's allowed and denied tools and into Codex's permission answers |
| `blocks` | `defineBlock({ description, visible, schema, example })`: one MCP tool per block, served by the `ui` server |
| `actions` | Tasks: `label`, optional `description`, `prompt` (the brief that opens the task's session), `cost` (`light`, `medium`, `heavy`), optional `modes` and `defaultMode` (`docs/architecture/modes.md`), and optional `phases` and `timeBox` (`docs/architecture/phases.md`) |
| `path` | The optional guided order of action ids (the "Recorrido") |
| `mcp` | Extra MCP servers (files in the harness folder) the agent gets next to `ui` and `data` |
| `scopes` | Optional. The label and plural of the harness's unit of work (a topic, a project); actions may set `scope: "none"` to run app-wide (`docs/architecture/data.md`) |
| `data` | Optional. Collections of records with a schema, key, agent permission, context budget and rules (`docs/architecture/data.md`) |
| `settings` | Optional. Knobs the person sets in a Settings tab of the harness's own; their sentences go into `AGENTS.md` (`docs/architecture/settings.md`) |
| `modes` | Optional. Ways the AI works inside a task: `label`, `description`, `brief`, `minTier`, a `recommend` hint only the agent reads, and mode settings (`docs/architecture/modes.md`) |
| `setup` | Optional. The harness's own setup steps, after the folder and the engine: a form, an interview or a component (`docs/architecture/setup.md`) |
| `material` | Optional. The person's own files (PDF, Word, spreadsheets, slides, ebooks, web pages, text), cut into fragments a task fetches on demand: the families it `accepts`, the `sheet` sections, `fragmentKinds`, the `items` collection fragments link to, `grounding`, the index `budget` and per-stage `tiers` (`docs/architecture/material.md`) |
| `profiles` | Optional. Several people on one install, each with a folder of their own: `label` (what to call one, "student") and `fields` (the `profile` collection's fields the add and edit form asks for, `name` first) (`docs/architecture/profiles.md`) |
| `sidekick` | Optional. The prompt coach: its `default` state, `tips`, the pre-send mode per action, `checks`, and the harness's `places` and `presets` (below; `docs/architecture/sidekick.md`) |

### Phases and the time box

An action may split into ordered parts inside one task and one session, and offer lengths the person picks at the start (`docs/architecture/phases.md`). From the `tutor` test fixture (`packages/fake-agent/fixtures/phases-harness`):

```ts
session: {
  label: "Session",
  prompt: "./agent/tasks/session.md",
  cost: "light",
  modes: ["socratic", "feynman"],
  defaultMode: "socratic",
  phases: [
    { id: "warmup", label: "Warm-up", brief: "./agent/phases/warmup.md", auto: true, modes: "none" },
    { id: "main", label: "Main block", brief: "./agent/phases/main.md" },
    { id: "close", label: "Close", brief: "./agent/phases/close.md", close: true, modes: "none" },
  ],
  timeBox: { options: [15, 30, 45], default: null, wrapUpAt: 0.85 },
},
```

- `phases`: 1 to 12. Each has an `id` (the action id pattern), a `label` (≤ 80), an optional `brief` file (filled with `{{language}}`, `{{phase}}`, `{{previousPhase}}`, `{{timeLeft}}`), `auto` (the agent may move on alone), `modes` (`"any"`, `"none"` or a list of the action's modes) and `close: true` (the part that ends with the core closing turn).
- `timeBox`: `options` (1 to 6 whole minutes, 1–240), `default` (one of them, or `null` for no limit; absent is `null`), `wrapUpAt` (optional, `0 < x ≤ 1`). It works with or without phases.

### Sidekick places and presets

Two optional lists in the `sidekick` block (`sidekickSchema` in `packages/harness-sdk/src/sidekick.ts`). From a manifest:

```ts
sidekick: {
  default: "off",
  places: [{ id: "summary", label: "Summary", description: "The session summary the harness shows at the end." }],
  presets: [
    { name: "Guard", mark: "🛡️", personality: "Calm and brief.", purposes: [{ id: "process-guard" }] },
    { name: "Reader", mark: "📖", personality: "", purposes: [{ id: "custom", text: "Point out what the summary leaves out.", moments: ["place:summary"] }] },
  ],
},
```

- `places[]`: at most 12. `id` (`^[a-z][a-z0-9_-]{0,63}$`, unique), `label` (≤ 40), `description` (≤ 300): a part of the harness's screen where its UI can ask a sidekick about some content with `client.sidekick.ask(id, content)` and show the short free-text answer.
- `presets[]`: at most 8 ready-made sidekicks the person is offered in Settings and may add. `name` (≤ 40, unique: adopting one finds it by name), `mark` (≤ 16, an emoji or short text), `personality` (≤ 1,500, may be empty), `purposes` (1–6): `{ id: "prompt-coach" | "focus" | "process-guard" | "mentor" | "daily-summary" }` or `{ id: "custom", text (≤ 600), moments (1–7) }`. A moment is `pre-send`, `after-reply`, `heads-up`, `before-approve`, `phase-change`, `daily` or `place:<id>`.
- A manifest without them parses to the same object as before (D0).

The harness's screen is `ui/App.tsx`: the shell build (`packages/shell/electron.vite.config.ts`) bundles it from the harness folder.

## Checks

- Block and action names follow fixed patterns. `choices`, `save_note`, `annotate`, `recommend_mode` and `set_phase` are reserved: every harness gets the first two as core blocks, a harness with input blocks gets `annotate`, a harness with modes gets `recommend_mode` and a harness where some action has phases gets `set_phase` (`allBlocks`).
- Every id in `path` must be an action, once; reference ids are unique.
- A block's `example` must match its `schema`.
- An action may set `scope` only when the harness declares `scopes`, and a `scope: "none"` action can't be in `path`.
- A collection needs a key (or `single: true`); the key must be a field of the schema declared exactly as `z.string()` or `z.number()` (no enum, literal, optional, nullable or default). Its `context` fields must be fields of the schema, and a collection hidden from the agent (`agent: "none"`) can't have a `context`. `settings` is a reserved collection name.
- Settings: at least one field, of its own or of a mode; every field has a `default` that matches its `schema` (the schema itself takes no `.default()` or `.optional()`); each control has its zod type; `options` only on segmented, select and toggle, with keys that are values of the schema; section ids are unique and every `section` is declared; agent sentences use only `{{value}}` and `{{value:label}}` (the latter on segmented, select and toggle), and a `text` field whose sentence uses the value has a `.max(n)` on its schema. `modes` is a reserved setting name.
- Modes: ids follow the action id pattern and aren't `recommend` or `ask`; an action's `modes` name declared modes, once each; `defaultMode` is one of them, `recommend` or `ask`, and only on an action with modes; mode settings pass the settings checks (no `section`) and need the harness's `settings` (its tab draws them). `humanharness check` also reports a mode brief that is missing, unreadable or empty (`brief-missing`).
- Phases: ids unique within the action; `close` only on the last phase; a phase's list of `modes` only on an action with modes, each one of its modes. A time box's options are each offered once and its `default` is one of them or `null`. `humanharness check` also reports a phase brief that is missing or empty (`brief-missing`).
- Setup steps: 1 to 8, ids unique. A form takes a `single`, unscoped collection and fields the core form can draw, or settings of the harness, not both. An interview's action isn't in `path`, isn't `deep`, runs app-wide and backs one interview; its `writes` collection is `single`, unscoped and `agent: "write"`. `humanharness check` also warns about a component it can't find in `ui/` (`setup-component`), an interview's action without a recording once `mock/` has recordings (`setup-mock`) and an interview's collection without `context` (`setup-context`) (`docs/architecture/setup.md`).
- Profiles: `profiles` needs a `profile` collection with `single: true`, `scoped: false` and a `name` field that is a string (`z.string()`, with or without bounds). `fields` has 1 to 6 entries, each once, starts with `name`, and names only fields of that collection the core form can draw (`docs/architecture/profiles.md`).
- Material: `accepts` and `fragmentKinds` list each value once; `sheet.sections` ids are unique and aren't the core's (`notation`, `not-covered`); `items.collection` is declared in `data`, has a key (not `single`) and isn't hidden from the agent (`agent: "none"`), and `items.label` is one of its fields; the action ids `material-review`, `material-repair`, `material-label`, `material-sheet` and `material-link` are reserved. `humanharness check` also warns about a `light` review tier (`material-review-tier`) and an app-wide `items` collection in a harness with scopes (`material-items-scope`) (`docs/architecture/material.md`).
- Sidekick: `sidekick` can't be an action id or a collection name; every action in `sidekick.actions` must exist; place ids and preset names are unique; a preset's custom `place:<id>` moment must name a place declared in `sidekick.places` (a parse error). `humanharness check` warns about tips over 300 tokens (`sidekick-tips`) (`docs/architecture/sidekick.md`).
- A harness whose id is `ui` or `data` can't have `mcp` entries (those are the built-in server names).
- `resolveInHarness` refuses any path that leaves the harness folder: every action's prompt, every mode's brief and every phase's brief (checked by `loadHarness`), and the instructions, seed, logo and MCP servers when they are used.

## Where to look

- `packages/harness-sdk/src/index.ts`: the schema, `defineHarness`, `loadHarness`, `resolveInHarness`.
- `packages/harness-sdk/src/block.ts` and `core-blocks.ts`: blocks and the core blocks.
- `packages/harness-sdk/src/settings.ts`: the `settings` schema and its helpers.
- `packages/harness-sdk/src/modes.ts`: mode ids and `defaultModeOf`.
- `packages/harness-sdk/src/phases.ts`: phase ids, `TIME_BOX_MAX`, `phaseModes`.
- `packages/harness-sdk/src/setup.ts`: the `setup` schema, `interviewCollections`, `setupFormSpec`.
- `packages/harness-sdk/src/material.ts`: the `material` schema, `MATERIAL_FAMILIES`, `MATERIAL_STAGES`, `hasMaterial`, `materialStageKey`, `stageTier`.
- `packages/harness-sdk/src/profiles.ts`: the `profiles` schema, `PROFILE_COLLECTION`, `PROFILE_COLORS`, `hasProfiles`, `profileFormSpec`.
- `packages/harness-sdk/src/sidekick.ts`: the `sidekick` schema, moments, purposes, places, presets and the `sidekick` collection's records.
- `harnesses/demo/harness.config.ts`: a complete manifest.
