# Global Search Implementation Plan (plan 1 of 2: index and palette)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ⌘K (Ctrl+K off macOS) opens a search palette over the main window that finds tasks, notes and files (the person's folder and the reference folders) with a deterministic, local, lazily built `minisearch` index, opens a result with Enter, and turns the query into a prepared question with ⌘Enter, without sending anything.

**Architecture:**
- **`packages/search`** (new, pure: no Electron, no `node:fs`): the document shapes and builders per kind, the deny rules (§8.1) and the `.gitignore` matcher, the content check (§8.2), the `minisearch` options, query and ranking (AND with the OR fallback, boosts), snippet windows with marks, heading anchors for the reader, and `LiveIndex`, which implements the spec's `SearchIndex` seam (D6).
- **`packages/shell/src/main/search/`**: `walk.ts` (the folder walk with the deny rules, `.gitignore` and links never followed), `build.ts` (reads files through `readCapped`, makes documents, indexes chats incrementally), `worker.ts` + `runner.ts` (the build in a `worker_threads` worker, the same pattern as `diff-runner.ts`), `store.ts` (the persisted snapshot under `<userData>/search/<hash>/`), `service.ts` (lazy, owns the live index, the triggers, snippets, recents), `views.ts` (hits to the window's view model) and `ipc.ts` (`hh:search`, `hh:searchOpen`).
- **`packages/protocol`** gains the view types, `SearchClient`, `HarnessClient.search`, and the channels `hh:search`, `hh:searchOpen` (invoke) and `hh:searchStatus` (push).
- **`packages/ui/src/search/`** (self-contained, so the UI refresh can move it as a unit): the pure row/chip model, the ⌘Enter text, `SearchPalette.tsx` and `SearchHost.tsx` (the ⌘K binding). `HarnessApp` mounts the host; `ChatView` takes "search intents" (reader at an anchor, file timeline, History at a task, chat entry, composer draft, start an action) through a ref, the same way it already takes `startRef`.
- **D0/D8:** nothing is created, read or started until the first `hh:search`: no `<userData>/search/`, no worker, no extra listener on `onCommit` (the existing commit announcer calls `search.committed()`, a no-op until search was opened), no new line in `config.json`.

**Tech Stack:** TypeScript (tsc 7, `moduleResolution: bundler`), pnpm via corepack, `minisearch@^7.2.0`, `ignore@^5.3.2`, Vitest (+ happy-dom for `ui`), Electron 44 + electron-vite 5, Playwright e2e (mock mode).

Spec: `docs/superpowers/specs/2026-10-30-global-search-design.md`. "§" and "D" numbers below refer to it. Plan 2 (settings and commands registry, opt-in data collections, `check` rules, the permission review line) is out of scope here.

---

## Deviations from the spec (decided while planning; tell Marco)

1. **The build runs in a `node:worker_threads` worker, not a `utilityProcess` (§4.3).** "The same pattern as `material`'s worker runner" is in fact `worker_threads` (`material/src/convert/isolate.ts`, `shell/src/main/diff-runner.ts`). A worker thread keeps main responsive the same way, runs under Vitest through tsx, and needs no Electron in tests. The built entry is `search-worker.js`, beside `diff-worker.js`.
2. **The index folder is keyed by the base, `<userData>/search/<sha256(base)[0..16]>/` (§4.1 says `<folder-hash>/<profile>/`).** With profiles the base already is the profile's own folder, so each profile has its own index and none crosses profiles, exactly as `historyDir` does. **A folder move deletes the old index instead of moving it** (it is a rebuildable cache; §4.1 allows throwing it away); the next ⌘K rebuilds it.
3. **Recents and the "All scopes" toggle live in `prefs.json` inside the index folder, not in `config.json` (§5.2, §5.5).** That makes them per profile for free (config.json is app-wide) and keeps §11's "no new lines in config.json" true even after search is used.
4. **No reconcile at startup (§4.2 "and at startup if an index exists").** Loading an index at startup would put the `MiniSearch` instance in main's memory for every person who once opened search. The first ⌘K of each run loads the snapshot and reconciles; results are just as fresh when they are first looked at.
5. **Chats are indexed by the build, incrementally, not "in the same tick" as the recorder appends (§4.2).** Chats are append-only, so each reconcile (on ⌘K, at most every 60 s, and on every commit's update) reads only the bytes past the stored offset. An engine switch's archived chat leaves the index at the next reconcile (its file is gone or shorter). This keeps all file reading in the worker and needs no hook in `ChatLog`.
6. **Tasks and actions are rebuilt on each open, inside the same `MiniSearch` instance (§4.2 "Tasks and actions").** On an empty query (the palette opening), and at most every 5 s while typing, main rebuilds the manifest actions with their status, the open task and the past tasks, and swaps them in under `action:`/`open:`/`past:` ids. Their ids are kept in `files.json` only so a later run can take them out.
7. **`hh:searchOpen(hit)` records the recent and does "Show in Finder" for a reference folder's file; every other open is routed in the window (§9).** The reader, the file timeline, the History panel, the chat and the composer are window state that main can't drive. A reference file's absolute path never reaches the window: main finds it from the hit's id.
8. **⌘K is bound in the renderer (a capturing `keydown` on `window`), not in main's `before-input-event`.** The palette is renderer state; the binding is still "only the main window" (plugin and tool windows have their own pages).
9. **With nothing typed the palette shows the recents only (§5.2 adds "then the available actions").** "Actions" are plan 2's commands. The manifest's actions are still found by typing (Tasks kind).
10. **⌘Enter with a task open puts the text in the composer of what is on screen; sending it is a follow-up in that task (§5.4 asks for the "start another topic" confirmation).** Product question for Marco: should ⌘Enter with an open task close it first (the same confirmation as another topic), or stay a follow-up? Plan 1 ships the follow-up because nothing is sent either way (D3 holds).
11. **A chat entry that isn't on screen opens the History panel at its task's row instead of scrolling (§3; this answers §15's second open question).** Flow mode shows one task at a time and the chat loads its last 200 entries; paging the chat to an older task is a chat-view change this plan doesn't take on. An entry that is on screen scrolls into view and is highlighted for 2 s.
12. **`client.search.onOpenRecord` is not added in plan 1 (§9).** It only serves the Data kind (plan 2).
13. **The reader's `anchor` already exists** (`client.openDocument(path, anchor)`, `ReaderTarget.anchor`, the reader scrolls to it); §10's "one new optional field" is already there. Plan 1 only computes the slug of the heading above the match (`headingAnchorAt`, ATX headings with the reader's own `createSlugger`; setext headings get no anchor).
14. **A reference folder's `.md` opens in the reader by its path relative to that folder.** The reader resolves a path against the person's folder first, then the reference folders; if the person's folder has a file at the same relative path, that one shows. Edge case, noted in code.
15. **`.harness/data/` is not indexed in plan 1** (collections are opt-in, plan 2). `.harness/reviews/` is indexed as files, as §8.1 allows.
16. **Nested `.gitignore` files: a `!pattern` re-includes only within its own file.** A parent's ignore wins over a child's negation (the `ignore` package per file, checked from the root down). Git's exact precedence across files is not reproduced.
17. **Snippets are read for at most 20 rows per answer**; the others show their path. With a filter (50 rows) this bounds the reads per keystroke.
18. **New dependencies of `@humanharness/search`: `minisearch@^7.2.0` and `ignore@^5.3.2`.** Both are already in `pnpm-lock.yaml` (`minisearch@7.2.0` through `material`, `ignore@5.3.2` through `isomorphic-git`), so `corepack pnpm install --offline` only links them: nothing is downloaded. **If the offline install is refused in the sandbox, that step is Marco's** (Task 1, Step 3); every later task needs it.
19. **The budgets of §4.4 are measured by an opt-in test (`HH_SEARCH_BUDGET=1`) and reported in the PR, not asserted in CI.** Timing asserts would be flaky under the suite's load.
20. **The answer carries `counts` per kind** besides the groups, so the filter chips keep their counts while one filter is on (§5.5 "one chip per kind that has results, with its count").
21. **In a harness with scopes, a note directly in `.harness/notes/` (not in a scope's folder) counts as `_app`**, and the person's folder files, reference files and manifest actions are `_app` too, so they show in every scope (D2). Without scopes everything is `main` and no scope filter applies.
22. **The secret checks are wider than §8.1/§8.2 first said (widened 2026-10-30, approved by Marco; the spec is updated).** The content check scans up to `MAX_TEXT_BYTES`, not the first 256 KB (the security fix). It also matches `ghu_`/`ghs_`/`ghr_`, the Slack kinds `xox[abcdeoprs]-` and `xapp-`, JWTs, `ASIA…`, the PGP private key header, a base64-encoded PEM block, Stripe `sk_live_`/`rk_live_` and Google `AIza` keys. Denied by name or path, besides §8.1's list: any name ending `.env`, `*.jks`, any path with a `.aws` part, `.kube/config`, `.docker/config.json`, `.config/gh/hosts.yml`/`.yaml`.

**Blocker check (asked for):** `minisearch` is **not** missing: `packages/material/package.json` depends on `minisearch@^7.2.0` and the lockfile has `minisearch@7.2.0`. The only environment step is the offline link in Task 1 (deviation 18).

---

## Conventions

- English everywhere; packages export TS source; extensionless imports; tests in `packages/<name>/test/`; one commit per task; run every command from the worktree root (`/Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-search`), never `cd` elsewhere.
- `@humanharness/search` stays pure: no `node:*`, no `electron`, no `react`. `@humanharness/protocol` keeps its rules (`boundary.test.ts`): type imports only, no Node.
- Every new IPC channel goes into `packages/protocol/src/channels.ts`; `channels.test.ts` fails if main or the preload names a channel outside the table or a table channel is unused.
- `ui/src` imports only `protocol` (through `./client`), `harness-sdk`, `i18n`. The palette lives in `packages/ui/src/search/` and its CSS in one delimited block at the end of `styles.css` with the `hh-search-` prefix.
- Tests never read `~/.claude`, `~/.codex`, credential files or the real Keychain; fixtures live in `os.tmpdir()` folders made with `fs.mkdtemp` and removed in `afterEach`. No network.
- Verification: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`, `corepack pnpm e2e`. One file: `corepack pnpm vitest run packages/search/test/query.test.ts`. Under load some cli tests time out; rerun a failing file alone before calling it a failure.
- Commit trailer (every commit):
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv
  ```
- Never `git stash`, never push. Install nothing from the network; `corepack pnpm install --offline` only links.

## Files

| File | Change |
|---|---|
| `packages/search/package.json` | **new** |
| `packages/search/src/types.ts`, `options.ts`, `deny.ts`, `limits.ts`, `gitignore.ts`, `secrets.ts`, `docs.ts`, `anchor.ts`, `snippet.ts`, `query.ts`, `live-index.ts`, `index.ts` | **new** |
| `packages/search/test/*.test.ts` | **new** |
| `packages/protocol/src/views.ts`, `shared.ts`, `client.ts`, `channels.ts` | search view types, `SEARCH_KINDS`, `SearchClient`, `HarnessClient.search`, three channels |
| `packages/shell/src/main/search/read.ts`, `walk.ts`, `build.ts`, `worker.ts`, `runner.ts`, `store.ts`, `views.ts`, `service.ts`, `ipc.ts` | **new** |
| `packages/shell/src/preload/search.ts` | **new**: `searchClient(invoke, subscribe)` |
| `packages/shell/src/preload/index.ts` | `search: searchClient(...)` |
| `packages/shell/src/main/index.ts` | the service, its handlers, `committed` from the commit announcer and after a restore, flush on quit, discard on a folder move |
| `packages/shell/electron.vite.config.ts` | `@humanharness/search` bundled; `search-worker` entry |
| `packages/shell/package.json` | `+@humanharness/search` |
| `packages/shell/test/search-*.test.ts` | **new** |
| `packages/ui/src/search/intent.ts`, `model.ts`, `ask.ts`, `SearchPalette.tsx`, `SearchHost.tsx` | **new** |
| `packages/ui/src/HarnessApp.tsx` | mounts `SearchHost`, routes intents |
| `packages/ui/src/ChatView.tsx` | `searchRef` prop: runs intents |
| `packages/ui/src/HistoryPanel.tsx` | `openTask` prop |
| `packages/ui/src/styles.css` | the palette's block |
| `packages/ui/test/fake-client.ts` | `search` stub |
| `packages/ui/test/search-*.test.tsx` | **new** |
| `packages/i18n/src/locales/en.json` | `search.*` strings |
| `packages/e2e/tests/search.spec.ts` | **new** |
| `docs/architecture/search.md` | **new**: how the index works, what is never indexed, the deviations |

---

### Task 1: Create `@humanharness/search` with its types and `minisearch` options

**Files:**
- Create: `packages/search/package.json`, `packages/search/src/types.ts`, `packages/search/src/options.ts`, `packages/search/src/index.ts`
- Test: `packages/search/test/options.test.ts`
- Modify: `pnpm-lock.yaml` (by pnpm)

- [ ] **Step 1: Create the package manifest**

`packages/search/package.json`:

```json
{
  "name": "@humanharness/search",
  "version": "0.1.0",
  "type": "module",
  "license": "Apache-2.0",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@humanharness/harness-sdk": "workspace:*",
    "ignore": "^5.3.2",
    "minisearch": "^7.2.0"
  }
}
```

- [ ] **Step 2: Write the failing test**

`packages/search/test/options.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { INDEX_VERSION, KINDS, fold, indexOptions } from "../src";

describe("search options", () => {
  it("folds accents and case, like material_search", () => {
    expect(fold("Fracción")).toBe("fraccion");
    expect(fold("ÉLAN")).toBe("elan");
  });

  it("indexes title, path and text; stores the routing fields but never the text (§4.1)", () => {
    const o = indexOptions();
    expect(o.fields).toEqual(["title", "path", "text"]);
    expect(o.storeFields).toContain("title");
    expect(o.storeFields).toContain("path");
    expect(o.storeFields).not.toContain("text");
  });

  it("plan 1 has three kinds and a version", () => {
    expect(KINDS).toEqual(["task", "note", "file"]);
    expect(INDEX_VERSION).toBe(1);
  });
});
```

- [ ] **Step 3: Link the dependencies (offline) — Marco's step if the sandbox refuses it**

Run: `corepack pnpm install --offline`
Expected: the lockfile gains an `importers['packages/search']` entry naming `minisearch 7.2.0` and `ignore 5.3.2`; "Done" with no download. If it fails with a network or permission error, stop and ask Marco to run exactly this command; nothing below works without it.

- [ ] **Step 4: Run the test to see it fail**

Run: `corepack pnpm vitest run packages/search/test/options.test.ts`
Expected: FAIL, `Cannot find module '../src'` (or its exports).

- [ ] **Step 5: Write the types**

`packages/search/src/types.ts`:

```ts
// The global search's documents and hits (search spec §3, §9). Pure: no Node, no Electron.

/** Plan 1's kinds; plan 2 adds settings, commands and data. */
export type Kind = "task" | "note" | "file";
export const KINDS: readonly Kind[] = ["task", "note", "file"];

/** What a task-like row says besides its title (the window localizes it). */
export interface DocMeta {
  status?: "not-started" | "done" | "unsaved" | "unfinished" | "open" | "past";
  tier?: string;
  role?: "user" | "assistant";
}

/** Where a chat entry's line is: its file (relative to the base), byte offset and length. */
export interface ChatRef {
  file: string;
  offset: number;
  length: number;
  entry: string;
  task?: string;
}

/** One searchable thing. `text` is indexed and never stored (§4.1). */
export interface SearchDoc {
  id: string;
  kind: Kind;
  /** A scope id, `_app`, or `main` (§7). */
  scope: string;
  title: string;
  /** Relative to its root (files and notes); "" otherwise. */
  path: string;
  text?: string;
  /** Last change, ms since the epoch (0: unknown); the recency boost reads it. */
  at: number;
  /** `folder`, or `ref:<id>` for a reference folder. */
  root?: string;
  chat?: ChatRef;
  action?: string;
  task?: string;
  meta?: DocMeta;
}

export type StoredDoc = Omit<SearchDoc, "text">;

/** A query's match: the stored fields, its score and the index terms it matched (already folded). */
export interface SearchHit extends StoredDoc {
  score: number;
  terms: string[];
}

/** Staged readiness (D8): memory → names → text. */
export interface IndexState {
  state: "empty" | "names" | "building" | "ready";
  done: number;
  total: number;
  truncated?: true;
}

/** How a file was indexed (`files.json`, §4.1). */
export interface FileMeta {
  size: number;
  mtimeMs: number;
  how: "text" | "name-only" | `skipped:${string}`;
}

/** A chat file read up to `size` bytes, and the ids of its entries in the index. */
export interface ChatMeta {
  size: number;
  ids: string[];
}
```

- [ ] **Step 6: Write the options**

`packages/search/src/options.ts`:

```ts
import type { Options } from "minisearch";
import type { SearchDoc } from "./types";

/** Bumped when the snapshot's shape or the options change: an older snapshot is thrown away and rebuilt (§4.1). */
export const INDEX_VERSION = 1;

/** Lowercase, accents folded (`Fracción` finds `fraccion`): the text and the query alike (§5.3). */
export const fold = (term: string): string => term.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();

/** Only what a row shows and what opening it needs; never the text (§4.1). */
export const STORE_FIELDS = ["kind", "scope", "title", "path", "at", "root", "chat", "action", "task", "meta"] as const;

/** §5.3: title ×3, path or name ×2, text ×1. */
export const FIELD_BOOST = { title: 3, path: 2, text: 1 };

export function indexOptions(): Options<SearchDoc> {
  return {
    idField: "id",
    fields: ["title", "path", "text"],
    storeFields: [...STORE_FIELDS],
    processTerm: (term) => fold(term) || null,
  };
}
```

- [ ] **Step 7: Write the entry point**

`packages/search/src/index.ts`:

```ts
export * from "./types";
export * from "./options";
```

- [ ] **Step 8: Run the test to see it pass, and typecheck**

Run: `corepack pnpm vitest run packages/search/test/options.test.ts && corepack pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add packages/search pnpm-lock.yaml
git commit -m "feat(search): the search package, its document types and minisearch options

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 2: The deny rules and the limits (§8.1, §4.5)

**Files:**
- Create: `packages/search/src/deny.ts`, `packages/search/src/limits.ts`
- Modify: `packages/search/src/index.ts`
- Test: `packages/search/test/deny.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/search/test/deny.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_IGNORED_DIRS, deniedName, deniedPath, overTextBudget } from "../src";

describe("deniedPath (§8.1)", () => {
  it.each([
    ".git/config",
    "a/.git/HEAD",
    ".claude/settings.json",
    "x/.claude/agents/a.md",
    ".harness/tasks.json",
    ".harness/usage.jsonl",
    ".harness/data/main/tickets.json",
    ".harness/context/main.json",
    ".harness/data-meta/main.json",
    "AGENTS.md",
    ".env",
    ".env.local",
    "conf/.ENV.production",
    "certs/site.pem",
    "a/b/server.key",
    "x.p12",
    "x.pfx",
    "app.keystore",
    "id_rsa",
    "keys/id_rsa.pub",
    "id_ed25519",
    "id_ecdsa",
    ".npmrc",
    ".pypirc",
    ".netrc",
    ".git-credentials",
    "credentials.json",
    "aws/Credentials",
    "secrets.yaml",
    "vault.kdbx",
    "config.json.123e4567-e89b-12d3-a456-426614174000.tmp",
  ])("denies %s", (p) => {
    expect(deniedPath(p)).toBe(true);
  });

  it.each([
    ".harness",
    ".harness/notes/a.md",
    ".harness/notes/physics/a.md",
    ".harness/reviews/docs/a.md.json",
    ".harness/chats/main.jsonl",
    "docs/env.md",
    "keys.md",
    "my-credential-notes.md",
    "secrets",
    "src/key.ts",
  ])("allows %s", (p) => {
    expect(deniedPath(p)).toBe(false);
  });

  it("denies the engine's instructions file when told", () => {
    expect(deniedPath("CLAUDE.md")).toBe(false);
    expect(deniedPath("CLAUDE.md", ["CLAUDE.md"])).toBe(true);
  });

  it("names are compared without case", () => {
    expect(deniedName("ID_RSA")).toBe(true);
    expect(deniedName("Server.PEM")).toBe(true);
  });

  it("has the default list for a folder without .gitignore", () => {
    expect(DEFAULT_IGNORED_DIRS).toEqual(["node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", "target", ".DS_Store"]);
  });
});

describe("overTextBudget (§4.5)", () => {
  it("takes the largest files out first until the total fits", () => {
    const over = overTextBudget(
      [
        { key: "a", size: 50 },
        { key: "b", size: 10 },
        { key: "c", size: 40 },
      ],
      60,
    );
    expect([...over].sort()).toEqual(["a"]);
  });

  it("takes nothing out when everything fits", () => {
    expect(overTextBudget([{ key: "a", size: 1 }], 10).size).toBe(0);
  });
});
```

`secrets` (a folder or file named exactly that, no dot) is allowed: only `secrets.*` is in §8.1.

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm vitest run packages/search/test/deny.test.ts`
Expected: FAIL, `deniedPath` is not exported.

- [ ] **Step 3: Write `deny.ts`**

```ts
// What is never indexed (search spec §8.1), as pure predicates over paths relative to a root, with forward slashes.

/** By name, at any depth, compared without case. These files are not even indexed by name. */
const SECRET_NAMES: readonly RegExp[] = [
  /^\.env$/,
  /^\.env\..+$/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /\.keystore$/,
  /^id_rsa/,
  /^id_ed25519/,
  /^id_ecdsa/,
  /^\.npmrc$/,
  /^\.pypirc$/,
  /^\.netrc$/,
  /^\.git-credentials$/,
  /^credentials/,
  /^secrets\./,
  /\.kdbx$/,
];

/** The app's temp files (an atomic write's `<name>.<uuid>.tmp`). */
const TEMP_NAME = /\.tmp$/i;

/** Under `.harness/`, only these are the person's: notes, review records and chats (data is plan 2's opt-in). */
const HARNESS_ALLOWED: readonly string[] = ["notes", "reviews", "chats"];

/** Applied only when the root has no `.gitignore` (§8.1). Folder (or file) names, at any depth. */
export const DEFAULT_IGNORED_DIRS: readonly string[] = ["node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", "target", ".DS_Store"];

export function deniedName(name: string): boolean {
  const n = name.toLowerCase();
  return TEMP_NAME.test(n) || SECRET_NAMES.some((r) => r.test(n));
}

/**
 * True when `rel` (a file or a folder) must never be indexed nor walked into. `extra`: more exact paths, such as the
 * engine's generated instructions file.
 */
export function deniedPath(rel: string, extra: readonly string[] = []): boolean {
  const parts = rel.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return true;
  if (parts.includes(".git") || parts.includes(".claude")) return true;
  if (parts[0] === ".harness" && parts.length > 1 && !HARNESS_ALLOWED.includes(parts[1])) return true;
  if (rel === "AGENTS.md" || extra.includes(rel)) return true;
  return parts.some(deniedName);
}
```

- [ ] **Step 4: Write `limits.ts`**

```ts
// The caps of search spec §4.5.

/** Text is indexed up to this size per file; a bigger file is indexed by name only. */
export const MAX_TEXT_BYTES = 1024 * 1024;
/** Files across the folder and the reference folders; past it the rest are left out (folder first). */
export const MAX_FILES = 50_000;
/** Indexed text in all; past it, files go name-only, the largest first. */
export const MAX_TOTAL_TEXT_BYTES = 200 * 1024 * 1024;

/** The keys to index by name only so the total fits `cap`: the largest go first. */
export function overTextBudget(sizes: readonly { key: string; size: number }[], cap: number = MAX_TOTAL_TEXT_BYTES): Set<string> {
  let total = sizes.reduce((sum, f) => sum + f.size, 0);
  const out = new Set<string>();
  for (const f of [...sizes].sort((a, b) => b.size - a.size)) {
    if (total <= cap) break;
    out.add(f.key);
    total -= f.size;
  }
  return out;
}
```

- [ ] **Step 5: Export them**

`packages/search/src/index.ts`, add:

```ts
export * from "./deny";
export * from "./limits";
```

- [ ] **Step 6: Run the test to see it pass**

Run: `corepack pnpm vitest run packages/search/test/deny.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/search
git commit -m "feat(search): the deny rules and the index's caps

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 3: The `.gitignore` matcher (§8.1)

**Files:**
- Create: `packages/search/src/gitignore.ts`
- Modify: `packages/search/src/index.ts`
- Test: `packages/search/test/gitignore.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/search/test/gitignore.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GitIgnore } from "../src";

describe("GitIgnore (§8.1)", () => {
  const g = new GitIgnore();
  g.add("", "node_modules/\n*.log\n/build\n!keep.log\n");
  g.add("sub", "secret/\n*.tmp\n");

  it("applies the root file at any depth, folder patterns to folders only", () => {
    expect(g.ignored("node_modules", true)).toBe(true);
    expect(g.ignored("a/node_modules", true)).toBe(true);
    expect(g.ignored("node_modules", false)).toBe(false);
    expect(g.ignored("x.log", false)).toBe(true);
    expect(g.ignored("deep/x.log", false)).toBe(true);
  });

  it("keeps a negation inside its file and an anchored pattern at its root", () => {
    expect(g.ignored("keep.log", false)).toBe(false);
    expect(g.ignored("build", true)).toBe(true);
    expect(g.ignored("src/build", true)).toBe(false);
  });

  it("applies a nested file only below its folder", () => {
    expect(g.ignored("sub/secret", true)).toBe(true);
    expect(g.ignored("other/secret", true)).toBe(false);
    expect(g.ignored("sub/a/b.tmp", false)).toBe(true);
    expect(g.ignored("b.tmp", false)).toBe(false);
  });

  it("is empty until a file is added", () => {
    expect(new GitIgnore().empty).toBe(true);
    expect(g.empty).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm vitest run packages/search/test/gitignore.test.ts`
Expected: FAIL, `GitIgnore` is not exported.

- [ ] **Step 3: Write `gitignore.ts`**

```ts
import ignore, { type Ignore } from "ignore";

/**
 * The `.gitignore` files of one root (the root's and nested ones; never the global one), checked from the root down.
 * Any file that ignores a path wins: a `!pattern` re-includes only within its own file (plan deviation 16).
 */
export class GitIgnore {
  private readonly rules: { dir: string; ig: Ignore }[] = [];

  /** `dir`: the folder holding the file, relative to the root ("" for the root). */
  add(dir: string, text: string): void {
    this.rules.push({ dir, ig: ignore().add(text) });
  }

  get empty(): boolean {
    return this.rules.length === 0;
  }

  ignored(rel: string, isDir: boolean): boolean {
    for (const r of this.rules) {
      if (r.dir !== "" && !rel.startsWith(`${r.dir}/`)) continue;
      const sub = r.dir === "" ? rel : rel.slice(r.dir.length + 1);
      if (r.ig.ignores(isDir ? `${sub}/` : sub)) return true;
    }
    return false;
  }
}
```

- [ ] **Step 4: Export it**

`packages/search/src/index.ts`, add: `export * from "./gitignore";`

- [ ] **Step 5: Run the test to see it pass, and typecheck**

Run: `corepack pnpm vitest run packages/search/test/gitignore.test.ts && corepack pnpm typecheck`
Expected: PASS; typecheck clean (`ignore@5.3.2` ships `index.d.ts` with `export default ignore` and `export interface Ignore`).

- [ ] **Step 6: Commit**

```bash
git add packages/search
git commit -m "feat(search): .gitignore matching for the folder walk

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 4: The content check (§8.2)

**Files:**
- Create: `packages/search/src/secrets.ts`
- Modify: `packages/search/src/index.ts`
- Test: `packages/search/test/secrets.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/search/test/secrets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SECRET_SCAN_BYTES, secretShaped, withoutSecretLines } from "../src";

describe("secretShaped (§8.2)", () => {
  it.each([
    `key = sk-${"a".repeat(40)}`,
    `ghp_${"A".repeat(36)}`,
    `gho_${"b".repeat(36)}`,
    `github_pat_${"A1".repeat(20)}`,
    "token: xoxb-1234567890-abcdef",
    "AKIAABCDEFGHIJKLMNOP",
    "-----BEGIN RSA PRIVATE KEY-----",
    "-----BEGIN PRIVATE KEY-----",
    `glpat-${"x".repeat(20)}`,
  ])("hits %s", (text) => {
    expect(secretShaped(`before\n${text}\nafter`)).toBe(true);
  });

  it.each([
    "sk-short",
    "the ghp_ prefix names a GitHub token",
    "akiaabcdefghijklmnop",
    "-----BEGIN PUBLIC KEY-----",
    "xoxq-1234567890",
    "glpat-short",
  ])("near miss: %s", (text) => {
    expect(secretShaped(text)).toBe(false);
  });

  it("only scans the first 256 KB", () => {
    expect(secretShaped(`${"a ".repeat(SECRET_SCAN_BYTES / 2)}ghp_${"A".repeat(36)}`)).toBe(false);
  });
});

describe("withoutSecretLines (notes and chats, §8.2)", () => {
  it("leaves the line out and keeps the rest", () => {
    expect(withoutSecretLines(`# Engines\nuse ghp_${"A".repeat(36)} here\nbudget plan`)).toBe("# Engines\nbudget plan");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm vitest run packages/search/test/secrets.test.ts`
Expected: FAIL, `secretShaped` is not exported.

- [ ] **Step 3: Write `secrets.ts`**

```ts
// The content check (search spec §8.2). A hit is never logged, and neither is where in the file it was.

/** Only the start of a file is scanned. */
export const SECRET_SCAN_BYTES = 256 * 1024;

/** Token-shaped strings. No `g` flag: `test` keeps no state between calls. */
const PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{37,}/,
  /\b(?:ghp|gho)_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abp]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bglpat-[A-Za-z0-9_-]{20,}/,
];

const hit = (text: string) => PATTERNS.some((p) => p.test(text));

/** A file whose first 256 KB hold a token-shaped string is indexed by name only. */
export function secretShaped(text: string): boolean {
  return hit(text.length > SECRET_SCAN_BYTES ? text.slice(0, SECRET_SCAN_BYTES) : text);
}

/** Notes and chats: the lines with a token-shaped string are left out, the rest is indexed. */
export function withoutSecretLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !hit(line))
    .join("\n");
}
```

- [ ] **Step 4: Export it**

`packages/search/src/index.ts`, add: `export * from "./secrets";`

- [ ] **Step 5: Run the test to see it pass**

Run: `corepack pnpm vitest run packages/search/test/secrets.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/search
git commit -m "feat(search): the content check for token-shaped strings

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 5: Document builders and heading anchors

**Files:**
- Create: `packages/search/src/docs.ts`, `packages/search/src/anchor.ts`
- Modify: `packages/search/src/index.ts`
- Test: `packages/search/test/docs.test.ts`, `packages/search/test/anchor.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/search/test/docs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { actionDocs, chatDocs, chatScope, docIdFor, fileDoc, fileKey, noteScope, openTaskDoc, pastTaskDocs, splitKey } from "../src";

const line = (o: unknown, offset = 0) => {
  const text = JSON.stringify(o);
  return { offset, length: Buffer.byteLength(text), line: text };
};

describe("file and note documents", () => {
  it("a folder file: its name as title, path, text, app-wide with scopes", () => {
    const d = fileDoc({ root: "folder", rel: "docs/guide.md", mtimeMs: 5.4, text: "# Guide", scoped: true });
    expect(d).toEqual({ id: "file:folder/docs/guide.md", kind: "file", scope: "_app", title: "guide.md", path: "docs/guide.md", text: "# Guide", at: 5, root: "folder" });
    expect(fileDoc({ root: "folder", rel: "a.txt", mtimeMs: 1, text: null, scoped: false }).scope).toBe("main");
  });

  it("a note: its front-matter title, its scope from the folder, secret lines left out", () => {
    const text = `---\ntitle: Engines\n---\n## Summary\n- ghp_${"A".repeat(36)}\n- budget`;
    const d = fileDoc({ root: "folder", rel: ".harness/notes/physics/engines.md", mtimeMs: 1, text, scoped: true });
    expect(d.kind).toBe("note");
    expect(d.id).toBe("note:.harness/notes/physics/engines.md");
    expect(d.title).toBe("Engines");
    expect(d.scope).toBe("physics");
    expect(d.text).not.toContain("ghp_");
    expect(d.text).toContain("budget");
  });

  it("a note's title falls back to its first # heading, then its name", () => {
    expect(fileDoc({ root: "folder", rel: ".harness/notes/a.md", mtimeMs: 1, text: "# The turn\nx", scoped: false }).title).toBe("The turn");
    expect(fileDoc({ root: "folder", rel: ".harness/notes/a.md", mtimeMs: 1, text: null, scoped: false }).title).toBe("a");
  });

  it("note scopes", () => {
    expect(noteScope(".harness/notes/a.md", false)).toBe("main");
    expect(noteScope(".harness/notes/a.md", true)).toBe("_app");
    expect(noteScope(".harness/notes/_app/a.md", true)).toBe("_app");
  });

  it("a reference folder's markdown is a file, not a note", () => {
    expect(fileDoc({ root: "ref:docs", rel: ".harness/notes/a.md", mtimeMs: 1, text: "", scoped: false }).kind).toBe("file");
    expect(docIdFor("ref:docs", "a.md")).toBe("file:ref:docs/a.md");
  });

  it("keys split back into root and path", () => {
    expect(splitKey(fileKey("ref:docs", "a/b.md"))).toEqual({ root: "ref:docs", rel: "a/b.md" });
  });
});

describe("chat documents (§3 Tasks)", () => {
  it("one per entry with text; notices, mode and phase lines and empty entries are left out", () => {
    const docs = chatDocs(".harness/chats/main.jsonl", [
      line({ id: "u1", role: "user", text: "How does the context window work?", at: "2026-10-30T10:00:00.000Z", task: "t1" }, 0),
      line({ id: "a1", role: "assistant", text: "It holds the turn.", at: "2026-10-30T10:00:01.000Z", task: "t1" }, 100),
      line({ id: "n1", role: "user", text: "", notice: { kind: "x" } }, 200),
      line({ id: "m1", role: "user", text: "Switched", mode: "deep" }, 300),
      line({ id: "e1", role: "assistant", text: "" }, 400),
    ]);
    expect(docs.map((d) => d.id)).toEqual(["chat:.harness/chats/main.jsonl#u1", "chat:.harness/chats/main.jsonl#a1"]);
    expect(docs[0]).toMatchObject({ kind: "task", scope: "main", title: "How does the context window work?", chat: { file: ".harness/chats/main.jsonl", offset: 0, entry: "u1", task: "t1" }, meta: { role: "user" } });
    expect(docs[1].chat?.offset).toBe(100);
  });

  it("cuts a long first line, leaves out secret lines and skips a broken line", () => {
    const long = "x".repeat(200);
    const docs = chatDocs(".harness/chats/physics/t1.jsonl", [
      { offset: 0, length: 3, line: "{no" },
      line({ id: "u1", role: "user", text: `${long}\nghp_${"A".repeat(36)}`, at: "x" }),
    ]);
    expect(docs).toHaveLength(1);
    expect(docs[0].title.length).toBe(80);
    expect(docs[0].text).not.toContain("ghp_");
    expect(docs[0].scope).toBe("physics");
    expect(docs[0].at).toBe(0);
  });

  it("chat scopes", () => {
    expect(chatScope(".harness/chats/_app.jsonl")).toBe("_app");
    expect(chatScope(".harness/chats/physics/t9.jsonl")).toBe("physics");
  });
});

describe("tasks built in memory (§4.2)", () => {
  it("actions with their status and tier", () => {
    expect(actionDocs([{ id: "topic5", label: "Topic 5", description: "Blocks", tier: "deep", scope: "_app" }])[0]).toEqual({
      id: "action:topic5",
      kind: "task",
      scope: "_app",
      title: "Topic 5",
      path: "",
      text: "Blocks",
      at: 0,
      action: "topic5",
      meta: { status: "not-started", tier: "deep" },
    });
    expect(actionDocs([{ id: "a", label: "A", status: "done", scope: "main" }])[0].meta).toEqual({ status: "done" });
  });

  it("the open task and past tasks", () => {
    expect(openTaskDoc({ id: "t1", title: "Topic 5", scope: "main", at: 0 })).toMatchObject({ id: "open:t1", task: "t1", meta: { status: "open" } });
    expect(pastTaskDocs([{ id: "t0", title: "The turn", scope: "main", at: 9 }])[0]).toMatchObject({ id: "past:t0", task: "t0", at: 9, meta: { status: "past" } });
  });
});
```

`packages/search/test/anchor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { headingAnchorAt } from "../src";

const DOC = ["---", "title: Guide", "---", "# Guide", "intro", "## Setup", "```", "# not a heading", "```", "setup text", "## Setup", "the context window", "### `Code` and *more*"].join("\n");

describe("headingAnchorAt (§10 reader anchor)", () => {
  it("is the slug of the heading above the offset, deduplicated like the reader", () => {
    expect(headingAnchorAt(DOC, DOC.indexOf("intro"))).toBe("guide");
    expect(headingAnchorAt(DOC, DOC.indexOf("setup text"))).toBe("setup");
    expect(headingAnchorAt(DOC, DOC.indexOf("context window"))).toBe("setup-1");
  });

  it("skips fenced code, and drops inline marks from the heading's text", () => {
    expect(headingAnchorAt(DOC, DOC.indexOf("not a heading"))).toBe("setup");
    expect(headingAnchorAt(DOC, DOC.length - 1)).toBe("code-and-more");
  });

  it("has none before the first heading", () => {
    expect(headingAnchorAt("plain\ntext", 3)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/search/test/docs.test.ts packages/search/test/anchor.test.ts`
Expected: FAIL, the builders are not exported.

- [ ] **Step 3: Write `docs.ts`**

```ts
// The documents per kind (search spec §3, §9).
import { splitFrontMatter } from "@humanharness/harness-sdk/documents";
import { withoutSecretLines } from "./secrets";
import type { SearchDoc } from "./types";

export const APP_SCOPE = "_app";
export const MAIN_SCOPE = "main";
export const NOTES_DIR = ".harness/notes/";
export const CHATS_DIR = ".harness/chats/";
export const FOLDER_ROOT = "folder";
export const refRoot = (id: string): string => `ref:${id}`;
export const isRefRoot = (root: string | undefined): boolean => typeof root === "string" && root.startsWith("ref:");

/** A file's key in `files.json`: its root, a slash, its path (a root key never holds a slash). */
export const fileKey = (root: string, rel: string): string => `${root}/${rel}`;
export function splitKey(key: string): { root: string; rel: string } {
  const i = key.indexOf("/");
  return { root: key.slice(0, i), rel: key.slice(i + 1) };
}

export const isNotePath = (root: string, rel: string): boolean => root === FOLDER_ROOT && rel.startsWith(NOTES_DIR) && rel.endsWith(".md");
export const docIdFor = (root: string, rel: string): string => (isNotePath(root, rel) ? `note:${rel}` : `file:${fileKey(root, rel)}`);
export const baseName = (rel: string): string => rel.slice(rel.lastIndexOf("/") + 1);
export const isMarkdown = (rel: string): boolean => /\.(md|markdown)$/i.test(rel);

const TITLE_CHARS = 80;
const cut = (s: string) => (s.length > TITLE_CHARS ? `${s.slice(0, TITLE_CHARS - 1)}…` : s);

/** `notes/<scope>/x.md` is that scope's; a note directly in `notes/` is `main` without scopes, `_app` with them. */
export function noteScope(rel: string, scoped: boolean): string {
  if (!scoped) return MAIN_SCOPE;
  const rest = rel.slice(NOTES_DIR.length);
  const slash = rest.indexOf("/");
  return slash < 0 ? APP_SCOPE : rest.slice(0, slash);
}

/** The front matter's `title`, else the first `# ` heading, else the file's name. */
export function noteTitle(text: string | null, rel: string): string {
  if (text) {
    const { data, body } = splitFrontMatter(text);
    if (typeof data.title === "string" && data.title.trim()) return data.title.trim();
    const h = /^#\s+(.+?)\s*$/m.exec(body);
    if (h) return h[1];
  }
  return baseName(rel).replace(/\.md$/i, "");
}

export interface FileInput {
  root: string;
  rel: string;
  mtimeMs: number;
  /** Null: indexed by name and path only. */
  text: string | null;
  scoped: boolean;
}

/** A file of the folder or a reference folder; a `.md` under `.harness/notes/` of the folder is a note. */
export function fileDoc(f: FileInput): SearchDoc {
  const note = isNotePath(f.root, f.rel);
  const text = f.text === null ? "" : note ? withoutSecretLines(f.text) : f.text;
  return {
    id: docIdFor(f.root, f.rel),
    kind: note ? "note" : "file",
    scope: note ? noteScope(f.rel, f.scoped) : f.scoped ? APP_SCOPE : MAIN_SCOPE,
    title: note ? noteTitle(text, f.rel) : baseName(f.rel),
    path: f.rel,
    text,
    at: Math.round(f.mtimeMs),
    root: f.root,
  };
}

/** A line of a chat file: its byte offset and length (without the newline) and its text. */
export interface ChatLine {
  offset: number;
  length: number;
  line: string;
}

/** `chats/<scope>.jsonl` or, in board mode, `chats/<scope>/<task>.jsonl`. */
export function chatScope(rel: string): string {
  const rest = rel.slice(CHATS_DIR.length);
  const slash = rest.indexOf("/");
  return slash >= 0 ? rest.slice(0, slash) : rest.replace(/\.jsonl$/, "");
}

export const chatDocId = (rel: string, entry: string): string => `chat:${rel}#${entry}`;

/** One document per chat entry with text (the person's messages and the agent's answers); app lines are left out. */
export function chatDocs(rel: string, lines: readonly ChatLine[]): SearchDoc[] {
  const scope = chatScope(rel);
  const out: SearchDoc[] = [];
  for (const l of lines) {
    let e: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(l.line);
      if (!parsed || typeof parsed !== "object") continue;
      e = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof e.id !== "string" || !e.id || typeof e.text !== "string") continue;
    if (e.notice !== undefined || e.mode !== undefined || e.phase !== undefined || e.timeUp !== undefined) continue;
    const text = withoutSecretLines(e.text).trim();
    if (!text) continue;
    const first = text.split("\n").find((s) => s.trim())?.trim() ?? "";
    const task = typeof e.task === "string" ? e.task : undefined;
    out.push({
      id: chatDocId(rel, e.id),
      kind: "task",
      scope,
      title: cut(first),
      path: "",
      text,
      at: Date.parse(String(e.at)) || 0,
      chat: { file: rel, offset: l.offset, length: l.length, entry: e.id, ...(task ? { task } : {}) },
      meta: { role: e.role === "assistant" ? "assistant" : "user" },
    });
  }
  return out;
}

/** The ids of what is rebuilt in memory on each open (§4.2): actions, the open task, past tasks. */
export const MEMORY_PREFIXES = ["action:", "open:", "past:"] as const;

export interface ActionInput {
  id: string;
  label: string;
  description?: string;
  tier?: string;
  status?: "done" | "unsaved" | "unfinished";
  scope: string;
}

export function actionDocs(list: readonly ActionInput[]): SearchDoc[] {
  return list.map((a) => ({
    id: `action:${a.id}`,
    kind: "task",
    scope: a.scope,
    title: a.label,
    path: "",
    text: a.description ?? "",
    at: 0,
    action: a.id,
    meta: { status: a.status ?? "not-started", ...(a.tier ? { tier: a.tier } : {}) },
  }));
}

export interface TaskInput {
  id: string;
  title: string;
  scope: string;
  at: number;
}

export const openTaskDoc = (t: TaskInput): SearchDoc => ({ id: `open:${t.id}`, kind: "task", scope: t.scope, title: t.title, path: "", text: "", at: t.at, task: t.id, meta: { status: "open" } });

export const pastTaskDocs = (list: readonly TaskInput[]): SearchDoc[] =>
  list.map((t) => ({ id: `past:${t.id}`, kind: "task", scope: t.scope, title: t.title, path: "", text: "", at: t.at, task: t.id, meta: { status: "past" } }));
```

- [ ] **Step 4: Write `anchor.ts`**

```ts
import { createSlugger, splitFrontMatter } from "@humanharness/harness-sdk/documents";

const ATX = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** What the reader's heading text loses: link and image syntax, code ticks, emphasis stars and strikes. */
const plain = (text: string) =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*~]/g, "")
    .trim();

/**
 * The id the reader gives the heading above `offset` (an index into `markdown`), so a result opens there (§3, §10).
 * ATX headings only, with the reader's own slugger in document order; none before the first heading.
 */
export function headingAnchorAt(markdown: string, offset: number): string | undefined {
  const { body } = splitFrontMatter(markdown);
  const slug = createSlugger();
  let pos = markdown.length - body.length;
  let fence: string | null = null;
  let found: string | undefined;
  for (const line of body.split("\n")) {
    if (pos > offset) break;
    const f = FENCE.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
    } else if (fence === null) {
      const h = ATX.exec(line);
      if (h) found = slug(plain(h[2]));
    }
    pos += line.length + 1;
  }
  return found;
}
```

- [ ] **Step 5: Export them**

`packages/search/src/index.ts`, add:

```ts
export * from "./docs";
export * from "./anchor";
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `corepack pnpm vitest run packages/search/test/docs.test.ts packages/search/test/anchor.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/search
git commit -m "feat(search): documents for files, notes, chats and tasks; heading anchors

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 6: Snippets and marks (§5.3)

**Files:**
- Create: `packages/search/src/snippet.ts`
- Modify: `packages/search/src/index.ts`
- Test: `packages/search/test/snippet.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/search/test/snippet.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { firstMatch, markFirst, snippetAround } from "../src";

const joined = (parts: { text: string; mark?: true }[]) => parts.map((p) => (p.mark ? `[${p.text}]` : p.text)).join("");

describe("marks and snippets (§5.3)", () => {
  it("marks the first match in the original text, accents kept", () => {
    expect(joined(markFirst("La Fracción y la fracción", ["fraccion"]))).toBe("La [Fracción] y la fracción");
    expect(markFirst("nothing here", ["context"])).toEqual([{ text: "nothing here" }]);
  });

  it("takes the earliest of several terms", () => {
    expect(firstMatch("beta alpha", ["alpha", "beta"])).toEqual({ start: 0, end: 4 });
  });

  it("windows about 120 characters around the match, with ellipses where it cuts", () => {
    const text = `${"a ".repeat(200)}the context window${" b".repeat(200)}`;
    const s = snippetAround(text, ["context"]);
    const out = joined(s!.marked);
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
    expect(out).toContain("[context]");
    expect(out.length).toBeLessThanOrEqual(124);
    expect(s!.at).toBe(text.indexOf("context"));
  });

  it("at the start and the end of a file there is no ellipsis on that side", () => {
    expect(joined(snippetAround("context first", ["context"])!.marked)).toBe("[context] first");
    expect(joined(snippetAround("ends with context", ["context"])!.marked)).toBe("ends with [context]");
  });

  it("never cuts a surrogate pair, and squashes line breaks", () => {
    const text = `${"😀".repeat(100)}\n\nthe context`;
    const out = joined(snippetAround(text, ["context"])!.marked);
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(out).toContain(" the [context]");
  });

  it("is null without a match", () => {
    expect(snippetAround("abc", ["zzz"])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm vitest run packages/search/test/snippet.test.ts`
Expected: FAIL, `markFirst` is not exported.

- [ ] **Step 3: Write `snippet.ts`**

```ts
import { fold } from "./options";

/** A title or a line of context: plain runs, the first match `mark`ed. Never HTML. */
export type Marked = { text: string; mark?: true }[];

export const SNIPPET_CHARS = 120;

/** The folded text, and for each of its characters the index in the original where it came from (plus the end). */
function foldMap(text: string): { folded: string; at: number[] } {
  let folded = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; ) {
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) at.push(i);
    folded += f;
    i += ch.length;
  }
  at.push(text.length);
  return { folded, at };
}

/** Where the earliest of `terms` (folded, as the index matched them) is in `text`, in original indices. */
export function firstMatch(text: string, terms: readonly string[]): { start: number; end: number } | null {
  const { folded, at } = foldMap(text);
  let best: { i: number; len: number } | null = null;
  for (const term of terms) {
    if (!term) continue;
    const i = folded.indexOf(term);
    if (i >= 0 && (best === null || i < best.i)) best = { i, len: term.length };
  }
  return best ? { start: at[best.i], end: at[best.i + best.len] } : null;
}

const parts = (before: string, match: string, after: string): Marked =>
  [{ text: before }, { text: match, mark: true as const }, { text: after }].filter((p) => p.text !== "");

export function markFirst(text: string, terms: readonly string[]): Marked {
  const m = firstMatch(text, terms);
  return m ? parts(text.slice(0, m.start), text.slice(m.start, m.end), text.slice(m.end)) : [{ text }];
}

/** Moves `i` off the low half of a surrogate pair. */
const safe = (s: string, i: number) => (i > 0 && i < s.length && /[\uDC00-\uDFFF]/.test(s[i]) ? i - 1 : i);
const squash = (s: string) => s.replace(/\s+/g, " ");

/** About `width` characters around the first match, its line breaks squashed; `at`: the match's index in `text`. */
export function snippetAround(text: string, terms: readonly string[], width = SNIPPET_CHARS): { marked: Marked; at: number } | null {
  const m = firstMatch(text, terms);
  if (!m) return null;
  const room = Math.max(0, width - (m.end - m.start));
  const from = safe(text, Math.max(0, m.start - Math.floor(room / 3)));
  const to = safe(text, Math.min(text.length, m.end + room - (m.start - from)));
  const before = `${from > 0 ? "…" : ""}${squash(text.slice(from, m.start)).trimStart()}`;
  const after = `${squash(text.slice(m.end, to)).trimEnd()}${to < text.length ? "…" : ""}`;
  return { marked: parts(before, text.slice(m.start, m.end), after), at: m.start };
}
```

- [ ] **Step 4: Export it**

`packages/search/src/index.ts`, add: `export * from "./snippet";`

- [ ] **Step 5: Run the test to see it pass**

Run: `corepack pnpm vitest run packages/search/test/snippet.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/search
git commit -m "feat(search): snippet windows and first-match marks

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 7: The live index and the query (§5.3, §9 `SearchIndex`)

**Files:**
- Create: `packages/search/src/query.ts`, `packages/search/src/live-index.ts`
- Modify: `packages/search/src/index.ts`
- Test: `packages/search/test/query.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/search/test/query.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LiveIndex, type SearchDoc } from "../src";

const NOW = Date.parse("2026-10-30T12:00:00.000Z");
const DAY = 24 * 3600 * 1000;
const doc = (id: string, o: Partial<SearchDoc> = {}): SearchDoc => ({ id, kind: "file", scope: "main", title: id, path: "", text: "", at: 0, root: "folder", ...o });

function indexOf(docs: SearchDoc[]): LiveIndex {
  const ix = LiveIndex.empty();
  ix.upsert(docs);
  return ix;
}
const ids = (ix: LiveIndex, q: string, o = {}) => ix.search(q, { now: NOW, ...o }).hits.map((h) => h.id);

describe("LiveIndex.search (§5.3)", () => {
  it("folds accents and matches prefixes and fuzzy terms of 4+ characters", () => {
    const ix = indexOf([doc("a", { text: "La Fracción decimal" }), doc("b", { text: "configuration" })]);
    expect(ids(ix, "fraccion")).toEqual(["a"]);
    expect(ids(ix, "conf")).toEqual(["b"]);
    expect(ids(ix, "configuratoin")).toEqual(["b"]);
    expect(ids(ix, "cnf")).toEqual([]);
  });

  it("needs every word, then falls back to any word and says so", () => {
    const ix = indexOf([doc("a", { text: "context window" }), doc("b", { text: "context only" })]);
    expect(ix.search("context window", { now: NOW })).toMatchObject({ partial: false });
    expect(ids(ix, "context window")).toEqual(["a"]);
    const r = ix.search("context zebra", { now: NOW });
    expect(r.partial).toBe(true);
    expect(r.hits.map((h) => h.id).sort()).toEqual(["a", "b"]);
  });

  it("boosts a title match over a text match, and a recent one over an old one", () => {
    const ix = indexOf([doc("intext", { title: "x", text: "engines" }), doc("intitle", { title: "engines" }), doc("old", { title: "engines", at: NOW - 30 * DAY }), doc("new", { title: "engines", at: NOW - DAY })]);
    const order = ids(ix, "engines");
    expect(order.indexOf("intitle")).toBeLessThan(order.indexOf("intext"));
    expect(order.indexOf("new")).toBeLessThan(order.indexOf("old"));
  });

  it("filters by scope, kind and reference folders", () => {
    const ix = indexOf([doc("p", { scope: "physics", title: "plan" }), doc("c", { scope: "chem", title: "plan" }), doc("a", { scope: "_app", title: "plan" }), doc("r", { scope: "_app", title: "plan", root: "ref:docs" }), doc("n", { scope: "_app", title: "plan", kind: "note" })]);
    expect(ids(ix, "plan", { scopes: ["physics", "_app"] }).sort()).toEqual(["a", "n", "p", "r"]);
    expect(ids(ix, "plan", { kinds: ["note"] })).toEqual(["n"]);
    expect(ids(ix, "plan", { references: false })).not.toContain("r");
  });

  it("gives the stored fields and the matched terms, never the text", () => {
    const ix = indexOf([doc("a", { title: "Guide", path: "docs/guide.md", text: "secret-free body" })]);
    const [hit] = ix.search("guide", { now: NOW }).hits;
    expect(hit).toMatchObject({ id: "a", title: "Guide", path: "docs/guide.md", kind: "file" });
    expect(hit.terms).toContain("guide");
    expect("text" in hit).toBe(false);
  });

  it("replaces and removes documents", () => {
    const ix = indexOf([doc("a", { title: "old" })]);
    ix.upsert([doc("a", { title: "new" })]);
    expect(ids(ix, "old")).toEqual([]);
    expect(ids(ix, "new")).toEqual(["a"]);
    ix.remove(["a", "missing"]);
    expect(ix.size).toBe(0);
  });

  it("round-trips through JSON; a bad snapshot is null", () => {
    const ix = indexOf([doc("a", { title: "guide" })]);
    const back = LiveIndex.fromJSON(ix.toJSON());
    expect(back && ids(back, "guide")).toEqual(["a"]);
    expect(back?.stored("a")).toMatchObject({ title: "guide" });
    expect(LiveIndex.fromJSON("{bad")).toBeNull();
  });

  it("an empty query finds nothing; status is kept as set", () => {
    const ix = indexOf([doc("a")]);
    expect(ix.search("   ", { now: NOW }).hits).toEqual([]);
    expect(ix.status()).toEqual({ state: "empty", done: 0, total: 0 });
    ix.setStatus({ state: "ready", done: 1, total: 1 });
    expect(ix.status().state).toBe("ready");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm vitest run packages/search/test/query.test.ts`
Expected: FAIL, `LiveIndex` is not exported.

- [ ] **Step 3: Write `query.ts`**

```ts
import type MiniSearch from "minisearch";
import type { SearchResult } from "minisearch";
import { FIELD_BOOST } from "./options";
import type { Kind, SearchDoc, SearchHit } from "./types";

export interface QueryOptions {
  /** Absent: every scope ("All scopes", or a harness without scopes). */
  scopes?: readonly string[];
  kinds?: readonly Kind[];
  /** False: leave the reference folders out (the palette's toggle). */
  references?: boolean;
  /** A small boost for the open scope. */
  openScope?: string | null;
  now?: number;
}

export interface QueryResult {
  hits: SearchHit[];
  /** Nothing matched every word: these match some (§5.3 "Showing partial matches"). */
  partial: boolean;
}

export const MAX_QUERY_CHARS = 200;
const WEEK_MS = 7 * 24 * 3600 * 1000;
const RECENT_BOOST = 1.2;
const OPEN_SCOPE_BOOST = 1.1;

function toHit(r: SearchResult): SearchHit {
  return {
    id: String(r.id),
    kind: r.kind as Kind,
    scope: String(r.scope),
    title: String(r.title),
    path: typeof r.path === "string" ? r.path : "",
    at: typeof r.at === "number" ? r.at : 0,
    ...(typeof r.root === "string" ? { root: r.root } : {}),
    ...(r.chat ? { chat: r.chat } : {}),
    ...(typeof r.action === "string" ? { action: r.action } : {}),
    ...(typeof r.task === "string" ? { task: r.task } : {}),
    ...(r.meta ? { meta: r.meta } : {}),
    score: r.score,
    terms: r.terms,
  };
}

/** AND first; with no hit and more than one word, OR (partial). Prefix, fuzzy 0.2 from 4 characters, the boosts. */
export function runQuery(ms: MiniSearch<SearchDoc>, query: string, o: QueryOptions = {}): QueryResult {
  const text = query.trim().slice(0, MAX_QUERY_CHARS);
  if (!text) return { hits: [], partial: false };
  const now = o.now ?? Date.now();
  const options = {
    prefix: true,
    fuzzy: (term: string) => (term.length >= 4 ? 0.2 : false),
    boost: FIELD_BOOST,
    filter: (r: SearchResult) =>
      (!o.kinds || o.kinds.includes(r.kind as Kind)) && (!o.scopes || o.scopes.includes(String(r.scope))) && (o.references !== false || !String(r.root ?? "").startsWith("ref:")),
    boostDocument: (_id: unknown, _term: string, stored?: Record<string, unknown>) => {
      let b = 1;
      const at = typeof stored?.at === "number" ? stored.at : 0;
      if (at > 0 && now - at < WEEK_MS) b *= RECENT_BOOST;
      if (o.openScope && stored?.scope === o.openScope) b *= OPEN_SCOPE_BOOST;
      return b;
    },
  };
  let results = ms.search(text, { ...options, combineWith: "AND" });
  let partial = false;
  if (results.length === 0 && /\s/.test(text)) {
    results = ms.search(text, { ...options, combineWith: "OR" });
    partial = results.length > 0;
  }
  return { hits: results.map(toHit), partial };
}
```

- [ ] **Step 4: Write `live-index.ts`**

```ts
import MiniSearch from "minisearch";
import { indexOptions } from "./options";
import { type QueryOptions, type QueryResult, runQuery } from "./query";
import type { IndexState, Kind, SearchDoc, SearchHit, StoredDoc } from "./types";

/**
 * The seam D6 leaves for later: a retrieval context policy or a tool asks this, and the task manager runs it
 * (policies decide, never execute). Plan 1's only caller is the palette.
 */
export interface SearchIndex {
  query(q: string, opts: { scopes?: string[]; kinds?: Kind[]; limit: number }): SearchHit[];
  status(): IndexState;
}

/** The one `MiniSearch` instance main holds (§4.3): the worker's batches go in, queries come out. */
export class LiveIndex implements SearchIndex {
  private state: IndexState = { state: "empty", done: 0, total: 0 };

  private constructor(private readonly ms: MiniSearch<SearchDoc>) {}

  static empty(): LiveIndex {
    return new LiveIndex(new MiniSearch<SearchDoc>(indexOptions()));
  }

  /** A snapshot from `toJSON`; null when it can't be read (the index is rebuilt, §4.1). */
  static fromJSON(json: string): LiveIndex | null {
    try {
      return new LiveIndex(MiniSearch.loadJSON<SearchDoc>(json, indexOptions()));
    } catch {
      return null;
    }
  }

  toJSON(): string {
    return JSON.stringify(this.ms);
  }

  get size(): number {
    return this.ms.documentCount;
  }

  has(id: string): boolean {
    return this.ms.has(id);
  }

  stored(id: string): StoredDoc | null {
    if (!this.ms.has(id)) return null;
    const f = this.ms.getStoredFields(id);
    return f ? ({ id, ...f } as StoredDoc) : null;
  }

  upsert(docs: readonly SearchDoc[]): void {
    for (const d of docs) {
      if (this.ms.has(d.id)) this.ms.replace(d);
      else this.ms.add(d);
    }
  }

  remove(ids: Iterable<string>): void {
    for (const id of ids) if (this.ms.has(id)) this.ms.discard(id);
  }

  setStatus(s: IndexState): void {
    this.state = s;
  }

  status(): IndexState {
    return this.state;
  }

  search(q: string, opts: QueryOptions = {}): QueryResult {
    return runQuery(this.ms, q, opts);
  }

  query(q: string, opts: { scopes?: string[]; kinds?: Kind[]; limit: number }): SearchHit[] {
    return runQuery(this.ms, q, opts).hits.slice(0, opts.limit);
  }
}
```

- [ ] **Step 5: Export them**

`packages/search/src/index.ts`, add:

```ts
export * from "./query";
export * from "./live-index";
```

- [ ] **Step 6: Run the package's tests and typecheck**

Run: `corepack pnpm vitest run packages/search && corepack pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/search
git commit -m "feat(search): the live index and its query: AND then OR, boosts, filters

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---
### Task 8: The protocol's search types and `SearchClient` (no channels yet)

The channels go into the table in Task 13, together with main's handlers and the preload, because `channels.test.ts` fails on a table channel nobody handles.

**Files:**
- Modify: `packages/protocol/src/views.ts` (append), `packages/protocol/src/shared.ts`, `packages/protocol/src/client.ts`

- [ ] **Step 1: Append the view types to `views.ts`**

```ts
/** Global search (search spec §3). Plan 1: tasks, notes and files; plan 2 adds settings, commands and data. */
export type SearchKind = "task" | "note" | "file";

/** A title or a line of context: plain runs, the first match `mark`ed (§5.3). Never HTML. */
export type SearchMarked = { text: string; mark?: true }[];

/**
 * What Enter does with a result (§3). The window routes every kind itself, except `reveal`: main shows a reference
 * folder's file in Finder when `hh:searchOpen` is told of it (the window never gets that file's absolute path).
 */
export type SearchTarget =
  | { kind: "action"; action: string }
  | { kind: "open-task"; task: string }
  | { kind: "history"; task: string }
  | { kind: "chat"; entry: string; scope: string; task?: string }
  | { kind: "document"; path: string; anchor?: string }
  | { kind: "timeline"; path: string }
  | { kind: "reveal" };

/** What a task row says besides its title (the window words it in the person's language). */
export interface SearchMeta {
  status?: "not-started" | "done" | "unsaved" | "unfinished" | "open" | "past";
  tier?: string;
  role?: "user" | "assistant";
}

export interface SearchHitView {
  id: string;
  kind: SearchKind;
  title: SearchMarked;
  /** The snippet around the match, else the path; empty for a task row (the window draws `meta`). */
  context: SearchMarked;
  meta?: SearchMeta;
  /** A reference folder's label: the row says "<label> · read only". */
  folder?: string;
  /** Another scope's title (with "All scopes" on). */
  scope?: string;
  /** What ⌘Enter may name (§5.4): a path, a reference file's name, a note's or a task's title. Null: never named. */
  hint: { kind: "path" | "name" | "note" | "task"; text: string } | null;
  target: SearchTarget;
}

/** Staged readiness (D8): `names` while file names come in, `building` with "N of M" while texts do. */
export interface SearchStatus {
  state: "empty" | "names" | "building" | "ready";
  done: number;
  total: number;
  /** The 50,000-file cap left some files out (§4.5). */
  truncated?: true;
}

export interface SearchFilters {
  /** One kind (a filter chip); absent: "All". */
  kind?: SearchKind;
  /** The "All scopes" toggle (D2); remembered by main. Absent: what main remembers. */
  allScopes?: boolean;
  /** The "Reference folders" toggle; absent: on. */
  references?: boolean;
}

export interface SearchGroup {
  kind: SearchKind;
  /** Every match of this kind, beyond the rows shown. */
  total: number;
  hits: SearchHitView[];
}

/** `hh:search`'s answer (§9). An empty query answers the recents (§5.2) and no groups. */
export type SearchAnswer =
  | {
      ok: true;
      query: string;
      groups: SearchGroup[];
      counts: Record<SearchKind, number>;
      recent: SearchHitView[];
      partial: boolean;
      status: SearchStatus;
      allScopes: boolean;
    }
  | { ok: false; reason: "not-ready" | "failed" };
```

- [ ] **Step 2: Add the kinds to `shared.ts`**

At the end of `packages/protocol/src/shared.ts` (add `SearchKind` to its `import type { … } from "./views"` line, or add that line if the file has none):

```ts
/** Search's kinds in the order the palette groups them (search spec §3). */
export const SEARCH_KINDS: readonly SearchKind[] = ["task", "note", "file"];
```

- [ ] **Step 3: Add `SearchClient` to `client.ts`**

Add `SearchAnswer, SearchFilters, SearchHitView, SearchStatus` to the long `import type { … } from "./views"` line, then add after `ContextClient`:

```ts
/** `client.search` (search spec §9). Every answer is data; nothing here ever reaches the engine (§8.3). */
export interface SearchClient {
  /** The results for `query`; an empty query answers the recents. The first call builds the index (D8). */
  query(query: string, filters?: SearchFilters): Promise<SearchAnswer>;
  /** The person opened `hit`: main remembers it among the recents, and shows a reference folder's file in Finder. */
  opened(hit: SearchHitView): Promise<{ ok: boolean }>;
  /** The index's progress while it builds ("Indexing… N of M"). */
  onStatus(listener: (status: SearchStatus) => void): () => void;
  /** Opens the palette, with `query` typed in (the top bar's button, a harness view). */
  open(query?: string): void;
  /** Every `open`, whoever called it: the window's palette listens. */
  onOpen(listener: (query?: string) => void): () => void;
}
```

`HarnessClient` does not get `search` yet (Task 13 adds it with the preload).

- [ ] **Step 4: Typecheck and run the protocol tests**

Run: `corepack pnpm typecheck && corepack pnpm vitest run packages/protocol`
Expected: clean; PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): search view types and the search client interface

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 9: The folder walk (§8.1: deny rules, `.gitignore`, links)

**Files:**
- Create: `packages/shell/src/main/search/read.ts`, `packages/shell/src/main/search/walk.ts`
- Modify: `packages/shell/package.json` (`"@humanharness/search": "workspace:*"` in `dependencies`), `pnpm-lock.yaml`
- Test: `packages/shell/test/search-walk.test.ts`

- [ ] **Step 1: Add the dependency and link it**

In `packages/shell/package.json` `dependencies`, add `"@humanharness/search": "workspace:*"` (alphabetical, after `@humanharness/runtime`). Run: `corepack pnpm install --offline`. Expected: done, nothing downloaded.

- [ ] **Step 2: Write the failing test**

`packages/shell/test/search-walk.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { statPaths, walkRoot } from "../src/main/search/walk";

let root: string;
let outside: string;
const put = (rel: string, text = "x") => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-walk-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-out-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

const rels = async (o = {}) => (await walkRoot(root, { max: 1000, ...o })).entries.map((e) => e.rel).sort();

describe("walkRoot (§8.1)", () => {
  it("leaves out denied paths and keeps notes, reviews and the person's files", async () => {
    for (const p of ["docs/a.md", ".env", "id_rsa", ".git/config", ".claude/x.md", ".harness/tasks.json", ".harness/notes/n.md", ".harness/reviews/docs/a.md.json", ".harness/data/main/t.json", "AGENTS.md", "CLAUDE.md"]) put(p);
    expect(await rels({ extraDenied: ["CLAUDE.md"] })).toEqual([".harness/notes/n.md", ".harness/reviews/docs/a.md.json", "docs/a.md"]);
  });

  it("skips the folders it is told to (the chats, indexed on their own)", async () => {
    put(".harness/chats/main.jsonl");
    put(".harness/notes/n.md");
    expect(await rels({ skipDirs: [".harness/chats"] })).toEqual([".harness/notes/n.md"]);
  });

  it("follows the root and nested .gitignore files", async () => {
    put(".gitignore", "*.log\nout/\n");
    put("sub/.gitignore", "local.txt\n");
    for (const p of ["a.log", "out/b.md", "keep.md", "sub/local.txt", "sub/other.txt", "node_modules/x/index.js"]) put(p);
    expect(await rels()).toEqual([".gitignore", "keep.md", "node_modules/x/index.js", "sub/.gitignore", "sub/other.txt"]);
  });

  it("uses the default list only when the root has no .gitignore", async () => {
    for (const p of ["node_modules/x/index.js", "dist/a.js", "src/a.ts"]) put(p);
    expect(await rels()).toEqual(["src/a.ts"]);
  });

  it("never follows a link: a link to a file is a name only, a link to a folder is not walked", async () => {
    fs.writeFileSync(path.join(outside, "secret.md"), "OUTSIDE");
    fs.mkdirSync(path.join(outside, "dir"));
    fs.writeFileSync(path.join(outside, "dir", "inner.md"), "OUTSIDE");
    fs.symlinkSync(path.join(outside, "secret.md"), path.join(root, "link.md"));
    fs.symlinkSync(path.join(outside, "dir"), path.join(root, "linkdir"));
    const { entries } = await walkRoot(root, { max: 1000 });
    expect(entries.map((e) => [e.rel, e.link])).toEqual([
      ["link.md", true],
      ["linkdir", true],
    ]);
  });

  it("stops at the cap and says so", async () => {
    for (const p of ["a", "b", "c"]) put(p);
    const r = await walkRoot(root, { max: 2 });
    expect(r.entries).toHaveLength(2);
    expect(r.truncated).toBe(true);
  });
});

describe("statPaths (a commit's paths)", () => {
  it("answers the files still there and allowed; the rest are missing", async () => {
    put(".gitignore", "*.log\n");
    put("a.md");
    put("b.log");
    put(".env");
    const { entries, missing } = await statPaths(root, ["a.md", "b.log", ".env", "gone.md", "../x"], {});
    expect(entries.map((e) => e.rel)).toEqual(["a.md"]);
    expect(missing.sort()).toEqual([".env", "b.log", "gone.md"]);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `corepack pnpm vitest run packages/shell/test/search-walk.test.ts`
Expected: FAIL, `Cannot find module '../src/main/search/walk'`.

- [ ] **Step 4: Write `read.ts` (shared by the build and the snippets)**

```ts
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { MAX_TEXT_BYTES } from "@humanharness/search";
import { isBinary, readCapped } from "@humanharness/workspace";

/** `file`'s folder still resolves inside `realRoot` (checked right before a read: a folder above may have been swapped for a link). */
export async function stillInside(file: string, realRoot: string): Promise<boolean> {
  const dir = await fs.realpath(path.dirname(file)).catch(() => null);
  return dir !== null && (dir === realRoot || dir.startsWith(realRoot + path.sep));
}

/** A text file's contents through `readCapped` (no link, no hard link, inside its root); null when binary, too big or unsafe. */
export async function readText(root: string, rel: string): Promise<string | null> {
  const realRoot = await fs.realpath(root).catch(() => null);
  if (!realRoot) return null;
  const file = path.join(root, rel);
  const got = await readCapped(file, MAX_TEXT_BYTES, () => stillInside(file, realRoot)).catch(() => null);
  if (!got || !("bytes" in got) || isBinary(rel, got.bytes)) return null;
  return got.bytes.toString("utf8");
}

/** The most bytes one read of a chat file takes; the rest waits for the next reconcile. */
export const MAX_CHAT_READ = 32 * 1024 * 1024;
/** The longest chat line a snippet reads. */
const MAX_ENTRY_BYTES = 4 * 1024 * 1024;

/** Opens a file inside `realRoot` without following a link; null unless it is a plain file with one name. */
async function openPlain(file: string, realRoot: string) {
  if (!(await stillInside(file, realRoot))) return null;
  const h = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null);
  if (!h) return null;
  const st = await h.stat().catch(() => null);
  if (!st?.isFile() || st.nlink > 1) {
    await h.close();
    return null;
  }
  return { h, size: st.size };
}

async function readAt(h: fs.FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  let got = 0;
  while (got < length) {
    const { bytesRead } = await h.read(buf, got, length - got, position + got);
    if (bytesRead === 0) break;
    got += bytesRead;
  }
  return buf.subarray(0, got);
}

/**
 * A chat file's whole lines from byte `from` on (from 0 when the file got shorter: it was replaced). `end`: the byte
 * after the last newline read, where the next read starts. Null when the file can't be read safely.
 */
export async function readChatFrom(file: string, realRoot: string, from: number): Promise<{ lines: { offset: number; length: number; line: string }[]; end: number; reset: boolean } | null> {
  const open = await openPlain(file, realRoot);
  if (!open) return null;
  try {
    const reset = open.size < from;
    const start = reset ? 0 : from;
    const buf = await readAt(open.h, start, Math.min(open.size - start, MAX_CHAT_READ));
    const lines: { offset: number; length: number; line: string }[] = [];
    let at = 0;
    for (;;) {
      const nl = buf.indexOf(10, at);
      if (nl < 0) break;
      lines.push({ offset: start + at, length: nl - at, line: buf.subarray(at, nl).toString("utf8") });
      at = nl + 1;
    }
    return { lines, end: start + at, reset };
  } finally {
    await open.h.close();
  }
}

/** One chat entry's text, read at its byte offset (§5.3); null when it can't be read or isn't an entry. */
export async function readChatEntry(base: string, rel: string, offset: number, length: number): Promise<string | null> {
  const realRoot = await fs.realpath(base).catch(() => null);
  if (!realRoot || length > MAX_ENTRY_BYTES) return null;
  const open = await openPlain(path.join(base, rel), realRoot);
  if (!open) return null;
  try {
    const parsed: unknown = JSON.parse((await readAt(open.h, offset, length)).toString("utf8"));
    return parsed && typeof parsed === "object" && typeof (parsed as { text?: unknown }).text === "string" ? (parsed as { text: string }).text : null;
  } catch {
    return null;
  } finally {
    await open.h.close();
  }
}
```

- [ ] **Step 5: Write `walk.ts`**

```ts
import { type Dirent, promises as fs } from "node:fs";
import path from "node:path";
import { CHATS_DIR, DEFAULT_IGNORED_DIRS, GitIgnore, deniedPath } from "@humanharness/search";

/** A file found by the walk. `link`: a symbolic link, indexed by its own name only and never followed (§8.1). */
export interface WalkEntry {
  rel: string;
  size: number;
  mtimeMs: number;
  link: boolean;
}

export interface WalkOptions {
  /** At most this many entries; past it, `truncated`. */
  max: number;
  /** More exact paths to leave out (the engine's instructions file). */
  extraDenied?: readonly string[];
  /** Folders not walked (relative): the chats, which the build indexes by entry. */
  skipDirs?: readonly string[];
}

const MAX_GITIGNORE_BYTES = 1024 * 1024;

/** A folder's `.gitignore` when it is a plain file of reasonable size; null otherwise. */
async function readIgnore(dir: string): Promise<string | null> {
  const file = path.join(dir, ".gitignore");
  const st = await fs.lstat(file).catch(() => null);
  if (!st?.isFile() || st.size > MAX_GITIGNORE_BYTES) return null;
  return fs.readFile(file, "utf8").catch(() => null);
}

/** Every file under `root` that may be indexed, in name order, without following any link. */
export async function walkRoot(root: string, o: WalkOptions): Promise<{ entries: WalkEntry[]; truncated: boolean }> {
  const entries: WalkEntry[] = [];
  const ig = new GitIgnore();
  const rootIgnore = await readIgnore(root);
  if (rootIgnore !== null) ig.add("", rootIgnore);
  const defaults = rootIgnore === null;
  let truncated = false;
  const walk = async (dirRel: string): Promise<void> => {
    const abs = dirRel ? path.join(root, dirRel) : root;
    if (dirRel) {
      const nested = await readIgnore(abs);
      if (nested !== null) ig.add(dirRel, nested);
    }
    let names: Dirent[];
    try {
      names = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of names) {
      if (truncated) return;
      const rel = dirRel ? `${dirRel}/${d.name}` : d.name;
      if (deniedPath(rel, o.extraDenied) || o.skipDirs?.includes(rel)) continue;
      if (defaults && DEFAULT_IGNORED_DIRS.includes(d.name)) continue;
      const isDir = d.isDirectory();
      if (ig.ignored(rel, isDir)) continue;
      if (isDir) {
        await walk(rel);
        continue;
      }
      if (!d.isFile() && !d.isSymbolicLink()) continue;
      const st = await fs.lstat(path.join(abs, d.name)).catch(() => null);
      if (!st) continue;
      if (entries.length >= o.max) {
        truncated = true;
        return;
      }
      entries.push({ rel, size: st.isFile() ? st.size : 0, mtimeMs: st.mtimeMs, link: st.isSymbolicLink() });
    }
  };
  await walk("");
  return { entries, truncated };
}

/**
 * A commit's paths (relative to `root`): those still there and allowed come back as entries, the rest as `missing`
 * (their documents leave the index). Each folder's `.gitignore` above a path is read once.
 */
export async function statPaths(root: string, rels: readonly string[], o: { extraDenied?: readonly string[] }): Promise<{ entries: WalkEntry[]; missing: string[] }> {
  const ig = new GitIgnore();
  const rootIgnore = await readIgnore(root);
  if (rootIgnore !== null) ig.add("", rootIgnore);
  const defaults = rootIgnore === null;
  const loaded = new Set<string>([""]);
  const entries: WalkEntry[] = [];
  const missing: string[] = [];
  for (const rel of rels) {
    if (!rel || rel.startsWith("/") || rel.split("/").includes("..")) continue;
    const parts = rel.split("/");
    let skip = deniedPath(rel, o.extraDenied) || rel.startsWith(CHATS_DIR);
    for (let i = 1; i < parts.length && !skip; i++) {
      const dir = parts.slice(0, i).join("/");
      if (!loaded.has(dir)) {
        loaded.add(dir);
        const text = await readIgnore(path.join(root, dir));
        if (text !== null) ig.add(dir, text);
      }
      skip = (defaults && DEFAULT_IGNORED_DIRS.includes(parts[i - 1])) || ig.ignored(dir, true);
    }
    if (!skip) skip = (defaults && DEFAULT_IGNORED_DIRS.includes(parts[parts.length - 1])) || ig.ignored(rel, false);
    const st = skip ? null : await fs.lstat(path.join(root, rel)).catch(() => null);
    if (!st || !(st.isFile() || st.isSymbolicLink())) {
      missing.push(rel);
      continue;
    }
    entries.push({ rel, size: st.isFile() ? st.size : 0, mtimeMs: st.mtimeMs, link: st.isSymbolicLink() });
  }
  return { entries, missing };
}
```

- [ ] **Step 6: Run the test to see it pass, and typecheck**

Run: `corepack pnpm vitest run packages/shell/test/search-walk.test.ts && corepack pnpm typecheck`
Expected: PASS; clean.

- [ ] **Step 7: Commit**

```bash
git add packages/shell pnpm-lock.yaml
git commit -m "feat(shell): the search walk: deny rules, .gitignore, links never followed

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 10: The build, its worker and runner (§4.3, §4.5, §8.2)

**Files:**
- Create: `packages/shell/src/main/search/build.ts`, `packages/shell/src/main/search/worker.ts`, `packages/shell/src/main/search/runner.ts`
- Modify: `packages/shell/electron.vite.config.ts`
- Test: `packages/shell/test/search-build.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/shell/test/search-build.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SearchDoc } from "@humanharness/search";
import { type BuildJob, type BuildMessage, build } from "../src/main/search/build";
import { workerBuild } from "../src/main/search/runner";

let root: string;
const put = (rel: string, text: string | Buffer = "x") => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-build-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const job = (o: Partial<BuildJob> = {}): BuildJob => ({ roots: [{ key: "folder", path: root }], scoped: false, known: {}, chats: {}, ...o });
async function run(j: BuildJob) {
  const msgs: BuildMessage[] = [];
  await build(j, (m) => msgs.push(m));
  const docs = new Map<string, SearchDoc>();
  for (const m of msgs) {
    if (m.type === "names" || m.type === "docs") for (const d of m.docs) docs.set(d.id, d);
    if (m.type === "removed") for (const id of m.ids) docs.delete(id);
  }
  const done = msgs.at(-1);
  if (done?.type !== "done") throw new Error("no done");
  return { msgs, docs, done };
}

describe("build (§4.3)", () => {
  it("first build: names first, then texts, then done with how each file went", async () => {
    put("docs/guide.md", "# Guide\nthe context window");
    put("pic.png", Buffer.from([0, 1, 2]));
    put("big.txt", "a".repeat(2 * 1024 * 1024));
    put("keys.txt", `AKIAABCDEFGHIJKLMNOP\nharmless words`);
    put(".harness/notes/n.md", `---\ntitle: Engines\n---\nbudget\nghp_${"A".repeat(36)}`);
    const { msgs, docs, done } = await run(job());
    expect(msgs[0].type).toBe("names");
    expect(docs.get("file:folder/docs/guide.md")?.text).toContain("context window");
    expect(done.files["folder/docs/guide.md"].how).toBe("text");
    expect(done.files["folder/pic.png"].how).toBe("name-only");
    expect(done.files["folder/big.txt"].how).toBe("name-only");
    expect(done.files["folder/keys.txt"].how).toBe("skipped:secret-shaped");
    expect(docs.get("file:folder/keys.txt")?.text).toBe("");
    const note = docs.get("note:.harness/notes/n.md");
    expect(note?.title).toBe("Engines");
    expect(note?.text).toContain("budget");
    expect(note?.text).not.toContain("ghp_");
  });

  it("a reconcile reads only what changed and drops what is gone", async () => {
    put("a.md", "alpha");
    put("b.md", "beta");
    const first = await run(job());
    fs.rmSync(path.join(root, "b.md"));
    put("a.md", "alpha changed text");
    fs.utimesSync(path.join(root, "a.md"), new Date(), new Date(Date.now() + 5000));
    put("c.md", "gamma");
    const { msgs, done } = await run(job({ known: first.done.files, chats: first.done.chats }));
    expect(msgs.some((m) => m.type === "names")).toBe(false);
    const changed = msgs.flatMap((m) => (m.type === "docs" ? m.docs.map((d) => d.id) : []));
    expect(changed.sort()).toEqual(["file:folder/a.md", "file:folder/c.md"]);
    expect(msgs.some((m) => m.type === "removed" && m.ids.includes("file:folder/b.md"))).toBe(true);
    expect(Object.keys(done.files).sort()).toEqual(["folder/a.md", "folder/c.md"]);
  });

  it("a commit's paths only: re-reads those, drops the missing ones", async () => {
    put("a.md", "alpha");
    const first = await run(job());
    put("new.md", "fresh");
    fs.rmSync(path.join(root, "a.md"));
    const { docs, done, msgs } = await run(job({ known: first.done.files, only: ["new.md", "a.md"] }));
    expect(docs.get("file:folder/new.md")?.text).toBe("fresh");
    expect(msgs.some((m) => m.type === "removed" && m.ids.includes("file:folder/a.md"))).toBe(true);
    expect(Object.keys(done.files)).toEqual(["folder/new.md"]);
  });

  it("the folder first, then reference folders, up to the file cap", async () => {
    const ref = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-ref-"));
    try {
      put("a.md");
      put("b.md");
      fs.writeFileSync(path.join(ref, "r.md"), "ref");
      const { done } = await run(job({ roots: [{ key: "folder", path: root }, { key: "ref:docs", path: ref }], limits: { files: 2, textBytes: 1024 * 1024, totalText: 1e9 } }));
      expect(Object.keys(done.files).sort()).toEqual(["folder/a.md", "folder/b.md"]);
      expect(done.truncated).toBe(true);
    } finally {
      fs.rmSync(ref, { recursive: true, force: true });
    }
  });

  it("over the total text cap, the largest files go name-only", async () => {
    put("small.md", "s".repeat(10));
    put("large.md", "l".repeat(100));
    const { done } = await run(job({ limits: { files: 100, textBytes: 1024 * 1024, totalText: 50 } }));
    expect(done.files["folder/large.md"].how).toBe("skipped:total-cap");
    expect(done.files["folder/small.md"].how).toBe("text");
  });

  it("chats: entry by entry, from the stored offset on; a shorter file starts over", async () => {
    const entry = (id: string, text: string) => `${JSON.stringify({ id, role: "user", text, at: "2026-10-30T10:00:00.000Z" })}\n`;
    put(".harness/chats/main.jsonl", entry("u1", "first question"));
    const first = await run(job());
    expect(first.docs.has("chat:.harness/chats/main.jsonl#u1")).toBe(true);
    fs.appendFileSync(path.join(root, ".harness/chats/main.jsonl"), `${entry("u2", "second question")}{"partial`);
    const second = await run(job({ known: first.done.files, chats: first.done.chats }));
    expect([...second.docs.keys()].filter((k) => k.startsWith("chat:"))).toEqual(["chat:.harness/chats/main.jsonl#u2"]);
    expect(second.done.chats[".harness/chats/main.jsonl"].ids).toEqual(["chat:.harness/chats/main.jsonl#u1", "chat:.harness/chats/main.jsonl#u2"]);
    put(".harness/chats/main.jsonl", entry("u9", "after a switch"));
    const third = await run(job({ known: second.done.files, chats: second.done.chats }));
    expect(third.msgs.some((m) => m.type === "removed" && m.ids.includes("chat:.harness/chats/main.jsonl#u1"))).toBe(true);
    expect(third.done.chats[".harness/chats/main.jsonl"].ids).toEqual(["chat:.harness/chats/main.jsonl#u9"]);
  });
});

describe("workerBuild", () => {
  it("runs the build in a worker thread and settles true", async () => {
    put("a.md", "alpha");
    const msgs: BuildMessage[] = [];
    const { done } = workerBuild()(job(), (m) => msgs.push(m));
    expect(await done).toBe(true);
    expect(msgs.at(-1)?.type).toBe("done");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm vitest run packages/shell/test/search-build.test.ts`
Expected: FAIL, `Cannot find module '../src/main/search/build'`.

- [ ] **Step 3: Write `build.ts`**

```ts
// One index build or reconcile (search spec §4.2, §4.3): run in a worker thread by the app, in-process by tests.
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  CHATS_DIR,
  type ChatMeta,
  FOLDER_ROOT,
  type FileMeta,
  MAX_FILES,
  MAX_TEXT_BYTES,
  MAX_TOTAL_TEXT_BYTES,
  type SearchDoc,
  chatDocs,
  docIdFor,
  fileDoc,
  fileKey,
  isNotePath,
  overTextBudget,
  secretShaped,
  splitKey,
} from "@humanharness/search";
import { isBinary, readCapped } from "@humanharness/workspace";
import { readChatFrom, stillInside } from "./read";
import { type WalkEntry, statPaths, walkRoot } from "./walk";

export interface BuildRoot {
  /** `folder`, or `ref:<id>`. */
  key: string;
  path: string;
}
export interface BuildLimits {
  files: number;
  textBytes: number;
  totalText: number;
}
export interface BuildJob {
  /** The folder first, then the reference folders in manifest order (§4.5). */
  roots: BuildRoot[];
  scoped: boolean;
  /** `files.json` as main knows it: what isn't new or changed is not read again. */
  known: Record<string, FileMeta>;
  chats: Record<string, ChatMeta>;
  /** A commit's paths in the folder; absent: the whole reconcile. */
  only?: string[];
  extraDenied?: string[];
  limits?: BuildLimits;
}
export type BuildMessage =
  | { type: "names"; docs: SearchDoc[]; total: number; truncated: boolean }
  | { type: "docs"; docs: SearchDoc[]; done: number; total: number }
  | { type: "removed"; ids: string[] }
  /** `truncated` only from a whole reconcile (a commit's update doesn't know). */
  | { type: "done"; files: Record<string, FileMeta>; chats: Record<string, ChatMeta>; truncated?: boolean };

const BATCH = 200;

async function readOne(root: BuildRoot, realRoot: string | null, e: WalkEntry, scoped: boolean, overBudget: boolean, maxBytes: number): Promise<{ doc: SearchDoc | null; how: FileMeta["how"] }> {
  const base = { root: root.key, rel: e.rel, mtimeMs: e.mtimeMs, scoped };
  const nameOnly = (how: FileMeta["how"]) => ({ doc: fileDoc({ ...base, text: null }), how });
  if (e.link) return nameOnly("skipped:link");
  if (e.size > maxBytes) return nameOnly("name-only");
  if (overBudget) return nameOnly("skipped:total-cap");
  if (!realRoot) return { doc: null, how: "skipped:unsafe" };
  const file = path.join(root.path, e.rel);
  const got = await readCapped(file, maxBytes, () => stillInside(file, realRoot)).catch(() => null);
  if (!got) return { doc: null, how: "skipped:unsafe" };
  if (!("bytes" in got) || isBinary(e.rel, got.bytes)) return nameOnly("name-only");
  const text = got.bytes.toString("utf8");
  // Notes keep their text without the token-shaped lines (fileDoc); any other file goes name-only (§8.2).
  if (!isNotePath(root.key, e.rel) && secretShaped(text)) return nameOnly("skipped:secret-shaped");
  return { doc: fileDoc({ ...base, text }), how: "text" };
}

/** Chat files: `chats/<scope>.jsonl` and board mode's `chats/<scope>/<task>.jsonl`, never `archive/`. */
async function chatFiles(base: string): Promise<string[]> {
  const dir = path.join(base, CHATS_DIR);
  const out: string[] = [];
  for (const d of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (d.isFile() && d.name.endsWith(".jsonl")) out.push(`${CHATS_DIR}${d.name}`);
    else if (d.isDirectory() && d.name !== "archive") {
      for (const f of await fs.readdir(path.join(dir, d.name), { withFileTypes: true }).catch(() => [])) {
        if (f.isFile() && f.name.endsWith(".jsonl")) out.push(`${CHATS_DIR}${d.name}/${f.name}`);
      }
    }
  }
  return out.sort();
}

async function indexChats(base: string, known: Record<string, ChatMeta>, post: (m: BuildMessage) => void, progress: { done: number; total: number }): Promise<Record<string, ChatMeta>> {
  const out: Record<string, ChatMeta> = {};
  const files = await chatFiles(base);
  const gone = Object.keys(known)
    .filter((f) => !files.includes(f))
    .flatMap((f) => known[f].ids);
  if (gone.length) post({ type: "removed", ids: gone });
  const realBase = await fs.realpath(base).catch(() => null);
  if (!realBase) return out;
  for (const rel of files) {
    const prev = known[rel];
    const read = await readChatFrom(path.join(base, rel), realBase, prev?.size ?? 0);
    if (read === null || read.reset) if (prev) post({ type: "removed", ids: prev.ids });
    if (read === null) continue;
    const docs = chatDocs(rel, read.lines);
    if (docs.length) post({ type: "docs", docs, ...progress });
    out[rel] = { size: read.end, ids: [...(read.reset ? [] : (prev?.ids ?? [])), ...docs.map((d) => d.id)] };
  }
  return out;
}

export async function build(job: BuildJob, post: (m: BuildMessage) => void): Promise<void> {
  const limits = job.limits ?? { files: MAX_FILES, textBytes: MAX_TEXT_BYTES, totalText: MAX_TOTAL_TEXT_BYTES };
  const files: Record<string, FileMeta> = { ...job.known };
  const seen: { root: BuildRoot; e: WalkEntry }[] = [];
  const removed: string[] = [];
  let truncated: boolean | undefined;
  const folder = job.roots[0];
  if (job.only) {
    const { entries, missing } = await statPaths(folder.path, job.only, { extraDenied: job.extraDenied ?? [] });
    for (const e of entries) seen.push({ root: folder, e });
    for (const rel of missing) {
      const key = fileKey(folder.key, rel);
      if (files[key]) removed.push(docIdFor(folder.key, rel));
      delete files[key];
    }
  } else {
    truncated = false;
    let left = limits.files;
    const keys = new Set<string>();
    for (const root of job.roots) {
      if (left <= 0) {
        truncated = true;
        break;
      }
      const isFolder = root.key === FOLDER_ROOT;
      const w = await walkRoot(root.path, { max: left, extraDenied: isFolder ? (job.extraDenied ?? []) : [], skipDirs: isFolder ? [CHATS_DIR.slice(0, -1)] : [] });
      truncated ||= w.truncated;
      left -= w.entries.length;
      for (const e of w.entries) {
        seen.push({ root, e });
        keys.add(fileKey(root.key, e.rel));
      }
    }
    for (const key of Object.keys(files)) {
      if (keys.has(key)) continue;
      const { root, rel } = splitKey(key);
      removed.push(docIdFor(root, rel));
      delete files[key];
    }
  }
  if (removed.length) post({ type: "removed", ids: removed });

  const changed = seen.filter(({ root, e }) => {
    const k = files[fileKey(root.key, e.rel)];
    return !k || k.size !== e.size || k.mtimeMs !== e.mtimeMs;
  });
  const changedKeys = new Set(changed.map(({ root, e }) => fileKey(root.key, e.rel)));
  // A first build shows names within about a second (D8); a reconcile goes straight to texts.
  if (Object.keys(job.known).length === 0 && !job.only && changed.length > 0) {
    post({ type: "names", docs: changed.map(({ root, e }) => fileDoc({ root: root.key, rel: e.rel, mtimeMs: e.mtimeMs, text: null, scoped: job.scoped })), total: changed.length, truncated: truncated === true });
  }
  // The total text cap (§4.5): what is already indexed as text stays; the largest new candidates go name-only first.
  const kept = Object.entries(files)
    .filter(([key, m]) => m.how === "text" && !changedKeys.has(key))
    .reduce((sum, [, m]) => sum + m.size, 0);
  const candidates = changed.filter(({ e }) => !e.link && e.size <= limits.textBytes).map(({ root, e }) => ({ key: fileKey(root.key, e.rel), size: e.size }));
  const over = overTextBudget(candidates, Math.max(0, limits.totalText - kept));

  const realRoots = new Map<string, string | null>();
  for (const root of job.roots) realRoots.set(root.key, await fs.realpath(root.path).catch(() => null));
  let done = 0;
  let batch: SearchDoc[] = [];
  const unsafe: string[] = [];
  const flush = () => {
    if (batch.length) post({ type: "docs", docs: batch, done, total: changed.length });
    batch = [];
  };
  for (const { root, e } of changed) {
    const key = fileKey(root.key, e.rel);
    const { doc, how } = await readOne(root, realRoots.get(root.key) ?? null, e, job.scoped, over.has(key), limits.textBytes);
    done++;
    if (doc) {
      batch.push(doc);
      files[key] = { size: e.size, mtimeMs: e.mtimeMs, how };
    } else {
      unsafe.push(docIdFor(root.key, e.rel));
      delete files[key];
    }
    if (batch.length >= BATCH) flush();
  }
  flush();
  if (unsafe.length) post({ type: "removed", ids: unsafe });

  const chats = job.only ? { ...job.chats } : await indexChats(folder.path, job.chats, post, { done, total: changed.length });
  post({ type: "done", files, chats, ...(truncated === undefined ? {} : { truncated }) });
}
```

- [ ] **Step 4: Write `worker.ts`**

```ts
// The search build's worker thread (runner.ts): one job from `workerData`, its messages, then "end" (or "failed"). The
// app bundles this file as its own entry (`search-worker`), so reading a large folder never blocks Electron main.
import { parentPort, workerData } from "node:worker_threads";
import { type BuildJob, build } from "./build";

build(workerData as BuildJob, (m) => parentPort?.postMessage(m)).then(
  () => parentPort?.postMessage({ type: "end" }),
  (err: unknown) => {
    console.error("Could not build the search index", err instanceof Error ? err.message : "unknown error");
    parentPort?.postMessage({ type: "failed" });
  },
);
```

The log line names no path and no content (§8.3: nothing of the folder reaches the logs).

- [ ] **Step 5: Write `runner.ts`**

```ts
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { devLauncher } from "@humanharness/blocks";
import { type BuildJob, type BuildMessage, build } from "./build";

/** Runs one build; `done` settles true when it finished, false when it failed or was stopped. Never throws. */
export type BuildRunner = (job: BuildJob, onMessage: (m: BuildMessage) => void) => { done: Promise<boolean>; stop(): void };

const SEARCH_WORKER_HEAP_MB = 1024;

/** In this thread (tests, and any caller without a worker). */
export const inProcessBuild = (): BuildRunner => (job, onMessage) => {
  let stopped = false;
  const done = build(job, (m) => {
    if (!stopped) onMessage(m);
  }).then(
    () => !stopped,
    (err: unknown) => {
      console.error("Could not build the search index", err instanceof Error ? err.message : "unknown error");
      return false;
    },
  );
  return { done, stop: () => void (stopped = true) };
};

/** In a worker thread (§4.3, like `workerDiff`). Default entry: the TypeScript source through tsx; the app passes its built file. */
export function workerBuild(o: { entry?: string; heapMb?: number } = {}): BuildRunner {
  const entry = o.entry ?? fileURLToPath(new URL("./worker.ts", import.meta.url));
  const execArgv = o.entry ? [] : devLauncher().args;
  return (job, onMessage) => {
    let worker: Worker;
    try {
      worker = new Worker(entry, { workerData: job, execArgv, resourceLimits: { maxOldGenerationSizeMb: o.heapMb ?? SEARCH_WORKER_HEAP_MB } });
    } catch (err) {
      console.error("Could not start the search worker", err);
      return { done: Promise.resolve(false), stop: () => {} };
    }
    let settled = false;
    // Hoisted so `stop()` settles `done` too: a stopped build resolves false at once, and no message is applied after it.
    let finish: (ok: boolean) => void = () => {};
    const done = new Promise<boolean>((resolve) => {
      finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        void worker.terminate().catch(() => undefined);
        resolve(ok);
      };
      worker.on("message", (m: BuildMessage | { type: "end" } | { type: "failed" }) => {
        if (m?.type === "end") finish(true);
        else if (m?.type === "failed") finish(false);
        else if (!settled && m) onMessage(m);
      });
      worker.once("error", (err) => {
        console.error("The search worker crashed", err.message);
        finish(false);
      });
      worker.once("exit", () => finish(false));
    });
    return { done, stop: () => finish(false) };
  };
}
```

- [ ] **Step 6: Add the worker to the app's build**

`packages/shell/electron.vite.config.ts`: add `"@humanharness/search"` to `workspacePackages` (after `@humanharness/runtime`), and to `main.build.lib.entry`, after `"diff-worker"`:

```ts
          // The search index's worker thread (main/search/runner.ts): the app passes this built file to `workerBuild`.
          "search-worker": path.join(__dirname, "src/main/search/worker.ts"),
```

- [ ] **Step 7: Run the tests, typecheck and build**

Run: `corepack pnpm vitest run packages/shell/test/search-build.test.ts && corepack pnpm typecheck && corepack pnpm app:build`
Expected: PASS; clean; the build lists `out/main/search-worker.js`.

- [ ] **Step 8: Commit**

```bash
git add packages/shell
git commit -m "feat(shell): the search build in a worker thread: files, notes, chats, caps

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 11: The persisted snapshot (§4.1)

**Files:**
- Create: `packages/shell/src/main/search/store.ts`
- Test: `packages/shell/test/search-store.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/shell/test/search-store.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndexStore, type Snapshot, searchDir } from "../src/main/search/store";

let userData: string;
beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-store-"));
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(userData, { recursive: true, force: true });
});

const snap = (o: Partial<Snapshot> = {}): Snapshot => ({ index: '{"x":1}', files: { "folder/a.md": { size: 1, mtimeMs: 2, how: "text" } }, chats: {}, memory: ["action:a"], truncated: false, ...o });

describe("IndexStore (§4.1)", () => {
  it("lives under <userData>/search, one folder per base", () => {
    expect(path.dirname(searchDir(userData, "/w/a"))).toBe(path.join(userData, "search"));
    expect(searchDir(userData, "/w/a")).not.toBe(searchDir(userData, "/w/b"));
  });

  it("writes atomically with 0600 and reads back", async () => {
    const store = new IndexStore(searchDir(userData, "/w/a"));
    store.schedule(() => snap());
    await store.flush();
    for (const f of ["index.json", "files.json"]) expect(fs.statSync(path.join(store.dir, f)).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(store.dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(await store.load()).toEqual(snap());
  });

  it("is a cache: a missing, broken or older snapshot loads as null", async () => {
    const store = new IndexStore(searchDir(userData, "/w/a"));
    expect(await store.load()).toBeNull();
    store.schedule(() => snap());
    await store.flush();
    fs.writeFileSync(path.join(store.dir, "files.json"), "{broken");
    expect(await store.load()).toBeNull();
    fs.writeFileSync(path.join(store.dir, "files.json"), JSON.stringify({ version: 0, files: {}, chats: {}, memory: [] }));
    expect(await store.load()).toBeNull();
    fs.writeFileSync(path.join(store.dir, "files.json"), JSON.stringify({ version: 1, files: { a: { size: "x" } }, chats: {}, memory: [] }));
    expect(await store.load()).toBeNull();
  });

  it("writes at most every 5 s while changes come in", async () => {
    vi.useFakeTimers();
    const store = new IndexStore(searchDir(userData, "/w/a"));
    const get = vi.fn(() => snap());
    store.schedule(get);
    store.schedule(get);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(get).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    await store.flush();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("keeps the recents and the scopes toggle; discard removes the folder", async () => {
    const store = new IndexStore(searchDir(userData, "/w/a"));
    expect(await store.prefs()).toEqual({ recent: [], allScopes: false });
    await store.savePrefs({ recent: ["note:x"], allScopes: true });
    expect(await store.prefs()).toEqual({ recent: ["note:x"], allScopes: true });
    expect(fs.statSync(path.join(store.dir, "prefs.json")).mode & 0o777).toBe(0o600);
    await store.discard();
    expect(fs.existsSync(store.dir)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm vitest run packages/shell/test/search-store.test.ts`
Expected: FAIL, `Cannot find module '../src/main/search/store'`.

- [ ] **Step 3: Write `store.ts`**

```ts
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { type ChatMeta, type FileMeta, INDEX_VERSION } from "@humanharness/search";

/** §4.1: written at most every 5 s while changes come in, and once more on quit. */
export const SAVE_EVERY_MS = 5_000;
const MAX_RECENT = 8;

/** Beside the history's folder, never in the person's folder; one per base, so one per profile (plan deviation 2). */
export function searchDir(userData: string, base: string): string {
  return path.join(userData, "search", createHash("sha256").update(base).digest("hex").slice(0, 16));
}

export interface Snapshot {
  /** `MiniSearch`'s JSON, as `LiveIndex.toJSON` gives it. */
  index: string;
  files: Record<string, FileMeta>;
  chats: Record<string, ChatMeta>;
  /** The ids of the documents built in memory (actions, tasks), so a later run can take them out. */
  memory: string[];
  truncated: boolean;
}

/** Per profile (plan deviation 3): the last results opened (ids only) and the "All scopes" toggle. */
export interface SearchPrefs {
  recent: string[];
  allScopes: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFileMeta = (v: unknown) => isObject(v) && typeof v.size === "number" && typeof v.mtimeMs === "number" && typeof v.how === "string";
const isChatMeta = (v: unknown) => isObject(v) && typeof v.size === "number" && Array.isArray(v.ids) && v.ids.every((i) => typeof i === "string");

async function writeAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, text, { mode: 0o600 });
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

export class IndexStore {
  private pending: (() => Snapshot) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    readonly dir: string,
    private readonly o: { delayMs?: number } = {},
  ) {}

  /** The saved snapshot; null when missing, broken or of another version (§4.1: rebuilt then). */
  async load(): Promise<Snapshot | null> {
    try {
      const meta: unknown = JSON.parse(await fs.readFile(path.join(this.dir, "files.json"), "utf8"));
      if (!isObject(meta) || meta.version !== INDEX_VERSION || !isObject(meta.files) || !isObject(meta.chats) || !Array.isArray(meta.memory)) return null;
      if (!Object.values(meta.files).every(isFileMeta) || !Object.values(meta.chats).every(isChatMeta) || !meta.memory.every((m) => typeof m === "string")) return null;
      const index = await fs.readFile(path.join(this.dir, "index.json"), "utf8");
      return { index, files: meta.files as Record<string, FileMeta>, chats: meta.chats as Record<string, ChatMeta>, memory: meta.memory as string[], truncated: meta.truncated === true };
    } catch {
      return null;
    }
  }

  /** Saves what `get` gives in at most 5 s; later calls before then only replace `get`. */
  schedule(get: () => Snapshot): void {
    this.pending = get;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.writeNow();
    }, this.o.delayMs ?? SAVE_EVERY_MS);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.writeNow();
  }

  private writeNow(): Promise<void> {
    const get = this.pending;
    this.pending = null;
    if (!get) return this.writing;
    this.writing = this.writing
      .then(async () => {
        const s = get();
        // The index first: files.json behind it only makes the next reconcile read a few files again.
        await writeAtomic(path.join(this.dir, "index.json"), s.index);
        await writeAtomic(path.join(this.dir, "files.json"), JSON.stringify({ version: INDEX_VERSION, files: s.files, chats: s.chats, memory: s.memory, truncated: s.truncated }));
      })
      .catch((err: unknown) => console.error("Could not save the search index", err instanceof Error ? err.message : "unknown error"));
    return this.writing;
  }

  /** The folder moved or the index is dropped: nothing pending is written, and the folder goes. */
  async discard(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    await this.writing;
    await fs.rm(this.dir, { recursive: true, force: true });
  }

  async prefs(): Promise<SearchPrefs> {
    try {
      const v: unknown = JSON.parse(await fs.readFile(path.join(this.dir, "prefs.json"), "utf8"));
      if (isObject(v)) {
        const recent = Array.isArray(v.recent) ? v.recent.filter((r): r is string => typeof r === "string").slice(0, MAX_RECENT) : [];
        return { recent, allScopes: v.allScopes === true };
      }
    } catch {
      // No prefs yet.
    }
    return { recent: [], allScopes: false };
  }

  savePrefs(p: SearchPrefs): Promise<void> {
    return writeAtomic(path.join(this.dir, "prefs.json"), JSON.stringify({ recent: p.recent.slice(0, MAX_RECENT), allScopes: p.allScopes }));
  }
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `corepack pnpm vitest run packages/shell/test/search-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shell
git commit -m "feat(shell): the search index's snapshot: atomic, 0600, at most every 5 s

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 12: The search service (lazy, staged, triggers, snippets, recents)

**Files:**
- Create: `packages/shell/src/main/search/views.ts`, `packages/shell/src/main/search/service.ts`
- Test: `packages/shell/test/search-service.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/shell/test/search-service.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer, SearchStatus } from "@humanharness/protocol";
import { type SearchDoc, actionDocs } from "@humanharness/search";
import { inProcessBuild } from "../src/main/search/runner";
import { SearchService, type SearchServiceDeps } from "../src/main/search/service";

let tmp: string;
let base: string;
let userData: string;
const put = (rel: string, text = "x", root = base) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-svc-"));
  base = path.join(tmp, "Work");
  userData = path.join(tmp, "userData");
  fs.mkdirSync(base, { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function service(o: Partial<SearchServiceDeps> = {}) {
  const statuses: SearchStatus[] = [];
  const runner = vi.fn(inProcessBuild());
  let now = Date.parse("2026-10-30T12:00:00.000Z");
  const svc = new SearchService({
    userData: () => userData,
    base: async () => base,
    scoped: () => false,
    openScope: async () => null,
    scopeTitles: async () => new Map(),
    references: async () => [],
    memory: async () => actionDocs([{ id: "topic5", label: "Topic 5", description: "Blocks and context", scope: "main" }]),
    extraDenied: async () => [],
    status: (s) => statuses.push(s),
    runner,
    reveal: vi.fn(async () => true),
    now: () => now,
    storeDelayMs: 10,
    ...o,
  });
  return { svc, statuses, runner, tick: (ms: number) => (now += ms) };
}
const ok = (a: SearchAnswer) => {
  if (!a.ok) throw new Error(`not ok: ${a.reason}`);
  return a;
};
const titles = (a: SearchAnswer) => ok(a).groups.flatMap((g) => g.hits.map((h) => h.title.map((p) => p.text).join("")));

describe("SearchService (§4, §5)", () => {
  it("D0: nothing is created until the first query; a commit before it does nothing", async () => {
    const { svc, runner } = service();
    svc.committed(["a.md"]);
    svc.committed(null);
    await svc.flush();
    expect(runner).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(userData, "search"))).toBe(false);
  });

  it("builds lazily on the first query: names, then texts, then ready", async () => {
    put("docs/guide.md", "# Guide\n\n## Context window\nthe context window holds the turn");
    put(".harness/notes/engines.md", "---\ntitle: Engines\n---\nThe context of each engine");
    const { svc, statuses } = service();
    const first = ok(await svc.query("", {}));
    expect(first.recent).toEqual([]);
    await svc.whenIdle();
    expect(statuses.map((s) => s.state)).toEqual(expect.arrayContaining(["names", "building", "ready"]));
    expect(statuses.at(-1)?.state).toBe("ready");
    const a = ok(await svc.query("context", {}));
    expect(a.groups.map((g) => g.kind)).toEqual(["task", "note", "file"]);
    expect(titles(a)).toEqual(expect.arrayContaining(["Topic 5", "Engines", "guide.md"]));
    const file = a.groups.find((g) => g.kind === "file")!.hits[0];
    expect(file.target).toEqual({ kind: "document", path: "docs/guide.md", anchor: "context-window" });
    expect(file.context.some((p) => p.mark && p.text.toLowerCase() === "context")).toBe(true);
    expect(file.hint).toEqual({ kind: "path", text: "docs/guide.md" });
    expect(a.counts.file).toBe(1);
  });

  it("a filter gives up to 50 of one kind and keeps the counts of all", async () => {
    for (let i = 0; i < 60; i++) put(`f${i}.txt`, "plan");
    const { svc } = service();
    await svc.query("", {});
    await svc.whenIdle();
    const all = ok(await svc.query("plan", {}));
    expect(all.groups.find((g) => g.kind === "file")?.hits).toHaveLength(5);
    const files = ok(await svc.query("plan", { kind: "file" }));
    expect(files.groups.map((g) => g.kind)).toEqual(["file"]);
    expect(files.groups[0].hits).toHaveLength(50);
    expect(files.counts.file).toBe(60);
  });

  it("a commit's paths update the index; a restore (null) reconciles the whole folder", async () => {
    put("a.md", "alpha");
    const { svc } = service();
    await svc.query("", {});
    await svc.whenIdle();
    put("b.md", "bravo");
    svc.committed(["b.md"]);
    await svc.whenIdle();
    expect(titles(await svc.query("bravo", {}))).toEqual(["b.md"]);
    fs.rmSync(path.join(base, "a.md"));
    svc.committed(null);
    await svc.whenIdle();
    expect(titles(await svc.query("alpha", {}))).toEqual([]);
  });

  it("reconciles on open at most once per 60 s", async () => {
    const { svc, runner, tick } = service();
    await svc.query("", {});
    await svc.whenIdle();
    expect(runner).toHaveBeenCalledTimes(1);
    await svc.query("", {});
    await svc.whenIdle();
    expect(runner).toHaveBeenCalledTimes(1);
    tick(60_000);
    await svc.query("", {});
    await svc.whenIdle();
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("loads a saved snapshot in a later run, and rebuilds over a corrupt one", async () => {
    put("a.md", "alpha");
    const one = service();
    await one.svc.query("", {});
    await one.svc.whenIdle();
    await one.svc.flush();
    const two = service();
    expect(titles(await two.svc.query("alpha", {}))).toEqual(["a.md"]);
    await two.svc.flush();
    const dir = path.join(userData, "search", fs.readdirSync(path.join(userData, "search"))[0]);
    fs.writeFileSync(path.join(dir, "index.json"), "{corrupt");
    const three = service();
    await three.svc.query("", {});
    await three.svc.whenIdle();
    expect(titles(await three.svc.query("alpha", {}))).toEqual(["a.md"]);
  });

  it("says when the file cap left files out", async () => {
    for (const p of ["a", "b", "c"]) put(p, "plan");
    const { svc } = service({ limits: { files: 2, textBytes: 1024 * 1024, totalText: 1e9 } });
    await svc.query("", {});
    await svc.whenIdle();
    expect(ok(await svc.query("plan", {})).status.truncated).toBe(true);
  });

  it("each base has its own index: nothing crosses (profiles)", async () => {
    const other = path.join(tmp, "Other");
    put("mine.md", "alpha");
    put("theirs.md", "alpha", other);
    let current = base;
    const { svc } = service({ base: async () => current });
    await svc.query("", {});
    await svc.whenIdle();
    expect(titles(await svc.query("alpha", {}))).toEqual(["mine.md"]);
    current = other;
    await svc.query("", {});
    await svc.whenIdle();
    expect(titles(await svc.query("alpha", {}))).toEqual(["theirs.md"]);
    await svc.flush();
    expect(fs.readdirSync(path.join(userData, "search"))).toHaveLength(2);
  });

  it("scopes: the open scope and the app by default, every scope with the toggle (remembered)", async () => {
    put(".harness/notes/physics/a.md", "---\ntitle: Physics plan\n---\nplan");
    put(".harness/notes/chem/b.md", "---\ntitle: Chem plan\n---\nplan");
    put("shared.md", "plan");
    const { svc } = service({ scoped: () => true, openScope: async () => "physics", scopeTitles: async () => new Map([["chem", "Chemistry"]]) });
    await svc.query("", {});
    await svc.whenIdle();
    expect(titles(await svc.query("plan", {})).sort()).toEqual(["Physics plan", "shared.md"]);
    const all = ok(await svc.query("plan", { allScopes: true }));
    expect(all.groups.flatMap((g) => g.hits).find((h) => h.scope === "Chemistry")).toBeTruthy();
    expect(ok(await svc.query("plan", {})).allScopes).toBe(true);
  });

  it("remembers what was opened: the empty query answers it first", async () => {
    put("a.md", "alpha");
    const { svc } = service();
    await svc.query("", {});
    await svc.whenIdle();
    const hit = ok(await svc.query("alpha", {})).groups[0].hits[0];
    expect(await svc.opened(hit)).toEqual({ ok: true });
    expect(ok(await svc.query("", {})).recent.map((h) => h.id)).toEqual([hit.id]);
    expect(await svc.opened({ id: "nope" })).toEqual({ ok: false });
  });

  it("a reference folder's file: read only, named by its name, shown in Finder by main", async () => {
    const ref = path.join(tmp, "Ref");
    put("spec.pdf.txt", "budget", ref);
    const reveal = vi.fn(async () => true);
    const { svc } = service({ references: async () => [{ id: "docs", label: "Docs", path: ref }], reveal });
    await svc.query("", {});
    await svc.whenIdle();
    const hit = ok(await svc.query("budget", {})).groups[0].hits[0];
    expect(hit).toMatchObject({ folder: "Docs", hint: { kind: "name", text: "spec.pdf.txt" }, target: { kind: "reveal" } });
    expect(JSON.stringify(hit)).not.toContain(ref);
    expect(ok(await svc.query("budget", { references: false })).groups).toEqual([]);
    await svc.opened(hit);
    expect(reveal).toHaveBeenCalledWith(path.join(ref, "spec.pdf.txt"), [ref]);
  });

  it("not set up: not-ready, and nothing is created", async () => {
    const { svc } = service({ base: async () => null });
    expect(await svc.query("x", {})).toEqual({ ok: false, reason: "not-ready" });
    expect(fs.existsSync(path.join(userData, "search"))).toBe(false);
  });

  it("memory documents are swapped on open: a gone action leaves", async () => {
    let docs: SearchDoc[] = actionDocs([{ id: "a", label: "Alpha topic", scope: "main" }]);
    const { svc, tick } = service({ memory: async () => docs });
    await svc.query("", {});
    await svc.whenIdle();
    expect(titles(await svc.query("alpha", {}))).toEqual(["Alpha topic"]);
    docs = actionDocs([{ id: "b", label: "Beta topic", scope: "main" }]);
    tick(10_000);
    expect(titles(await svc.query("alpha", {}))).toEqual([]);
    expect(titles(await svc.query("beta", {}))).toEqual(["Beta topic"]);
  });

  it("discard drops a base's index folder", async () => {
    const { svc } = service();
    await svc.query("", {});
    await svc.whenIdle();
    await svc.flush();
    await svc.discard(base);
    expect(fs.readdirSync(path.join(userData, "search"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm vitest run packages/shell/test/search-service.test.ts`
Expected: FAIL, `Cannot find module '../src/main/search/service'`.

- [ ] **Step 3: Write `views.ts`**

```ts
import type { SearchHitView, SearchMarked, SearchTarget } from "@humanharness/protocol";
import { type SearchHit, baseName, isMarkdown, isRefRoot, markFirst } from "@humanharness/search";

export interface ViewContext {
  /** `ref:<id>` → the reference folder's label. */
  refLabels: Map<string, string>;
  /** A scope's title when the row must say it (another scope); undefined otherwise. */
  scopeTitle: (scope: string) => string | undefined;
  snippet?: { marked: SearchMarked; anchor?: string };
}

/** What Enter does (§3). A reference folder's file that isn't `.md` is shown in Finder by main (`reveal`). */
export function targetOf(hit: SearchHit, anchor?: string): SearchTarget {
  if (hit.id.startsWith("action:") && hit.action) return { kind: "action", action: hit.action };
  if (hit.id.startsWith("open:") && hit.task) return { kind: "open-task", task: hit.task };
  if (hit.id.startsWith("past:") && hit.task) return { kind: "history", task: hit.task };
  if (hit.chat) return { kind: "chat", entry: hit.chat.entry, scope: hit.scope, ...(hit.chat.task ? { task: hit.chat.task } : {}) };
  // A reference folder's .md opens in the reader by its relative path (plan deviation 14).
  if (isMarkdown(hit.path)) return { kind: "document", path: hit.path, ...(anchor ? { anchor } : {}) };
  return isRefRoot(hit.root) ? { kind: "reveal" } : { kind: "timeline", path: hit.path };
}

/** What ⌘Enter may name (§5.4): never a reference file's full path, never a chat line. */
function hintOf(hit: SearchHit, ref: boolean): SearchHitView["hint"] {
  if (hit.kind === "file") return ref ? { kind: "name", text: baseName(hit.path) } : { kind: "path", text: hit.path };
  if (hit.kind === "note") return { kind: "note", text: hit.title };
  return hit.chat ? null : { kind: "task", text: hit.title };
}

export function hitView(hit: SearchHit, c: ViewContext): SearchHitView {
  const folder = isRefRoot(hit.root) ? c.refLabels.get(hit.root!) : undefined;
  const scope = c.scopeTitle(hit.scope);
  return {
    id: hit.id,
    kind: hit.kind,
    title: markFirst(hit.title, hit.terms),
    context: c.snippet?.marked ?? (hit.kind === "task" ? [] : [{ text: hit.path }]),
    ...(hit.meta ? { meta: hit.meta } : {}),
    ...(folder !== undefined ? { folder } : {}),
    ...(scope !== undefined ? { scope } : {}),
    hint: hintOf(hit, folder !== undefined),
    target: targetOf(hit, c.snippet?.anchor),
  };
}
```

- [ ] **Step 4: Write `service.ts`**

```ts
// Global search in main (search spec §4, §5, §9): lazy (D8), one live index per base, the worker's batches applied here.
import path from "node:path";
import type { SearchAnswer, SearchFilters, SearchGroup, SearchHitView, SearchKind, SearchMarked, SearchStatus } from "@humanharness/protocol";
import {
  APP_SCOPE,
  type ChatMeta,
  FOLDER_ROOT,
  type FileMeta,
  KINDS,
  LiveIndex,
  type SearchDoc,
  type SearchHit,
  fileKey,
  headingAnchorAt,
  isMarkdown,
  isRefRoot,
  refRoot,
  secretShaped,
  snippetAround,
  withoutSecretLines,
} from "@humanharness/search";
import type { BuildJob, BuildLimits, BuildMessage } from "./build";
import { readChatEntry, readText } from "./read";
import type { BuildRunner } from "./runner";
import { IndexStore, searchDir } from "./store";
import { hitView } from "./views";

export const RECONCILE_EVERY_MS = 60_000;
/** While typing, the tasks built in memory are rebuilt at most this often (on open they always are). */
export const MEMORY_FRESH_MS = 5_000;
export const PER_GROUP = 5;
export const PER_KIND = 50;
export const MAX_RECENT = 8;
/** Snippets read per answer (plan deviation 17). */
export const MAX_SNIPPETS = 20;

export interface SearchReference {
  id: string;
  label: string;
  /** Absolute; never sent to the window. */
  path: string;
}

export interface SearchServiceDeps {
  userData(): string;
  /** The active base (the folder, or the active profile's folder); null before setup. */
  base(): Promise<string | null>;
  scoped(): boolean;
  openScope(): Promise<string | null>;
  scopeTitles(): Promise<Map<string, string>>;
  references(): Promise<SearchReference[]>;
  /** Actions, the open task and past tasks, built now (§4.2). */
  memory(): Promise<SearchDoc[]>;
  /** The engine's generated instructions file, never indexed (§8.1). */
  extraDenied(): Promise<string[]>;
  status(s: SearchStatus): void;
  runner: BuildRunner;
  /** "Show in Finder", checked inside `roots`. */
  reveal(file: string, roots: string[]): Promise<boolean>;
  now?: () => number;
  storeDelayMs?: number;
  limits?: BuildLimits;
}

interface Live {
  base: string;
  index: LiveIndex;
  store: IndexStore;
  files: Record<string, FileMeta>;
  chats: Record<string, ChatMeta>;
  memory: Set<string>;
  memoryAt: number;
  truncated: boolean;
  reconciledAt: number;
  building: { stop(): void; done: Promise<boolean> } | null;
  again: "full" | Set<string> | null;
}

const EMPTY_COUNTS = (): Record<SearchKind, number> => ({ task: 0, note: 0, file: 0 });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export class SearchService {
  private live: Live | null = null;
  private opening: Promise<Live | null> | null = null;

  constructor(private readonly d: SearchServiceDeps) {}

  private now(): number {
    return this.d.now?.() ?? Date.now();
  }

  /** The live index for the current base, loaded or built on first use; a base change (profile, move) swaps it. */
  private async ensure(): Promise<Live | null> {
    const base = await this.d.base();
    if (!base) return null;
    if (this.live?.base === base) return this.live;
    if (this.live) await this.close();
    this.opening ??= this.load(base).finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  private async load(base: string): Promise<Live> {
    const store = new IndexStore(searchDir(this.d.userData(), base), this.d.storeDelayMs !== undefined ? { delayMs: this.d.storeDelayMs } : {});
    const snap = await store.load();
    const index = snap ? LiveIndex.fromJSON(snap.index) : null;
    const live: Live = {
      base,
      index: index ?? LiveIndex.empty(),
      store,
      files: index && snap ? snap.files : {},
      chats: index && snap ? snap.chats : {},
      memory: new Set(index && snap ? snap.memory : []),
      memoryAt: 0,
      truncated: index && snap ? snap.truncated : false,
      reconciledAt: 0,
      building: null,
      again: null,
    };
    this.live = live;
    if (index) {
      const n = Object.keys(live.files).length;
      live.index.setStatus({ state: "ready", done: n, total: n, ...(live.truncated ? { truncated: true as const } : {}) });
    } else this.startBuild(live, "full");
    return live;
  }

  private async close(): Promise<void> {
    const live = this.live;
    this.live = null;
    live?.building?.stop();
    await live?.store.flush();
  }

  private setStatus(live: Live, s: SearchStatus): void {
    live.index.setStatus(s);
    this.d.status(s);
  }

  private save(live: Live): void {
    live.store.schedule(() => ({ index: live.index.toJSON(), files: live.files, chats: live.chats, memory: [...live.memory], truncated: live.truncated }));
  }

  private apply(live: Live, m: BuildMessage): void {
    if (m.type === "names") {
      live.index.upsert(m.docs);
      this.setStatus(live, { state: "names", done: 0, total: m.total, ...(m.truncated ? { truncated: true as const } : {}) });
    } else if (m.type === "docs") {
      live.index.upsert(m.docs);
      this.setStatus(live, { state: "building", done: m.done, total: m.total });
      this.save(live);
    } else if (m.type === "removed") {
      live.index.remove(m.ids);
    } else {
      live.files = m.files;
      live.chats = m.chats;
      if (m.truncated !== undefined) live.truncated = m.truncated;
      const n = Object.keys(m.files).length;
      this.setStatus(live, { state: "ready", done: n, total: n, ...(live.truncated ? { truncated: true as const } : {}) });
      this.save(live);
    }
  }

  private async job(live: Live, what: "full" | Set<string>): Promise<BuildJob> {
    const refs = await this.d.references();
    return {
      roots: [{ key: FOLDER_ROOT, path: live.base }, ...refs.map((r) => ({ key: refRoot(r.id), path: r.path }))],
      scoped: this.d.scoped(),
      known: live.files,
      chats: live.chats,
      ...(what === "full" ? {} : { only: [...what] }),
      extraDenied: await this.d.extraDenied(),
      ...(this.d.limits ? { limits: this.d.limits } : {}),
    };
  }

  /** One build at a time; what comes in meanwhile runs right after (a full reconcile absorbs a commit's paths). */
  private startBuild(live: Live, what: "full" | Set<string>): void {
    if (live.building) {
      live.again = what === "full" || live.again === "full" ? "full" : new Set([...(live.again ?? []), ...what]);
      return;
    }
    if (what === "full") live.reconciledAt = this.now();
    let stopped = false;
    let handle: { stop(): void } | null = null;
    const done = (async () => {
      const job = await this.job(live, what);
      if (stopped) return false;
      const run = this.d.runner(job, (m) => {
        if (this.live === live && !stopped) this.apply(live, m);
      });
      handle = run;
      return run.done;
    })().catch((err: unknown) => {
      console.error("Could not build the search index", err instanceof Error ? err.message : "unknown error");
      return false;
    });
    live.building = {
      done,
      stop: () => {
        stopped = true;
        handle?.stop();
      },
    };
    void done.then(() => {
      if (live.building?.done === done) live.building = null;
      const next = live.again;
      live.again = null;
      if (next && this.live === live && !stopped) this.startBuild(live, next);
    });
  }

  private maybeReconcile(live: Live): void {
    if (!live.building && this.now() - live.reconciledAt >= RECONCILE_EVERY_MS) this.startBuild(live, "full");
  }

  /** Swaps the tasks built in memory (§4.2). Not saved on its own: the next build's save carries them. */
  private async refreshMemory(live: Live): Promise<void> {
    const docs = await this.d.memory().catch((err: unknown) => {
      console.error("Could not list the tasks for search", err instanceof Error ? err.message : "unknown error");
      return [] as SearchDoc[];
    });
    const ids = new Set(docs.map((doc) => doc.id));
    live.index.remove([...live.memory].filter((id) => !ids.has(id)));
    live.index.upsert(docs);
    live.memory = ids;
    live.memoryAt = this.now();
  }

  /** A text file's or a chat entry's snippet, for a visible row only (§5.3); never a secret-shaped file's. */
  private async snippet(live: Live, hit: SearchHit, refPaths: Map<string, string>): Promise<{ marked: SearchMarked; anchor?: string } | null> {
    if (hit.chat) {
      const text = await readChatEntry(live.base, hit.chat.file, hit.chat.offset, hit.chat.length);
      const s = text === null ? null : snippetAround(withoutSecretLines(text), hit.terms);
      return s ? { marked: s.marked } : null;
    }
    if (hit.kind === "task" || !hit.root) return null;
    if (live.files[fileKey(hit.root, hit.path)]?.how !== "text") return null;
    const root = hit.root === FOLDER_ROOT ? live.base : refPaths.get(hit.root);
    if (!root) return null;
    const raw = await readText(root, hit.path);
    if (raw === null) return null;
    // The file may have changed since it was indexed: the content check again before any of it leaves main.
    if (hit.kind === "file" && secretShaped(raw)) return null;
    const text = hit.kind === "note" ? withoutSecretLines(raw) : raw;
    const s = snippetAround(text, hit.terms);
    if (!s) return null;
    const anchor = isMarkdown(hit.path) ? headingAnchorAt(text, s.at) : undefined;
    return { marked: s.marked, ...(anchor ? { anchor } : {}) };
  }

  private async views(live: Live, hits: SearchHit[], open: string | null, snippets: boolean): Promise<SearchHitView[]> {
    const refs = await this.d.references();
    const refLabels = new Map(refs.map((r) => [refRoot(r.id), r.label]));
    const refPaths = new Map(refs.map((r) => [refRoot(r.id), r.path]));
    const scoped = this.d.scoped();
    const titles = scoped ? await this.d.scopeTitles() : new Map<string, string>();
    const scopeTitle = (s: string) => (scoped && s !== APP_SCOPE && s !== open ? (titles.get(s) ?? s) : undefined);
    const out: SearchHitView[] = [];
    let read = 0;
    for (const hit of hits) {
      const snippet = snippets && hit.terms.length > 0 && read++ < MAX_SNIPPETS ? await this.snippet(live, hit, refPaths).catch(() => null) : null;
      out.push(hitView(hit, { refLabels, scopeTitle, ...(snippet ? { snippet } : {}) }));
    }
    return out;
  }

  async query(q: string, filters: SearchFilters): Promise<SearchAnswer> {
    const live = await this.ensure();
    if (!live) return { ok: false, reason: "not-ready" };
    const prefs = await live.store.prefs();
    let allScopes = prefs.allScopes;
    if (typeof filters.allScopes === "boolean" && filters.allScopes !== allScopes) {
      allScopes = filters.allScopes;
      await live.store.savePrefs({ ...prefs, allScopes });
    }
    const scoped = this.d.scoped();
    const open = scoped ? await this.d.openScope() : null;
    const empty = !q.trim();
    if (empty || this.now() - live.memoryAt > MEMORY_FRESH_MS) await this.refreshMemory(live);
    const base = { ok: true as const, query: q, groups: [] as SearchGroup[], counts: EMPTY_COUNTS(), recent: [] as SearchHitView[], partial: false, allScopes };
    if (empty) {
      this.maybeReconcile(live);
      const stored = prefs.recent.flatMap((id) => {
        const s = live.index.stored(id);
        return s ? [{ ...s, score: 0, terms: [] }] : [];
      });
      return { ...base, recent: await this.views(live, stored, open, false), status: live.index.status() };
    }
    const scopes = scoped && !allScopes ? [APP_SCOPE, ...(open ? [open] : [])] : undefined;
    const { hits, partial } = live.index.search(q, { ...(scopes ? { scopes } : {}), references: filters.references !== false, openScope: open, now: this.now() });
    const counts = EMPTY_COUNTS();
    for (const h of hits) counts[h.kind]++;
    const chosen = filters.kind ? hits.filter((h) => h.kind === filters.kind).slice(0, PER_KIND) : KINDS.flatMap((k) => hits.filter((h) => h.kind === k).slice(0, PER_GROUP));
    const views = await this.views(live, chosen, open, true);
    const groups = KINDS.filter((k) => !filters.kind || k === filters.kind)
      .map((k) => ({ kind: k, total: counts[k], hits: views.filter((v) => v.kind === k) }))
      .filter((g) => g.hits.length > 0);
    return { ...base, groups, counts, partial, status: live.index.status() };
  }

  /** The person opened a result (Enter): it goes first among the recents; a reference folder's file shows in Finder. */
  async opened(raw: unknown): Promise<{ ok: boolean }> {
    const id = isObject(raw) && typeof raw.id === "string" && raw.id.length <= 2000 ? raw.id : null;
    if (!id) return { ok: false };
    const live = await this.ensure();
    const stored = live?.index.stored(id);
    if (!live || !stored) return { ok: false };
    const prefs = await live.store.prefs();
    await live.store.savePrefs({ ...prefs, recent: [id, ...prefs.recent.filter((r) => r !== id)].slice(0, MAX_RECENT) });
    if (stored.kind === "file" && isRefRoot(stored.root) && !isMarkdown(stored.path)) {
      const ref = (await this.d.references()).find((r) => refRoot(r.id) === stored.root);
      if (!ref) return { ok: false };
      return { ok: await this.d.reveal(path.join(ref.path, stored.path), [ref.path]) };
    }
    return { ok: true };
  }

  /** A commit touched `paths` (null: too many, or a restore). Nothing at all until search was first opened (D0). */
  committed(paths: string[] | null): void {
    const live = this.live;
    if (!live) return;
    this.startBuild(live, paths === null ? "full" : new Set(paths));
  }

  /** Settles once no build runs (tests, and a measured build). */
  async whenIdle(): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const b = this.live?.building;
      if (!b) return;
      await b.done;
      await new Promise((r) => setImmediate(r));
    }
  }

  /** On quit (§4.1 "once more on quit"): the build stops, the snapshot is written. */
  async flush(): Promise<void> {
    const live = this.live;
    if (!live) return;
    live.building?.stop();
    await live.store.flush();
  }

  /** The folder moved (plan deviation 2): the old base's index goes; the next ⌘K rebuilds. */
  async discard(base: string): Promise<void> {
    if (this.live?.base === base) {
      this.live.building?.stop();
      this.live = null;
    }
    await new IndexStore(searchDir(this.d.userData(), base)).discard();
  }
}
```

- [ ] **Step 5: Run the test to see it pass, and typecheck**

Run: `corepack pnpm vitest run packages/shell/test/search-service.test.ts && corepack pnpm typecheck`
Expected: PASS; clean. If "reconciles on open at most once per 60 s" counts one call too many, check that a freshly built index sets `reconciledAt` when its first full build starts (`startBuild(live, "full")`).

- [ ] **Step 6: Commit**

```bash
git add packages/shell
git commit -m "feat(shell): the search service: lazy index, updates, snippets, recents

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 13: Channels, preload and main wiring

**Files:**
- Create: `packages/shell/src/main/search/ipc.ts`, `packages/shell/src/preload/search.ts`
- Modify: `packages/protocol/src/channels.ts`, `packages/protocol/src/client.ts`, `packages/shell/src/preload/index.ts`, `packages/shell/src/main/index.ts`, `packages/ui/test/fake-client.ts`
- Test: `packages/shell/test/search-ipc.test.ts`, `packages/shell/test/search-preload.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/shell/test/search-ipc.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { searchHandlers } from "../src/main/search/ipc";
import type { SearchService } from "../src/main/search/service";

const svc = (o: Partial<SearchService> = {}) => ({ query: vi.fn(async () => ({ ok: true })), opened: vi.fn(async () => ({ ok: true })), ...o }) as unknown as SearchService;

describe("search handlers (§9)", () => {
  it("cleans the window's input before it reaches the service", async () => {
    const s = svc();
    const h = searchHandlers(s);
    await h["hh:search"](42, { kind: "bogus", allScopes: "yes", references: false, extra: 1 });
    expect(s.query).toHaveBeenCalledWith("", { references: false });
    await h["hh:search"]("x".repeat(500), { kind: "note", allScopes: true });
    expect(s.query).toHaveBeenLastCalledWith("x".repeat(200), { kind: "note", allScopes: true });
  });

  it("answers a failure as data", async () => {
    const h = searchHandlers(svc({ query: vi.fn(async () => Promise.reject(new Error("boom"))), opened: vi.fn(async () => Promise.reject(new Error("boom"))) } as never));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await h["hh:search"]("x", {})).toEqual({ ok: false, reason: "failed" });
    expect(await h["hh:searchOpen"]({ id: "a" })).toEqual({ ok: false });
    log.mockRestore();
  });
});
```

`packages/shell/test/search-preload.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { searchClient } from "../src/preload/search";

describe("client.search (preload)", () => {
  it("passes filters (always an object) and checks answers", async () => {
    const invoke = vi.fn(async (channel: string) => (channel === "hh:search" ? { ok: true, groups: [] } : "junk"));
    const c = searchClient(invoke, () => () => {});
    expect(await c.query("x")).toMatchObject({ ok: true });
    expect(invoke).toHaveBeenCalledWith("hh:search", "x", {});
    expect(await c.opened({ id: "a" } as never)).toEqual({ ok: false });
  });

  it("a rejected or shapeless answer is failed", async () => {
    const c = searchClient(vi.fn(async () => Promise.reject(new Error("x"))), () => () => {});
    expect(await c.query("x")).toEqual({ ok: false, reason: "failed" });
  });

  it("status pushes are shape-checked; open reaches every listener", () => {
    let push: (v: unknown) => void = () => {};
    const c = searchClient(vi.fn(), (_channel, l) => ((push = l), () => {}));
    const heard: unknown[] = [];
    c.onStatus((s) => heard.push(s));
    push({ state: "ready", done: 1, total: 1 });
    push("junk");
    expect(heard).toEqual([{ state: "ready", done: 1, total: 1 }]);
    const opened: (string | undefined)[] = [];
    const off = c.onOpen((q) => opened.push(q));
    c.open("guide");
    c.open();
    off();
    c.open("later");
    expect(opened).toEqual(["guide", undefined]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/shell/test/search-ipc.test.ts packages/shell/test/search-preload.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Add the channels to the table**

`packages/protocol/src/channels.ts`: add `SearchClient` to the `./client` type import and `SearchStatus` to the `./views` type import. In `Invoke`, after `"hh:contextInclude"`:

```ts
  /** `filters` always goes (`{}` when the window gave none). */
  "hh:search": (query: string, filters: SearchFilters) => SearchAnswer;
  "hh:searchOpen": SearchClient["opened"];
```

(add `SearchAnswer, SearchFilters` to the `./views` import too). In `Push`, after `"hh:context"`:

```ts
  "hh:searchStatus": SearchStatus;
```

- [ ] **Step 4: Give `HarnessClient` its `search`**

`packages/protocol/src/client.ts`, in `HarnessClient` after `context: ContextClient;`:

```ts
  /** Global search (search spec §9). Nothing is built until the first `query` (D8). */
  search: SearchClient;
```

- [ ] **Step 5: Write `ipc.ts`**

```ts
import type { SearchFilters } from "@humanharness/protocol";
import { SEARCH_KINDS } from "@humanharness/protocol";
import type { InvokeChannel } from "@humanharness/protocol/channels";
import { MAX_QUERY_CHARS } from "@humanharness/search";
import type { SearchService } from "./service";

export const SEARCH_CHANNELS = ["hh:search", "hh:searchOpen"] as const satisfies readonly InvokeChannel[];
export type SearchChannel = (typeof SEARCH_CHANNELS)[number];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Only the known fields of the right kind; the rest is dropped (renderer input is untrusted). */
function cleanFilters(v: unknown): SearchFilters {
  if (!isObject(v)) return {};
  const kind = SEARCH_KINDS.find((k) => k === v.kind);
  return {
    ...(kind ? { kind } : {}),
    ...(typeof v.allScopes === "boolean" ? { allScopes: v.allScopes } : {}),
    ...(typeof v.references === "boolean" ? { references: v.references } : {}),
  };
}

/** `hh:search` and `hh:searchOpen` (§9). Every answer is data; a throw is a bug, logged, answered as a failure. */
export function searchHandlers(svc: SearchService): Record<SearchChannel, (...args: unknown[]) => Promise<unknown>> {
  const call = (fn: () => Promise<unknown>, failed: unknown): Promise<unknown> =>
    Promise.resolve()
      .then(fn)
      .catch((err: unknown) => {
        console.error("A search call failed", err instanceof Error ? err.message : "unknown error");
        return failed;
      });
  return {
    "hh:search": (query, filters) => call(() => svc.query(typeof query === "string" ? query.slice(0, MAX_QUERY_CHARS) : "", cleanFilters(filters)), { ok: false, reason: "failed" }),
    "hh:searchOpen": (hit) => call(() => svc.opened(hit), { ok: false }),
  };
}
```

- [ ] **Step 6: Write the preload's `search.ts`**

```ts
import type { SearchAnswer, SearchClient, SearchStatus } from "@humanharness/protocol";
import type { PushChannel } from "@humanharness/protocol/channels";
import type { Invoke } from "./context";

type Subscribe = (channel: PushChannel, listener: (value: unknown) => void) => () => void;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `client.search` (search spec §9): every answer is data, a rejected invoke included. `open` stays in the window. */
export function searchClient(invoke: Invoke, subscribe: Subscribe): SearchClient {
  const failed = { ok: false as const, reason: "failed" as const };
  const openers = new Set<(query?: string) => void>();
  return {
    query: (query, filters) =>
      invoke("hh:search", query, filters ?? {}).then(
        (v) => (isObject(v) && typeof v.ok === "boolean" ? (v as SearchAnswer) : failed),
        () => failed,
      ),
    opened: (hit) =>
      invoke("hh:searchOpen", hit).then(
        (v) => ({ ok: isObject(v) && v.ok === true }),
        () => ({ ok: false }),
      ),
    onStatus: (listener) =>
      subscribe("hh:searchStatus", (v) => {
        if (isObject(v) && typeof v.state === "string" && typeof v.done === "number" && typeof v.total === "number") listener(v as unknown as SearchStatus);
      }),
    open: (query) => {
      for (const l of openers) l(typeof query === "string" ? query : undefined);
    },
    onOpen: (listener) => {
      openers.add(listener);
      return () => void openers.delete(listener);
    },
  };
}
```

`packages/shell/src/preload/index.ts`: `import { searchClient } from "./search";` and, after the `context: { … },` entry:

```ts
  // Global search (search spec §9): every answer is data; main builds nothing until the first query (D8).
  search: searchClient(looseInvoke, subscribe),
```

- [ ] **Step 7: Wire main**

In `packages/shell/src/main/index.ts`:

1. Imports, beside the other `./…` imports:

```ts
import { APP_SCOPE, MAIN_SCOPE, type SearchDoc, actionDocs, openTaskDoc, pastTaskDocs } from "@humanharness/search";
import { searchHandlers } from "./search/ipc";
import { workerBuild } from "./search/runner";
import { SearchService } from "./search/service";
```

2. After `const contextSvc = new ContextService({ … });`:

```ts
/** What search finds among the tasks, built when the palette opens (search spec §4.2): actions, the open task, past tasks. */
async function searchMemory(): Promise<SearchDoc[]> {
  const scopeOf = (s: string | undefined) => (scoped() ? (s ?? APP_SCOPE) : MAIN_SCOPE);
  const view = await tasks.view();
  const actions = actionDocs(
    Object.entries(harness.actions).map(([id, a]) => ({
      id,
      label: a.label,
      ...(a.description ? { description: a.description } : {}),
      ...(a.tier ? { tier: a.tier } : {}),
      ...(view.actions[id] ? { status: view.actions[id] } : {}),
      scope: scopeOf(undefined),
    })),
  );
  const current = view.current;
  const label = (id: string | null | undefined) => (id && Object.hasOwn(harness.actions, id) ? harness.actions[id].label : undefined);
  const open = current && label(current.action) ? [openTaskDoc({ id: current.id, title: label(current.action)!, scope: scopeOf(current.scope), at: 0 })] : [];
  const history = await currentHistory();
  const rows = history ? historyView(await history.tasks()) : [];
  const past = pastTaskDocs(
    rows.flatMap((r) => {
      const title = r.noteTitle ?? label(r.actionId);
      return r.taskId && r.taskId !== current?.id && title ? [{ id: r.taskId, title, scope: scopeOf(r.scopeId), at: Date.parse(r.date) || 0 }] : [];
    }),
  );
  return [...actions, ...open, ...past];
}

/** Global search (search spec): nothing is read, written or started until the window first asks (D0, D8). */
const searchSvc = new SearchService({
  userData: () => app.getPath("userData"),
  base: async () => {
    const c = await validConfig();
    return c ? baseOf(c) : null;
  },
  scoped,
  openScope: () => tasks.currentScope(),
  scopeTitles: async () => new Map((await scopesView()).list.map((s) => [s.id, s.title])),
  references: async () => {
    const c = await validConfig();
    return c ? (await workReferences(c, baseOf(c))).map((r) => ({ id: r.id, label: r.label, path: r.path })) : [];
  },
  memory: () => searchMemory(),
  extraDenied: async () => {
    // Same rule as the history's ignore list: the engine's instructions file is the app's, not the person's.
    const c = await validConfig();
    const extra = c ? getEngine(c.engineId).instructionsFile?.path : undefined;
    return extra ? [extra] : [];
  },
  status: (s) => sendToWindow("hh:searchStatus", s),
  runner: workerBuild({ entry: path.join(here, "search-worker.js") }),
  reveal: (file, roots) => revealIfStillSafe(file, roots, (p) => shell.showItemInFolder(p)),
});
```

`validConfig()` is null until the app is set up; then no file is extra-denied (the service answers `not-ready` anyway).

3. In the commit announcer (`const commitAnnouncements = commitAnnouncer((paths) => { … })`), add as its last line:

```ts
  // Search (D0): a no-op until the palette first opened; then the commit's paths are read again.
  searchSvc.committed(paths);
```

4. In `afterRestore()`, add: `searchSvc.committed(null);` (a restore reconciles the whole folder, §4.2).

5. In `registerIpc()`, after `handleAll(contextHandlers(contextSvc));`: `handleAll(searchHandlers(searchSvc));`

6. In the `hh:moveFolder` handler, right after `dropDataStoresUnder(c.folder);` (that line runs only once `result.ok`, past the `if (!result.ok) return …`):

```ts
    // Search's indexes are caches keyed by the base (plan deviation 2): the old ones go, the next ⌘K rebuilds.
    // `c` is the config from before the move, so these are the old bases; the profile ids did not change.
    const oldBases = people ? (await profileIds()).map((id) => profileDir(c.folder, id)) : [c.folder];
    for (const b of oldBases) void searchSvc.discard(b).catch((err: unknown) => console.error("Could not drop the old search index", err));
```

Nothing is added before `moving = run;`: the busy check and `moving = run` stay with no `await` between them.

7. In `before-quit`, after `await flushFileIndexes();`: `await searchSvc.flush().catch(() => undefined);`

- [ ] **Step 8: Give the ui's fake client a `search`**

`packages/ui/test/fake-client.ts`: import `SearchAnswer, SearchClient, SearchFilters, SearchHitView, SearchStatus` from `../src/client`, and add to `FakeClient`:

```ts
  /** What `search.query` answers, by query; anything else answers an empty ok. */
  searchAnswers: Record<string, SearchAnswer> = {};
  searchCalls: { query: string; filters?: SearchFilters }[] = [];
  searchOpened: SearchHitView[] = [];
  private searchOpeners = new Set<(query?: string) => void>();
  private searchStatusListeners = new Set<(s: SearchStatus) => void>();
  readonly search: SearchClient = {
    query: async (query, filters) => {
      this.searchCalls.push({ query, ...(filters ? { filters } : {}) });
      return (
        this.searchAnswers[query] ?? {
          ok: true,
          query,
          groups: [],
          counts: { task: 0, note: 0, file: 0 },
          recent: [],
          partial: false,
          status: { state: "ready", done: 0, total: 0 },
          allScopes: false,
        }
      );
    },
    opened: async (hit) => {
      this.searchOpened.push(hit);
      return { ok: true };
    },
    onStatus: (l) => {
      this.searchStatusListeners.add(l);
      return () => void this.searchStatusListeners.delete(l);
    },
    open: (query) => {
      for (const l of this.searchOpeners) l(query);
    },
    onOpen: (l) => {
      this.searchOpeners.add(l);
      return () => void this.searchOpeners.delete(l);
    },
  };
  searchStatusEmit(s: SearchStatus): void {
    for (const l of this.searchStatusListeners) l(s);
  }
```

`ui/src/client.ts` re-exports all of `@humanharness/protocol`, so the types are there.

- [ ] **Step 9: Run the tests, the channel test, typecheck and build**

Run: `corepack pnpm vitest run packages/shell/test/search-ipc.test.ts packages/shell/test/search-preload.test.ts packages/protocol && corepack pnpm typecheck && corepack pnpm app:build`
Expected: PASS (the channel test sees `hh:search`, `hh:searchOpen` handled in main and used by the preload, and `hh:searchStatus` sent by main and subscribed by the preload); clean; build ok.

- [ ] **Step 10: Run the shell and ui suites (D0: nothing else changes)**

Run: `corepack pnpm vitest run packages/shell packages/ui`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/protocol packages/shell packages/ui/test/fake-client.ts
git commit -m "feat(shell): search channels, preload client and main wiring

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 14: The security test (§12 "Security")

**Files:**
- Test: `packages/shell/test/search-security.test.ts`

- [ ] **Step 1: Write the test**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inProcessBuild } from "../src/main/search/runner";
import { SearchService } from "../src/main/search/service";

const SECRETS = [`sk-${"Z".repeat(45)}`, `ghp_${"Q".repeat(36)}`, "AKIAQWERTYUIOPASDFGH", "-----BEGIN OPENSSH PRIVATE KEY-----", "OUTSIDE_SECRET_MARKER", "dotenv-password-value"];

let tmp: string;
let base: string;
let userData: string;
const put = (rel: string, text: string, root = base) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-sec-"));
  base = path.join(tmp, "Work");
  userData = path.join(tmp, "userData");
  put(".env", `PASSWORD=dotenv-password-value\nKEY=${SECRETS[0]}`);
  put("id_ed25519", `${SECRETS[3]}\nabc`);
  put("config/prod.key", "dotenv-password-value");
  put(".harness/notes/n.md", `---\ntitle: Tokens\n---\nbudget plan\nuse ${SECRETS[1]} for the bot`);
  put("docs/keys.txt", `${SECRETS[2]}\nharmless words`);
  put(".git/config", "dotenv-password-value");
  put("outside/secret.md", "OUTSIDE_SECRET_MARKER", tmp);
  fs.symlinkSync(path.join(tmp, "outside", "secret.md"), path.join(base, "link.md"));
  // A SecretStore-like folder beside the person's folder: outside the base, never walked.
  put("secrets/key", SECRETS[0], path.join(tmp, "humanharness"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("search never indexes or shows a secret (§8)", () => {
  it("not in the snapshot, not in any answer, not in the logs", async () => {
    const logs: string[] = [];
    const spies = (["error", "warn", "log", "info"] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" "))));
    try {
      const svc = new SearchService({
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
        reveal: async () => true,
        storeDelayMs: 1,
      });
      await svc.query("", {});
      await svc.whenIdle();
      const answers = [];
      for (const q of ["sk", "ghp", "akia", "outside", "password", "dotenv", "private", "budget", "harmless", "keys", "link", "env", "id_ed25519", "prod"]) answers.push(await svc.query(q, {}));
      await svc.flush();
      const dir = path.join(userData, "search", fs.readdirSync(path.join(userData, "search"))[0]);
      const disk = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
      // Each answer echoes its query; the check is on what the index returned, not on what was typed.
      const shown = JSON.stringify(answers.map((a) => (a.ok ? { ...a, query: "" } : a)));
      for (const s of SECRETS) {
        expect(disk.toLowerCase()).not.toContain(s.toLowerCase());
        expect(shown.toLowerCase()).not.toContain(s.toLowerCase());
        expect(logs.join("\n").toLowerCase()).not.toContain(s.toLowerCase());
      }
      // Denied names are not even indexed by name; the secret-shaped file by name only; the note without its line.
      for (const name of [".env", "id_ed25519", "prod.key"]) expect(shown).not.toContain(name);
      expect(shown).toContain("keys.txt");
      expect(shown).not.toContain("harmless");
      expect(shown).toContain("budget");
      // The link: its own name only, never its target.
      expect(shown).toContain("link.md");
      expect(shown).not.toContain(path.join(tmp, "outside"));
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});
```

The `harmless` check: `docs/keys.txt` is secret-shaped, so its text never enters the index; the query `harmless` finds nothing and no snippet of it is ever read.

- [ ] **Step 2: Run it**

Run: `corepack pnpm vitest run packages/shell/test/search-security.test.ts`
Expected: PASS. If it fails, the fix is in `deny.ts`, `secrets.ts`, `build.ts` or `service.ts`'s `snippet`; never loosen the test.

- [ ] **Step 3: Commit**

```bash
git add packages/shell/test/search-security.test.ts
git commit -m "test(shell): search never indexes, shows or logs a secret

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---
### Task 15: The palette's pure model, the ⌘Enter text and the strings

**Files:**
- Create: `packages/ui/src/search/intent.ts`, `packages/ui/src/search/model.ts`, `packages/ui/src/search/ask.ts`
- Modify: `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/search-model.test.ts`

- [ ] **Step 1: Add the strings**

`packages/i18n/src/locales/en.json`: add as the last top-level key (a comma after the current last one):

```json
  "search": {
    "title": "Search",
    "label": "Search tasks, notes and files",
    "placeholder": "Search tasks, notes and files…",
    "results": "Results",
    "filters": "Filters",
    "all": "All",
    "kind": { "task": "Tasks", "note": "Notes", "file": "Files" },
    "recent": "Recent",
    "allScopes": "All {{plural}}",
    "references": "Reference folders",
    "count_one": "{{count}} result",
    "count_other": "{{count}} results",
    "none": "Nothing found for “{{query}}”.",
    "empty": "Type to search. {{mod}}Enter asks the AI.",
    "partial": "Showing partial matches",
    "indexingNames": "Indexing file names…",
    "indexing": "Indexing… {{done}} of {{total}}",
    "truncated": "Some files aren't searched: the folder is too large",
    "notReady": "Search works once the app is set up.",
    "failed": "Search didn't work this time. Try again.",
    "readOnly": "{{folder}} · read only",
    "where": "Searching in {{name}}",
    "whereScope": "{{scope}} + app",
    "keys": { "move": "↑↓ to move", "open": "Enter to open", "ask": "{{mod}}Enter to ask the AI", "close": "Esc to close" },
    "status": { "not-started": "not started", "done": "done", "unsaved": "not saved", "unfinished": "unfinished", "open": "open now", "past": "past task" },
    "role": { "user": "You", "assistant": "AI" },
    "ask": { "related": "Possibly related: {{list}}.", "note": "note \"{{title}}\"", "task": "task \"{{title}}\"" }
  }
```

- [ ] **Step 2: Write the failing test**

`packages/ui/test/search-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createI18n } from "@humanharness/i18n";
import type { SearchAnswer, SearchHitView } from "../src/client";
import { questionText } from "../src/search/ask";
import { chipsOf, rowsOf, sectionsOf, step } from "../src/search/model";

const hit = (id: string, hint: SearchHitView["hint"]): SearchHitView => ({ id, kind: "file", title: [{ text: id }], context: [], hint, target: { kind: "timeline", path: id } });
const ok = (o: Partial<Extract<SearchAnswer, { ok: true }>>): SearchAnswer => ({ ok: true, query: "q", groups: [], counts: { task: 0, note: 0, file: 0 }, recent: [], partial: false, status: { state: "ready", done: 0, total: 0 }, allScopes: false, ...o });

describe("the palette's model", () => {
  it("an empty query shows the recents; a query its groups in order", () => {
    expect(sectionsOf(ok({ query: "", recent: [hit("a", null)] })).map((s) => s.key)).toEqual(["recent"]);
    const a = ok({ groups: [{ kind: "task", total: 1, hits: [hit("t", null)] }, { kind: "file", total: 9, hits: [hit("f", null)] }] });
    expect(sectionsOf(a).map((s) => s.key)).toEqual(["task", "file"]);
    expect(rowsOf(sectionsOf(a)).map((h) => h.id)).toEqual(["t", "f"]);
    expect(sectionsOf({ ok: false, reason: "failed" })).toEqual([]);
  });

  it("chips: All with the sum, then each kind with matches", () => {
    expect(chipsOf(ok({ counts: { task: 2, note: 0, file: 7 } }))).toEqual([
      { kind: null, count: 9 },
      { kind: "task", count: 2 },
      { kind: "file", count: 7 },
    ]);
    expect(chipsOf(ok({ query: "" }))).toEqual([]);
  });

  it("moves stay inside the list", () => {
    expect(step(0, -1, 3)).toBe(0);
    expect(step(2, 1, 3)).toBe(2);
    expect(step(1, 1, 3)).toBe(2);
    expect(step(5, 1, 0)).toBe(0);
  });
});

describe("questionText (§5.4)", () => {
  it("the query, then up to three hints: paths in code, notes and tasks by title; never a hintless row", async () => {
    const { t } = await createI18n("en");
    const hits = [hit("a", { kind: "task", text: "The turn" }), hit("b", null), hit("c", { kind: "path", text: "docs/architecture/context.md" }), hit("d", { kind: "note", text: "Engines" }), hit("e", { kind: "name", text: "x.md" })];
    expect(questionText("  context  ", hits, t)).toBe('context\n\nPossibly related: task "The turn", `docs/architecture/context.md`, note "Engines".');
    expect(questionText("context", [], t)).toBe("context");
    expect(questionText("   ", hits, t)).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `corepack pnpm vitest run packages/ui/test/search-model.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Write `intent.ts`, `model.ts`, `ask.ts`**

`packages/ui/src/search/intent.ts`:

```ts
import type { SearchTarget } from "../client";

/** What the window does with a result (search spec §3) or a ⌘Enter question (§5.4). `reveal` is main's alone. */
export type SearchIntent = Exclude<SearchTarget, { kind: "reveal" }> | { kind: "draft"; text: string };
```

`packages/ui/src/search/model.ts`:

```ts
import { SEARCH_KINDS, type SearchAnswer, type SearchHitView, type SearchKind } from "../client";

export interface Section {
  key: SearchKind | "recent";
  hits: SearchHitView[];
}

/** §5.2: nothing typed shows the recents; otherwise the groups in the order main sends them (§3). */
export function sectionsOf(a: SearchAnswer | null): Section[] {
  if (!a?.ok) return [];
  if (!a.query.trim()) return a.recent.length > 0 ? [{ key: "recent", hits: a.recent }] : [];
  return a.groups.map((g) => ({ key: g.kind, hits: g.hits }));
}

/** ↑↓ move across groups: one flat list of rows. */
export const rowsOf = (sections: readonly Section[]): SearchHitView[] => sections.flatMap((s) => s.hits);

/** §5.5: "All · N", then one chip per kind that has results. `kind` null: All. */
export interface Chip {
  kind: SearchKind | null;
  count: number;
}

export function chipsOf(a: SearchAnswer | null): Chip[] {
  if (!a?.ok || !a.query.trim()) return [];
  const all = SEARCH_KINDS.reduce((n, k) => n + a.counts[k], 0);
  if (all === 0) return [];
  return [{ kind: null, count: all }, ...SEARCH_KINDS.filter((k) => a.counts[k] > 0).map((k) => ({ kind: k, count: a.counts[k] }))];
}

export const step = (i: number, delta: number, length: number): number => (length === 0 ? 0 : Math.min(length - 1, Math.max(0, i + delta)));
```

`packages/ui/src/search/ask.ts`:

```ts
import type { TFunction } from "i18next";
import type { SearchHitView } from "../client";

export const MAX_HINTS = 3;

/**
 * The composer's text for ⌘Enter (§5.4): the query, and a hint block the person sees and may delete before sending.
 * Paths and titles only, never a file's text; a reference file by its name; rows without a hint are skipped.
 */
export function questionText(query: string, hits: readonly SearchHitView[], t: TFunction): string | null {
  const q = query.trim();
  if (!q) return null;
  const named = hits
    .flatMap((h) => (h.hint ? [h.hint] : []))
    .slice(0, MAX_HINTS)
    .map((h) => (h.kind === "path" || h.kind === "name" ? `\`${h.text}\`` : t(h.kind === "note" ? "search.ask.note" : "search.ask.task", { title: h.text })));
  return named.length > 0 ? `${q}\n\n${t("search.ask.related", { list: named.join(", ") })}` : q;
}
```

- [ ] **Step 5: Run the test to see it pass, and the i18n tests**

Run: `corepack pnpm vitest run packages/ui/test/search-model.test.ts packages/i18n`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/search packages/ui/test/search-model.test.ts packages/i18n/src/locales/en.json
git commit -m "feat(ui): the search palette's model, the ask text and its strings

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 16: `SearchPalette` (§5.1–§5.5)

**Files:**
- Create: `packages/ui/src/search/SearchPalette.tsx`
- Modify: `packages/ui/src/styles.css` (append one block)
- Test: `packages/ui/test/search-palette.test.tsx`

- [ ] **Step 1: Write the failing test**

`packages/ui/test/search-palette.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer, SearchHitView } from "../src/client";
import { SearchPalette } from "../src/search/SearchPalette";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const MOD = /Mac/.test(navigator.userAgent) ? { metaKey: true } : { ctrlKey: true };
const hit = (id: string, kind: SearchHitView["kind"], title: string, o: Partial<SearchHitView> = {}): SearchHitView => ({ id, kind, title: [{ text: title }], context: [], hint: null, target: { kind: "timeline", path: title }, ...o });
const answer = (query: string, o: Partial<Extract<SearchAnswer, { ok: true }>> = {}): SearchAnswer => ({ ok: true, query, groups: [], counts: { task: 0, note: 0, file: 0 }, recent: [], partial: false, status: { state: "ready", done: 3, total: 3 }, allScopes: false, ...o });
const CONTEXT = answer("context", {
  groups: [
    { kind: "task", total: 1, hits: [hit("action:t", "task", "Topic 5", { meta: { status: "not-started", tier: "Deep" }, hint: { kind: "task", text: "Topic 5" }, target: { kind: "action", action: "t" } })] },
    { kind: "note", total: 1, hits: [hit("note:e", "note", "Engines", { hint: { kind: "note", text: "Engines" } })] },
    {
      kind: "file",
      total: 2,
      hits: [
        hit("file:g", "file", "guide.md", { context: [{ text: "the " }, { text: "context", mark: true }, { text: " window" }], hint: { kind: "path", text: "docs/guide.md" }, target: { kind: "document", path: "docs/guide.md", anchor: "context-window" } }),
        hit("file:r", "file", "spec.txt", { folder: "Docs", hint: { kind: "name", text: "spec.txt" }, target: { kind: "reveal" } }),
      ],
    },
  ],
  counts: { task: 1, note: 1, file: 2 },
});

async function show(props: Partial<Parameters<typeof SearchPalette>[0]> = {}) {
  const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
  client.searchAnswers.context = CONTEXT;
  const onPick = vi.fn();
  const onAsk = vi.fn();
  const onClose = vi.fn();
  await renderIn("en", <SearchPalette client={client} where="Searching in Demo" references onClose={onClose} onPick={onPick} onAsk={onAsk} {...props} />);
  const dialog = await screen.findByRole("dialog", { name: "Search" });
  const input = within(dialog).getByRole("combobox", { name: "Search tasks, notes and files" });
  return { client, dialog, input, onPick, onAsk, onClose };
}
const typeIn = async (dialog: HTMLElement, input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  return within(dialog).findAllByRole("option");
};

describe("SearchPalette (§5)", () => {
  it("asks for the recents on open, then groups results with chips, counts and marks", async () => {
    const { client, dialog, input } = await show();
    await waitFor(() => expect(client.searchCalls[0]).toEqual({ query: "", filters: {} }));
    expect(document.activeElement).toBe(input);
    await typeIn(dialog, input, "context");
    const list = within(dialog).getByRole("listbox", { name: "Results" });
    expect(within(list).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Tasks", "Notes", "Files"]);
    expect(within(list).getAllByRole("option")).toHaveLength(4);
    expect(within(list).getByText("not started · Deep")).toBeTruthy();
    expect(within(list).getByText("Docs · read only")).toBeTruthy();
    expect(list.querySelector("mark")?.textContent).toBe("context");
    const chips = within(dialog).getByRole("group", { name: "Filters" });
    expect(within(chips).getAllByRole("button").map((b) => b.textContent)).toEqual(["All 4", "Tasks 1", "Notes 1", "Files 2"]);
    expect(screen.getByText("4 results")).toBeTruthy();
    expect(within(dialog).getByText("Searching in Demo")).toBeTruthy();
  });

  it("↑↓ move the active option; Enter opens it; a click opens too", async () => {
    const { dialog, input, onPick } = await show();
    await typeIn(dialog, input, "context");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const options = within(dialog).getAllByRole("option");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[2].id);
    expect(options[2].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ id: "file:g" }));
    fireEvent.click(options[1]);
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ id: "note:e" }));
  });

  it("⌘Enter prepares a question with up to three hints; with nothing typed it does nothing", async () => {
    const { dialog, input, onAsk } = await show();
    fireEvent.keyDown(input, { key: "Enter", ...MOD });
    expect(onAsk).not.toHaveBeenCalled();
    await typeIn(dialog, input, "context");
    fireEvent.keyDown(input, { key: "Enter", ...MOD });
    expect(onAsk).toHaveBeenCalledWith('context\n\nPossibly related: task "Topic 5", note "Engines", `docs/guide.md`.');
  });

  it("⌘2 picks the second chip, which asks again with its kind", async () => {
    const { client, dialog, input } = await show();
    await typeIn(dialog, input, "context");
    fireEvent.keyDown(input, { key: "2", ...MOD });
    await waitFor(() => expect(client.searchCalls.at(-1)).toEqual({ query: "context", filters: { kind: "task" } }));
  });

  it("says partial matches and indexing progress; Escape closes", async () => {
    const { client, dialog, input, onClose } = await show();
    client.searchAnswers.zebra = answer("zebra", { partial: true, status: { state: "building", done: 3, total: 10 }, groups: [{ kind: "note", total: 1, hits: [hit("note:z", "note", "Zebra")] }], counts: { task: 0, note: 1, file: 0 } });
    await typeIn(dialog, input, "zebra");
    expect(within(dialog).getByText("Showing partial matches")).toBeTruthy();
    expect(within(dialog).getByText("Indexing… 3 of 10")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("says when search isn't ready, and when nothing matched", async () => {
    const { client, dialog, input } = await show();
    client.searchAnswers.x = { ok: false, reason: "not-ready" };
    fireEvent.change(input, { target: { value: "x" } });
    expect(await within(dialog).findByText("Search works once the app is set up.")).toBeTruthy();
    fireEvent.change(input, { target: { value: "nothing" } });
    expect(await within(dialog).findByText("Nothing found for “nothing”.")).toBeTruthy();
  });

  it("the scopes and reference folders toggles ask again", async () => {
    const { client, dialog } = await show({ scopesPlural: "topics" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "All topics" }));
    await waitFor(() => expect(client.searchCalls.at(-1)?.filters).toEqual({ allScopes: true }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Reference folders" }));
    await waitFor(() => expect(client.searchCalls.at(-1)?.filters).toEqual({ allScopes: true, references: false }));
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm vitest run packages/ui/test/search-palette.test.tsx`
Expected: FAIL, `Cannot find module '../src/search/SearchPalette'`.

- [ ] **Step 3: Write `SearchPalette.tsx`**

```tsx
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, SearchAnswer, SearchFilters, SearchHitView, SearchKind, SearchMarked, SearchStatus } from "../client";
import { questionText } from "./ask";
import { type Section, chipsOf, rowsOf, sectionsOf, step } from "./model";

const QUERY_DELAY_MS = 80;
const MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
/** "⌘" on macOS, "Ctrl+" elsewhere. */
export const MOD = MAC ? "⌘" : "Ctrl+";
/** ⌘ on macOS, Ctrl elsewhere, not both. */
export const isMod = (e: { metaKey: boolean; ctrlKey: boolean }): boolean => (MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);

function Marked({ parts }: { parts: SearchMarked }) {
  return (
    <>
      {parts.map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

/** Focus stays inside the dialog (§5.1): Tab from the last control goes to the first, and back. */
function trapTab(e: KeyboardEvent, root: HTMLElement | null): void {
  if (!root) return;
  const items = [...root.querySelectorAll<HTMLElement>("input, button")].filter((el) => !el.hasAttribute("disabled"));
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function HitRow({ id, hit, active, onPick, onHover }: { id: string; hit: SearchHitView; active: boolean; onPick: () => void; onHover: () => void }) {
  const { t } = useTranslation();
  const meta = hit.meta
    ? [hit.meta.role ? t(`search.role.${hit.meta.role}`) : null, hit.meta.status ? t(`search.status.${hit.meta.status}`) : null, hit.meta.tier ?? null].filter(Boolean).join(" · ")
    : "";
  return (
    // The input keeps focus (aria-activedescendant): a press on a row never moves it.
    <div id={id} role="option" aria-selected={active} className={active ? "hh-search-row hh-search-row-active" : "hh-search-row"} onMouseDown={(e) => e.preventDefault()} onMouseMove={onHover} onClick={onPick}>
      <span className={`hh-search-icon hh-search-icon-${hit.kind}`} aria-hidden="true" />
      <span className="hh-search-text">
        <span className="hh-search-row-title">
          <Marked parts={hit.title} />
        </span>
        <span className="hh-search-row-context">{hit.context.length > 0 ? <Marked parts={hit.context} /> : meta}</span>
      </span>
      {hit.folder !== undefined && <span className="hh-search-tag">{t("search.readOnly", { folder: hit.folder })}</span>}
      {hit.scope !== undefined && <span className="hh-search-tag">{hit.scope}</span>}
    </div>
  );
}

export interface SearchPaletteProps {
  client: HarnessClient;
  initialQuery?: string;
  /** The footer's "Searching in <harness>" or "<scope> + app". */
  where: string;
  /** A harness with scopes: the "All <plural>" toggle shows (D2). */
  scopesPlural?: string;
  /** A harness with reference folders: their toggle shows, on by default. */
  references: boolean;
  onClose: () => void;
  onPick: (hit: SearchHitView) => void;
  onAsk: (text: string) => void;
}

/** The ⌘K palette (search spec §5): a modal dialog with a combobox over a grouped listbox. Asks main; sends nothing. */
export function SearchPalette({ client, initialQuery = "", where, scopesPlural, references, onClose, onPick, onAsk }: SearchPaletteProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(initialQuery);
  const [kind, setKind] = useState<SearchKind | null>(null);
  /** Null until the person flips it: main's remembered value shows meanwhile. */
  const [allScopes, setAllScopes] = useState<boolean | null>(null);
  const [refs, setRefs] = useState(true);
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  const [status, setStatus] = useState<SearchStatus | null>(null);
  const [active, setActive] = useState(0);
  const asked = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ids = useId();

  useEffect(() => client.search.onStatus(setStatus), [client]);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  // Every change asks again (typing after a short pause); only the latest answer is kept.
  useEffect(() => {
    const n = ++asked.current;
    const filters: SearchFilters = { ...(kind ? { kind } : {}), ...(allScopes !== null ? { allScopes } : {}), ...(refs ? {} : { references: false }) };
    const timer = setTimeout(
      () => {
        void client.search.query(query, filters).then((a) => {
          if (n !== asked.current) return;
          setAnswer(a);
          setActive(0);
          if (a.ok) setStatus(a.status);
        });
      },
      query.trim() ? QUERY_DELAY_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [client, query, kind, allScopes, refs]);

  const sections = sectionsOf(answer);
  const rows = rowsOf(sections);
  const chips = chipsOf(answer);
  const shownAll = allScopes ?? (answer?.ok ? answer.allScopes : false);
  const optionId = (i: number) => `${ids}-o${i}`;
  const typed = query.trim() !== "";

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Tab") trapTab(e, dialogRef.current);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => step(i, e.key === "ArrowDown" ? 1 : -1, rows.length));
    } else if (e.key === "Enter" && isMod(e)) {
      e.preventDefault();
      const text = questionText(query, rows, t);
      if (text) onAsk(text);
    } else if (e.key === "Enter" && e.target === inputRef.current) {
      // Enter on a chip or a toggle presses it; only the input's Enter opens the active row.
      e.preventDefault();
      if (rows[active]) onPick(rows[active]);
    } else if (isMod(e) && /^[1-7]$/.test(e.key)) {
      const chip = chips[Number(e.key) - 1];
      if (chip) {
        e.preventDefault();
        setKind(chip.kind);
      }
    }
  };

  const message = !answer
    ? null
    : !answer.ok
      ? t(answer.reason === "not-ready" ? "search.notReady" : "search.failed")
      : rows.length > 0
        ? null
        : typed
          ? t("search.none", { query: query.trim() })
          : t("search.empty", { mod: MOD });
  const sectionLabel = (key: Section["key"]) => (key === "recent" ? t("search.recent") : t(`search.kind.${key}`));
  let index = 0;

  return (
    <div
      className="hh-search-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={dialogRef} className="hh-search" role="dialog" aria-modal="true" aria-label={t("search.title")} onKeyDown={onKeyDown}>
        <input
          ref={inputRef}
          className="hh-search-input"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={rows.length > 0}
          aria-controls={`${ids}-list`}
          aria-activedescendant={rows[active] ? optionId(active) : undefined}
          aria-label={t("search.label")}
          placeholder={t("search.placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {(chips.length > 0 || scopesPlural || references) && (
          <div className="hh-search-filters" role="group" aria-label={t("search.filters")}>
            {chips.map((c) => (
              <button key={c.kind ?? "all"} type="button" className="hh-search-chip" aria-pressed={kind === c.kind} onClick={() => setKind(c.kind)}>
                {c.kind ? t(`search.kind.${c.kind}`) : t("search.all")} <span className="hh-search-chip-count">{c.count}</span>
              </button>
            ))}
            {scopesPlural && (
              <label className="hh-search-toggle">
                <input type="checkbox" checked={shownAll} onChange={(e) => setAllScopes(e.target.checked)} /> {t("search.allScopes", { plural: scopesPlural })}
              </label>
            )}
            {references && (
              <label className="hh-search-toggle">
                <input type="checkbox" checked={refs} onChange={(e) => setRefs(e.target.checked)} /> {t("search.references")}
              </label>
            )}
          </div>
        )}
        {status && (status.state === "names" || status.state === "building") && (
          <p className="hh-search-note" role="status">
            {status.state === "building" ? t("search.indexing", { done: status.done, total: status.total }) : t("search.indexingNames")}
          </p>
        )}
        {status?.truncated && <p className="hh-search-note">{t("search.truncated")}</p>}
        {answer?.ok && answer.partial && <p className="hh-search-note">{t("search.partial")}</p>}
        <div id={`${ids}-list`} className="hh-search-list" role="listbox" aria-label={t("search.results")}>
          {sections.map((s) => (
            <div key={s.key} role="group" aria-label={sectionLabel(s.key)} className="hh-search-section">
              <div className="hh-search-section-label" aria-hidden="true">
                {sectionLabel(s.key)}
              </div>
              {s.hits.map((hit) => {
                const i = index++;
                return <HitRow key={hit.id} id={optionId(i)} hit={hit} active={i === active} onPick={() => onPick(hit)} onHover={() => setActive(i)} />;
              })}
            </div>
          ))}
        </div>
        {message && <p className="hh-search-empty">{message}</p>}
        <div className="hh-sr-only" aria-live="polite">
          {answer?.ok && typed ? t("search.count", { count: rows.length }) : ""}
        </div>
        <div className="hh-search-footer">
          <span>{t("search.keys.move")}</span>
          <span>{t("search.keys.open")}</span>
          <span>{t("search.keys.ask", { mod: MOD })}</span>
          <span>{t("search.keys.close")}</span>
          <span className="hh-search-where">{where}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Append the palette's styles**

At the end of `packages/ui/src/styles.css` (tokens only, as the file's first line asks):

```css
/* ---- Search palette (search spec §5; packages/ui/src/search). One block: the UI refresh moves it as a unit. ---- */
.hh-search-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 12vh 16px 16px;
  background: var(--hh-backdrop);
}
.hh-search {
  width: min(640px, 100%);
  max-height: 72vh;
  display: flex;
  flex-direction: column;
  background: var(--hh-surface);
  color: var(--hh-ink);
  border: 1px solid var(--hh-line-strong);
  border-radius: 12px;
  box-shadow: 0 12px 40px var(--hh-backdrop);
  overflow: hidden;
}
.hh-search-input {
  border: 0;
  border-bottom: 1px solid var(--hh-line);
  padding: 14px 16px;
  font: inherit;
  font-size: 1.05rem;
  background: transparent;
  color: var(--hh-ink);
  outline: none;
}
.hh-search-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--hh-line);
}
.hh-search-chip {
  border: 1px solid var(--hh-line-strong);
  border-radius: 999px;
  padding: 2px 10px;
  background: var(--hh-sheet);
  color: var(--hh-slate);
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
.hh-search-chip[aria-pressed="true"] {
  background: var(--hh-ink);
  color: var(--hh-on-ink);
  border-color: var(--hh-ink);
}
.hh-search-chip-count {
  opacity: 0.7;
}
.hh-search-toggle {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  font-size: 0.85rem;
  color: var(--hh-muted);
}
.hh-search-note,
.hh-search-empty {
  margin: 0;
  padding: 8px 16px;
  font-size: 0.85rem;
  color: var(--hh-muted);
}
.hh-search-list {
  overflow-y: auto;
  padding: 4px 0;
}
.hh-search-section-label {
  padding: 8px 16px 4px;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--hh-muted);
}
.hh-search-row {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 6px 16px;
  cursor: pointer;
}
.hh-search-row-active {
  background: var(--hh-segment);
}
.hh-search-icon {
  width: 16px;
  height: 16px;
  flex: none;
  border-radius: 4px;
  background: var(--hh-line-strong);
}
.hh-search-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.hh-search-row-title,
.hh-search-row-context {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hh-search-row-context {
  font-size: 0.85rem;
  color: var(--hh-muted);
}
.hh-search mark {
  background: var(--hh-highlight);
  color: inherit;
}
.hh-search-tag {
  flex: none;
  font-size: 0.75rem;
  color: var(--hh-muted);
  border: 1px solid var(--hh-line);
  border-radius: 999px;
  padding: 0 8px;
}
.hh-search-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 8px 16px;
  border-top: 1px solid var(--hh-line);
  font-size: 0.75rem;
  color: var(--hh-muted);
}
.hh-search-where {
  margin-left: auto;
}
/* A chat entry opened from search is highlighted for 2 s (§3). */
.hh-search-flash {
  background: var(--hh-highlight);
  transition: background 0.4s;
}
```

- [ ] **Step 5: Run the test to see it pass, and typecheck**

Run: `corepack pnpm vitest run packages/ui/test/search-palette.test.tsx && corepack pnpm typecheck`
Expected: PASS; clean.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/search/SearchPalette.tsx packages/ui/src/styles.css packages/ui/test/search-palette.test.tsx
git commit -m "feat(ui): the search palette: grouped results, keys, filters, ask

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 17: ⌘K, `client.search.open()`, and opening results in the window

**Files:**
- Create: `packages/ui/src/search/SearchHost.tsx`
- Modify: `packages/ui/src/HarnessApp.tsx`, `packages/ui/src/ChatView.tsx`, `packages/ui/src/HistoryPanel.tsx`
- Test: `packages/ui/test/search-host.test.tsx`, `packages/ui/test/history-panel.test.tsx` (one case)

- [ ] **Step 1: Write the failing tests**

`packages/ui/test/search-host.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp } from "../src";
import type { SearchAnswer, SearchHitView } from "../src/client";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const MOD = /Mac/.test(navigator.userAgent) ? { metaKey: true } : { ctrlKey: true };
const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const DOC: SearchHitView = {
  id: "file:folder/docs/guide.md",
  kind: "file",
  title: [{ text: "guide.md" }],
  context: [{ text: "the " }, { text: "context", mark: true }],
  hint: { kind: "path", text: "docs/guide.md" },
  target: { kind: "document", path: "docs/guide.md", anchor: "setup" },
};
const ANSWER: SearchAnswer = { ok: true, query: "guide", groups: [{ kind: "file", total: 1, hits: [DOC] }], counts: { task: 0, note: 0, file: 1 }, recent: [], partial: false, status: { state: "ready", done: 1, total: 1 }, allScopes: false };

function setup() {
  const client = new FakeClient(ready);
  client.searchAnswers.guide = ANSWER;
  client.docTexts["docs/guide.md"] = "# Guide\n\n## Setup\nsteps";
  return client;
}
async function startWork() {
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  await screen.findByPlaceholderText(/Write a message…/);
}

describe("search in the window (§5.1, §3)", () => {
  it("⌘K opens and closes the palette; focus goes back", async () => {
    render(<HarnessApp client={setup()} />);
    await startWork();
    const composer = screen.getByPlaceholderText(/Write a message…/);
    composer.focus();
    fireEvent.keyDown(window, { key: "k", ...MOD });
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    expect(document.activeElement).toBe(within(dialog).getByRole("combobox"));
    fireEvent.keyDown(window, { key: "k", ...MOD });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
    expect(document.activeElement).toBe(composer);
  });

  it("a .md result opens in the reader; main is told it was opened", async () => {
    const client = setup();
    render(<HarnessApp client={client} />);
    await startWork();
    act(() => client.search.open("guide"));
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    fireEvent.click(await within(dialog).findByRole("option"));
    expect(await screen.findByRole("complementary", { name: "Document" })).toBeTruthy();
    expect(client.searchOpened.map((h) => h.id)).toEqual([DOC.id]);
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
  });

  it("from Home, a result goes to the work screen first", async () => {
    const client = setup();
    render(<HarnessApp client={client} />);
    await screen.findByRole("button", { name: "Start Demo" });
    act(() => client.search.open("guide"));
    fireEvent.click(await within(await screen.findByRole("dialog", { name: "Search" })).findByRole("option"));
    expect(await screen.findByRole("complementary", { name: "Document" })).toBeTruthy();
  });

  it("⌘Enter fills the composer and sends nothing (D3)", async () => {
    const client = setup();
    render(<HarnessApp client={client} />);
    await startWork();
    act(() => client.search.open("guide"));
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    await within(dialog).findByRole("option");
    fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Enter", ...MOD });
    const composer = (await screen.findByPlaceholderText(/Write a message…/)) as HTMLTextAreaElement;
    await waitFor(() => expect(composer.value).toBe("guide\n\nPossibly related: `docs/guide.md`."));
    expect(client.sent).toEqual([]);
  });

  it("a chat entry not on screen opens the History panel at its task", async () => {
    const client = setup();
    client.searchAnswers.old = { ...ANSWER, query: "old", groups: [{ kind: "task", total: 1, hits: [{ ...DOC, id: "chat:x#e1", kind: "task", hint: null, target: { kind: "chat", entry: "e1", scope: "main", task: "t1" } }] }], counts: { task: 1, note: 0, file: 0 } };
    render(<HarnessApp client={client} />);
    await startWork();
    act(() => client.search.open("old"));
    fireEvent.click(await within(await screen.findByRole("dialog", { name: "Search" })).findByRole("option"));
    expect(await screen.findByRole("heading", { name: "History" })).toBeTruthy();
  });
});
```

If the History panel's heading is not a `heading` role named "History" in `HistoryPanel.tsx`, use the panel's own accessible name as `history-panel.test.tsx` does.

In `packages/ui/test/history-panel.test.tsx`, add:

```tsx
  it("opens at the task search asked for (search spec §3)", async () => {
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    const g = (taskId: string, date: string) => ({ taskId, actionId: null, start: null, end: `e-${taskId}`, date, changes: [], entries: [{ sha: `e-${taskId}`, message: "Turn: hi", date }] });
    client.historyGroups = [g("t2", "2026-10-10T12:00:00.000Z"), g("t1", "2026-10-09T12:00:00.000Z")];
    await renderIn("en", <HistoryPanel client={client} actions={{}} onClose={() => {}} openTask="t1" />);
    await waitFor(() => expect(screen.getAllByRole("button", { expanded: true }).map((b) => b.getAttribute("aria-controls"))).toEqual(["hh-history-t1"]));
  });
```

(Use the file's existing imports; add `FakeClient`/`renderIn`/`HistoryPanel` imports only if missing.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/ui/test/search-host.test.tsx packages/ui/test/history-panel.test.tsx`
Expected: FAIL: no dialog on ⌘K; `openTask` is not a prop.

- [ ] **Step 3: `HistoryPanel` takes `openTask`**

In `packages/ui/src/HistoryPanel.tsx`, add to the props (destructuring and type):

```ts
  /** Search opened a past task (search spec §3): its row starts open and scrolls into view instead of the newest. */
  openTask?: string;
```

and in `loadGroups`, replace `if (first && g[0]) setOpen(new Set([keyOf(g[0])]));` with:

```ts
        // The newest task starts open (what the person most likely wants to undo), or the one search asked for.
        const wanted = openTask ? g.find((x) => x.taskId === openTask) : undefined;
        const start = wanted ?? g[0];
        if (first && start) setOpen(new Set([keyOf(start)]));
        if (first && wanted) requestAnimationFrame(() => document.getElementById(`hh-history-${keyOf(wanted)}`)?.scrollIntoView?.({ block: "nearest" }));
```

- [ ] **Step 4: Write `SearchHost.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppState, HarnessClient, SearchHitView } from "../client";
import type { SearchIntent } from "./intent";
import { SearchPalette, isMod } from "./SearchPalette";

/**
 * ⌘K (Ctrl+K off macOS) anywhere in the window, and `client.search.open()` (the top bar's button, a harness view):
 * the palette (search spec §5.1). ⌘K again or Esc closes it and gives focus back.
 */
export function SearchHost({ client, state, openScope, onIntent }: { client: HarnessClient; state: AppState; openScope: string | null; onIntent: (intent: SearchIntent) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<{ query: string; n: number } | null>(null);
  const isOpen = useRef(false);
  isOpen.current = open !== null;
  const opener = useRef<HTMLElement | null>(null);
  const opens = useRef(0);
  const [scopeTitle, setScopeTitle] = useState<string | null>(null);

  const show = useCallback((query = "") => {
    const active = document.activeElement;
    if (!isOpen.current) opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setOpen({ query, n: ++opens.current });
  }, []);
  const close = useCallback(() => {
    setOpen(null);
    const back = opener.current;
    opener.current = null;
    if (back?.isConnected) back.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || e.altKey || e.shiftKey || !isMod(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (isOpen.current) close();
      else show();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [show, close]);
  useEffect(() => client.search.onOpen((q) => show(typeof q === "string" ? q : "")), [client, show]);
  // A profile switch closes search (§7).
  const profile = state.config.profile;
  useEffect(() => {
    setOpen(null);
  }, [profile]);
  // "<scope> + app" names the open scope by its title.
  const shown = open !== null;
  useEffect(() => {
    if (!shown || !state.scopes || !openScope) return setScopeTitle(null);
    let live = true;
    client.scopes.list().then(
      (list) => {
        if (live) setScopeTitle(list.find((s) => s.id === openScope)?.title ?? openScope);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [client, shown, state.scopes, openScope]);

  if (!open) return null;
  const where = state.scopes && openScope ? t("search.whereScope", { scope: scopeTitle ?? openScope }) : t("search.where", { name: state.harness.name });
  /** A picked result: focus goes to what it opens, not back to the opener. */
  const leave = () => {
    setOpen(null);
    opener.current = null;
  };
  const pick = (hit: SearchHitView) => {
    void client.search.opened(hit);
    leave();
    if (hit.target.kind !== "reveal") onIntent(hit.target);
  };
  return (
    <SearchPalette
      key={open.n}
      client={client}
      initialQuery={open.query}
      where={where}
      {...(state.scopes ? { scopesPlural: state.scopes.plural } : {})}
      references={(state.references?.length ?? 0) > 0}
      onClose={close}
      onPick={pick}
      onAsk={(text) => {
        leave();
        onIntent({ kind: "draft", text });
      }}
    />
  );
}
```

- [ ] **Step 5: Mount it in `HarnessApp`**

In `packages/ui/src/HarnessApp.tsx`:

1. Imports: `import { SearchHost } from "./search/SearchHost";` and `import type { SearchIntent } from "./search/intent";`.
2. Right after `const chatStart = useRef<…>(null);` (before any early `return`):

```ts
  /** The chat's handler for a search result or question (search spec §3); null while the chat isn't on screen. */
  const searchRef = useRef<((intent: SearchIntent) => boolean) | null>(null);
  /** A result picked away from the work screen: it runs once the chat is there. */
  const pendingIntent = useRef<SearchIntent | null>(null);
  useEffect(() => {
    if (screen !== "work" || !pendingIntent.current || !searchRef.current) return;
    const intent = pendingIntent.current;
    pendingIntent.current = null;
    searchRef.current(intent);
  });
```

3. After `const newTask = …;`:

```ts
  /** A result or a ⌘Enter question: Settings closes, the work screen shows, the chat does the rest. */
  const searchIntent = (intent: SearchIntent) => {
    setSettings(null);
    if (screen === "work" && searchRef.current) {
      searchRef.current(intent);
      return;
    }
    if (!configured) return;
    pendingIntent.current = intent;
    setScreen("work");
  };
```

4. On `<ChatView …>` add the prop `searchRef={searchRef}`.
5. After the `{settings && ( <SettingsSheet … /> )}` block, inside `I18nextProvider`:

```tsx
      {/* ⌘K (search spec §5.1): outside the screen, so it works over Settings too. */}
      <SearchHost client={client} state={state} openScope={openScope} onIntent={searchIntent} />
```

- [ ] **Step 6: `ChatView` runs the intents**

In `packages/ui/src/ChatView.tsx`:

1. Import: `import type { SearchIntent } from "./search/intent";`.
2. Props: add `searchRef` to the destructuring and to the props type, beside `startRef`:

```ts
  /** Set by the chat: runs a search result or question (search spec §3); false when it can't here. */
  searchRef?: { current: ((intent: SearchIntent) => boolean) | null };
```

3. Beside `const [showHistory, setShowHistory] = useState(false);`:

```ts
  /** The past task search asked the History panel to open at (search spec §3). */
  const [historyTask, setHistoryTask] = useState<string | undefined>(undefined);
```

4. After the `useLayoutEffect` that sets `startRef.current`:

```ts
  /** A search result or question (search spec §3, §5.4); false when it can't run here. */
  const runSearchIntent = (intent: SearchIntent): boolean => {
    switch (intent.kind) {
      case "action":
        if (!Object.hasOwn(state.actions, intent.action)) return false;
        startTopic(intent.action);
        return true;
      case "open-task":
        if (state.parallel) void client.tasks.focus(intent.task).catch(() => undefined);
        inputRef.current?.focus();
        return true;
      case "history":
        if (slim) return false;
        closeReader();
        setContextOpen(false);
        setNotesPanel(null);
        setTimelineFile(null);
        setHistoryTask(intent.task);
        setShowHistory(true);
        return true;
      case "chat": {
        // On screen: scroll there and highlight it for 2 s. Otherwise its task's row in History (plan deviation 11).
        const el = [...document.querySelectorAll<HTMLElement>("[data-entry]")].find((e) => e.dataset.entry === intent.entry);
        if (el) {
          el.scrollIntoView?.({ block: "center" });
          el.classList.add("hh-search-flash");
          setTimeout(() => el.classList.remove("hh-search-flash"), 2000);
          return true;
        }
        return intent.task ? runSearchIntent({ kind: "history", task: intent.task }) : false;
      }
      case "document":
        if (slim) return false;
        showReader({ path: intent.path, ...(intent.anchor ? { anchor: intent.anchor } : {}) });
        return true;
      case "timeline":
        if (slim) return false;
        closeReader();
        setTimelineFile(intent.path);
        return true;
      case "draft":
        // D3: the text waits in the composer; nothing is sent until the person sends it.
        setDraft(intent.text);
        requestAnimationFrame(() => inputRef.current?.focus());
        return true;
    }
  };
  useLayoutEffect(() => {
    if (!searchRef) return;
    searchRef.current = runSearchIntent;
    return () => {
      searchRef.current = null;
    };
  });
```

5. On `<HistoryPanel …>`: add `key={historyTask ?? "history"}` and `{...(historyTask ? { openTask: historyTask } : {})}`, and make its `onClose` `() => { setShowHistory(false); setHistoryTask(undefined); }`.

- [ ] **Step 7: Run the tests to see them pass, then the whole ui suite**

Run: `corepack pnpm vitest run packages/ui/test/search-host.test.tsx packages/ui/test/history-panel.test.tsx && corepack pnpm vitest run packages/ui && corepack pnpm typecheck`
Expected: PASS; the rest of the ui suite unchanged (D0); clean.

- [ ] **Step 8: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): ⌘K opens search; results open in the reader, timeline, History or chat

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 18: End to end in mock mode (§12 "e2e")

**Files:**
- Create: `packages/e2e/tests/search.spec.ts`

- [ ] **Step 1: Write the test**

```ts
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { closeAndClean, launchMock, makeSandbox, usageFile } from "./helpers";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

test("⌘K: groups, Enter opens a note's heading in the reader, ⌘Enter prepares a question, Esc gives focus back", async () => {
  const s = makeSandbox("search");
  fs.mkdirSync(path.join(s.folder, "docs"), { recursive: true });
  fs.writeFileSync(path.join(s.folder, "docs", "guide.md"), "# Guide\n\nIntro.\n\n## Setup\n\nInstall it.\n\n## Context window\n\nThe context window holds the turn.\n");
  fs.mkdirSync(path.join(s.folder, ".harness", "notes"), { recursive: true });
  fs.writeFileSync(path.join(s.folder, ".harness", "notes", "engines.md"), "---\ntitle: Engines\ndate: 2026-10-30\n---\n## Summary\n- Each engine has its own context limit.\n");
  fs.writeFileSync(path.join(s.folder, ".env"), "SECRET=never-shown-value\n");
  const { app, page } = await launchMock(s);
  try {
    await page.getByRole("button", { name: "Start Demo" }).click();
    const composer = page.getByRole("textbox").last();
    await composer.focus();

    // D0: nothing was built before the first ⌘K.
    expect(fs.existsSync(path.join(s.userData, "search"))).toBe(false);

    await page.keyboard.press(`${MOD}+k`);
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog).toBeVisible();
    await page.keyboard.type("context");
    const list = dialog.getByRole("listbox", { name: "Results" });
    await expect(list.getByRole("group", { name: "Notes" })).toBeVisible();
    await expect(list.getByRole("group", { name: "Files" })).toBeVisible();
    await expect(dialog).not.toContainText("never-shown-value");
    await expect(dialog).not.toContainText(".env");

    // Enter on the file: the reader at the heading above the match.
    const file = list.getByRole("option", { name: /guide\.md/ });
    await file.hover();
    await page.keyboard.press("Enter");
    const reader = page.getByRole("complementary", { name: "Document" });
    await expect(reader.getByRole("heading", { name: "Context window" })).toBeInViewport();
    await expect(dialog).toBeHidden();

    // ⌘Enter: the composer gets the query and its hints; nothing is sent.
    await page.keyboard.press(`${MOD}+k`);
    await page.keyboard.type("context");
    await expect(dialog.getByRole("option").first()).toBeVisible();
    await page.keyboard.press(`${MOD}+Enter`);
    await expect(dialog).toBeHidden();
    await expect(composer).toHaveValue(/^context\n\nPossibly related: /);
    expect(fs.existsSync(usageFile(s))).toBe(false);

    // Esc gives focus back to what had it.
    await composer.focus();
    await page.keyboard.press(`${MOD}+k`);
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(composer).toBeFocused();
  } finally {
    await closeAndClean(app, s);
  }
});
```

`usage.jsonl` is written only by a turn: its absence proves ⌘Enter sent nothing. If the demo's start view has more than one textbox, replace `getByRole("textbox").last()` with the composer's placeholder as `reader.spec.ts` does (`page.getByPlaceholder(COMPOSER)`).

- [ ] **Step 2: Run it**

Run: `corepack pnpm e2e -- search.spec.ts`
Expected: PASS (the script builds the shell first).

- [ ] **Step 3: Commit**

```bash
git add packages/e2e/tests/search.spec.ts
git commit -m "test(e2e): search opens, finds, opens a heading and prepares a question

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 19: Measure the budgets (§4.4) and document the index

**Files:**
- Create: `packages/shell/test/search-budget.test.ts`, `docs/architecture/search.md`

- [ ] **Step 1: Write the opt-in measurement**

`packages/shell/test/search-budget.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { workerBuild } from "../src/main/search/runner";
import { SearchService } from "../src/main/search/service";

// Opt-in (plan deviation 19): HH_SEARCH_BUDGET=1 corepack pnpm vitest run packages/shell/test/search-budget.test.ts
// HH_SEARCH_BUDGET_DIR=<folder> measures a real folder (the demo's, a large repo) instead of the generated one.
const on = process.env.HH_SEARCH_BUDGET === "1";
const WORDS = ["context", "window", "engine", "turn", "note", "harness", "budget", "scope", "reader", "history", "task", "plan"];

describe.skipIf(!on)("search budgets (§4.4)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-budget-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("10,000 files: names, text, query p95, disk and heap", async () => {
    let base = process.env.HH_SEARCH_BUDGET_DIR;
    if (!base) {
      base = path.join(tmp, "Work");
      for (let i = 0; i < 10_000; i++) {
        const dir = path.join(base, `d${i % 100}`);
        fs.mkdirSync(dir, { recursive: true });
        const text = Array.from({ length: 200 }, (_, k) => WORDS[(i * 7 + k) % WORDS.length]).join(" ");
        fs.writeFileSync(path.join(dir, `f${i}.md`), `# File ${i}\n\n${text}\n`);
      }
    }
    const statuses: { state: string; at: number }[] = [];
    const t0 = performance.now();
    const heap0 = process.memoryUsage().heapUsed;
    const svc = new SearchService({
      userData: () => path.join(tmp, "userData"),
      base: async () => base!,
      scoped: () => false,
      openScope: async () => null,
      scopeTitles: async () => new Map(),
      references: async () => [],
      memory: async () => [],
      extraDenied: async () => [],
      status: (s) => statuses.push({ state: s.state, at: performance.now() - t0 }),
      runner: workerBuild(),
      reveal: async () => true,
    });
    await svc.query("", {});
    await svc.whenIdle();
    const names = statuses.find((s) => s.state === "names")?.at ?? NaN;
    const ready = statuses.findLast((s) => s.state === "ready")?.at ?? NaN;
    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const q = `${WORDS[i % WORDS.length]} ${WORDS[(i + 3) % WORDS.length].slice(0, 4)}`;
      const a = performance.now();
      await svc.query(q, {});
      times.push(performance.now() - a);
    }
    times.sort((a, b) => a - b);
    await svc.flush();
    const dir = path.join(tmp, "userData", "search");
    const sub = path.join(dir, fs.readdirSync(dir)[0]);
    const disk = fs.readdirSync(sub).reduce((n, f) => n + fs.statSync(path.join(sub, f)).size, 0);
    const heap = process.memoryUsage().heapUsed - heap0;
    console.log(JSON.stringify({ namesMs: Math.round(names), textMs: Math.round(ready), queryP95Ms: Math.round(times[94]), diskBytes: disk, heapBytes: heap }, null, 2));
    expect(ready).toBeGreaterThan(0);
  }, 600_000);
});
```

The query time includes reading up to 20 snippets, which is what the window waits for.

- [ ] **Step 2: Run it once and keep the numbers for the PR**

Run: `HH_SEARCH_BUDGET=1 corepack pnpm vitest run packages/shell/test/search-budget.test.ts`
Expected: PASS, printing `namesMs`, `textMs`, `queryP95Ms`, `diskBytes`, `heapBytes`. Compare with §4.4 (names < 1 s, text < 30 s, p95 < 50 ms, disk ≤ 30% of the text). Run it again with `HH_SEARCH_BUDGET_DIR` set to the demo's folder after a few tasks. If the heap is past what Marco accepts, lower `MAX_FILES` (§15's first open question) and say so in the PR; do not change the engine.

- [ ] **Step 3: Write `docs/architecture/search.md`**

```markdown
# Global search

The ⌘K palette (spec: `docs/superpowers/specs/2026-10-30-global-search-design.md`). Plan 1: tasks, notes and files.

## Shape

- `packages/search` (pure): documents, deny rules, `.gitignore`, the content check, `minisearch` options, query and
  ranking, snippets, heading anchors, and `LiveIndex` (the `SearchIndex` seam, D6).
- `packages/shell/src/main/search/`: `walk.ts`, `build.ts` (in a worker thread: `worker.ts`, `runner.ts`), `store.ts`
  (`<userData>/search/<hash of the base>/`: `index.json`, `files.json`, `prefs.json`, 0600), `service.ts`, `ipc.ts`.
- `packages/ui/src/search/`: the palette and the ⌘K host. `ChatView` runs what a result opens through `searchRef`.
- Channels: `hh:search`, `hh:searchOpen` (invoke), `hh:searchStatus` (push).

## Lifecycle

Nothing exists until the first ⌘K (D0, D8). Then: a saved snapshot loads and reconciles, or a build starts (names,
then texts, then chats). Updates: each commit's paths (`committed`), a restore (whole reconcile), every ⌘K at most once
per 60 s. The tasks (actions, the open task, past tasks) are rebuilt in memory when the palette opens.

## Never indexed

`.git`, `.claude`, `.harness/` except `notes`, `reviews`, `chats`; `AGENTS.md` and the engine's instructions file;
secret-shaped names (`.env*`, keys, `credentials*`, `secrets.*`…); what `.gitignore` ignores (else a default list);
links are names only. A file with a token-shaped string is indexed by name only; notes and chats lose that line.
Snippets are read only for files indexed as text, and checked again before they leave main.

## Plan 1 deviations

See the plan's "Deviations from the spec" (`docs/superpowers/plans/2026-10-30-global-search-1.md`).
```

- [ ] **Step 4: Commit**

```bash
git add packages/shell/test/search-budget.test.ts docs/architecture/search.md
git commit -m "docs(search): architecture notes; an opt-in measurement of the budgets

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 20: Full verification

- [ ] **Step 1: Typecheck**

Run: `corepack pnpm typecheck`
Expected: no errors.

- [ ] **Step 2: All unit tests**

Run: `corepack pnpm test`
Expected: PASS (the budget test is skipped). Rerun a timed-out cli file alone before calling it a failure.

- [ ] **Step 3: The app builds with the worker**

Run: `corepack pnpm app:build`
Expected: success; `packages/shell/out/main/search-worker.js` exists.

- [ ] **Step 4: End to end**

Run: `corepack pnpm e2e`
Expected: PASS, the new `search.spec.ts` included; no other spec changed behaviour (D0).

- [ ] **Step 5: Spec coverage check (read, don't skip)**

For each item, point to the task: §3 Tasks/Notes/Files rows and what Enter opens (Tasks 5, 12, 17); §4.1 location, cache, 0600, every 5 s, on quit (Tasks 11, 13); §4.2 triggers (Tasks 12, 13; deviations 4–6); §4.3 worker, `readCapped`, `isBinary` (Tasks 9, 10); §4.4 budgets (Task 19); §4.5 caps (Tasks 2, 10); §5.1 keys and a11y (Tasks 16, 17); §5.2 recents (Task 12; deviation 9); §5.3 query, boosts, marks, snippets (Tasks 6, 7, 12); §5.4 ⌘Enter (Tasks 15, 17; deviation 10); §5.5 filters (Tasks 12, 16); §7 scopes and profiles (Tasks 12, 17); §8 privacy (Tasks 2, 4, 10, 12, 14); §9 interfaces (Tasks 7, 8, 13); §10 reader anchor (Task 5; deviation 13); §11 D0 (Tasks 12, 18); §12 tests (every task; Task 14 security, Task 18 e2e). Plan 2 items (§6, D4, data, `check`, permission review) stay out.

- [ ] **Step 6: Report**

The PR description lists the deviations above (numbered as here), the budget numbers from Task 19, and the product question of deviation 10.
