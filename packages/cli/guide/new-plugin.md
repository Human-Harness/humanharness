# /new-plugin: build this plugin step by step

You are helping a developer build a Human Harness plugin: a feature that brings outside data into a harness app. A plugin has **sources** that fetch data on a schedule (an API over https, or a command on the person's computer), **collections** it keeps that data in, items it raises in the app's **Attention inbox**, a **panel** and **chips** the app shows, and **actions**: agent tasks it can propose, which the person starts with a click.

The app treats plugin code as hostile, because it is expected to be AI-written code nobody read. The backend runs in a hidden, sandboxed window with no Node and no network of its own; everything it does goes through the app's broker, which allows only what `plugin.json` declares and the person approved. A panel runs in a sandboxed frame with no network at all. Write the plugin so it works inside those walls, never around them.

## How to work

- Ask **one question at a time**, in the developer's language, and wait for the answer. Offer a suggested answer when it helps.
- Write every file in English: code, labels, titles, prompts and `PLUGIN.md`.
- Read `PLUGIN.md` first: it is this plugin's living decision log. On an existing plugin, start from it and ask what the developer wants to change ("add regressions to the panel"), then go only through the phases that change touches. Never ask again what it already answers; offer to revisit it instead. Right after `humanharness plugin init`, `PLUGIN.md` holds only the template's example: treat the plugin as new and start at phase 1.
- Each phase ends with two things done together: its `PLUGIN.md` section updated, and the code changed to match. Add a dated entry to **Decision log** for each decision: the decision, the reason, the alternatives rejected.
- After each phase, run `humanharness plugin check` and fix every error it reports.
- When the developer is unsure, write the question in the Decision log as open and move on.

## Where things are

- `plugin.config.ts`: the manifest, `definePlugin({...})` with zod schemas, both imported as `import { definePlugin, z } from "@humanharness/harness-sdk";`. `humanharness plugin build` turns it into `dist/plugin.json` (plain data; zod becomes JSON Schema). The app never runs `plugin.config.ts`.
- `backend.ts`: the sources, `export default definePluginBackend({ sources: { <id>: async (ctx) => { … } } })`, imported from `@humanharness/harness-sdk/plugin-backend`. Built to `dist/backend.js`.
- `panels/<id>.tsx`: one React component per panel (its default export), built with `@humanharness/plugin-ui` to `dist/panel-<id>.html`, `.js` and `.css`. Optional images go in `assets/` (`.svg` and `.png` only).
- `fixtures/<source>/001.json`, `002.json`…: recorded exchanges, one request and its response per file, played in file-name order.
- `PLUGIN.md`: the decision log. `check` compares its Sources table and its permission lines with the manifest.
- `dist/`: what the app loads. `build` writes it fresh every time; never edit it by hand. Commit it with the sources.
- `humanharness` is the Human Harness CLI; `<core>` below is the core checkout it runs from. `<core>/docs/architecture/plugins.md` explains the runtime, the broker and every limit. `<core>/harnesses/demo/plugins/on-this-day` is a complete example (a source, a collection, a panel, a chip, an attention rule and an action). Read it for ideas; never copy it as a starting point.

## Rules you can't bend

- Never call `fetch`, `XMLHttpRequest` or any network API directly, in the backend or in a panel. The backend uses `ctx.fetch`; a panel has no network at all and reads what the backend stored.
- Declare every host the backend reaches (`permissions.hosts`) and every command it runs (`permissions.exec`). The broker refuses anything else.
- Keys only through `{{secret:<id>}}` in a request's header values or body, with `<id>` declared in `permissions.secrets`. Never in a URL, never in a command, never in code, fixtures or `PLUGIN.md`. Never ask the developer or the person for a key's value: the person pastes keys in Settings › Plugins, and types them into the terminal for `record`.
- Actions never write without asking: an action's prompt asks the agent to propose, and to change nothing outside the app without the person's yes.
- Never edit files outside this plugin's folder. Stay out of the AI engines' own folders in the home directory (`.claude`, `.codex`, `.gemini`, and OpenCode's under `.config` and `.local/share`), and never touch credentials or their environment variables.
- No provider or model brands (Claude, Anthropic, Codex, OpenAI, ChatGPT, GPT, Gemini, Google, Kimi, Moonshot, Qwen, Alibaba) in the plugin's name.

## 1. Purpose

Fills: PLUGIN.md → Purpose

Ask what the person should see **without asking for it**, and in which harness. Insist on something concrete ("who is on call this week, and the tickets waiting for them", "today's events in history"). If the answer is "a way to ask about X", ask what the person sees before they ask.

Write two or three sentences: who it is for, what they see, and what it saves them. Set `name` (at most 60 characters), `version` (semver, required; start at `0.1.0`) and `harness` in `plugin.config.ts`: the id of the harness it is built for, or `"*"` for any. The `id` is the folder's name (`^[a-z0-9][a-z0-9-]{0,63}$`).

Display text (the name, labels, titles, help) can't hold control, bidi, zero-width or other hidden characters. That includes the variation selector inside many emoji (❤️), so keep emoji out of display text.

## 2. Sources and credentials

Fills: PLUGIN.md → Sources, Permissions

One source at a time. For each, ask:

- **where the data comes from**: an https API (which host) or a command on the person's computer (which one, with which arguments);
- **how it signs in**: no key, or a key the person creates (an API token). Never ask for a key's value. Declare the key in `permissions.secrets` (`{ id, label, help }`, where `help` says where the person gets it) and use it as `{{secret:<id>}}` in a header or the body. The person pastes it in Settings › Plugins;
- **how often** it syncs: `ttl` in seconds, from 10 seconds to 7 days. Under 60 seconds `check` warns (`sync-heavy`); ask whether the data really changes that fast;
- whether it runs **only during work hours** (`workHoursOnly: true`; the person sets the hours in Settings › Plugins).

Then write:

- `sources` in `plugin.config.ts` (at most 10; ids `^[a-z][a-z0-9_-]{0,39}$`);
- `permissions.hosts`: exact host names (`api.example.com`) or a wildcard over one label or more (`*.example.com`). A wildcard over a top-level name alone (`*.com`) is refused. Only https: the broker refuses `http:`, `localhost` and IP addresses even if declared, so a plugin can't reach a service on the person's own machine; `check` warns on `localhost` and IP addresses (`host-local`), declared or in a URL in the code, and on an `http://` URL in the code (`http-url`);
- `permissions.exec`: `{ cmd, args }`, a bare command name and its arguments token by token, with `*` only as the last token (one or more remaining arguments). Pin read-only forms (`["api", "--method", "GET", "*"]`): `check` warns on a command that is only `*` after its name (`exec-wide`) and on one that may write (`exec-writes`). Commands run without a shell, with stdin closed, in an empty folder, with only `PATH`, `HOME`, `LANG` and `TERM`;
- the source's function in `backend.ts`, with `ctx.fetch(url, { method, headers, body })` or `ctx.exec(cmd, args)`. A response has `status`, `ok`, `headers`, `text()` and `json()`. Requests time out after 30 seconds and responses stop at 10 MB; a whole run stops after 2 minutes. A failed run keeps the last data and retries with backoff;
- the Sources table (TTL as `900`, `900 s`, `15 min` or `6 h`) and one permission line per host, command and key, each with its reason; `check` reports `plugin-md-mismatch` when they aren't exactly what `plugin.config.ts` declares:

  | Source | Brings | TTL |
  |---|---|---|

  `- Host: <pattern> — <reason>`, `- Runs: <cmd> <args…> — <reason>`, `- Key: <id> — <reason>`.

Keys are filled in exactly as the person stored them. A service that wants Basic auth (the base64 of `email:token`) needs the person to paste that encoded value as the key: say so in the key's `help`. The broker removes key values from what a response gives back, and drops key headers when a redirect leaves the host.

Keep `backend.ts` free of top-level `await`: `build` refuses it. Do the work inside the source functions.

## 3. Data

Fills: PLUGIN.md → Sources, Decision log

Ask what each source keeps, and what the agent should know. For each collection in `data` (at most 10):

- its zod schema (`z.object`) and its `key` field, or `single: true` for one record;
- whether the agent may read it: `agent: "read"` (it reads it as `<plugin id>.<collection>`, read-only, while the plugin is on) or `"none"`. Fetched data is outside data, so read it as a prompt-injection channel: give the agent only what its tasks need;
- `context`: which fields go into a new task's first message and in how many tokens (`{ fields: "all" | [...], tokens: 50–4000 }`), or `false`.

Collections are always app-wide (sources run outside any scope) and never `agent: "write"`. The schemas must be plain data: `.regex()` and string formats (`z.email()`, `z.url()`, `z.uuid()`, `z.iso.date()`) become `pattern` or `format`, which `plugin.json` refuses, and so do transforms and recursive schemas. Check values in the backend instead. Limits: 2,000 records and 2 MB per collection, 64 KB per record.

In `backend.ts`, write with `ctx.data.put`, `patch`, `delete` or `replaceAll` (a whole sync usually replaces the collection), and read with `get` and `query` (it returns `{ records, total }`, at most 1,000 records).

If the person should set something (how many items, a project key, a threshold), declare it in `settings.fields`: a zod `schema`, a `default`, a `control` (`segmented`, `select`, `toggle`, `number`, `text`), a `label`, and optionally an `agent` sentence in English with `{{value}}`, which the agent reads while the plugin is on. The backend reads the values with `ctx.settings.get()`. Settings never hold keys.

Write a Decision log line per collection: what it holds and why the agent may or may not read it.

## 4. Rules and attention

Fills: PLUGIN.md → Rules

Ask what should catch the person's eye, and how urgently. For each rule: what raises it, its severity (`info`, `warn` or `action`; only unread `action` items count on the badge, and only those can notify), its title (at most 120 characters) and body (at most 500), and its `key`.

- The `key` (`^[A-Za-z0-9:._-]{1,80}$`) makes an item unique: raising the same key again updates it. Derive it from what the item is about (`breach:DOC-123`), never from the time.
- A dismissed item raised again stays hidden until its severity or title changes.
- Call `ctx.attention.resolve(key)` when the condition is over.
- A `target` makes the item open something: `{ panel, focus }` opens the plugin's panel and hands it `focus` (a record's key, say), or `{ action, vars }` opens a prepared task (phase 6). The panel or action must be the plugin's own.

Write the rules in `backend.ts` with `ctx.attention.raise({ key, severity, title, body, target })`, and one line per rule in the Rules section.

## 5. Panel and chip

Fills: PLUGIN.md → Panels

Ask what the panel shows at a glance, and what the chip says in a few words.

**The panel** (at most 5 per plugin; `title` at most 40 characters) is a React component in `panels/<id>.tsx`, its default export, built with `@humanharness/plugin-ui`:

- `usePlugin()` gives `query(collection, { where, fields, limit })` (at most 500 records), `settings()` (values only), `refresh(source)` (runs a source now; `"skipped"` while it runs or within 10 seconds of the last run), `requestAction(id, vars)`, `focus` (what an attention item asked it to show) and `theme`.
- `useQuery(collection)` reads a collection and reads it again whenever a sync writes it.
- Components: `Table` (text cells, an optional button per row, an `empty` text), `Chip`, `Clock`, `Stat`, `Empty`, `ErrorBar`. They follow the app's colours, light and dark.
- A panel reads only its own collections and never writes data. It has no network, no storage, no pop-ups, no forms and no navigation: leaving its page reloads it, and a panel that does so more than 3 times in a minute is stopped. Calls are limited (20 a second, 8 waiting at once).
- Styles: import a `.css` file (built into `panel-<id>.css`) or use React's `style` prop. A `<style>` element, a `style` attribute in markup or a CSS-in-JS library that injects either is blocked. No top-level `await`: panels build as classic scripts.
- Its height follows its content, from 120 to 800 pixels.

The panel goes in the harness's Plugins section unless `slot` names a panel slot the harness declares. A slot the harness doesn't have falls back to the Plugins section; a harness slot shows only where the harness's side panel draws it.

**The chip** (at most 5) is text the app draws: `ctx.chip.set(id, { text, severity })` from the backend (at most 40 characters), `ctx.chip.clear(id)` to hide it. A click opens the plugin's first panel. Like panels, `slot` is optional; the default is next to the usage meter.

Write each panel and chip in the Panels section: what it shows and why.

## 6. Actions

Fills: PLUGIN.md → Actions, Permissions

Ask which agent tasks the person may start from the plugin ("explain this event", "triage this ticket"). An action never starts by itself: `requestAction(id, vars)` from a panel, or an attention item's `{ action, vars }` target, opens a **prepared task** the app draws (the title, the full prompt, the tier), and only the person's Start runs it. Cancel drops it. One waits at a time, for 10 minutes; a plugin can ask at most once every 2 seconds.

For each action (at most 20):

- `label` (at most 60 characters); the card's title is `<plugin name> · <label>`, followed by the first required string var when it is 40 characters or less;
- `tier`: `light`, `standard` or `deep`, the smallest that does the job;
- `scope`: `"required"` (the default: it runs in the scope the person has open, and can't start without one) or `"none"` (app-wide). In a harness without scopes the two are the same;
- `vars`: a zod object of the variables, plain data as in phase 3. Each string is at most 200 characters and all vars together at most 4 KB;
- `prompt` (at most 4,000 characters): a template with `{{name}}` for each var, filled once, literally. Use every required var, and only declared ones (`check` reports `prompt-placeholder`). Say in the prompt what the agent may do, and that it writes nothing outside the app without asking.

Actions need `permissions.tasks: true`. Write each action in the Actions section and the line `- Tasks — <reason>` under Permissions.

## 7. Verify

Fills: PLUGIN.md → Decision log

This phase can't be skipped. Stop at the first failure, fix it, and run that step again.

1. For each source, ask the developer to run `humanharness plugin record <source>` in their own terminal. It builds the plugin, runs one real sync, asks for the source's keys there with the input hidden, and writes `fixtures/<source>/`, with every key replaced by `{{secret:<id>}}`. Never run it with a key yourself and never ask for the key. If the developer can't reach the service yet, write the fixtures by hand in the same format (`{ "kind": "fetch", "request": { "method", "url" }, "response": { "status", "headers", "text" } }`, where a `*` path segment matches any one segment and a `?*` query any query; for a command, `{ "kind": "exec", "request": { "cmd", "args" }, "response": { "code", "stdout", "stderr" } }`, where a `*` arg matches any one arg). Then Verify is **not finished**: write an open item in the Decision log ("fixtures made by hand; run `record` for <source>"), and at handover tell the developer the plugin hasn't touched the real service yet and that `record` must run before it is done.
2. Run `humanharness plugin check` (it builds first; add `--harness <harness folder>` when a panel or chip names a slot, so it can check the slot exists) and fix every error. Go through the warnings with the developer: fix each one, or record in the Decision log why it stays.
3. Run `humanharness plugin test`. It runs every source on its fixtures, with no network and no keys, and prints the records written, the attention items and the chips. Read them with the developer.
4. Open the harness with the plugin: `humanharness plugin dev --harness <harness folder>`. It runs on the fixtures and rebuilds on every change. Check with the developer that the panel shows the data, the chip reads right, an attention item opens its target, and an action's prepared task shows the prompt they expect. Only with the developer's yes, add `--live` to use the real network and the keys stored in Settings › Plugins.

`record` and `test` run the plugin's code in this Node process, not in the app's sandbox: run only plugins you trust. While `record` runs, that code can read the keys typed for it. Before handing over, check that `PLUGIN.md` matches the code and that `dist/` was built from the current sources.
