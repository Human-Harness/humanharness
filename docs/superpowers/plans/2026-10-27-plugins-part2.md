# Plugins, part 2 (surface and authoring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship plan 2 of the Plugins spec (§12.2) on top of part 1's runtime. It covers:
- the harness manifest's `slots`, with the core's default slots;
- panels in a sandboxed iframe and `@humanharness/plugin-ui`;
- chips drawn by the core;
- actions that open a **prepared task**, started only by the person's click;
- attention items whose targets open;
- the `humanharness plugin …` CLI (`init`, `build`, `check`, `record`, `test`, `dev`) and the `/new-plugin` guide;
- the demo plugin `on-this-day`, on fixtures in mock mode and e2e;
- the e2e the spec asks for (§10.2).

**Architecture.**

*Panels.* A panel is `panel-<id>.html` + `.js` + `.css` in the plugin's `dist/`. The app window shows it in an `<iframe sandbox="allow-scripts">` with no `allow-same-origin`, so the panel has an opaque origin, no storage, no access to the parent, no popups, no forms and no top navigation.
- The iframe is served from `hh-plugin://<id>/panel-<panel>.html` by a **second, panel-only** `hh-plugin` handler on the app window's default session. That handler serves only the declared panel files of a plugin that is running, never `backend.js`, `plugin.json` or `_hh/`, with a panel CSP sent as a response header.
- The app's own CSP gains exactly `frame-src hh-plugin:`.
- Navigation guards: `will-frame-navigate` refuses any subframe navigation that isn't the iframe's own panel URL, and the renderer reloads a panel that loaded twice.
- The default session's `webRequest` cancels any request a plugin frame makes to anything but its own panel files. That covers the panel's own CSP being wrong.

*Panel calls.* A panel talks only through `postMessage` to the app window. The app's `PanelFrame` bridge accepts a message only when `event.source` is that iframe's own `contentWindow`, and takes the plugin and panel ids from the iframe element it created, never from the message. It forwards a small, typed set of calls over one IPC channel, `hh:pluginsPanel`:
- `data.query` on the plugin's own collections, read-only;
- `settings.get`, values only, never keys;
- `refresh`, rate-limited;
- `requestAction`;
- `resize`.

Main checks every call again against the plugin's manifest.

*Actions.* `requestAction` never starts a task. Main validates `vars` against the action's JSON Schema (already allowlisted in part 1) and caps every string at 200 characters. It then fills the declared template in one literal pass and keeps a single-use token. The app draws a prepared-task card with the title, the full prompt and the tier, plus **Start** and **Cancel**. Start calls `TaskManager.startPrepared`: a free question at the action's tier, in the open scope or `_app` (`scope: "none"`), whose history commits carry `Plugin: <id>`.

*Chips.* Chips are text drawn by the core from part 1's chip map. Attention targets open the panel, passing `focus`, or the prepared task.

*Authoring.* The authoring side lives in `@humanharness/cli`:
- `definePlugin` (SDK) turns zod into the `plugin.json` JSON Schemas.
- `build` bundles with esbuild, aliasing `@humanharness/plugin-ui`, React and the SDK's backend sub-path to the CLI's own copies, so a plugin folder outside the repo builds without its own `node_modules`.
- `check` reads the dist, the sources and `PLUGIN.md`.
- `record` and `test` run the backend in Node's `vm` against part 1's very same `PluginBroker` (the shell exports it as `@humanharness/shell/plugins`). They use a live transport (`record`) or a **fixture transport** (`test`).
- The app uses the same fixture transport in mock mode, in e2e and in `plugin dev` without `--live`, so neither mock mode nor the tests ever touch the network or a real key.

**Tech Stack:** TypeScript, zod 4.6 (`z.toJSONSchema`), Electron 44 (`protocol.handle` on the default session, `will-frame-navigate`, `webRequest`), React 19, esbuild 0.28.2 (already in the lockfile through tsx), Node `vm`, Vitest (+ happy-dom), Playwright e2e with fake-claude, pnpm via corepack.

**Spec:** `docs/superpowers/specs/2026-10-27-plugins-design.md`: §3.1 build, §3.4 `slots`, §5 panels, chips and actions, §6 targets, §9 authoring, §10 demo and tests, §12.2. Part 1 is `docs/superpowers/plans/2026-10-27-plugins-part1.md`; this plan builds on its tasks, names and tests. **Branch:** `feat/plugins`, the same branch, after part 1's last task.

---

## Conventions

Part 1's conventions hold unchanged: code style, hot files, commands and git, compliance. Additions:

- **en.json:** every new UI string goes inside the existing top-level `"plugins"` block that part 1's Task 17 created, under new sub-keys: `panels`, `chips`, `prepared`, `slots`. Never edit other blocks. Never run prettier over an existing file.
- **`@humanharness/plugin-ui`:** it lives in `packages/ui/src/plugin-ui/` and is exported as `@humanharness/ui/plugin-ui`. It imports nothing from the rest of `@humanharness/ui` except `tokens.css`, which is generated, so a panel bundle stays small and holds no app code. `build` aliases `@humanharness/plugin-ui` to it.
- **CLI code:** it goes in `packages/cli/src/plugin-*.ts`, one file per command (`plugin-init.ts`, `plugin-build.ts`, …), plus `plugin.ts` for the command group. It reuses `parseCommand`, `CliError`, `UsageError`, `Io` and the `guide.ts` helpers.
- **The shell's export for the CLI:** `@humanharness/shell/plugins` → `src/main/plugin-cli.ts`, re-exporting `PluginBroker`, `pluginFetch`, `pluginExec`, `runFile` and `fixtureTransport`. This follows the existing `./tasks` export. It must not import Electron (a test pins that).
- **Hot files**, small additive edits only:
  - `packages/ui/src/client.ts`: new types at the end, one namespace method group;
  - `packages/shell/src/main/index.ts`: the panel handler registration in the existing plugins block, the new IPC, the `startPrepared` wiring;
  - `ChatView.tsx`: the chips in the top bar, the plugins section prop to `FlowSide`, the prepared card above the composer;
  - `FlowSide.tsx`: one optional prop;
  - `packages/shell/src/renderer/index.html`: one CSP directive.

**Commands and git.** Same as part 1. Run single test files with `corepack pnpm vitest run <path>`. Commit trailer:

```
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv
```

Every task ends with `corepack pnpm typecheck` and `corepack pnpm test` green. Tasks that touch main, preload, resources or UI also run `corepack pnpm app:build`. Tasks 21 and 22 run `corepack pnpm e2e`. **No task changes dependencies or runs an install.** Task 15 resolves esbuild through tsx (`createRequire(require.resolve("tsx/package.json")).resolve("esbuild")`); making esbuild and react direct CLI dependencies is an open question.

**Compliance.**
- No code, test or spike reads `~/.claude`, `~/.codex`, `~/.gemini`, `~/.config/opencode`, `~/.local/share/opencode` or any credential file.
- `record` asks for keys in the terminal with echo off. It holds them in memory for that one run and writes them nowhere: fixtures carry `{{secret:<id>}}` instead.
- No test uses the network. The demo plugin's fixtures are hand-made (see Open questions). The fixture transport refuses any request that has no fixture; it never falls through to the network.

**D0 is a hard rule.** Each of these has a regression test.
- A manifest without `slots` parses to the same object as before. A harness without `slots` gets the default slots **only in the plugin surface**: `defineHarness` output is unchanged (Task 2).
- A harness without `plugins`, with no `HH_PLUGIN_DIRS`, sees nothing new:
  - no panel handler on the default session;
  - no `webRequest` listener on the default session;
  - no `will-frame-navigate` listener;
  - no new IPC handler;
  - no `pluginSurface` in `AppState`;
  - top bar, `FlowSide`, side panel and composer render exactly as before (Tasks 7, 10, 12, 13, 22).
- The renderer CSP change is **only** `frame-src hh-plugin:`. With no plugin handler registered, any `hh-plugin:` frame fails to load (Task 7 pins the meta; Task 22 checks that the D0 app has no iframe).
- With plugins accepted but none running, the surface is empty: no Plugins section, no chip, no prepared card (Tasks 12, 13).
- `withTrailer` without `plugin` writes exactly what it did before. `parseCommitMessage` of an old message gives the same result (Task 4).
- `TaskManager` without `startPrepared` calls behaves exactly as before. `profileFor` without a tier gets the same arguments (Task 5).
- Mock mode without plugins: unchanged. With plugins, it runs them on fixtures (Task 9).
- `humanharness check` and `init` for **harnesses** are unchanged. `plugin` is a new command group, and `USAGE` gains only its lines (Tasks 15, 19).
- The demo harness with its plugin **off** (the default, see Open questions): no backend window, no network, nothing written by plugins. Only Settings › Plugins lists it (Task 22).

## Threat model, part 2 (security-critical: every boundary has a test)

Part 1's model holds (B1–B13). Part 2 adds **panel code**, which runs inside the app window's process tree, **action requests**, which put text in front of the agent, and **authoring tools**, which run plugin code on the author's machine. All three are hostile by default, like the backend. Assets are as in part 1, plus the app window itself (its DOM, its preload, its IPC) and the person's attention: a prepared task must never start without their click.

| # | Boundary | What enforces it | Test |
|---|---|---|---|
| P1 | No Node, preload or app IPC in a panel | `nodeIntegrationInSubFrames` stays `false`, so the app's preload runs only in the main frame. The iframe is `sandbox="allow-scripts"` without `allow-same-origin`, so its origin is opaque and `window.parent` is cross-origin. Every `hh:*` channel is refused for a non-app frame (`handle()`/`isAppUrl`, part 1 B5) | e2e panel probe: `typeof window.hh`, `typeof require`, `typeof process` are `"undefined"`; reading `window.parent.document` or `window.parent.hh` throws (T22). Unit: `isAppUrl` refuses `hh-plugin://x/panel-y.html` (part 1 T11 already covers it; T7 adds the panel URL) |
| P2 | No network from a panel | The panel CSP header (`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'`) on every default-session `hh-plugin:` response. The default session's `webRequest.onBeforeRequest` cancels any request from a frame whose URL is `hh-plugin:` unless it is that plugin's own panel file. The app's CSP keeps `connect-src` at `'self'` (via `default-src`) | e2e panel probe tries fetch, XHR, WebSocket, EventSource, `sendBeacon`, `<img>`, `<script src>`, `import()`, Worker and `<link rel=prefetch>` against a local server: the hit count stays 0 (T22). Unit: `allowPanelRequest` table (T7) |
| P3 | A panel can't leave its frame | The sandbox has no `allow-top-navigation`, `allow-popups` or `allow-forms`. `will-frame-navigate` refuses a non-main frame's navigation unless the target is `hh-plugin://<id>/panel-<panel>.html` with the same id as the frame's current URL, or it is the frame's first load (`about:blank` or empty). `PanelFrame` reloads the iframe's own `src` when it fires `load` a second time and drops messages until then. The app's `setWindowOpenHandler` already denies | e2e probe: `location.href = "http://127.0.0.1:<port>/nav"` and `window.open(...)`: 0 hits, the panel is still there (T22). Unit: `allowFrameNavigation` table (T7); `PanelFrame` reload on second load (T11) |
| P4 | A panel speaks only for itself | `PanelFrame` takes `plugin` and `panel` from its own props, never from the message, and accepts a message only when `event.source === iframe.contentWindow` (and `event.origin === "null"`). Main re-checks that the plugin is running and the panel is declared | Unit: messages from another source, with a forged `plugin` field, or from a frame after a reload are ignored (T11). Main: a call naming another plugin's collection is refused (T6) |
| P5 | A panel reads only its own data, and nothing secret | `data.query` reaches only `Object.hasOwn(manifest.data, collection)` of its own plugin and is read-only (no put or delete): at most 500 records, the query object at most 4 KB. `settings.get` returns values only, never secrets, which never leave main (B6). There is no `fetch`, no `exec` and no attention or chip writes from a panel | Unit (T6) |
| P6 | No tokens without a click; no free text into the agent | `requestAction` needs `permissions.tasks` and a declared action. Each var is validated by the action's allowlisted schema → zod, with every string at most 200 characters (deep) and the vars at most 4 KB of JSON. The template fill is literal and single-pass: a value containing `{{x}}` is not expanded again, and an unfilled placeholder is refused. The prepared card shows the full prompt. Start is a separate IPC carrying a single-use token that expires in 10 minutes; at most one prepared task waits at a time; `requestAction` is limited to 1 per 2 s per plugin. Nothing in part 2 lets a plugin start a task | Unit: `fillActionPrompt` and `checkActionVars` tables (T3); controller (T6); TaskManager (T5). e2e: the action shows the card, and nothing runs until Start (T22) |
| P7 | The default-session handler serves only panels | `resolvePanelFile` (on top of part 1's `resolvePluginFile`) accepts only `panel-<declared id>.{html,js,css}` of a **running** plugin, plus `assets/*.{svg,png}`. It never serves `backend.js`, `plugin.json`, `_hh/` or anything of a stopped plugin | Unit table (T7) |
| P8 | The app's own page is not loosened beyond one directive | The renderer meta CSP is exactly the old one plus `frame-src hh-plugin:` | Unit: a test reads `index.html` and compares the directive list (T7) |
| P9 | Plugin text never becomes markup | Chip texts, panel titles, prepared titles and prompts, and attention texts render as React text, never through `markdown.tsx` or `dangerouslySetInnerHTML`. Their lengths are capped in main (chip ≤ 40, title ≤ 120, prompt ≤ 4,000 + vars) | Unit: a `<b>`/`<img onerror>` string renders as text (T12, T13) |
| P10 | Mock mode, e2e and `dev` don't touch the network or real keys | In fixture mode the broker gets the fixture transport instead of `fetch`/`runFile`, and `secrets(ids)` returns `fixture-<id>` without opening the secret store. A request with no fixture fails the run with "No fixture for GET https://host/path" | Unit (T3, T9); e2e with a local server hit count 0 (T22) |
| P11 | `record` never stores a key | Keys are read with echo off and held for one run. The broker substitutes them (part 1). Before writing, every fixture file passes `stripSecrets`, which replaces each key's raw, URL-encoded and base64 forms with `{{secret:<id>}}` in requests and responses; a file that still contains a key is not written and the command fails | Unit (T18) |
| P12 | Authoring tools run plugin code only on the author's machine and say so | `record` and `test` run the bundled backend in Node's `vm`. That is **not** a sandbox, and both commands print one line saying so the first time. `plugin.config.ts` is executed only by `build` (bundled to a temp file, then imported). The app never imports or runs it | Unit: no shell source imports `plugin.config` or `vm` (a source scan, T9); a CLI test checks the warning line (T17) |
| P13 | What the agent sees from an action is what the person saw | The prepared card shows the exact text that becomes the task's question (same string, no re-fill at Start). The history trailer names the plugin | Unit (T5, T6); e2e checks that the chat's first line is the card's title and that the fake engine received the card's prompt (T22) |

Out of reach in part 2, recorded in the docs:
- A panel can render misleading UI inside its own frame (phishing-style text). The frame is drawn inside a core-labelled section with the plugin's name, which is the mitigation.
- A malicious plugin can still put persuasive text into a prepared task's vars, within the 200-character cap. The person reads the full prompt before Start.
- `record` and `test` give plugin code the author's Node process.
- Packaged apps don't ship bundled plugins yet (plan 4b).

## Decisions this plan takes where the spec leaves room

Each is a default; Open questions repeats the ones Marco may want to change.

1. **Slots.**
   - `slots` is optional on the harness manifest: `[{ id, label, kind: "panel" | "chip" }]`, ids `SLOT_ID`, at most 10, unique.
   - The core's two default slots, `plugins` (panel) and `chips` (chip), always exist. A harness may not redeclare those ids.
   - A plugin's `panels[].slot` and `chips[].slot` become **optional**; absent means the default slot of that kind. A slot the harness doesn't declare, or one of the other kind, falls back to the default slot of the right kind (spec §3.4).
   - The harness draws its own slots with `<PluginSlot id="…" />` from `@humanharness/ui`. A declared slot the harness never mounts shows nothing. `check` can't see that, and the docs say so.
2. **Where the default slots are.**
   - `plugins` is a **"Plugins" section** in the left side panel: inside `FlowSide` after the material when the harness has actions, else its own `<nav className="hh-flow-side">` like the material's.
   - The section holds one tab per panel, headed with the panel's title and the plugin's name. It shows only while at least one running plugin has a panel there.
   - `chips` sit in the top bar right after `UsageMeter`.
   - Narrow windows hide the Plugins section like the flow side, and chips stay.
3. **Panel size.** Each panel's height follows its content: plugin-ui's root `ResizeObserver` sends `resize`, clamped to 120–800 px. Before the first resize it is 240 px. Width is the slot's.
4. **Theme.** `tokens.css` carries the same `--hh-*` values as the app, light and dark, under `prefers-color-scheme`, so panels follow the system live by themselves. The bridge also sends `{ event: "theme", dark }` on load and on every change, so `usePlugin().theme` can drive canvases. A test pins that every `--hh-*` token in `tokens.css` has the app's value.
5. **Panel CSP** is exactly P2's. There is no `'unsafe-inline'` for styles: `build` writes `panel-<id>.css`, which holds plugin-ui's styles plus any CSS the panel imports, and React's `style={{…}}` goes through the CSSOM, which `style-src` doesn't block (spike).
6. **Panel files.** `build` writes `panel-<id>.html`:

   ```html
   <!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./panel-<id>.css"><div id="root"></div><script type="module" src="./panel-<id>.js"></script>
   ```

   It also writes `panel-<id>.js`, an ESM bundle that includes React and plugin-ui and mounts the panel's default export with `mountPanel`, and `panel-<id>.css`. Optional static files go in `dist/assets/` (`.svg`, `.png`).
7. **The panel protocol** (plugin-ui ⇄ `PanelFrame`):
   - A request is `{ hh: 1, id, call, args }`.
   - The answer is `{ hh: 1, re: id, ok: true, value }` or `{ hh: 1, re: id, ok: false, error }`.
   - Events are `{ hh: 1, event: "data", collections: string[] }`, `{ hh: 1, event: "theme", dark }` and `{ hh: 1, event: "focus", focus }`.
   - The calls are `data.query`, `settings.get`, `refresh`, `requestAction` and `resize`. `data.subscribe` is plugin-ui's own: it re-runs a query whenever a `data` event names its collection.
   - Limits: messages at most 64 KB; 20 calls per second per panel, after which calls are answered `{ ok: false, error: "Too many calls" }`; at most 8 calls in flight.
8. **Data events.** After every run that wrote, the controller pushes `hh:pluginData { plugin, collections }` (the collections written). This is only a signal; the panel queries again.
9. **`refresh` from a panel** runs the source now, unless a run of it is in flight or the last run started less than 10 s ago. In both cases it answers `{ ok: true, value: "skipped" }`.
10. **Prepared task.**
    - Title: `"<plugin name> · <action label>"`, followed by `" <value>"` when the action's vars schema has a `required` string var whose value is at most 40 characters (the first such, in `properties` order). The spec's example is "On-call · Triage DOC-123".
    - Prompt: the filled template. It is the task's question, so the agent sees it inside the usual question prompt (language, notes index).
    - Tier: the action's, overriding `questions.tier`.
    - Scope:
      - `scope: "none"`: `_app` in a harness with scopes, `main` without scopes.
      - `"required"`: the open scope; Start is disabled with "Open a <scope label> first" when none is open.
      - In a harness without scopes the two are the same.
    - The card replaces any earlier prepared card. **Cancel** drops the token.
    - The card waits until Start, Cancel, a base change or 10 minutes. It doesn't survive a restart.
11. **Task identity.** `CurrentTask.plugin?: string`. `HistoryTrailer.plugin?` writes `Plugin: <id>`, and `parseCommitMessage` reads it into `HistoryEntry.plugin?`. A follow-up turn keeps the plugin. The plugin's name isn't stored; the history shows the id.
12. **Attention targets.** Part 1 kept targets in main. A new `attention.open(plugin, key)` marks the item read and answers one of:
    - `{ kind: "panel", plugin, panel, focus? }`: the renderer opens that panel and sends `focus`;
    - `{ kind: "prepared" }`: the card appears through the surface push;
    - `{ kind: "none" }`: the plugin is off, or the panel or action is gone.
13. **Chip click** opens the plugin's first panel, wherever its slot is. A chip whose plugin has no panel is plain text.
14. **Fixture transport.**
    - Files live in `<plugin root>/fixtures/<source>/<NNN>.json`, one exchange per file, played in file-name order.
    - An exchange is `{ "kind": "fetch", "request": { method, url, headers?, body? }, "response": { status, headers, text } }` or `{ "kind": "exec", "request": { cmd, args }, "response": { code, stdout, stderr } }`.
    - Matching takes the first unused exchange with the same kind and method, the same host, and the same path segment by segment, where a fixture segment `*` matches any one segment. The query string must match exactly, unless the fixture's query is `?*`. Exec matches the same `cmd` and args token by token, with `*` for one token. No regex is built from fixture text.
    - When every exchange is used, matching starts over (a TTL loop replays).
    - Fixture headers may hold `{{secret:<id>}}`; the transport compares them as-is with the outgoing request after substitution of `fixture-<id>`, and treats header mismatches as non-fatal.
    - The transport lives in the SDK (pure, using `Response` from the platform) and is used by the app (mock mode, e2e, `dev`), `test`, and `record` (which writes the same format).
15. **When the app uses fixtures:**
    - in mock mode (`hooks.mock`);
    - under `HH_PLUGIN_FIXTURES=1`, a dev-only test hook that `plugin dev` sets without `--live` and that e2e sets.

    Bundled plugins read fixtures from `<harness>/plugins/<id>/fixtures/`, dev plugins from their folder, and local plugins from `<folder>/fixtures/`. A plugin with no fixtures in fixture mode fails each run with the "No fixture" error and is never live.
16. **`definePlugin`.**
    - Input: the manifest with zod schemas in `data[].schema`, `settings.fields[].schema` and `actions[].vars`.
    - Output: plain `plugin.json` data, through `z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "throw" })`, minus `$schema`. The result is checked by `parsePluginManifest`, so a zod `.regex()` (which becomes `pattern`) fails the build with part 1's allowlist message.
    - `slot` may be left out.
    - It lives in the SDK main entry. A backend imports only `@humanharness/harness-sdk/plugin-backend` (part 1).
17. **`build`:**
    - esbuild (`format: "esm"`, `platform: "browser"`, `target: "chrome130"`, `bundle`, `minify: false`, `legalComments: "none"`, `charset: "utf8"`), with aliases to the CLI's own resolution of `@humanharness/plugin-ui`, `@humanharness/harness-sdk/plugin-backend`, `react`, `react-dom/client` and `react/jsx-runtime`.
    - It writes `dist/` fresh: the old one is removed first, and only the files listed in Decision 6, `backend.js` and `plugin.json` are written.
    - Output is deterministic: a test builds twice and compares bytes.
    - `plugin.config.ts` is bundled to a temp `.mjs` (Node platform, the same aliases plus `zod`) and imported to get the definition. The temp file is removed after.
18. **`check` rules:**
    - The spec's §9.2 set: errors `schema`, `api-version`, `host-undeclared`, `exec-undeclared`, `secret-undeclared`, `slot-unknown`, `fixtures-missing`, `plugin-md-mismatch`; warnings `exec-wide`, `exec-writes`, `hosts-wildcard`, `sync-heavy`.
    - Plus the warning `host-local` (part 1 Decision 8: `localhost` and IP literals are refused at runtime).
    - Plus the error `prompt-placeholder`: a `{{name}}` in an action prompt that isn't a declared var, or a declared required var the prompt never uses.
    - `check` reads the built `dist/` (it runs `build` first unless `--no-build`).
    - The source scans run over `backend.ts`, `panels/**` and `src/**` (`.ts`, `.tsx`, `.js`), with fixed regexes in the CLI: `https?://([a-z0-9.-]+)`, `exec\(\s*["']([A-Za-z0-9._-]+)["']`, `\{\{secret:([a-z][a-z0-9_-]*)\}\}`.
19. **`PLUGIN.md`.**
    - Sections are `## Purpose`, `## Sources` (a table `| Source | Brings | TTL |`), `## Rules`, `## Panels`, `## Actions`, `## Permissions`, and `## Decision log`.
    - Permission bullets read `- Host: <pattern> — <reason>`, `- Runs: <cmd> <args…> — <reason>`, `- Key: <id> — <reason>` and `- Tasks — <reason>`.
    - `plugin-md-mismatch` fires when the Sources table's ids or TTLs differ from the manifest, or when the permission bullets aren't exactly the declared hosts, exec patterns, secret ids and tasks.
    - The parser reuses `harness-md.ts`'s section and table helpers.
20. **`record <source>`** runs one real sync with a live transport (global `fetch`, `runFile`), in-memory plugin data in a temp folder, and keys asked in the terminal. It writes `fixtures/<source>/001.json`… after first deleting that source's old fixtures (asking first unless `--yes`), and prints what it wrote. It refuses to run when stdin is not a TTY and the plugin declares secrets.
21. **`test`** runs every source once on fixtures, with settings at their defaults and `now` fixed by `--now <iso>` (default: the real now). It prints per source the records written by collection (count + the first 3 keys), the attention items, the chips and the log lines. Exit is 1 when a source fails.
22. **`dev`** runs `build`, then the harness `dev` command with `HH_PLUGIN_DIRS=<plugin dir>` and `HH_PLUGIN_FIXTURES=1` unless `--live`. It watches the plugin folder (`fs.watch` recursive, ignoring `dist/` and `fixtures/`; debounce 300 ms) and rebuilds on change. The app's controller in dev mode watches each `HH_PLUGIN_DIRS` `dist/` (debounce 300 ms): it rescans, restarts the backend, and bumps the surface's `reloads[plugin]`, so `PanelFrame` remounts.
23. **The guide** (`packages/cli/guide/new-plugin.md`) is the spec's 7 phases.
    - `plugin init` installs it in the plugin folder as `.claude/skills/new-plugin/SKILL.md` and between `<!-- humanharness:plugin-guide:start -->`/`<!-- humanharness:plugin-guide:end -->` in `AGENTS.md`.
    - `guide.ts` gains `pluginSkillFile`, `pluginAgentsFile` and `pluginGuideSection`. The harness functions stay byte-identical.
24. **The plugin template** (`packages/cli/plugin-template/`): 1 source `items` (TTL 900) from `api.example.com` with 1 fixture, 1 collection `items` (`agent: "read"`), 1 panel `main`, 1 chip `count`, 1 action `summarize` (`tier: "light"`, `scope: "none"`), `PLUGIN.md` filled in, `tsconfig.json` and `README.md`. `init` replaces `__ID__`, `__NAME__` and `__HARNESS__`. A test runs `init`, then `build`, `check` and `test`, all green.
25. **The demo plugin `on-this-day`** (`harnesses/demo/plugins/on-this-day/`):
    - Source `events`, TTL 21600 s (6 h), `GET https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/selected/<MM>/<DD>` with `Api-User-Agent: HumanHarness-demo/0.1` (Wikimedia's API etiquette).
    - Collection `events` (`agent: "read"`, `key: "id"`, `{ id, year, text, page? }`) and settings field `count` (5–50, default 25). The attention rule looks at the stored events only, so with a lower `count` a round anniversary may not be among them.
    - Panel `events` (default slot), a list with an "Explain" button per row.
    - Chip `today`: `"<n> events today"`, or `"<n>-year anniversary today"` when one is round.
    - Attention: one `info` item `round-<year>` for each event whose age is a multiple of 25, with target `{ panel: "events", focus: "<id>" }`.
    - Action `explain` (`tier: "light"`, `scope: "none"`, vars `{ year: integer, text: string }`, both required): prompt `"Explain this event from {{year}} for someone curious, in a few short paragraphs: {{text}} Say when you're unsure."`.
    - **The fixtures are hand-made**, with a `*` path for any date. They hold 25 synthetic events with years 1901–1925, so exactly one is a round anniversary in any year. The text reads "Sample event for the demo (fixture)". The source, the committed `dist/`, the fixtures and `PLUGIN.md` are all in the repo.
    - The demo lists it with `plugins: { bundled: ["on-this-day"], local: true }`: **not in `on`**.
26. **Mock mode docs.** `docs/architecture/mock-mode.md` gains a "Plugins" paragraph: plugins run on their fixtures, and keys are never read.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `docs/spikes/2026-10-27-plugins-panels.md` | Create | Spike results P-S1…P-S10 |
| `packages/harness-sdk/src/plugin.ts` | Modify | `slots`, `DEFAULT_SLOTS`, `slotFor`, optional `slot`, `definePlugin`, `pluginJson` |
| `packages/harness-sdk/src/plugin-actions.ts` | Create | `checkActionVars`, `fillActionPrompt`, `promptPlaceholders`, `preparedTitle` |
| `packages/harness-sdk/src/plugin-fixtures.ts` | Create | Fixture schema, `matchFixture`, `fixtureTransport`, `stripSecrets` |
| `packages/harness-sdk/src/index.ts` | Modify | `slots` field + checks; exports |
| `packages/workspace/src/history.ts` | Modify | `Plugin:` trailer |
| `packages/shell/src/main/task-manager.ts` | Modify | `startPrepared`, `CurrentTask.plugin`, the trailer, the tier |
| `packages/shell/src/main/task-store.ts` | Modify | `plugin?` on `CurrentTask` |
| `packages/shell/src/main/plugins.ts` | Modify | Surface view, `panelCall`, `requestAction`, prepared tokens, `attention.open`, data pushes, transport choice, dev watch |
| `packages/shell/src/main/plugin-broker.ts` | Modify | Transport and secrets seam (fixture mode) |
| `packages/shell/src/main/plugin-panels.ts` | Create | `PANEL_CSP`, `resolvePanelFile`, `allowPanelRequest`, `allowFrameNavigation` |
| `packages/shell/src/main/plugin-host.ts` | Modify | Default-session panel handler, request filter, frame-navigation guard |
| `packages/shell/src/main/plugin-ipc.ts` | Modify | `hh:pluginsPanel`, `hh:pluginsSurface`, `hh:pluginsStartPrepared`, `hh:pluginsCancelPrepared`, `hh:attentionOpen` |
| `packages/shell/src/main/plugin-cli.ts` | Create | The CLI's entry into the broker (no Electron) |
| `packages/shell/src/main/test-hooks.ts` | Modify | `pluginFixtures` (HH_PLUGIN_FIXTURES) |
| `packages/shell/src/main/index.ts` | Modify | Wiring (small, additive) |
| `packages/shell/src/preload/index.ts` | Modify | New calls and pushes |
| `packages/shell/src/renderer/index.html` | Modify | `frame-src hh-plugin:` |
| `packages/shell/package.json` | Modify | `"./plugins": "./src/main/plugin-cli.ts"` export |
| `packages/ui/src/client.ts` | Modify | Surface, panel call, prepared and target types; client calls |
| `packages/ui/src/plugin-ui/*` | Create | `tokens.css`, `index.ts` (`mountPanel`, `usePlugin`, components) |
| `packages/ui/package.json` | Modify | `"./plugin-ui": "./src/plugin-ui/index.ts"` export |
| `packages/ui/src/plugins/PanelFrame.tsx` | Create | The iframe and its bridge |
| `packages/ui/src/plugins/PluginsSection.tsx`, `PluginSlot.tsx`, `PluginChips.tsx`, `PreparedTask.tsx`, `surface.ts` | Create | Slots, chips, prepared card, surface context |
| `packages/ui/src/FlowSide.tsx`, `ChatView.tsx`, `index.ts` | Modify | Mount points; export `PluginSlot` |
| `packages/ui/src/plugins/AttentionInbox.tsx` (part 1) | Modify | Targets open |
| `packages/i18n/src/locales/en.json` | Modify | Inside the `plugins` block only |
| `packages/cli/src/plugin.ts`, `plugin-init.ts`, `plugin-build.ts`, `plugin-check.ts`, `plugin-md.ts`, `plugin-run.ts`, `plugin-test.ts`, `plugin-record.ts`, `plugin-dev.ts` | Create | The `plugin` command group |
| `packages/cli/src/main.ts`, `guide.ts`, `paths.ts` | Modify | Register `plugin`; plugin guide files; template path |
| `packages/cli/package.json` | Modify | `esbuild` (exact lockfile version) |
| `packages/cli/plugin-template/**` | Create | The template |
| `packages/cli/guide/new-plugin.md` | Create | The guide |
| `harnesses/demo/plugins/on-this-day/**` | Create | Demo plugin: source, `dist/`, fixtures, `PLUGIN.md` |
| `harnesses/demo/harness.config.ts` | Modify | `plugins.bundled` |
| `packages/e2e/tests/plugins-surface.spec.ts` | Create | Demo panel, chip, attention, action → prepared → Start, panel probe |
| `packages/e2e/fixtures/plugins/probe/dist/panel-probe.*` | Create | The panel probe |
| `docs/architecture/plugins.md`, `mock-mode.md`, `authoring.md`, `manifest.md` | Modify | Part 2 sections |

---

### Task 0: Commit this plan

- [ ] **Step 1:** Copy this file to `docs/superpowers/plans/2026-10-27-plugins-part2.md` in the `feat/plugins` worktree, after part 1's last task.

- [ ] **Step 2: Commit**

```bash
git -C <worktree> add docs/superpowers/plans/2026-10-27-plugins-part2.md
git -C <worktree> commit -m "docs(plans): plugins part 2

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 1: Spike — panels inside the app window, and the build

Panels add Chromium behaviour that part 1's spike didn't cover. Run it before writing any panel code. Throw-away code goes in `/tmp/hh-pl2-spike/`. The only committed file is `docs/spikes/2026-10-27-plugins-panels.md`. **No network**: the local HTTP server listens on `127.0.0.1:0`. Install nothing except Step 3's offline check, which writes nothing to the repo (`--lockfile-only` is not used; see the step).

**Files:**
- Create: `docs/spikes/2026-10-27-plugins-panels.md`

| # | Question | Used by | If the answer is no |
|---|---|---|---|
| P-S1 | With the app window's settings (`sandbox: false`, `contextIsolation: true`, preload, `nodeIntegrationInSubFrames` unset), does the preload run **only** in the main frame? Inside an `<iframe sandbox="allow-scripts" src="hh-plugin://x/panel-a.html">`, are `window.hh`, `require` and `process` undefined, and does `window.parent.document` throw? | P1, T7 | Stop: panels can't ship this way. Record the finding and ask Marco |
| P-S2 | A `protocol.handle("hh-plugin", …)` on the **default** session coexists with part 1's per-partition handlers. A panel response with the P2 CSP **header** runs `<script type=module src="./panel-a.js">` in an opaque-origin sandboxed frame (`'self'` matches the URL's origin), and `fetch`, `<img>`, WebSocket and `import()` to the local server get 0 hits | P2, T7 | If `'self'` fails in the opaque frame, use `script-src hh-plugin://<id>` per response and record it |
| P-S3 | `session.defaultSession.webRequest.onBeforeRequest` sees a request made by the iframe with `details.frame?.url` starting `hh-plugin://x/`, and `details.url` is the target. The app's own requests have a `file:` frame URL and pass | P2, T7 | Use `details.referrer` / `details.resourceType` and record which |
| P-S4 | `webContents.on("will-frame-navigate", e)` fires for the iframe's `location.href = "http://127.0.0.1:<port>/nav"`, with `e.isMainFrame === false`, `e.url` the target and `e.frame.url` the panel's URL; `e.preventDefault()` stops it (0 hits) | P3, T7 | Fall back to the `webRequest` filter (P-S3) cancelling `subFrame` navigations to anything but `hh-plugin:`, and record that |
| P-S5 | Messages from the iframe arrive in the app page with `event.origin === "null"` and `event.source === iframe.contentWindow`, and `iframe.contentWindow.postMessage(msg, "*")` reaches the panel | P4, T11 | Stop and ask |
| P-S6 | The renderer meta CSP with `frame-src hh-plugin:` added loads the iframe, and without it the frame is blocked (pins the need for P8) | P8, T7 | Record it |
| P-S7 | Under `style-src 'self'` (no `'unsafe-inline'`), does React 19's `style={{ height: 10 }}` apply (CSSOM), while a `<style>` element and a `style="…"` attribute in markup are blocked? | Decision 5 | Add `'unsafe-inline'` to `style-src` for panels only and list it in Open questions |
| P-S8 | Dropped: no installs. `createRequire(require.resolve("tsx/package.json")).resolve("esbuild")` finds esbuild | T15 | — |
| P-S9 | esbuild bundles a TSX panel that imports React, plus a backend `.ts` importing the SDK's `plugin-backend` sub-path, with `alias` pointing at absolute paths outside the plugin folder. It needs no `node_modules` in the plugin folder, and two builds are byte-identical | T15 | Use `nodePaths: [<cli node_modules>]` instead of `alias` and record it |
| P-S10 | Node `vm` (`new vm.SourceTextModule` behind `--experimental-vm-modules`, or the backend bundled as an IIFE run with `vm.runInContext`) can run a built `backend.js` with a provided `ctx` and await its sources. Which works without Node flags under `tsx`? | T17, T18 | Build a second backend form for the CLI only (`backend.cjs.js` in a temp folder, IIFE with `globalName`), never written to `dist/`; record it |

- [ ] **Step 1:** Write `/tmp/hh-pl2-spike/main.cjs`, an Electron main based on part 1's spike: a `BrowserWindow` with the app's `webPreferences`, loading a local `index.html` whose meta CSP is the app's own plus `frame-src hh-plugin:`. The page creates the iframe, listens for `message` and logs origin/source checks (P-S5). Register `hh-plugin` privileged as part 1 did, `protocol.handle` on the default session serving `panel-a.html`, `.js` and `.css` with the P2 header (P-S2), log `webRequest` (P-S3) and `will-frame-navigate` (P-S4). The panel script reports each probe through `parent.postMessage`. Run it with the repo's Electron binary (`corepack pnpm --filter @humanharness/shell exec electron /tmp/hh-pl2-spike/main.cjs`).
- [ ] **Step 2:** P-S7: the same panel renders a tiny React tree via a pre-bundled file (Step 4's esbuild), checking `getComputedStyle` for the CSSOM style and the blocked `<style>`.
- [ ] **Step 3:** P-S8: check only that `createRequire(require.resolve("tsx/package.json")).resolve("esbuild")` resolves. No install, no scratch worktree.
- [ ] **Step 4:** P-S9 with the esbuild that tsx brings (`node -e "require(require.resolve('esbuild', { paths: [require.resolve('tsx')] }))"` from `packages/cli`). Build `/tmp/hh-pl2-spike/plugin/` twice and `cmp` the outputs.
- [ ] **Step 5:** P-S10: a small `tsx` script tries both forms and prints which worked.
- [ ] **Step 6:** Write `docs/spikes/2026-10-27-plugins-panels.md` (question, how it was checked, the result, what the plan changes). If any answer changes a later task, edit that task's file in the scratch folder and say so in your report.
- [ ] **Step 7: Commit**

```bash
git -C <worktree> add docs/spikes/2026-10-27-plugins-panels.md
git -C <worktree> commit -m "docs(spikes): plugin panels in the app window, the build and vm

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 2: SDK — `slots`, default slots, `slotFor`, and `definePlugin`

**Files:**
- Modify: `packages/harness-sdk/src/plugin.ts`, `packages/harness-sdk/src/index.ts`
- Test: `packages/harness-sdk/test/plugin-slots.test.ts`, `packages/harness-sdk/test/define-plugin.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/harness-sdk/test/plugin-slots.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_SLOTS, defineHarness, harnessSlots, parsePluginManifest, slotFor } from "../src";
import { base } from "./settings-fixtures";

const plugin = (extra: object = {}) => parsePluginManifest({ id: "p", name: "P", version: "1.0.0", api: 1, harness: "*", permissions: {}, ...extra });

describe("slots (spec §3.4, Decision 1)", () => {
  it("D0: a manifest without slots parses to the same object as before", () => {
    const h = defineHarness(base());
    expect(h).not.toHaveProperty("slots");
    expect(harnessSlots(h)).toEqual(DEFAULT_SLOTS);
  });
  it("declared slots come after the defaults; reserved ids, duplicates and bad kinds are refused", () => {
    const h = defineHarness({ ...base(), slots: [{ id: "bottom", label: "Bottom panel", kind: "panel" }, { id: "status-bar", label: "Status bar", kind: "chip" }] });
    expect(harnessSlots(h).map((s) => s.id)).toEqual(["plugins", "chips", "bottom", "status-bar"]);
    expect(() => defineHarness({ ...base(), slots: [{ id: "plugins", label: "X", kind: "panel" }] })).toThrow(/reserved/);
    expect(() => defineHarness({ ...base(), slots: [{ id: "a", label: "A", kind: "panel" }, { id: "a", label: "A", kind: "chip" }] })).toThrow(/twice/);
    expect(() => defineHarness({ ...base(), slots: [{ id: "a", label: "A", kind: "dock" }] })).toThrow();
  });
  it("a panel or chip without slot, with an unknown slot or one of the other kind falls back to the default of its kind", () => {
    const h = defineHarness({ ...base(), slots: [{ id: "bottom", label: "Bottom", kind: "panel" }, { id: "status-bar", label: "Status", kind: "chip" }] });
    expect(slotFor(h, "panel", undefined)).toBe("plugins");
    expect(slotFor(h, "panel", "bottom")).toBe("bottom");
    expect(slotFor(h, "panel", "sidebar")).toBe("plugins");
    expect(slotFor(h, "panel", "status-bar")).toBe("plugins");
    expect(slotFor(h, "chip", "status-bar")).toBe("status-bar");
    expect(slotFor(h, "chip", "bottom")).toBe("chips");
  });
  it("plugin.json panels and chips may leave out slot", () => {
    const m = plugin({ panels: [{ id: "queue", title: "Queue" }], chips: [{ id: "who" }] });
    expect(m.panels[0].slot).toBeUndefined();
    expect(m.chips[0].slot).toBeUndefined();
  });
});
```

```ts
// packages/harness-sdk/test/define-plugin.test.ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { definePlugin, parsePluginManifest, pluginJson } from "../src";

const def = () =>
  definePlugin({
    id: "oncall", name: "On-call", version: "1.0.0", harness: "*",
    permissions: { hosts: ["api.example.com"], tasks: true },
    sources: [{ id: "queues", ttl: 300 }],
    data: { queues: { key: "id", agent: "read", schema: z.object({ id: z.string(), count: z.number().int().min(0) }) } },
    panels: [{ id: "queue", title: "Queue" }],
    actions: [{ id: "triage", label: "Triage", tier: "light", scope: "none", vars: z.object({ key: z.string().max(20) }), prompt: "Triage {{key}}." }],
  });

describe("definePlugin → plugin.json (Decision 16)", () => {
  it("turns zod into allowlisted JSON Schema that parsePluginManifest accepts", () => {
    const json = pluginJson(def());
    expect(json.api).toBe(1);
    expect(json.data.queues.schema).toEqual({ type: "object", properties: { id: { type: "string" }, count: { type: "integer", minimum: 0 } }, required: ["id", "count"], additionalProperties: false });
    expect(JSON.stringify(json)).not.toContain("$schema");
    expect(() => parsePluginManifest(json)).not.toThrow();
  });
  it("a zod regex (JSON Schema `pattern`) fails with the allowlist's message (B11)", () => {
    const d = def();
    d.data.queues.schema = z.object({ id: z.string().regex(/^[A-Z]+$/) });
    expect(() => pluginJson(d)).toThrow(/"pattern" is not supported/);
  });
  it("a transform or other unrepresentable schema fails the build", () => {
    const d = def();
    d.data.queues.schema = z.object({ id: z.string().transform((s) => s.length) }) as never;
    expect(() => pluginJson(d)).toThrow();
  });
  it("output is plain data: JSON round trip is identity", () => {
    const json = pluginJson(def());
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });
});
```

- [ ] **Step 2: Run them to see them fail** — `corepack pnpm vitest run packages/harness-sdk/test/plugin-slots.test.ts packages/harness-sdk/test/define-plugin.test.ts`.

- [ ] **Step 3: Implement**

In `plugin.ts`:

```ts
export type SlotKind = "panel" | "chip";
export interface SlotDef { id: string; label: string; kind: SlotKind }
/** The core's slots (spec §3.4): a "Plugins" section in the side panel, chips next to the usage meter. Always present. */
export const DEFAULT_SLOTS: SlotDef[] = [
  { id: "plugins", label: "Plugins", kind: "panel" },
  { id: "chips", label: "Status", kind: "chip" },
];
const RESERVED_SLOTS = new Set(DEFAULT_SLOTS.map((s) => s.id));

export const harnessSlotsSchema = z
  .array(z.strictObject({ id: z.string().regex(SLOT_ID), label: z.string().min(1).max(40), kind: z.enum(["panel", "chip"]) }))
  .max(10)
  .superRefine((slots, ctx) => {
    const seen = new Set<string>();
    slots.forEach((s, i) => {
      if (RESERVED_SLOTS.has(s.id)) ctx.addIssue({ code: "custom", path: [i, "id"], message: `"${s.id}" is reserved for the core's slot` });
      if (seen.has(s.id)) ctx.addIssue({ code: "custom", path: [i, "id"], message: `"${s.id}" is declared twice` });
      seen.add(s.id);
    });
  });

/** Every slot the harness offers: the core's first, then its own. */
export const harnessSlots = (h: { slots?: SlotDef[] }): SlotDef[] => [...DEFAULT_SLOTS, ...(h.slots ?? [])];

/** Where a panel or chip goes (spec §3.4): the slot it names when the harness has it with that kind, else the core's of that kind. */
export function slotFor(h: { slots?: SlotDef[] }, kind: SlotKind, requested: string | undefined): string {
  const hit = requested === undefined ? undefined : harnessSlots(h).find((s) => s.id === requested && s.kind === kind);
  return hit ? hit.id : kind === "panel" ? "plugins" : "chips";
}
```

Make `slot` optional in `pluginManifestSchema`'s `panels` and `chips` (`slot: z.string().regex(SLOT_ID).optional()`). In `index.ts`, next to `plugins`, add the field (`/** The harness's own plugin slots (plugins spec §3.4). Absent: only the core's (D0). */ slots: harnessSlotsSchema.optional()`), and export the new names.

`definePlugin` and `pluginJson`:

```ts
type ZodObj = z.ZodObject<z.ZodRawShape>;
/** A plugin's source definition (spec §3.1): plugin.json with zod schemas where plugin.json has JSON Schemas. */
export interface PluginDefinition {
  id: string; name: string; version: string; harness: string;
  permissions?: Partial<z.input<typeof pluginManifestSchema>["permissions"]>;
  sources?: { id: string; ttl: number; workHoursOnly?: boolean }[];
  data?: Record<string, Omit<z.input<typeof pluginCollectionSchema>, "schema"> & { schema: ZodObj }>;
  panels?: { id: string; title: string; slot?: string }[];
  chips?: { id: string; slot?: string }[];
  settings?: { tab?: string; sections?: { id: string; label: string }[]; fields: Record<string, Omit<z.input<typeof settingFieldJson>, "schema"> & { schema: z.ZodType }> };
  actions?: { id: string; label: string; tier: (typeof PLUGIN_TIERS)[number]; scope?: "required" | "none"; vars?: ZodObj; prompt: string }[];
}
export const definePlugin = (d: PluginDefinition): PluginDefinition => d;

const toJson = (s: z.ZodType): Record<string, unknown> => {
  const { $schema: _s, ...rest } = z.toJSONSchema(s, { target: "draft-2020-12", unrepresentable: "throw", io: "input" }) as Record<string, unknown>;
  const why = checkSchemaSubset(rest);
  if (why) throw new Error(why);
  return rest;
};

/** plugin.json as `build` writes it (Decision 16): plain data, checked by the same parser the app uses. */
export function pluginJson(d: PluginDefinition): z.input<typeof pluginManifestSchema> {
  const raw = {
    ...d,
    api: PLUGIN_API,
    permissions: d.permissions ?? {},
    data: Object.fromEntries(Object.entries(d.data ?? {}).map(([n, c]) => [n, { ...c, schema: toJson(c.schema) }])),
    ...(d.settings ? { settings: { ...d.settings, fields: Object.fromEntries(Object.entries(d.settings.fields).map(([n, f]) => [n, { ...f, schema: toJson(f.schema) }])) } } : {}),
    actions: (d.actions ?? []).map((a) => ({ ...a, vars: a.vars ? toJson(a.vars) : { type: "object", properties: {} } })),
  };
  const json = JSON.parse(JSON.stringify(raw));
  parsePluginManifest(json);
  return json;
}
```

Adapt to what `z.toJSONSchema` really emits (spike S8 of part 1 recorded it): if it writes `additionalProperties: false` only with `io: "output"`, pick the option that keeps the test's shape, and say so. Keep `pluginCollectionSchema` and `settingFieldJson` exported **types** only if needed (`export type`), not new runtime exports.

- [ ] **Step 4: Run the tests** — PASS; also part 1's `plugin.test.ts` and `plugin-manifest.test.ts` stay green; typecheck; test.

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/harness-sdk/src/plugin.ts packages/harness-sdk/src/index.ts packages/harness-sdk/test/plugin-slots.test.ts packages/harness-sdk/test/define-plugin.test.ts
git -C <worktree> commit -m "feat(sdk): harness slots, slot fallback and definePlugin

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 3: SDK — action vars and prompts, fixtures and secret stripping

Security-critical (P6, P10, P11). Pure functions, table-tested. The shell, `check`, `record` and `test` all use them.

**Files:**
- Create: `packages/harness-sdk/src/plugin-actions.ts`, `packages/harness-sdk/src/plugin-fixtures.ts`
- Modify: `packages/harness-sdk/src/index.ts` (exports)
- Test: `packages/harness-sdk/test/plugin-actions.test.ts`, `packages/harness-sdk/test/plugin-fixtures.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/harness-sdk/test/plugin-actions.test.ts
import { describe, expect, it } from "vitest";
import { checkActionVars, fillActionPrompt, preparedTitle, promptPlaceholders } from "../src";

const action = {
  id: "triage", label: "Triage", tier: "light" as const, scope: "none" as const,
  vars: { type: "object", properties: { key: { type: "string", maxLength: 20 }, n: { type: "integer", minimum: 1 } }, required: ["key"], additionalProperties: false },
  prompt: "Triage {{key}} ({{n}}). Write nothing without asking.",
};

describe("checkActionVars (P6)", () => {
  it("accepts declared, valid vars", () => expect(checkActionVars(action, { key: "DOC-1", n: 2 })).toEqual({ ok: true, vars: { key: "DOC-1", n: 2 } }));
  it.each([
    ["missing required", { n: 1 }],
    ["unknown key", { key: "A", extra: "x" }],
    ["wrong type", { key: 5 }],
    ["schema limit", { key: "x".repeat(21) }],
    ["not an object", "DOC-1"],
    ["array", ["DOC-1"]],
    ["too large", { key: "A", n: 1, pad: "x".repeat(5000) }],
  ])("refuses %s", (_n, vars) => expect(checkActionVars(action, vars).ok).toBe(false));
  it("caps every string at 200 characters even when the schema allows more, deep", () => {
    const wide = { ...action, vars: { type: "object", properties: { key: { type: "string" }, list: { type: "array", items: { type: "string" } } }, required: ["key"] } };
    expect(checkActionVars(wide, { key: "x".repeat(201) }).ok).toBe(false);
    expect(checkActionVars(wide, { key: "a", list: ["y".repeat(201)] }).ok).toBe(false);
  });
});

describe("fillActionPrompt (P6)", () => {
  it("fills literally, in one pass", () => {
    expect(fillActionPrompt(action.prompt, { key: "{{n}}", n: 3 })).toEqual({ ok: true, text: "Triage {{n}} (3). Write nothing without asking." });
  });
  it("refuses an unfilled placeholder", () => expect(fillActionPrompt(action.prompt, { key: "A" })).toEqual({ ok: false, message: 'No value for "n"' }));
  it("objects and arrays are JSON, strings verbatim, control characters removed", () => {
    expect(fillActionPrompt("{{a}}|{{b}}", { a: ["x"], b: "l1\u0000l2\nl3" })).toEqual({ ok: true, text: '["x"]|l1l2\nl3' });
  });
  it("placeholders are listed once each, only `{{name}}` with a var-name shape", () => {
    expect(promptPlaceholders("{{a}} {{ b }} {{a}} {{secret:x}} {{c-d}}")).toEqual(["a"]);
  });
});

describe("preparedTitle (Decision 10)", () => {
  it("adds the first required short string var", () => {
    expect(preparedTitle("On-call", action, { key: "DOC-123", n: 1 })).toBe("On-call · Triage DOC-123");
    expect(preparedTitle("On-call", action, { key: "x".repeat(41) })).toBe("On-call · Triage");
  });
});
```

```ts
// packages/harness-sdk/test/plugin-fixtures.test.ts
import { describe, expect, it } from "vitest";
import { type FixtureExchange, fixtureTransport, matchFixture, parseFixture, stripSecrets } from "../src";

const fx = (url: string, text = "{}", method = "GET"): FixtureExchange => ({ kind: "fetch", request: { method, url }, response: { status: 200, headers: { "content-type": "application/json" }, text } });

describe("matchFixture (Decision 14)", () => {
  it.each([
    ["exact", "https://a.example/x/y", "https://a.example/x/y", true],
    ["* segment", "https://a.example/d/*/*", "https://a.example/d/10/27", true],
    ["* is one segment only", "https://a.example/d/*", "https://a.example/d/10/27", false],
    ["host differs", "https://a.example/x", "https://b.example/x", false],
    ["query must match", "https://a.example/x?a=1", "https://a.example/x?a=2", false],
    ["query wildcard", "https://a.example/x?*", "https://a.example/x?a=2", true],
    ["no regex from fixture text", "https://a.example/.*", "https://a.example/abc", false],
  ])("%s", (_n, fixture, url, hit) => expect(matchFixture(fx(fixture), { kind: "fetch", method: "GET", url }) ).toBe(hit));
  it("method must match", () => expect(matchFixture(fx("https://a.example/x", "{}", "POST"), { kind: "fetch", method: "GET", url: "https://a.example/x" })).toBe(false));
  it("exec: cmd and args token by token, * one token", () => {
    const e: FixtureExchange = { kind: "exec", request: { cmd: "gh", args: ["api", "*"] }, response: { code: 0, stdout: "[]", stderr: "" } };
    expect(matchFixture(e, { kind: "exec", cmd: "gh", args: ["api", "repos/x"] })).toBe(true);
    expect(matchFixture(e, { kind: "exec", cmd: "gh", args: ["api", "a", "b"] })).toBe(false);
  });
});

describe("fixtureTransport (P10)", () => {
  it("plays exchanges in order, wraps around, and refuses a request with no fixture — never the network", async () => {
    const t = fixtureTransport([fx("https://a.example/1", '"one"'), fx("https://a.example/1", '"two"')]);
    expect(await (await t.fetch("https://a.example/1")).text()).toBe('"one"');
    expect(await (await t.fetch("https://a.example/1")).text()).toBe('"two"');
    expect(await (await t.fetch("https://a.example/1")).text()).toBe('"one"');
    await expect(t.fetch("https://a.example/2")).rejects.toThrow("No fixture for GET https://a.example/2");
  });
  it("exec returns the recorded result; an unknown command is refused", async () => {
    const t = fixtureTransport([{ kind: "exec", request: { cmd: "date", args: [] }, response: { code: 0, stdout: "Mon\n", stderr: "" } }]);
    expect(await t.run("/bin/date", [], { cwd: "/x", env: {}, timeoutMs: 1000, maxBytes: 1000 })).toMatchObject({ code: 0, stdout: "Mon\n" });
    await expect(t.run("/usr/bin/id", [], { cwd: "/x", env: {}, timeoutMs: 1000, maxBytes: 1000 })).rejects.toThrow(/No fixture/);
  });
  it("parseFixture refuses unknown keys and huge texts", () => {
    expect(() => parseFixture({ ...fx("https://a.example/"), extra: 1 })).toThrow();
    expect(() => parseFixture(fx("https://a.example/", "x".repeat(10 * 1024 * 1024 + 1)))).toThrow();
  });
});

describe("stripSecrets (P11)", () => {
  const secrets = { jira: "s3cr3t+/=x" };
  it("replaces raw, URL-encoded and base64 forms anywhere in the exchange", () => {
    const out = stripSecrets(
      { kind: "fetch", request: { method: "GET", url: "https://a.example/?t=s3cr3t%2B%2F%3Dx", headers: { authorization: `Basic ${Buffer.from("me:s3cr3t+/=x").toString("base64")}`, "x-token": "s3cr3t+/=x" } }, response: { status: 200, headers: {}, text: "echo s3cr3t+/=x" } },
      secrets,
    );
    const text = JSON.stringify(out.exchange);
    expect(text).not.toContain("s3cr3t");
    expect(text).not.toContain(Buffer.from("s3cr3t+/=x").toString("base64").slice(0, 8));
    expect(out.exchange.request).toMatchObject({ headers: { "x-token": "{{secret:jira}}" } });
    expect(out.leaked).toEqual([]);
  });
  it("reports a secret it can't strip (e.g. base64 at an odd offset) so the caller writes nothing", () => {
    const odd = Buffer.from("xx" + "s3cr3t+/=x").toString("base64");
    expect(stripSecrets({ kind: "fetch", request: { method: "GET", url: "https://a.example/" }, response: { status: 200, headers: {}, text: odd } }, secrets).leaked).toEqual(["jira"]);
  });
});
```

The last test documents a limit: base64 of a secret inside a longer value at a non-multiple-of-3 offset can't be found by substring. `stripSecrets` handles that by also checking the **decoded** form of every base64-looking token of 16 or more characters (`/[A-Za-z0-9+/]{16,}={0,2}/g`); a decoded token that contains the secret makes `leaked` include the id. Note: the `odd` text is one base64 token, so `leaked` is `["jira"]`, and the caller refuses to write the file.

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: Implement**

```ts
// packages/harness-sdk/src/plugin-actions.ts
import { jsonSchemaToZod, type PluginManifest } from "./plugin";

type Action = PluginManifest["actions"][number];
export const ACTION_STRING_MAX = 200;
export const ACTION_VARS_MAX_BYTES = 4096;
const VAR = /\{\{([A-Za-z_][A-Za-z0-9_]{0,39})\}\}/g;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const longString = (v: unknown): boolean =>
  typeof v === "string" ? v.length > ACTION_STRING_MAX : Array.isArray(v) ? v.some(longString) : typeof v === "object" && v !== null ? Object.values(v).some(longString) : false;

/** The action's vars, validated (P6): an object within 4 KB of JSON, every string ≤ 200, then the action's own schema. */
export function checkActionVars(action: Pick<Action, "vars">, vars: unknown): { ok: true; vars: Record<string, unknown> } | { ok: false; message: string } {
  if (typeof vars !== "object" || vars === null || Array.isArray(vars)) return { ok: false, message: "Variables are an object" };
  const json = JSON.stringify(vars);
  if (json === undefined || new TextEncoder().encode(json).length > ACTION_VARS_MAX_BYTES) return { ok: false, message: "Variables are too large" };
  if (longString(vars)) return { ok: false, message: `A text variable is longer than ${ACTION_STRING_MAX} characters` };
  const schema = jsonSchemaToZod(action.vars);
  const strict = "strict" in schema && typeof (schema as { strict?: unknown }).strict === "function" && action.vars.additionalProperties === false ? (schema as never as { strict(): typeof schema }).strict() : schema;
  const r = strict.safeParse(vars);
  return r.success ? { ok: true, vars: r.data as Record<string, unknown> } : { ok: false, message: r.error.issues[0]?.message ?? "Invalid variables" };
}

/** `{{name}}` placeholders of a prompt, once each, in order (no secrets, no spaces). */
export function promptPlaceholders(prompt: string): string[] {
  return [...new Set([...prompt.matchAll(VAR)].map((m) => m[1]))];
}

/** The template filled literally in one pass (P6): a value is never expanded again; a placeholder with no value is refused. */
export function fillActionPrompt(prompt: string, vars: Record<string, unknown>): { ok: true; text: string } | { ok: false; message: string } {
  const missing = promptPlaceholders(prompt).find((n) => !Object.hasOwn(vars, n) || vars[n] === undefined);
  if (missing) return { ok: false, message: `No value for "${missing}"` };
  const text = prompt.replace(VAR, (_m, n: string) => {
    const v = vars[n];
    return (typeof v === "string" ? v : JSON.stringify(v)).replace(CONTROL, "");
  });
  return { ok: true, text };
}

/** "<plugin> · <label>[ <first required short string var>]" (Decision 10). */
export function preparedTitle(pluginName: string, action: Pick<Action, "label" | "vars">, vars: Record<string, unknown>): string {
  const props = (action.vars.properties ?? {}) as Record<string, { type?: unknown }>;
  const required = new Set((action.vars.required as string[] | undefined) ?? []);
  const name = Object.keys(props).find((k) => required.has(k) && props[k].type === "string" && typeof vars[k] === "string" && (vars[k] as string).length <= 40);
  return `${pluginName} · ${action.label}${name ? ` ${(vars[name] as string).replace(CONTROL, "")}` : ""}`;
}
```

(Adapt the `strict` handling to what part 1's `jsonSchemaToZod` returns for `additionalProperties: false`. The test "unknown key" must be refused either way.)

```ts
// packages/harness-sdk/src/plugin-fixtures.ts
import { z } from "zod";

const MAX_TEXT = 10 * 1024 * 1024;
const headers = z.record(z.string().max(200), z.string().max(8192));
export const fixtureSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("fetch"),
    request: z.strictObject({ method: z.string().regex(/^[A-Z]{3,7}$/), url: z.string().max(4096), headers: headers.optional(), body: z.string().max(MAX_TEXT).optional() }),
    response: z.strictObject({ status: z.number().int().min(100).max(599), headers, text: z.string().max(MAX_TEXT) }),
  }),
  z.strictObject({
    kind: z.literal("exec"),
    request: z.strictObject({ cmd: z.string().max(64), args: z.array(z.string().max(4096)).max(64) }),
    response: z.strictObject({ code: z.number().int(), stdout: z.string().max(MAX_TEXT), stderr: z.string().max(MAX_TEXT) }),
  }),
]);
export type FixtureExchange = z.infer<typeof fixtureSchema>;
export const parseFixture = (raw: unknown): FixtureExchange => fixtureSchema.parse(raw);

export type FixtureRequest = { kind: "fetch"; method: string; url: string } | { kind: "exec"; cmd: string; args: string[] };

const segmentsMatch = (want: string[], got: string[]) => want.length === got.length && want.every((w, i) => w === "*" || w === got[i]);

/** Does a recorded exchange answer this request (Decision 14)? `*` matches one path segment or one arg; no regex. */
export function matchFixture(f: FixtureExchange, r: FixtureRequest): boolean {
  if (f.kind !== r.kind) return false;
  if (f.kind === "exec" && r.kind === "exec") return f.request.cmd === r.cmd && segmentsMatch(f.request.args, r.args);
  if (f.kind !== "fetch" || r.kind !== "fetch" || f.request.method !== r.method) return false;
  const [fu, ru] = [splitUrl(f.request.url), splitUrl(r.url)];
  if (!fu || !ru || fu.origin !== ru.origin) return false;
  if (fu.query !== "?*" && fu.query !== ru.query) return false;
  return segmentsMatch(fu.path, ru.path);
}

/** Origin, path segments and raw query, without URL normalising `*` away. */
function splitUrl(raw: string): { origin: string; path: string[]; query: string } | null {
  const m = /^(https?:\/\/[^/?#]+)([^?#]*)(\?[^#]*)?/.exec(raw);
  if (!m) return null;
  return { origin: m[1].toLowerCase(), path: m[2].split("/").slice(1), query: m[3] ?? "" };
}

export interface ExecResult { code: number; stdout: string; stderr: string }
/** A transport that plays recorded exchanges and never touches the network or a process (P10). */
export function fixtureTransport(exchanges: FixtureExchange[]): {
  fetch(url: string, init?: { method?: string }): Promise<Response>;
  run(file: string, args: string[], o: { cwd: string; env: Record<string, string>; timeoutMs: number; maxBytes: number }): Promise<ExecResult>;
} {
  const used = new Set<number>();
  const take = (r: FixtureRequest) => {
    let i = exchanges.findIndex((f, n) => !used.has(n) && matchFixture(f, r));
    if (i < 0 && exchanges.some((f) => matchFixture(f, r))) {
      for (const n of [...used]) if (matchFixture(exchanges[n], r)) used.delete(n);
      i = exchanges.findIndex((f, n) => !used.has(n) && matchFixture(f, r));
    }
    if (i < 0) return null;
    used.add(i);
    return exchanges[i];
  };
  return {
    async fetch(url, init = {}) {
      const method = (init.method ?? "GET").toUpperCase();
      const f = take({ kind: "fetch", method, url });
      if (!f || f.kind !== "fetch") throw new Error(`No fixture for ${method} ${url}`);
      return new Response(f.response.text, { status: f.response.status, headers: f.response.headers });
    },
    async run(file, args) {
      const cmd = file.split(/[\\/]/).pop() ?? file;
      const f = take({ kind: "exec", cmd, args });
      if (!f || f.kind !== "exec") throw new Error(`No fixture for ${cmd} ${args.join(" ")}`);
      return { ...f.response };
    },
  };
}

const forms = (s: string) => [s, encodeURIComponent(s), Buffer.from(s).toString("base64"), Buffer.from(s).toString("base64url")].filter((f, i, a) => f.length > 0 && a.indexOf(f) === i);
const B64_TOKEN = /[A-Za-z0-9+/_-]{16,}={0,2}/g;

/** Every secret's raw, URL-encoded and base64 forms replaced by `{{secret:<id>}}` (P11); `leaked` lists ids still found. */
export function stripSecrets(exchange: FixtureExchange, secrets: Record<string, string>): { exchange: FixtureExchange; leaked: string[] } {
  let text = JSON.stringify(exchange);
  const entries = Object.entries(secrets).filter(([, v]) => v.length >= 4).sort((a, b) => b[1].length - a[1].length);
  for (const [id, value] of entries) for (const f of forms(value)) text = text.split(JSON.stringify(f).slice(1, -1)).join(`{{secret:${id}}}`);
  const decoded = [...text.matchAll(B64_TOKEN)].map((m) => { try { return Buffer.from(m[0], "base64").toString("latin1"); } catch { return ""; } });
  const leaked = entries.filter(([, v]) => text.includes(v) || decoded.some((d) => d.includes(v))).map(([id]) => id);
  return { exchange: parseFixture(JSON.parse(text)), leaked };
}
```

`Buffer` is Node-only, and `plugin-fixtures.ts` is imported by the shell's main and by the CLI, never by a backend bundle. If the SDK's main entry must stay browser-safe for `@humanharness/ui`, export these from a sub-path `@humanharness/harness-sdk/plugin-fixtures` instead of `index.ts` (check whether `ui` imports runtime values from the SDK's main entry; it does for `settingsView`, so **use the sub-path**, and add it to `package.json` `exports`).

- [ ] **Step 4: Run the tests** — PASS; typecheck; test.

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/harness-sdk/src/plugin-actions.ts packages/harness-sdk/src/plugin-fixtures.ts packages/harness-sdk/src/index.ts packages/harness-sdk/package.json packages/harness-sdk/test/plugin-actions.test.ts packages/harness-sdk/test/plugin-fixtures.test.ts
git -C <worktree> commit -m "feat(sdk): action vars and prompt fill, fixtures and secret stripping

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---
### Task 4: Workspace — the `Plugin:` history trailer

**Files:**
- Modify: `packages/workspace/src/history.ts`
- Test: `packages/workspace/test/history-trailer.test.ts` (append to the existing trailer tests if a file already covers `withTrailer`; find it with `grep -rln withTrailer packages/workspace/test`)

- [ ] **Step 1: Write the failing tests**

```ts
describe("Plugin trailer (spec §5.3, Decision 11)", () => {
  it("D0: without plugin the message is byte-identical", () => {
    expect(withTrailer("Before message", { task: "t-1", action: "a" })).toBe("Before message\n\nTask: t-1\nAction: a");
  });
  it("writes Plugin: <id> after the others and reads it back", () => {
    const msg = withTrailer("Before message", { task: "t-1", scope: "_app", plugin: "on-this-day" });
    expect(msg).toBe("Before message\n\nTask: t-1\nScope: _app\nPlugin: on-this-day");
    expect(parseCommitMessage(msg)).toMatchObject({ subject: "Before message", task: "t-1", plugin: "on-this-day" });
  });
  it("an id that isn't a plugin id is dropped", () => {
    expect(withTrailer("m", { task: "t", plugin: "Bad Id" })).toBe("m\n\nTask: t");
  });
  it("D0: an old message parses exactly as before (no plugin key)", () => {
    expect(parseCommitMessage("m\n\nTask: t\nAction: a")).toEqual({ subject: "m", task: "t", action: "a" });
  });
});
```

Also check that `HistoryEntry.plugin` reaches the history list wherever entries are built from `parseCommitMessage` (search for `parseCommitMessage(`), with a one-line test where entries are built.

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: Implement** — `HistoryTrailer.plugin?: string` ("The plugin whose prepared task this is, plugins spec §5.3; only for such tasks"). `withTrailer` pushes `Plugin: <id>` last, when `/^[a-z0-9][a-z0-9-]{0,63}$/` (the SDK's `PLUGIN_ID`; import it, since `workspace` already depends on the SDK. If not, repeat the regex with a test pinning equality). `TRAILER_LINE` gains `Plugin`. `parseCommitMessage` returns `plugin` only when present, and `HistoryEntry.plugin?` is set the same way.

- [ ] **Step 4: Run the tests** — PASS; typecheck; test.

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/workspace/src/history.ts packages/workspace/test/<the test file>
git -C <worktree> commit -m "feat(workspace): Plugin history trailer

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 5: Shell — `TaskManager.startPrepared`

A prepared task is a free question with a fixed text, a fixed tier and a plugin. It goes through the same `begin` as `askNow`, so usage, history, Stop, notes, Sidekick and checkpoints all behave as for any question.

**Files:**
- Modify: `packages/shell/src/main/task-manager.ts`, `packages/shell/src/main/task-store.ts`
- Test: `packages/shell/test/task-manager-prepared.test.ts` (build the manager the way the existing `task-manager*.test.ts` files do; reuse their helpers)

- [ ] **Step 1: Write the failing tests**

- `startPrepared({ prompt, display, tier: "light", plugin: "on-this-day" })`:
  - with no task open, a new task starts;
  - the first turn's message is the question prompt filled with `question: prompt`, the same as `ask(prompt)` would produce;
  - the chat line shows `display`;
  - `profileFor` was called with `(undefined, undefined, "light")`;
  - `current.plugin === "on-this-day"`;
  - every `saveHistory` call's trailer has `plugin: "on-this-day"`.
- A waiting task is ended `"unfinished"` first, exactly as `ask` does.
- `scope: "_app"` in a scoped harness opens `_app` first, as `ask(text, display, "_app")` would. A scope that `switchNow` refuses stops with nothing started.
- A follow-up `ask` in the prepared task keeps `plugin` in its trailers.
- **D0:** `ask`, `start` and the existing tests are unchanged. `profileFor` for an ordinary question still gets `(undefined)` (one argument, so a spy's call list is identical).
- `startPrepared` while a turn runs is refused like `ask` (same op queue).

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: Implement**

```ts
  /**
   * A plugin's prepared task, after the person pressed Start (plugins spec §5.3): a free question with this exact
   * text, at the action's tier, in `scope` (as `ask`), whose commits carry `Plugin: <id>`.
   */
  startPrepared(p: { prompt: string; display: string; tier: Tier; plugin: string; scope?: string }): Promise<void> {
    return this.op(async () => {
      if (p.scope !== undefined && !(await this.switchNow(p.scope))) return this.stopped();
      const c = await this.storedCurrent();
      if (c) await this.endTask(c.id, "unfinished");
      const language = await this.d.language();
      await this.begin(
        { ...keptQuestion(p.prompt), plugin: p.plugin },
        this.scopeFor(await this.d.store.load(), undefined),
        (notesIndex) => fillPrompt(QUESTION_PROMPT, { language, notesIndex, question: p.prompt }),
        p.display,
        undefined,
        p.tier,
      );
    });
  }
```

- `begin`'s `task` parameter gains `plugin?: string`, and a sixth parameter `tier?: Tier` is passed to `profileFor` as a third argument **only when set**:

  ```ts
  floor !== undefined ? profileFor(action, floor) : tier !== undefined ? profileFor(action, undefined, tier) : profileFor(action)
  ```

- `TaskManagerDeps.profileFor?(action, floor?, tier?)` documents the third argument as "the plugin action's tier (plugins spec §5.3): replaces the manifest tier".
- `CurrentTask` in `task-store.ts` gains `plugin?: string`. Check whether the store's zod/parse of `tasks.json` strips unknown keys; if it does, add the field to the schema.
- `trailerOf` adds `...(c.plugin ? { plugin: c.plugin } : {})`.
- `index.ts`'s `profileFor` takes the third argument and uses it as `manifestTier` when set. That is one line, done in Task 10's wiring or here if simpler; say which.

- [ ] **Step 4: Run the tests** — the new file and every `task-manager*.test.ts` PASS; typecheck; test.

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/shell/src/main/task-manager.ts packages/shell/src/main/task-store.ts packages/shell/test/task-manager-prepared.test.ts
git -C <worktree> commit -m "feat(shell): prepared tasks start as questions at the action's tier

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 6: Shell — the plugin surface in the controller: panels, chips, panel calls, prepared tasks, targets

**Files:**
- Modify: `packages/shell/src/main/plugins.ts`, `packages/ui/src/client.ts` (types appended after part 1's plugin types)
- Test: `packages/shell/test/plugins-surface.test.ts` (reuse `plugins-controller.test.ts`'s fake host and helpers; export them from a `plugins-fixtures.ts` test helper if they aren't already)

Types appended to `client.ts`:

```ts
export interface PluginPanelView { plugin: string; pluginName: string; id: string; title: string; slot: string; url: string }
export interface PluginChipView { plugin: string; pluginName: string; id: string; slot: string; text: string; severity: "info" | "warn" | "action"; panel?: string }
export interface PreparedTaskView { token: string; plugin: string; pluginName: string; title: string; prompt: string; tier: "light" | "standard" | "deep"; scope: "open" | "app"; expiresAt: string }
export interface PluginSurfaceView { panels: PluginPanelView[]; chips: PluginChipView[]; prepared?: PreparedTaskView; reloads: Record<string, number> }
export type PanelCall = "data.query" | "settings.get" | "refresh" | "requestAction";
export type PanelAnswer = { ok: true; value: unknown } | { ok: false; error: string };
export type AttentionTarget = { kind: "panel"; plugin: string; panel: string; focus?: string } | { kind: "prepared" } | { kind: "none" };
```

`resize` is handled in the renderer and never reaches main.

- [ ] **Step 1: Write the failing tests**

**Surface:**
- D0: no plugin running → `surface()` is `{ panels: [], chips: [], reloads: {} }`.
- A running plugin with panels `queue` (no slot) and `side` (slot `bottom`, which the harness declares as a panel slot), and chip `who` set by the backend, gives:
  - `panels`: `[{ id: "queue", slot: "plugins", url: "hh-plugin://oncall/panel-queue.html", … }, { id: "side", slot: "bottom", … }]`;
  - `chips`: `[{ id: "who", slot: "chips", text, severity, panel: "queue" }]`.
- An unset chip (`ctx.chip.set("who", null)`) leaves.
- Turning the plugin off removes its panels and chips, and `surfaceChanged` fires on each change.
- **P9:** chip text is stored as given (≤ 40, part 1 checks). The surface never adds markup.

**Panel calls** (`panelCall(plugin, panel, call, args)`):
- `data.query` `{ collection: "queues", where?: …, limit?: 50 }` → that plugin's records.
- **P5:**
  - another plugin's collection (`"other.results"`) or an undeclared one → `{ ok: false, error: "Unknown collection" }`;
  - a `put`/`delete` op name → refused;
  - `limit` > 500 → capped at 500;
  - an args JSON > 4 KB → refused.
- **P4:** a stopped plugin or an undeclared panel id → `{ ok: false, error: "Not running" }`.
- `settings.get` → values (and `workHours` when the plugin has a `workHoursOnly` source). With a stored secret, `JSON.stringify(answer)` doesn't contain its value (B6).
- `refresh` `{ source }` runs it once; a second call within 10 s, or while it runs, gives `{ ok: true, value: "skipped" }`. An unknown source is refused.
- An unknown call name is refused.

**Prepared tasks:**
- `requestAction` without `permissions.tasks`, or with an undeclared action → refused.
- Bad vars → `{ ok: false, error: <checkActionVars message> }` and no prepared task.
- Good vars → `surface().prepared` is `{ title: "On-call · Triage DOC-123", prompt: <filled>, tier: "light", scope: "app" }` (for `scope: "none"`), and the answer is `{ ok: true, value: "prepared" }`.
- A second `requestAction` within 2 s → `{ ok: false, error: "Too soon" }`. After 2 s it replaces the first prepared task, whose token dies.
- `takePrepared(token)`:
  - gives `{ prompt, display: title, tier, plugin, scope: "none" | "required" }` once;
  - a second take → null;
  - after 10 minutes → null (fake timers);
  - after a base change → null.
- `cancelPrepared(token)` clears it.
- **P13:** `takePrepared(...).prompt === surface().prepared.prompt` (the same string).

**Attention targets** (`attention.open(plugin, key)`):
- `{ panel: "queue", focus: "DOC-1" }` → `{ kind: "panel", plugin, panel: "queue", focus: "DOC-1" }`, and the item is read.
- `{ action: "triage", vars }` → runs the same path as `requestAction`, gives `{ kind: "prepared" }`, and `prepared` is set. Bad vars → `{ kind: "none" }` plus an error-log line.
- A plugin that is off, or a panel that is gone → `{ kind: "none" }`.

**Data pushes:** a run that wrote `queues` calls `dataChanged("oncall", ["queues"])` once at the run's end. A run that wrote nothing calls nothing.

**Reloads:** `bumpReload(id)` (used by the dev watcher, Task 9) increments `reloads[id]` and pushes.

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: Implement**
- `PluginsDeps` gains `surfaceChanged(view: PluginSurfaceView): void` and `dataChanged(plugin: string, collections: string[]): void`.
- The controller gets the harness's `slots` from `harness` (part 1's `harness` dep gains `slots?: SlotDef[]`), and resolves each panel and chip slot with `slotFor` at start.
- Methods:
  - `surface()`
  - `panelCall(plugin, panel, call, args)`
  - `requestAction(plugin, action, vars)`, used by `panelCall` and `attention.open`
  - `takePrepared(token)`
  - `cancelPrepared(token)`
  - `attention.open(plugin, key)`
  - `bumpReload(plugin)`
- Prepared tokens are 16 random bytes in hex. Keep only one prepared task. It is cleared on `rebase()` and `stop()`.
- The run wrapper (part 1) collects written collection names from the broker's data calls; `endRun` already counts writes. Extend it to return the names, or count them in the `data.run` dep.
- `panelCall` routes:
  - `data.query` → `PluginData.query` (read-only, part 1);
  - `settings.get` → the same values the broker's `settings()` dep returns;
  - `refresh` → part 1's `refresh(id, source)`, behind a per-source "last started" map;
  - `requestAction` → `requestAction`.

  Arg schemas are small zod objects. JSON size is checked before parsing.
- `attention.open` reads the item's stored target (part 1 stores `target` in `attention.json`).

- [ ] **Step 4: Run the tests** — PASS; part 1's controller tests stay green; typecheck; test.

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/shell/src/main/plugins.ts packages/ui/src/client.ts packages/shell/test/plugins-surface.test.ts
git -C <worktree> commit -m "feat(shell): plugin surface, panel calls, prepared tasks and attention targets

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 7: Shell — panel hosting: the panel-only handler, the request filter, frame navigation, the app CSP

Security-critical (P1, P2, P3, P7, P8). The pure rules live in `plugin-panels.ts` and are table-tested. `plugin-host.ts` wires them to Electron, stays thin, and the e2e covers it (Task 22).

**Files:**
- Create: `packages/shell/src/main/plugin-panels.ts`
- Modify: `packages/shell/src/main/plugin-host.ts`, `packages/shell/src/renderer/index.html`
- Test: `packages/shell/test/plugin-panels.test.ts`, `packages/shell/test/renderer-csp.test.ts`; append to `packages/shell/test/validate.test.ts` (`isAppUrl` refuses a panel URL)

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shell/test/plugin-panels.test.ts
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PANEL_CSP, allowFrameNavigation, allowPanelRequest, resolvePanelFile } from "../src/main/plugin-panels";

let dist: string;
beforeAll(async () => {
  dist = await fs.mkdtemp(path.join(os.tmpdir(), "hh-panels-"));
  for (const f of ["panel-queue.html", "panel-queue.js", "panel-queue.css", "panel-other.html", "backend.js", "plugin.json", "assets/logo.svg"]) {
    await fs.mkdir(path.dirname(path.join(dist, f)), { recursive: true });
    await fs.writeFile(path.join(dist, f), "x");
  }
});
const running = (id: string) => (id === "oncall" ? { dist, panels: ["queue"] } : null);

describe("resolvePanelFile (P7)", () => {
  it.each([
    ["hh-plugin://oncall/panel-queue.html", "panel-queue.html"],
    ["hh-plugin://oncall/panel-queue.js", "panel-queue.js"],
    ["hh-plugin://oncall/panel-queue.css", "panel-queue.css"],
    ["hh-plugin://oncall/assets/logo.svg", "assets/logo.svg"],
  ])("serves %s", async (url, file) => expect((await resolvePanelFile(url, running))?.file).toBe(path.join(dist, file)));
  it.each([
    "hh-plugin://oncall/backend.js",
    "hh-plugin://oncall/plugin.json",
    "hh-plugin://oncall/_hh/host.js",
    "hh-plugin://oncall/panel-other.html",
    "hh-plugin://oncall/panel-queue.html/..",
    "hh-plugin://oncall/..%2fpanel-queue.html",
    "hh-plugin://oncall/assets/..%2fbackend.js",
    "hh-plugin://stopped/panel-queue.html",
    "hh-plugin://oncall:1/panel-queue.html",
    "file:///etc/hosts",
  ])("refuses %s", async (url) => expect(await resolvePanelFile(url, running)).toBeNull());
});

describe("allowPanelRequest (P2)", () => {
  const app = "file:///app/out/renderer/index.html";
  it.each([
    [app, "file:///app/out/renderer/assets/x.js", true],
    ["hh-plugin://oncall/panel-queue.html", "hh-plugin://oncall/panel-queue.js", true],
    ["hh-plugin://oncall/panel-queue.html", "hh-plugin://oncall/backend.js", true], // the resolver refuses it; the filter only checks origin
    ["hh-plugin://oncall/panel-queue.html", "hh-plugin://other/panel-x.js", false],
    ["hh-plugin://oncall/panel-queue.html", "http://127.0.0.1:9/x", false],
    ["hh-plugin://oncall/panel-queue.html", "https://api.example.com/", false],
    ["hh-plugin://oncall/panel-queue.html", "data:text/html,x", false],
    ["hh-plugin://oncall/panel-queue.html", "file:///etc/hosts", false],
  ])("from %s to %s → %s", (frame, url, ok) => expect(allowPanelRequest({ frameUrl: frame, url })).toBe(ok));
  it("a request with no frame passes only if it isn't from a plugin (main-process fetches go through other sessions)", () => {
    expect(allowPanelRequest({ frameUrl: undefined, url: "https://x/" })).toBe(true);
  });
});

describe("allowFrameNavigation (P3)", () => {
  it.each([
    [true, "file:///app/index.html", "file:///app/index.html", true], // main frame: the app's own rule applies, not this one
    [false, "", "hh-plugin://oncall/panel-queue.html", true],
    [false, "about:blank", "hh-plugin://oncall/panel-queue.html", true],
    [false, "hh-plugin://oncall/panel-queue.html", "hh-plugin://oncall/panel-queue.html", true],
    [false, "hh-plugin://oncall/panel-queue.html", "hh-plugin://other/panel-x.html", false],
    [false, "hh-plugin://oncall/panel-queue.html", "http://127.0.0.1:9/nav", false],
    [false, "hh-plugin://oncall/panel-queue.html", "hh-plugin://oncall/backend.js", false],
    [false, "", "https://example.com/", false],
    [false, "", "javascript:alert(1)", false],
  ])("main=%s from %s to %s → %s", (isMain, from, to, ok) => expect(allowFrameNavigation({ isMainFrame: isMain, frameUrl: from, url: to })).toBe(ok));
});

it("the panel CSP is exactly P2's", () => {
  expect(PANEL_CSP).toBe("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'");
});
```

```ts
// packages/shell/test/renderer-csp.test.ts — P8
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

it("the app's CSP is the old one plus frame-src hh-plugin: and nothing else", () => {
  const html = readFileSync(path.join(__dirname, "../src/renderer/index.html"), "utf8");
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
  expect(csp).toBe("default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src hh-plugin:");
});
```

(If the document-reader line changed this meta in the meantime, keep its directives and only append `frame-src hh-plugin:`. Update the expected string and say so.)

`validate.test.ts`: `isAppUrl("hh-plugin://oncall/panel-queue.html", …)` is false.

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: Implement**

```ts
// packages/shell/src/main/plugin-panels.ts
import { resolvePluginFile } from "./plugin-protocol";

/** Sent as a header on every panel response (P2). No 'unsafe-inline' (spike P-S7). */
export const PANEL_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'";
const PANEL_FILE = /^panel-([a-z][a-z0-9_-]{0,39})\.(html|js|css)$/;
const ASSET = /^assets\/[A-Za-z0-9_-]{1,64}\.(svg|png)$/;

/**
 * A panel file for the app window's session (P7): only `panel-<declared>.{html,js,css}` and `assets/*.{svg,png}` of a
 * running plugin; part 1's resolver then applies every path rule (B3).
 */
export async function resolvePanelFile(
  url: string,
  running: (id: string) => { dist: string; panels: string[] } | null,
): Promise<{ file: string; type: string } | null> {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "hh-plugin:" || u.port || u.username || u.password) return null;
  const p = running(u.hostname);
  if (!p) return null;
  let rel: string;
  try { rel = decodeURIComponent(u.pathname.slice(1)); } catch { return null; }
  const m = PANEL_FILE.exec(rel);
  if (!(m && p.panels.includes(m[1])) && !ASSET.test(rel)) return null;
  return resolvePluginFile(url, { id: u.hostname, dist: p.dist, core: "/nonexistent" });
}

const hostOf = (url: string | undefined) => {
  try { const u = new URL(url ?? ""); return u.protocol === "hh-plugin:" ? u.hostname : null; } catch { return null; }
};

/** The app window's request filter (P2): a plugin frame may load only its own hh-plugin: files. */
export function allowPanelRequest(r: { frameUrl: string | undefined; url: string }): boolean {
  const from = hostOf(r.frameUrl);
  if (from === null) return true;
  return hostOf(r.url) === from;
}

/** Subframe navigation in the app window (P3): only to the frame's own panel, or the first load of a panel. */
export function allowFrameNavigation(n: { isMainFrame: boolean; frameUrl: string; url: string }): boolean {
  if (n.isMainFrame) return true;
  const to = hostOf(n.url);
  if (to === null) return false;
  let path: string;
  try { path = new URL(n.url).pathname.slice(1); } catch { return false; }
  if (!/^panel-[a-z][a-z0-9_-]{0,39}\.html$/.test(path)) return false;
  if (n.frameUrl === "" || n.frameUrl === "about:blank") return true;
  return hostOf(n.frameUrl) === to;
}
```

`resolvePluginFile` with `core: "/nonexistent"` refuses `_hh/` by construction; the explicit `PANEL_FILE`/`ASSET` check already did.

`plugin-host.ts` gains `installPanels(win, running)`, called once from `index.ts` (Task 10) when the controller exists. It does four things:
- `session.defaultSession.protocol.handle("hh-plugin", …)` → `resolvePanelFile`; a hit is served as a `Response` from the file with `Content-Type`, `Content-Security-Policy: PANEL_CSP`, `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`, and a miss is a 404 with the same CSP.
- `session.defaultSession.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, …)` → `cancel: !allowPanelRequest({ frameUrl: details.frame?.url, url: details.url })` (or what spike P-S3 recorded). **Check first** whether anything else in `index.ts` registers `onBeforeRequest` on the default session: Electron keeps only one listener. If something does, compose them in one listener and say so.
- `win.webContents.on("will-frame-navigate", (e) => { if (!allowFrameNavigation({ isMainFrame: e.isMainFrame, frameUrl: e.frame?.url ?? "", url: e.url })) e.preventDefault(); })`.
- `win.webContents.on("will-attach-webview", (e) => e.preventDefault())`, in case a panel ever gets one (it can't, without `webviewTag`; this is cheap insurance).

`index.html`: append `; frame-src hh-plugin:` to the meta CSP.

- [ ] **Step 4: Run the tests** — PASS; typecheck; test; `corepack pnpm app:build`.

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/shell/src/main/plugin-panels.ts packages/shell/src/main/plugin-host.ts packages/shell/src/renderer/index.html packages/shell/test/plugin-panels.test.ts packages/shell/test/renderer-csp.test.ts packages/shell/test/validate.test.ts
git -C <worktree> commit -m "feat(shell): panel-only plugin handler, request filter and frame guard

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 8: UI — `@humanharness/plugin-ui`: tokens, components, `usePlugin`, `mountPanel`

**Files:**
- Create: `packages/ui/src/plugin-ui/index.ts`, `packages/ui/src/plugin-ui/bridge.ts`, `packages/ui/src/plugin-ui/components.tsx`, `packages/ui/src/plugin-ui/tokens.css`, `packages/ui/src/plugin-ui/plugin-ui.css`
- Modify: `packages/ui/package.json` (`"./plugin-ui": "./src/plugin-ui/index.ts"`, `"./plugin-ui/styles.css": "./src/plugin-ui/plugin-ui.css"`)
- Test: `packages/ui/test/plugin-ui.test.tsx`, `packages/ui/test/plugin-ui-tokens.test.ts`

The panel side of Decision 7:
- `bridge.ts` is a tiny client over `window.parent.postMessage(msg, "*")` with `{ hh: 1, id, call, args }`, answers matched by `re`, a 15 s timeout per call, and events dispatched to listeners. It accepts messages only from `window.parent` (`event.source === window.parent`).
- `usePlugin()` returns:
  - `query(collection, opts)`;
  - `useQuery(collection, opts)`: a hook that re-runs on `data` events naming the collection, which is `data.subscribe` in the spec's terms;
  - `settings()`;
  - `refresh(source)`;
  - `requestAction(id, vars)`;
  - `focus`: the last `focus` event, or null;
  - `theme`: `"light" | "dark"`, from events.
- `mountPanel(Component)` renders into `#root` inside `<PluginRoot>`, which sets `data-theme` and runs a `ResizeObserver` sending `resize` with `document.documentElement.scrollHeight`.
- Components: `Table` (columns + rows; text cells only), `Chip`, `Clock` (a time in a given IANA zone), `Stat`, `Empty` and `ErrorBar`. Each is small and uses `--hh-*` tokens and the `.hhp-*` classes from `plugin-ui.css`.
- `tokens.css`: the `--hh-*` custom properties copied from `packages/ui/src/styles.css`'s `:root` and its `prefers-color-scheme: dark` block, plus `[data-theme="dark"]` and `[data-theme="light"]` overrides.

- [ ] **Step 1: Write the failing tests**
- **Tokens:** parse `styles.css` and `tokens.css` with a small regex over `--hh-[a-z0-9-]+:\s*[^;]+;`. Every token in `tokens.css` exists in `styles.css` with the same value, both light and dark.
- **Bridge** (happy-dom; stub `window.parent` with an object recording `postMessage`):
  - a call posts `{ hh: 1, id, call, args }`;
  - an answer with the right `re` **from `window.parent`** resolves it;
  - the same answer from another `source` is ignored;
  - an `ok: false` answer rejects with the error;
  - a timeout rejects after 15 s (fake timers).
- `useQuery` refetches on `{ event: "data", collections: ["queues"] }` and not on other collections.
- `focus` and `theme` events update the hook.
- `mountPanel` renders the component.
- `Table` renders `<b>x</b>` cell text as text (P9).

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement** as described. Keep `index.ts`'s imports limited to React, `./bridge`, `./components` and CSS side-effect imports that the build turns into `panel-<id>.css` (Task 15). Never import from `../client` or anything else in `@humanharness/ui` (a test greps the folder for `from "\.\./`).
- [ ] **Step 4: Run the tests** — PASS; typecheck; test.
- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/ui/src/plugin-ui packages/ui/package.json packages/ui/test/plugin-ui.test.tsx packages/ui/test/plugin-ui-tokens.test.ts
git -C <worktree> commit -m "feat(ui): plugin-ui tokens, components and the panel bridge

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---
### Task 9: Shell — fixture mode, the dev watcher, and the CLI's entry into the broker

**Files:**
- Modify: `packages/shell/src/main/plugin-broker.ts` (a per-run transport seam), `packages/shell/src/main/plugins.ts` (transport choice, fixture secrets, dev watch), `packages/shell/src/main/test-hooks.ts` (`pluginFixtures`), `packages/shell/package.json` (`"./plugins"` export)
- Create: `packages/shell/src/main/plugin-cli.ts`
- Test: `packages/shell/test/plugin-fixture-mode.test.ts`, `packages/shell/test/plugin-cli-entry.test.ts`, append to `packages/shell/test/test-hooks.test.ts`

- [ ] **Step 1: Write the failing tests**
- **Broker seam:** `BrokerDeps.transport?(source: string): { fetch: typeof fetch; run: typeof runFile }`. When set, a run's `ctx.fetch` and `ctx.exec` use the transport of **that run's source**. Every part 1 check still applies: host allowlist, https only, exec patterns, redaction. Test with a fake transport recording calls: an undeclared host is refused **before** the transport is called (B2 still holds in fixture mode).
- **Fixture mode** (`PluginsDeps.fixtures: true`):
  - a plugin whose `fixtures/queues/001.json` answers `GET https://api.example.com/q` runs on it;
  - the injected live `fetch` spy is never called (P10);
  - `secrets(ids)` returns `{ jira: "fixture-jira" }` and the `SecretStore`'s `values` is never called;
  - a source with no fixture fails its run with `No fixture for GET https://api.example.com/q` in the error log;
  - fixtures are read from the plugin's root folder (`entry.folder`, the parent of `dist/`), at most 200 files of at most 10 MB each per source, and a bad file is logged and skipped.
- **D0:** `fixtures` absent or false → the live `fetch` dep is used exactly as in part 1 (part 1's tests unchanged).
- **Dev watcher** (`PluginsDeps.watch?(dir, onChange): () => void`, injected): for each `dev`-origin plugin, a change in its `dist/` → after 300 ms debounce → `rescan()` + `host.reload(id)` + `bumpReload(id)`. Bundled and local plugins are never watched. `stop()` unwatches.
- **test-hooks:** `HH_PLUGIN_FIXTURES=1` → `hooks.pluginFixtures = true`. A packaged app ignores it, like every hook. Mock mode (`hooks.mock`) also means fixtures (index.ts passes `fixtures: hooks.mock || hooks.pluginFixtures`).
- **`plugin-cli-entry.test.ts` (P12):**
  - `import("../src/main/plugin-cli")` resolves without Electron. Read the file's import graph with a source scan: no `electron` import in `plugin-cli.ts`, `plugin-broker.ts`, `plugin-fetch.ts`, `plugin-exec.ts` or `plugin-data.ts`.
  - It exports `PluginBroker`, `pluginFetch`, `pluginExec`, `runFile` and `PluginData`.
  - No file in `packages/shell/src` imports `plugin.config` or `node:vm`.

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement**
  - The seam is a small change in `plugin-broker.ts`: wherever it calls `d.fetch` / `d.exec.run`, use `this.transportOf(runId)`, which returns `d.transport?.(source) ?? { fetch: d.fetch, run: d.exec.run }` with the run's source.
  - In the controller, build the transport once per plugin and source from `fixtureTransport(readFixtures(entry.folder, source))` (SDK sub-path from Task 3), cached until `rescan`.
  - `plugin-cli.ts` re-exports the named classes and functions. Add `"./plugins": "./src/main/plugin-cli.ts"` to `packages/shell/package.json` `exports`.
- [ ] **Step 4: Run the tests** — PASS; part 1's broker and controller tests stay green; typecheck; test.
- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/shell/src/main/plugin-broker.ts packages/shell/src/main/plugins.ts packages/shell/src/main/test-hooks.ts packages/shell/src/main/plugin-cli.ts packages/shell/package.json packages/shell/test/plugin-fixture-mode.test.ts packages/shell/test/plugin-cli-entry.test.ts packages/shell/test/test-hooks.test.ts
git -C <worktree> commit -m "feat(shell): plugins on fixtures in mock mode and dev, and the CLI's broker entry

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 10: Main wiring, IPC, preload and the client

**Files:**
- Modify: `packages/shell/src/main/plugin-ipc.ts`, `packages/shell/src/main/index.ts`, `packages/shell/src/preload/index.ts`, `packages/ui/src/client.ts` (namespace methods), `packages/ui/test/fake-client.ts`
- Test: append to `packages/shell/test/plugin-ipc.test.ts` and `packages/shell/test/ipc-surface.test.ts`

- [ ] **Step 1: Write the failing tests** (`plugin-ipc.test.ts`, same fake `handle` as part 1):
- The new channels are exactly:
  - `hh:pluginsSurface` → `surface()`;
  - `hh:pluginsPanel` `{ plugin, panel, call, args }` → `panelCall`;
  - `hh:pluginsStartPrepared` `{ token }`;
  - `hh:pluginsCancelPrepared` `{ token }`;
  - `hh:attentionOpen` `{ plugin, key }`.
- Every argument is checked with zod. `plugin` and `panel` match the SDK id regexes, `call` is one of the four, `args` is ≤ 16 KB of JSON, and `token` is 32 hex characters.
- `hh:pluginsStartPrepared` calls `controller.takePrepared(token)`, then the injected `startPrepared(p)` (index.ts gives `tasks.startPrepared` with the scope mapped: `"none"` → `APP_SCOPE` in a scoped harness, else undefined; `"required"` → undefined). A dead token answers `{ ok: false, message: "This task is no longer prepared" }` and starts nothing.
- **B9/P6:** no other channel reaches `startPrepared`. A source-scan test in `ipc-surface.test.ts` asserts that `startPrepared(` appears in `plugin-ipc.ts` only inside the `hh:pluginsStartPrepared` handler, and in `index.ts` only in the deps passed to `registerPluginsIpc`.
- `ipc-surface.test.ts` still finds every `ipcMain` use inside `handle()` or the plugin backend channel.

In `index.ts`, inside the existing plugins block (part 1 Task 16):
- call `pluginHost.installPanels(window, (id) => ctl.panelHost(id))` once the main window exists;
- pass `surfaceChanged` → `sendToWindow("hh:pluginSurface", view)`, `dataChanged` → `sendToWindow("hh:pluginData", { plugin, collections })`, `fixtures: hooks.mock || hooks.pluginFixtures`, `watch` (dev only: `fs.watch(dir, { recursive: true }, …)` when `hooks.pluginDirs` is set, else undefined) and `harness.slots`;
- `profileFor` takes the third `tier` argument (Task 5).

The controller exposes `panelHost(id) → { dist, panels } | null` for running plugins.

**D0:** with no controller, none of this runs. Part 1's D0 test (`AppState` has no `plugins`, no handler registered) is extended: no `installPanels` call, so no default-session handler, no `webRequest` listener and no `will-frame-navigate` listener. Assert it in `plugin-ipc.test.ts` with the deps fake, plus an `index.ts` source check that `installPanels` sits inside the `if (pluginsCtl)` block.

Preload: `plugins.surface()`, `plugins.panel(...)`, `plugins.startPrepared(token)`, `plugins.cancelPrepared(token)`, `attention.open(plugin, key)`, and the pushes `onSurface`, `onPluginData`. Client types follow the existing namespace style. FakeClient: `surfaceView` (settable, default `{ panels: [], chips: [], reloads: {} }`), `panelAnswers` (a function the test sets), a recorded `pluginCalls`, and `emitSurface` and `emitPluginData` helpers.

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests** — PASS; typecheck; test; `corepack pnpm app:build`.
- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/shell/src/main/plugin-ipc.ts packages/shell/src/main/index.ts packages/shell/src/preload/index.ts packages/ui/src/client.ts packages/ui/test/fake-client.ts packages/shell/test/plugin-ipc.test.ts packages/shell/test/ipc-surface.test.ts
git -C <worktree> commit -m "feat(shell): wire panels, prepared tasks and attention targets

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 11: UI — `PanelFrame`: the iframe and its bridge

Security-critical (P3, P4). The app-side counterpart of Task 8's bridge.

**Files:**
- Create: `packages/ui/src/plugins/PanelFrame.tsx`
- Test: `packages/ui/test/panel-frame.test.tsx`

```tsx
export function PanelFrame(props: {
  client: HarnessClient;
  panel: PluginPanelView;
  /** Sent to the panel as a `focus` event once it loaded (an attention item opened it). */
  focus?: string;
  /** Bumped by the dev watcher: remounts the frame. */
  reload: number;
}): JSX.Element;
```

Behaviour:
- Renders `<iframe sandbox="allow-scripts" src={panel.url} title={`${panel.title} · ${panel.pluginName}`} referrerPolicy="no-referrer" allow="" loading="lazy" style={{ height }} />`. **Never** `allow-same-origin`, `allow-popups`, `allow-forms`, `allow-top-navigation*`, `allow-modals` or `allow-downloads`. The `sandbox` value is a constant, and a test pins it.
- A `message` listener on `window` accepts only `event.source === ref.current?.contentWindow` (and `event.origin === "null"`) and `data.hh === 1`. The message is at most 64 KB (`JSON.stringify(data).length`), with a 20 calls/s token bucket and at most 8 in flight. `resize` sets the height clamped to 120–800. Other calls go to `client.plugins.panel({ plugin: panel.plugin, panel: panel.id, call, args })` — **plugin and panel from props only** — and the answer is posted back with `contentWindow.postMessage({ hh: 1, re: id, ...answer }, "*")`.
- Pushes:
  - `client.plugins.onPluginData` for this plugin → post `{ hh: 1, event: "data", collections }`;
  - `matchMedia("(prefers-color-scheme: dark)")` → post `{ event: "theme", dark }` on load and on change;
  - `focus` → post `{ event: "focus", focus }` after the first load and whenever the prop changes.
- **P3:** count `load` events. A second `load` means the panel navigated itself (only within its own panel; main refuses the rest). Set `src` again to `panel.url`, drop in-flight answers, and ignore messages until the next load.
- Unmount removes listeners. Answers for an unmounted frame are dropped.

- [ ] **Step 1: Write the failing tests** (happy-dom; fake client):
- The rendered iframe's `sandbox` attribute is exactly `allow-scripts`, and `src` is `panel.url`.
- **P4:**
  - a `MessageEvent` with `source` = another window object (or `null`) → no client call;
  - a message from the frame's own `contentWindow` with a forged `plugin: "other"` field → the client call uses `panel.plugin`;
  - a non-`hh: 1` message → ignored;
  - a message over 64 KB → ignored.
- Rate: 25 calls in one tick → 20 reach the client, and 5 are answered `{ ok: false, error: "Too many calls" }`.
- `resize` 5000 → height 800; `resize` 10 → 120; `resize` never reaches the client.
- `onPluginData` for another plugin → no post; for this plugin → `data` event posted.
- **P3:** fire `load` twice → `src` is reset and a message between the second load and the next one is ignored.
- `focus` is posted after load.

(happy-dom's iframes may not have a real `contentWindow`. If so, give the component a `frameWindow` test seam, a prop defaulting to `ref.current?.contentWindow`, and say so.)

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests** — PASS; typecheck; test.
- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/ui/src/plugins/PanelFrame.tsx packages/ui/test/panel-frame.test.tsx
git -C <worktree> commit -m "feat(ui): the plugin panel frame and its message bridge

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 12: UI — slots on screen: the Plugins section, `<PluginSlot>` and chips

**Files:**
- Create: `packages/ui/src/plugins/surface.ts` (`usePluginSurface(client, enabled)`, `PluginSurfaceContext`), `packages/ui/src/plugins/PluginsSection.tsx`, `packages/ui/src/plugins/PluginSlot.tsx`, `packages/ui/src/plugins/PluginChips.tsx`
- Modify: `packages/ui/src/FlowSide.tsx` (an optional `plugins?: ReactNode` prop, rendered after `material`), `packages/ui/src/ChatView.tsx`, `packages/ui/src/index.ts` (`export { PluginSlot }`), `packages/ui/src/styles.css` (inside part 1's `/* Plugins */` block), `packages/i18n/src/locales/en.json` (`plugins.panels.*`, `plugins.chips.*`)
- Test: `packages/ui/test/plugin-slots.test.tsx`

Behaviour:
- `usePluginSurface` loads `client.plugins.surface()` when `state.plugins` is present and follows `onSurface` pushes. Without `state.plugins` it never calls the client (D0).
- `ChatView` provides `PluginSurfaceContext` with `{ surface, client, open(plugin, panel, focus?) }`. `open` selects that panel's tab in the Plugins section, or for a harness slot sets the "focused" panel that `<PluginSlot>` shows. It also scrolls the panel into view and passes `focus` to its `PanelFrame`.
- `PluginsSection`: the panels whose `slot === "plugins"`, as tabs (`role="tablist"`, each tab "<title>" with the plugin name in `title`), then the active tab's `PanelFrame`. It renders nothing when there are no such panels. It goes into `FlowSide` through the new prop; without `flow`, it is wrapped in its own `<nav className="hh-flow-side" aria-label={t("plugins.panels.section")}>`, as the material is. When both material and plugins exist without flow, both go in one nav: material first.
- `<PluginSlot id>`, exported for harness UIs, reads the context. For a panel slot it renders that slot's panels stacked, each in a `PanelFrame` with a small header "<title> · <plugin name>". For a chip slot it renders `PluginChips` filtered to that slot. Outside ChatView, or without a surface, it renders null.
- `PluginChips` sit in the `TopBar` right after `UsageMeter` (slot `chips`). Each chip is a `<button>` when `chip.panel` is set (click → `open(plugin, panel)`), else a `<span>`. The class follows severity (`hh-pl-chip info|warn|action`), the text is plain React text (P9), and `title` is `"<plugin name>: <text>"`.
- Narrow: the Plugins section hides with the flow side (existing CSS); chips stay.

- [ ] **Step 1: Write the failing tests**
- **D0:**
  - a FakeClient without `state.plugins` renders ChatView with no `.hh-pl-chip`, no Plugins section and no iframe;
  - `surface()` is never called;
  - `FlowSide` without the `plugins` prop renders exactly as before (snapshot of the existing FlowSide test markup, or the existing tests unchanged).
- With `state.plugins` and an empty surface, nothing new renders.
- Two panels in `plugins` → two tabs; switching shows the other `PanelFrame` (iframe `src` changes). One panel in `bottom` → not in the section.
- A harness `renderSide` that returns `<PluginSlot id="bottom" />` shows that panel.
- A chip with `panel` → a button; clicking selects that panel's tab. A chip with `<img src=x onerror=…>` text renders as text (P9).
- `emitSurface` with `reloads: { oncall: 1 }` remounts the frames of `oncall` (`key` includes the reload count).

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** en.json keys go inside `"plugins"` only: `panels.section` "Plugins", `panels.tabs` "Plugin panels", `chips.open` "Open {{name}}".
- [ ] **Step 4: Run the tests** — PASS; every existing UI test unchanged; typecheck; test; `app:build`.
- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/ui/src/plugins/surface.ts packages/ui/src/plugins/PluginsSection.tsx packages/ui/src/plugins/PluginSlot.tsx packages/ui/src/plugins/PluginChips.tsx packages/ui/src/FlowSide.tsx packages/ui/src/ChatView.tsx packages/ui/src/index.ts packages/ui/src/styles.css packages/i18n/src/locales/en.json packages/ui/test/plugin-slots.test.tsx
git -C <worktree> commit -m "feat(ui): plugin slots, the Plugins section and chips

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

(Stage only your hunks of `ChatView.tsx`, `styles.css` and `en.json` with `git add -p` if they carry anyone else's changes.)

---

### Task 13: UI — the prepared-task card and attention targets

**Files:**
- Create: `packages/ui/src/plugins/PreparedTask.tsx`
- Modify: `packages/ui/src/ChatView.tsx` (the card above the composer), `packages/ui/src/plugins/AttentionInbox.tsx` (an item with a target opens it), `packages/i18n/src/locales/en.json` (`plugins.prepared.*`)
- Test: `packages/ui/test/prepared-task.test.tsx`, append to `packages/ui/test/attention-inbox.test.tsx`

Behaviour:
- When `surface.prepared` is set, a card (`role="region"`, `aria-label` "Prepared task") sits above the composer. It shows:
  - the title;
  - "Proposed by <plugin name>";
  - the full prompt in a scrollable `<pre>` (plain text, P9/P13);
  - the tier label (the existing tier labels from the Models tab's keys);
  - **Start** and **Cancel**.
- Start is disabled while `blocked()` (a turn runs, closing, etc.). It is also disabled when `prepared.scope === "open"` in a harness with scopes and no scope is open, with the hint "Open a {{scope}} first".
- Start → `client.plugins.startPrepared(token)`; a failure shows the message inline. Cancel → `client.plugins.cancelPrepared(token)`.
- The card leaves when the surface push clears `prepared`, which main does on take or cancel.
- AttentionInbox: an item with `hasTarget` shows as a button ("Open"). Clicking it calls `client.attention.open(plugin, key)`:
  - `{ kind: "panel" }` → the context's `open(plugin, panel, focus)`, then close the inbox;
  - `{ kind: "prepared" }` → close the inbox, and the card appears through the push;
  - `{ kind: "none" }` → "This item can't be opened any more" inline.

  Part 1's mark-read on click stays for items without a target.

- [ ] **Step 1: Write the failing tests**
- D0: no `prepared` → no card; ChatView's composer area is unchanged.
- The card shows exactly `prepared.prompt` (a prompt with `<b>` renders as text).
- Start calls `startPrepared(token)` once; a double click calls it once (disabled while pending).
- Start is disabled while `blocked`, and while scope is required and none is open.
- Cancel calls `cancelPrepared`.
- **P6:** nothing calls `startPrepared` without a click. Assert that a surface push with `prepared` makes no client call.
- Inbox: a panel target opens the panel tab and passes `focus` to the frame (the `PanelFrame` gets the `focus` prop); a prepared target closes the inbox; `none` shows the message.

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** en.json inside `"plugins"`:
  - `prepared.region`: "Prepared task"
  - `prepared.by`: "Proposed by {{name}}"
  - `prepared.start`: "Start"
  - `prepared.cancel`: "Cancel"
  - `prepared.needScope`: "Open a {{scope}} first"
  - `prepared.tier`: "Model tier: {{tier}}"
  - `attention.open`: "Open"
  - `attention.gone`: "This item can't be opened any more"
- [ ] **Step 4: Run the tests** — PASS; typecheck; test; `app:build`.
- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/ui/src/plugins/PreparedTask.tsx packages/ui/src/ChatView.tsx packages/ui/src/plugins/AttentionInbox.tsx packages/i18n/src/locales/en.json packages/ui/test/prepared-task.test.tsx packages/ui/test/attention-inbox.test.tsx
git -C <worktree> commit -m "feat(ui): the prepared-task card and attention targets

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---
### Task 14: CLI — the `/new-plugin` guide and its install helpers

**Files:**
- Create: `packages/cli/guide/new-plugin.md`
- Modify: `packages/cli/src/guide.ts` (`PLUGIN_GUIDE_START`, `PLUGIN_GUIDE_END`, `pluginSkillFile`, `pluginAgentsFile`, `pluginGuideSection`), `packages/cli/src/paths.ts` (`pluginGuideFileOf`, `pluginTemplateDirOf`)
- Test: append to `packages/cli/test/guide.test.ts`

The guide (spec §9.4) is engine-agnostic. It works one question at a time and is written to the agent. It has seven phases:

| Phase | What the guide asks and writes |
|---|---|
| 1. Purpose | What should the person see without asking? Writes `PLUGIN.md` Purpose. |
| 2. Sources and credentials | One source at a time: host or command, auth, TTL, work hours. Writes the Sources table, `permissions`, and `backend.ts`'s source stub. Never asks for a key's value: "the person pastes keys in Settings › Plugins". |
| 3. Data | Collections, keys, `agent: "read"` or not, `context`. Writes `plugin.config.ts` `data` and Decision log lines. |
| 4. Rules and attention | What raises what, at which severity, and the `key` for dedupe. Writes Rules and the backend's `attention.raise` calls. |
| 5. Panel and chip | What the panel shows, with which plugin-ui components; the chip text. Writes `panels/*.tsx` and Panels. |
| 6. Actions | Which agent tasks the person can start, their vars and the prompt template. Writes Actions. |
| 7. Verify | Cannot be skipped: `humanharness plugin record <source>` for each source (the person types keys in the terminal), `check` with no errors, `test`, then `dev --harness <dir>` showing the panel. The guide stops at the first failure and fixes it. |

Each phase ends by updating its `PLUGIN.md` section and the code together. On an existing plugin the guide starts by reading `PLUGIN.md` and asks what to change ("add regressions to the panel"). It also states the security rules the author can't bend:
- no direct `fetch`;
- every host and command declared;
- keys only through `{{secret:<id>}}` in headers or body;
- actions never write without asking.

- [ ] **Step 1: Write the failing tests**
- `pluginSkillFile(guide)` starts with front matter `name: new-plugin` and a description that mentions `/new-plugin` and `PLUGIN.md`.
- `pluginAgentsFile(id, guide)` puts the guide between the plugin markers.
- `pluginGuideSection` reads it back.
- **D0:** `skillFile`, `agentsFile` and `guideSection` give byte-identical output for the harness guide (snapshot of today's output taken before the change).
- The guide file exists and has the 7 phase headings in order (`## 1. Purpose` … `## 7. Verify`). It contains no path under `~/.claude` or `~/.codex` and no instruction to read engine config.

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests** — PASS; typecheck; test.
- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/cli/guide/new-plugin.md packages/cli/src/guide.ts packages/cli/src/paths.ts packages/cli/test/guide.test.ts
git -C <worktree> commit -m "feat(cli): the new-plugin guide

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 15: CLI — the `plugin` command group and `build`

**No install.** Leave `package.json` and the lockfile alone. Resolve esbuild through tsx (`createRequire(require.resolve("tsx/package.json")).resolve("esbuild")`) and react/react-dom from the workspace as they resolve today.

**Files:**
- Create: `packages/cli/src/plugin.ts` (the group: `plugin <sub>` dispatch and usage), `packages/cli/src/plugin-build.ts`
- Modify: `packages/cli/src/main.ts` (`plugin: pluginCommand`, and the USAGE lines), `packages/cli/package.json`, `pnpm-lock.yaml` (only what the offline install writes)
- Test: `packages/cli/test/plugin-build.test.ts`, append to `packages/cli/test/main.test.ts`

```ts
// packages/cli/src/plugin-build.ts
export interface BuildResult { dist: string; files: string[]; manifest: PluginManifest }
/** `humanharness plugin build` (spec §3.1, Decision 17): plugin.config.ts → plugin.json, backend.ts → backend.js, panels → html/js/css. */
export async function buildPlugin(dir: string, o?: { out?: string }): Promise<BuildResult>;
```

Steps of `buildPlugin`:
1. Bundle `plugin.config.ts` to `<os.tmpdir()>/hh-plugin-config-<random>.mjs` (`platform: "node"`, `format: "esm"`, the aliases below plus `zod` → the SDK's zod). Then `import()` it, take `default`, and remove the temp file in `finally`. The result must be a `definePlugin` result. Then `pluginJson(def)`.
2. Check that `backend.ts` exists and that each declared panel has `panels/<id>.tsx`. A missing file → `CliError("panels/queue.tsx is missing")`.
3. Remove `dist/`, then write:
   - `plugin.json` (2-space JSON, keys in a fixed order);
   - `backend.js`: entry `backend.ts`, `format: "esm"`, `platform: "browser"`;
   - per panel, `panel-<id>.js` from a generated entry `import { mountPanel } from "@humanharness/plugin-ui"; import "@humanharness/plugin-ui/styles.css"; import Panel from "<abs>/panels/<id>.tsx"; mountPanel(Panel);`, with `jsx: "automatic"`. esbuild emits `panel-<id>.css` next to it from the CSS imports;
   - `panel-<id>.html` (Decision 6);
   - `assets/` copied when present (only `.svg`/`.png`; anything else → `CliError`).
4. Aliases: `@humanharness/plugin-ui` → `require.resolve("@humanharness/ui/plugin-ui")`; `@humanharness/plugin-ui/styles.css` → its CSS; `@humanharness/harness-sdk/plugin-backend` → the SDK's file; `react`, `react-dom/client`, `react/jsx-runtime` → the CLI's copies (`createRequire(import.meta.url).resolve(...)`). The CLI's `react` is a devDependency today, so move `react` and `react-dom` to `dependencies` at the versions already in its devDependencies. That needs no new download, but it is a `package.json` change: include it in the offline install.
5. Common options: `bundle: true`, `minify: false`, `legalComments: "none"`, `charset: "utf8"`, `target: "chrome130"`, `logLevel: "silent"`, `write: true`, `absWorkingDir: dir`, `metafile: false`.

- [ ] **Step 1: Write the failing tests** (they use a temp copy of a minimal plugin written by the test: `plugin.config.ts`, `backend.ts`, `panels/main.tsx`):
- `buildPlugin` writes exactly `plugin.json`, `backend.js`, `panel-main.html`, `panel-main.js` and `panel-main.css`.
- `plugin.json` parses with `parsePluginManifest`.
- `backend.js` has a default export (import it in the test with a data URL or a temp file).
- `panel-main.html` equals Decision 6's string.
- **Deterministic:** two builds give byte-identical files.
- A stale file in `dist/` before the build is gone after it.
- The temp config file is gone after it.
- A config with `z.string().regex()` fails with the allowlist message, and `dist/` is left untouched: build into a temp folder and swap only on success.
- The plugin folder has **no** `node_modules` and the build still works (P-S9).
- `main.test.ts`: `humanharness plugin` with no sub prints the plugin usage and exits 2. `humanharness plugin build --help` prints the build usage. `USAGE` has the new `plugin` lines and every old line is unchanged (D0 for the harness commands).

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests** — PASS; typecheck; test.
- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/cli/src/plugin.ts packages/cli/src/plugin-build.ts packages/cli/src/main.ts packages/cli/package.json pnpm-lock.yaml packages/cli/test/plugin-build.test.ts packages/cli/test/main.test.ts
git -C <worktree> commit -m "feat(cli): plugin command group and build

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 16: CLI — `check` and `PLUGIN.md`

**Files:**
- Create: `packages/cli/src/plugin-check.ts`, `packages/cli/src/plugin-md.ts`
- Test: `packages/cli/test/plugin-check.test.ts`, `packages/cli/test/plugin-md.test.ts`

```ts
export type PluginRule =
  | "schema" | "api-version" | "host-undeclared" | "exec-undeclared" | "secret-undeclared" | "slot-unknown" | "fixtures-missing"
  | "plugin-md-mismatch" | "prompt-placeholder"
  | "exec-wide" | "exec-writes" | "hosts-wildcard" | "sync-heavy" | "host-local";
export interface PluginFinding { rule: PluginRule; severity: "error" | "warning"; message: string; file?: string }
export async function checkPlugin(dir: string, o?: { harness?: string; build?: boolean }): Promise<{ manifest: PluginManifest | null; findings: PluginFinding[] }>;
```

- `humanharness plugin check [--json] [--harness <dir>] [--no-build]` prints the findings in the same format as the harness `check` (`formatFindings`-style), or JSON. Errors exit 1.
- The rules follow Decisions 18–19:
  - `exec-writes` fires on `-X`/`--method`/`--request` followed by any token other than `GET`/`HEAD`, or on an arg among `POST`, `PUT`, `PATCH`, `DELETE`, `delete`, `rm`, `create`, `edit`, `merge`, `close`, case-insensitive;
  - `hosts-wildcard` fires on `*.<one label>`;
  - `host-local` fires on `localhost` or IPv4/IPv6 literals;
  - `slot-unknown` (only with `--harness`) fires on a panel or chip `slot` that is in neither the harness's slots (`loadHarness(dir).slots`) nor the defaults;
  - `api-version` fires when `plugin.json` `api !== PLUGIN_API`.
- `plugin-md.ts`: `parsePluginMd(text)` → `{ sections, sources: { id, ttl }[], permissions: { hosts, exec, keys, tasks } }`, reusing `harness-md.ts`'s helpers. TTL cells accept `300`, `300 s`, `5 min`, `6 h`.

- [ ] **Step 1: Write the failing tests** — one fixture plugin per rule, written by the test into temp folders: a clean template-like plugin first (no findings), then one mutation per rule, each asserting exactly that rule. Also:
- a literal `"https://api.example.com/x"` in `backend.ts` with the host declared → no finding, and with `*.example.com` declared → no finding (use part 1's `hostAllowed`);
- `exec("gh", …)` with `gh` declared → none;
- `{{secret:jira}}` with `jira` declared → none;
- `--json` prints parseable JSON with `findings`;
- `PLUGIN.md` with an extra source row → `plugin-md-mismatch`, naming the row.

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests** — PASS; typecheck; test.
- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/cli/src/plugin-check.ts packages/cli/src/plugin-md.ts packages/cli/src/plugin.ts packages/cli/test/plugin-check.test.ts packages/cli/test/plugin-md.test.ts
git -C <worktree> commit -m "feat(cli): plugin check and the PLUGIN.md parser

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 17: CLI — `test`: the backend in Node's `vm` on fixtures

**Files:**
- Create: `packages/cli/src/plugin-run.ts` (shared by `test` and `record`: load a built backend into a `vm` context, build the broker and run a source), `packages/cli/src/plugin-test.ts`
- Test: `packages/cli/test/plugin-test.test.ts`

`plugin-run.ts`:

```ts
export interface RunOptions {
  dir: string;                    // the plugin root (dist/ inside)
  source: string;
  transport: { fetch: typeof fetch; run: typeof runFile };
  secrets(ids: string[]): Promise<Record<string, string>>;
  now?: Date;
  runLimitMs?: number;            // default 120_000, like the app
}
export interface RunReport { source: string; ok: boolean; error?: string; writes: Record<string, { count: number; keys: string[] }>; attention: { key: string; severity: string; title: string }[]; chips: Record<string, string>; log: string[] }
export async function runSource(o: RunOptions): Promise<RunReport>;
```

- It builds a part 1 `PluginBroker` (from `@humanharness/shell/plugins`) with:
  - `data` → a `PluginData` in a temp folder, removed after;
  - `settings()` → the defaults from `pluginSettings(manifest)`;
  - `attention` and `chips` → in-memory recorders;
  - `log` → `RunReport.log`;
  - `fetch` and `exec.run` from `transport`;
  - `exec.resolve` → `resolveBinary` (or for fixtures, the bare name);
  - `exec.env` → `{ PATH, HOME, LANG, TERM: "dumb" }`.
- It loads `dist/backend.js` the way spike P-S10 settled (an ESM `SourceTextModule` or the IIFE form), in a fresh `vm.createContext({ console: <recorder>, setTimeout, clearTimeout, URL, TextEncoder, TextDecoder, structuredClone })` with no `process`, `require`, `fetch` or `Buffer` in the context. Being explicit about the context keeps the plugin's view the same as in the app. **It is not a sandbox (P12).**
- `ctx` is the same proxy shape as part 1's host script, calling `broker.call(runId, name, args)` directly. Reuse the host script's ctx builder: extract it to a function both `plugin-host.mjs` and `plugin-run.ts` can import? The host script is a resource file loaded in the sandbox and can't import from the CLI. **Keep two copies, and add a test that compares their method lists.**
- `humanharness plugin test [--source <id>] [--now <iso>] [--json]` runs every source (or one) with `fixtureTransport(readFixtures(dir, source))` and `secrets` → `fixture-<id>`. It prints the report and exits 1 if any source fails. The first line of output, once per run, is `Note: plugin code runs in this Node process, not in the app's sandbox. Run only plugins you trust.` (P12).

- [ ] **Step 1: Write the failing tests** (a test plugin built with `buildPlugin` into a temp folder, with fixtures):
- `test` on good fixtures prints `queues: 3 records (a, b, c)`, one attention item and one chip, and exits 0.
- A missing fixture → that source fails with `No fixture for GET …` and exit 1.
- The backend tries `globalThis.fetch` → undefined in the context (`typeof fetch === "undefined"`), and the report logs it if the plugin does.
- The P12 note is printed.
- The live `fetch` is never called (spy on `globalThis.fetch`).
- `--json` output parses.
- Method lists of the two ctx builders match.

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests** — PASS; typecheck; test.
- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/cli/src/plugin-run.ts packages/cli/src/plugin-test.ts packages/cli/src/plugin.ts packages/cli/test/plugin-test.test.ts
git -C <worktree> commit -m "feat(cli): plugin test on fixtures

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 18: CLI — `record`: one real sync, keys asked in the terminal and stripped

Security-critical (P11).

**Files:**
- Create: `packages/cli/src/plugin-record.ts`
- Test: `packages/cli/test/plugin-record.test.ts`

`humanharness plugin record <source> [--yes]`:
1. Build first, unless `--no-build`.
2. For each secret **the source's code references**, ask in the terminal: `<label> (<help>): `, with echo off. Use a `readSecret(question)` dep; the default uses `readline` with `output.mute`, or `stdin.setRawMode`. Non-TTY input with secrets declared → `CliError("record asks for keys in a terminal")`. Keys are held in a local `Map` and never written or logged.
3. Run `runSource` with a **recording live transport**: it wraps global `fetch` and `runFile`, and pushes each request (after the broker's substitution) and response into `exchanges`. The broker's own checks still apply: an undeclared host is refused before the transport.
4. For each exchange, `stripSecrets(exchange, keys)`. If any `leaked` → write nothing, print `A key could not be removed from the recording of <method> <url>; nothing was written.` and exit 1.
5. Delete the source's old fixtures (ask unless `--yes`), and write `fixtures/<source>/001.json`… (2-space JSON).
6. Print the files written, plus the P12 note.

- [ ] **Step 1: Write the failing tests** (deps injected: `fetch` replaced by a local fake that echoes the request's headers in its body; `readSecret` returns `"tok-123+/="`):
- The written files contain `{{secret:jira}}` in the request header and in the echoed response body, and **no** form of `tok-123+/=` (raw, URL-encoded, base64): `grep` every file.
- A fake server echoing the key base64-encoded at an odd offset → exit 1, and no file written.
- Non-TTY with secrets → `CliError`.
- `--yes` skips the delete question. Without it, "n" keeps the old fixtures and writes nothing.
- An undeclared host is refused by the broker, so the transport is never called.
- The key never appears in stdout or stderr.
- After `record`, `test` on the new fixtures passes (round trip).

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests** — PASS; typecheck; test.
- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/cli/src/plugin-record.ts packages/cli/src/plugin.ts packages/cli/test/plugin-record.test.ts
git -C <worktree> commit -m "feat(cli): plugin record with keys stripped from fixtures

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 19: CLI — `init` and the plugin template

**Files:**
- Create: `packages/cli/src/plugin-init.ts`, `packages/cli/plugin-template/**` (Decision 24)
- Test: `packages/cli/test/plugin-init.test.ts`

`humanharness plugin init <dir> [--harness <id>] [--name <name>]`:
- refuses an existing non-empty folder;
- copies the template, replacing `__ID__` (the folder's base name, which must match `PLUGIN_ID`, else a `UsageError` suggesting `--name`), `__NAME__` and `__HARNESS__` (default `*`);
- installs the guide (`.claude/skills/new-plugin/SKILL.md` and `AGENTS.md` with markers, Task 14);
- prints the next steps (`/new-plugin`, `humanharness plugin dev --harness <dir>`).

There is no `pnpm install`: the plugin builds through the CLI's own copies.

Template contents:
- `plugin.config.ts` with `definePlugin`:
  - source `items` (ttl 900);
  - collection `items` (`key: "id"`, `agent: "read"`, `{ id, title }`);
  - panel `main`;
  - chip `count`;
  - action `summarize` (light, `scope: "none"`, vars `{ id: string }`, prompt `"Summarize item {{id}} in two sentences."`);
  - `permissions: { hosts: ["api.example.com"], tasks: true }`.
- `backend.ts`: fetches `https://api.example.com/items`, `replaceAll`s the collection, and sets the chip.
- `panels/main.tsx`: a `Table` with `useQuery("items")` and a Summarize button per row.
- `fixtures/items/001.json`: 3 items.
- `PLUGIN.md`: every section filled to match.
- `tsconfig.json`, `README.md` and `.gitignore` (none for `dist/`: a plugin commits its `dist/`, since that is what the app loads).

- [ ] **Step 1: Write the failing tests**
- `init` into a temp folder, then `buildPlugin`, `checkPlugin` (no findings at all) and the `test` command (exit 0, `items: 3 records`).
- The installed SKILL.md and AGENTS.md hold the guide.
- An existing non-empty folder → refused.
- An invalid folder name without `--name` → `UsageError`.
- No file in the template contains a real token-looking string (`/[A-Za-z0-9]{32,}/`).

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests** — PASS; typecheck; test.
- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/cli/src/plugin-init.ts packages/cli/src/plugin.ts packages/cli/plugin-template packages/cli/test/plugin-init.test.ts
git -C <worktree> commit -m "feat(cli): plugin init and the plugin template

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 20: CLI — `dev`

**Files:**
- Create: `packages/cli/src/plugin-dev.ts`
- Modify: `packages/cli/src/dev.ts` (an `env?: Record<string, string>` option passed through to the spawned process; default none, D0)
- Test: `packages/cli/test/plugin-dev.test.ts`, append to `packages/cli/test/dev.test.ts`

`humanharness plugin dev --harness <dir> [--live] [--mock]`:
1. `buildPlugin` and `checkPlugin`. Errors stop it, as harness `dev` does.
2. Call `devCommand({ harnessDir, mock, env: { HH_PLUGIN_DIRS: <abs plugin dir>, ...(live ? {} : { HH_PLUGIN_FIXTURES: "1" }) }, … })`.
3. Watch the plugin folder recursively, ignoring `dist/`, `fixtures/`, `node_modules/` and dot-folders. On change, debounce 300 ms, then rebuild. A failed rebuild prints the error and keeps the old `dist/`, because the build swaps only on success (Task 15). The app's dev watcher (Task 9) reloads.
4. `--live` prints `Live: this plugin will reach <hosts> with your keys from Settings › Plugins.`

- [ ] **Step 1: Write the failing tests** (spawn and watch injected):
- The spawned env has `HH_PLUGIN_DIRS` and `HH_PLUGIN_FIXTURES=1`; with `--live`, no `HH_PLUGIN_FIXTURES`.
- `devCommand` without `env` spawns exactly the same env as before (D0; extend the existing dev test).
- A watched change triggers one rebuild after 300 ms, and a change inside `dist/` triggers none.
- A check error stops before spawning.

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests** — PASS; typecheck; test.
- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/cli/src/plugin-dev.ts packages/cli/src/dev.ts packages/cli/src/plugin.ts packages/cli/test/plugin-dev.test.ts packages/cli/test/dev.test.ts
git -C <worktree> commit -m "feat(cli): plugin dev with fixtures by default

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---
### Task 21: Demo — the `on-this-day` plugin

**Files:**
- Create: `harnesses/demo/plugins/on-this-day/{plugin.config.ts,backend.ts,panels/events.tsx,PLUGIN.md,README.md,tsconfig.json}`, `harnesses/demo/plugins/on-this-day/fixtures/events/001.json`, and `harnesses/demo/plugins/on-this-day/dist/**`, built with `humanharness plugin build` and committed
- Modify: `harnesses/demo/harness.config.ts` (`plugins: { bundled: ["on-this-day"], local: true }`)
- Test: `harnesses/demo/test/on-this-day.test.ts`

Implement Decision 25:
- **Backend:** `events` reads `count` from settings and builds the URL from `new Date()` in the person's local date (`MM`/`DD`, zero-padded). It fetches with `Api-User-Agent`, maps `selected[]` to `{ id: "<year>-<n>", year, text, page? }` (the first page's `content_urls.desktop.page` when it is an `https://` URL on `wikipedia.org`, else none), `replaceAll`s the collection and sets the chip.
- **Attention:** for each round anniversary, raise `round-<year>`: severity `info`, title `"<n> years ago today"`, body = the first 200 characters of the text, target `{ panel: "events", focus: id }`. Then resolve the `round-*` keys of earlier days. That needs the plugin to remember them: keep them in a single collection `seen` (`agent: "none"`), or derive them from today's list and resolve every key not in it. **Pick the second**: no extra collection.
- **Panel:** `useQuery("events")`; a `Table` (Year, Event), with the focused row highlighted and scrolled into view from `usePlugin().focus`; an "Explain" button per row calling `requestAction("explain", { year, text: text.slice(0, 200) })`; `Empty` when there is no data; `ErrorBar` from a settings-free status. The `page` link is shown as plain text, not as an anchor: a panel can't open URLs, and window opening is denied anyway.
- **Fixtures:** one file with `url: "https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/selected/*/*"` and a `selected` array of 25 synthetic events, years 1901–1925, text `"Sample event for the demo (fixture), <year>."`.
- **`PLUGIN.md`:** all sections filled, permissions `- Host: api.wikimedia.org — Wikimedia's public On this day feed (no key)` and `- Tasks — "Explain this event" proposes a light question`.

- [ ] **Step 1: Write the failing tests** (`harnesses/demo/test/on-this-day.test.ts`):
- `checkPlugin` on the folder has no errors and no warnings.
- **Committed `dist/` is fresh:** `buildPlugin(dir, { out: tmp })` gives files byte-identical to the committed `dist/`. This catches a source change without a rebuild.
- `runSource` on fixtures with `now` = 2026-10-27 writes 25 records (the `count` default) and raises exactly one `round-1901` item (2026 − 1901 = 125). It does the same for any `now`: loop over 2026–2050, asserting exactly one round item each year.
- The chip text is `"125-year anniversary today"` for 2026.
- The demo manifest parses and `pluginsAccepted` is true. `plugins.on` is empty (the plugin starts off).

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement**, then run `corepack pnpm --filter @humanharness/cli exec humanharness plugin build` in the plugin folder (or the CLI's bin with `--` arguments) and commit `dist/`.
- [ ] **Step 4: Run the tests** — PASS; typecheck; test; `app:build`.
- [ ] **Step 5: Commit**

```bash
git -C <worktree> add harnesses/demo/plugins/on-this-day harnesses/demo/harness.config.ts harnesses/demo/test/on-this-day.test.ts
git -C <worktree> commit -m "feat(demo): the On this day plugin on fixtures

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 22: E2E — the demo plugin, the prepared task, the panel probe, D0

**Files:**
- Create: `packages/e2e/tests/plugins-surface.spec.ts`; `packages/e2e/fixtures/plugins/probe/dist/panel-probe.{html,js,css}` (hand-written), and an edit to probe's `plugin.json` adding the panel `probe`. The panel writes its results into its own DOM, and the e2e reads them with `frameLocator` (Playwright reaches into cross-origin frames). The panel gets no extra API for tests.
- Modify: `packages/e2e/tests/plugins.spec.ts` (part 1) only if a shared helper moves

Run with `HH_PLUGIN_FIXTURES=1` and the existing fake-claude setup. A local HTTP server on `127.0.0.1:0` counts hits for every probe.

Scenarios:
1. **D0** (a harness without `plugins`: use the e2e harness that part 1's D0 scenario uses):
   - no `iframe` in the page;
   - no `.hh-pl-chip`;
   - no "Plugins" section;
   - no prepared card;
   - `app.evaluate` shows `session.defaultSession.protocol.isProtocolHandled("hh-plugin")` is false.
2. **Demo, plugin off:**
   - Settings › Plugins lists "On this day" as bundled and off;
   - no iframe, no chip;
   - the local server and the fixture files: no backend window (`BrowserWindow.getAllWindows().length === 1`).
3. **Turn on → review → on:**
   - the review lists "Connects to: api.wikimedia.org · Can propose agent tasks";
   - after "Turn on", within a few seconds:
     - the Plugins section shows a tab "On this day";
     - the iframe (via `frameLocator`) shows 25 rows;
     - the chip "<n>-year anniversary today" is in the top bar;
     - the Attention badge stays 0, since the round item is `info` and the badge counts `action` only;
     - the inbox lists "<n> years ago today".
4. **Attention target:** clicking the item's "Open" selects the panel tab, and the row with that year is highlighted inside the frame.
5. **Action → prepared → Start:**
   - "Explain" on a row → the prepared card shows "On this day · Explain this event", the full prompt with the year and text, and "light";
   - **nothing has run**: the fake engine's log has no new turn;
   - Cancel → the card leaves;
   - "Explain" again → Start → the chat shows the card's title as the first line;
   - the fake engine's received prompt contains the card's prompt (P13);
   - after the task's turn, `git log -1 --format=%B` in the work folder has `Plugin: on-this-day`.
6. **Panel probe** (the `probe` fixture plugin, added from folder as in part 1). `panel-probe.js` (hand-written, no React) runs these attempts on load and writes each outcome (`blocked`/`reached`) into a `<li data-probe="<name>">`:
   - `typeof window.hh`, `typeof require`, `typeof process`;
   - `window.parent.document` (expect a throw), `window.parent.hh` (a throw);
   - `fetch`/XHR/WebSocket/EventSource/`sendBeacon` to the server;
   - `<img>`, `<script src>`, `import()`, `new Worker`, `<link rel=prefetch>` to the server;
   - `window.open(server)`, `document.forms` submit to the server;
   - `fetch("hh-plugin://probe/backend.js")` and `fetch("hh-plugin://other/panel-x.js")`;
   - last, `location.href = server + "/nav"`.

   The e2e waits for every `li`, expects them all `blocked`, then expects the server's hit count to be **0** after 2 s. It expects the panel to be reloaded on its own URL after the navigation attempt (P3): the `li` list reappears.
7. **Mock mode** (`HH_TEST_MOCK=1`, demo, plugin turned on): the panel fills from fixtures and the server sees nothing. (Mock mode uses fixtures even without `HH_PLUGIN_FIXTURES`.)

- [ ] **Step 1: Write the spec and the probe panel.**
- [ ] **Step 2: Run** `corepack pnpm app:build` then `corepack pnpm e2e -- plugins-surface` — every scenario passes; then the full `corepack pnpm e2e`.
- [ ] **Step 3: Commit**

```bash
git -C <worktree> add packages/e2e/tests/plugins-surface.spec.ts packages/e2e/fixtures/plugins/probe
git -C <worktree> commit -m "test(e2e): plugin panels, chips, prepared tasks and the panel sandbox

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 23: Docs — part 2 in the architecture pages

**Files:**
- Modify: `docs/architecture/plugins.md`, `docs/architecture/mock-mode.md`, `docs/architecture/authoring.md`, `docs/architecture/manifest.md`, `docs/superpowers/specs/2026-10-27-plugins-design.md` (status line only: "Implemented: plans 1 and 2")

What each page gains:
- **`plugins.md`:**
  - slots and their fallback;
  - panel hosting (the panel-only handler, the CSP, the frame guard, the request filter, the app's `frame-src` change);
  - the panel protocol and its limits;
  - chips;
  - actions and prepared tasks (the vars rules, the template fill, Start only by click, the trailer);
  - attention targets;
  - fixture mode;
  - the threat model's P rows next to part 1's B rows;
  - "Known gaps", extended with part 2's out-of-reach list;
  - "Where to look", extended.
- **`mock-mode.md`:** Decision 26's paragraph.
- **`authoring.md`:** a "Plugins" section on the `plugin` commands, `PLUGIN.md`, the guide, and the vm note (P12).
- **`manifest.md`:** `slots` and `plugins` with an example.

- [ ] **Step 1:** Write the pages. Keep them in the existing pages' style, in English.
- [ ] **Step 2:** `corepack pnpm typecheck` and `corepack pnpm test` (no code change; a sanity run).
- [ ] **Step 3: Commit**

```bash
git -C <worktree> add docs/architecture/plugins.md docs/architecture/mock-mode.md docs/architecture/authoring.md docs/architecture/manifest.md docs/superpowers/specs/2026-10-27-plugins-design.md
git -C <worktree> commit -m "docs: plugins part 2 — panels, actions, authoring

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

## Self-review: spec coverage

| Spec | Task |
|---|---|
| §3.1 source and build (`dist/` only; the app never runs `plugin.config.ts`) | Tasks 2, 15; P12 scan (Task 9) |
| §3.4 `slots`, default slots, fallback | Tasks 2, 12 |
| §5.1 panels: sandboxed iframe, same CSP, plugin-ui, theme, panel API (`data.query`/`subscribe`, `settings.get`, `refresh`, `requestAction`, `focus`), no fetch/exec | Tasks 6, 7, 8, 11, 12 |
| §5.2 chips; a click opens the first panel | Tasks 6, 12 |
| §5.3 actions → prepared task, vars validated, 200-char cap, scope, ordinary task after Start, `Plugin:` trailer, `tasks: true` only | Tasks 3, 4, 5, 6, 13 |
| §6 targets `{ panel, focus }` / `{ action, vars }` | Tasks 6, 13 |
| §9.1 CLI `init`, `build`, `check`, `record`, `test`, `dev` | Tasks 15–20 |
| §9.2 `check` rules | Task 16 |
| §9.3 `PLUGIN.md` | Tasks 16, 19, 21 |
| §9.4 guide, installed as skill + AGENTS markers | Tasks 14, 19 |
| §10.1 demo plugin (1 source 6 h, `agent: "read"`, 1 panel default slot, 1 chip, 1 `info` item, 1 action) on fixtures in mock and e2e | Tasks 9, 21, 22 |
| §10.2 unit: CLI `check`, `record` (secrets stripped), `test`; manifest `slots` | Tasks 2, 16, 17, 18 |
| §10.2 e2e: panel on fixtures, chip, attention, action → prepared → Start on fake engine, direct fetch from panel and backend fails by CSP | Task 22 (the backend half is part 1's Task 19) |
| §11 out of scope (marketplace, in-app create, C6, plugin MCP, PTY) | Not built; `plugins.md` lists them |

## Open questions (each with the default this plan takes)

1. **The app's CSP gains `frame-src hh-plugin:` for everyone**, even harnesses without plugins. The meta is static, and nothing loads without a registered handler. *Default: yes, a one-directive change, pinned by a test. The alternative is serving the renderer through a protocol so the CSP can be a per-harness header, which is much larger.*
2. **No `'unsafe-inline'` styles in panels.** *Default: none; `build` emits a CSS file and React styles go through the CSSOM (spike P-S7). If the spike says CSSOM is blocked, panels get `style-src 'self' 'unsafe-inline'`, and the plan asks again.*
3. **esbuild becomes a direct dependency of the CLI** (the version already in the lockfile, installed offline), and `react`/`react-dom` move from the CLI's devDependencies to dependencies. *Default: yes. Fallback without any install: resolve esbuild through tsx.*
4. **The demo plugin's fixtures are hand-made**, with synthetic events, because `record` needs the network and the tests may not use it. *Default: synthetic fixtures labelled as such. Marco can run `humanharness plugin record events` once to get real ones; the "exactly one round anniversary per year" test would then need adjusting.*
5. **The demo plugin starts off**, so a normal demo run never reaches Wikimedia until the person turns it on. *Default: off (`plugins.on` empty). The spec doesn't say.*
6. **Round anniversary = a multiple of 25 years.** *Default: 25 (deterministic: one per year in the fixtures).*
7. **The prepared task's title** adds the first required short string var. *Default: as in Decision 10; the demo's title has no var: "On this day · Explain this event".*
8. **`scope: "required"` with no scope open**: Start is disabled with a hint. *Default: as stated. A harness without scopes treats both values the same.*
9. **The default slots' places**: the Plugins section in the left panel, chips after the usage meter. *Default: as stated; the spec says "core sidebar" and "next to the usage meter".*
10. **One prepared task at a time**, and `requestAction` at most every 2 s per plugin. *Default: as stated; a newer request replaces the card.*
11. **`record` and `test` run plugin code in Node's `vm`, not a sandbox.** The spec allows it for `test`; `record` also does it, because it needs real network through the broker. *Default: both, with a printed note. Alternative: run `record` inside the app's sandbox via `dev --live` + a "Record" button, which is much larger.*
12. **`check` scans source text with fixed regexes** (`host-undeclared`, `exec-undeclared`, `secret-undeclared`). A URL built from parts isn't seen. *Default: as stated; the runtime broker is the real enforcement.*
13. **A harness slot nobody mounts** shows nothing, and `check` can't know. *Default: documented only.*
14. **`plugin dev` reloads** a panel by remounting its frame and restarting the backend on every `dist/` change. *Default: as stated; no state is kept across reloads.*
