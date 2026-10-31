# Global Search Implementation Plan (plan 2 of 2: settings, commands and data)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The ⌘K palette also finds Settings fields (opening Settings at that field, focused), app commands that are available right now (running them), and the records of harness and plugin collections that opt in with `search: { title, text? }` (opening them in the harness view or the plugin's panel), with the `check` rules and the plugin permission review line the spec assigns to plan 2.

**Architecture:**
- **Settings and commands never reach main.** They are few, change with the window's state and are labelled in the person's language, so the window builds them when the palette opens (spec §4.2 "built in memory each time ⌘K opens"). The tables live in `packages/protocol/src/search-local.ts` (`SEARCHABLE_SETTINGS`, `searchCommands`) with a pure matcher (`foldText`, `localScore`, `markLocal`, the same folding as `packages/search`). `packages/ui/src/search/local.ts` turns them into rows; `SearchPalette` merges them with main's answer (groups, chips, counts, ⌘1–7). With nothing typed, the palette shows the recents, then the available commands (plan 1 deviation 9 closed).
- **Settings open at the field.** Every searchable row in Settings carries `data-setting="<id>"`. `HarnessApp` opens the sheet at the row's tab with `focus: { id, n }`; `SettingsSheet` calls `focusSetting(panel, id)` (`packages/ui/src/search/focus-setting.ts`), which waits for the row to render (a `MutationObserver`, 2 s at most), focuses its first control and flashes it for 2 s. A registry test fails when a Settings row has no registry entry or an entry has no row.
- **Data records are indexed in main, from the stores, not from files.** `SearchService` gets an optional `data` dependency: `sources()` lists every searchable collection (harness: one per scope folder; plugin: one per running plugin) with a `stamp` (file size, mtime, panel), and `rows(source)` reads its records through `DataStore`/`PluginData` and maps the declared fields (`recordRows` in `packages/search`). A source whose stamp didn't change is not read again. The documents go into the same live index as `data:` documents; `files.json` gains `data: { <source>: { stamp, ids } }`. Triggers: the palette opening (and at most every 5 s while typing), every `DataStore` write, every plugin run's writes and every plugin turned on or off (`svc.dataChanged()`, a no-op until search was opened, D0), and a restore.
- **What a record opens is decided in the window.** A harness record's target is `{ kind: "record", collection, key, scope }`; the chat hands it to `client.search.openRecord`, which calls the harness view's `client.search.onOpenRecord(collection, cb)` listener (kept in the preload, like `onOpen`). Without a listener the row says "Shown in <harness>" and nothing opens. A plugin record's target is `{ kind: "panel", plugin, panel, focus: <key> }` (the chat's existing `openPanel`), or `{ kind: "none" }` for a plugin with no panel.
- **`check` and the review line.** The `search` field is part of the collection schemas in `harness-sdk` (harness and plugin), so a field the schema lacks is a `schema` error in `humanharness check` and `humanharness plugin check`. `check` adds a `search-data` warning (a searchable collection nothing in `ui/` shows, or whose records no view opens); `plugin check` adds `search-panel` (searchable data, no panel). The permission review shows "Searchable: <collection> (<fields>)".

**Tech Stack:** TypeScript (tsc 7, `moduleResolution: bundler`), pnpm via corepack, zod 4 (`harness-sdk`), `minisearch@^7.2.0` (already linked by plan 1), Vitest (+ happy-dom for `ui`), Electron 44 + electron-vite 5, Playwright e2e (mock mode).

Spec: `docs/superpowers/specs/2026-10-30-global-search-design.md`. "§" and "D" numbers below refer to it. Plan 1: `docs/superpowers/plans/2026-10-30-global-search-1.md`; what it built: `docs/architecture/search.md` (the code wins where they differ). This plan is stacked on `feat/global-search` (plan 1) in branch `feat/global-search-2`.

---

## Deviations from the spec (decided while planning; tell Marco)

1. **Settings and commands are matched in the window, not in main's index (§6, §9 `hh:search`).** §4.2 already says they aren't stored; their labels are i18n keys the window translates (language on demand), and `when` reads window state (a turn running, the next part) main doesn't hold. `hh:search` keeps answering tasks, notes, files and data; the palette adds the Settings and Actions groups and their chips. No new IPC channel.
2. **Local matching is prefix-only, without fuzziness.** Every typed word must start a word of the label, the section or a keyword (accents and case folded like the index). Rows whose label matches come first. Fuzzy matching on a dozen short labels gave noisy rows in the palette tests' queries ("guide", "old"); the table's keywords cover synonyms.
3. **Recents keep only what main indexes (tasks, notes, files, data) (§5.2).** A setting or a command opened from search isn't remembered: with nothing typed, the available commands already show under the recents. Product question 2.
4. **`SearchKind` stays `"task" | "note" | "file"`; new kinds come as wider types.** `SearchIndexKind` adds `"data"` (main's answer), `SearchRowKind` adds `"setting"` and `"command"` (rows). `counts` is `Record<SearchKind, number> & { data?: number }`, and `KINDS` in `packages/search` stays plan 1's three (`INDEX_KINDS` adds data). This keeps every plan 1 test and fixture as written (they build `counts: { task, note, file }`).
5. **Data records are read in main through the stores, not by the worker (§4.3).** Records are structured and bounded (a plugin collection holds at most 2,000; harness collections are meant for hundreds, data.md "Known gaps"), and the stores already validate them, refuse links (plugin data) and know the scope folders. At most 20,000 data documents are indexed (`MAX_DATA_DOCS`); past that, sources later in the list are left out. The walk keeps denying `.harness/data/` as a folder of files (plan 1 deviation 15 stays): a collection is searched by its declared fields only, never as JSON text.
6. **`search.text` takes one field or up to five.** The spec writes `search: { title, text? }`. `text` may be a field name or a list of 1–5 field names; values that are strings, numbers, booleans or lists of strings are searched, anything else is skipped.
7. **A plugin collection's `search` may name the `panel` its records open in (§3 "the plugin's panel").** Absent: the plugin's first panel. A plugin without panels gets the "From <plugin>" tag and Enter does nothing (`target: none`), like a harness record with no listener.
8. **"Only collections the person can see in the harness UI may set it" (§7) is a `check` warning, not an error.** The manifest has no notion of what a view shows. `check` warns (`search-data`) when no file in `ui/` names the collection, and when none calls `onOpenRecord("<name>", …)`.
9. **`client.search.onOpenRecord(collection, cb)` keeps one listener per collection; the last one registered wins** (a view that remounts replaces its own). `cb` gets `(key, scope)`; `key` is `null` for a `single` collection. Two more methods serve the window: `openRecord(collection, key, scope): boolean` and `handlesRecord(collection): boolean`.
10. **Data rows never go into the ⌘Enter hints (§5.4).** The spec names paths and titles; a plugin record's title is outside data, and a harness record's title may be personal. Product question 4.
11. **Plugin data is reindexed from `PluginsDeps.dataChanged` and `changed`, not from the broker (§4.2 "the broker's data.put/patch/delete/replaceAll").** `plugin-broker.ts` is not touched. `dataChanged(plugin, collections)` already fires at each run's end with the collections it wrote; `changed(view)` fires when a plugin is turned on, off, removed or added. A turned-off plugin's records leave the index at the next refresh and come back when it is turned on (§7).
12. **The registry is per field the person changes, plus one row per list tab.** Plugins, Connections, Jobs and Usage show lists that change at runtime (plugins, keys, jobs, topics): each tab has one row (Usage two, by its two sections) that opens the tab. Models has two rows, "Tasks" and "Levels" (its two parts); pinned files budget is a keyword of "Tasks". Harness settings are one row per manifest field, from `state.settings` (§6 "Harness settings").
13. **The registry test is static plus two rendered tabs.** It checks that every registry id is written in `packages/ui/src` and every `data-setting="…"` there is in the registry, that every label of the General tab sits in a `data-setting` row, that General and Sidekick render exactly their registry rows for the state given, and that every label and section key exists in `en.json`. Engine, Models, Plugins, Connections, Jobs and Usage need an engine status, a models view or lists to render; the static check covers them.
14. **"Switch scope" lists the scopes that aren't archived and aren't open; "New question" shows only while no task is open (§6).** A task open makes ⌘Enter a follow-up in plan 1 (its deviation 10); "New question" follows the same line: it isn't offered while a task is open, rather than asking to close it. Product question 1.
15. **The combobox's label stays "Search tasks, notes and files".** Changing it breaks plan 1's tests, which find the input by that name. Product question 6.

**Plan 1 items closed here:** deviation 9 (actions with nothing typed), 12 (`onOpenRecord`), 15 (`.harness/data/` opt-in, through deviation 5 above).

**Blocker check:** none. No dependency is added (zod, `minisearch` and `ignore` are already linked). `plugin-broker.ts` and `plugin-secrets.ts` are not touched. Nothing new runs before the first ⌘K: `dataChanged()` returns at once until search was opened, the palette's local rows are built only while it is open, and the chat's context getter is a function stored in a ref (the same pattern as `searchRef`).

---

## Open questions

### Product (what the person sees and does; my proposed default in bold)

1. **With a task open, is "New question" offered (closing the task first, with the usual confirmation)?** Default: **not offered while a task is open**; the person finishes or leaves the task first (deviation 14).
2. **Do settings and commands opened from search join the recents?** Default: **no**; with nothing typed the palette shows the 8 recents (tasks, notes, files, records) and then the available commands (deviation 3).
3. **How many commands show with nothing typed?** Default: **all that are available now** (about 6–12, more with many scopes: one "Switch to <scope>" each). Typed queries show 5 per group, 50 with the Actions filter, like every kind.
4. **May a record's title go into the ⌘Enter hints?** Default: **no, never** (deviation 10).
5. **What is the data kind called in the chips and groups?** Default: **"Data"** (the spec's word); a harness can't rename it in v1.
6. **Should the input's label and placeholder name settings and actions now?** Default: **keep "Search tasks, notes and files…"** until the UI refresh rewrites the palette's copy (deviation 15). Alternative: "Search everything…", which needs plan 1's tests to find the input another way.
7. **What does a harness record without a view to open it say?** Default: **the tag "Shown in <harness>", and Enter only closes search** (§3). A plugin record whose plugin has no panel: **"From <plugin>"**, same behaviour.
8. **The permission review line's wording.** Default: **"Searchable: issues (title, body)"**, one line per plugin listing each searchable collection and its fields, after the permissions.

### Technical (decided; noted here)

- Settings ids are `<tab>.<field>` (`general.appearance`); harness fields are `harness:<field name>`. Row ids are `setting:<id>` and `command:<command>[:<arg>]`.
- `focusSetting` focuses the row's first enabled `input`, `select`, `textarea` or `button`; with none (a disabled fieldset, a heading) the row itself gets `tabIndex=-1` and focus. It gives up after 2 s.
- Models' "Levels" row opens the tab on its Levels part (`ModelsTab part`), and a harness field marked `advanced` opens with "More settings" expanded (`HarnessSettingsTab focus`); both remount their tab on a new search focus.
- Data sources: `harness:<folder>/<collection>` and `plugin:<plugin>/<collection>`; document ids `data:<source>#<key>` (`#` alone for a `single` record). The stamp is `<size>:<mtimeMs>` of the collection file (`none` when missing), plus `:<panel>` for plugins.
- Data refreshes run one at a time per live index; a request during one runs it once more after. A source whose `rows` fails keeps what the index had. A record's snippet reads its collection again (once per answer, through the same `rows`).
- `recordRows`: a token-shaped title falls back to the record's key; token-shaped lines leave the text (the §8.2 check, as for notes and chats); a record with no usable key is skipped.
- A data document's scope: without scopes `main`; with scopes, a scoped harness collection's folder, else `_app` (plugin data is always app-wide).
- `INDEX_VERSION` stays 1: the snapshot only gains an optional `data` field and stored field, which an older snapshot simply lacks.

---

## Conventions

- English everywhere; packages export TS source; extensionless imports; tests in `packages/<name>/test/`; one commit per task; run every command from the worktree root (`/Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-search-2`), never `cd` elsewhere.
- `@humanharness/search` stays pure: no `node:*`, no `electron`, no `react`. `@humanharness/protocol` keeps its rules (`boundary.test.ts`): no Node, no Electron, no React; runtime imports from `harness-sdk` only.
- Existing tests do not change. Test helpers (`packages/ui/test/fake-client.ts`) only gain members.
- `ui/src` imports only `protocol` (through `./client`), `harness-sdk`, `i18n`. Search's window code stays in `packages/ui/src/search/`.
- Don't touch `packages/shell/src/main/plugin-broker.ts` or `packages/shell/src/main/plugin-secrets.ts`.
- Tests never read `~/.claude`, `~/.codex`, credential files or the real Keychain; fixtures live in `os.tmpdir()` folders made with `fs.mkdtemp` and removed in `afterEach`. No network.
- Verification: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`, `corepack pnpm e2e`. One file: `corepack pnpm vitest run packages/search/test/data-docs.test.ts`. Under load some cli tests time out; rerun a failing file alone before calling it a failure.
- Commit trailer (every commit):
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv
  ```
- Never `git stash`, never push. Install nothing.

## Files

| File | Change |
|---|---|
| `packages/harness-sdk/src/data.ts` | `collectionSearchSchema`, `searchFields`, `search` on `collectionSchema` |
| `packages/harness-sdk/src/plugin.ts` | `search` (with `panel`) on plugin collections; `searchableLine` |
| `packages/harness-sdk/src/plugin-permissions.ts` | `PermissionLine` gains `searchable` |
| `packages/search/src/types.ts`, `options.ts`, `query.ts`, `docs.ts` | the `data` kind, `DataSource`/`DataRow`/`DataRef`/`DataMeta`, `recordRows`, `dataDocs` |
| `packages/protocol/src/views.ts`, `shared.ts`, `client.ts`, `index.ts` | wider kinds, new targets, `SearchClient` record methods |
| `packages/protocol/src/search-local.ts` | **new**: matcher, `SEARCHABLE_SETTINGS`, `searchCommands` |
| `packages/shell/src/preload/search.ts` | the record listeners |
| `packages/shell/src/main/search/store.ts`, `service.ts`, `views.ts`, `ipc.ts` | data meta, data refresh, record targets, the data filter |
| `packages/shell/src/main/plugins.ts` | `searchSources`, `searchRows`, the review's searchable line |
| `packages/shell/src/main/plugin-data.ts` | `changedAt` (recency for search) |
| `packages/shell/src/main/search/data-sources.ts` | **new**: `harnessSources`, `harnessRows` |
| `packages/shell/src/main/index.ts` | the data dependency and the `dataChanged()` calls |
| `packages/ui/src/search/intent.ts`, `model.ts`, `SearchPalette.tsx`, `SearchHost.tsx` | targets, local rows, tags |
| `packages/ui/src/search/local.ts`, `focus-setting.ts` | **new** |
| `packages/ui/src/HarnessApp.tsx`, `ChatView.tsx`, `SettingsSheet.tsx`, `ModelsTab.tsx`, `HarnessSettingsTab.tsx`, `EngineTab.tsx`, `UsageTab.tsx`, `ProfilesSection.tsx`, `sidekick/SidekickTab.tsx`, `plugins/PluginsTab.tsx`, `plugins/PermissionReview.tsx`, `connections/ConnectionsTab.tsx`, `parallel/JobsTab.tsx` | routing, `data-setting`, focus |
| `packages/ui/test/fake-client.ts` | the record methods |
| `packages/i18n/src/locales/en.json` | `search.kind.*`, `search.command.*`, tags, `plugins.review.searchable` |
| `packages/cli/src/check.ts`, `plugin-check.ts` | `search-data`, `search-panel` |
| `packages/e2e/tests/search-settings.spec.ts` | **new** |
| `docs/architecture/search.md`, `data.md`, `plugins.md` | plan 2's parts |

---

### Task 1: `search` on harness and plugin collections (D4, §7)

**Files:**
- Modify: `packages/harness-sdk/src/data.ts`
- Modify: `packages/harness-sdk/src/plugin.ts`
- Test: `packages/harness-sdk/test/collection-search.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/harness-sdk/test/collection-search.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { collectionSchema, searchFields } from "../src/data";
import { parsePluginManifest, pluginCollections } from "../src/plugin";

const people = { scoped: false, key: "id", agent: "none" as const, schema: z.object({ id: z.string(), name: z.string(), bio: z.string().optional() }) };

describe("search on a harness collection (search spec D4, §7)", () => {
  it("is optional: a collection without it parses as before", () => {
    expect(collectionSchema.parse(people)).not.toHaveProperty("search");
  });

  it("names fields of the schema: a title and one or up to five text fields", () => {
    const c = collectionSchema.parse({ ...people, search: { title: "name", text: ["bio"] } });
    expect(c.search).toEqual({ title: "name", text: ["bio"] });
    expect(searchFields(c.search!)).toEqual(["name", "bio"]);
    expect(searchFields({ title: "name", text: "bio" })).toEqual(["name", "bio"]);
    expect(searchFields({ title: "name" })).toEqual(["name"]);
    expect(collectionSchema.safeParse({ ...people, search: { title: "name", text: ["a", "b", "c", "d", "e", "f"] } }).success).toBe(false);
  });

  it("refuses a field the schema doesn't have", () => {
    const r = collectionSchema.safeParse({ ...people, search: { title: "nope", text: "bio" } });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain('"nope" is not a field of the schema');
  });

  it('a collection hidden from the agent (agent: "none") may set it: search is the person\'s', () => {
    expect(collectionSchema.safeParse({ ...people, search: { title: "name" } }).success).toBe(true);
  });
});

const plugin = (search: unknown, panels = [{ id: "main", title: "Main" }]) => ({
  id: "mini",
  name: "Mini",
  version: "0.1.0",
  api: 1,
  harness: "*",
  permissions: {},
  data: {
    items: {
      key: "id",
      agent: "read",
      schema: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["id"] },
      search,
    },
  },
  panels,
});

describe("search on a plugin collection", () => {
  it("names fields of its JSON schema and, optionally, the panel a record opens in", () => {
    const m = parsePluginManifest(plugin({ title: "title", text: ["body"], panel: "main" }));
    expect(m.data.items.search).toEqual({ title: "title", text: ["body"], panel: "main" });
    // The data model keeps the fields; the panel is the plugin's own business.
    expect(pluginCollections(m).items.search).toEqual({ title: "title", text: ["body"] });
  });

  it("refuses an unknown field, an unknown panel and an unknown key", () => {
    expect(() => parsePluginManifest(plugin({ title: "nope" }))).toThrow(/"nope" is not a field of the schema/);
    expect(() => parsePluginManifest(plugin({ title: "title", panel: "side" }))).toThrow(/"side" is not a declared panel/);
    expect(() => parsePluginManifest(plugin({ title: "title", extra: 1 }))).toThrow();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm vitest run packages/harness-sdk/test/collection-search.test.ts`
Expected: FAIL, `searchFields` is not exported (and `search` is stripped or refused).

- [ ] **Step 3: Add the harness side**

In `packages/harness-sdk/src/data.ts`, right before `export const collectionSchema = z`, add:

```ts
/**
 * Global search (search spec D4): a collection opts in by naming its searched fields. The core indexes them; no code
 * runs to answer a search. `text`: one field or up to five.
 */
export const collectionSearchSchema = z.object({
  title: z.string().min(1),
  text: z.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(5)]).optional(),
});
export type CollectionSearch = z.output<typeof collectionSearchSchema>;

/** The fields a collection's `search` names: the title first, then the text fields. */
export function searchFields(s: { title: string; text?: string | readonly string[] }): string[] {
  return [s.title, ...(s.text === undefined ? [] : typeof s.text === "string" ? [s.text] : s.text)];
}
```

In the same object, after the `rules:` line:

```ts
    rules: z.custom<DataRules>((f) => typeof f === "function", { message: "Expected a function" }).optional(),
    /** Global search (search spec D4): absent, the collection is never searched. */
    search: collectionSearchSchema.optional(),
```

and at the end of its `superRefine`, after the `context.fields` loop:

```ts
    if (c.search) {
      for (const f of searchFields(c.search)) if (!Object.hasOwn(shape, f)) ctx.addIssue({ code: "custom", path: ["search"], message: `"${f}" is not a field of the schema` });
    }
```

- [ ] **Step 4: Add the plugin side**

In `packages/harness-sdk/src/plugin.ts`, change the import from `./data`:

```ts
import { type Collection, COLLECTION_NAME, collectionSchema, searchFields } from "./data";
```

In `pluginCollectionSchema`, after the `context:` line:

```ts
  /** Global search (search spec D4, §7): the fields the core indexes, and the panel a record opens in (default: the first). */
  search: z
    .strictObject({ title: text, text: z.union([text, z.array(text).min(1).max(5)]).optional(), panel: z.string().regex(PLUGIN_LOCAL_ID).optional() })
    .optional(),
```

In `pluginManifestSchema`'s `superRefine`, after the "At most 10 collections" line:

```ts
    for (const [name, c] of Object.entries(m.data)) {
      if (!c.search) continue;
      const props = typeof c.schema.properties === "object" && c.schema.properties !== null ? (c.schema.properties as Record<string, unknown>) : {};
      for (const f of searchFields(c.search)) {
        if (!Object.hasOwn(props, f)) ctx.addIssue({ code: "custom", path: ["data", name, "search"], message: `"${f}" is not a field of the schema` });
      }
      const panel = c.search.panel;
      if (panel !== undefined && !m.panels.some((p) => p.id === panel)) ctx.addIssue({ code: "custom", path: ["data", name, "search", "panel"], message: `"${panel}" is not a declared panel` });
    }
```

`pluginCollections` needs no change: it hands `{ ...c, schema }` to `collectionSchema`, whose `search` object drops `panel`.

- [ ] **Step 5: Run the test and the package's tests**

Run: `corepack pnpm vitest run packages/harness-sdk`
Expected: PASS (the new file and every existing one).

- [ ] **Step 6: Commit**

```bash
git add packages/harness-sdk/src/data.ts packages/harness-sdk/src/plugin.ts packages/harness-sdk/test/collection-search.test.ts
git commit -m "feat(sdk): collections opt in to search with search: { title, text }

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 2: Data documents in `@humanharness/search`

**Files:**
- Modify: `packages/search/src/types.ts`, `packages/search/src/options.ts`, `packages/search/src/query.ts`, `packages/search/src/docs.ts`
- Test: `packages/search/test/data-docs.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/search/test/data-docs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type DataSource, INDEX_KINDS, KINDS, LiveIndex, dataDocs, recordRows } from "../src";

const people = { key: "id", single: false, search: { title: "name", text: ["bio", "tags"] } };
const src = (o: Partial<DataSource> = {}): DataSource => ({ id: "harness:_app/people", owner: "harness", collection: "people", folder: "_app", stamp: "1:2", ...o });

describe("data records (search spec D4)", () => {
  it("adds a data kind to the index; KINDS stays plan 1's", () => {
    expect(KINDS).toEqual(["task", "note", "file"]);
    expect(INDEX_KINDS).toEqual(["task", "note", "file", "data"]);
  });

  it("one row per record: the declared title and text, the key when the title is empty, recency from data-meta", () => {
    const rows = recordRows([{ id: "a", name: "Ana", bio: "Physics teacher", tags: ["lab", "quiz"] }, { id: 7, name: "" }, { name: "no key" }], people, { a: "2026-10-30T10:00:00.000Z" });
    expect(rows).toEqual([
      { key: "a", title: "Ana", text: "Physics teacher\nlab, quiz", at: Date.parse("2026-10-30T10:00:00.000Z") },
      { key: 7, title: "7", text: "", at: 0 },
    ]);
  });

  it("a single collection's record has no key", () => {
    expect(recordRows([{ name: "Me" }], { single: true, search: { title: "name" } })).toEqual([{ key: null, title: "Me", text: "", at: 0 }]);
  });

  it("token-shaped lines never enter the text; a token-shaped title falls back to the key (§8.2)", () => {
    const token = `ghp_${"a1B2".repeat(9)}`;
    const [r] = recordRows([{ id: "k", name: token, bio: `ok line\n${token}` }], people);
    expect(r.title).toBe("k");
    expect(r.text).toContain("ok line");
    expect(r.text).not.toContain("ghp_");
  });

  it("scopes: a scoped collection's folder, else the app; main without scopes; plugin data is app-wide", () => {
    const rows = recordRows([{ id: "a", name: "Ana" }], people);
    expect(dataDocs(src(), rows, true)[0].scope).toBe("_app");
    expect(dataDocs(src({ id: "harness:physics/people", folder: "physics" }), rows, true)[0].scope).toBe("physics");
    expect(dataDocs(src({ id: "harness:physics/people", folder: "physics" }), rows, false)[0].scope).toBe("main");
    expect(dataDocs(src({ id: "plugin:jira/issues", owner: "plugin", plugin: "jira", pluginName: "Jira", panel: "main", collection: "issues" }), rows, true)[0]).toMatchObject({
      id: "data:plugin:jira/issues#a",
      kind: "data",
      scope: "_app",
      data: { source: "plugin:jira/issues", owner: "plugin", plugin: "jira", pluginName: "Jira", panel: "main", collection: "issues", key: "a" },
    });
  });

  it("is found by title and text; a hit carries where it opens; the text is never stored (§4.1)", () => {
    const index = LiveIndex.empty();
    index.upsert(dataDocs(src(), recordRows([{ id: "a", name: "Ana", bio: "Physics teacher" }], people), false));
    const [hit] = index.search("physics").hits;
    expect(hit).toMatchObject({ id: "data:harness:_app/people#a", kind: "data", title: "Ana", data: { collection: "people", key: "a", folder: "_app" } });
    expect(index.stored(hit.id)).not.toHaveProperty("text");
    expect(index.toJSON()).not.toContain("Physics teacher");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm vitest run packages/search/test/data-docs.test.ts`
Expected: FAIL, `INDEX_KINDS` (and `recordRows`, `dataDocs`) are not exported.

- [ ] **Step 3: The types**

In `packages/search/src/types.ts`, replace the two kind lines:

```ts
/** Plan 1's kinds, and plan 2's opt-in data records (D4). Settings and commands never enter the index (§4.2). */
export type Kind = "task" | "note" | "file" | "data";
/** Plan 1's file-backed kinds (the worker's). */
export const KINDS: readonly Kind[] = ["task", "note", "file"];
/** Every kind the index answers, in the palette's order (§3). */
export const INDEX_KINDS: readonly Kind[] = ["task", "note", "file", "data"];
```

In `SearchDoc`, after `meta?: DocMeta;`:

```ts
  /** A record of a searchable collection: where it is and what opens it. */
  data?: DataRef;
```

At the end of the file:

```ts
/**
 * A searchable collection's records in one place (D4): a harness collection in one scope folder, or a running
 * plugin's collection. Built by main; the service reads it again only when `stamp` changes.
 */
export interface DataSource {
  /** `harness:<folder>/<collection>` or `plugin:<plugin>/<collection>`. */
  id: string;
  owner: "harness" | "plugin";
  plugin?: string;
  /** The plugin's name, for the row's tag. */
  pluginName?: string;
  /** The panel a plugin record opens in; absent: none opens. */
  panel?: string;
  collection: string;
  /** The scope folder the store reads (`_app`, a scope id, or `main`). */
  folder: string;
  /** The collection file's size and mtime (and the panel): unchanged, its records aren't read again. */
  stamp: string;
}

/** One record as search sees it: its key (null for a `single` collection), title, text and last change. */
export interface DataRow {
  key: string | number | null;
  title: string;
  text: string;
  at: number;
}

/** What a data document stores to open its record (never the text). */
export type DataRef = Omit<DataSource, "id" | "stamp"> & { source: string; key: string | number | null };

/** A source's state in `files.json`: the stamp it was read at and its documents. */
export interface DataMeta {
  stamp: string;
  ids: string[];
}
```

- [ ] **Step 4: Store `data` and return it on hits**

In `packages/search/src/options.ts`:

```ts
export const STORE_FIELDS = ["kind", "scope", "title", "path", "at", "root", "chat", "action", "task", "meta", "data"] as const;
```

In `packages/search/src/query.ts`, in `toHit`, after the `meta` line:

```ts
    ...(r.meta ? { meta: r.meta } : {}),
    ...(r.data ? { data: r.data } : {}),
```

- [ ] **Step 5: The builders**

In `packages/search/src/docs.ts`, change the imports:

```ts
import { secretShaped, withoutSecretLines } from "./secrets";
import type { DataRow, DataSource, SearchDoc } from "./types";
```

and append:

```ts
/** A record's key as text: `""` for the one record of a `single` collection (data-meta's key for it). */
export const recordKeyText = (key: string | number | null): string => (key === null ? "" : String(key));
export const dataDocId = (source: string, key: string | number | null): string => `data:${source}#${recordKeyText(key)}`;
/** At most this many records across every searchable collection: main's memory stays bounded (plan deviation 5). */
export const MAX_DATA_DOCS = 20_000;

/** A field's value as searchable text: strings, numbers, booleans and lists of them; anything else is skipped. */
export function fieldText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string" || typeof x === "number").join(", ");
  return "";
}

/** What `recordRows` needs of a collection: its key (or `single`) and its `search`. */
export interface RecordSearch {
  key?: string;
  single: boolean;
  search: { title: string; text?: string | readonly string[] };
}

/**
 * The records of one collection as rows (D4): the declared title (else the key), the declared text fields joined by
 * lines without token-shaped ones (§8.2), and when each changed (data-meta, by key text). No usable key: skipped.
 */
export function recordRows(records: readonly Record<string, unknown>[], c: RecordSearch, changedAt: Record<string, string> = {}): DataRow[] {
  const textFields = c.search.text === undefined ? [] : typeof c.search.text === "string" ? [c.search.text] : [...c.search.text];
  const out: DataRow[] = [];
  for (const r of c.single ? records.slice(0, 1) : records) {
    const raw = c.single ? null : r[c.key ?? ""];
    const key = c.single ? null : typeof raw === "string" || typeof raw === "number" ? raw : undefined;
    if (key === undefined) continue;
    const named = fieldText(r[c.search.title]).trim();
    const title = named && !secretShaped(named) ? cut(named) : recordKeyText(key);
    if (!title) continue;
    const text = withoutSecretLines(textFields.map((f) => fieldText(r[f])).filter(Boolean).join("\n"));
    out.push({ key, title, text, at: Date.parse(changedAt[recordKeyText(key)] ?? "") || 0 });
  }
  return out;
}

/** One `data` document per row. Its scope (§7): `main` without scopes; else a scoped harness folder, or `_app`. */
export function dataDocs(s: DataSource, rows: readonly DataRow[], scoped: boolean): SearchDoc[] {
  const scope = !scoped ? MAIN_SCOPE : s.owner === "harness" && s.folder !== APP_SCOPE ? s.folder : APP_SCOPE;
  return rows.map((r) => ({
    id: dataDocId(s.id, r.key),
    kind: "data",
    scope,
    title: r.title,
    path: "",
    text: r.text,
    at: r.at,
    data: {
      source: s.id,
      owner: s.owner,
      ...(s.plugin ? { plugin: s.plugin } : {}),
      ...(s.pluginName ? { pluginName: s.pluginName } : {}),
      ...(s.panel ? { panel: s.panel } : {}),
      collection: s.collection,
      folder: s.folder,
      key: r.key,
    },
  }));
}
```

- [ ] **Step 6: Run the package's tests**

Run: `corepack pnpm vitest run packages/search`
Expected: PASS (`options.test.ts` still finds three `KINDS` and `INDEX_VERSION` 1).

- [ ] **Step 7: Typecheck**

Run: `corepack pnpm typecheck`
Expected: errors only where the shell maps `Kind` to the protocol's `SearchKind` (`service.ts` `EMPTY_COUNTS`/`counts[h.kind]`, `views.ts` `kind:`). If so, go on: Task 3 widens the protocol and Task 5 the service; commit this task only once Step 6 passes and note the typecheck errors are those two files. If `typecheck` shows any other error, fix it here.

Note for the reviewer: to keep every commit green, run Step 7 again after Task 3 and Task 5; from Task 5 on, `typecheck` must be clean.

- [ ] **Step 8: Commit**

```bash
git add packages/search/src packages/search/test/data-docs.test.ts
git commit -m "feat(search): data documents from a collection's declared fields

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 3: The protocol's data kind, record targets and `client.search.onOpenRecord`

**Files:**
- Modify: `packages/protocol/src/views.ts`, `packages/protocol/src/shared.ts`, `packages/protocol/src/client.ts`
- Modify: `packages/shell/src/preload/search.ts`, `packages/shell/src/main/search/ipc.ts`, `packages/shell/src/main/search/views.ts`, `packages/shell/src/main/search/service.ts`
- Modify: `packages/ui/test/fake-client.ts`, `packages/ui/src/search/intent.ts`, `packages/ui/src/search/model.ts`, `packages/ui/src/search/SearchPalette.tsx`, `packages/ui/src/search/SearchHost.tsx`, `packages/ui/src/ChatView.tsx`
- Modify: `packages/i18n/src/locales/en.json`
- Test: `packages/shell/test/search-records-preload.test.ts`, `packages/ui/test/search-records.test.tsx`

- [ ] **Step 1: Write the failing tests**

`packages/shell/test/search-records-preload.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { searchClient } from "../src/preload/search";

describe("client.search records (search spec §9, plan deviation 9)", () => {
  it("one listener per collection; the last one wins; unsubscribing only drops its own", () => {
    const c = searchClient(vi.fn(), () => () => {});
    expect(c.handlesRecord("people")).toBe(false);
    expect(c.openRecord("people", "a", "_app")).toBe(false);
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = c.onOpenRecord("people", first);
    const offSecond = c.onOpenRecord("people", second);
    offFirst();
    expect(c.handlesRecord("people")).toBe(true);
    expect(c.openRecord("people", "a", "_app")).toBe(true);
    expect(second).toHaveBeenCalledWith("a", "_app");
    expect(first).not.toHaveBeenCalled();
    offSecond();
    expect(c.openRecord("people", null, "_app")).toBe(false);
  });
});
```

`packages/ui/test/search-records.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessApp } from "../src";
import type { SearchAnswer, SearchHitView } from "../src/client";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const ANA: SearchHitView = { id: "data:harness:_app/people#a", kind: "data", title: [{ text: "Ana" }], context: [], hint: null, target: { kind: "record", collection: "people", key: "a", scope: "_app" } };
const ISSUE: SearchHitView = { id: "data:plugin:jira/issues#J-1", kind: "data", title: [{ text: "Login fails" }], context: [], plugin: "Jira", hint: null, target: { kind: "none" } };
const answer = (query: string, hits: SearchHitView[]): SearchAnswer => ({
  ok: true,
  query,
  groups: [{ kind: "data", total: hits.length, hits }],
  counts: { task: 0, note: 0, file: 0, data: hits.length },
  recent: [],
  partial: false,
  status: { state: "ready", done: 1, total: 1 },
  allScopes: false,
});

async function startWork() {
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  await screen.findByPlaceholderText(/Write a message…/);
}

describe("data records in the palette (search spec §3 Data)", () => {
  it("a harness record goes to the view that listens for its collection", async () => {
    const client = new FakeClient(ready);
    client.searchAnswers.ana = answer("ana", [ANA]);
    const heard = vi.fn();
    client.search.onOpenRecord("people", heard);
    render(<HarnessApp client={client} />);
    await startWork();
    act(() => client.search.open("ana"));
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    expect(within(dialog).getByRole("group", { name: "Data" })).toBeTruthy();
    expect(within(dialog).queryByText("Shown in Demo")).toBeNull();
    fireEvent.click(await within(dialog).findByRole("option"));
    await waitFor(() => expect(heard).toHaveBeenCalledWith("a", "_app"));
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
  });

  it('without a listener the row says "Shown in <harness>"; a plugin record without a panel says where it is from and opens nothing', async () => {
    const client = new FakeClient(ready);
    client.searchAnswers.x = answer("x", [ANA, ISSUE]);
    render(<HarnessApp client={client} />);
    await startWork();
    act(() => client.search.open("x"));
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    expect(await within(dialog).findByText("Shown in Demo")).toBeTruthy();
    expect(within(dialog).getByText("From Jira")).toBeTruthy();
    fireEvent.click(within(dialog).getAllByRole("option")[1]);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
    expect(client.searchOpened.map((h) => h.id)).toEqual([ISSUE.id]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/shell/test/search-records-preload.test.ts packages/ui/test/search-records.test.tsx`
Expected: FAIL, `handlesRecord` / `onOpenRecord` are not functions.

- [ ] **Step 3: The protocol types**

In `packages/protocol/src/views.ts`, after `export type SearchKind = "task" | "note" | "file";`:

```ts
/** Every kind the index answers: plan 1's, and opt-in data records (D4). */
export type SearchIndexKind = SearchKind | "data";
/** Every kind a result row can be. */
export type SearchRowKind = SearchIndexKind;
```

In `SearchTarget`, after `| { kind: "reveal" }`, replace the final `;` so it reads:

```ts
  | { kind: "reveal" }
  /** A harness record: the view listening with `client.search.onOpenRecord` opens it; `key` null for a `single` collection. */
  | { kind: "record"; collection: string; key: string | number | null; scope: string }
  /** A plugin record: the plugin's panel, with the record's key as `focus`. */
  | { kind: "panel"; plugin: string; panel: string; focus: string }
  /** Nothing opens it (a plugin record whose plugin has no panel). */
  | { kind: "none" };
```

In `SearchHitView`, change `kind: SearchKind;` to `kind: SearchRowKind;` and after `scope?: string;` add:

```ts
  /** A plugin record: the plugin's name (the row says "From <plugin>"). */
  plugin?: string;
```

In `SearchFilters`, `kind?: SearchIndexKind;`. In `SearchGroup`, `kind: SearchIndexKind;`. In `SearchAnswer`, `counts: Record<SearchKind, number> & { data?: number };`.

In `packages/protocol/src/shared.ts`, add `SearchIndexKind` to the type import from `./views` and append:

```ts
/** Every kind main's index answers, in the palette's order (search spec §3). */
export const SEARCH_INDEX_KINDS: readonly SearchIndexKind[] = ["task", "note", "file", "data"];
```

In `packages/protocol/src/client.ts`, at the end of `SearchClient` (after `onOpen`):

```ts
  /**
   * A harness view opens its own records (§3 Data): `listener` gets the record's key (null for a `single` collection)
   * and the scope folder. One listener per collection; the last one registered wins. Answers the unsubscribe.
   */
  onOpenRecord(collection: string, listener: (key: string | number | null, scope: string) => void): () => void;
  /** The window hands a picked record to the view listening for `collection`; false when none does. */
  openRecord(collection: string, key: string | number | null, scope: string): boolean;
  /** A view listens for `collection` now. */
  handlesRecord(collection: string): boolean;
```

- [ ] **Step 4: The preload and the fake client**

In `packages/shell/src/preload/search.ts`, after `const openers = …;`:

```ts
  const records = new Map<string, (key: string | number | null, scope: string) => void>();
```

and after the `onOpen` member:

```ts
    onOpenRecord: (collection, listener) => {
      records.set(collection, listener);
      return () => {
        if (records.get(collection) === listener) records.delete(collection);
      };
    },
    openRecord: (collection, key, scope) => {
      const listener = records.get(collection);
      if (!listener) return false;
      listener(key, scope);
      return true;
    },
    handlesRecord: (collection) => records.has(collection),
```

In `packages/ui/test/fake-client.ts`, after `private searchStatusListeners = …;`:

```ts
  private searchRecords = new Map<string, (key: string | number | null, scope: string) => void>();
```

and inside `readonly search: SearchClient = {`, after the `onOpen` member:

```ts
    onOpenRecord: (collection, l) => {
      this.searchRecords.set(collection, l);
      return () => {
        if (this.searchRecords.get(collection) === l) this.searchRecords.delete(collection);
      };
    },
    openRecord: (collection, key, scope) => {
      const l = this.searchRecords.get(collection);
      if (!l) return false;
      l(key, scope);
      return true;
    },
    handlesRecord: (collection) => this.searchRecords.has(collection),
```

- [ ] **Step 5: Main keeps compiling (the data kind arrives in Task 5)**

In `packages/shell/src/main/search/ipc.ts`, import `SEARCH_INDEX_KINDS` instead of `SEARCH_KINDS` and use it in `cleanFilters`:

```ts
import { SEARCH_INDEX_KINDS } from "@humanharness/protocol";
```

```ts
  const kind = SEARCH_INDEX_KINDS.find((k) => k === v.kind);
```

In `packages/shell/src/main/search/service.ts`, change the protocol import to add `SearchIndexKind`, and replace `EMPTY_COUNTS`:

```ts
const EMPTY_COUNTS = (): Record<SearchIndexKind, number> => ({ task: 0, note: 0, file: 0, data: 0 });
```

In `packages/shell/src/main/search/views.ts`, `targetOf` gets a first line for data (the `data` field is on hits since Task 2):

```ts
export function targetOf(hit: SearchHit, anchor?: string): SearchTarget {
  if (hit.data) {
    const d = hit.data;
    if (d.owner === "plugin") return d.plugin && d.panel ? { kind: "panel", plugin: d.plugin, panel: d.panel, focus: d.key === null ? "" : String(d.key) } : { kind: "none" };
    return { kind: "record", collection: d.collection, key: d.key, scope: d.folder };
  }
```

(the rest of `targetOf` stays). In `hintOf`, the first line:

```ts
  if (hit.kind === "data") return null;
```

In `hitView`, the context line and the plugin tag:

```ts
    context: c.snippet?.marked ?? (hit.kind === "task" || hit.kind === "data" ? [] : [{ text: hit.path }]),
    ...(hit.meta ? { meta: hit.meta } : {}),
    ...(hit.data?.pluginName !== undefined ? { plugin: hit.data.pluginName } : {}),
```

- [ ] **Step 6: The window**

`packages/ui/src/search/intent.ts`:

```ts
import type { SearchTarget } from "../client";

/** What the window does with a result (search spec §3) or a ⌘Enter question (§5.4). `reveal` is main's; `none` opens nothing. */
export type SearchIntent = Exclude<SearchTarget, { kind: "reveal" } | { kind: "none" }> | { kind: "draft"; text: string };
```

`packages/ui/src/search/model.ts`: import `SEARCH_INDEX_KINDS` and `SearchRowKind` from `../client` instead of `SEARCH_KINDS`/`SearchKind`, and replace `Section`, `Chip` and `chipsOf`:

```ts
import { SEARCH_INDEX_KINDS, type SearchAnswer, type SearchHitView, type SearchRowKind } from "../client";

export interface Section {
  key: SearchRowKind | "recent";
  hits: SearchHitView[];
}
```

```ts
/** §5.5: "All · N", then one chip per kind that has results. `kind` null: All. */
export interface Chip {
  kind: SearchRowKind | null;
  count: number;
}

export function chipsOf(a: SearchAnswer | null): Chip[] {
  if (!a?.ok || !a.query.trim()) return [];
  const count = (k: SearchRowKind) => (k === "data" ? (a.counts.data ?? 0) : a.counts[k]);
  const all = SEARCH_INDEX_KINDS.reduce((n, k) => n + count(k), 0);
  if (all === 0) return [];
  return [{ kind: null, count: all }, ...SEARCH_INDEX_KINDS.filter((k) => count(k) > 0).map((k) => ({ kind: k, count: count(k) }))];
}
```

`packages/ui/src/search/SearchPalette.tsx`:
- the import line: replace `SearchKind` with `SearchIndexKind, SearchRowKind`;
- `HitRow` takes a `tag` and draws it after the scope tag:

```tsx
function HitRow({ id, hit, tag, active, onPick, onHover }: { id: string; hit: SearchHitView; tag: string | null; active: boolean; onPick: () => void; onHover: () => void }) {
```

```tsx
      {hit.scope !== undefined && <span className="hh-search-tag">{hit.scope}</span>}
      {tag !== null && <span className="hh-search-tag">{tag}</span>}
```

- the props gain `harnessName?: string;` (after `references: boolean;`, documented "The harness's name, for a record no view opens: "Shown in <harness>"."), and the function signature destructures `harnessName`;
- `const [kind, setKind] = useState<SearchRowKind | null>(null);`
- the filters line sends only an index kind:

```tsx
    const filters: SearchFilters = { ...(kind && isIndexKind(kind) ? { kind } : {}), ...(allScopes !== null ? { allScopes } : {}), ...(refs ? {} : { references: false }) };
```

with, above the component:

```tsx
const INDEX_KINDS: readonly SearchRowKind[] = ["task", "note", "file", "data"];
const isIndexKind = (k: SearchRowKind): k is SearchIndexKind => INDEX_KINDS.includes(k);
```

- before `let index = 0;`:

```tsx
  /** A record no view opens says where it lives (§3 Data); a plugin's says which plugin. */
  const tagOf = (hit: SearchHitView): string | null => {
    if (hit.target.kind === "record" && harnessName !== undefined && !client.search.handlesRecord(hit.target.collection)) return t("search.shownIn", { name: harnessName });
    return hit.plugin !== undefined ? t("search.fromPlugin", { plugin: hit.plugin }) : null;
  };
```

- the row: `<HitRow key={hit.id} id={optionId(i)} hit={hit} tag={tagOf(hit)} active={i === active} onPick={() => onPick(hit)} onHover={() => setActive(i)} />`.

`packages/ui/src/search/SearchHost.tsx`, in `pick`:

```tsx
    if (hit.target.kind !== "reveal" && hit.target.kind !== "none") onIntent(hit.target);
```

and the palette gets the name: after `references={…}` add `harnessName={state.harness.name}`.

`packages/ui/src/ChatView.tsx`, in `runSearchIntent`, after the `draft` case:

```tsx
      case "record":
        // The harness view's own handler (client.search.onOpenRecord); none listening: nothing opens (§3).
        return client.search.openRecord(intent.collection, intent.key, intent.scope);
      case "panel":
        if (!surfaceCtx) return false;
        openPanel(intent.plugin, intent.panel, intent.focus);
        return true;
```

`packages/i18n/src/locales/en.json`, under `search`: `"kind"` becomes

```json
    "kind": { "task": "Tasks", "note": "Notes", "file": "Files", "data": "Data" },
```

and after `"readOnly": …,`:

```json
    "shownIn": "Shown in {{name}}",
    "fromPlugin": "From {{plugin}}",
```

- [ ] **Step 7: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/search-records-preload.test.ts packages/ui/test/search-records.test.tsx packages/ui/test/search-palette.test.tsx packages/ui/test/search-host.test.tsx packages/ui/test/search-model.test.ts packages/shell/test/search-preload.test.ts packages/shell/test/search-ipc.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck**

Run: `corepack pnpm typecheck`
Expected: clean except, at most, `service.ts`'s `counts[h.kind]`/grouping lines Task 5 rewrites. If those are the only errors, commit; Task 5 closes them.

- [ ] **Step 9: Commit**

```bash
git add packages/protocol/src packages/shell/src/preload/search.ts packages/shell/src/main/search packages/ui/src packages/ui/test/fake-client.ts packages/ui/test/search-records.test.tsx packages/shell/test/search-records-preload.test.ts packages/i18n/src/locales/en.json
git commit -m "feat(search): record rows open in the harness view or the plugin's panel

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 4: The snapshot keeps each data source's stamp and ids

**Files:**
- Modify: `packages/shell/src/main/search/store.ts`
- Test: `packages/shell/test/search-store-data.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/shell/test/search-store-data.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IndexStore, type Snapshot, searchDir } from "../src/main/search/store";

let userData: string;
beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-store-data-"));
});
afterEach(() => fs.rmSync(userData, { recursive: true, force: true }));

const snap = (o: Partial<Snapshot> = {}): Snapshot => ({ index: '{"x":1}', files: {}, chats: {}, memory: [], truncated: false, ...o });

describe("IndexStore data meta (search spec D4)", () => {
  it("round-trips each source's stamp and ids", async () => {
    const store = new IndexStore(searchDir(userData, "/w/a"));
    const data = { "harness:_app/people": { stamp: "10:20", ids: ["data:harness:_app/people#a"] } };
    store.schedule(() => snap({ data }));
    await store.flush();
    expect(await store.load()).toEqual(snap({ data }));
  });

  it("a snapshot without data loads without it; a bad data shape throws the snapshot away", async () => {
    const store = new IndexStore(searchDir(userData, "/w/a"));
    store.schedule(() => snap());
    await store.flush();
    expect(await store.load()).not.toHaveProperty("data");
    const file = path.join(store.dir, "files.json");
    const meta = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify({ ...meta, data: { x: { stamp: 1, ids: "no" } } }));
    expect(await store.load()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm vitest run packages/shell/test/search-store-data.test.ts`
Expected: FAIL, the loaded snapshot has no `data` (first test) and the bad shape loads (second).

- [ ] **Step 3: Implement**

In `packages/shell/src/main/search/store.ts`, import `type DataMeta` with the other search types:

```ts
import { type ChatMeta, type DataMeta, type FileMeta, INDEX_VERSION } from "@humanharness/search";
```

In `Snapshot`, after `truncated: boolean;`:

```ts
  /** Each searchable collection's stamp and documents (D4); absent in a snapshot made before any was indexed. */
  data?: Record<string, DataMeta>;
```

After `isChatMeta`:

```ts
const isDataMeta = (v: unknown) => isObject(v) && typeof v.stamp === "string" && Array.isArray(v.ids) && v.ids.every((i) => typeof i === "string");
```

In `load`, after the second validity check:

```ts
      if (meta.data !== undefined && (!isObject(meta.data) || !Object.values(meta.data).every(isDataMeta))) return null;
```

and its return:

```ts
      return {
        index,
        files: meta.files as Record<string, FileMeta>,
        chats: meta.chats as Record<string, ChatMeta>,
        memory: meta.memory as string[],
        truncated: meta.truncated === true,
        ...(isObject(meta.data) ? { data: meta.data as Record<string, DataMeta> } : {}),
      };
```

In `writeNow`, the `files.json` line:

```ts
        await writeAtomic(path.join(this.dir, "files.json"), JSON.stringify({ version: INDEX_VERSION, files: s.files, chats: s.chats, memory: s.memory, truncated: s.truncated, ...(s.data ? { data: s.data } : {}) }));
```

- [ ] **Step 4: Run the store tests**

Run: `corepack pnpm vitest run packages/shell/test/search-store-data.test.ts packages/shell/test/search-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shell/src/main/search/store.ts packages/shell/test/search-store-data.test.ts
git commit -m "feat(search): the snapshot keeps each data source's stamp and documents

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 5: The service indexes data records

**Files:**
- Modify: `packages/shell/src/main/search/service.ts`
- Test: `packages/shell/test/search-service-data.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/shell/test/search-service-data.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer } from "@humanharness/protocol";
import type { DataRow, DataSource } from "@humanharness/search";
import { inProcessBuild } from "../src/main/search/runner";
import { SearchService, type SearchServiceDeps } from "../src/main/search/service";

let tmp: string;
let base: string;
let userData: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-data-"));
  base = path.join(tmp, "Work");
  userData = path.join(tmp, "userData");
  fs.mkdirSync(base, { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const PEOPLE: DataSource = { id: "harness:_app/people", owner: "harness", collection: "people", folder: "_app", stamp: "1" };
const ISSUES: DataSource = { id: "plugin:jira/issues", owner: "plugin", plugin: "jira", pluginName: "Jira", panel: "main", collection: "issues", folder: "_app", stamp: "1:main" };

function dataDeps() {
  const state = {
    sources: [PEOPLE] as DataSource[],
    rows: { [PEOPLE.id]: [{ key: "a", title: "Ana", text: "Physics teacher", at: 0 }], [ISSUES.id]: [{ key: "J-1", title: "Login fails", text: "", at: 0 }] } as Record<string, DataRow[]>,
  };
  const sources = vi.fn(async () => state.sources);
  const rows = vi.fn(async (s: DataSource) => state.rows[s.id] ?? []);
  return { state, data: { sources, rows } };
}

function service(o: Partial<SearchServiceDeps> = {}) {
  return new SearchService({
    userData: () => userData,
    base: async () => base,
    scoped: () => false,
    openScope: async () => null,
    scopeTitles: async () => new Map(),
    references: async () => [],
    memory: async () => [],
    extraDenied: async () => [],
    status: () => {},
    runner: inProcessBuild(),
    reveal: vi.fn(async () => true),
    storeDelayMs: 10,
    ...o,
  });
}
const ok = (a: SearchAnswer) => {
  if (!a.ok) throw new Error(`not ok: ${a.reason}`);
  return a;
};

describe("SearchService data records (search spec D4)", () => {
  it("D0: a data change before the first search reads nothing", async () => {
    const { data } = dataDeps();
    const svc = service({ data });
    svc.dataChanged();
    svc.committed([".harness/data/_app/people.json"]);
    await svc.flush();
    expect(data.sources).not.toHaveBeenCalled();
  });

  it("finds a record by its text: a Data group, the record's target, a snippet, a count", async () => {
    const { data } = dataDeps();
    const svc = service({ data });
    const a = ok(await svc.query("physics", {}));
    const group = a.groups.find((g) => g.kind === "data")!;
    expect(group.hits[0]).toMatchObject({ id: "data:harness:_app/people#a", kind: "data", hint: null, target: { kind: "record", collection: "people", key: "a", scope: "_app" } });
    expect(group.hits[0].context.some((p) => p.mark && p.text === "Physics")).toBe(true);
    expect(a.counts.data).toBe(1);
    expect(ok(await svc.query("physics", { kind: "data" })).groups.map((g) => g.kind)).toEqual(["data"]);
    await svc.flush();
  });

  it("a plugin record opens its panel and names its plugin; no panel opens nothing", async () => {
    const { state, data } = dataDeps();
    state.sources = [ISSUES];
    const svc = service({ data });
    const hit = ok(await svc.query("login", {})).groups.find((g) => g.kind === "data")!.hits[0];
    expect(hit).toMatchObject({ plugin: "Jira", target: { kind: "panel", plugin: "jira", panel: "main", focus: "J-1" } });
    state.sources = [{ ...ISSUES, panel: undefined, stamp: "1:" }];
    await svc.query("", {});
    expect(ok(await svc.query("login", {})).groups.find((g) => g.kind === "data")!.hits[0].target).toEqual({ kind: "none" });
    await svc.flush();
  });

  it("an unchanged stamp is not read again; a new stamp is; a source gone takes its records out", async () => {
    const { state, data } = dataDeps();
    const svc = service({ data });
    await svc.query("", {});
    await svc.query("", {});
    expect(data.rows).toHaveBeenCalledTimes(1);
    state.rows[PEOPLE.id] = [{ key: "b", title: "Bruno", text: "Chemistry", at: 0 }];
    state.sources = [{ ...PEOPLE, stamp: "2" }];
    await svc.query("", {});
    expect(data.rows).toHaveBeenCalledTimes(2);
    expect(ok(await svc.query("physics", {})).groups.some((g) => g.kind === "data")).toBe(false);
    expect(ok(await svc.query("chemistry", {})).counts.data).toBe(1);
    state.sources = [];
    await svc.query("", {});
    expect(ok(await svc.query("chemistry", {})).counts.data).toBe(0);
    await svc.flush();
  });

  it("a commit under .harness/data/ (or a restore) reads the collections again", async () => {
    const { state, data } = dataDeps();
    const svc = service({ data });
    await svc.query("", {});
    state.sources = [{ ...PEOPLE, stamp: "2" }];
    svc.committed(["docs/a.md"]);
    await svc.whenIdle();
    expect(data.rows).toHaveBeenCalledTimes(1);
    svc.committed([".harness/data/_app/people.json"]);
    await svc.whenIdle();
    expect(data.rows).toHaveBeenCalledTimes(2);
    state.sources = [{ ...PEOPLE, stamp: "3" }];
    svc.dataChanged();
    await svc.whenIdle();
    expect(data.rows).toHaveBeenCalledTimes(3);
    await svc.flush();
  });

  it("the snapshot keeps the records: a restart with the same stamp reads nothing and still finds them", async () => {
    const first = dataDeps();
    const svc = service({ data: first.data });
    await svc.query("", {});
    await svc.whenIdle();
    await svc.flush();
    const second = dataDeps();
    const again = service({ data: second.data });
    await again.query("", {});
    expect(second.data.rows).not.toHaveBeenCalled();
    expect(ok(await again.query("ana", {})).counts.data).toBe(1);
    await again.flush();
  });

  it("a source that fails to read keeps what the index had", async () => {
    const { state, data } = dataDeps();
    const svc = service({ data });
    await svc.query("", {});
    state.sources = [{ ...PEOPLE, stamp: "2" }];
    data.rows.mockRejectedValueOnce(new Error("disk"));
    await svc.query("", {});
    expect(ok(await svc.query("ana", {})).counts.data).toBe(1);
    await svc.flush();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm vitest run packages/shell/test/search-service-data.test.ts`
Expected: FAIL, `svc.dataChanged is not a function` (and no data group).

- [ ] **Step 3: Implement**

In `packages/shell/src/main/search/service.ts`:

Imports: add `SearchIndexKind` to the protocol import (Task 3 may have added it already), and to the `@humanharness/search` import add `type DataMeta`, `type DataRow`, `type DataSource`, `INDEX_KINDS`, `MAX_DATA_DOCS`, `dataDocs`, `recordKeyText`; drop `KINDS` (no longer used).

After `SearchReference`:

```ts
/** Searchable collections (D4), read through main's stores. Absent (tests of plan 1): no data documents. */
export interface SearchDataDeps {
  sources(): Promise<DataSource[]>;
  rows(source: DataSource): Promise<DataRow[]>;
}
```

In `SearchServiceDeps`, after `reveal`:

```ts
  /** Searchable collections (D4); absent: none. */
  data?: SearchDataDeps;
```

In `Live`, after `again`:

```ts
  /** Each searchable collection's stamp and documents (D4). */
  data: Record<string, DataMeta>;
  dataAt: number;
  /** A data refresh under way; `dataAgain`: one more was asked for meanwhile. */
  dataRun: Promise<void> | null;
  dataAgain: boolean;
```

In `accounted`, after the chats loop:

```ts
  for (const m of Object.values(snap.data ?? {})) for (const id of m.ids) keep.add(id);
```

In `load`, the `live` object gets, after `again: null,`:

```ts
      data: index && snap ? (snap.data ?? {}) : {},
      dataAt: 0,
      dataRun: null,
      dataAgain: false,
```

`save` keeps the data meta:

```ts
  private save(live: Live): void {
    live.store.schedule(() => ({
      index: live.index.toJSON(),
      files: live.files,
      chats: live.chats,
      memory: [...live.memory],
      truncated: live.truncated,
      ...(Object.keys(live.data).length > 0 ? { data: live.data } : {}),
    }));
  }
```

After `refreshMemory`, add:

```ts
  /** Searchable collections (D4): one refresh at a time; one asked for meanwhile runs once more after it. */
  private refreshData(live: Live): Promise<void> {
    if (!this.d.data) return Promise.resolve();
    if (live.dataRun) {
      live.dataAgain = true;
      return live.dataRun;
    }
    const run = (async () => {
      do {
        live.dataAgain = false;
        await this.syncData(live);
      } while (live.dataAgain && this.live === live);
    })().finally(() => {
      live.dataRun = null;
    });
    live.dataRun = run;
    return run;
  }

  /**
   * A source whose stamp changed is read again and its documents replaced; one gone takes its documents out; one that
   * fails keeps what the index had. At most MAX_DATA_DOCS documents in all (plan deviation 5).
   */
  private async syncData(live: Live): Promise<void> {
    const data = this.d.data!;
    const sources = await data.sources().catch((err: unknown) => {
      console.error("Could not list the searchable collections", err instanceof Error ? err.message : "unknown error");
      return null;
    });
    live.dataAt = this.now();
    if (!sources || this.live !== live) return;
    const scoped = this.d.scoped();
    const next: Record<string, DataMeta> = {};
    let room = MAX_DATA_DOCS;
    let changed = false;
    for (const s of sources) {
      const had = live.data[s.id];
      if (had && had.stamp === s.stamp && had.ids.length <= room) {
        next[s.id] = had;
        room -= had.ids.length;
        continue;
      }
      const rows = await data.rows(s).catch((err: unknown) => {
        console.error("Could not read a searchable collection", err instanceof Error ? err.message : "unknown error");
        return null;
      });
      if (this.live !== live) return;
      if (!rows) {
        if (had) {
          next[s.id] = had;
          room -= had.ids.length;
        }
        continue;
      }
      const docs = dataDocs(s, rows.slice(0, Math.max(0, room)), scoped);
      const ids = new Set(docs.map((doc) => doc.id));
      if (had) live.index.remove(had.ids.filter((id) => !ids.has(id)));
      live.index.upsert(docs);
      next[s.id] = { stamp: s.stamp, ids: [...ids] };
      room -= docs.length;
      changed = true;
    }
    for (const [id, m] of Object.entries(live.data)) {
      if (Object.hasOwn(next, id)) continue;
      live.index.remove(m.ids);
      changed = true;
    }
    live.data = next;
    if (changed) {
      live.index.compact();
      this.save(live);
    }
  }
```

`snippet` gets a cache parameter and a data branch first. Its signature and first lines:

```ts
  private async snippet(live: Live, hit: SearchHit, refPaths: Map<string, string>, rowsOf: Map<string, Promise<DataRow[] | null>>): Promise<{ marked: SearchMarked; anchor?: string } | null> {
    if (hit.data) {
      // A record's text is never stored (§4.1): its collection is read again, once per answer.
      const data = this.d.data;
      if (!data) return null;
      const { source, key, ...rest } = hit.data;
      let rows = rowsOf.get(source);
      if (!rows) {
        rows = data.rows({ ...rest, id: source, stamp: "" }).catch(() => null);
        rowsOf.set(source, rows);
      }
      const row = (await rows)?.find((r) => recordKeyText(r.key) === recordKeyText(key));
      const s = row ? snippetAround(row.text, hit.terms) : null;
      return s ? { marked: s.marked } : null;
    }
```

(the rest of `snippet` stays). In `views`, before the loop:

```ts
    const rowsOf = new Map<string, Promise<DataRow[] | null>>();
```

and the snippet call passes it: `await this.snippet(live, hit, refPaths, rowsOf)`.

In `query`, after the memory line:

```ts
    if (empty || this.now() - live.dataAt > MEMORY_FRESH_MS) await this.refreshData(live);
```

and the counting and grouping use every index kind:

```ts
    const counts: Record<SearchIndexKind, number> = EMPTY_COUNTS();
    for (const h of hits) counts[h.kind]++;
    const chosen = filters.kind ? hits.filter((h) => h.kind === filters.kind).slice(0, PER_KIND) : INDEX_KINDS.flatMap((k) => hits.filter((h) => h.kind === k).slice(0, PER_GROUP));
    const views = await this.views(live, chosen, open, true);
    const groups = INDEX_KINDS.filter((k) => !filters.kind || k === filters.kind)
      .map((k) => ({ kind: k, total: counts[k], hits: views.filter((v) => v.kind === k) }))
      .filter((g) => g.hits.length > 0);
```

`committed` also refreshes data:

```ts
  /** A commit touched `paths` (null: too many, or a restore). Nothing at all until search was first opened (D0). */
  committed(paths: string[] | null): void {
    const live = this.live;
    if (!live) return;
    this.startBuild(live, paths === null ? "full" : new Set(paths));
    // The walk never reads .harness/data/ (plan 1 deviation 15); its collections come through the stores.
    if (paths === null || paths.some((p) => p.replaceAll("\\", "/").startsWith(".harness/data/"))) this.dataChanged();
  }

  /** A searchable collection changed (a write, a plugin run, a plugin on or off). Nothing until search was opened (D0). */
  dataChanged(): void {
    const live = this.live;
    if (!live || !this.d.data) return;
    void this.refreshData(live).catch(() => undefined);
  }
```

`whenIdle` waits for a data refresh too:

```ts
  /** Settles once no build and no data refresh runs (tests, and a measured build). */
  async whenIdle(): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const b = this.live?.building;
      const r = this.live?.dataRun;
      if (!b && !r) return;
      if (b) await b.done;
      if (r) await r;
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
```

- [ ] **Step 4: Run the service tests**

Run: `corepack pnpm vitest run packages/shell/test/search-service-data.test.ts packages/shell/test/search-service.test.ts packages/shell/test/search-security.test.ts packages/shell/test/search-budget.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `corepack pnpm typecheck`
Expected: clean (the errors Tasks 2 and 3 left in `service.ts` are gone).

- [ ] **Step 6: Commit**

```bash
git add packages/shell/src/main/search/service.ts packages/shell/test/search-service-data.test.ts
git commit -m "feat(search): index searchable collections' records, read again only when they change

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 6: Plugins: searchable sources, their rows and the review line

**Files:**
- Modify: `packages/harness-sdk/src/plugin.ts`, `packages/harness-sdk/src/plugin-permissions.ts`
- Modify: `packages/protocol/src/views.ts`
- Modify: `packages/shell/src/main/plugin-data.ts`, `packages/shell/src/main/plugins.ts`
- Modify: `packages/ui/src/plugins/PermissionReview.tsx`, `packages/i18n/src/locales/en.json`
- Test: `packages/shell/test/plugins-search.test.ts`, `packages/ui/test/permission-searchable.test.tsx`

- [ ] **Step 1: Write the failing tests**

`packages/shell/test/plugins-search.test.ts`:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "@humanharness/harness-sdk";
import { PluginData } from "../src/main/plugin-data";
import { bundled, setup } from "./plugins-fixtures";

const ITEMS = {
  key: "key",
  agent: "read",
  schema: { type: "object", properties: { key: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["key"] },
  search: { title: "title", text: "body" },
};

async function running(over: Record<string, unknown>) {
  const t = await setup({ plugins: { bundled: ["notes"], on: ["notes"], local: false } });
  const dist = await bundled(t.root, "notes", { name: "Notes", data: { items: ITEMS }, ...over });
  await t.ctl.start();
  const manifest = parsePluginManifest(JSON.parse(await fs.readFile(path.join(dist, "plugin.json"), "utf8")));
  return { ...t, store: new PluginData(t.base, manifest) };
}

describe("PluginsController search (search spec D4, §7)", () => {
  it("lists a running plugin's searchable collections; its panel defaults to the first; the stamp follows the file", async () => {
    const t = await running({ panels: [{ id: "list", title: "List" }, { id: "side", title: "Side" }] });
    const [s] = await t.ctl.searchSources();
    expect(s).toMatchObject({ id: "plugin:notes/items", owner: "plugin", plugin: "notes", pluginName: "Notes", panel: "list", collection: "items", folder: "_app" });
    expect(s.stamp).toBe("none:list");
    await t.store.put("items", { key: "a", title: "Groceries", body: "milk and eggs" });
    const [after] = await t.ctl.searchSources();
    expect(after.stamp).not.toBe(s.stamp);
    expect(await t.ctl.searchRows("notes", "items")).toEqual([{ key: "a", title: "Groceries", text: "milk and eggs", at: expect.any(Number) }]);
  });

  it("no panel: none named; a collection without search, a stopped plugin, an unknown one: nothing", async () => {
    const t = await running({ data: { items: ITEMS, plain: { ...ITEMS, search: undefined } } });
    const sources = await t.ctl.searchSources();
    expect(sources.map((s) => s.id)).toEqual(["plugin:notes/items"]);
    expect(sources[0]).not.toHaveProperty("panel");
    expect(await t.ctl.searchRows("notes", "plain")).toEqual([]);
    expect(await t.ctl.searchRows("other", "items")).toEqual([]);
    await t.ctl.setOn("notes", false);
    expect(await t.ctl.searchSources()).toEqual([]);
  });

  it("the permission review says what is searchable", async () => {
    const t = await running({});
    const detail = await t.ctl.detail("notes");
    expect(detail?.review.lines.at(-1)).toEqual({ kind: "searchable", collections: [{ name: "items", fields: ["title", "body"] }] });
  });
});
```

`packages/ui/test/permission-searchable.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";
import { createI18n } from "@humanharness/i18n";
import { PermissionText } from "../src/plugins/PermissionReview";

afterEach(cleanup);

describe("the review's searchable line (search spec §7)", () => {
  it("names each searchable collection and its fields", () => {
    render(
      <I18nextProvider i18n={createI18n("en")}>
        <PermissionText line={{ kind: "searchable", collections: [{ name: "issues", fields: ["title", "body"] }] }} />
      </I18nextProvider>,
    );
    expect(screen.getByText(/Searchable:/).textContent).toBe("Searchable: issues (title, body)");
  });
});
```

(If `createI18n` is not the i18n package's export, use the one the other `packages/ui/test/*.test.tsx` files render with: `grep -n "I18nextProvider\|i18n" packages/ui/test/plugins-*.test.tsx | head`.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/shell/test/plugins-search.test.ts packages/ui/test/permission-searchable.test.tsx`
Expected: FAIL, `searchSources` is not a function; the searchable line renders nothing.

- [ ] **Step 3: The line in the SDK and the protocol**

In `packages/harness-sdk/src/plugin-permissions.ts`, `PermissionLine` gains a variant:

```ts
export type PermissionLine =
  | { kind: "hosts"; hosts: string[] }
  | { kind: "exec"; command: string; readOnly: boolean; wide: boolean }
  | { kind: "secrets"; labels: string[] }
  | { kind: "tasks" }
  /** Global search (search spec §7): what the core indexes of this plugin's data. Not a permission; shown with them. */
  | { kind: "searchable"; collections: { name: string; fields: string[] }[] };
```

`permissionLines` doesn't change. In `packages/harness-sdk/src/plugin.ts`, after `pluginCollections`:

```ts
/** The review's "Searchable:" line (search spec §7); null when no collection opts in. */
export function searchableLine(m: PluginManifest): Extract<PermissionLine, { kind: "searchable" }> | null {
  const collections = Object.entries(m.data).flatMap(([name, c]) => (c.search ? [{ name, fields: searchFields(c.search) }] : []));
  return collections.length > 0 ? { kind: "searchable", collections } : null;
}
```

with `import type { PermissionLine } from "./plugin-permissions";` at the top of `plugin.ts` (if `plugin-permissions.ts` imports from `plugin.ts`, a type-only import keeps it acyclic at runtime). Check `packages/harness-sdk/src/index.ts` re-exports `plugin.ts` with `export *`; if it lists names, add `searchableLine`.

In `packages/protocol/src/views.ts`, `PluginLine` gains the same variant:

```ts
export type PluginLine =
  | { kind: "hosts"; hosts: string[] }
  | { kind: "exec"; command: string; readOnly: boolean; wide: boolean }
  | { kind: "secrets"; labels: string[] }
  | { kind: "tasks" }
  | { kind: "searchable"; collections: { name: string; fields: string[] }[] };
```

Run `grep -rn 'case "tasks"' packages/ui/src packages/shell/src` and give every other switch over these lines a `searchable` case (or check that it has a default).

- [ ] **Step 4: The controller**

In `packages/shell/src/main/plugin-data.ts`, after `readAll`:

```ts
  /** When each record last changed (data-meta, by key text), for search's recency. */
  changedAt(collection: string): Promise<Record<string, string>> {
    return this.store.changedAt(collection, APP_SCOPE);
  }
```

In `packages/shell/src/main/plugins.ts`:
- add `searchableLine` to the `@humanharness/harness-sdk` import;
- add `pluginDataDir`, `scopeDir`, `collectionName` and `APP_SCOPE` to the `@humanharness/workspace` import (keep what is there);
- add `import { type DataRow, type DataSource, recordRows } from "@humanharness/search";`

In `review`, the lines:

```ts
      lines: [...permissionLines(e.manifest.permissions), ...(searchableLine(e.manifest) ? [searchableLine(e.manifest)!] : [])],
```

After `panelHost`, add:

```ts
  /**
   * Global search (search spec D4): each running plugin's searchable collections. The stamp is the collection file's
   * size and mtime (`none` before the first write) and the panel a record opens in (the declared one, else the first).
   */
  async searchSources(): Promise<DataSource[]> {
    const c = await this.base();
    if (!c) return [];
    const out: DataSource[] = [];
    for (const r of this.running.values()) {
      if (r.stopped) continue;
      const m = r.entry.manifest;
      for (const [name, col] of Object.entries(m.data)) {
        if (!col.search) continue;
        const panel = col.search.panel ?? m.panels[0]?.id;
        const file = path.join(pluginDataDir(c.base, m.id), scopeDir(APP_SCOPE), `${collectionName(name)}.json`);
        const st = await fs.lstat(file).catch(() => null);
        out.push({
          id: `plugin:${m.id}/${name}`,
          owner: "plugin",
          plugin: m.id,
          pluginName: m.name,
          ...(panel ? { panel } : {}),
          collection: name,
          folder: APP_SCOPE,
          stamp: `${st ? `${st.size}:${st.mtimeMs}` : "none"}:${panel ?? ""}`,
        });
      }
    }
    return out;
  }

  /** A running plugin's searchable collection as search rows; anything else: none. */
  async searchRows(plugin: string, collection: string): Promise<DataRow[]> {
    const r = this.running.get(plugin);
    const col = r && !r.stopped && Object.hasOwn(r.entry.manifest.data, collection) ? r.entry.manifest.data[collection] : undefined;
    if (!r || !col?.search) return [];
    const [records, changed] = await Promise.all([r.data.readAll(collection), r.data.changedAt(collection)]);
    return recordRows(records, { ...(col.key ? { key: col.key } : {}), single: col.single, search: col.search }, changed);
  }
```

- [ ] **Step 5: The window's wording**

In `packages/ui/src/plugins/PermissionReview.tsx`, `PermissionText`'s switch gets, after the `secrets` case:

```tsx
    case "searchable":
      return <>{t("plugins.review.searchable", { list: line.collections.map((c) => `${c.name} (${c.fields.join(", ")})`).join("; ") })}</>;
```

and `ADDED_KINDS` stays as it is (searchable is never "added").

In `packages/i18n/src/locales/en.json`, under `plugins.review`, after `"tasks"`:

```json
      "searchable": "Searchable: {{list}}",
```

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/plugins-search.test.ts packages/ui/test/permission-searchable.test.tsx packages/shell/test/plugins-controller.test.ts packages/harness-sdk`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/harness-sdk/src packages/protocol/src/views.ts packages/shell/src/main/plugin-data.ts packages/shell/src/main/plugins.ts packages/ui/src/plugins/PermissionReview.tsx packages/i18n/src/locales/en.json packages/shell/test/plugins-search.test.ts packages/ui/test/permission-searchable.test.tsx
git commit -m "feat(plugins): searchable collections for search, and the review's Searchable line

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 7: Main wires the harness's collections and the reindex triggers

**Files:**
- Create: `packages/shell/src/main/search/data-sources.ts`
- Modify: `packages/shell/src/main/index.ts`
- Test: `packages/shell/test/search-data-sources.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/shell/test/search-data-sources.test.ts`:

```ts
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectionSchema, z } from "@humanharness/harness-sdk";
import { APP_SCOPE, DataStore } from "@humanharness/workspace";
import { harnessRows, harnessSources } from "../src/main/search/data-sources";

const collections = {
  people: collectionSchema.parse({ scoped: false, key: "id", agent: "none", schema: z.object({ id: z.string(), name: z.string(), bio: z.string() }), search: { title: "name", text: "bio" } }),
  marks: collectionSchema.parse({ scoped: true, key: "id", agent: "read", schema: z.object({ id: z.string(), what: z.string() }), search: { title: "what" } }),
  plain: collectionSchema.parse({ scoped: false, key: "id", agent: "read", schema: z.object({ id: z.string() }) }),
};
let base: string;
beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "hh-search-sources-"));
});
afterEach(() => fs.rm(base, { recursive: true, force: true }));

describe("harness data sources (search spec D4)", () => {
  it("one per searchable collection and folder: app-wide in _app, scoped in each open-able scope, main without scopes", async () => {
    const scoped = await harnessSources({ base, collections, scoped: true, scopes: async () => ["physics", "maths"] });
    expect(scoped.map((s) => s.id)).toEqual(["harness:_app/people", "harness:physics/marks", "harness:maths/marks"]);
    expect(scoped[0]).toEqual({ id: "harness:_app/people", owner: "harness", collection: "people", folder: "_app", stamp: "none" });
    const plain = await harnessSources({ base, collections, scoped: false, scopes: async () => [] });
    expect(plain.map((s) => s.id)).toEqual(["harness:_app/people", "harness:main/marks"]);
  });

  it("the stamp changes with a write; the rows are the declared fields", async () => {
    const store = new DataStore(base, collections);
    const deps = { base, collections, scoped: false, scopes: async () => [] };
    const before = (await harnessSources(deps))[0].stamp;
    await store.put("people", { id: "a", name: "Ana", bio: "Physics teacher" }, { who: "app", scope: APP_SCOPE });
    const [people] = await harnessSources(deps);
    expect(people.stamp).not.toBe(before);
    expect(await harnessRows(store, collections, people)).toEqual([{ key: "a", title: "Ana", text: "Physics teacher", at: expect.any(Number) }]);
    expect(await harnessRows(store, collections, { ...people, collection: "plain" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm vitest run packages/shell/test/search-data-sources.test.ts`
Expected: FAIL, cannot find `../src/main/search/data-sources`.

- [ ] **Step 3: The module**

`packages/shell/src/main/search/data-sources.ts`:

```ts
// Global search's harness collections (search spec D4): which ones, in which folders, and their records as rows.
import { promises as fs } from "node:fs";
import type { Collection } from "@humanharness/harness-sdk";
import { type DataRow, type DataSource, recordRows } from "@humanharness/search";
import { APP_SCOPE, type DataStore, MAIN_SCOPE, dataFile } from "@humanharness/workspace";

export interface HarnessSourcesDeps {
  base: string;
  collections: Record<string, Collection>;
  scoped: boolean;
  /** The scopes that aren't archived (harnesses with scopes). */
  scopes: () => Promise<string[]>;
}

/** Every searchable harness collection, once per folder it lives in; the stamp is the file's size and mtime. */
export async function harnessSources(d: HarnessSourcesDeps): Promise<DataSource[]> {
  const cols = Object.entries(d.collections).filter(([, c]) => c.search);
  if (cols.length === 0) return [];
  const folders = cols.some(([, c]) => c.scoped) ? (d.scoped ? await d.scopes() : [MAIN_SCOPE]) : [];
  const out: DataSource[] = [];
  for (const [name, c] of cols) {
    for (const folder of c.scoped ? folders : [APP_SCOPE]) {
      const st = await fs.lstat(dataFile(d.base, folder, name)).catch(() => null);
      out.push({ id: `harness:${folder}/${name}`, owner: "harness", collection: name, folder, stamp: st ? `${st.size}:${st.mtimeMs}` : "none" });
    }
  }
  return out;
}

/** A harness source's records as rows, through the base's one store (so its write queue orders the reads). */
export async function harnessRows(store: Pick<DataStore, "readAll" | "changedAt">, collections: Record<string, Collection>, s: DataSource): Promise<DataRow[]> {
  const c = Object.hasOwn(collections, s.collection) ? collections[s.collection] : undefined;
  if (!c?.search) return [];
  const [{ records }, changed] = await Promise.all([store.readAll(s.collection, s.folder), store.changedAt(s.collection, s.folder)]);
  return recordRows(records, { ...(c.key ? { key: c.key } : {}), single: c.single, search: c.search }, changed);
}
```

(`Collection`'s `single` is a boolean after parsing; if the type says `boolean | undefined`, write `single: c.single === true` here and in Task 6.)

- [ ] **Step 4: Wire it in main**

In `packages/shell/src/main/index.ts`:
- import: `import { harnessRows, harnessSources } from "./search/data-sources";` next to the other `./search/*` imports, and add `type DataRow, type DataSource` to the `@humanharness/search` import;
- right before `const searchSvc = new SearchService({`:

```ts
/** Global search's collections (search spec D4): the harness's, then each running plugin's. */
async function searchDataSources(): Promise<DataSource[]> {
  const c = await validConfig();
  if (!c) return [];
  const base = baseOf(c);
  const own = await harnessSources({
    base,
    collections: dataCollections(harness),
    scoped: scoped(),
    scopes: async () => (await scopeStoreFor(base).list()).filter((s) => !s.archived).map((s) => s.id),
  });
  const plugins = (await pluginsCtl?.searchSources().catch(() => [])) ?? [];
  return [...own, ...plugins];
}

async function searchDataRows(s: DataSource): Promise<DataRow[]> {
  if (s.owner === "plugin") return s.plugin && pluginsCtl ? pluginsCtl.searchRows(s.plugin, s.collection) : [];
  const c = await validConfig();
  return c ? harnessRows(dataStoreFor(baseOf(c)), dataCollections(harness), s) : [];
}
```

- in the `SearchService` deps, after `reveal`:

```ts
  data: { sources: () => searchDataSources(), rows: (s) => searchDataRows(s) },
```

- in `dataStoreFor`'s `store.onChange` listener, after `sendToWindow("hh:dataChange", change);`:

```ts
        // Search (D0): a no-op until the palette first opened; then a searchable collection is read again.
        searchSvc.dataChanged();
```

- in the plugins deps, `changed` and `dataChanged`:

```ts
      changed: (view) => {
        sendToWindow("hh:plugins", view);
        // A plugin on, off, added or removed: its searchable records come or go (search spec §7). D0 inside.
        searchSvc.dataChanged();
      },
```

```ts
      dataChanged: (plugin, collections) => {
        sendToWindow("hh:pluginData", { plugin, collections });
        searchSvc.dataChanged();
      },
```

`dataStoreFor` is declared before `searchSvc`; the listener only runs after start-up, when `searchSvc` exists.

- [ ] **Step 5: Run the tests, typecheck and build**

Run: `corepack pnpm vitest run packages/shell/test/search-data-sources.test.ts && corepack pnpm typecheck && corepack pnpm app:build`
Expected: PASS, clean, the build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/shell/src/main/search/data-sources.ts packages/shell/src/main/index.ts packages/shell/test/search-data-sources.test.ts
git commit -m "feat(shell): search reads the searchable collections; writes and plugin runs reindex them

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 8: Local rows in the palette (matcher, groups, chips)

**Files:**
- Create: `packages/protocol/src/search-local.ts`
- Modify: `packages/protocol/src/views.ts`, `packages/protocol/src/index.ts`
- Modify: `packages/ui/src/search/model.ts`, `packages/ui/src/search/SearchPalette.tsx`
- Modify: `packages/i18n/src/locales/en.json`
- Test: `packages/protocol/test/search-local.test.ts`, `packages/ui/test/search-local-rows.test.tsx`

- [ ] **Step 1: Write the failing tests**

`packages/protocol/test/search-local.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { foldText, localScore, markLocal } from "../src/search-local";

describe("local matching (plan deviation 2)", () => {
  it("folds case and accents", () => {
    expect(foldText("Apariencia ÉCOLE")).toBe("apariencia ecole");
  });

  it("every typed word starts a word: the label scores 2, a section or keyword 1, else 0", () => {
    expect(localScore("app", "Appearance", ["Settings", "theme dark"])).toBe(2);
    expect(localScore("dark", "Appearance", ["Settings", "theme dark"])).toBe(1);
    expect(localScore("text si", "Text size", [])).toBe(2);
    expect(localScore("pear", "Appearance", [])).toBe(0);
    expect(localScore("", "Appearance", [])).toBe(0);
  });

  it("marks the typed prefix of each matching word", () => {
    expect(markLocal("Text size", "si te")).toEqual([{ text: "Te", mark: true }, { text: "xt " }, { text: "si", mark: true }, { text: "ze" }]);
    expect(markLocal("Backup", "zzz")).toEqual([{ text: "Backup" }]);
  });
});
```

`packages/ui/test/search-local-rows.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "@humanharness/i18n";
import type { SearchAnswer, SearchHitView } from "../src/client";
import { SearchPalette } from "../src/search/SearchPalette";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const answer = (query: string): SearchAnswer => ({ ok: true, query, groups: [], counts: { task: 0, note: 0, file: 0 }, recent: [], partial: false, status: { state: "ready", done: 0, total: 0 }, allScopes: false });
const SETTING: SearchHitView = { id: "setting:general.appearance", kind: "setting", title: [{ text: "Appearance" }], context: [{ text: "General" }], hint: null, target: { kind: "setting", tab: "general", field: "general.appearance" } };
const COMMAND: SearchHitView = { id: "command:open-history", kind: "command", title: [{ text: "Open History" }], context: [], hint: null, target: { kind: "command", command: "open-history" } };

function palette(local: (q: string) => { query: string; setting: SearchHitView[]; command: SearchHitView[] }) {
  const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
  const query = vi.spyOn(client.search, "query").mockImplementation(async (q) => answer(q));
  const onPick = vi.fn();
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <SearchPalette client={client} where="Searching in Demo" references={false} onClose={() => {}} onPick={onPick} onAsk={() => {}} local={local} />
    </I18nextProvider>,
  );
  return { query, onPick };
}

describe("settings and actions in the palette (search spec §3, §6)", () => {
  it("nothing typed: the available actions after the recents", async () => {
    palette((q) => ({ query: q, setting: [], command: q.trim() ? [] : [COMMAND] }));
    const list = await screen.findByRole("listbox", { name: "Results" });
    expect(await within(list).findByRole("group", { name: "Actions" })).toBeTruthy();
    expect(within(list).getByRole("option").textContent).toContain("Open History");
  });

  it("typed: a Settings group and its chip; the chip filters locally and asks main without a kind", async () => {
    const { query, onPick } = palette((q) => ({ query: q, setting: q.trim() ? [SETTING] : [], command: [] }));
    fireEvent.change(screen.getByRole("combobox", { name: "Search tasks, notes and files" }), { target: { value: "app" } });
    const list = await screen.findByRole("listbox", { name: "Results" });
    await within(list).findByRole("group", { name: "Settings" });
    fireEvent.click(screen.getByRole("button", { name: /Settings 1/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Settings 1/ }).getAttribute("aria-pressed")).toBe("true"));
    expect(query.mock.calls.at(-1)?.[1]).not.toHaveProperty("kind");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(SETTING);
  });
});
```

(Use the same i18n setup as `packages/ui/test/search-palette.test.tsx`; if it wraps nothing because `FakeClient` sets i18n up, drop the provider here too.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/protocol/test/search-local.test.ts packages/ui/test/search-local-rows.test.tsx`
Expected: FAIL, `../src/search-local` doesn't exist; `local` is not a palette prop.

- [ ] **Step 3: The protocol types**

In `packages/protocol/src/views.ts`, replace Task 3's `SearchRowKind` line:

```ts
/** Every kind a result row can be: the index's, and Settings and Actions, which the window builds (§4.2). */
export type SearchRowKind = SearchIndexKind | "setting" | "command";
/** The Settings tabs a setting row opens. */
export type SearchSettingsTab = "general" | "harness" | "engine" | "models" | "sidekick" | "plugins" | "connections" | "jobs" | "usage";
/** The app's commands (§6 "Actions"). */
export type SearchCommandId = "new-question" | "open-history" | "open-notes" | "open-context" | "open-settings" | "switch-scope" | "next-part" | "stop-turn";
```

and `SearchTarget` gains, before `| { kind: "none" }`:

```ts
  /** Settings at that tab, the field focused (§6). */
  | { kind: "setting"; tab: SearchSettingsTab; field: string }
  /** One of the app's commands; `arg`: the tab, the scope or the part. */
  | { kind: "command"; command: SearchCommandId; arg?: string }
```

`packages/protocol/src/search-local.ts`:

```ts
// Settings and actions in ⌘K (search spec §6): matched in the window, never stored (§4.2, plan deviations 1–2).
import type { SearchMarked } from "./views";

/** Case and accents folded, as `packages/search` folds the index. */
export const foldText = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const words = (s: string): string[] => foldText(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** 2: every typed word starts a word of the label; 1: of the label, its section or a keyword; 0: no match. */
export function localScore(query: string, label: string, extra: readonly string[]): number {
  const q = words(query);
  if (q.length === 0) return 0;
  const own = words(label);
  if (q.every((w) => own.some((x) => x.startsWith(w)))) return 2;
  const all = [...own, ...extra.flatMap(words)];
  return q.every((w) => all.some((x) => x.startsWith(w))) ? 1 : 0;
}

/** The label with the typed prefix of each matching word marked. */
export function markLocal(label: string, query: string): SearchMarked {
  const q = words(query).sort((a, b) => b.length - a.length);
  const out: SearchMarked = [];
  let at = 0;
  for (const m of label.matchAll(/[\p{L}\p{N}]+/gu)) {
    const w = q.find((x) => foldText(m[0]).startsWith(x));
    if (!w || m.index === undefined) continue;
    const end = m.index + Math.min(w.length, m[0].length);
    if (m.index > at) out.push({ text: label.slice(at, m.index) });
    out.push({ text: label.slice(m.index, end), mark: true });
    at = end;
  }
  if (at < label.length) out.push({ text: label.slice(at) });
  return out;
}
```

In `packages/protocol/src/index.ts`, add `export * from "./search-local";` (next to the other `export *` lines). In `packages/ui/src/client.ts`, check it re-exports `@humanharness/protocol` with `export *`; if it lists names, add `foldText`, `localScore`, `markLocal`, `SearchRowKind`, `SearchSettingsTab`, `SearchCommandId`.

- [ ] **Step 4: The model**

`packages/ui/src/search/model.ts` (whole file):

```ts
import { SEARCH_INDEX_KINDS, type SearchAnswer, type SearchHitView, type SearchRowKind } from "../client";

export interface Section {
  key: SearchRowKind | "recent";
  hits: SearchHitView[];
}

/** The window's own rows for the query they were built for (§6). */
export interface LocalRows {
  query: string;
  setting: SearchHitView[];
  command: SearchHitView[];
}

/** §3's order: Tasks, Notes, Files, Settings, Actions, Data. */
export const SEARCH_ROW_KINDS: readonly SearchRowKind[] = ["task", "note", "file", "setting", "command", "data"];
const LOCAL_PER_GROUP = 5;
const LOCAL_PER_KIND = 50;
const isLocal = (k: SearchRowKind): k is "setting" | "command" => k === "setting" || k === "command";

/**
 * §5.2: nothing typed shows the recents (and, with local rows, the available actions after them); otherwise the groups
 * in §3's order, main's and the window's merged. `kind`: the chip pressed.
 */
export function sectionsOf(a: SearchAnswer | null, local?: LocalRows, kind: SearchRowKind | null = null): Section[] {
  if (!a?.ok) return [];
  if (!local) {
    if (!a.query.trim()) return a.recent.length > 0 ? [{ key: "recent", hits: a.recent }] : [];
    return a.groups.map((g) => ({ key: g.kind, hits: g.hits }));
  }
  if (!local.query.trim()) {
    return [...(a.recent.length > 0 ? [{ key: "recent" as const, hits: a.recent }] : []), ...(local.command.length > 0 ? [{ key: "command" as const, hits: local.command }] : [])];
  }
  const fromMain = new Map<SearchRowKind, SearchHitView[]>(a.groups.map((g) => [g.kind, g.hits]));
  const cap = kind ? LOCAL_PER_KIND : LOCAL_PER_GROUP;
  return SEARCH_ROW_KINDS.filter((k) => !kind || k === kind)
    .map((k) => ({ key: k, hits: isLocal(k) ? local[k].slice(0, cap) : (fromMain.get(k) ?? []) }))
    .filter((s) => s.hits.length > 0);
}

/** ↑↓ move across groups: one flat list of rows. */
export const rowsOf = (sections: readonly Section[]): SearchHitView[] => sections.flatMap((s) => s.hits);

/** §5.5: "All · N", then one chip per kind that has results. `kind` null: All. */
export interface Chip {
  kind: SearchRowKind | null;
  count: number;
}

export function chipsOf(a: SearchAnswer | null, local?: LocalRows): Chip[] {
  if (!a?.ok || !a.query.trim()) return [];
  const count = (k: SearchRowKind) => (isLocal(k) ? (local?.query.trim() ? local[k].length : 0) : k === "data" ? (a.counts.data ?? 0) : a.counts[k]);
  const kinds = local ? SEARCH_ROW_KINDS : SEARCH_INDEX_KINDS;
  const all = kinds.reduce((n, k) => n + count(k), 0);
  if (all === 0) return [];
  return [{ kind: null, count: all }, ...kinds.filter((k) => count(k) > 0).map((k) => ({ kind: k, count: count(k) }))];
}

export const step = (i: number, delta: number, length: number): number => (length === 0 ? 0 : Math.min(length - 1, Math.max(0, i + delta)));
```

- [ ] **Step 5: The palette**

In `packages/ui/src/search/SearchPalette.tsx`:
- import `type LocalRows` from `./model`;
- the props gain, after `harnessName?`:

```tsx
  /** The window's own rows for a query (§6): Settings and Actions. Absent: none (plan 1's palette). */
  local?: (query: string) => LocalRows;
```

- the function destructures `local`;
- replace the three lines `const sections = …; const rows = …; const chips = …;` with:

```tsx
  const localRows = local ? local(query) : undefined;
  const sections = sectionsOf(answer, localRows, kind);
  const rows = rowsOf(sections);
  const chips = chipsOf(answer, localRows);
```

- the `INDEX_KINDS`/`isIndexKind` lines from Task 3 stay; with `SearchRowKind` now wider, `isIndexKind` is what keeps `setting` and `command` out of `filters`.

`sectionLabel` already reads `search.kind.<key>`. In `packages/i18n/src/locales/en.json`, `search.kind` becomes:

```json
    "kind": { "task": "Tasks", "note": "Notes", "file": "Files", "data": "Data", "setting": "Settings", "command": "Actions" },
```

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/protocol packages/ui/test/search-local-rows.test.tsx packages/ui/test/search-palette.test.tsx packages/ui/test/search-model.test.ts packages/ui/test/search-host.test.tsx`
Expected: PASS (`boundary.test.ts` too: `search-local.ts` imports only `./views` types).

- [ ] **Step 7: Commit**

```bash
git add packages/protocol/src packages/protocol/test/search-local.test.ts packages/ui/src/search packages/ui/test/search-local-rows.test.tsx packages/i18n/src/locales/en.json
git commit -m "feat(search): the palette merges the window's own rows (Settings, Actions) with main's

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 9: Settings rows, opening Settings at the field

**Files:**
- Modify: `packages/protocol/src/search-local.ts`
- Create: `packages/ui/src/search/local.ts`, `packages/ui/src/search/focus-setting.ts`
- Modify: `packages/ui/src/SettingsSheet.tsx`, `packages/ui/src/ModelsTab.tsx`, `packages/ui/src/HarnessSettingsTab.tsx`, `packages/ui/src/EngineTab.tsx`, `packages/ui/src/UsageTab.tsx`, `packages/ui/src/ProfilesSection.tsx`, `packages/ui/src/sidekick/SidekickTab.tsx`, `packages/ui/src/plugins/PluginsTab.tsx`, `packages/ui/src/connections/ConnectionsTab.tsx`, `packages/ui/src/parallel/JobsTab.tsx`
- Modify: `packages/ui/src/HarnessApp.tsx`, `packages/ui/src/search/SearchHost.tsx`
- Test: `packages/ui/test/search-settings-registry.test.tsx`, `packages/ui/test/search-settings-open.test.tsx`

- [ ] **Step 1: The registry (data only, no behaviour yet)**

Append to `packages/protocol/src/search-local.ts` (and add `SearchSettingsTab` to its type import from `./views`):

```ts
/** What a setting row needs to be on screen (the tab's own conditions are `visibleTabs`'). */
export type SettingNeed = "configured" | "folder" | "backup" | "parallel" | "profiles";

export interface SearchableSetting {
  /** `<tab>.<field>`: the row's `data-setting`. */
  id: string;
  tab: SearchSettingsTab;
  /** An i18n key: the row's label as Settings shows it. */
  label: string;
  /** Other words that find it, in English (plan deviation 2). Never a word starting "guide" or "old" (plan 1's tests). */
  keywords?: readonly string[];
  needs?: readonly SettingNeed[];
}

/** Every Settings row search opens (§6; plan deviation 12). A registry test keeps it and the tabs in step. */
export const SEARCHABLE_SETTINGS: readonly SearchableSetting[] = [
  { id: "general.language", tab: "general", label: "settings.language", keywords: ["translate", "locale"] },
  { id: "general.appearance", tab: "general", label: "settings.appearance", keywords: ["theme", "dark", "light", "mode"] },
  { id: "general.textSize", tab: "general", label: "settings.textSize", keywords: ["font", "zoom", "bigger", "smaller"] },
  { id: "general.folder", tab: "general", label: "settings.folder", keywords: ["move", "location", "finder"], needs: ["folder"] },
  { id: "general.backup", tab: "general", label: "backup.title", keywords: ["sync", "icloud", "dropbox"], needs: ["folder", "backup"] },
  { id: "general.tasksAtOnce", tab: "general", label: "parallel.tasksAtOnce", keywords: ["parallel"], needs: ["parallel"] },
  { id: "general.jobsAtOnce", tab: "general", label: "parallel.jobsAtOnce", keywords: ["parallel"], needs: ["parallel"] },
  { id: "general.notifyWaiting", tab: "general", label: "parallel.notifyWaiting", keywords: ["notification", "alert"], needs: ["parallel"] },
  { id: "general.profiles", tab: "general", label: "profiles.sectionTitle", keywords: ["profiles", "people", "users"], needs: ["profiles"] },
  { id: "engine.engine", tab: "engine", label: "engine.tilesLabel", keywords: ["engine", "provider", "claude", "codex", "gemini", "sign in"], needs: ["configured"] },
  { id: "models.tasks", tab: "models", label: "models.tasks", keywords: ["models", "tier", "pinned", "budget"], needs: ["configured"] },
  { id: "models.levels", tab: "models", label: "models.levels", keywords: ["models", "light", "standard", "deep"], needs: ["configured"] },
  { id: "sidekick.on", tab: "sidekick", label: "sidekick.settings.on", keywords: ["coach"], needs: ["configured"] },
  { id: "sidekick.preSend", tab: "sidekick", label: "sidekick.settings.preSend", keywords: ["sidekick"], needs: ["configured"] },
  { id: "sidekick.afterReply", tab: "sidekick", label: "sidekick.settings.afterReply", keywords: ["sidekick"], needs: ["configured"] },
  { id: "sidekick.headsUps", tab: "sidekick", label: "sidekick.settings.headsUps", keywords: ["sidekick"], needs: ["configured"] },
  { id: "sidekick.wait", tab: "sidekick", label: "sidekick.settings.wait", keywords: ["sidekick", "seconds"], needs: ["configured"] },
  { id: "sidekick.tier", tab: "sidekick", label: "sidekick.settings.tier", keywords: ["sidekick", "tier"], needs: ["configured"] },
  { id: "sidekick.cap", tab: "sidekick", label: "sidekick.settings.cap", keywords: ["sidekick", "tokens", "limit"], needs: ["configured"] },
  { id: "plugins.plugins", tab: "plugins", label: "plugins.tab", keywords: ["extensions", "turn on"], needs: ["configured"] },
  { id: "connections.connections", tab: "connections", label: "connections.tab", keywords: ["keys", "tokens", "secrets"], needs: ["configured"] },
  { id: "jobs.jobs", tab: "jobs", label: "parallel.jobsTab", keywords: ["schedule", "background"], needs: ["configured"] },
  { id: "usage.plan", tab: "usage", label: "usage.planTitle", keywords: ["usage", "limits", "plan"], needs: ["configured"] },
  { id: "usage.actions", tab: "usage", label: "usage.actionsTitle", keywords: ["usage", "tokens", "cost"], needs: ["configured"] },
];

/** The window's state a setting's `needs` read. */
export type SettingState = Record<SettingNeed, boolean>;
export const settingAvailable = (s: SearchableSetting, state: SettingState): boolean => (s.needs ?? []).every((n) => state[n]);
```

- [ ] **Step 2: Write the failing tests**

`packages/ui/test/search-settings-registry.test.tsx`:

```tsx
// @vitest-environment happy-dom
import fs from "node:fs";
import path from "node:path";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SEARCHABLE_SETTINGS } from "@humanharness/protocol";
import en from "../../i18n/src/locales/en.json";
import { SettingsSheet } from "../src/SettingsSheet";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const SRC = path.resolve(__dirname, "../src");
const sources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
const text = sources(SRC).map((f) => fs.readFileSync(f, "utf8")).join("\n");
const keyOf = (k: string): unknown => k.split(".").reduce<unknown>((o, p) => (o && typeof o === "object" ? (o as Record<string, unknown>)[p] : undefined), en);
const shown = () => [...document.querySelectorAll<HTMLElement>("[data-setting]")].map((el) => el.dataset.setting);

describe("the Settings registry (search spec §6, plan deviation 13)", () => {
  it("every entry has a row in ui/src, every row an entry, every label a string in en.json", () => {
    const written = new Set([...text.matchAll(/data-setting="([^"]+)"/g)].map((m) => m[1]));
    const ids = new Set(SEARCHABLE_SETTINGS.map((s) => s.id));
    expect([...ids].filter((id) => !written.has(id))).toEqual([]);
    expect([...written].filter((id) => !ids.has(id))).toEqual([]);
    expect(SEARCHABLE_SETTINGS.filter((s) => typeof keyOf(s.label) !== "string").map((s) => s.id)).toEqual([]);
  });

  it("General renders its rows for the state given (folder set, no parallel, no profiles)", async () => {
    const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" });
    const state = await client.getState();
    render(<SettingsSheet client={client} state={state} tab="general" onTab={() => {}} onChange={() => {}} onClose={() => {}} onSetup={() => {}} />);
    await waitFor(() => expect(shown()).toContain("general.appearance"));
    expect(shown().sort()).toEqual(["general.appearance", "general.folder", "general.language", "general.textSize", ...(state.backup?.status ? ["general.backup"] : [])].sort());
  });

  it("Sidekick renders exactly its registry rows", async () => {
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    const state = await client.getState();
    if (!state.sidekick) return; // FakeClient without Sidekick: the static check above covers it.
    render(<SettingsSheet client={client} state={state} tab="sidekick" onTab={() => {}} onChange={() => {}} onClose={() => {}} onSetup={() => {}} />);
    await waitFor(() => expect(shown()).toContain("sidekick.on"));
    expect(shown().sort()).toEqual(SEARCHABLE_SETTINGS.filter((s) => s.tab === "sidekick").map((s) => s.id).sort());
  });
});
```

(`client.getState()` stands for however the other Settings tests get an `AppState` from `FakeClient`; check `grep -n "SettingsSheet" packages/ui/test/*.tsx | head -3` and copy that line. If the tests import `en.json` another way, copy that too.)

`packages/ui/test/search-settings-open.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp } from "../src";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

describe("a setting from search opens Settings at the field (§6)", () => {
  it("typing a label shows it under Settings; Enter opens the tab with its control focused", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} />);
    await screen.findByRole("button", { name: "Start Demo" });
    act(() => client.search.open("appear"));
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    const group = await within(dialog).findByRole("group", { name: "Settings" });
    expect(within(group).getByRole("option").textContent).toContain("Appearance");
    fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Enter" });
    const sheet = await screen.findByRole("dialog", { name: "Settings" });
    expect(within(sheet).getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("true");
    const row = sheet.querySelector<HTMLElement>('[data-setting="general.appearance"]')!;
    await waitFor(() => expect(row.contains(document.activeElement)).toBe(true));
    expect(row.classList.contains("hh-search-flash")).toBe(true);
  });

  it("Models › Levels opens on its Levels part", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} />);
    await screen.findByRole("button", { name: "Start Demo" });
    act(() => client.search.open("levels"));
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    await within(dialog).findByRole("group", { name: "Settings" });
    fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Enter" });
    const sheet = await screen.findByRole("dialog", { name: "Settings" });
    await waitFor(() => expect(sheet.querySelector('[data-setting="models.levels"]')).not.toBeNull());
  });
});
```

(If `FakeClient` has no `models` view, the second test returns early: add `if (!(await client.getState()).models) return;` with the same state getter as above.)

- [ ] **Step 3: Run them to see them fail**

Run: `corepack pnpm vitest run packages/ui/test/search-settings-registry.test.tsx packages/ui/test/search-settings-open.test.tsx`
Expected: FAIL, no `data-setting` rows; no Settings group.

- [ ] **Step 4: Mark the rows**

Add the attribute to each row's outer element (exact current openings shown; only the attribute is new):

`packages/ui/src/SettingsSheet.tsx`
- `LanguageRow`: `<div className="hh-row hh-row-wrap" data-setting="general.language">` (its first row; the progress and "new" rows stay unmarked)
- Appearance: `<div className="hh-row" data-setting="general.appearance">`
- Text size: `<div className="hh-row hh-row-wrap" data-setting="general.textSize">`
- Folder: `<div className="hh-row" data-setting="general.folder">` (the one with `settings.folder`)
- Backup: `<div className="hh-row" data-setting="general.backup">` (the one with `backup.title`)
- `ParallelSection`: `cap` takes the id: `const cap = (key: "tasks" | "jobs", label: string, setting: string) => ( <div className="hh-row" data-setting={setting}>` …, called as `cap("tasks", t("parallel.tasksAtOnce"), "general.tasksAtOnce")` and `cap("jobs", t("parallel.jobsAtOnce"), "general.jobsAtOnce")`. The registry test reads `data-setting="…"` literally, so write both ids as literals in a line comment above `cap`: `// Rows: data-setting="general.tasksAtOnce", data-setting="general.jobsAtOnce".`
- Notify: `<div className="hh-row" data-setting="general.notifyWaiting">`

`packages/ui/src/ProfilesSection.tsx`: `<section aria-labelledby={headingId} data-setting="general.profiles">`
`packages/ui/src/EngineTab.tsx`: `<div className="hh-tiles" role="group" aria-label={t("engine.tilesLabel")} data-setting="engine.engine">`
`packages/ui/src/ModelsTab.tsx`: the tasks part `<section aria-labelledby={tasksId} data-setting="models.tasks">`; `LevelsSection`'s `<section aria-labelledby={headingId} data-setting="models.levels">`
`packages/ui/src/sidekick/SidekickTab.tsx`: the seven rows, in order: `<div className="hh-row hh-row-wrap" data-setting="sidekick.on">`, `… data-setting="sidekick.preSend">`, `… data-setting="sidekick.afterReply">`, `… data-setting="sidekick.headsUps">`, `<div className="hh-row" data-setting="sidekick.wait">`, `<div className="hh-row" data-setting="sidekick.tier">`, `<div className="hh-row" data-setting="sidekick.cap">`
`packages/ui/src/plugins/PluginsTab.tsx`: each of its three `<div className="hh-tab"…>` returns gets `data-setting="plugins.plugins"`
`packages/ui/src/connections/ConnectionsTab.tsx`: `<div className="hh-tab" data-setting="connections.connections">`
`packages/ui/src/parallel/JobsTab.tsx`: `<div className="hh-tab" data-setting="jobs.jobs">`
`packages/ui/src/UsageTab.tsx`: `<h3 data-setting="usage.plan">{t("usage.planTitle")}</h3>` and `<h3 id={tableTitle} data-setting="usage.actions">{t("usage.actionsTitle")}</h3>`

`packages/ui/src/HarnessSettingsTab.tsx`: `SettingRow` takes an optional `setting?: string` and its outer div becomes `<div className="hh-row hh-row-wrap" {...(setting ? { "data-setting": setting } : {})}>`; `HarnessSettingsTab`'s `row` passes `setting={`harness:${f.name}`}` (a plugin's detail passes none). `HarnessSettingsTab` takes `focus?: string`, and `more` starts open when the focused field is advanced:

```tsx
export function HarnessSettingsTab({ client, view, focus }: { client: HarnessClient; view: SettingsView; focus?: string }) {
```

```tsx
  const [more, setMore] = useState(() => view.fields.some((f) => f.advanced && `harness:${f.name}` === focus));
```

`ModelsTab` takes `initialPart?: "tasks" | "levels"`: `useState<"tasks" | "levels">(initialPart ?? "tasks")`.

- [ ] **Step 5: Focus the field**

`packages/ui/src/search/focus-setting.ts`:

```ts
const CONTROLS = "input, select, textarea, button";

/** A control the person can use: not disabled, not inside a disabled fieldset. */
const usable = (el: HTMLElement): boolean => !el.hasAttribute("disabled") && el.closest("fieldset[disabled]") === null;

/**
 * Settings opened from search (§6): the row `id` gets focus (its first usable control, else the row itself) and the
 * 2 s flash. Its tab may still be loading: waits for the row to render, 2 s at most. Answers the cancel.
 */
export function focusSetting(root: HTMLElement, id: string, waitMs = 2000): () => void {
  const attempt = (): boolean => {
    const row = [...root.querySelectorAll<HTMLElement>("[data-setting]")].find((el) => el.dataset.setting === id);
    if (!row) return false;
    const control = [...row.querySelectorAll<HTMLElement>(CONTROLS)].find(usable);
    if (!control) row.tabIndex = -1;
    row.scrollIntoView?.({ block: "center" });
    (control ?? row).focus();
    row.classList.add("hh-search-flash");
    setTimeout(() => row.classList.remove("hh-search-flash"), 2000);
    return true;
  };
  if (attempt()) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    if (attempt()) stop();
  });
  function stop() {
    observer.disconnect();
    if (timer !== undefined) clearTimeout(timer);
  }
  observer.observe(root, { childList: true, subtree: true });
  timer = setTimeout(stop, waitMs);
  return stop;
}
```

In `packages/ui/src/SettingsSheet.tsx`:
- `export type SettingsTab = SearchSettingsTab;` (import the type from `./client`), so the two can't drift;
- export the tab filter for search:

```tsx
/** The tabs this state shows (the sheet's own list, and search's: a row of a hidden tab isn't offered). */
export function visibleTabs(state: AppState): SettingsTab[] {
  return TABS.filter(
    (id) =>
      (id !== "models" || state.models !== undefined) &&
      (id !== "harness" || state.settings !== undefined || state.setup !== undefined) &&
      (id !== "sidekick" || state.sidekick !== undefined) &&
      (id !== "plugins" || state.plugins !== undefined) &&
      (id !== "connections" || state.connections !== undefined) &&
      (id !== "jobs" || state.jobs !== undefined),
  );
}
```

and inside the component `const tabs = visibleTabs(state);` replaces the inline filter (the comment above it stays);
- export the tab's name (the tab button uses it too):

```tsx
/** A tab's name as its button says it ("Sidekicks" with several: the button passes its own `sidekick`). */
export function tabLabel(t: TFunction, state: AppState, id: SettingsTab, sidekick = t("sidekick.tab")): string {
  return id === "harness" ? (state.settings?.tab ?? t("settings.tabs.setup")) : id === "sidekick" ? sidekick : id === "plugins" ? t("plugins.tab") : id === "connections" ? t("connections.tab") : id === "jobs" ? t("parallel.jobsTab") : t(`settings.tabs.${id}`);
}
```

with the tab button's text `{tabLabel(t, state, id, sidekickTab)}` (`import type { TFunction } from "i18next";`, as the other ui files that type `t` do);
- the props gain `focus?: { id: string; n: number };` ("Search opened the sheet at this field; `n` changes on each search."); after the mount effect that focuses Done (so it runs after it):

```tsx
  // Search (§6): the field gets focus once its tab rendered; a new search focus (`n`) runs it again.
  const focusN = focus?.n;
  useEffect(() => {
    if (!focus) return;
    const panel = document.getElementById(panelId);
    return panel ? focusSetting(panel, focus.id) : undefined;
  }, [focusN, tab]);
```

- the tabs that take a focus: `<ModelsTab key={focus?.n} client={client} state={state} onChange={onChange} {...(focus?.id === "models.levels" ? { initialPart: "levels" as const } : {})} />` and `<HarnessSettingsTab key={focus?.n} client={client} view={state.settings} {...(focus ? { focus: focus.id } : {})} />`.

- [ ] **Step 6: The rows, and HarnessApp opening them**

`packages/ui/src/search/local.ts`:

```ts
import type { TFunction } from "i18next";
import { type AppState, SEARCHABLE_SETTINGS, type SearchHitView, type SearchSettingsTab, type SettingState, isConfigured, localScore, markLocal, settingAvailable } from "../client";
import { tabLabel, visibleTabs } from "../SettingsSheet";

/** What the window's state says about each setting's `needs`. */
export function settingState(state: AppState): SettingState {
  const folder = Boolean(state.config.folder);
  return {
    configured: isConfigured(state.config),
    folder,
    backup: folder && Boolean(state.backup?.status),
    parallel: state.parallel !== undefined,
    profiles: state.profiles !== undefined,
  };
}

interface Candidate {
  id: string;
  label: string;
  extra: string[];
  hit: (title: SearchHitView["title"]) => SearchHitView;
}

/** Matched candidates, best first (label matches before keyword ones; the table's order otherwise). */
export function matched(query: string, all: readonly Candidate[]): SearchHitView[] {
  return all
    .map((c, i) => ({ c, i, score: localScore(query, c.label, c.extra) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ c }) => c.hit(markLocal(c.label, query)));
}

/** Settings rows for a typed query (§6): the registry's available rows, then the harness's own fields. */
export function settingRows(t: TFunction, state: AppState, query: string): SearchHitView[] {
  if (!query.trim()) return [];
  const can = settingState(state);
  const tabs = new Set(visibleTabs(state));
  const row = (id: string, tab: SearchSettingsTab, label: string, extra: string[]): Candidate => {
    const section = tabLabel(t, state, tab);
    return {
      id,
      label,
      extra: [section, ...extra],
      hit: (title) => ({ id: `setting:${id}`, kind: "setting", title, context: [{ text: section }], hint: null, target: { kind: "setting", tab, field: id } }),
    };
  };
  const fixed = SEARCHABLE_SETTINGS.filter((s) => tabs.has(s.tab) && settingAvailable(s, can)).map((s) => row(s.id, s.tab, t(s.label), [...(s.keywords ?? [])]));
  const own = can.configured && tabs.has("harness") ? (state.settings?.fields ?? []).map((f) => row(`harness:${f.name}`, "harness", f.label, f.help ? [f.help] : [])) : [];
  return matched(query, [...fixed, ...own]);
}
```


In `packages/ui/src/search/SearchHost.tsx`:
- import `useTranslation` is there; import `settingRows` from `./local`;
- the palette gets:

```tsx
      local={(query) => ({ query, setting: settingRows(t, state, query), command: [] })}
```

- `pick` doesn't tell main about the window's rows (they aren't in the index):

```tsx
  const pick = (hit: SearchHitView) => {
    if (hit.kind !== "setting" && hit.kind !== "command") void client.search.opened(hit);
    leave();
    if (hit.target.kind !== "reveal" && hit.target.kind !== "none") onIntent(hit.target);
  };
```

In `packages/ui/src/HarnessApp.tsx`:
- state for the focus: after `const [settings, setSettings] = …`:

```tsx
  /** Search opened Settings at a field (§6); `n` makes each search a new focus. */
  const [settingsFocus, setSettingsFocus] = useState<{ id: string; n: number } | null>(null);
```

- `searchIntent` opens Settings for a setting row, before anything else:

```tsx
  const searchIntent = (intent: SearchIntent) => {
    if (intent.kind === "setting") {
      setSettingsFocus((f) => ({ id: intent.field, n: (f?.n ?? 0) + 1 }));
      setSettings(intent.tab);
      return;
    }
    setSettings(null);
```

(the rest stays);
- the sheet gets `{...(settingsFocus ? { focus: settingsFocus } : {})}`, and `closeSettings` (and every other `setSettings(null)` path is fine as is) also clears it: in `closeSettings`, add `setSettingsFocus(null);`. A tab click (`onTab`) clears it too: `onTab={(tab) => { setSettingsFocus(null); setSettings(tab); }}`.

In `packages/ui/src/ChatView.tsx`, `runSearchIntent` gets a case so the switch stays exhaustive:

```tsx
      case "setting":
        // HarnessApp opens Settings itself; never reaches here.
        return false;
```

- [ ] **Step 7: Run the tests**

Run: `corepack pnpm vitest run packages/ui`
Expected: PASS (the new files, the Settings tests, the search tests).

- [ ] **Step 8: Commit**

```bash
git add packages/protocol/src/search-local.ts packages/ui/src packages/ui/test/search-settings-registry.test.tsx packages/ui/test/search-settings-open.test.tsx
git commit -m "feat(search): Settings rows open the sheet at the field, focused

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 10: Action rows (commands available now)

**Files:**
- Modify: `packages/protocol/src/search-local.ts`
- Modify: `packages/ui/src/search/local.ts`, `packages/ui/src/search/SearchHost.tsx`, `packages/ui/src/HarnessApp.tsx`, `packages/ui/src/ChatView.tsx`
- Modify: `packages/i18n/src/locales/en.json`
- Test: `packages/protocol/test/search-commands.test.ts`, `packages/ui/test/search-commands.test.tsx`

- [ ] **Step 1: Write the failing tests**

`packages/protocol/test/search-commands.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type SearchCommandState, searchCommands } from "../src/search-local";

const base: SearchCommandState = { chat: null, scopes: [], openScope: null, tabs: ["general", "engine"] };
const ids = (s: SearchCommandState) => searchCommands(s).map((c) => `${c.command}${c.arg ? `:${c.arg}` : ""}`);

describe("the commands available now (search spec §6, plan deviation 14)", () => {
  it("away from the chat: Settings' tabs and the scopes only", () => {
    expect(ids(base)).toEqual(["open-settings:general", "open-settings:engine"]);
  });

  it("in the chat with no task: a new question and the panels; no stop, no next part", () => {
    expect(ids({ ...base, chat: { taskOpen: false, turnRunning: false, nextPart: null, panels: true } })).toEqual(["new-question", "open-history", "open-notes", "open-context", "open-settings:general", "open-settings:engine"]);
  });

  it("a task open and a turn running: Stop; the next part when the task waits; never New question", () => {
    const running = ids({ ...base, chat: { taskOpen: true, turnRunning: true, nextPart: null, panels: false } });
    expect(running).toContain("stop-turn");
    expect(running).not.toContain("new-question");
    const waiting = searchCommands({ ...base, chat: { taskOpen: true, turnRunning: false, nextPart: { id: "write", label: "Write" }, panels: false } });
    expect(waiting.find((c) => c.command === "next-part")).toMatchObject({ arg: "write", vars: { part: "Write" } });
  });

  it("switch scope: every scope that isn't archived and isn't open, unless a turn runs", () => {
    const scopes = [
      { id: "physics", title: "Physics", archived: false },
      { id: "maths", title: "Maths", archived: false },
      { id: "old-term", title: "Last term", archived: true },
    ];
    expect(ids({ ...base, scopes, openScope: "physics" }).filter((i) => i.startsWith("switch"))).toEqual(["switch-scope:maths"]);
    expect(ids({ ...base, scopes, openScope: null, chat: { taskOpen: true, turnRunning: true, nextPart: null, panels: false } }).filter((i) => i.startsWith("switch"))).toEqual([]);
  });
});
```

`packages/ui/test/search-commands.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp } from "../src";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

async function startWork() {
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  await screen.findByPlaceholderText(/Write a message…/);
}

describe("actions in the palette (search spec §6; plan 1 deviation 9)", () => {
  it("nothing typed lists the actions available now; Open History opens it", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} />);
    await startWork();
    act(() => client.search.open(""));
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    const actions = await within(dialog).findByRole("group", { name: "Actions" });
    expect(within(actions).queryByText("Stop the AI")).toBeNull();
    fireEvent.click(within(actions).getByText("Open History"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
    expect(await screen.findByRole("heading", { name: "History" })).toBeTruthy();
  });

  it("Open Settings › Engine opens that tab", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} />);
    await startWork();
    act(() => client.search.open("settings engine"));
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    fireEvent.click(await within(await within(dialog).findByRole("group", { name: "Actions" })).findByText(/Open Settings › Engine/));
    const sheet = await screen.findByRole("dialog", { name: "Settings" });
    expect(within(sheet).getByRole("tab", { name: "Engine" }).getAttribute("aria-selected")).toBe("true");
  });
});
```

(How History shows itself: copy the assertion from the existing History test, `grep -n "History" packages/ui/test/*.test.tsx | head`; the heading may be a `complementary` region instead.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/protocol/test/search-commands.test.ts packages/ui/test/search-commands.test.tsx`
Expected: FAIL, `searchCommands` is not exported; no Actions group.

- [ ] **Step 3: The table**

Append to `packages/protocol/src/search-local.ts` (and add `SearchCommandId` to the type import from `./views`):

```ts
/** What the chat on screen says about itself; null away from it (home, setup). */
export interface ChatSearchContext {
  taskOpen: boolean;
  turnRunning: boolean;
  /** The task's next part while it waits for the person (flow harnesses with parts). */
  nextPart: { id: string; label: string } | null;
  /** The side panels can open (not the slim window). */
  panels: boolean;
}

export interface SearchCommandState {
  chat: ChatSearchContext | null;
  scopes: readonly { id: string; title: string; archived?: boolean }[];
  openScope: string | null;
  /** The Settings tabs this state shows. */
  tabs: readonly SearchSettingsTab[];
}

export interface SearchCommand {
  command: SearchCommandId;
  arg?: string;
  /** An i18n key under `search.command`. */
  label: string;
  vars?: Record<string, string>;
  /** English words that find it besides its label. */
  keywords: readonly string[];
}

/** The commands available now (§6 `when`), in this order. A tab's or a scope's name is `vars` the window fills. */
export function searchCommands(s: SearchCommandState): SearchCommand[] {
  const out: SearchCommand[] = [];
  const c = s.chat;
  if (c && !c.taskOpen) out.push({ command: "new-question", label: "search.command.newQuestion", keywords: ["ask", "start", "chat"] });
  if (c?.panels) {
    out.push({ command: "open-history", label: "search.command.openHistory", keywords: ["past", "tasks"] });
    out.push({ command: "open-notes", label: "search.command.openNotes", keywords: ["clear so far"] });
    out.push({ command: "open-context", label: "search.command.openContext", keywords: ["tokens", "window"] });
  }
  if (c?.nextPart) out.push({ command: "next-part", arg: c.nextPart.id, label: "search.command.nextPart", vars: { part: c.nextPart.label }, keywords: ["phase", "step"] });
  if (c?.turnRunning) out.push({ command: "stop-turn", label: "search.command.stopTurn", keywords: ["cancel", "halt"] });
  for (const tab of s.tabs) out.push({ command: "open-settings", arg: tab, label: "search.command.openSettings", vars: { tab }, keywords: ["preferences"] });
  if (!c?.turnRunning) {
    for (const scope of s.scopes) {
      if (scope.archived || scope.id === s.openScope) continue;
      out.push({ command: "switch-scope", arg: scope.id, label: "search.command.switchScope", vars: { scope: scope.title }, keywords: ["open", "go"] });
    }
  }
  return out;
}
```

(`vars.tab` holds the tab id; the window swaps in its name, Step 4.)

In `packages/i18n/src/locales/en.json`, under `search`, after `"fromPlugin"`:

```json
    "command": {
      "newQuestion": "New question",
      "openHistory": "Open History",
      "openNotes": "Open what's clear so far",
      "openContext": "Open what the AI takes into account",
      "nextPart": "Go on to the next part: {{part}}",
      "stopTurn": "Stop the AI",
      "openSettings": "Open Settings › {{tab}}",
      "switchScope": "Switch to {{scope}}"
    },
```

- [ ] **Step 4: The rows**

Append to `packages/ui/src/search/local.ts` (add `type ChatSearchContext`, `type ScopeView`, `searchCommands` to the `../client` import; `SearchSettingsTab` is already there):

```ts
/** Action rows (§6): all available ones with nothing typed (plan 1 deviation 9), else the matching ones. */
export function commandRows(t: TFunction, state: AppState, query: string, chat: ChatSearchContext | null, scopes: readonly ScopeView[], openScope: string | null): SearchHitView[] {
  const tabs = visibleTabs(state);
  const all = searchCommands({ chat, scopes, openScope, tabs }).map((c): Candidate => {
    const vars = c.command === "open-settings" && c.arg ? { tab: tabLabel(t, state, c.arg as SearchSettingsTab) } : (c.vars ?? {});
    const label = t(c.label, vars);
    const id = `command:${c.command}${c.arg ? `:${c.arg}` : ""}`;
    return { id, label, extra: [...c.keywords], hit: (title) => ({ id, kind: "command", title, context: [], hint: null, target: { kind: "command", command: c.command, ...(c.arg ? { arg: c.arg } : {}) } }) };
  });
  if (!query.trim()) return all.map((c) => c.hit([{ text: c.label }]));
  return matched(query, all);
}
```

In `packages/ui/src/search/SearchHost.tsx`:
- props gain `chatContext?: () => ChatSearchContext | null` ("The chat's state, read when the palette asks; absent: no chat on screen.");
- keep the scopes list, not only the open one's title: replace `const [scopeTitle, setScopeTitle] = useState<string | null>(null);` with `const [scopes, setScopes] = useState<ScopeView[]>([]);`, and the effect becomes:

```tsx
  useEffect(() => {
    if (!shown || !state.scopes) return setScopes([]);
    let live = true;
    client.scopes.list().then(
      (list) => {
        if (live) setScopes(list);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [client, shown, state.scopes]);
  const scopeTitle = openScope ? (scopes.find((s) => s.id === openScope)?.title ?? null) : null;
```

- the palette's `local`:

```tsx
      local={(query) => ({ query, setting: settingRows(t, state, query), command: configured ? commandRows(t, state, query, chatContext?.() ?? null, scopes, openScope) : [] })}
```

with `const configured = isConfigured(state.config);` (import `isConfigured` from `../client`).

In `packages/ui/src/HarnessApp.tsx`:
- after `searchRef`: `const searchContextRef = useRef<(() => ChatSearchContext) | null>(null);` (import the type from `./client`);
- `<ChatView … searchRef={searchRef} searchContextRef={searchContextRef} …>`;
- `<SearchHost … chatContext={() => (screen === "work" ? (searchContextRef.current?.() ?? null) : null)} />`;
- `searchIntent` handles the two commands that aren't the chat's, after the `setting` branch:

```tsx
    if (intent.kind === "command" && intent.command === "open-settings" && intent.arg) {
      setSettingsFocus(null);
      setSettings(intent.arg as SettingsTab);
      return;
    }
    if (intent.kind === "command" && intent.command === "switch-scope" && intent.arg) {
      setSettings(null);
      void client.scopes.open(intent.arg).catch(() => undefined);
      return;
    }
```

In `packages/ui/src/ChatView.tsx`:
- the props gain `searchContextRef?: { current: (() => ChatSearchContext) | null };` (documented like `searchRef`), destructured next to it;
- before `runSearchIntent`:

```tsx
  /** The task's next part, while it waits and nothing runs (the stepper's own guards). */
  const nextPartOf = (): { id: string; label: string } | null => {
    const task = tasks.current;
    if (!task || task.status !== "waiting" || blocked() || pending || phasing) return null;
    const i = taskPhases.findIndex((p) => p.id === task.phase);
    const next = i >= 0 ? taskPhases[i + 1] : undefined;
    return next ? { id: next.id, label: next.label } : null;
  };
  /** One side panel at a time (the History button's own steps). */
  const runCommand = (command: SearchCommandId): boolean => {
    switch (command) {
      case "new-question":
        if (tasks.current) return false;
        closeReader();
        setTimelineFile(null);
        setShowHistory(false);
        setNotesPanel(null);
        setContextOpen(false);
        requestAnimationFrame(() => inputRef.current?.focus());
        return true;
      case "open-history":
        if (slim) return false;
        closeReader();
        setContextOpen(false);
        setNotesPanel(null);
        setTimelineFile(null);
        setHistoryTask(undefined);
        setShowHistory(true);
        return true;
      case "open-notes":
        if (slim) return false;
        closeReader();
        setContextOpen(false);
        setTimelineFile(null);
        setShowHistory(false);
        setNotesPanel({});
        return true;
      case "open-context":
        if (slim) return false;
        openContext();
        return true;
      case "next-part": {
        const next = nextPartOf();
        if (!next) return false;
        pickPhase(next.id);
        return true;
      }
      case "stop-turn":
        if (!chat.live && !closing && !checkpoint) return false;
        void client.cancel();
        return true;
      case "open-settings":
      case "switch-scope":
        // HarnessApp's.
        return false;
    }
  };
```

- `runSearchIntent` gets `case "command": return runCommand(intent.command);`
- the `useLayoutEffect` that sets `searchRef` also sets the context getter:

```tsx
  useLayoutEffect(() => {
    if (searchContextRef) {
      searchContextRef.current = () => ({ taskOpen: Boolean(tasks.current), turnRunning: Boolean(chat.live) || closing || checkpoint, nextPart: nextPartOf(), panels: !slim });
    }
    if (!searchRef) return;
    searchRef.current = runSearchIntent;
    return () => {
      searchRef.current = null;
      if (searchContextRef) searchContextRef.current = null;
    };
  });
```

(If `openContext` is declared below `runCommand` as a `const`, that is fine: `runCommand` only calls it on a pick, after render.)

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/protocol packages/ui`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/search-local.ts packages/protocol/test/search-commands.test.ts packages/ui/src packages/ui/test/search-commands.test.tsx packages/i18n/src/locales/en.json
git commit -m "feat(search): the app's commands available now, also with nothing typed

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 11: `check` and `plugin check` rules

**Files:**
- Modify: `packages/cli/src/check.ts`, `packages/cli/src/plugin-check.ts`
- Test: `packages/cli/test/check-search.test.ts`, `packages/cli/test/plugin-check-search.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/cli/test/check-search.test.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkHarness } from "../src/check";
import { initHarness } from "../src/init";
import { CORE, replaceIn, tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-check-search-");
afterAll(cleanup);
let n = 0;

const PEOPLE = `  data: { people: { scoped: false, key: "id", agent: "none", schema: z.object({ id: z.string(), name: z.string() }), search: { title: "name" } } },\n  actions: {\n`;

async function fixture(search = PEOPLE, view?: string): Promise<string> {
  const dir = path.join(root, `h${++n}`);
  await initHarness({ dir, core: CORE, install: false });
  replaceIn(dir, "harness.config.ts", "  actions: {\n", search);
  if (view !== undefined) fs.writeFileSync(path.join(dir, "ui", "People.tsx"), view);
  return dir;
}
const rules = async (dir: string) => (await checkHarness(dir)).findings.filter((f) => f.rule === "search-data" || f.rule === "schema");

describe("check: search-data (search spec D4, §7; plan deviation 8)", () => {
  it("warns when no ui file names a searchable collection", async () => {
    expect(await rules(await fixture())).toEqual([expect.objectContaining({ rule: "search-data", severity: "warning", message: expect.stringContaining('"people"') })]);
  });

  it("warns when a view names it but none opens its records", async () => {
    const found = await rules(await fixture(PEOPLE, 'export const name = "people";\n'));
    expect(found).toEqual([expect.objectContaining({ rule: "search-data", message: expect.stringContaining("onOpenRecord") })]);
  });

  it("is quiet when a view opens its records", async () => {
    expect(await rules(await fixture(PEOPLE, 'client.search.onOpenRecord("people", (key) => show(key));\n'))).toEqual([]);
  });

  it("a field the schema lacks is a schema error", async () => {
    const found = await rules(await fixture(PEOPLE.replace('title: "name"', 'title: "nope"')));
    expect(found.some((f) => f.rule === "schema" && f.message.includes('"nope" is not a field of the schema'))).toBe(true);
  });
});
```

`packages/cli/test/plugin-check-search.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "@humanharness/harness-sdk";
import { searchFindings } from "../src/plugin-check";

const manifest = (panels: unknown[]) =>
  parsePluginManifest({
    id: "mini",
    name: "Mini",
    version: "0.1.0",
    api: 1,
    harness: "*",
    permissions: {},
    data: { items: { key: "id", agent: "read", schema: { type: "object", properties: { id: { type: "string" }, title: { type: "string" } }, required: ["id"] }, search: { title: "title" } } },
    panels,
  });

describe("plugin check: search-panel (search spec §7)", () => {
  it("warns when searchable data has no panel to open in", () => {
    expect(searchFindings(manifest([]))).toEqual([expect.objectContaining({ rule: "search-panel", severity: "warning", file: "plugin.json" })]);
  });

  it("is quiet with a panel", () => {
    expect(searchFindings(manifest([{ id: "main", title: "Main" }]))).toEqual([]);
  });
});
```

(If `PLUGIN_JSON` is a different path than `"plugin.json"`, use the constant's value: `grep -n "const PLUGIN_JSON" packages/cli/src/plugin-check.ts`.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/cli/test/check-search.test.ts packages/cli/test/plugin-check-search.test.ts`
Expected: FAIL, no `search-data` finding; `searchFindings` is not exported.

- [ ] **Step 3: `check`**

In `packages/cli/src/check.ts`, the `RuleId` union gains `| "search-data"` (after `"mock-step"`). After `sourceFiles`:

```ts
/**
 * Global search (search spec D4, §7; plan deviation 8): a searchable collection should be one the person sees, and
 * its records should open somewhere. Warnings: the manifest can't say what a view shows.
 */
async function searchFindings(h: LoadedHarness): Promise<Finding[]> {
  const names = Object.entries(h.data ?? {})
    .filter(([, c]) => c.search)
    .map(([name]) => name);
  if (names.length === 0) return [];
  const out: Finding[] = [];
  const uiPath = resolveField(h, "ui", h.ui ?? "ui", out);
  const texts = uiPath === null ? [] : await Promise.all((await sourceFiles(uiPath)).map(async (f) => (await read(f)) ?? ""));
  const all = texts.join("\n");
  for (const name of names) {
    const quoted = new RegExp(`["'\`]${escapeRegExp(name)}["'\`]`);
    const opens = new RegExp(`onOpenRecord\\(\\s*["'\`]${escapeRegExp(name)}["'\`]`);
    if (!quoted.test(all)) out.push(warning("search-data", `"${name}" is searchable but no file in ui/ shows it: search would find records the person can't see. Show it in a view, or drop its search.`, MANIFEST));
    else if (!opens.test(all)) out.push(warning("search-data", `"${name}" is searchable but no view calls client.search.onOpenRecord("${name}", …): its records would only say where they are shown.`, MANIFEST));
  }
  return out;
}
```

and in `checkHarness`, after `findings.push(...settingsFindings(harness));`:

```ts
  findings.push(...(await searchFindings(harness)));
```

(If `escapeRegExp` isn't in `check.ts`, it is a one-liner: `const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");`. If `h.data` is not optional on `LoadedHarness`, drop the `?? {}`.)

- [ ] **Step 4: `plugin check`**

In `packages/cli/src/plugin-check.ts`, `PluginRule` gains `| "search-panel"`. After `manifestFindings`:

```ts
/** Global search (search spec §7): a searchable collection's records open in a panel; without one, nowhere. */
export function searchFindings(m: PluginManifest): PluginFinding[] {
  const names = Object.entries(m.data)
    .filter(([, c]) => c.search)
    .map(([name]) => name);
  if (names.length === 0 || m.panels.length > 0) return [];
  return [warning("search-panel", `${names.map((n) => `"${n}"`).join(", ")} ${names.length === 1 ? "is" : "are"} searchable but the plugin has no panel: a found record would open nowhere. Add a panel, or drop search.`, PLUGIN_JSON)];
}
```

and where `manifestFindings` is called (`findings.push(...manifestFindings(m));`), after it:

```ts
  findings.push(...searchFindings(m));
```

(`warning` is defined next to `error` as `const warning = finding("warning");`; if it's missing, add it there.)

- [ ] **Step 5: Run the cli tests**

Run: `corepack pnpm vitest run packages/cli/test/check-search.test.ts packages/cli/test/plugin-check-search.test.ts packages/cli`
Expected: PASS. Under load some cli tests time out; rerun a failing file alone before calling it a failure.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/check.ts packages/cli/src/plugin-check.ts packages/cli/test/check-search.test.ts packages/cli/test/plugin-check-search.test.ts
git commit -m "feat(cli): check warns about searchable data nothing shows or opens

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 12: End-to-end check and the docs

**Files:**
- Create: `packages/e2e/tests/search-settings.spec.ts`
- Modify: `docs/architecture/search.md`, `docs/architecture/data.md`, `docs/architecture/plugins.md`

- [ ] **Step 1: Write the e2e test**

`packages/e2e/tests/search-settings.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { closeAndClean, launchMock, makeSandbox } from "./helpers";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

test("⌘K: a setting opens Settings at the field; an action runs; nothing typed lists the actions", async () => {
  const s = makeSandbox("search-settings");
  const { app, page } = await launchMock(s);
  try {
    await page.getByRole("button", { name: "Start Demo" }).click();
    const dialog = page.getByRole("dialog", { name: "Search" });

    await page.keyboard.press(`${MOD}+k`);
    await expect(dialog.getByRole("group", { name: "Actions" })).toBeVisible();
    await page.keyboard.type("appearance");
    await expect(dialog.getByRole("group", { name: "Settings" })).toBeVisible();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "Settings" });
    await expect(sheet.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
    await expect(sheet.locator('[data-setting="general.appearance"] :focus')).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    await page.keyboard.press(`${MOD}+k`);
    await page.keyboard.type("history");
    await dialog.getByRole("option", { name: /Open History/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  } finally {
    await closeAndClean(app, s);
  }
});
```

(How the History panel is found: copy from the e2e test that opens it, `grep -rn "History" packages/e2e/tests/*.spec.ts | head`.)

- [ ] **Step 2: Build and run it**

Run: `corepack pnpm app:build && corepack pnpm e2e -- search-settings.spec.ts search.spec.ts`
Expected: both PASS (plan 1's `search.spec.ts` unchanged and green).

- [ ] **Step 3: The docs**

`docs/architecture/search.md`, a new section after the last one:

```markdown
## Plan 2: settings, actions and data

- **Settings and Actions are the window's.** `SEARCHABLE_SETTINGS` and `searchCommands` (`packages/protocol/src/search-local.ts`) list them; `packages/ui/src/search/local.ts` builds the rows each time the palette asks, matched by word prefix (`localScore`, accents and case folded). `SearchPalette`'s `local` merges them with main's answer: groups in §3's order (Tasks, Notes, Files, Settings, Actions, Data), their chips, ⌘1–7. Main's `hh:search` never sees them; they never join the recents.
- **A setting opens Settings at its field.** Each searchable row carries `data-setting="<tab>.<field>"` (harness fields `harness:<name>`); `focusSetting` focuses its first usable control (else the row) and flashes it. The registry test fails when a row and the registry disagree.
- **Actions** are the ones available now: New question (no task open), History, notes and context (not slim), the next part (the task waits), Stop (a turn runs), each visible Settings tab, each scope that isn't open or archived (no turn running). With nothing typed they show after the recents.
- **Data records.** A collection opts in with `search: { title, text? }` (harness: zod field names; plugin: JSON schema property names and an optional `panel`). Main lists the sources (`harness:<folder>/<collection>`, `plugin:<plugin>/<collection>`), stamps each with its file's size and mtime, and reads a source again only when its stamp changed. Documents `data:<source>#<key>` keep no text; a snippet reads the collection again. `files.json` keeps `data: { <source>: { stamp, ids } }`. At most 20,000 data documents.
- **What opens a record.** A harness record goes to the view listening with `client.search.onOpenRecord(collection, (key, scope) => …)` (last listener wins); none listening: the row says "Shown in <harness>". A plugin record opens the plugin's panel with the key as focus; a plugin without panels: "From <plugin>", Enter only closes search.
- **Reindex triggers.** The palette opening (and every 5 s while typing), every `DataStore` write, a plugin run's writes and a plugin turned on or off (`SearchService.dataChanged()`), a commit under `.harness/data/` and a restore. All are no-ops until search was opened (D0).
- **Checks.** `check` warns `search-data` (no ui file names the collection, or none calls `onOpenRecord`); `plugin check` warns `search-panel` (searchable data, no panel). The permission review shows "Searchable: <collection> (<fields>)".
```

`docs/architecture/data.md`, in the collection fields list (next to `context`):

```markdown
- `search` (optional): `{ title, text? }`, the fields global search indexes (`text`: one field or up to five). Absent, the collection is never searched. A view opens a found record with `client.search.onOpenRecord("<collection>", (key, scope) => …)`; `key` is null for a `single` collection. See `search.md`.
```

`docs/architecture/plugins.md`, in the manifest's `data` section:

```markdown
- `search` (optional): `{ title, text?, panel? }`. Global search indexes those fields while the plugin is on; a found record opens `panel` (default: the first panel) with its key as the panel's focus. The permission review lists it as "Searchable:". No panel: `plugin check` warns (`search-panel`).
```

- [ ] **Step 4: Full verification**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build && corepack pnpm e2e`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/e2e/tests/search-settings.spec.ts docs/architecture/search.md docs/architecture/data.md docs/architecture/plugins.md
git commit -m "test(e2e): settings and actions from search; docs: plan 2 of global search

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

## Self-review

**Spec coverage (plan 2's part of §13):**

| Spec item | Task |
|---|---|
| §6 settings registry, opening at the field, focus | 9 (registry, `data-setting`, `focusSetting`), 8 (rows in the palette) |
| §6 harness settings, one row per field | 9 (`harness:<name>`, advanced opens "More settings") |
| §6 actions with `when` | 10 (`searchCommands`, chat context, HarnessApp's two) |
| §3 Settings and Actions groups, chips, ⌘1–7 | 8 |
| D4 `search: { title, text? }` on collections | 1 (harness and plugin, schema errors) |
| D4 indexing records, recency, secrets (§8.2) | 2 (`recordRows`, `dataDocs`), 5 (service), 4 (snapshot) |
| §4.2 reindex on writes, plugin runs, restore | 5 (`dataChanged`, `committed`), 7 (wiring) |
| §3 Data rows: harness view or plugin panel | 3 (targets, `onOpenRecord`, tags), 6 (panel per source) |
| §7 turned-off plugin's records leave and come back | 6 (`searchSources` lists running plugins), 7 (`changed` reindexes) |
| §7 `check` rules | 1 (schema), 11 (`search-data`, `search-panel`) |
| §7 permission review line | 6 |
| Plan 1 deviation 9 (actions with nothing typed) | 8, 10 |
| Plan 1 deviation 12 (`onOpenRecord`) | 3 |
| Plan 1 deviation 15 (`.harness/data/` opt-in) | 2, 5, 7 (through the stores; the walk still skips it) |
| Docs | 12 |

**Placeholder scan:** a few steps say "copy the line the existing test uses" where a helper's exact name (the i18n setup in a ui test, `FakeClient`'s state getter, how History shows) must match the repo; each gives the grep that finds it. No step leaves code to invent.

**Type consistency:** `DataSource`/`DataRow`/`DataRef`/`DataMeta` (Task 2) are what Tasks 4–7 use; `SearchIndexKind` (Task 3) and `SearchRowKind` (widened in Task 8) are what `model.ts` and the palette use; `SearchSettingsTab` (Task 8) is `SettingsTab` (Task 9); `ChatSearchContext` and `SearchCommandId` (Tasks 8, 10) are what `ChatView`, `HarnessApp` and `SearchHost` use; `searchSources`/`searchRows` (Task 6) are what Task 7 calls; `harnessSources`/`harnessRows` (Task 7) match their test.
