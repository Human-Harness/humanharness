# Minimal core and mods — design

Status: approved by Marco section by section, 2026-11-05, in a brainstorming session. The written spec waits for his review.

Human Harness grew features into the core one spec at a time: Sidekick, search, history views, jobs, reviews, translation, material. Each is off unless a harness declares it (the "D0" rule), so a harness pays nothing at runtime. But every one of them branches through `shell/src/main/index.ts` and `task-manager.ts`, every one is code the core must keep working, and none of them can be changed by the person who uses the app.

This spec does two things:

1. **Shrinks the core** to what the three pillars need, and moves everything else into **mods**.
2. **Makes the app changeable by its user through AI**, the way herdr does: the app's interface is a folder of files, the app writes the manual for the AI into that folder, and changes apply live, fail safe and can be undone.

Together with harnesses this gives three layers: the **core** runs tasks; a **harness** is a manifest plus mods plus a layout, built by an author for one kind of user; the **user** adjusts their harness with their own AI, without ever losing the author's updates.

## 1. Why

- **Size.** About 99k lines of `.ts`/`.tsx`/`.css` in `packages/*/src` on master (a9783691), grouped by file name, so approximate. herdr 2 is 44k lines in total after its rewrite into a headless core plus mods (comparison artifact, 2026-11-03: https://claude.ai/artifact/9rsD7WqQSYDPyPKQqyGci8).
- **Coupling.** `index.ts` (3.9k lines) and `task-manager.ts` (2.8k) branch on almost every feature in §3.2. The file-size spec (`2026-11-03-file-size-design.md`) splits those files; this spec removes the reasons they are large.
- **Five ways to bring code.** A harness brings its own code today through `backend`, `tools`, `plugins` (with `slots`), `secrets` with the `connect` step, and job recipes and pre-steps. Each has its own loader, rules and docs.
- **No user changes.** The person who uses a harness can't change anything beyond settings. herdr shows that when the interface is files and the AI has a manual, "a sidebar of my PRs" becomes one request.

## 2. Decisions (Marco, 2026-11-05)

- **D1. Only mods.** There is one extension mechanism: trusted code that runs in the app's processes. The sandboxed plugin runtime (broker, hidden backend windows, panel iframes, the Attention inbox; about 12.5k lines) is removed, not kept as a second tier. This reverses the 2026-11-03 comparison's "don't copy unsandboxed mods": the safety now comes from an escape hatch, `check`, and undo through history (§5.6).
- **D2. Mods come from three places:** the core (shipped with the app, off by default), the harness (its author), and the user (a local folder, after a strong warning that it runs with full access).
- **D3. A mod runs in process.** A mod has a `main` part that registers typed hooks and a `ui` part that registers React components. It does not get its own process (too much protocol) and it is not limited to events (Sidekick must hold a send, a time box must stop a turn).
- **D4. History splits.** The snapshot per turn and "undo the last turn" stay in the core. The History panel, the file timeline and restore-any-point go to a mod.
- **D5. The herdr layer.** The app's home folder is its interface as files. The app writes `AGENTS.md` and `hh.d.ts` into it on every start. Core and harness mods are read-only and cloned to edit. Changes reload live, and the app keeps the last good version and writes `<file>.error` when a change is invalid. The CLI has `check` and `shot`. There is an escape hatch, and the home folder has a git history of its own.
- **D6. Only the task view is native.** The task view (chat, decision blocks, input) is the core's own component. Home, side panels, the top bar and each feature's Settings tab are mods placed by a layout.
- **D7. Users change the app from inside and outside.** A core action, "Change this app", runs an agent that may edit only the user layer. Any outside agent pointed at the folder also works, since the folder carries its own manual.
- **D8. Codex and OpenCode stay core.** Choosing an engine is part of "the agent you already pay for". Claude, Codex and OpenCode keep living in `packages/engines`.
- **D9. Radix stage 4 pauses after 4b1.** PR #136 (History and timeline) merges. Then nothing else that leaves the core gets restyled until it lives in its mod (4b2 Files/Notes waits).
- **D10. Delete `chat-migration.ts`.** Nothing was ever released, so no chat is in the old format. Marco's own folder is migrated once by hand first if it needs it.

## 3. The boundary

### 3.1 What stays in the core

| Part | Why it is core |
|---|---|
| Engines (Claude, Codex, OpenCode) and the engine registry | D8 |
| Runtime: one session per task, turns, the stream of events | Pillar 2; everything rests on it |
| Actions with a brief | The unit of work; the minimal flow |
| Blocks and input blocks, the task view | Pillar 1, the decision UI (D6) |
| Notes and the compact first message, the context meter | Pillar 3 |
| Model tiers (light, standard, deep) and `policies` | Pillar 3 |
| Data collections | How a harness keeps state; mods use them too |
| Harness settings (`settings`) and Settings › General, Models, Engine, Mods | The knobs every harness needs |
| Setup: folder, engine, the `form` and `component` steps | First launch |
| Workspace history: the snapshot per turn and undo of the last turn | The safety net (D4) |
| Markdown in the chat (with Mermaid) | Agent output |
| `usage.jsonl` | Pillar 3 needs the numbers; the mods read them |
| The mod host, the home folder, the layout, "Change this app" | §5 |
| The CLI and `harness-sdk` | Authors |
| i18n with English only | The core ships in English; translation is a mod |

### 3.2 What becomes a mod

Line counts are approximate (by file name, without tests).

| Mod | What moves | ~Lines | Notes |
|---|---|---|---|
| `sidekick` | The prompt coach, its settings, Models row and Usage line | 6.1k | The pilot (§7) |
| `material` | Converting files into fragments, the `material` MCP server, the panel | 5.8k | Already its own package |
| `documents` | The reader, `documents.kinds`, document reviews, focus mode, the file timeline | ~5k | Takes over opening file links from the chat (`openFile`) |
| `history-view` | The History panel, restore to any point, the go-back flow | ~2k | Uses the core's `history` service (D4) |
| `search` | The ⌘K palette and its index | 3.4k | Uses the `overlay` block |
| `parallel` | Several open tasks, the board, the inbox, the caps, `jobs` and their scheduler | 3.1k | Needs the core change in §4.4 |
| `language` | Translation on demand | 1.5k | |
| `profiles` | Several people on one install | 1.1k | Needs the partition in §4.4 |
| `scopes` | Units of work (topics, projects), each with its own tasks, notes and chats | ~1k | Needs the partition in §4.4; the most expensive, so last |
| `hatches` | `linkedFolders` (and their history) and `enginePresets` | ~1k | Requires `scopes` |
| `usage` | The Usage tab | 1.1k | Reads `usage.jsonl` |
| `context-panel` | The context panel, pinned files, excluding notes | ~0.6k | The meter stays core |
| `phases` | Task phases and `path` | ~0.4k + branches | Pillar 2 note below |
| `modes` | Task modes | ~0.3k | |
| `time-box` | Time limits, "+5 min", the wrap-up | ~0.2k + branches | Requires `phases` for wrap-up at a phase |
| `move-folder` | Moving the work folder with its history | 0.7k | |
| `setup-interview` | The `interview` setup step | small | |

What is **absorbed into the mod API** rather than moved: `backend`, `tools` (with `pre`/`preTokens` and job recipes), `secrets` with the `connect` step and Settings › Connections, `plugins`, `slots`. A harness that needs its own code ships a mod (§4).

What is **deleted**: the sandboxed plugin runtime (`plugin-*.ts`, `plugins.ts`, `broker/`, `backend/`, `attention-stores.ts`, `ui/src/plugins`, `ui/src/plugin-ui`, `cli/plugin-template`, the e2e plugin fixtures, `docs/architecture/plugins.md`) once nothing uses it (§7 step 6), and `chat-migration.ts` (D10).

**Pillar 2 with phases, modes and path out.** The core's flow is "actions with a brief, one session per task". A guided flow comes from the `phases` and `modes` mods. A harness that wants pillar 2 fully declares them; the authoring guide (`/new-harness`) asks for them by default.

### 3.3 The gate for new core features

herdr asks three questions before anything enters its core (docs PR #113 adds them to the spec template). This spec makes them binding. A new feature goes into the core only if:

1. the task view or the runtime must act on it, and
2. no hook or service in §4 can do it, and
3. no pillar can be met without it.

Otherwise it is a mod. The ratchet in §8 makes growing the core a visible decision.

## 4. The mod API

### 4.1 A mod

A mod is a folder (core and harness mods are also workspace packages under `packages/mods/<id>`):

```
mods/<id>/
  mod.json          id, name, version, requires, apiVersion
  main.ts           optional: export default (ctx: MainCtx) => void
  ui.tsx            optional: export default (ctx: UiCtx) => void
  schema.ts         optional: the zod schema of its manifest config
  README.md         what it does, for people and agents
```

`defineMod({ id, manifest, main, ui })` from `@humanharness/mod-sdk` (today's `harness-sdk` grows it, or a new package; the plan decides) types it. `mod.json` is the only part read without running code.

- **Config.** The harness passes config in `mods: { <id>: {...} }`. `schema.ts` validates it in the CLI's `check` and at load, the way each manifest key is checked today. The manifest keys that become mods (`sidekick`, `material`, `phases`, `modes`, `profiles`, `parallel`, `jobs`, `scopes`, `linkedFolders`, `enginePresets`, `documents`, `tools`, `secrets`, `backend`, `plugins`, `slots`, `inbox`, `context`) move under `mods.<id>`.
- **Requires.** `requires: ["phases"]` loads the other mod first and refuses to start without it. `ctx.mods.get(id)` returns a service another mod exported with `ctx.provide(service)`.
- **Storage.** Each mod has `.harness/mods/<id>/` in the work folder (tracked by the history only if `mod.json` says `history: true`) and `ctx.storage` for app-private state in the home folder.
- **D0.** A mod that is off loads no code, creates no folder, adds nothing to `AGENTS.md`, the first message, the tools or the usage lines.

### 4.2 Hooks (main)

Every hook comes from a mod in §3.2. A hook no mod uses is not added.

| Hook | What it may do | Used by |
|---|---|---|
| `beforeSend(prompt, task)` | Pass, rewrite, or hold the send (6 s at most, then it sends) | sidekick |
| `turnStart`, `turnEnd`, `turnAbort` | React to a turn; stop the current turn | time-box, parallel, usage, sidekick |
| `taskOpen`, `taskClose` | A task's life | phases, modes, sidekick, context-panel |
| `instructions()` | Add a section to the managed part of `AGENTS.md` | documents, material, modes, phases, tools |
| `firstMessage(task)` | Add sections to a new session's first message, each with a token budget | material, phases, context-panel, scopes |
| `mcpServers()`, `agentTools()` | Give the agent tools | material, documents, harness tools |
| `engineOptions(task)` | Add folders the agent may use, engine presets, permissions | hatches |
| `partition()` | Provide the active partition (§4.4) | scopes, profiles |
| `ipc(name, handler)` | A channel between the mod's own `main` and `ui` | all |

Each registration returns a disposer. A hook runs inside a try/catch with a timeout. A mod whose hooks fail three times in a row is turned off, and the app shows a notice.

### 4.3 Services (`ctx`)

- `engine.run(tier, prompt, opts)`: a session of the mod's own on a tier, its usage tagged with the mod's id.
- `history`: log, diff, restore (read-only for every mod but `history-view`, which asks for `history: "restore"` in `mod.json`).
- `tasks`: list, read, open, start; `notes`; `data` (collections, with the same rules as today); `settings`; `secrets` (the OS keychain, values never logged); `notify`; `storage`; `mods`.

### 4.4 Two core changes that aren't hooks

- **One task path.** Today the shell picks `plain`, `single` or `board` when it loads a harness (`hostMode` in `board-host.ts`), and `index.ts` branches on it. The core keeps one path: several tasks, with a cap of 1 open task and 1 running turn. The `parallel` mod raises the caps and adds the board, the inbox and `jobs`. Half of the `host ? … : …` branches in `index.ts` go away.
- **The partition.** Scopes and profiles both change where files live. The core has one active partition: the whole app by default (today's `APP_SCOPE`). Core APIs that touch tasks, notes, chats and data already take a scope; they take a partition. The `scopes` and `profiles` mods provide the picker and the paths.

### 4.5 UI (`UiCtx`)

`ui(ctx)` registers React components by name: `ctx.block(name, Component)`. The layout places them (§5.2). Components build only with `packages/ui/src/guide`, as the core does (the Radix + Impeccable rule). Each block has an error boundary: a crash shows "This part of the app failed" with the mod's name and a "Turn off" button.

## 5. The user layer (herdr)

### 5.1 The home folder

`<userData>/<harness>/app/`, outside the work folder (so cloud sync and the work history don't touch it):

```
app/
  AGENTS.md            the manual: layers, files, layout, mod API, how to check; rewritten every start
  hh.d.ts              the mod API types of this version; rewritten every start
  core/                core mods and the default layout; read-only, rewritten every start
  harness/             the harness's mods and layouts; read-only, rewritten every start
  mods/<id>/           the user's mods and clones
  layouts/<name>.json  the user's layouts and clones
  settings.json        the person's look and choices
  *.error              why a file was refused
```

- **Read-only layers.** Editing a file under `core/` or `harness/` is undone on the next start: the edited copy moves to `mods/<id>-edited` (or `layouts/<name>-edited.json`), the original comes back, and a notice says so.
- **Cloning.** `mod clone <id> [as]` and `layout clone <name> [as]` copy into the user layer and record `clonedFrom: { id, version }`. Clones are never updated. A clone's own paths are rewritten to its new id.
- **History.** The home folder has a git history of its own (the workspace's `history.ts` machinery, its data next to the work folder's history). Every write by "Change this app" is a turn commit, so undo works there as in the work folder.

### 5.2 The layout

`layouts/<name>.json` is a tree. Node types: `row`, `column`, `stack` (one child shown, with an optional header block), and `block`. A block's `content` is `{ "mod": "<id>", "block": "<name>", "props": {...} }` or `{ "core": "task" }`. Nodes take `id`, `size` (`{ px }` or `{ weight }`), `min`, `max` and `hidden`. Look comes from the theme tokens (`DESIGN.md`), not from the layout: a layout arranges, it doesn't paint. This is narrower than herdr on purpose. Painting is a later decision.

- The core ships a default layout. A harness ships `layouts/main.json` and may ship more. The person picks one in Settings › Mods or with a command.
- Resizes and collapsed panels are saved in `layouts/.state/`, not in the layout file. An edit to the file wins over a saved click on the same field.
- A layout that names a mod which is off or missing shows an empty block with "Mod <id> is off" and a button to turn it on.

### 5.3 Live reload

- The host watches `app/mods`, `app/layouts` and `app/settings.json`.
- On a change, esbuild (in main) bundles `ui.tsx` and `main.ts`. The `ui` bundle is served at `hh-mod://<id>/ui.js` and the block remounts. The `main` part is imported again with a fresh URL, after the host runs every disposer of the old one.
- If a file is invalid (a JSON error, a bundle error, a schema error, a hook that throws on load), the host keeps the last good version and writes `<file>.error`. Fixing the file deletes the `.error`.
- Harness and core mods are prebuilt at `humanharness build`. Only the user layer bundles at runtime.

### 5.4 Checking and seeing

- `humanharness mod check <folder>`: loads the mod in a headless host, validates `mod.json` and the schema, runs `main` against a fake `ctx`, renders each block once. It doesn't replace looking at the app.
- `humanharness shot [file.png]`: the running app saves its window as a PNG (`webContents.capturePage`) and prints the path.
- `humanharness status`: which mods run, which failed and why, the shown layout.

### 5.5 "Change this app"

A core action, offered in Home and Settings › Mods:

- The agent runs at tier `standard`, with `cwd` = the home folder, edit access only to `mods/`, `layouts/` and `settings.json`, and the tools `check`, `shot` and `status`. Its brief is `AGENTS.md`.
- Each turn commits to the home folder's history, so "undo" reverts the last change to the app.
- A new mod that the agent writes is a local mod. The agent explains what it does and the person turns it on in a decision block. The block shows the warning of D2.

Outside the app, any agent works: the folder holds its manual and its types.

### 5.6 Failing safe

- **Escape hatch:** ⌘⌥⇧Esc (Ctrl+Alt+Shift+Esc elsewhere) can't be rebound. It sets the shown layout to the harness's `main`, turns off every user mod, and says how to turn them back on. `humanharness dev --safe` and launching the app with `--safe` do the same.
- **Last good version and `.error`** (§5.3).
- **Three strikes** (§4.2).
- **Undo** through the home history (§5.1).

## 6. Security

Mods are trusted code with the app's full access: files, network, processes, keys through `ctx.secrets`. The guards are about consent and recovery, not isolation:

- Core and harness mods are trusted as the app is.
- A local mod is turned on only after a warning the person must confirm. Settings › Mods marks it "Local" and lists what it registers (hooks, tools, blocks).
- "Change this app" writes only the user layer, and every write can be undone.
- The engines' legal rules don't change: no mod may read engine credentials, and `ctx` gives no way to.

## 7. Order

One plan and one PR per step. Marco reviews between plans.

| Step | What | Proves |
|---|---|---|
| 0a | `mod-sdk`, `defineMod`, the host in main, hooks and services of §4 that step 1 needs, Settings › Mods, the local-mod warning, three strikes. No feature moves | The API compiles against a test mod |
| 0b | The home folder, the layers, the layout and its renderer, live reload, `AGENTS.md`/`hh.d.ts`, `check`/`shot`/`status`, the escape hatch, the home history. Delete `chat-migration.ts` | A hand-written user mod reloads live and can be undone |
| 0c | "Change this app" | The AI changes a cloned mod; undo restores it |
| 1 | `sidekick` (pilot) | `beforeSend`, `engine.run`, blocks in the layout, a Settings tab |
| 2 | `history-view` | The history service and the split of D4 |
| 3 | `usage`, `context-panel`, `search` | Read-only mods; the `overlay` block |
| 4 | `documents` | `openFile`, `mcpServers`, `instructions` |
| 5 | `language`, `setup-interview`, `move-folder` | |
| 6 | Harness code on mods: `tools`, `secrets`/`connect`, `backend`; the demo's `on-this-day` plugin rewritten as a mod; **delete the plugin runtime** | One way to bring code |
| 7 | `material` | `firstMessage` budgets |
| 8 | `modes`, `phases` (with `path`), `time-box` | Turn and task hooks; `requires` |
| 9 | `parallel` (with `jobs` and the inbox) | The single task path (§4.4) |
| 10 | `scopes`, `profiles`, `hatches` | The partition (§4.4) |

Home and each feature's Settings tab become mods together with their feature. Home as a whole becomes a core mod in step 0b, since the layout needs it.

**Relation to other work:**

- **File-size spec (PR #114):** its splits of `sidekick.ts` and `plugins.ts` are dropped (they leave the core). Splitting `index.ts` and `task-manager.ts` still helps and goes first where it unblocks step 0a.
- **Radix stage 4:** D9.
- **Published-contract snapshots (coach queue):** `hh.d.ts` and `mod.json` become contracts with users' AI-written mods. The snapshot test covers them, before the first public release.
- **Plugins spec (2026-10-27) and `/new-plugin`:** superseded by this spec. `/new-plugin` becomes `/new-mod` in step 6.

## 8. Testing

- **Core alone:** an e2e with no mods. The app starts, runs a task, undoes the turn, and no `.harness/mods/` folder, no mod section in `AGENTS.md` and no mod block appear.
- **Moved, not changed:** each feature's unit and e2e tests move into its mod's package and pass without edits, except imports and how the mod is turned on. A moved feature behaves as before; new behaviour waits for its own spec.
- **The user layer:** an e2e where a user clones a mod, "Change this app" edits it (the fake agent), the block reloads, and undo restores it. Another breaks a mod on purpose and checks the `.error` file, the last good version and the escape hatch.
- **Core size ratchet:** a test counts the lines of the core packages and fails if they grow beyond the recorded number. It uses the same mechanism as the file-size ratchet. Each migration step lowers the number.
- **Docs:** each mod's `docs/architecture/<feature>.md` moves to `packages/mods/<id>/README.md`. `docs/architecture/mods.md` describes the API and the layers. The generated `AGENTS.md` is checked against `hh.d.ts`: each exported name must appear in it.

## 9. What this spec does not do

- No marketplace and no sharing of mods between people.
- No painting in layouts (backgrounds, borders): the theme decides the look.
- No new behaviour in any moved feature.
- No runtime outside Electron (herdr's improvement 4 stays "not now").
- No translation of `AGENTS.md`: the manual is English, like every prompt. The person talks to "Change this app" in their language.
