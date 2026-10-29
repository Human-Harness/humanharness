# Plugins — design

Status: approved by Marco on 2026-10-27, section by section. Not in the roadmap yet: it goes after the specs in flight (plans 5–9). Comes from Marco's wish to bring docs-cockpit features (on-call, daily, releases) to the dev harness without building them into it, and from the dev-vs-core analysis (`docs/discovery/2026-10-26-dev-vs-core.md` on `worktree-harness-discovery`). Implemented: plans 1 and 2 (runtime; surface and authoring), on `feat/plugins` (`docs/architecture/plugins.md`, `docs/architecture/authoring.md`).

## 1. Why

docs-cockpit (`workspace/docs-cockpit`) is a local web app the Docs pod uses as an IDE stand-in. Each of its features has the same shape:

- a **source** that fetches external data on a TTL, inside work hours (`src/sources/*.ts`: Jira, GitHub, the FireHydrant ICS feed, Superhuman Docs);
- **rules** over that data that raise "needs attention" items and notifications from the diff between refreshes (`src/derive.ts`: SLA clock, stale PRs);
- a **view** (`client/views/*.tsx`);
- **actions** that open a Claude session with a prompt ("Triage ▶" runs `/triage-bug KEY`);
- its own **config** (`config/cockpit.json → oncall`).

Those features are specific to one team: another developer using the same dev harness has no FireHydrant. So they must not be built into the dev harness, and certainly not into the core. Plugins let a harness author ship such features with a harness, and let a person add their own, written with their own AI.

The core today can't host them: a harness's UI (`ui/App.tsx`) has no backend, so it can't call an API, run `gh` or poll; and the core has no place for alerts.

## 2. Decisions

- **D1. Plugins are a generic core feature.** Any harness may accept them; the core does nothing dev-specific.
- **D2. Two origins:** plugins bundled with the harness (its author ships them), and **local plugins** the person adds from a folder on their computer. No marketplace (§11).
- **D3. A plugin contributes:** sources (sync), its own data collections, panels, chips, attention items, actions that open tasks, and settings. Not: its own MCP server, chat blocks.
- **D4. Plugin code runs in Chromium sandboxes, with no Node.** Everything it does outside goes through a core **broker** that enforces the declared permissions. Plugins are expected to be AI-written code nobody read, so the boundary must hold whatever the code does.
- **D5. Secrets never enter the plugin.** It names them in request templates; the broker substitutes them on the way out.
- **D6. Panels go into slots the harness declares**, with a default slot from the core.
- **D7. Alerts go to one core Attention inbox**, shared with the "waiting for you" of parallel tasks once those exist.
- **D8. A plugin never spends tokens on its own.** An action opens a **prepared task** the core draws; the person presses Start.
- **D9. Plugins are generated with a developer skill, `/new-plugin`,** plus a `humanharness plugin` CLI, following the `/new-harness` pattern. An in-app "Create a plugin" action is a possible later step.
- **D10. Plugin data is a rebuildable cache: no history, no undo.**

## 3. The plugin package

### 3.1 Source and build

The author (or `/new-plugin`) writes a folder:

```
oncall/
  plugin.config.ts     definePlugin({...}) with zod, like defineHarness
  backend.ts           definePluginBackend({...})
  panels/queue.tsx     one file per panel
  fixtures/<source>/   recorded responses (§9)
  PLUGIN.md            living decision log (§9.3)
```

`humanharness plugin build` writes `dist/`: `plugin.json` (plain data; zod schemas converted to JSON Schema), `backend.js`, and `panel-<id>.html` + `panel-<id>.js` per panel.

**The app loads only `dist/` and never executes `plugin.config.ts` in the main process.** Reading a manifest runs no plugin code.

### 3.2 `plugin.json`

```jsonc
{
  "id": "oncall",                       // ^[a-z0-9][a-z0-9-]{0,63}$
  "name": "On-call",
  "version": "1.0.0",
  "api": 1,                             // core plugin contract version
  "harness": "dev",                     // a harness id, or "*"
  "permissions": {
    "hosts": ["*.atlassian.net", "api.firehydrant.io"],
    "exec": [{ "cmd": "gh", "args": ["api", "--method", "GET", "*"] }],
    "secrets": [
      { "id": "jira", "label": "Jira API token", "help": "Atlassian → Security → API tokens" },
      { "id": "firehydrant", "label": "FireHydrant ICS token", "help": "…" }
    ],
    "tasks": true                       // may propose agent tasks
  },
  "sources": [{ "id": "queues", "ttl": 300, "workHoursOnly": true }],
  "data": { /* collections, same model as the harness's data (data.md) */ },
  "panels": [{ "id": "queue", "slot": "sidebar", "title": "On-call" }],
  "chips": [{ "id": "who", "slot": "status-bar" }],
  "settings": { /* same model as harness settings (settings.md), JSON Schema */ },
  "actions": [{
    "id": "triage", "label": "Triage", "tier": "light", "scope": "none",
    "vars": { /* JSON Schema of the variables */ },
    "prompt": "Triage {{key}}. Read the ticket, propose severity and owner. Write nothing to Jira without asking."
  }]
}
```

- Plugin collections are namespaced automatically (`oncall.queues`). With `agent: "read"`, the agent reads them through the existing `data` MCP server, and they may set `context` like any collection. This is how "the agent knows who's on call" works, without a plugin MCP server. A plugin collection is never `agent: "write"`.
- Settings use the harness settings model, including the sentences for the agent, which go into the managed section of `AGENTS.md` only while the plugin is on.

### 3.3 Where plugins live

- **Bundled:** `<harness>/plugins/<id>/dist/`, listed in the harness manifest.
- **Local:** Settings → Plugins → "Add from folder…" stores a pointer in `~/.humanharness/<harness-id>/plugins.json`. The code is never copied into the work folder, so it never lands in the history or in a synced folder.
- **State:** on/off, settings and the error log in `.harness/plugins/<id>/`; data in `.harness/plugin-data/<id>/` (D10). The attention items are in `.harness/attention.json`. None of these is tracked by the history.

### 3.4 Harness manifest: new fields

```ts
slots: [
  { id: "sidebar",     label: "Sidebar",    kind: "panel" },
  { id: "bottom",      label: "Bottom panel", kind: "panel" },
  { id: "status-bar",  label: "Status bar", kind: "chip" },
],
plugins: { bundled: ["oncall"], on: ["oncall"], local: true },   // on: bundled plugins that start on; local defaults to false
```

- A harness with no `slots` gets the core's default slots: `plugins` (a "Plugins" section in the core sidebar, one tab per panel) and `chips` (next to the usage meter).
- A plugin whose panel or chip names a slot the harness doesn't have falls back to the default slot of the same kind.
- `harness` in `plugin.json` must be the harness's id or `"*"`; otherwise the plugin can't be added.

## 4. Runtime

### 4.1 Backend

- One hidden `BrowserWindow` per active plugin: `sandbox: true`, `nodeIntegration: false`, `contextIsolation: true`.
- Served from a custom protocol `hh-plugin://<id>/` that exposes only that plugin's `dist/`.
- CSP `default-src 'none'; script-src 'self'`: no direct network, no frames, no workers.
- The preload exposes one thing, `rpc`, to the broker in the main process.
- The backend module default-exports `definePluginBackend({ sources: { queues: async (ctx) => {…} } })`.

### 4.2 The broker (`ctx`)

| Call | Rule |
|---|---|
| `ctx.fetch(url, init)` | Only to a declared host (exact, or `*.` wildcard on one label level or more). Headers and body may hold `{{secret:<id>}}`, replaced by the broker; the response never echoes the substituted values back (the broker redacts them from the response headers it returns). Redirects to an undeclared host are refused. Timeout 30 s, response capped at 10 MB. |
| `ctx.exec(cmd, args)` | Only a declared `cmd`, with `args` matching a declared pattern (literal tokens, `*` for one or more remaining tokens). No shell; the command is found through the login shell's `PATH` as engines are. Timeout 30 s, output capped at 10 MB. |
| `ctx.data` | `get`, `query`, `put`, `patch`, `delete`, `replaceAll` on its own collections only. |
| `ctx.settings.get()` | Read only. |
| `ctx.attention.raise(item)` / `resolve(key)` | §6. |
| `ctx.chip.set(id, { text, severity })` / `clear(id)` | §5.2. |
| `ctx.log(level, message)` | To the plugin's error log. |

A refused call throws `PluginRefused` with the reason; the broker also logs it.

### 4.3 Scheduler

- The core runs each source on its TTL, with one run in flight per source.
- `workHoursOnly` sources don't run outside the work hours in the plugin's settings (fields `workHours.days`, `workHours.from`, `workHours.to`, `workHours.timezone`; the core supplies them to any plugin with a `workHoursOnly` source).
- A panel's "Refresh" runs a source at once, work hours or not.
- A failed run keeps the last good data, retries with backoff (1, 2, 4… minutes, capped at the TTL), and shows the error in the panel header. After 3 failures in a row it raises an `info` attention item.
- Limits: 2 min per sync run. A crashed backend window restarts with backoff; after 5 crashes in an hour the plugin is turned off and raises an `action` item saying so.

### 4.4 What a plugin can't do

Read the person's work folder; reach the agent without a click; see the harness's data or other plugins' data; open windows; load remote code.

## 5. Panels, chips, actions

### 5.1 Panels

- An `<iframe sandbox="allow-scripts">` (no `allow-same-origin`) in the requested slot, from `hh-plugin://<id>/panel-<id>.html`, same CSP as the backend.
- **`@humanharness/plugin-ui`:** the core's color and type tokens plus small components (`Table`, `Chip`, `Clock`, `Stat`, `Empty`, `ErrorBar`), so panels look native. The core passes the theme (light or dark) and updates it live.
- **Panel API** (`usePlugin()`, over `postMessage` to the host window, which forwards to the broker):
  - `data.query` and `data.subscribe` on its own collections;
  - `settings.get`;
  - `refresh(source)`;
  - `requestAction(id, vars)`;
  - `focus`: the `target.focus` of the attention item that opened the panel.
- A panel has no `fetch` and no `exec`. What it needs from outside, the backend fetches.

### 5.2 Chips

No iframe. The backend calls `ctx.chip.set("who", { text: "You're on call", severity: "action" })`; the core draws it in the chip slot. A click opens the plugin's first panel.

### 5.3 Actions → prepared task

- `requestAction("triage", { key: "DOC-123" })` **doesn't start a task.** The core validates `vars` against the action's schema, fills the prompt template, and opens a **prepared task** it draws itself: "On-call · Triage DOC-123", the full prompt, the tier, **[Start]** and **[Cancel]**.
- A panel can't inject free text: only declared variables, validated, into a declared template. String variables are capped at 200 characters.
- The task runs in the open scope, or in `_app` when the action says `scope: "none"`. After Start it is an ordinary task: Usage, History, Stop. The history trailer adds `Plugin: <id>`.
- Only plugins with `permissions.tasks: true` may call `requestAction`.
- Possible later: "don't ask again for this action".

## 6. The Attention inbox

- An icon with a badge in the core chrome opens a list.
- An item: `key` (unique per plugin), origin (the plugin, or later a task), `severity` (`info`, `warn`, `action`), `title`, short `body`, time, and `target`: `{ panel, focus }` or `{ action, vars }` (the action always goes through the prepared task).
- **The badge counts only unread `action` items.**
- An item leaves when the plugin calls `resolve(key)` or the person dismisses it. A dismissed item raised again with the same `key` stays hidden until its `severity` or `title` changes.
- Stored in `.harness/attention.json`; items older than 30 days are purged.
- Optional macOS notification per plugin, for `action` items only, off by default.
- The API takes an origin, so C7's "waiting for you" can use the same inbox. This spec doesn't build C7.

## 7. Settings → Plugins

- **List:** name, origin ("bundled" / "local: ~/my-plugins/oncall"), state (on, off, error, turned off after crashes), last sync, on/off switch.
- **Add from folder…**
  1. reads `dist/plugin.json` and checks `api`, `harness` and the schema;
  2. shows the **permission review** in plain words: "Connects to: *.atlassian.net, api.firehydrant.io · Runs: `gh api` (read only) · Stores 2 keys · Can propose agent tasks";
  3. Turn on or Cancel.
- **A local plugin starts off.** When its `dist/` changes (for example after regenerating it with `/new-plugin`) and the new version **adds permissions**, it turns off and asks for a review again. A change of code only keeps it on and shows "updated". Changes are detected at app start and when Settings → Plugins opens.
- A bundled plugin also shows the permission review the first time it is turned on. Bundled plugins start off unless the harness lists them in `plugins.on: [...]`.
- **Plugin detail:** its settings (drawn by the core, as the harness's), its keys (paste, replace, delete; stored with Electron `safeStorage` in `~/.humanharness/<harness-id>/secrets/`, never shown again), "Test connection" (runs every source once and shows the result), and the last errors.
- **Remove:** deletes the pointer, settings, keys, plugin data and its attention items. Never touches the plugin's folder.

## 8. Engines and permissions

The broker's `exec` runs commands the plugin declared and the person approved; it doesn't change the agent's `permissions`. A plugin's settings sentences and its `agent: "read"` collections reach the agent only while the plugin is on.

## 9. Authoring

### 9.1 CLI: `humanharness plugin …`

| Command | What it does |
|---|---|
| `init <dir> [--harness <id>]` | Copies `packages/cli/plugin-template/` (1 source, 1 collection, 1 panel, 1 chip, 1 action, fixtures, `PLUGIN.md`) and installs the guide. |
| `build` | Checks and writes `dist/`. |
| `check [--json] [--harness <dir>]` | See 9.2. Errors exit with 1. |
| `record <source>` | Runs one real sync (asks for the secrets in the terminal, never stores them) and writes every `fetch`/`exec` request and response to `fixtures/<source>/`, with secret values replaced by `{{secret:<id>}}`. |
| `test` | Runs every source against its fixtures with a fixture broker and prints the records written, the attention items and the chips. No network, no tokens. |
| `dev --harness <dir> [--live]` | Opens the harness with the plugin loaded (`HH_PLUGIN_DIRS`), on fixtures by default; `--live` uses the real network. Rebuilds and reloads the panel on change. |

`test` may run the backend in Node's `vm` with the fixture broker as `ctx`, since nothing real is reachable there; the app always runs it in the Chromium sandbox.

### 9.2 `check`

- **Errors:** `schema`, `api-version`, `host-undeclared` (a literal URL in the code whose host isn't declared), `exec-undeclared`, `secret-undeclared` (`{{secret:x}}` with no `x`), `slot-unknown` (with `--harness`), `fixtures-missing` (a source with no fixtures), `plugin-md-mismatch`.
- **Warnings:** `exec-wide` (a pattern that is only `*` after the command), `exec-writes` (`-X`/`--method` other than GET, `POST`, `delete`…), `hosts-wildcard` (a top-level wildcard such as `*.com`), `sync-heavy` (TTL under 60 s).

### 9.3 `PLUGIN.md`

The plugin's living decision log, like `HARNESS.md`: Purpose, Sources (what each brings and on what TTL), Rules (what raises each attention item, at what severity), Panels, Actions, Permissions (each with its reason), Decision log. `check` reads the Sources table and the permission lines from it.

### 9.4 The guide: `packages/cli/guide/new-plugin.md`

- An engine-agnostic playbook in 7 phases, one question at a time: purpose, sources and credentials, data, rules and attention, panel and chip, actions, verify.
- Each phase ends with its `PLUGIN.md` section and the code updated together.
- **Verify can't be skipped:** `record` → `check` with no errors → `test` → `dev` showing the panel.
- On an existing plugin the guide starts by reading `PLUGIN.md` ("add regressions to the panel").
- `init` installs it as `.claude/skills/new-plugin/SKILL.md` and between markers in `AGENTS.md`, like `new-harness`.

## 10. Demo and tests

### 10.1 Demo plugin

`harnesses/demo/plugins/on-this-day/`, on Wikimedia's public "On this day" API (no key):
- 1 source (TTL 6 h), 1 collection with `agent: "read"`;
- 1 panel in the default slot, 1 chip;
- 1 `info` attention item on a round anniversary;
- 1 action "Explain this event" → prepared task.

It runs on fixtures in mock mode and in e2e. Secrets are covered by unit tests with a test plugin.

### 10.2 Tests

- **Unit:**
  - broker: hosts and wildcards, redirects, `exec` patterns, secret substitution and redaction (a secret never reaches the plugin), refusals, caps;
  - scheduler: TTL, one run in flight, `workHoursOnly`, backoff, crash restart, auto-off;
  - Attention: dedupe by `key`, dismiss, reappear on severity/title change, purge, badge count;
  - manifest checks (`plugin.json`, `slots`, `plugins`), permission review on a `dist/` change;
  - CLI `check`, `record` (secrets stripped), `test`.
- **e2e:**
  - the demo shows the panel on fixtures, the chip and the attention item;
  - the action opens the prepared task, and Start runs it on the fake engine;
  - a direct `fetch` from the panel or the backend fails by CSP.

## 11. Out of scope

- **Marketplace.** What it would need, on top of this spec: a registry (npm keyword or an index JSON), signed packages or provenance, an update channel, a revocation list that turns a bad plugin off everywhere, a browse/install/update screen, and publisher terms. The package format, permissions, sandbox and secret broker here are the same ones a marketplace would use, so it only adds distribution.
- An in-app "Create a plugin" action.
- Background agent jobs (C6): plugins spend tokens only through a prepared task.
- A plugin's own MCP server; chat blocks from plugins.
- PTY or terminal access: that is hatch H2, which this spec doesn't replace.
- Marco's on-call plugin: built afterwards with `/new-plugin` as a local plugin, as the first real test of the design.

## 12. Plans

1. **Runtime:** `plugin.json` schema and loading, harness `plugins` field, sandboxed backend, broker, scheduler, plugin data, Attention inbox, Settings → Plugins (list, add from folder, permission review, keys, test connection).
2. **Surface and authoring:** `slots`, panels and `@humanharness/plugin-ui`, chips, actions with the prepared task, CLI `plugin *`, the `/new-plugin` guide, the demo plugin, e2e.
