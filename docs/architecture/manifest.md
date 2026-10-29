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
| `folder.references` | Folders the agent may read but never change; `"app-source"` is the repository the app runs from, in development only. They give file access only: nothing in their `.claude/` (skills, commands, agents) is loaded (`docs/architecture/engines.md`) |
| `instructions` | The base `AGENTS.md`; the core appends a managed section (`writeInstructions`) |
| `permissions` | `edit` (`folder` or `none`), `exec`, `web`: turned into Claude's allowed and denied tools and into Codex's permission answers. `edit: "folder"` also turns on document reviews (`docs/architecture/reviews.md`) |
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
| `plugins` | Optional. Whether the harness takes plugins: `bundled` (ids under `<harness>/plugins/<id>/dist/`), `on` (bundled ones that start on, without a review) and `local` (the person may add plugins from a folder; default `false`). Absent, or with no bundled plugin and `local: false`, nothing of plugins runs (`docs/architecture/plugins.md`) |
| `slots` | Optional. Places of the harness's own screen where plugin panels or chips go, next to the core's `plugins` and `chips` slots (below; `docs/architecture/plugins.md`) |
| `context` | Optional. `pinnedTokens` (an integer from 0 to 50,000, 3,000 when `context` is given without it): the harness's suggestion for the pinned files budget, the tokens of pinned text a new task gets whole. The person's Settings › Models value wins; without either, 3,000 (`docs/architecture/context.md`, `settings.md`). Absent, nothing changes |
| `documents` | Optional. `kinds`: the kinds of documents the agent writes, each with its `##` sections and an optional `reviewTier`; `AGENTS.md` lists them and the reader checks them, only warning (`docs/architecture/documents.md`, `reviews.md`) |

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

- `phases`: 1 to 12. Each has an `id` (the action id pattern), a `label` (≤ 80), an optional `brief` file (filled with `{{language}}`, `{{phase}}`, `{{previousPhase}}`, `{{timeLeft}}`), `auto` (the agent may move on alone), `modes` (`"any"`, `"none"` or a list of the action's modes) `close: true` (the part that ends with the core closing turn) and `approve` (a glob of `.md` paths in the folder, such as `specs/*.md`: approving a matching document moves the waiting task to the next part; `docs/architecture/reviews.md`).
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

### Plugins and slots

`plugins` says whether the harness takes plugins; `slots` adds places for them on the harness's own screen. From a manifest:

```ts
plugins: { bundled: ["on-this-day"], on: [], local: true },
slots: [
  { id: "status-bar", label: "Status bar", kind: "chip" },
  { id: "board", label: "Board", kind: "panel" },
],
```

- `plugins.bundled`: plugin ids under `<harness>/plugins/<id>/dist/`. `plugins.on`: bundled ones that start on without a review (the demo leaves it empty, so `on-this-day` starts off). `plugins.local`: the person may add plugins from a folder (default `false`).
- `slots[]`: at most 10. `id` (`^[a-z][a-z0-9-]{0,39}$`, unique, never the core's `plugins` or `chips`), `label` (≤ 40, no hidden characters), `kind` (`panel` or `chip`).
- The core's two slots always exist: `plugins` is the Plugins section of the side panel, `chips` sits in the top bar after the usage meter. A plugin's panel or chip that names no slot, an undeclared one or one of the other kind goes to the core's slot of its kind.
- The harness draws its own slots with `<PluginSlot id="board" />` from `@humanharness/ui`, in the UI it passes as `renderSide`. A slot it declares but never mounts shows nothing, and `humanharness plugin check` can't tell.
- A manifest without `slots` parses to the same object as before (D0).

### Document kinds

Every harness's agent gets a "Writing for the reader" guide in `AGENTS.md`. A harness may also declare the kinds of documents its agent writes, each with a template of `##` sections (`docs/architecture/documents.md`). From the spec:

```ts
documents: {
  kinds: {
    adr: {
      when: "A decision with real alternatives.",
      sections: ["Status", "Context", "Decision", "Alternatives considered", "Consequences"],
      status: ["proposed", "accepted", "superseded"],
    },
    analysis: {
      when: "Exploring options before deciding.",
      sections: ["Context", "Options", "Comparison", "Recommendation", "Risks"],
    },
  },
}
```

- `kinds` keys are ids matching `/^[a-z][a-z0-9-]*$/` (`DOCUMENT_KIND_ID`). With `kinds: {}` `AGENTS.md` gets no "Document kinds" part and nothing is checked.
- `when`: one sentence, 1 to 300 characters.
- `sections`: 1 to 20 `##` headings in order, each 1 to 120 characters (trimmed).
- `status` (optional): 1 to 10 values a document's front-matter `status` may take, each 1 to 40 characters.
- `reviewTier` (optional): `light`, `standard` or `deep`, the tier of a core "Review <title>" task that a review round of this kind of document starts; `standard` when absent (`docs/architecture/reviews.md`).

The harness's screen is `ui/App.tsx`: the shell build (`packages/shell/electron.vite.config.ts`) bundles it from the harness folder.

## Checks

- Block and action names follow fixed patterns. `choices`, `save_note`, `annotate`, `recommend_mode` and `set_phase` are reserved: every harness gets the first two as core blocks, a harness with input blocks gets `annotate`, a harness with modes gets `recommend_mode` and a harness where some action has phases gets `set_phase` (`allBlocks`). `ask_in_document`, `reply_to_comment` and `read_review` are reserved too: they are the agent's review tools on the `ui` server (`docs/architecture/reviews.md`), so no block may take their names or tool names.
- Every id in `path` must be an action, once; reference ids are unique.
- A block's `example` must match its `schema`.
- An action may set `scope` only when the harness declares `scopes`, and a `scope: "none"` action can't be in `path`.
- A collection needs a key (or `single: true`); the key must be a field of the schema declared exactly as `z.string()` or `z.number()` (no enum, literal, optional, nullable or default). Its `context` fields must be fields of the schema, and a collection hidden from the agent (`agent: "none"`) can't have a `context`. `settings` is a reserved collection name.
- Settings: at least one field, of its own or of a mode; every field has a `default` that matches its `schema` (the schema itself takes no `.default()` or `.optional()`); each control has its zod type; `options` only on segmented, select and toggle, with keys that are values of the schema; section ids are unique and every `section` is declared; agent sentences use only `{{value}}` and `{{value:label}}` (the latter on segmented, select and toggle), and a `text` field whose sentence uses the value has a `.max(n)` on its schema. `modes` is a reserved setting name.
- Modes: ids follow the action id pattern and aren't `recommend` or `ask`; an action's `modes` name declared modes, once each; `defaultMode` is one of them, `recommend` or `ask`, and only on an action with modes; mode settings pass the settings checks (no `section`) and need the harness's `settings` (its tab draws them). `humanharness check` also reports a mode brief that is missing, unreadable or empty (`brief-missing`).
- Phases: ids unique within the action; `close` only on the last phase; an `approve` glob that is relative, ends in `.md`, isn't under `.harness/`, has no `..`, `[`, `]`, `{`, `}` or backslash and is at most 200 characters; a phase's list of `modes` only on an action with modes, each one of its modes. A time box's options are each offered once and its `default` is one of them or `null`. `humanharness check` also reports a phase brief that is missing or empty (`brief-missing`).
- Setup steps: 1 to 8, ids unique. A form takes a `single`, unscoped collection and fields the core form can draw, or settings of the harness, not both. An interview's action isn't in `path`, isn't `deep`, runs app-wide and backs one interview; its `writes` collection is `single`, unscoped and `agent: "write"`. `humanharness check` also warns about a component it can't find in `ui/` (`setup-component`), an interview's action without a recording once `mock/` has recordings (`setup-mock`) and an interview's collection without `context` (`setup-context`) (`docs/architecture/setup.md`).
- Profiles: `profiles` needs a `profile` collection with `single: true`, `scoped: false` and a `name` field that is a string (`z.string()`, with or without bounds). `fields` has 1 to 6 entries, each once, starts with `name`, and names only fields of that collection the core form can draw (`docs/architecture/profiles.md`).
- Material: `accepts` and `fragmentKinds` list each value once; `sheet.sections` ids are unique and aren't the core's (`notation`, `not-covered`); `items.collection` is declared in `data`, has a key (not `single`) and isn't hidden from the agent (`agent: "none"`), and `items.label` is one of its fields; the action ids `material-review`, `material-repair`, `material-label`, `material-sheet` and `material-link` are reserved. `humanharness check` also warns about a `light` review tier (`material-review-tier`) and an app-wide `items` collection in a harness with scopes (`material-items-scope`) (`docs/architecture/material.md`).
- Sidekick: `sidekick` can't be an action id or a collection name; every action in `sidekick.actions` must exist; place ids and preset names are unique; a preset's custom `place:<id>` moment must name a place declared in `sidekick.places` (a parse error). `humanharness check` warns about tips over 300 tokens (`sidekick-tips`) (`docs/architecture/sidekick.md`).
- Plugins: `plugins.bundled` holds at most 20 plugin ids (`^[a-z0-9][a-z0-9-]{0,63}$`), each once; every id in `plugins.on` is bundled, once; unknown keys are refused (`harnessPluginsSchema`). A bundled plugin's own `plugin.json` is checked when the app loads it, not by `defineHarness`: a broken one shows as an error in Settings › Plugins (`docs/architecture/plugins.md`). `slots`: at most 10, ids unique and not `plugins` or `chips` (`harnessSlotsSchema`); `humanharness plugin check --harness <dir>` reports a plugin's panel or chip naming a slot the harness doesn't have with that kind (`slot-unknown`).
- Document kinds: a kind's sections are each listed once (compared trimmed, without case). `humanharness check` also warns when the "Document kinds" part would add more than 400 tokens to `AGENTS.md` (`documents-tokens`).
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
- `packages/harness-sdk/src/plugin.ts`: the `plugins` schema (`harnessPluginsSchema`, `pluginsAccepted`), the `slots` schema (`harnessSlotsSchema`, `DEFAULT_SLOTS`, `slotFor`) and `plugin.json`'s.
- `packages/harness-sdk/src/documents.ts`: `DocumentKind`, `DOCUMENT_KIND_ID`, `checkTemplate` and the document helpers.
- `packages/harness-sdk/src/review.ts`: `REVIEW_TOOLS`, `validApproveGlob`, `matchGlob` and the review logic.
- `harnesses/demo/harness.config.ts`: a complete manifest.
