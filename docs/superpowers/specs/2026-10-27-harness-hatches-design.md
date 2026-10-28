# Harness hatches: linked folders, harness backend, engine config per scope — design

Status: approved by Marco on 2026-10-27, with five fixes from his review (§3.2 nested linked folders and unlinked history, §3.3 deny rules in linked folders, §4.3 harness update, §5.3 referenced scripts in the hash). Spikes S1–S3 done 2026-10-28; findings folded in. Not in the roadmap yet.

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
  - On Codex, isolation is not possible (§5.2, known limit).
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

- **Claude.**
  - Each linked folder of the task's scope gets file access. How depends on §3.5: through `--settings` `permissions.additionalDirectories` if the live check confirms it, otherwise `--add-dir <path>` with the fallback that section names.
  - In `read` mode it also gets the same deny rules for edits as reference folders get today.
  - In `write` mode, edits to `<path>/.claude/**` and `<path>/.git/**` are denied, as `.claude/**` is in the main folder: a repo's settings and git hooks would otherwise run unapproved commands. `git` commands still work.
- **Codex** (S1, §6).
  - The core checks that `initialize` advertises `sessionCapabilities.additionalDirectories`.
  - It sends `additionalDirectories: [<absolute paths>]` on `session/new` **and** on `session/load`, every time. On `session/load` the list replaces the old one, so leaving it out drops the folders.
  - Only `write` folders go in that list. The sandbox makes every listed folder writable in `workspace-write` mode, so `read` folders stay out of it and are reachable through the permission policy's read roots, as reference folders are today. A live check confirms this (§6, S1).
  - The session's permission answers allow writes under `write` folders, with a write-roots list next to the read roots, so `decidePermission` answers as the flags do.
  - In `write` folders, edits to `<path>/.codex/**` and `<path>/.agents/**` are denied, besides `.git/**`. The adapter marks every listed folder as a trusted project, so its `.codex/config.toml` (hooks, MCP) may load, and its `.agents/skills` loads as skills. The H3 approval cannot see these files.
  - An adapter that does not advertise the capability gets no linked folders, and the scope shows "Las carpetas vinculadas todavía no funcionan con esta versión de Codex".
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

### 3.5 Risk: `--add-dir` loads the folder's project files

Found in spike S2 (§6). It applies to today's `folder.references` as well as to linked folders.

- **What happens.** With `--setting-sources project`, every `--add-dir` folder also loads its `.claude/skills`, `.claude/commands` and `.claude/agents`. A repo's `.claude/agents/*.md` can carry `hooks` and `mcpServers`. That is code the person never approved, the same risk the deny rules on `.claude/**` close for settings.
- **Proposed fix.** Pass the extra folders through `--settings` as `permissions.additionalDirectories` instead of `--add-dir`. The docs say this setting "grants file access only and loads none of these".
- **Live check first.** It must give the same edit access under `acceptEdits` as `--add-dir`, and the absolute-path deny rules must still apply there.
- **If the check fails**, the core either denies those folders' `.claude/skills`, `.claude/commands` and `.claude/agents`, or strips them from what Claude loads (for example, by showing them in an approval like H3's).
- **Order.** The core fix for references ships on its own, before hatches. H1 then uses the same path for linked folders.

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

A backend may depend on native modules (the dev's terminal needs `node-pty`). The backend runs on Electron's own Node (`ELECTRON_RUN_AS_NODE=1`, Node 24, ABI 149), not the system Node. Spike S3 (§6) found that N-API modules with prebuilds load there without a rebuild.

- **Check, not rebuild.** `humanharness build` checks each `.node` file in the backend's dependency tree. It must be N-API, or have prebuilds for darwin-arm64, darwin-x64 and win32-x64. Otherwise the build fails with a clear message naming the module.
- **Optional fallback.** `--rebuild` runs `@electron/rebuild` against the core's Electron version, for a module that is not N-API.
- **`node-pty`:**
  - it stays an external, unbundled dependency in a real `node_modules` next to the backend entry, outside any asar, so it finds its `prebuilds/<platform>-<arch>`;
  - on macOS, `spawn-helper` and `pty.node` are signed with the app; the backend launch checks that `spawn-helper` is executable and fails with "Reinstalá dependencias" if not;
  - on Windows, the whole `prebuilds/win32-x64` folder ships, and its conpty files (`conpty.dll`, `OpenConsole.exe`) go into the app's notices;
  - `node-pty` goes into pnpm `allowBuilds` (the repo's, and the harness template's), so its install scripts run.
- **Order.** Packaging waits for plan 4b, since the shell has no packaging step yet. H2 can ship first with the demo's echo backend, without native modules.
- **Open.** How Gatekeeper treats native files in a harness installed after the app is signed (§10).

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
  skills/<name>/SKILL.md     Claude skills, loaded with --plugin-dir (§5.2)
  agents/*.md                Claude agents, loaded with --agents (§5.2)
  codex.toml                 Codex overrides, an allowlist merged into CODEX_CONFIG (§5.2)
  actions/<action id>/       the same files, added on top for that action's tasks
```

- **History.** The folder is tracked by the history, like notes, data and reviews, so undo covers it.
- **Who writes it.** The harness UI or backend, an agent (it is in the folder), or the person by hand. All of these are equal before the approval (§5.3).

### 5.2 To the engine

- **`instructions.md`** goes into the task's first message under "Scope instructions", after the brief. It stays out of `AGENTS.md`, whose cached prefix stays the same across scopes. The context panel (`2026-10-27-context-panel-design.md`) lists it as an item.
- **`mcp.json`.** Its servers join the core's `--mcp-config` (Claude) and the `mcpServers` of `session/new` (Codex). Names may not clash with `ui`, `data` or the harness's own servers. On Codex, a server of the same name in the person's own config wins over the requested one, so the core prefixes its own server names or sets `DISABLE_MCP_CONFIG_FILTERING=true`.
- **`settings.json`.** Passed with `--settings <path>` (Claude). The app passes a cleaned copy, never the scope's file itself (§5.4). Lists such as `permissions.deny` merge across levels, so the harness's denies still hold.
- **`skills/` and `agents/`** (Claude, S2). Both are built from a snapshot of the approved files, in the app's data folder and keyed by the approved hash, never from the live folder. An agent that edits the live folder during a session cannot load an unapproved skill.
  - **Skills.** The snapshot is laid out as a plugin, `<snapshot>/skills/<name>/SKILL.md`, with no manifest. It is passed with `--plugin-dir <snapshot>`. Skills are then named `/scope-<id>:<name>`.
  - **Agents.** The `agents/*.md` files become one JSON object (frontmatter as fields, body as `prompt`), written to a file and passed with `--agents <file>`. The file form needs Claude Code 2.1.281 or later.
  - Neither goes through `--add-dir`, which would also grant file access and load the folder's commands (§3.5).
- **`codex.toml`** (Codex, S1). It is turned into JSON and merged into the `CODEX_CONFIG` the app already builds, with an allowlist of keys. Hooks go through `CODEX_CONFIG.hooks`, which the adapter handles.
  - `CODEX_CONFIG` is read once at process start, so it applies per process, not per session.
  - The Codex process restarts when the scope's approved hash changes, the same way it does today when the profile changes.
- **Base on Claude:**
  - `isolated`: as today, `--setting-sources project` and `--strict-mcp-config`;
  - `global`: `--setting-sources user,project`, with `--strict-mcp-config` dropped. That also brings in the person's own skills, agents and plugins, read by the CLI.
- **Base on Codex:**
  - `global` is today's behaviour. The app sets no `CODEX_HOME`, so the person's `~/.codex/config.toml` always applies.
  - `isolated` cannot hold on Codex. A private `CODEX_HOME` would also hide the login, and copying it would mean reading `~/.codex`, which the app never does.
  - **Known limit.** On Codex, `isolated` means only that the core adds nothing from the person; Codex itself still reads their config and the project's `.codex/`. The approval screen says so: "En Codex siempre se usa tu configuración de Codex".

  The CLI reads its own config. The app never opens `~/.claude` or `~/.codex`.
- **Action layer.** `actions/<id>/` adds to the scope's files: its instructions follow the scope's, and its servers and settings are merged on top (an action's key wins over the scope's).

### 5.3 Approval (D3)

- **What is shown.** The scope's settings › "Config del motor" shows everything the config contains:
  - the base, in plain words: "También usa tu configuración global de Claude";
  - on Codex, the known limit of §5.2;
  - each hook with its event and command;
  - each MCP server with its command or URL and its arguments;
  - the instructions as rendered text;
  - the skills and agents by name;
  - inside each agent definition, its `hooks`, `mcpServers` and `permissionMode`, shown like settings hooks; if the screen cannot show them, the app refuses those fields;
  - the `codex.toml` keys;
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
  - `defaultMode`/`permission-mode` keys in a preset are ignored, since the core sets the mode. The same holds for `permissionMode` in an agent definition.
  - An agent's `tools` stay bounded by the session's `--disallowedTools` (checked live, §6).
- **Never through H3:** authentication settings, environment variables carrying credentials, or `apiKeyHelper`. In `codex.toml`, keys outside the allowlist are refused, among them `model_provider`, `model_providers`, any `*_api_key`, `cli_auth_credentials_store` and `chatgpt_base_url`. They are refused when the hash is computed, with the key named.

## 6. Spikes

All three were desk research on 2026-10-28: no engine session was started and nothing was installed. Each answer lists what is still to check live, in the slice that uses it.

| Spike | Question | Answer (2026-10-28) | Blocks |
|---|---|---|---|
| S1 | Does `codex-acp` take extra writable directories at `session/new`, and config overrides per session (a profile, `-c`, `CODEX_HOME`)? | Extra folders: **yes**. Overrides: **per process only**, through `CODEX_CONFIG`. Isolation: **no**. | H1 on Codex, `codex.toml`, the base on Codex |
| S2 | How does `claude -p` load skills and agents from a folder that is not the cwd's `.claude/` (`--agents`, `--plugin-dir`, settings)? | Agents: **yes**, `--agents <file>`. Skills: **yes**, `--plugin-dir`. Found the `--add-dir` risk of §3.5. | `skills/`, `agents/`, §3.5 |
| S3 | Can a harness backend with `node-pty` be rebuilt and packaged for the shell's Electron on macOS (arm64, x64) and Windows? | Loading: **yes**, N-API with prebuilds, no rebuild. Packaging: **not testable yet**, waits for plan 4b. | Native modules in H2 |

### S1. `codex-acp` (2026-10-28)

Source: the installed `@agentclientprotocol/codex-acp@2.2.2` bundle (with Codex 0.160.1), its README, and the ACP schema in `@agentclientprotocol/sdk@1.8.0`.

- **Extra folders.** `initialize` advertises `sessionCapabilities.additionalDirectories`. `session/new`, `load`, `resume` and `fork` all read `additionalDirectories`; it is not marked unstable. Entries must be absolute. On `session/load` the list replaces the old one.
- **In the sandbox.** Listed folders join the writable roots in `workspace-write` mode; in `read-only` mode they are readable only. Each one is marked as a trusted project, and its `.agents/skills` loads as skills.
- **Overrides.** `CODEX_CONFIG` is read once at process start and merged into every session. Hooks go through it too. There is no per-session override in the request. Profiles live in `CODEX_HOME` and are not offered by `codex app-server`. The adapter builds its own `-c` arguments.
- **`CODEX_HOME`.** The app sets none today, so Codex already loads the person's `~/.codex/config.toml`. A private one would hide `auth.json`.
- **MCP names.** A server of the same name in the person's config wins over the requested one.
- **To check live:** whether a trusted linked folder's `.codex/config.toml` loads; whether `read-only` refuses writes in a listed folder and whether `workspace-write` writes there still ask for permission; `load` with a different list; the TOML to JSON conversion of `codex.toml`.

### S2. `claude -p` skills and agents (2026-10-28)

Source: `claude --help` (Claude Code 2.1.312) and the docs at code.claude.com (sub-agents, skills, plugins reference, settings).

- **Agents.** `--agents` takes a JSON object, or in `-p` the path to a file holding one (2.1.281 or later). It ranks above project and user agents. Its fields include `hooks`, `mcpServers` and `permissionMode`.
- **Skills.** `--plugin-dir` loads a folder as a plugin for the session. A manifest is optional; skills sit at `skills/<name>/SKILL.md` and are named `/<plugin>:<name>`. Plugin agents ignore `hooks`, `mcpServers` and `permissionMode`.
- **Both flags are honoured in `--bare` mode**, so they do not depend on the setting sources.
- **`--add-dir`** loads that folder's `.claude/skills`, `.claude/commands` and `.claude/agents` under the `project` source, and watches its skills live. **`permissions.additionalDirectories`** in settings "grants file access only and loads none of these". This is the §3.5 risk.
- **`--settings`** sits above user, project and local settings; `allow` and `deny` lists merge.
- **To check live:** `--plugin-dir` skills with `--setting-sources project` and `--strict-mcp-config`; `--plugin-dir` again on `--resume`; whether `--add-dir` agents' hooks and servers run in `-p`; `permissions.additionalDirectories` under `acceptEdits` with the deny rules; skill frontmatter hooks; agent `tools` against `--disallowedTools`.

### S3. `node-pty` in a backend (2026-10-28)

Source: the shell's `package.json` and launcher code, the npm registry and the `node-pty@1.1.0` tarball listing.

- **The runtime.** The backend uses the MCP servers' launcher, `ELECTRON_RUN_AS_NODE=1` on Electron 44.7: Node 24.21, ABI 149. A non-N-API module built for system Node (22, ABI 127) would fail there.
- **`node-pty` 1.1.0** (MIT) is N-API (`node-addon-api`). It ships prebuilds for darwin-arm64, darwin-x64, win32-x64 and win32-arm64, with `spawn-helper` on macOS and the conpty and winpty files on Windows. Linux has none. It finds them relative to its `lib/`, so a bundler breaks it.
- **pnpm** blocks install scripts not in `allowBuilds` (today: `electron`, `esbuild`). The prebuild still loads, but the `spawn-helper` execute bit is uncertain.
- **Packaging.** The shell has no electron-builder, Forge, asar or signing setup, and `humanharness build` does not exist yet. Packaging is plan 4b.
- **To check live:** the darwin prebuild spawning a shell on Electron 44; the `spawn-helper` bit after pnpm and after packaging; signing and notarization; Gatekeeper on a harness installed later (§10); ConPTY on Windows 10 and 11, and Defender on `OpenConsole.exe`. Pin `1.1.0` until 1.2.0's layout is checked.

## 7. Tests

- **H1:**
  - every picker refusal, through links too;
  - `auto` with and without git; `own` without git;
  - folder access (§3.5) and the deny rules in `read`; `.claude/**` and `.git/**` denied in `write`;
  - a linked folder's `.claude/agents`, `skills` and `commands` not loaded (§3.5);
  - Codex: `additionalDirectories` on `session/new` and `session/load`, `write` folders only; `.codex/**` and `.agents/**` denied; an adapter without the capability;
  - nested linked folders refused;
  - two histories committed together; undo over both;
  - the "no cubre" line; a folder that gains git.
- **H2:**
  - `init`, `call` with a timeout, events with the rate limit;
  - restart and its limit; stop on quit; restart after a folder move;
  - refusal of history writes (no API exists for them);
  - the native-module check: an N-API module passes, a non-N-API one fails with its name.
- **H3:**
  - instructions in the first message;
  - servers merged without name clashes;
  - a changed hash drops the config from new sessions, including a change to a referenced script;
  - `global` flags on Claude; the Codex limit shown on the approval screen;
  - skills and agents loaded from the hash's snapshot; an edit to the live folder not loaded;
  - agent `hooks`, `mcpServers` and `permissionMode` shown or refused;
  - `codex.toml` merged into `CODEX_CONFIG`, keys outside the allowlist refused, a restart on a new hash;
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
| Dev: terminal, `git`, `gh` | The dev's backend over H2 (+ §4.4 for `node-pty`) |
| Dev: the project preset, isolated or on top of the global config, and per-agent additions | `.harness/engine/<scope>/`, `base`, `actions/<id>/` |

Dev-only and left out: worktrees per ticket, branches, PRs, CI, the `devharness` MCP for external agents, importing a process. All of them are dev code on top of these hatches.

## 9. Delivery slices

1. **Spikes S1–S3.** Done 2026-10-28 (§6).
2. **Before hatches, on its own:** the `--add-dir` fix for `folder.references` (§3.5).
3. **H1.** Manifest, linking and refusals, Claude folder access, the managed-section list, history by git. Codex linked folders (§3.3).
4. **H2.** Launch, protocol, lifecycle, `client.backend`, the demo's echo backend. No native modules yet.
5. **H3.** Files, instructions and servers, the approval screen and hash, the limits, the base on Claude, skills and agents from the snapshot, `codex.toml`, the Codex limit.
6. **Native modules** (§4.4), after plan 4b's packaging.

## 10. Open questions

1. **Linked folders on a synced drive.** A linked folder inside iCloud or Dropbox works like any other, but its tracked history (when it has no git) lives in the app's data folder, not with it. Proposal: same rule as the main folder, no extra warning in v1.
2. **The backend on several windows.** The app has one window per data folder today, so one backend is enough. Revisit if that changes.
3. **Approving presets in bulk.** A process import (dev) may write configs for many scopes at once. Proposal: one approval screen per scope, with no bulk approval, because each one runs commands.
4. **Gatekeeper and native files in a later harness.** A harness installed after the app is signed lives outside the signed bundle. How macOS treats its `.node` files and `spawn-helper` is not known yet. To settle with plan 4b.
