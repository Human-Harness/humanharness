# Global search

The ⌘K palette (Ctrl+K off macOS; spec: `docs/superpowers/specs/2026-10-30-global-search-design.md`, plan:
`docs/superpowers/plans/2026-10-30-global-search-1.md` and `2026-10-31-global-search-2.md`). Plan 1 finds tasks, notes
and files (the person's folder and the reference folders) with a local, deterministic `minisearch` index; plan 2 adds
Settings, Actions and the records of collections that opt in (see "Plan 2" below). No tokens, ever: nothing reaches the engine
unless the person sends a ⌘Enter question, and that text holds titles and paths only.

## Shape

- `packages/search` (pure: no `node:*`, no Electron, no React): the document builders per kind (`docs.ts`), the deny
  rules (`deny.ts`), the caps (`limits.ts`), the `.gitignore` matcher (`gitignore.ts`, the `ignore` package per file),
  the content check (`secrets.ts`), the `minisearch` options (`options.ts`), the query and its ranking (`query.ts`),
  snippet windows with marks (`snippet.ts`), the heading slug above a match (`anchor.ts`, the reader's own slugger) and
  `LiveIndex` (`live-index.ts`), which implements the spec's `SearchIndex` seam (D6).
- `packages/shell/src/main/search/`: the folder walk (`walk.ts`), safe reads (`read.ts`), the build (`build.ts`), run in
  a `worker_threads` worker (`worker.ts`, `runner.ts`, built as `out/main/search-worker.js` beside `diff-worker.js`), the
  snapshot (`store.ts`), the service (`service.ts`), hits to the window's view model (`views.ts`) and the handlers
  (`ipc.ts`). `main/index.ts` creates the service with its dependencies: the base, scopes, references, the engine's
  instructions file, the tasks built in memory, and "Show in Finder".
- `packages/protocol`: the view types (`SearchHitView`, `SearchTarget`, `SearchStatus`, `SearchAnswer`…),
  `SearchClient` as `HarnessClient.search`, and three channels: `hh:search(query, filters)` and `hh:searchOpen(hit)`
  (invoke), `hh:searchStatus` (push). The preload's client is `packages/shell/src/preload/search.ts`.
- `packages/ui/src/search/` (self-contained): the row and chip model (`model.ts`), the ⌘Enter text (`ask.ts`), what a
  result opens (`intent.ts`), `SearchPalette.tsx` and `SearchHost.tsx` (the ⌘K binding, a capturing `keydown` on
  `window`, so only the main window has it). `HarnessApp` mounts the host; `ChatView` runs the intents through
  `searchRef` (the reader at an anchor, the file timeline, the History panel at a task, a chat entry, a composer draft,
  starting an action). The palette's CSS is the `hh-search-` block at the end of `styles.css`. Every key the palette
  handles (Escape, Tab, the arrows, Enter, ⌘Enter, ⌘1–7) stops there, so a modal under it (the Settings sheet's
  document listener traps Tab) never sees it.

## Lifecycle

- **Lazy (D0, D8).** `SearchService` creates nothing in its constructor. The first `hh:search` resolves the base and
  opens its live index: a saved snapshot is loaded (and reconciled on its first search, whatever that asks), or a first
  build starts. Until then
  there is no `<userData>/search/`, no worker and no index in memory, and `committed()` (called by the existing commit
  announcer and after a restore) returns at once. Nothing is loaded at startup (plan deviation 4).
- **One index per base.** The folder is `<userData>/search/<sha256(base)[0..16]>/`; with profiles the base is the
  profile's own folder, so each profile has its own index and none crosses (plan deviation 2). A base change (a profile
  switch) closes the live index, flushing it, and opens the new base's. A folder move discards the old bases' indexes;
  the next ⌘K rebuilds. Deleting a profile discards its folder's index, and so does creating one (profile ids are
  reused names: a new "Tomás" never loads a deleted one's). A discard lets a load under way for that base settle
  first, reaches the store a base switch is still flushing, and a discarded store writes nothing again (the prefs go through the same write chain as the snapshot). The
  prefs are read from disk once and then served from memory, each change made on the latest copy, so a change queued
  behind a long snapshot write is never lost to a stale read; a query that flips "All scopes" doesn't wait for the disk.
- **The snapshot.** `index.json` (the `MiniSearch` JSON; stored fields only, never the text), `files.json` (the index
  version, per-file size, mtime and how it was indexed, the chats' offsets and ids, the in-memory docs' ids, the
  truncated flag) and `prefs.json` (the recents and the "All scopes" toggle, plan deviation 3). Each is written
  atomically (temp file, rename) with mode 0600 in a 0700 folder, at most every 5 s while changes come in and once more
  on quit. A missing, broken or other-version snapshot is rebuilt. A loaded snapshot drops any document its
  `files.json` doesn't account for (a known file, a chat entry, a task built in memory): a build cut short by a quit or
  a crashed worker saved its batches, but files and chats only take a build's state on `done`.
- **The build.** One at a time, and only on the live index (a query still holding one swapped out or discarded starts none); what comes in meanwhile runs right after (a full reconcile absorbs a commit's paths).
  A first build posts every name first (`names`, so files are found by name within about a second), then texts in
  batches of 200 (`building`, "N of M"), then the chats, then `done`. A reconcile reads only what is new or changed
  by size and mtime, and removes what is gone. Chats are read incrementally from the stored byte offset; a shorter file,
  or another file at the same path (`ChatMeta.identity`: dev, inode and birth time; `ChatLog.archive` renames the
  conversation away), starts over, and so does a chat stored without an identity (an older snapshot, once). `archive/`
  is never read (plan deviation 5). A build that fails (not one stopped) puts the status back to `ready` from the files
  last known and is logged; each whole build that fails in a row doubles the wait before the next reconcile (60 s, up
  to 30 minutes), and one that finishes resets it.
- **Updates.** Each commit's paths (`committed(paths)`), a restore (`committed(null)`: the whole reconcile), and every
  ⌘K at most once per 60 s (longer after failed builds). The tasks (the manifest's actions with their status, the open task, past tasks) are built
  in main and swapped into the same index when the palette opens and at most every 5 s while typing (plan deviation 6).
- **Compaction.** `minisearch`'s automatic vacuum is off: it walks the term tree in batches with a pause between them,
  and a build's batch applied in that pause changed the tree under the walk (it threw in main). `LiveIndex.compact()`
  drops what replaced and removed documents left behind in one synchronous walk, past `minisearch`'s own thresholds,
  when a build is done and after the tasks are swapped. Queries skip discarded documents either way.

## Query and results

- AND first; with no hit and more than one word, OR, and the answer says `partial`. Prefix matching, fuzzy 0.2 from 4
  characters, accents folded. Boosts: title ×3, path ×2, text ×1; ×1.2 for what changed in the last week, ×1.1 for the
  open scope.
- At most 5 rows per kind, or 50 of one kind with a filter; `counts` per kind keep the chips' counts (plan deviation
  20). Snippets are read for at most 20 rows per answer (plan deviation 17), only for files indexed as text and chat
  entries, through the same safe reads. A file is checked again with the content check before any of its text leaves
  main (it may have changed); notes and chat entries lose their token-shaped lines. A Markdown snippet carries the slug
  of the heading above it, so the reader opens there (setext headings get none).
- Scopes: by default the open scope and `_app`; "All scopes" (remembered) shows all. Folder files, reference files,
  manifest actions and notes directly in `.harness/notes/` are `_app` (plan deviation 21). Without scopes everything is
  `main` and no scope filter applies.
- `hh:searchOpen` records the recent (8, ids only) and, for a reference folder's non-Markdown file, does "Show in Finder"
  from the stored hit, checked inside that folder: a reference file's absolute path never reaches the window. Every
  other open is routed in the window (plan deviation 7). The handlers keep only known filter fields and cap the query
  at 200 characters.

## Never indexed

The rules are pure predicates in `packages/search/src/deny.ts`, compared without case, with `\` read as a separator and
each part without trailing dots and spaces (what macOS and Windows open), and a path with an empty, `.` or `..` part is
denied:

- Any path with a `.git`, `.claude` or `.aws` part; under `.harness/` everything except `notes/`, `reviews/` and
  `chats/` (`data/` is never walked: searchable collections come through the stores, see "Plan 2"); the generated `AGENTS.md` and the engine's instructions
  file; the app's temp files (`*.tmp`).
- Secret-shaped names, at any depth, not even indexed by name: `.env`, `.env.*`, any name ending `.env`, `*.pem`,
  `*.key`, `*.p12`, `*.pfx`, `*.keystore`, `*.jks`, `id_rsa*`, `id_ed25519*`, `id_ecdsa*`, `.npmrc`, `.pypirc`,
  `.netrc`, `.git-credentials`, `credentials*`, `secrets.*`, `*.kdbx`.
- Tool credential files, as runs of path parts at any depth: `.kube/config`, `.docker/config.json`,
  `.config/gh/hosts.yml` and `.config/gh/hosts.yaml`.
- What `.gitignore` ignores: the root's and nested ones (a `!pattern` re-includes only within its own file, plan
  deviation 16; the global gitignore is not read). Only when the root has no `.gitignore`, the default list:
  `node_modules`, `.venv`, `venv`, `__pycache__`, `dist`, `build`, `.next`, `target`, `.DS_Store`.

The walk (`walk.ts`) adds its own fail-closed checks:

- `rootAllowed`: a root is walked only when its real path is neither the home folder, a folder that holds it (`/`,
  `/Users`), nor a dot-folder in it or inside one (`~/.claude`, `~/.codex`, `~/.ssh`, `~/.config/opencode`…), also
  when the root is a link to one. The real path it checked is what the walk itself (each `.gitignore`, folder listing and `lstat`) and the file and
  chat reads then use, so a root link swapped after the check lists nothing of its new target; paths stay relative to
  the root. The folder and
  the references are checked before they get there; this is the walk's own check (a commit's paths under such a root
  all count as missing).
- `isIgnored`: a path the `ignore` package refuses (it throws) counts as ignored.
- Links are never followed: a link (to a file or a folder) is indexed by its own name only (`skipped:link`) and a
  linked folder is never entered. A `.gitignore` is read only as a plain file up to 1 MB.

Reading (`read.ts`, `build.ts`):

- Files go through `readCapped` (no links, no hard links), with the folder's real path checked right before each read
  (`stillInside`); a file that fails is left out (`skipped:unsafe`). `isBinary` files, files over 1 MB and files past
  the 200 MB text total (the largest first) are indexed by name only; at most 50,000 files, the folder first, then the
  references in manifest order ("Some files aren't searched").
- Chat files are opened with `O_NOFOLLOW`, as plain files with one name, inside the folder.
- The content check (`secrets.ts`) scans all of a file's indexable text (up to 1 MB) for token-shaped strings:
  `sk-…`, GitHub `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`/`github_pat_`, Slack `xox[abcdeoprs]-` and `xapp-`, JWTs, AWS
  `AKIA`/`ASIA` ids, `-----BEGIN … PRIVATE KEY-----`, the PGP private key header, a base64-encoded PEM block, `glpat-`,
  Stripe `sk_live_`/`rk_live_` and Google `AIza` keys. Token edges allow `_` before a token (`AWS_AKIA…`). A file with a
  hit is indexed by name only (`skipped:secret-shaped`); notes and chats keep their text without those lines, and a
  private-key block is left out whole, BEGIN through END. A hit is never logged, nor where it was.
- The `SecretStore` and the engines' account folders are outside the folder and never walked; the security test
  (`packages/shell/test/search-security.test.ts`) proves a known key value never shows up in a snapshot, an answer or a
  log.

## Budgets

`HH_SEARCH_BUDGET=1 corepack pnpm vitest run packages/shell/test/search-budget.test.ts` measures §4.4 on 10,000
generated files (or `HH_SEARCH_BUDGET_DIR=<folder>`): the time to names and to ready, the query p95 (snippets
included), the snapshot on disk against the indexed text, and main's heap. It is skipped otherwise: timing asserts
would be flaky under the suite's load (plan deviation 19).

## Plan 1 deviations

See the plan's "Deviations from the spec" (`docs/superpowers/plans/2026-10-30-global-search-1.md`).

## Plan 2: settings, actions and data

- **Settings and Actions are the window's.** `SEARCHABLE_SETTINGS` and `searchCommands`
  (`packages/protocol/src/search-local.ts`) list them; `packages/ui/src/search/local.ts` builds the rows each time the
  palette asks, matched by word prefix (`localScore`: 2 when every typed word starts a word of the label, 1 when of the
  label, the tab's name or a keyword; accents and case folded), best score first, ties in the table's order. The
  marked label is NFC-composed first, so a decomposed accent doesn't split its word. `SearchPalette`'s `local` merges
  them with main's answer: groups in §3's order (Tasks, Notes, Files, Settings, Actions, Data; 5 rows per group, 50 with
  a chip), their chips and counts, ⌘1–7. The rows are built for the query main answered, so groups and chips describe
  one query; while main isn't ready or fails they are built for the typed query (no chips then), so Settings and
  Actions still work. Main's `hh:search` never sees them; they never join the recents, and they carry no ⌘Enter hint.
  Tab helpers both read (`visibleTabs`, `tabLabel`) live in `packages/ui/src/settings-tabs.ts`, so search loads no
  Settings component.
- **A setting opens Settings at its field.** Each searchable row carries a literal `data-setting="<tab>.<field>"`
  (harness fields `harness:<name>`; an advanced one opens with "More settings" expanded). Rows need their `needs`
  (configured, folder, backup, parallel, profiles) and a visible tab; harness fields show once configured. Picking one
  gives focus back to what had it before search (Settings returns it there on close), then `focusSetting`
  (`packages/ui/src/search/focus-setting.ts`) focuses the row's first usable control (else the row, with a `tabindex`
  removed on blur), scrolls it into view and flashes it for 2 s (a second flash restarts its own timer). A tab still
  loading is waited for, 2 s at most; past that nothing is focused. A second search while Settings is open re-runs only
  the focus: the tabs stay mounted, so unsent drafts and errors stay. The registry test
  (`packages/ui/test/search-settings-registry.test.tsx`) reads the literal `data-setting`s and renders each tab in its
  needed state, so a row and the registry can't disagree.
- **Actions** are the ones available now, built when the palette asks from the chat's `ChatSearchContext`
  (`searchContextRef`, set by `ChatView`; none away from the chat) and only once the app is configured: New question
  (no task open; it focuses the composer and keeps an unsent draft), History and "what's clear
  so far" (not the slim window), "what the AI takes into account" (also a task open), the next part (the task waits
  for the person and nothing else is under way; the row names the part's id), Stop (a turn, a close or a checkpoint runs), each visible
  Settings tab, each scope that isn't open or archived (no turn running). With nothing typed they show after the
  recents. Each one is checked again when picked: one that no longer applies (the task moved on to another part, a turn
  started before a scope switch) does nothing and the window shows "That can't be done right now." for 4 s; a scope
  switch main refuses says what the scope picker says. None sends what the person typed; the next part does what the
  stepper's button does: the task moves on and the part's own turn starts.
- **Data records.** A collection opts in with `search: { title, text? }` (`text`: one field or up to five; a strict
  object, so an unknown setting is refused). Harness: zod field names (`collectionSchema`); plugin: JSON schema property
  names and an optional `panel`, which must be a declared panel (`pluginManifestSchema`; `pluginCollections` drops
  `panel` before the data model's check). Main lists the sources (`searchData` in
  `packages/shell/src/main/search/data-sources.ts`): `harness:<folder>/<collection>` (an app-wide collection in `_app`,
  a scoped one in each scope that isn't archived, `main` without scopes) and `plugin:<plugin>/<collection>` for each
  running plugin (`PluginsController.searchSources`). Each source's stamp (`sourceStamp`, `stamp.ts`) is the size and
  mtime of its records file and of its meta file (a store writes the records, then when each changed) plus a hash of
  its declaration (key, `single`, `search`; `declarationStamp`), and for a plugin the panel a record opens in; a source
  is read again only when its stamp changed. `recordRows` (`packages/search/src/docs.ts`) turns records into rows: the
  title field (else the key, also when the title is token-shaped), the text fields joined by lines without token-shaped
  ones (a wrapped base64 PEM is left out with its continuation lines) and capped at a file's 1 MB; a record whose key is
  token-shaped is skipped, and so is a key whose text an earlier record already has (`1` and `"1"`: the first wins).
  Documents `data:<source>#<key>` keep no text; a snippet reads the collection again, once per answer, and finds the row
  by the same key text. Their scope: `main` without scopes, else the harness folder, `_app` for app-wide and plugin
  ones. `files.json` keeps `data: { <source>: { stamp, ids } }`; a loaded snapshot keeps only the data documents it
  lists. At most 20,000 data documents (`MAX_DATA_DOCS`): a source cut short stores `cut:<room>:<stamp>` and is read
  again only once its room or its stamp changes.
- **One base only.** `sources(base)` and `rows(source, base)` take the live index's base. When it isn't the active base
  any more (a profile switched during the reads; checked before and after them), the config is invalid, or the plugin
  list failed, they answer null and the index keeps what it has: no index ever takes another base's records. The
  plugin side peeks at the context its plugins run in and never asks for the base (which would detach them). A source
  whose read fails keeps its documents while they fit, is logged once per stamp, and is tried again after 10 s, then
  twice as long each time up to 30 minutes; a failing source list is logged once until it works again.
- **What opens a record.** A harness record goes to the view listening with
  `client.search.onOpenRecord(collection, (key, scope) => …)`: one stack per collection in the preload, the newest
  listener answers and when it unsubscribes the one under it answers again. None listening: the row's tag says "Shown
  in <harness>" and Enter only closes search. A plugin record opens the plugin's panel (the declared `panel`, else the
  first) with its key as the panel's focus, only while the plugin still shows that panel; every plugin row is tagged
  "From <plugin>", and a plugin without panels has target `none` (Enter only closes search). A pick still records the
  recent. Titles and contexts are each wrapped in `<bdi>`.
- **Reindex triggers.** The palette opening and at most every 5 s while typing (a query waits only for the pass in
  progress, not for the ones a burst keeps asking for), a `DataStore` write to a searchable collection, a plugin run's
  writes, a plugin turned on, off, added, removed or updated (the running set with versions changed;
  `runningPlugins`), a commit with a path under `.harness/data/` and a restore. `SearchService.dataChanged()` collects
  the changes of 500 ms (`dataDelayMs`, from the first one, not pushed back) into one refresh; one refresh runs at a
  time and one asked for meanwhile runs once after it. All are no-ops until search was opened (D0); a quit drops a
  waiting burst.
- **Checks.** `check` warns `search-data`, once per searchable collection: no view file under the `ui` folder (`.ts`,
  `.tsx`, `.mts`, `.js`, `.jsx`, `.mjs`; no links, no `node_modules`; comments and `t("…")` keys don't count) quotes
  the collection's name, or none calls `onOpenRecord("<collection>", …)` (a call whose first argument isn't a literal
  counts for every collection). A heuristic: the manifest can't say what a view shows. Skipped when the `ui` path is
  already a schema error. `plugin check` warns `search-panel` per searchable collection of a plugin with no panel. The
  permission review shows "Searchable: <collection> (<fields>); …", each name isolated; it isn't a permission, so a
  plugin that asks for nothing still says "It asks for nothing beyond its own data." above it.

## Plan 2 deviations

See the plan's "Deviations from the spec" (`docs/superpowers/plans/2026-10-31-global-search-2.md`).
