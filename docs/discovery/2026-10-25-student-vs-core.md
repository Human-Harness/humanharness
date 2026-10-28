# Student harness vs the core: what is already covered

Date: 2026-10-25. Marco asked for every student-harness feature to be checked against the Human Harness core, so that no harness reinvents the wheel.

Sources:
- the student section of `2026-10-20-harness-discovery.md` (mockup v1, rounds 1–3);
- `docs/architecture/*`;
- the manifest schema (`packages/harness-sdk/src/index.ts`);
- `HarnessClient` (`packages/ui/src/client.ts`).

## What the core offers today

| Core feature | Where |
|---|---|
| Manifest actions: prompt, tier, cost, optional guided `path` | `manifest.md` |
| One engine session per task. The app drives the flow. A closing `save_note`. | `context.md` |
| Notes in `.harness/notes/` and a notes index (about 1,500 tokens) at session start | `context.md` |
| Free questions as tasks (`q-<title>`) | `context.md` |
| Blocks: the harness's visible (`show_*`) and state-only (`update_*`, side panel) blocks; core `choices` and `save_note` | `blocks.md` |
| The harness's own screen (`ui/App.tsx`), its own MCP servers (`mcp`), i18n es/en | `manifest.md` |
| Static instructions (`AGENTS.md` plus a managed section) | `manifest.md` |
| Permissions and read-only reference folders | `manifest.md` |
| Tiers per process, Settings › Modelos, 80% checkpoint, context meter | `context.md`, spec 3c |
| Usage tab, cost hints, warning before heavy actions | spec 3b |
| One visible folder, hidden history per task, undo, backup and move | `history.md` |
| Engines, setup flow (folder, engine), mock mode, authoring CLI and guide | `engines.md`, `authoring.md` |

## Student feature by feature

Legend:
- **Core ✓**: works with today's core.
- **Core +**: needs a new or extended core feature (a core candidate).
- **Harness**: the harness's own logic or UI, built on the core.

| # | Student feature | Status | What covers it, or what is missing |
|---|---|---|---|
| 1 | Engines, setup, usage, tiers, history, backup, i18n | Core ✓ | As is |
| 2 | Several profiles per install, each with its own data, style and settings | **Core +** | The core has one folder and one config per app. Missing: **profiles** (candidate). Suggested shape: each profile is a sub-folder with its own `.harness/`, plus a profile switcher in the core. |
| 3 | "Conocerte" interview → a profile the AI reads in every session | **Core +** | Setup has fixed steps, and `AGENTS.md` comes only from the manifest. Missing: (a) **setup steps declared by the harness** (candidate, also dev); (b) a **person-context file** the core adds to every session's first message next to the notes index (new candidate). |
| 4 | Topics: several open, each with its own tasks, notes, material and data | **Core +** | Tasks and notes are app-wide, and free questions are not tied to a topic. Missing: **scopes**, a core unit of work (topic, project) that groups tasks, notes, a per-scope notes index, material and data. Dev's "Project" is the same need. |
| 5 | Material upload + strict/mixed grounding | **Core +** | Spec drafted: `docs/superpowers/specs/2026-10-25-material-processing-design.md`. Depends on scopes (#4). |
| 6 | Concept map with 5 states and evidence | **Core +** / Harness | Missing: a **harness data store**: typed collections in `.harness/data/<scope>/`, a schema in the manifest, MCP tools to read and update them, history-tracked. Today a state-only block only feeds the side panel and keeps nothing. The map's rules (prerequisites, states) stay in the harness. |
| 7 | A state rises only with evidence | Harness | Rules in the harness, on the data store (#6). The agent records evidence through a store tool, and the harness checks it. |
| 8 | Methods: 7 strategies, recommended, switchable mid-session, each with settings | **Core +** | Actions open a task, but nothing changes the strategy inside one. Missing: **task modes**: modes declared in the manifest with a brief and a settings schema; switching sends the brief as a quiet turn in the same session. The tier stays fixed per task (3c rule), so a mode cannot change the model. Dev "modes" are the same. |
| 9 | Session frame: warm-up / main / close, goal, live evidence panel | **Core +** / Harness | The `path` orders actions; there are no phases inside a task. Missing: **phases inside a task** (dev's "phase stepper" candidate). The evidence panel is a state-only block plus the data store. |
| 10 | Time box (15/30/45 min) with an automatic wrap-up | **Core +** | Missing: a **task time box**, with a timer and a quiet wrap-up turn at the end, like the 80% checkpoint. Small. |
| 11 | Close: the learner writes the summary and flashcards, the AI corrects them | **Core +** / Harness | The harness can draw blocks, and its components can call `client.send`, but only with text. Missing: **input blocks**, a core contract for a block that sends structured input back (the pick of `choices`, generalized). Dev's wizard needs it too. |
| 12 | Open questions are kept | Core ✓ / Harness | Fits notes, or a data-store collection |
| 13 | End of session: what changed in the map | Harness | A diff of the data store over the task. The history already groups commits by task, so the store being history-tracked gives it for free. |
| 14 | Home: "Para hoy", topic cards with a mastery bar | Harness | `ui/App.tsx` over the data store. Deterministic, no model. |
| 15 | Flashcards with spaced repetition, mixed across topics | Harness (on #6) | The scheduler is plain logic over the store. Keep it in the harness until a second harness (teacher?) needs it, then promote it. AI checking of an answer = a `light` action. |
| 16 | Profile settings: tone, explanation length, thresholds, per-method settings | **Core +** | Settings has only core tabs. Missing: **harness settings**: a schema in the manifest, rendered as a Settings tab, and its values added to the managed section of `AGENTS.md` (the instructions change only when a setting changes, so the prompt cache holds). |
| 17 | Free questions inside a topic | **Core +** | Needs scopes (#4). |
| 18 | Over-12 and under-12 tone, "study with an adult" | Harness | Copy, plus the profile (#3) |
| 19 | Not doing homework / no documents | Harness | `instructions` and `permissions.edit` |

## What to add to the core, in suggested order

Most features depend on the first two, so they go first:

1. **Scopes.** Needed by #4, #5 and #17, and by dev projects.
2. **Harness data store.** Needed by #6, #7, #13, #14 and #15, and by dev (tickets cache).
3. **Material processing.** Spec drafted. Needs 1 (and 2 for linking).
4. **Harness settings + person-context file.** Needed by #3 and #16.
5. **Task modes.** Needed by #8; dev also uses them.
6. **Input blocks.** Needed by #11; dev's wizard also uses them.
7. **Phases inside a task + time box.** Needed by #9 and #10; dev's stepper.
8. **Profiles.** Needed by #2. Possibly student-only so far; confirm with teacher.
9. **Setup steps declared by the harness.** Needed by #3; dev's accounts.

Spec drafts:
- 1 and 2: `docs/superpowers/specs/2026-10-25-scopes-and-data-design.md`. It also covers the person-context part of 4, as an app-wide collection that is always loaded.
- 3: `docs/superpowers/specs/2026-10-25-material-processing-design.md`.
- 4: `2026-10-25-harness-settings-design.md`.
- 5: `2026-10-25-task-modes-design.md`.
- 6: `2026-10-25-input-blocks-design.md`.
- 7: `2026-10-25-task-phases-design.md`.
- 8: `2026-10-25-profiles-design.md`.
- 9: `2026-10-25-harness-setup-steps-design.md`.

All of these are in `docs/superpowers/specs/`. Every gap in the table above now has a spec draft.

## What stays in the harness

The rules of the concept map and its evidence, the spaced-repetition scheduler, the methods' briefs and settings, the home "Para hoy", the copy and the tone, and the screens.

Each of these is built on the core pieces above. None of them reimplements storage, sessions, context loading or material handling.
