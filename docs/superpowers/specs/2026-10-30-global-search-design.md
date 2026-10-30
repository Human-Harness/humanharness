# Global search (⌘K) — design

Status: draft, decisions D1–D8 taken with Marco on 2026-10-30 (brainstorming, one question at a time). Waiting for the section-by-section review of the written spec. Not in the roadmap yet.

One place to find anything in a harness: a task, a note, a file, a setting or an action. The person presses ⌘K (Ctrl+K off macOS), types, and opens the result with Enter, or turns the query into a question for the AI with ⌘Enter. Search is deterministic: no AI, no tokens, nothing leaves the machine.

Mockup (look and copy): "Search (⌘K)" in the UI refresh canvas, https://claude.ai/artifact/6WpeDVxxusFqaU6rJRH2RS (`project/Search.dc.html`).

## 1. Why

- Finding something today means knowing where it lives: the History panel for past tasks, the notes panel for notes, the person's file manager for files, and Settings for a setting. Nothing searches across them, and nothing searches the reference folders at all.
- The mockups for the UI refresh add a search button to the top bar. This spec defines what that button opens. The top bar's layout belongs to the UI refresh spec; here we only rely on a button that calls `client.search.open()`.

## 2. Decisions (Marco, 2026-10-30)

- **D1. Files are indexed by name and text.** Every file is indexed by its name and path. A text file's contents are indexed too (`.md`, `.txt`, code, CSV, JSON… anything that is not binary), up to 1 MB per file. This covers the person's folder and the manifest's reference folders.
- **D2. Scope: the open scope plus the app by default.** In a harness with scopes, search looks in the open scope and the app-wide items. An "All scopes" filter widens it, and a result from another scope shows that scope's name. This matches what a task's first message gets: the scope's notes index plus the app-wide one.
- **D3. ⌘Enter prepares a question; it never sends one.** It opens a free question with the query in the composer, plus up to three of the top results as hints (paths and note titles, not their text). No tokens are spent until the person sends it, the same rule as a plugin's prepared task.
- **D4. Data collections are opt-in, harness and plugin alike.** A collection appears in search only when it declares `search: { title, text? }`. A plugin never runs code to answer a search: the core indexes the fields the collection declares.
- **D5. Privacy: a fixed deny list, plus `.gitignore`, plus a content check.** See §8. Keys never enter the index: connection and plugin keys live outside the folder, in `safeStorage`, and the indexer never opens that store.
- **D6. The AI does not use the index in v1.** The index is a main-process service with one query interface. A later ContextPolicy variant (retrieval) or a tool can use it without changing this spec. `AGENTS.md` and the MCP tool lists stay unchanged.
- **D7. Engine: `minisearch`, persisted.** It is pure JS under the MIT license and already a dependency of `material`. Using SQLite FTS5 would mean a native module, and native packaging waits for plan 4b. Searching live with ripgrep can't search chats, settings and data the same way.
- **D8. Built lazily, the first time ⌘K opens.** A harness whose person never opens search uses no extra CPU or disk (D0). The first time it opens, results that are already in memory show at once. File names follow within about a second, and file contents arrive in the background with "Indexing… N of M".

## 3. What is searched

Six kinds of result, plus a seventh when a harness opts in. In the "All" view, results come grouped in this order, at most 5 per group. With a filter, up to 50 results of that kind show.

| Kind | Items | Fields indexed | Enter opens |
|---|---|---|---|
| **Tasks** | The manifest's actions with their status, the open task, past tasks (from `History.tasks`), and chat entries in `.harness/chats/<scope>.jsonl` (the person's messages and the agent's answers) | Action label and description; the task's title; chat text | An action that hasn't started: the same as clicking it (its prepared start). The open task: it gets focus. A past task: the History panel with that row open. A chat entry: the chat, scrolled to that entry, which is highlighted for 2 s. |
| **Notes** | `.harness/notes/**` (the scope's, `_app`'s) | Title (the first `# `), headings, body | The reader |
| **Files** | The person's folder and the reference folders (§8 says what is left out) | Name, path, and text (D1) | `.md`: the reader, at the heading above the first match. Another file in the folder: the file timeline panel. Another file in a reference folder: "Show in Finder" (`shell.showItemInFolder`), since the reader handles only `.md`. |
| **Settings** | Core settings (a static registry, §6) and the harness's declared settings (`settings.md`) | Label, section, keywords | Settings at that section, with the field focused |
| **Actions** | App commands that are available right now (§6) | Label, keywords | Runs the command |
| **Data** (opt-in, D4) | Records of collections that declare `search` | The declared `title` and `text` fields | A harness collection: the harness view's handler (`client.search.onOpenRecord`); without one, nothing opens and the row says "Shown in <harness>". A plugin collection: the plugin's panel, with the record id passed as `focus`. |

A result row shows a kind icon, the title, one line of context and an optional tag, as in the mockup. The line of context is a snippet around the match: the chat text, the note's section, the file's line. Otherwise it is the path, or `Topic 5 · not started · Deep` for an action. A file in a reference folder carries the folder's label and "read only".

## 4. The index

### 4.1 Where it lives

- `<userData>/search/<folder-hash>/index.json`, beside the history's data folder (`historyDir`) and following the same rules: the index never enters the person's folder or cloud sync, and moves and is set aside with the history when the folder moves. A profile has its own index (`<folder-hash>/<profile>/`), and no index ever crosses profiles.
- Holds the `minisearch` snapshot (`toJSON`), a `version`, and `files.json`: for each indexed file, its path, size, mtime and how it was indexed (`text`, `name-only` or `skipped:<reason>`). The file is written atomically, with permissions 0600, at most every 5 s while changes come in, and once more on quit.
- It is a **rebuildable cache**, never a source of truth. A missing file, a bad shape or an unknown `version` gets thrown away, and the index is rebuilt the next time ⌘K opens.
- Only the title and the fields needed to open a result are stored, not the text itself. Snippets are read when a query runs, for the visible results only (§5.3).

### 4.2 When it is updated

| Source | Trigger |
|---|---|
| Files in the folder, notes, harness data | `History.onCommit(paths)`, which already reports every commit's touched paths. Over 200 paths (sent as null), or for a restore, the index reconciles the whole folder. |
| Changes made outside the app while it runs | A reconcile (stat every file, re-read only those whose size or mtime changed) when ⌘K opens, at most once per 60 s, and at startup if an index exists. |
| Reference folders | They aren't tracked by the history, so only the reconcile above covers them. |
| Chats | The chat recorder appends an entry, and main indexes it in the same tick. An engine switch archives the chat, and its entries leave the index. |
| Tasks and actions | Changes to `tasks.json` and the manifest (statuses, the open task, a phase). |
| Plugin data (opt-in) | The broker's `data.put/patch/delete/replaceAll` on a collection with `search` reindexes those records. Removing the plugin removes them. |
| Settings, commands | Not stored. They are built in memory each time ⌘K opens (they are few, and they depend on the current state). |

### 4.3 Where the work runs

- The building and the file reading run in a `utilityProcess` worker (the same pattern as `material`'s worker runner), so the main process never blocks on a large folder. Main holds the live `MiniSearch` instance, applies the worker's batches and answers queries.
- Files are read through `readCapped` (`packages/workspace/src/safe-read.ts`): links and hard links are refused, and reads stay inside their root. A file counts as binary according to `isBinary` (`file-diff.ts`).

### 4.4 Cost

No tokens, ever. The numbers below are budgets the plan must measure on a real folder (the demo, plus a 10,000-file repo) and report. They are not promises.

| | Budget |
|---|---|
| Names of 10,000 files, first open | < 1 s |
| Text of 10,000 files, first build | < 30 s in the worker; the window stays responsive |
| Query, p95 | < 50 ms for 10,000 files |
| Index on disk | ≤ 30% of the indexed text |
| Memory in main | The `MiniSearch` instance only. The plan measures it and caps it (§4.5). |

### 4.5 Limits

- Text is indexed up to 1 MB per file; a bigger file is indexed by name only.
- At most 50,000 files across the folder and the reference folders. Past that, the folder's files come first, then the references in manifest order, and the rest are left out. Search shows "Some files aren't searched: the folder is too large".
- At most 200 MB of indexed text in total. Past that, files are indexed by name only, starting with the largest.

## 5. The palette

### 5.1 Opening and keys

- **⌘K** (Ctrl+K on Windows and Linux) opens search from anywhere in the main window, and closes it again. The top bar's button (UI refresh) calls the same thing. Harness views get `client.search.open(query?)`.
- **↑ / ↓** move through results across groups. **Enter** opens the selected one. **⌘Enter** prepares a question (§5.4). **Esc** closes search and returns focus to what had it.
- **⌘1…⌘7** pick the filters in the order they appear. **Tab** moves between the input, the filters and the list.
- Search is a modal dialog (`role="dialog"`, `aria-modal`), and focus stays inside it. Results are a `listbox` with `aria-activedescendant`, and the count is announced politely ("9 results").
- The footer shows the keys and the place being searched: "Searching in <harness>", or "<scope> + app" with scopes.

### 5.2 With nothing typed

The palette shows the 8 results opened most recently from search (stored per profile in `config.json` → `search.recent`, paths and ids only), then the available actions. Typing replaces both.

### 5.3 Query and ranking

- `minisearch` folds accents and matches prefixes and fuzzy terms (fuzziness 0.2 for terms of 4 or more characters), the same setup as `material_search`. Every word must match (`combineWith: "AND"`). If that finds nothing, the query runs again with OR, and the results say "Showing partial matches".
- Boosts: title ×3, path or name ×2, text ×1. A small boost goes to anything recent (an mtime or `at` within 7 days) and to the open scope.
- The first match in a title or snippet is marked with `<mark>`. A snippet is read right when the query runs, for the visible rows only: a window of about 120 characters around the first match. Files are read through `readCapped`, chats from the line's byte offset, which the index stores.

### 5.4 ⌘Enter: ask the AI

- This prepares a free question: the composer gets the query, plus a hint block that the person sees and can delete before sending:

  ```
  <query>

  Possibly related: `docs/architecture/context.md`, note "Engines", task "The turn".
  ```

  Up to three of the top results go in, as paths and titles only. A result from a reference folder goes in by name and never by full path. Settings and actions never go in.
- If a task is open, this follows the app's flow for starting another topic: the same confirmation that closes the current task. Nothing is sent until the person sends it (D3).
- An empty query does nothing.

### 5.5 Filters

"All · N", then one chip per kind that has results, with its count, like the mockup. In a harness with scopes there is also an "All scopes" toggle (D2), which is remembered in `search.allScopes`. In a harness with reference folders there is a "Reference folders" toggle, on by default.

## 6. Settings and actions registry

- **Core settings**: one static table in `protocol` (`SEARCHABLE_SETTINGS`), with `{ id, labelKey, sectionKey, keywords[] }` per field of Settings (models, sidekick, plugins, engine, connections, usage, general). Labels are i18n keys, so search matches the language the person sees. A test fails when a field in Settings has no row, or a row points to a field that doesn't exist.
- **Harness settings**: every field the manifest declares (`settings.md`), with its label in the person's language.
- **Commands**: a table in `protocol` (`SEARCH_COMMANDS`), with `{ id, labelKey, keywords[], when }`. `when` is a pure predicate over the window's state, such as "a task is open" for "Open the context panel". The v1 commands: new question, open History, open notes, open the context panel, open Settings › <section>, switch scope (one row per scope), move to the next part (in a task with phases), and stop the turn. A harness adds its own commands through the manifest's actions only. The commands themselves aren't indexed: they are filtered with the same normalizing.

## 7. Scopes, profiles and plugins

- **Scopes (D2).** Every document in the index carries `scope` (a scope id, `_app` or `main`). The default query filters to the open scope plus `_app`. A harness without scopes uses `main`, and the filter isn't there.
- **Profiles.** There is one index per profile, and the active profile's is the only one ever loaded. Switching profile closes search.
- **Plugins (D4).** A plugin collection's `search` field is checked by `humanharness plugin check` (each field must exist in the collection's schema). It shows in the plugin's permission review as "Searchable: <fields>". A turned-off plugin's records leave the index, and they come back when it is turned on.
- **Harness data.** The same `search` field, checked by `humanharness check`. Only collections the person can see in the harness UI may set it. A collection with `agent: "none"` may set it too: search is the person's, not the agent's.

## 8. Privacy and permissions

### 8.1 Never indexed

- Keys: the `SecretStore` folder (`~/.humanharness/<harness-id>/secrets/`) is outside the person's folder, and nothing in the indexer ever reads it. A test proves that a known key value never shows up in a snapshot.
- Engine account files: `~/.claude`, `~/.codex`, `~/.gemini`, `~/.config/opencode`, `~/.local/share/opencode` (the same list as `context.md` "Never read").
- In the folder: any path with a `.git` part, anything under `.claude/`, and anything under `.harness/` except `notes/`, `data/` (opt-in collections only), `reviews/` and `chats/`. The generated `AGENTS.md` and the engine's instructions file are left out too, as are the app's temp files.
- By name, compared without case, at any depth: `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.keystore`, `id_rsa*`, `id_ed25519*`, `id_ecdsa*`, `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials`, `credentials*`, `secrets.*`, `*.kdbx`. These files aren't even indexed by name.
- Whatever `.gitignore` ignores: the root one and nested ones, but not the global gitignore. `node_modules/` and similar folders are usually covered this way. When there's no `.gitignore`, a default list applies: `node_modules`, `.venv`, `venv`, `__pycache__`, `dist`, `build`, `.next`, `target`, `.DS_Store`.
- Links: a link is never followed. A link to a file is indexed by its own name only.

### 8.2 The content check

Before a text file's contents are indexed, a scan of its first 256 KB looks for token-shaped strings: `sk-…` (40+ characters), `ghp_` / `gho_` / `github_pat_`, `xox[abp]-`, `AKIA[0-9A-Z]{16}`, `-----BEGIN [A-Z ]*PRIVATE KEY-----`, and `glpat-`. A hit means the file is indexed by name only (`skipped:secret-shaped` in `files.json`). The value isn't logged, and neither is where in the file it was. Notes and chats get the same check, and on a hit the line in question is left out.

### 8.3 Where results go

Results only ever reach the window, as data through `hh:search` (§9). They never reach the engine, unless the person sends a ⌘Enter question with its hints in it, and those hints are titles and paths only.

## 9. Interfaces

- **`packages/search`** (new, pure, with no Electron and no `node:fs`): document builders per kind, the deny rules (§8.1, as a pure path predicate), the content check (§8.2), the `minisearch` options, query parsing, snippet windows, ranking, and the `SearchIndex` interface:

  ```ts
  interface SearchIndex {
    query(q: string, opts: { scopes: string[]; kinds?: Kind[]; limit: number }): SearchHit[];
    status(): { state: "empty" | "names" | "building" | "ready"; done: number; total: number };
  }
  ```

  This is the seam D6 leaves for later. A future context policy would request a "retrieved" part, and the task manager would run the query (policies decide, never execute; replaceable parts §8).
- **`shell/src/main/search/`**: the service (it owns the instance, persistence and triggers), the worker entry, and the IPC handlers.
- **IPC** (in `protocol`'s channel table): `hh:search(query, filters)` returns `{ ok: true, groups, status, partial }` or `{ ok: false, reason }` (`not-ready`, `failed`). `hh:searchOpen(hit)` routes the open in main and answers `{ ok }`. `hh:searchStatus` is pushed while a build runs. Errors come back as data, the same rule as `hh:context*`.
- **UI**: `SearchPalette.tsx` in `ui`, which imports `protocol` only.
- **Client**: `client.search.open(query?)` and `client.search.onOpenRecord(collection, cb)`.

## 10. Relation to other specs

- **History** (`history.md`): it drives the updates (`onCommit`), a past task opens its History row, and the index moves with the history's data folder. History doesn't change.
- **Notes**: they are searched as files with their own kind. A note opens in the reader. The notes panel doesn't change.
- **Document reader** (`documents.md`): it opens `.md` results through `ReaderTarget`, with one new optional field, `anchor` (the slug of the heading above the match). It goes to that heading the way the table of contents does. Search within an open document is out of scope.
- **File timeline** (`timeline.md`): a file that isn't `.md` opens there, the same as from History.
- **Context panel** (`context.md`): none of what search does enters a task's context. A pin is still made from the panel only.
- **ContextPolicy** (replaceable parts §7): nothing changes. `SearchIndex` is the place where a later retrieval variant plugs in (D6).
- **Plugins** (`2026-10-27-plugins-design.md`): this adds the optional `search` field on collections and the "Searchable" line in the permission review. Plugin data stays a cache without history (D10).
- **UI refresh** (canvas above): it owns the top bar and the search button. The palette uses the refresh's tokens. ⌘K works with or without the button.
- **Language on demand**: the labels of settings and commands are i18n keys, so they are searched in the person's language. File, note and chat text is searched as written.

## 11. D0

A harness whose person never opens search behaves exactly as before: there's no `<userData>/search/`, no worker, no listener on `onCommit` and no new lines in `config.json`. Only two things change for every harness: ⌘K is bound in the main window, and `protocol` gains the channel and the two tables. A manifest without `search` on a collection validates as before.

## 12. Testing

- **Unit (`packages/search`)**: every deny rule, `.gitignore` handling, every pattern of the content check (hit and near miss), accent folding, AND with the OR fallback, the boosts, snippet windows at the start and end of a file and inside multibyte text, and the scope filter.
- **Service**: lazy build, staged readiness (memory → names → text), `onCommit` updates, a restore causing a reconcile, the 60 s reconcile throttle, a corrupt or old snapshot causing a rebuild, the caps, and profile isolation.
- **Security**: a fixture folder with a `.env`, a key file, a note holding `ghp_…`, and a link out of the folder. None of their values, and none of the link's target, show up in the snapshot, in `hh:search` answers or in logs.
- **Registry**: every Settings field has a row, and every row points to a real field.
- **e2e (mock mode)**: ⌘K opens it; typing "context" gives the mockup's groups for the demo; ↑↓ and Enter open a note in the reader at the right heading; ⌘Enter fills the composer with hints and sends nothing (no turn, no `usage.jsonl` line); Esc returns focus.

## 13. Delivery

Two plans, one PR each, stopping between them. Both start after `feat/protocol` merges, since they add channels to its table. They don't wait for the UI refresh.

| Plan | Contents |
|---|---|
| 1 | `packages/search`, the service and worker, persistence, the tasks, notes and files kinds, privacy (§8), the palette, the keys, ⌘Enter, the reader `anchor` |
| 2 | The settings and commands registry, the opt-in `search` on harness and plugin collections, `check` rules, the permission review line |

## 14. Out of scope

- The AI using the index (D6), and a `search` MCP tool.
- Searching within an open document, and replace.
- Semantic or embedding search. It would need a model, and the app's search stays deterministic.
- Archived chats from before an engine switch.
- Search across harnesses (each harness is its own app).
- A Settings screen for search exclusions. For now `.gitignore` is the way to exclude.

## 15. Open questions

- How much memory `minisearch` needs for 50,000 files with text. If plan 1's measurement goes past the budget, the cap in §4.5 comes down instead of the engine changing.
- Whether a chat entry far back in a long log needs paging in the chat view in order to scroll to it. To be checked against the chat's virtualization in plan 1.
