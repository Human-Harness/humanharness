# Harness hatches: linked folders, harness backend, engine config per scope — design

Status: approved by Marco on 2026-10-27, with five fixes from his review (§3.2 nested linked folders and unlinked history, §3.3 deny rules in linked folders, §4.3 harness update, §5.3 referenced scripts in the hash). Not in the roadmap yet.

This is spec F from the dev-vs-core gap analysis (`docs/discovery/2026-10-26-dev-vs-core.md`, hatches H1–H3). A hatch is a small, generic extension point: the core adds an option any harness may declare, and does nothing harness-specific with it. The dev harness builds its git, terminal and preset features on top. It builds on scopes (`docs/architecture/data.md`), the history (`docs/architecture/history.md`) and the engines (`docs/architecture/engines.md`). It refers to parallel tasks (`2026-10-27-parallel-tasks-and-jobs-design.md`) for attribution.

## 1. Why

The dev harness works on code repositories, with the person's own git, a terminal, and a per-project engine setup. Three core limits stop it:

| Hatch | Today | What it blocks |
|---|---|---|
| **H1** | The agent can write only in the person's folder (`permissions.edit: "folder"`), and `folder.references` are read-only and fixed in the manifest | Repos that live elsewhere and are chosen per project |
| **H2** | The harness UI (`ui/App.tsx`) has no process of its own. Harness MCP servers run, but only for the agent | A terminal (PTY), running `git` or `gh` for the person's own actions |
| **H3** | `instructions`, `mcp` and `permissions` are per harness. Claude always runs with `--setting-sources project` and `--strict-mcp-config` | Per-project MCP servers, hooks, instructions, and the person's own global setup |

The gap analysis rule (Marco, 2026-10-26) is that only what other harnesses can use goes into the core. These three stay generic:
- a writer can link a manuscript folder;
- a teacher's backend can convert files;
- any harness can need an extra MCP server per topic.

## 2. Decisions (approved by Marco)

- **D1. Linked folders follow their git.**
  - A linked folder that is a git repository is not tracked by the core's history: its own git is the history.
  - One without git is tracked like the main folder.
  - A harness may require git (`history: "own"`).
- **D2. Global engine config is opt-in per scope.**
  - Sessions stay isolated by default, as today.
  - A scope may choose "also use my global config". The core then lets the CLI load its own config. The app never reads `~/.claude` or `~/.codex` itself.
- **D3. The person approves every change to a scope's engine config.** The approval is tied to the content's hash. While a change is unapproved, new sessions start without the scope's config.
- **D4. Hatches stay small.**
  - The core validates, passes paths and flags, and shows what the person must approve.
  - It never runs git, a terminal or a harness's business logic.

## 3. H1: linked folders

### 3.1 Manifest

```ts
linkedFolders: {
  repos: {
    label: { es: "Repos", en: "Repos" },
    mode: "write",              // "read" | "write"
    history: "auto",            // "auto": by git (D1) · "own": must be a git repository
    many: true,                 // several folders under this key, or one
  },
},
```

- **Checks.**
  - It needs `scopes`: linked folders belong to a scope.
  - `mode: "write"` needs `permissions.edit: "folder"`.
  - Keys follow the action-id pattern.

### 3.2 Linking

- **Who links.** The person, from the scope's settings ("Carpetas vinculadas"), or the harness UI through `client.scopes.linkFolder(scope, key)`.
- **The picker always opens.** A harness cannot pass a path, so nothing is linked without the person choosing it.
- **Refused**, with links resolved and a reason shown:
  - `~/.claude`, `~/.codex` and anything inside them;
  - the home folder itself;
  - the main folder, a folder inside it, or a folder that contains it;
  - another scope's linked folder in `write` mode;
  - a folder inside, or containing, another linked folder of the same scope, since their histories would overlap;
  - system folders (`/`, `/System`, `/usr`, `/Applications`, `C:\Windows`…).
  - With `history: "own"`, a folder that is not a git repository.
- **Stored** in `.harness/scopes.json`, on the scope: `linked: [{ key, path, mode, tracked: boolean }]`. Unlinking removes the entry and never touches the folder. A tracked folder's core history (§3.4) is kept for 30 days in the app's data folder, so linking the same path again picks it up; after that it is deleted.
- **Moving the main folder** keeps linked paths as they are, since they are absolute and outside it.

### 3.3 To the agent

- **Claude.** `--add-dir <path>` for each linked folder of the task's scope. In `read` mode it also gets the same deny rules for edits as reference folders get today. In `write` mode, edits to `<path>/.claude/**` and `<path>/.git/**` are denied, as `.claude/**` is in the main folder: a repo's settings and git hooks would otherwise run unapproved commands. `git` commands still work.
- **Codex.** The session's permission answers allow writes under `write` folders, and `additionalDirectories` at `session/new` when the adapter supports it. Spike S1 (§6) confirms what `codex-acp` offers. Until then, the plan does not ship H1 on Codex: a scope with linked folders on Codex shows "Las carpetas vinculadas todavía no funcionan con Codex".
- **The managed section** of `AGENTS.md` lists the linked folders of the open scope by key and path, under "Folders of this scope". It is written between tasks, as today.

### 3.4 History

- **`tracked: true`** (no git, D1) gets a `History` of its own: the same `History` class over that folder, with its gitdir in the app's data folder.
  - Turns commit both histories with the same trailers.
  - "Undo this task" and the crash undo restore both.
  - With parallel tasks, attribution (parallel spec §5.2) runs per tracked folder.
- **`tracked: false`** (a git repository) is never committed or restored by the core.
  - The History panel and the file timeline say "Deshacer no cubre esta carpeta: tiene su propio git".
  - The "Start" commit does not scan it.
- **A folder that gains or loses git later** is checked when the scope opens. A change of `tracked` asks the person first; the old core history stays.

## 4. H2: the harness backend

### 4.1 Manifest and launch

```ts
backend: "backend/index.ts",     // resolved in the harness folder (resolveInHarness)
```

- **Launch.** Main launches it once per app start, after setup, with the same launcher as the harness's MCP servers. It runs as a child process with the app's environment, its cwd set to the harness folder.
- **Trust.** It is the harness's own code, at the same trust level as its MCP servers, which already run arbitrary code.

### 4.2 Protocol

- **Transport.** JSON-RPC 2.0 over stdio. Stdout carries protocol messages only; stderr goes to the log.
- **Start.** On launch, the backend receives an `init` notification:

  ```ts
  { folder: string, scopes: { id: string, title: string, linked: { key: string, path: string, mode: "read" | "write" }[] }[],
    language: string, coreVersion: string, dataDir: string, mock: boolean }
  ```

  `dataDir` is a folder of its own in the app's data folder, for caches. Changes to scopes or linked folders arrive as `scopesChanged` with the same shape.
- **UI to backend.** `client.backend.call(method, params): Promise<unknown>`, with a 30 s timeout.
- **Backend to UI.** Notifications, delivered as `client.backend.on(event, cb)`. Up to 200 per second; extra ones are dropped and logged, so a noisy terminal cannot freeze the window.
- **What it cannot do.**
  - It cannot open engine sessions or write the core's history, notes or data.
  - Those go through the harness UI and `client`, so they follow the cap, the queue, the attribution and the checks.
  - Writes the backend makes in the folder are picked up like any outside change ("Fuera de la app").

### 4.3 Lifecycle

- **Crash.** It is restarted after a crash, up to 3 times in 5 minutes. After that, the UI gets `client.backend.state === "failed"` and a card with "Reiniciar".
- **Quit.** SIGTERM, then SIGKILL after 3 s.
- **Moving the folder.** The backend is stopped with the runtime (history.md, moving the folder, step 2) and launched again with the new path once the move ends.
- **Engine switch.** It keeps running.
- **Harness update.** It is stopped before the update is applied and launched again after it.
- **Logs.** `backend.log` in the app's data folder, rotated at 5 MB.
- **Mock mode.** The backend runs as usual. A harness that wants to fake it checks `init.mock`.

### 4.4 Native modules

A backend may depend on native modules (the dev's terminal needs `node-pty`). `humanharness build` rebuilds them for the core's Electron version and fails with a clear message when it cannot. Spike S3 (§6) confirms this works with the shell's packaging before the plan commits to it.

### 4.5 Compliance

If the backend runs `claude` or `codex` interactively in a terminal, that is the official tool, unmodified, used by the person. The engines' rules hold: the app reads no engine config and touches no authentication variable. The core does not count that use (it is outside its sessions), and its file changes enter the history as "Fuera de la app".

## 5. H3: engine config per scope

### 5.1 Files

```
.harness/engine/<scope>/
  base                       "isolated" (default) or "global"
  instructions.md            scope instructions
  mcp.json                   { mcpServers: { … } }, the Claude/ACP shape
  settings.json              Claude settings: hooks, permissions (allow only, §5.4)
  skills/, agents/           Claude, when spike S2 confirms how `-p` loads them
  codex.toml                 Codex overrides, when spike S1 confirms them
  actions/<action id>/       the same files, added on top for that action's tasks
```

- **History.** The folder is tracked by the history, like notes, data and reviews, so undo covers it.
- **Who writes it.** The harness UI or backend, an agent (it is in the folder), or the person by hand. All of these are equal before the approval (§5.3).

### 5.2 To the engine

- **`instructions.md`** goes into the task's first message under "Scope instructions", after the brief. It stays out of `AGENTS.md`, whose cached prefix stays the same across scopes. The context panel (`2026-10-27-context-panel-design.md`) lists it as an item.
- **`mcp.json`.** Its servers join the core's `--mcp-config` (Claude) and the `mcpServers` of `session/new` (Codex). Names may not clash with `ui`, `data` or the harness's own servers.
- **`settings.json`.** Passed with `--settings <path>` (Claude).
- **`skills/` and `agents/`.** Loaded the way spike S2 confirms (for example, as the cwd's project `.claude/` through `--setting-sources project`, or `--agents`). They are not shipped before the spike.
- **Base `global`:**
  - Claude: `--setting-sources user,project`, with `--strict-mcp-config` dropped;
  - Codex: no isolated `CODEX_HOME` override, if the app sets one, per spike S1.

  The CLI reads its own config. The app never opens `~/.claude` or `~/.codex`.
- **Action layer.** `actions/<id>/` adds to the scope's files: its instructions follow the scope's, and its servers and settings are merged on top (an action's key wins over the scope's).

### 5.3 Approval (D3)

- **What is shown.** The scope's settings › "Config del motor" shows everything the config contains:
  - the base, in plain words: "También usa tu configuración global de Claude";
  - each hook with its event and command;
  - each MCP server with its command or URL and its arguments;
  - the instructions as rendered text;
  - the skills and agents by name;
  - and the same for each action layer.
- **Approving** stores `{ hash, at }` in `.harness/scopes.json`. The hash is over every file of the scope's engine folder, action layers included.
- **Referenced scripts.** When a hook command, or an MCP server's command or argument, names a file inside the person's folder or a linked folder (`node ./tools/x.js`), that file joins the hash and the screen lists it. Otherwise an agent could change the script after approval and run code nobody approved.
- **When the content changes:**
  - new sessions of the scope start **without** the scope's engine config, with only the core's and the harness's;
  - the task shows "Config del motor sin aprobar · Revisar";
  - running sessions keep the config they started with.
- **What the screen highlights.** Hooks and servers that run local commands come first, marked "Corre comandos en tu computadora".

### 5.4 Limits

- **The manifest's permissions always win.**
  - A preset's `settings.json` may add `allow` rules, but its `deny` rules are kept as they are, and the harness's denies are always added after.
  - `permissions.edit: "none"` cannot be lifted by a preset.
  - `defaultMode`/`permission-mode` keys in a preset are ignored, since the core sets the mode.
- **Never through H3:** authentication settings, environment variables carrying credentials, or `apiKeyHelper`. They are refused when the hash is computed, with the key named.

## 6. Spikes first

| Spike | Question | Blocks |
|---|---|---|
| S1 | Does `codex-acp` take extra writable directories at `session/new`, and config overrides per session (a profile, `-c`, `CODEX_HOME`)? | H1 on Codex, `codex.toml`, the base `global` on Codex |
| S2 | How does `claude -p` load skills and agents from a folder that is not the cwd's `.claude/` (`--agents`, `--plugin-dir`, settings)? | `skills/`, `agents/` |
| S3 | Can a harness backend with `node-pty` be rebuilt and packaged for the shell's Electron on macOS (arm64, x64) and Windows? | Native modules in H2 |

Each spike writes its findings into this spec before its slice is planned.

## 7. Tests

- **H1:**
  - every picker refusal, through links too;
  - `auto` with and without git; `own` without git;
  - `--add-dir` and the deny rules in `read`; `.claude/**` and `.git/**` denied in `write`;
  - nested linked folders refused;
  - two histories committed together; undo over both;
  - the "no cubre" line; a folder that gains git.
- **H2:**
  - `init`, `call` with a timeout, events with the rate limit;
  - restart and its limit; stop on quit; restart after a folder move;
  - refusal of history writes (no API exists for them).
- **H3:**
  - instructions in the first message;
  - servers merged without name clashes;
  - a changed hash drops the config from new sessions, including a change to a referenced script;
  - `global` flags;
  - manifest denies over a preset allow; refused keys;
  - action layers.
- **E2E (mock mode):**
  - link a git folder and a plain one;
  - a sample backend in the demo harness (an echo that streams events);
  - approve a preset and see its instructions in the next task.

## 8. What this closes from the gap analysis

| Gap | How |
|---|---|
| H1 Writable folders outside the person's folder, per scope | §3 |
| H2 Harness-side processes for the UI | §4 |
| H3 Per-scope engine config | §5 |
| Dev: several repos per project | `linkedFolders.repos` with `many: true` |
| Dev: terminal, `git`, `gh` | The dev's backend over H2 (+ S3 for `node-pty`) |
| Dev: the project preset, isolated or on top of the global config, and per-agent additions | `.harness/engine/<scope>/`, `base`, `actions/<id>/` |

Dev-only and left out: worktrees per ticket, branches, PRs, CI, the `devharness` MCP for external agents, importing a process. All of them are dev code on top of these hatches.

## 9. Delivery slices

1. **Spikes S1–S3.**
2. **H1.** Manifest, linking and refusals, Claude flags, the managed-section list, history by git.
3. **H2.** Launch, protocol, lifecycle, `client.backend`, the demo's sample backend.
4. **H3.** Files, instructions and servers, the approval screen and hash, the limits, `base: "global"` for Claude.
5. **Codex parts**, per S1. **Skills and agents**, per S2. **Native modules**, per S3.

## 10. Open questions

1. **Linked folders on a synced drive.** A linked folder inside iCloud or Dropbox works like any other, but its tracked history (when it has no git) lives in the app's data folder, not with it. Proposal: same rule as the main folder, no extra warning in v1.
2. **The backend on several windows.** The app has one window per data folder today, so one backend is enough. Revisit if that changes.
3. **Approving presets in bulk.** A process import (dev) may write configs for many scopes at once. Proposal: one approval screen per scope, with no bulk approval, because each one runs commands.
