# File Timeline Implementation Plan (plan 16)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every file the history tracks gets a timeline: one entry per task that changed it, plus the person's answers, approvals (numbered v1, v2…), changes made outside the app and go-backs, each with who made it. An entry opens its diff (rendered word by word for `.md`, line by line for other text, sizes only for binary), inline or side by side, against the previous state or the current file. One file can go back to a version on its own, with a commit of its own that can be undone the same way. The reader gets a "File history" drawer, the History panel's changed files become links, and harness views get `client.files` plus `<FileTimeline>` and `<FileDiff>`.

**Architecture:**
- **Grouping is pure (`packages/workspace/src/file-timeline.ts`).** `groupTimeline(commits, path, actionLabel)` turns the commits that touched one path (oldest first, each with its subject, trailers, parent and the path's blob id) into `TimelineEntry[]`, newest first. Subjects come from `subjects.ts` (new: `ANSWER_PREFIX`, `APPROVED_PREFIX`, `FILE_RESTORE_PREFIX`).
- **A per-file index (`packages/workspace/src/file-index.ts`)** in the history's git data folder (`<historyDir>/hh-file-index.json`): path → commit ids. `History.saveNow` records each commit's changed paths (plus the path an `Answer:`/`Approved:` subject names); reads catch up on commits another `History` instance made, and rebuild from the log when the file is missing or its head is not in the history. It is never a source of truth.
- **`History` gains** `tracks`, `onCommit`, `fileCommits`, `fileTimeline`, `readBytesAt` and `restoreFile` (one file, the same link checks as `restore`, a commit that stages only that path).
- **The diff is computed in main (`packages/workspace/src/file-diff.ts`)** with `diff` (jsdiff 9: `diffArrays`, `diffWordsWithSpace`, `diffLines`, each with a timeout) and the reader's parser (`unified` + `remark-parse` + `remark-gfm`). It answers data (`FileDiffView`); the window only draws it, using the reader's `<Markdown>` for whole blocks.
- **Main (`packages/shell/src/main/file-timeline.ts`, `FileTimelineService`; `file-ipc.ts`)** checks every path (shape, inside the person's folder, tracked), reads the current file with `readPrefix` (capped, no links), enriches approvals with their reason from the review record, and runs a go-back through the existing `RestoreGuard`. Every answer is data. A commit tells the window which paths changed (`hh:fileCommits`).
- **The confirmation is the core's.** `client.files.restore` (preload, `file-restore.ts`) asks main for the prompt, then the confirmer the core's chat registered (`files.hostConfirm`), then restores. Without a confirmer it answers `"cancelled"`: a go-back never happens unconfirmed.
- **Window (`packages/ui`).** `FileTimeline` (entries, chips, turns), `FileDiff` (both layouts, Source toggle, binary, notices), `EntryDiff` (compare modes, go back), `RestoreConfirm`, the reader's drawer, the History panel's links, `FileTimelinePanel` for non-`.md` files, and "See what changed" drawn with `FileDiff`.

**Tech Stack:** TypeScript, pnpm via corepack, Electron 44 + electron-vite 5, React 19, i18next, isomorphic-git, `diff` 9.0.0 (already in the lockfile; added as a direct dependency of `@humanharness/workspace`, together with `unified`, `remark-parse`, `remark-gfm` and `@types/mdast` at the versions `@humanharness/ui` uses), Vitest + happy-dom, Playwright with the fake agents in mock mode.

Spec: `docs/superpowers/specs/2026-10-27-file-timeline-design.md` (on `origin/master`, not yet on this branch; Task 0 brings it over). "§" and "D" numbers below refer to it. It builds on the history (`docs/architecture/history.md`), the document reader (plan 10, `docs/architecture/documents.md`) and document review (plan 15, `docs/architecture/reviews.md`).

---

## Conventions

**Code**
- Same as plans 1–15:
  - English everywhere (code, comments, docs, UI strings; the spec's Spanish strings are Marco's mockup copy and become English keys under `timeline.*`);
  - packages export TS source;
  - extensionless imports;
  - tests in `packages/<name>/test/`;
  - one commit per task.
- React tests are `*.test.tsx` with `// @vitest-environment happy-dom` on the first line. Find elements by role and visible text. Use `renderIn("en", …)` from `packages/ui/test/render.tsx` when the component uses `useTranslation`.
- `@humanharness/ui` imports values from other workspace packages only through browser-safe subpaths (`@humanharness/workspace/subjects`, `@humanharness/harness-sdk/documents`, `@humanharness/harness-sdk/review`). The new timeline and diff types reach the window as `import type` / `export type` from `@humanharness/workspace` only. `packages/ui/src/client.ts` imports nothing but types (plus the existing subject re-export).
- Colours only through `--hh-*` tokens, in both the light block and the dark `@media` block of `packages/ui/src/styles.css`.
- **No regex that can backtrack on document text.** Paths, subjects and document text are scanned with `startsWith`, `indexOf`, `lastIndexOf` and hand-written loops. Regexes are allowed only on short ids (commit shas, as `isSha` already does) and file extensions. jsdiff's own tokenizers are linear character-class scans and every jsdiff call runs with `timeout`; Task 6 adds a timing test with about 50,000 spaces, like the reader's.
- **The CSP is not loosened.** `packages/shell/src/renderer/index.html` keeps `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`. Diff text is React text nodes inside `<ins>`, `<del>`, `<span>`; nothing becomes HTML. Widths and bars are CSS classes.
- **Errors over IPC travel as data**, never as thrown errors: every `hh:file*` handler answers `{ ok: false, reason }` (`FileRefusal`); a throw inside is a bug, logged, answered with the fallback.
- **File access only in the person's folder.** A path reaches the file system only after `refusedShape`, normalisation, `History.tracks`, and (for the current file and a go-back) `locate(rel, [base])` / the restore's real-path checks. Reference folders are never read or written by this plan. The history's git data is read only through `History`.
- Document text, commit subjects and paths are untrusted: they are never parsed with a regex, never become HTML, and a subject only ever names a path the check above then accepts or refuses.

**Commands and git**
- The worktree is `/Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data`. `<worktree>` below means that path, written out in full.
- Run every `corepack pnpm …` command from the worktree root. A single test file: `corepack pnpm vitest run <path>`.
- Git: always `git -C <worktree> …`, one simple command per call. Never use bare `git stash`. Never push.
- Every commit message ends with these two lines, with a blank line before them:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7
  ```
- Every task ends with `corepack pnpm typecheck` and `corepack pnpm test` green before its commit.
  - Tasks that touch the shell's main process, the preload or the UI also run `corepack pnpm app:build`.
  - Task 16 runs `corepack pnpm e2e`.

**Compliance**
- Never read `~/.claude`, `~/.codex`, `~/.gemini`, `~/.config/opencode`, `~/.local/share/opencode` or any credential file, in tests or product code. Tests use temp folders only.
- A go-back writes exactly one tracked file inside the person's folder, never through a link (the restore's `O_NOFOLLOW` write, the parent's real path checked before and right after `mkdir`), and its commit stages only that path.

**D0 is a hard rule.** The timeline reads the history every harness already has; it adds no manifest key, no agent tool and no instruction. So for every harness and engine, byte for byte:
- the folder (the index lives in the history's git data, outside the folder, and is never a git object: no commit tree ever contains it);
- every commit's subject, trailers and tree (the index is written after the commit; `restore`, `restoreReport` and `save` stage exactly what they staged before);
- `AGENTS.md` and the engine's instructions file; the `ui`, `data` and `material` MCP servers' tool lists;
- `AppState` (no new field: the timeline is core for every harness, see Q1);
- the CLI's output (`humanharness run` uses the same `History`; nothing it prints changes);
- the History panel without `onOpenFile` (a harness view that renders it gets the old plain paths).

Tasks 3, 5 and 14 hold the D0 regression tests. Everything the person sees that is new (the reader's "File history" button, the History panel's links) is core UI, the same for every harness.

## Decisions this plan takes where the spec leaves room

**Entries (§3.1)**
- Classification, by subject first (in this order): `Answer: <path> · …` naming this path → `answers`; `Approved: <path>` naming this path → `approval`; `Go back: …`, `Went back to an earlier point`, `Went back to before the task` or `Undo: …` → `goBack`; `Start` or `Before message` → `outside`; an `Answer:`/`Approved:` naming another path → `outside` (it only swept up the person's edits); any other commit with a `Task:` trailer → `task`; anything else → `outside`.
- A `Before message` commit that changed the file is an `outside` entry: by history.md, it holds the person's own edits made between turns, not the agent's (Q2).
- Consecutive `task` commits with the same `Task:` merge, and consecutive `answers` merge; every other kind is one entry per commit.
- `from` is the parent of the entry's first commit (`null` for the very first commit of the history); `to` is its last commit; `at` is the author time of `to`.
- Approvals are numbered from the oldest commit of the file the index knows. An `answers` entry is `unapproved` unless an `approval` entry follows it.
- An entry whose `to` has no blob for the path is `deleted: true` ("Deleted"); its "Go back to this version" is disabled, the one before it keeps it.
- A `goBack` entry finds what it went back to by blob: the newest earlier entry whose `to` blob equals its own. An approval gives `back: { version }` ("You went back to v2"); any other entry gives `back: { at }` ("You went back to the version of 10:41"); none: "You went back to an earlier version". The subject is never parsed for this.
- Authors: `task` → `{ kind: "agent", label: <action label or "A question">, task, action? }`; `answers`, `approval`, `goBack` → `{ kind: "person", label: "You" }`, except a crash undo (`Undo: …`, which carries the task's trailer) → the task's agent (Q3); `outside` → `{ kind: "outside", label: "Outside the app" }`.
- `label` on the entry is English data (for harness views and logs); the window draws its own text from `kind`, `commits.length`, `version`, `back`, `deleted`, `reason` through `timeline.*` keys.
- An approval entry gets `reason: true` when the review record's matching approval (paired newest first) has a reason.
- The timeline reads at most the newest 1,000 commits of a file (`MAX_TIMELINE_COMMITS`, Q7).

**The index (§3.3)**
- File: `<historyDir>/hh-file-index.json` (inside the history's git data folder, so it moves, is set aside and is pruned with the history; isomorphic-git ignores files it does not know there). Shape: `{ "version": 1, "head": "<sha>", "paths": { "<path>": ["<sha>", …oldest first] } }`. Written through a temp file and a rename.
- A commit updates it only when its parent is the index's `head`. Otherwise the commit leaves it alone, and the next read catches up: it walks first parents from HEAD back to the index's `head` (at most 2,000 commits) and adds those; when the `head` is not found, it rebuilds from the whole log. One rebuild at a time per `History` (a shared promise); the window shows "Loading history…" while the promise is pending.
- A commit's paths are its changed tracked paths, plus the path its subject names (`Approved: <path>` changes only the review record, but it belongs on the document's timeline).

**The diff (§4)**
- Computed in main, so `client.files.diff` is plain IPC for harness views too, and the 200 KB cap applies where the bytes are read.
- Blocks: front-matter (one block, compared line by line), headings, paragraphs, each item of a top-level list (nested lists stay in their item), each table row, code fences, Mermaid fences, callouts and other blockquotes (one block each), thematic breaks and HTML (`other`). They are aligned with `diffArrays` on their source text. Inside a run of removed-then-added blocks, the i-th removed and i-th added pair up when they are the same type and become one `changed` block; the rest stay `removed`/`added`. A moved paragraph is a `removed` plus an `added`.
- A changed text block carries word parts from `diffWordsWithSpace` over the block's plain text (Q5: inline formatting is not drawn inside a changed block; unchanged, added and removed blocks are drawn whole with `<Markdown>`). A changed code, Mermaid or front-matter block carries line changes. A changed table row carries word parts per cell.
- Each jsdiff call runs with `timeout: 2000`; a timed-out call falls back to "all removed, then all added" for that piece.
- Binary: a NUL in the first 8 KB of either side, or an extension in a fixed list (images, audio, video, archives, office files, PDFs, fonts, databases). Shown with both sizes.
- Each side is cut to its first 200 KB (`MAX_DIFF_BYTES`, back to a whole UTF-8 character) with `truncated: true`.
- Side by side falls back to inline when the diff's own box is narrower than 900 px, measured with `ResizeObserver` (Q12).

**Going back (§5)**
- Allowed on any entry whose `to` still has the file. Main checks that `commit` is the `to` of an entry of this path's timeline, and refuses a `deleted` entry.
- The commit is `Go back: <path> to <target>`, untagged (like today's restores), where `<target>` is `v2` for an approval and `the version of <ISO time>` otherwise. It stages only that path, so the person's other uncommitted edits stay for the next commit.
- Content already equal to that version: no commit, and the answer is still `"restored"` (Q9).
- Refused with `busy` while a turn or a task operation runs or turns are held (the same rule as today's restores; see Conflicts 1), and checked again after the confirmation.
- After a go-back main calls `settingsCtl?.changed()`, as the other restores do (a `.harness/data/` file may have gone back).

**UI (§6)**
- The reader's button is "File history" (the top bar already has "History", Q8). It toggles a drawer (`<section aria-label="File history">`) right of the document. In focus mode the drawer is hidden; pressing the button there leaves focus mode and opens it.
- Picking an entry replaces the document's article with `EntryDiff`: the compare switch ("What changed here" / "Against the current version"), the layout switch ("Inline" / "Side by side"), "Go back to this version", "Back to the document". The review footer bar and selection button are hidden while a diff shows.
- `ReaderTarget` gains `timeline?: boolean` (open with the drawer). The History panel opens `.md` files that still exist in the reader with the drawer; any other file, and a deleted `.md`, in `FileTimelinePanel` (a dialog like the History panel) (Q10).
- The confirmation (`RestoreConfirm`, `role="alertdialog"`) is drawn by `ChatView`, which registers itself with `client.files.hostConfirm`. Text: "Go back {{file}} to how it was after {{author}} ({{ago}})? The rest of the folder doesn't change."
- Chips: "not approved" (amber, `--hh-review-question`), "v2 approved" (green, `--hh-diff-ins` with `--hh-ok` text), "Outside the app" (grey, `--hh-review-done`), "Deleted" (grey).

## Conflicts with the spec

1. **Parallel tasks, jobs and the history's single queue do not exist yet** (`2026-10-27-parallel-tasks-and-jobs-design.md` has no plan). So: no `Job:` trailer and no job author (§3.1); no partial commits, so a shared path never shows "Spec writer + Planner"; "the commit goes through the history's single queue" (§5) is `History`'s own `serialize` queue; "refused while a running turn has touched the file" (§5) becomes "refused while any turn runs", through the existing `RestoreGuard`. The code keeps `author.job` in the type and one place (`FileTimelineService.restorePrompt`) where a per-file check can replace the global one.
2. **Linked folders** (hatches spec §3.4) do not exist. A path in a reference folder is outside the person's folder: `outside`, and the window says "This file has no history". The "this folder has its own git" message is not built.
3. **Restore subjects.** The spec names "Go back to …"; the history's real restore subjects are `Went back to an earlier point` (`RESTORE_POINT`), `Went back to before the task` (`RESTORE_TASK`) and `Undo: …` (`UNDO_PREFIX`). They are `goBack` entries, plus the new `Go back: <path> to …`. What a go-back returned to is found by blob (Decisions), not read from the subject.
4. **A crashed turn (§7).** The runtime restores the "Before message" point before any commit of the crashed turn, so that turn's writes never reach the history: the file's timeline shows neither a task entry nor an `Undo:` entry for it (the `Undo:` commit leaves the file as it was). Nothing to build; the docs say so.
5. **Errors as data.** `client.files.timeline` answers `FileTimelineResult` (`{ ok: true, entries } | { ok: false, reason }`) instead of `TimelineEntry[]`; `diff` answers `FileDiffResult`; `restore` answers `"restored" | "cancelled" | { refused: FileRefusal }`. The diff's type is `FileDiffView` (the name `FileDiff` is the component). `TimelineEntry.from` is `string | null`, and the entry gains optional `deleted`, `back` and `reason`.
6. **SDK components take the client**, like `MaterialPanel`: `<FileTimeline client path onPick />` and `<FileDiff client path from to />`.
7. **The diff is computed in main, not in the window** (§4.2 "parsed with the reader's pipeline"): main parses with the same `remark-parse` + `remark-gfm`; the window draws whole blocks with the reader's `<Markdown>`. Changed blocks show plain text with word marks (Q5).
8. **Sidekick, context panel and plugins** have no plan; this spec does not depend on them and nothing here waits for them.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/workspace/src/subjects.ts` | modify | `ANSWER_PREFIX`, `ANSWER_SEPARATOR`, `APPROVED_PREFIX`, `FILE_RESTORE_PREFIX` |
| `packages/workspace/src/file-timeline.ts` | create | Pure: types, `namedPath`, `classifyCommit`, `groupTimeline` |
| `packages/workspace/src/file-index.ts` | create | The index file: load, validate, add a commit, save atomically |
| `packages/workspace/src/history.ts` | modify | Commits feed the index; `tracks`, `onCommit`, `fileCommits`, `fileTimeline`, `readBytesAt`, `restoreFile` |
| `packages/workspace/src/file-diff.ts` | create | Binary check, cut, line/word changes, Markdown blocks and their diff, `diffFile` |
| `packages/workspace/src/safe-read.ts` | modify | `readPrefix` (the first N bytes, same checks as `readCapped`) |
| `packages/workspace/src/index.ts`, `package.json` | modify | Exports; `diff`, `unified`, `remark-parse`, `remark-gfm`, `@types/mdast` |
| `packages/workspace/test/file-timeline.test.ts`, `file-index.test.ts`, `history-index.test.ts`, `history-timeline.test.ts`, `history-restore-file.test.ts`, `file-diff.test.ts`, `file-diff-markdown.test.ts` | create | Unit tests |
| `packages/shell/src/main/reviews.ts` | modify | Uses the new subject constants (same strings) |
| `packages/shell/src/main/file-timeline.ts` | create | `FileTimelineService`: paths, timeline, diff, restore prompt and restore |
| `packages/shell/src/main/file-ipc.ts` | create | `hh:fileTimeline`, `hh:fileDiff`, `hh:fileRestorePrompt`, `hh:fileRestore` |
| `packages/shell/src/main/index.ts` | modify | Wiring; `hh:fileCommits` from each history's commits |
| `packages/shell/src/preload/file-restore.ts` | create | `restoreFlow`: prompt, confirm, restore |
| `packages/shell/src/preload/index.ts` | modify | `files` on `window.hh` |
| `packages/shell/test/file-timeline.test.ts`, `file-ipc.test.ts`, `file-restore.test.ts` | create | Main and preload tests |
| `packages/ui/src/client.ts` | modify | Types; `HarnessClient.files` |
| `packages/ui/src/FileTimeline.tsx` | create | The entry list (SDK component), author names, time ago |
| `packages/ui/src/FileDiff.tsx` | create | The diff view (SDK component), `aroundChanges`, `sideRows` |
| `packages/ui/src/EntryDiff.tsx` | create | Compare modes, layout, go back, back |
| `packages/ui/src/RestoreConfirm.tsx` | create | The core's confirmation |
| `packages/ui/src/FileTimelinePanel.tsx` | create | A non-`.md` file's timeline, from the History panel |
| `packages/ui/src/ApprovedDiff.tsx` | modify | "See what changed" drawn with `FileDiff` |
| `packages/ui/src/DocumentReader.tsx`, `HistoryPanel.tsx`, `ChatView.tsx`, `styles.css`, `index.ts` | modify | Drawer, links, panel, confirmation host, styles, exports |
| `packages/ui/test/file-timeline.test.tsx`, `file-diff.test.tsx`, `entry-diff.test.tsx`, `document-reader-timeline.test.tsx`, `file-timeline-panel.test.tsx` | create | UI tests |
| `packages/ui/test/fake-client.ts`, `client.test.ts`, `history-panel.test.tsx`, `document-reader.test.tsx` | modify | Fake `files`; updated tests |
| `packages/i18n/src/locales/en.json` | modify | `timeline.*`, `history.openTimeline`, `history.entry.fileBack` |
| `packages/e2e/tests/review.spec.ts` | modify | The timeline end to end (reuses the review fixture's build) |
| `docs/architecture/timeline.md` | create | Architecture doc |
| `docs/architecture/history.md`, `documents.md`, `reviews.md` | modify | Cross references |
| `docs/superpowers/specs/2026-10-27-file-timeline-design.md` | add (Task 0), modify (Task 17) | Spec on the branch; status |
| `docs/superpowers/plans/2026-10-28-file-timeline.md` | add (Task 0) | This plan |

---

### Task 0: Branch, spec and this plan

**Files:**
- Add: `docs/superpowers/specs/2026-10-27-file-timeline-design.md` (from `origin/master`)
- Add: `docs/superpowers/plans/2026-10-28-file-timeline.md` (this file)

- [ ] **Step 1: Check the branch**

Run: `git -C <worktree> branch --show-current`
Expected: `feat/file-timeline` (stacked on `feat/doc-review` at `7949f11`). If it is not, run `git -C <worktree> switch -c feat/file-timeline feat/doc-review`.

- [ ] **Step 2: Bring the spec over**

Run: `git -C <worktree> fetch origin`
Run: `git -C <worktree> checkout origin/master -- docs/superpowers/specs/2026-10-27-file-timeline-design.md`
Expected: the file exists.

- [ ] **Step 3: Put this plan in place**

Copy this file to `<worktree>/docs/superpowers/plans/2026-10-28-file-timeline.md`.

- [ ] **Step 4: Commit**

```bash
git -C <worktree> add docs/superpowers/specs/2026-10-27-file-timeline-design.md docs/superpowers/plans/2026-10-28-file-timeline.md
git -C <worktree> commit -m "docs(plan): file timeline (plan 16)"
```

---

### Task 1: Commit subjects and the timeline's grouping

**Files:**
- Modify: `packages/workspace/src/subjects.ts`, `packages/workspace/src/index.ts`, `packages/shell/src/main/reviews.ts`
- Create: `packages/workspace/src/file-timeline.ts`
- Test: `packages/workspace/test/file-timeline.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/workspace/test/file-timeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type TimelineCommit, classifyCommit, groupTimeline, namedPath } from "../src/file-timeline";

const DOC = "specs/filter.md";
let n = 0;
/** A commit of the file, `minute` minutes after 10:00; `blob` null: the file is not there. */
function c(subject: string, opts: { task?: string; action?: string; blob?: string | null; minute?: number } = {}): TimelineCommit {
  n++;
  const id = n.toString(16).padStart(40, "0");
  return {
    id,
    parent: (n - 1).toString(16).padStart(40, "0"),
    subject,
    task: opts.task ?? null,
    action: opts.action ?? null,
    at: new Date(Date.UTC(2026, 9, 28, 10, opts.minute ?? n)).toISOString(),
    blob: opts.blob === undefined ? `b${n}` : opts.blob,
  };
}
const label = (id: string | null) => (id === "spec" ? "Spec writer" : id === null ? "A question" : id);

describe("namedPath", () => {
  it("reads the path an answer or an approval names, and nothing else", () => {
    expect(namedPath(`Answer: ${DOC} · Size only?`)).toBe(DOC);
    expect(namedPath(`Approved: ${DOC}`)).toBe(DOC);
    expect(namedPath("Answer: no separator")).toBeNull();
    expect(namedPath("Approved: ../out.md")).toBeNull();
    expect(namedPath("Turn: write it")).toBeNull();
  });
});

describe("classifyCommit", () => {
  it("goes by subject before trailer", () => {
    expect(classifyCommit(c(`Answer: ${DOC} · q`, { task: "t1" }), DOC).kind).toBe("answers");
    expect(classifyCommit(c(`Approved: ${DOC}`, { task: "t1" }), DOC).kind).toBe("approval");
    expect(classifyCommit(c("Undo: the turn did not finish", { task: "t1" }), DOC).kind).toBe("goBack");
    expect(classifyCommit(c(`Go back: ${DOC} to v1`), DOC).kind).toBe("goBack");
    expect(classifyCommit(c("Went back to an earlier point"), DOC).kind).toBe("goBack");
    expect(classifyCommit(c("Went back to before the task"), DOC).kind).toBe("goBack");
    expect(classifyCommit(c("Start"), DOC).kind).toBe("outside");
    expect(classifyCommit(c("Before message", { task: "t1" }), DOC).kind).toBe("outside");
    expect(classifyCommit(c("Approved: other.md", { task: "t1" }), DOC).kind).toBe("outside");
    expect(classifyCommit(c("Turn: write", { task: "t1", action: "spec" }), DOC).kind).toBe("task");
    expect(classifyCommit(c("Material: added a.pdf"), DOC).kind).toBe("outside");
  });
});

describe("groupTimeline", () => {
  it("one entry per task, newest first; turns, notes and data writes of one task merge", () => {
    const commits = [
      c("Start"),
      c("Turn: write the spec", { task: "t1", action: "spec" }),
      c("Note: Filter", { task: "t1", action: "spec" }),
      c("Turn: a question", { task: "t2" }),
    ];
    const entries = groupTimeline(commits, DOC, label);
    expect(entries.map((e) => [e.kind, e.author.label, e.commits.length])).toEqual([
      ["task", "A question", 1],
      ["task", "Spec writer", 2],
      ["outside", "Outside the app", 1],
    ]);
    const spec = entries[1];
    expect(spec.from).toBe(commits[1].parent);
    expect(spec.to).toBe(commits[2].id);
    expect(spec.at).toBe(commits[2].at);
    expect(spec.label).toBe("2 changes");
    expect(spec.author).toEqual({ kind: "agent", label: "Spec writer", task: "t1", action: "spec" });
    expect(spec.commits.map((x) => x.subject)).toEqual(["Note: Filter", "Turn: write the spec"]);
  });

  it("a task split by answers is two entries; answers merge and are unapproved until an approval follows", () => {
    const entries = groupTimeline(
      [
        c("Turn: write", { task: "t1", action: "spec" }),
        c(`Answer: ${DOC} · q1`, { task: "t1" }),
        c(`Answer: ${DOC} · q2`, { task: "t1" }),
        c("Turn: edit", { task: "t1", action: "spec" }),
        c(`Answer: ${DOC} · q3`, { task: "t1" }),
      ],
      DOC,
      label,
    );
    expect(entries.map((e) => [e.kind, e.commits.length, e.unapproved ?? false])).toEqual([
      ["answers", 1, true],
      ["task", 1, false],
      ["answers", 2, true],
      ["task", 1, false],
    ]);
    expect(entries[2].label).toBe("Your answers (2)");
    expect(entries[2].author).toEqual({ kind: "person", label: "You" });
  });

  it("approvals are numbered v1, v2…; answers before an approval are approved", () => {
    const entries = groupTimeline(
      [c(`Answer: ${DOC} · q`, { task: "t1" }), c(`Approved: ${DOC}`, { task: "t1" }), c("Turn: edit", { task: "t1" }), c(`Approved: ${DOC}`, { task: "t1" })],
      DOC,
      label,
    );
    expect(entries.map((e) => [e.kind, e.version, e.label])).toEqual([
      ["approval", 2, "v2 approved"],
      ["task", undefined, "1 change"],
      ["approval", 1, "v1 approved"],
      ["answers", undefined, "Your answers (1)"],
    ]);
    expect(entries[3].unapproved).toBeUndefined();
  });

  it("a go-back names what it went back to by blob: an approval's version, else a time, else nothing", () => {
    const commits = [
      c("Turn: write", { task: "t1", blob: "A" }),
      c(`Approved: ${DOC}`, { task: "t1", blob: "A" }),
      c("Turn: edit", { task: "t1", blob: "B" }),
      c(`Go back: ${DOC} to v1`, { blob: "A" }),
      c("Turn: again", { task: "t2", blob: "C" }),
      c("Went back to an earlier point", { blob: "B" }),
      c("Went back to before the task", { blob: "Z" }),
    ];
    const [unknown, toTime, , toV1] = groupTimeline(commits, DOC, label);
    expect(toV1.back).toEqual({ version: 1 });
    expect(toV1.label).toBe("Went back to v1");
    expect(toTime.back).toEqual({ at: commits[2].at });
    expect(unknown.back).toBeUndefined();
    expect(unknown.label).toBe("Went back to an earlier version");
    expect(toV1.author).toEqual({ kind: "person", label: "You" });
  });

  it("a crash undo belongs to the task's agent", () => {
    const [undo] = groupTimeline([c("Turn: write", { task: "t1", action: "spec" }), c("Undo: the turn did not finish", { task: "t1", action: "spec" })], DOC, label);
    expect(undo.kind).toBe("goBack");
    expect(undo.author).toEqual({ kind: "agent", label: "Spec writer", task: "t1", action: "spec" });
  });

  it("a deleted file: the last entry says Deleted", () => {
    const [gone, before] = groupTimeline([c("Turn: write", { task: "t1" }), c("Turn: remove", { task: "t2", blob: null })], DOC, label);
    expect(gone.deleted).toBe(true);
    expect(gone.label).toBe("Deleted");
    expect(before.deleted).toBeUndefined();
  });

  it("the first commit of the history has no parent", () => {
    const first = { ...c("Start"), parent: null };
    expect(groupTimeline([first], DOC, label)[0].from).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/workspace/test/file-timeline.test.ts`
Expected: FAIL (`Cannot find module '../src/file-timeline'`).

- [ ] **Step 3: Add the subject constants**

Append to `packages/workspace/src/subjects.ts`:

```ts
/** A person's answer in a document review (reviews.md): `Answer: <path> · <question>`. */
export const ANSWER_PREFIX = "Answer: ";
/** Between an answer's path and its question. */
export const ANSWER_SEPARATOR = " · ";
/** A person's approval of a document (reviews.md): `Approved: <path>`. */
export const APPROVED_PREFIX = "Approved: ";
/** One file brought back to a version (file-timeline spec §5): `Go back: <path> to <target>`. */
export const FILE_RESTORE_PREFIX = "Go back: ";
```

In `packages/shell/src/main/reviews.ts` import `ANSWER_PREFIX`, `ANSWER_SEPARATOR` and `APPROVED_PREFIX` from `@humanharness/workspace` and write the two subjects with them (the strings stay the same):

```ts
      await this.commit(`${ANSWER_PREFIX}${doc}${ANSWER_SEPARATOR}${cut(c.text, 60)}`);
```

```ts
        await this.commit(`${APPROVED_PREFIX}${doc}`);
```

- [ ] **Step 4: Write `file-timeline.ts`**

Create `packages/workspace/src/file-timeline.ts`:

```ts
import { refusedShape } from "@humanharness/harness-sdk/documents";
import {
  ANSWER_PREFIX,
  ANSWER_SEPARATOR,
  APPROVED_PREFIX,
  BEFORE_MESSAGE,
  FILE_RESTORE_PREFIX,
  RESTORE_POINT,
  RESTORE_TASK,
  START,
  UNDO_PREFIX,
} from "./subjects";

export type TimelineKind = "task" | "answers" | "approval" | "outside" | "goBack";

/** Who made an entry (§3.1). `job` is for parallel jobs, which do not exist yet. */
export interface TimelineAuthor {
  kind: "agent" | "person" | "outside";
  label: string;
  task?: string;
  action?: string;
  job?: string;
}

/** One entry of a file's timeline (§3.2). Times are ISO strings. */
export interface TimelineEntry {
  kind: TimelineKind;
  author: TimelineAuthor;
  /** English, for harness views and logs; the window draws its own text from the other fields. */
  label: string;
  /** The time of its last commit. */
  at: string;
  /** The commit before the entry (the file's previous state); null before the history's first commit. */
  from: string | null;
  /** Its last commit. */
  to: string;
  /** Approvals only: 1, 2… */
  version?: number;
  /** Answers only, until an approval follows. */
  unapproved?: true;
  /** The file is not there at `to`. */
  deleted?: true;
  /** A go-back: the approval or the time of the version it brought back, when one matches. */
  back?: { version?: number; at?: string };
  /** An approval made with a reason (review spec §5.4); set by main from the review record. */
  reason?: true;
  /** The turns, newest first, for expanding. */
  commits: { id: string; subject: string; at: string }[];
}

/** A commit that touched the file, as `groupTimeline` needs it. `blob`: the file's blob id there, null when absent. */
export interface TimelineCommit {
  id: string;
  parent: string | null;
  subject: string;
  task: string | null;
  action: string | null;
  at: string;
  blob: string | null;
}

/** The path an `Answer:` or `Approved:` subject names; null for any other subject or a path the reader would refuse. */
export function namedPath(subject: string): string | null {
  let rest: string;
  if (subject.startsWith(APPROVED_PREFIX)) rest = subject.slice(APPROVED_PREFIX.length);
  else if (subject.startsWith(ANSWER_PREFIX)) {
    const body = subject.slice(ANSWER_PREFIX.length);
    const cut = body.indexOf(ANSWER_SEPARATOR);
    if (cut < 0) return null;
    rest = body.slice(0, cut);
  } else return null;
  return refusedShape(rest) ? null : rest;
}

const isGoBack = (s: string) => s.startsWith(FILE_RESTORE_PREFIX) || s === RESTORE_POINT || s === RESTORE_TASK || s.startsWith(UNDO_PREFIX);

/** A commit's kind for `file`, subject before trailer (§3.1), and the key that merges it with its neighbour. */
export function classifyCommit(c: TimelineCommit, file: string): { kind: TimelineKind; key: string } {
  const s = c.subject;
  if (s.startsWith(ANSWER_PREFIX) || s.startsWith(APPROVED_PREFIX)) {
    if (namedPath(s) !== file) return { kind: "outside", key: c.id };
    return s.startsWith(ANSWER_PREFIX) ? { kind: "answers", key: "answers" } : { kind: "approval", key: c.id };
  }
  if (isGoBack(s)) return { kind: "goBack", key: c.id };
  if (s === START || s === BEFORE_MESSAGE) return { kind: "outside", key: c.id };
  if (c.task !== null) return { kind: "task", key: `task:${c.task}` };
  return { kind: "outside", key: c.id };
}

const YOU: TimelineAuthor = { kind: "person", label: "You" };
const OUTSIDE: TimelineAuthor = { kind: "outside", label: "Outside the app" };

function agent(c: TimelineCommit, actionLabel: (id: string | null) => string): TimelineAuthor {
  return { kind: "agent", label: actionLabel(c.action), ...(c.task ? { task: c.task } : {}), ...(c.action ? { action: c.action } : {}) };
}

/**
 * The commits that touched `file` (oldest first) as timeline entries, newest first (§3.1). `actionLabel` names a task's
 * action (null: a free question).
 */
export function groupTimeline(commits: TimelineCommit[], file: string, actionLabel: (id: string | null) => string): TimelineEntry[] {
  type Group = { kind: TimelineKind; key: string; commits: TimelineCommit[] };
  const groups: Group[] = [];
  for (const c of commits) {
    const { kind, key } = classifyCommit(c, file);
    const last = groups.at(-1);
    if (last && last.key === key && (kind === "task" || kind === "answers")) last.commits.push(c);
    else groups.push({ kind, key, commits: [c] });
  }
  const out: TimelineEntry[] = [];
  let version = 0;
  for (const g of groups) {
    const first = g.commits[0];
    const last = g.commits[g.commits.length - 1];
    const e: TimelineEntry = {
      kind: g.kind,
      author:
        g.kind === "task" || (g.kind === "goBack" && last.subject.startsWith(UNDO_PREFIX) && last.task !== null)
          ? agent(last, actionLabel)
          : g.kind === "outside"
            ? OUTSIDE
            : YOU,
      label: "",
      at: last.at,
      from: first.parent,
      to: last.id,
      commits: g.commits.map((c) => ({ id: c.id, subject: c.subject, at: c.at })).reverse(),
    };
    if (g.kind === "approval") e.version = ++version;
    if (last.blob === null) e.deleted = true;
    out.push(e);
  }
  // Answers stay unapproved until an approval follows; a go-back finds the newest earlier entry with its blob.
  const blobs = groups.map((g) => g.commits[g.commits.length - 1].blob);
  for (let i = 0; i < out.length; i++) {
    const e = out[i];
    if (e.kind === "answers" && !out.slice(i + 1).some((x) => x.kind === "approval")) e.unapproved = true;
    if (e.kind === "goBack" && blobs[i] !== null) {
      for (let j = i - 1; j >= 0; j--) {
        if (blobs[j] !== blobs[i]) continue;
        e.back = out[j].kind === "approval" ? { version: out[j].version } : { at: out[j].at };
        break;
      }
    }
    e.label = englishLabel(e);
  }
  return out.reverse();
}

function englishLabel(e: TimelineEntry): string {
  if (e.deleted) return "Deleted";
  switch (e.kind) {
    case "task":
      return e.commits.length === 1 ? "1 change" : `${e.commits.length} changes`;
    case "answers":
      return `Your answers (${e.commits.length})`;
    case "approval":
      return `v${e.version} approved`;
    case "outside":
      return "Changed outside the app";
    case "goBack":
      if (e.back?.version !== undefined) return `Went back to v${e.back.version}`;
      if (e.back?.at !== undefined) return `Went back to the version of ${e.back.at}`;
      return "Went back to an earlier version";
  }
}
```

Add `export * from "./file-timeline";` to `packages/workspace/src/index.ts`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `corepack pnpm vitest run packages/workspace/test/file-timeline.test.ts packages/shell/test/reviews.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, test, commit**

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

```bash
git -C <worktree> add packages/workspace/src/subjects.ts packages/workspace/src/file-timeline.ts packages/workspace/src/index.ts packages/workspace/test/file-timeline.test.ts packages/shell/src/main/reviews.ts
git -C <worktree> commit -m "feat(workspace): group a file's commits into timeline entries"
```

---

### Task 2: The file index

**Files:**
- Create: `packages/workspace/src/file-index.ts`
- Modify: `packages/workspace/src/index.ts`
- Test: `packages/workspace/test/file-index.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/workspace/test/file-index.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FILE_INDEX_NAME, FileIndex, addCommit, emptyIndex } from "../src/file-index";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-index-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const sha = (n: number) => n.toString(16).padStart(40, "0");

describe("FileIndex", () => {
  it("adds a commit to every path it names, oldest first, and moves the head", () => {
    const data = emptyIndex(null);
    addCommit(data, sha(1), ["a.md", "b.md"]);
    addCommit(data, sha(2), ["a.md"]);
    expect(data).toEqual({ version: 1, head: sha(2), paths: { "a.md": [sha(1), sha(2)], "b.md": [sha(1)] } });
  });

  it("saves through a temp file in the git data and loads it back", async () => {
    const dir = fs.mkdtempSync(path.join(root, "g-"));
    const index = new FileIndex(dir);
    expect(await index.load()).toBeNull();
    const data = emptyIndex(null);
    addCommit(data, sha(1), ["a.md"]);
    await index.save(data);
    expect(fs.readdirSync(dir)).toEqual([FILE_INDEX_NAME]);
    expect(await new FileIndex(dir).load()).toEqual(data);
  });

  it("a file that is not an index loads as missing", async () => {
    const dir = fs.mkdtempSync(path.join(root, "g-"));
    for (const bad of ["{", "[]", '{"version":2,"head":null,"paths":{}}', '{"version":1,"head":5,"paths":{}}', '{"version":1,"head":null,"paths":{"a.md":[1]}}']) {
      fs.writeFileSync(path.join(dir, FILE_INDEX_NAME), bad);
      expect(await new FileIndex(dir).load()).toBeNull();
    }
  });

  it("record(parent, …) only adds when the parent is the head; otherwise it leaves the file for a catch-up", async () => {
    const dir = fs.mkdtempSync(path.join(root, "g-"));
    const index = new FileIndex(dir);
    await index.record(null, sha(1), ["a.md"]);
    await index.record(sha(1), sha(2), ["a.md"]);
    await index.record(sha(9), sha(3), ["b.md"]);
    expect(await index.load()).toEqual({ version: 1, head: sha(2), paths: { "a.md": [sha(1), sha(2)] } });
    // A missing index is not started from a later commit: the next read rebuilds it.
    const other = new FileIndex(fs.mkdtempSync(path.join(root, "g-")));
    await other.record(sha(1), sha(2), ["a.md"]);
    expect(await other.load()).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/workspace/test/file-index.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `file-index.ts`**

Create `packages/workspace/src/file-index.ts`:

```ts
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/** The index's file name, inside the history's git data folder (file-timeline spec §3.3). */
export const FILE_INDEX_NAME = "hh-file-index.json";

/** Each tracked path's commits, oldest first, up to `head`. Not a source of truth: losing it costs a rebuild. */
export interface FileIndexData {
  version: 1;
  head: string | null;
  paths: Record<string, string[]>;
}

const SHA = /^[0-9a-f]{40}$/;

export const emptyIndex = (head: string | null): FileIndexData => ({ version: 1, head, paths: {} });

/** Adds commit `sha` to each of `paths` and makes it the head. */
export function addCommit(data: FileIndexData, sha: string, paths: readonly string[]): void {
  for (const p of paths) {
    const list = Object.hasOwn(data.paths, p) ? data.paths[p] : (data.paths[p] = []);
    if (list.at(-1) !== sha) list.push(sha);
  }
  data.head = sha;
}

function valid(raw: unknown): raw is FileIndexData {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || !(r.head === null || (typeof r.head === "string" && SHA.test(r.head)))) return false;
  if (typeof r.paths !== "object" || r.paths === null || Array.isArray(r.paths)) return false;
  return Object.values(r.paths as Record<string, unknown>).every((l) => Array.isArray(l) && l.every((s) => typeof s === "string" && SHA.test(s)));
}

/** The index file of one history's git data. Reads are cached while the file's time and size stay the same. */
export class FileIndex {
  private readonly file: string;
  private memo: { data: FileIndexData; mtimeMs: number; size: number } | null = null;

  constructor(gitdir: string) {
    this.file = path.join(gitdir, FILE_INDEX_NAME);
  }

  /** The index, or null when it is missing or not an index. */
  async load(): Promise<FileIndexData | null> {
    const stat = await fs.stat(this.file).catch(() => null);
    if (!stat) return null;
    if (this.memo && this.memo.mtimeMs === stat.mtimeMs && this.memo.size === stat.size) return this.memo.data;
    try {
      const raw: unknown = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (!valid(raw)) return null;
      this.memo = { data: raw, mtimeMs: stat.mtimeMs, size: stat.size };
      return raw;
    } catch {
      return null;
    }
  }

  /** Writes `data` through a temp file and a rename (another `History` on the same git data may write too: last wins). */
  async save(data: FileIndexData): Promise<void> {
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    const text = JSON.stringify(data);
    await fs.writeFile(tmp, text);
    try {
      await fs.rename(tmp, this.file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
    const stat = await fs.stat(this.file);
    this.memo = { data, mtimeMs: stat.mtimeMs, size: stat.size };
  }

  /**
   * A new commit: added when its parent is the head (or it is the history's first commit and there is no index).
   * Anything else is left for the next read, which catches up or rebuilds.
   */
  async record(parent: string | null, sha: string, paths: readonly string[]): Promise<void> {
    const data = await this.load();
    if (data === null) {
      if (parent !== null) return;
      const fresh = emptyIndex(null);
      addCommit(fresh, sha, paths);
      await this.save(fresh);
      return;
    }
    if (data.head !== parent) return;
    addCommit(data, sha, paths);
    await this.save(data);
  }
}
```

Add `export * from "./file-index";` to `packages/workspace/src/index.ts`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `corepack pnpm vitest run packages/workspace/test/file-index.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit**

Run: `corepack pnpm typecheck && corepack pnpm test`

```bash
git -C <worktree> add packages/workspace/src/file-index.ts packages/workspace/src/index.ts packages/workspace/test/file-index.test.ts
git -C <worktree> commit -m "feat(workspace): a per-file index of the history's commits"
```

---

### Task 3: Commits feed the index; catch-up and rebuild

**Files:**
- Modify: `packages/workspace/src/history.ts`
- Test: `packages/workspace/test/history-index.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/workspace/test/history-index.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import git from "isomorphic-git";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FILE_INDEX_NAME, History } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-hidx-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

let folder: string;
let gitdir: string;
let history: History;
const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
  fs.writeFileSync(path.join(folder, rel), content);
};
const indexFile = () => path.join(gitdir, FILE_INDEX_NAME);

beforeEach(async () => {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  folder = path.join(base, "work");
  gitdir = path.join(base, "history.git");
  fs.mkdirSync(folder);
  history = new History(folder, gitdir, [".harness/", "AGENTS.md"]);
  await history.init();
});

describe("History's file index (file-timeline spec §3.3)", () => {
  it("each commit adds its changed paths; an approval adds the path it names", async () => {
    write("a.md", "1");
    write("b.md", "1");
    const s1 = (await history.save("Start"))!;
    write("a.md", "2");
    const s2 = (await history.save("Turn: edit", { task: "t1" }))!;
    write(".harness/reviews/a.md.json", "{}");
    const history2 = new History(folder, gitdir, [".harness/", "AGENTS.md"], [".harness/reviews/"]);
    const s3 = (await history2.save("Approved: a.md", { task: "t1" }))!;
    expect(await history2.fileCommits("a.md")).toEqual([s1, s2, s3]);
    expect(await history2.fileCommits("b.md")).toEqual([s1]);
    expect(await history2.fileCommits(".harness/reviews/a.md.json")).toEqual([s3]);
  });

  it("tells its listeners which paths each commit touched", async () => {
    const seen: { sha: string; paths: string[] }[] = [];
    const off = history.onCommit((c) => seen.push(c));
    write("a.md", "1");
    const s1 = (await history.save("Start"))!;
    off();
    write("a.md", "2");
    await history.save("Turn: edit");
    expect(seen).toEqual([{ sha: s1, paths: ["a.md"] }]);
  });

  it("rebuilds a missing index from the log", async () => {
    write("a.md", "1");
    const s1 = (await history.save("Start"))!;
    write("a.md", "2");
    const s2 = (await history.save("Turn: edit"))!;
    fs.rmSync(indexFile());
    expect(await new History(folder, gitdir, [".harness/", "AGENTS.md"]).fileCommits("a.md")).toEqual([s1, s2]);
    expect(fs.existsSync(indexFile())).toBe(true);
  });

  it("catches up on commits another History made on the same git data", async () => {
    write("a.md", "1");
    const s1 = (await history.save("Start"))!;
    const other = new History(folder, gitdir, [".harness/", "AGENTS.md"]);
    await other.init();
    write("a.md", "2");
    const s2 = (await other.save("Turn: edit"))!;
    // The index was written by `other` too: put back an index that stops at s1, as if `other` had failed to write it.
    fs.writeFileSync(indexFile(), JSON.stringify({ version: 1, head: s1, paths: { "a.md": [s1] } }));
    write("a.md", "3");
    const s3 = (await other.save("Turn: again"))!;
    expect(await history.fileCommits("a.md")).toEqual([s1, s2, s3]);
  });

  it("rebuilds when the index's head is not in this history (a history set aside after a move)", async () => {
    write("a.md", "1");
    const s1 = (await history.save("Start"))!;
    fs.writeFileSync(indexFile(), JSON.stringify({ version: 1, head: "f".repeat(40), paths: { "a.md": ["f".repeat(40)] } }));
    expect(await history.fileCommits("a.md")).toEqual([s1]);
  });

  it("D0: the index lives in the git data, never in the folder or in a commit; subjects stay as given", async () => {
    write("a.md", "1");
    await history.save("Start");
    write("a.md", "2");
    const sha = (await history.save("Turn: edit", { task: "t1" }))!;
    expect(fs.readdirSync(folder)).toEqual(["a.md"]);
    expect(await git.listFiles({ fs, gitdir, ref: sha })).toEqual(["a.md"]);
    const { commit } = await git.readCommit({ fs, gitdir, oid: sha });
    expect(commit.message).toBe("Turn: edit\n\nTask: t1\n");
    expect(fs.existsSync(indexFile())).toBe(true);
  });

  it("tracks() is the history's own rule", () => {
    expect(history.tracks("a.md")).toBe(true);
    expect(history.tracks(".harness/tasks.json")).toBe(false);
    expect(history.tracks("AGENTS.md")).toBe(false);
  });
});
```

Note on the D0 assertion of the message: isomorphic-git ends a commit message with a newline; check the exact form against an existing commit in `history.test.ts` (`parseCommitMessage` trims it) and adjust only that literal if it differs.

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/workspace/test/history-index.test.ts`
Expected: FAIL (`history2.fileCommits is not a function`).

- [ ] **Step 3: Change `history.ts`**

Imports:

```ts
import { FileIndex, type FileIndexData, addCommit, emptyIndex } from "./file-index";
import { namedPath } from "./file-timeline";
```

Constants next to `MAX_WALK_BACK`:

```ts
/** How far back a read follows commits another History made before it rebuilds the file index instead. */
const MAX_CATCH_UP = 2000;
```

Exported type next to `RestoreResult`:

```ts
/** A commit and the tracked paths it touched (plus the path an `Answer:`/`Approved:` subject names). */
export interface CommitPaths {
  sha: string;
  paths: string[];
}
```

Fields and methods in `History` (after `private queue`):

```ts
  // Lazy: a field initializer would run before the constructor's parameter properties are set.
  private fileIndex: FileIndex | null = null;
  private get index(): FileIndex {
    return (this.fileIndex ??= new FileIndex(this.gitdir));
  }
  private readonly commitListeners = new Set<(c: CommitPaths) => void>();
  /** The index being brought up to date, shared by every read meanwhile. */
  private updating: Promise<FileIndexData> | null = null;

  /** Told after every commit, with the paths it touched (the window refreshes a file's timeline). */
  onCommit(listener: (c: CommitPaths) => void): () => void {
    this.commitListeners.add(listener);
    return () => void this.commitListeners.delete(listener);
  }

  /** Whether the history tracks `file` (relative, forward slashes). */
  tracks(file: string): boolean {
    return this.tracked(file);
  }
```

`saveNow` collects the paths it stages and tells the index and the listeners after the commit. Replace it with:

```ts
  private async saveNow(message: string, only?: ReadonlySet<string>): Promise<string | null> {
    const parent = await this.last();
    const filter = only ? (file: string) => only.has(file) && this.tracked(file) : this.tracked;
    const matrix = await git.statusMatrix({ ...this.repo(), filter });
    const paths: string[] = [];
    for (const [file, head, workdir, stage] of matrix) {
      if (head === 1 && workdir === 1 && stage === 1 && !(await this.differsFromHead(file))) continue;
      paths.push(file);
      if (workdir === 0) await git.remove({ ...this.repo(), filepath: file });
      else await git.add({ ...this.repo(), filepath: file });
    }
    if (paths.length === 0 && parent !== null) return null;
    const sha = await git.commit({ ...this.repo(), message, author: AUTHOR });
    await this.refreshHeadTime();
    await this.committed(parent, sha, message, paths);
    return sha;
  }

  /** After a commit: the index (best effort, never failing the commit), then the listeners. */
  private async committed(parent: string | null, sha: string, message: string, staged: string[]): Promise<void> {
    const named = namedPath(parseCommitMessage(message).subject);
    const paths = named !== null && !staged.includes(named) ? [...staged, named] : staged;
    try {
      await this.index.record(parent, sha, paths);
    } catch (err) {
      console.error("Could not update the file index", err);
    }
    for (const l of [...this.commitListeners]) {
      try {
        l({ sha, paths });
      } catch (err) {
        console.error("A commit listener failed", err);
      }
    }
  }
```

(`only` is used by Task 5; every existing caller passes nothing, so what each commit stages is unchanged.)

The reads:

```ts
  /** The commits that touched `file`, oldest first (file-timeline spec §3.3). */
  async fileCommits(file: string): Promise<string[]> {
    const data = await this.currentIndex();
    return Object.hasOwn(data.paths, file) ? data.paths[file] : [];
  }

  private currentIndex(): Promise<FileIndexData> {
    if (!this.updating) {
      this.updating = this.bringIndexUpToDate().finally(() => {
        this.updating = null;
      });
    }
    return this.updating;
  }

  /**
   * The index at HEAD: as it is; caught up on the commits another History made after its head; or rebuilt from the
   * whole log when it is missing or its head is not in this history. Reads git objects only (immutable), so it runs
   * outside the write queue; a commit meanwhile is caught up on by the next read.
   */
  private async bringIndexUpToDate(): Promise<FileIndexData> {
    const head = await this.last();
    if (head === null) return emptyIndex(null);
    const cache = {};
    const data = await this.index.load();
    if (data?.head === head) return data;
    if (data?.head) {
      const newer: string[] = [];
      let at: string | null = head;
      for (let i = 0; at !== null && at !== data.head && i < MAX_CATCH_UP; i++) {
        newer.push(at);
        at = await this.parentOf(at, cache);
      }
      if (at === data.head) {
        for (const sha of newer.reverse()) addCommit(data, sha, await this.pathsOf(sha, cache));
        await this.saveIndex(data);
        return data;
      }
    }
    const fresh = emptyIndex(null);
    const log = await git.log({ fs, gitdir: this.gitdir, ref: head, cache });
    for (const e of log.reverse()) addCommit(fresh, e.oid, await this.pathsOf(e.oid, cache));
    await this.saveIndex(fresh);
    return fresh;
  }

  private async saveIndex(data: FileIndexData): Promise<void> {
    try {
      await this.index.save(data);
    } catch (err) {
      console.error("Could not save the file index", err);
    }
  }

  /** The tracked paths commit `sha` changed against its parent, plus the path its subject names. */
  private async pathsOf(sha: string, cache: object): Promise<string[]> {
    const { commit } = await git.readCommit({ fs, gitdir: this.gitdir, oid: sha, cache });
    const paths = (await this.diff(commit.parent[0] ?? null, sha, cache)).map((c) => c.path);
    const named = namedPath(parseCommitMessage(commit.message).subject);
    if (named !== null && !paths.includes(named)) paths.push(named);
    return paths;
  }
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `corepack pnpm vitest run packages/workspace/test/history-index.test.ts packages/workspace/test/history.test.ts`
Expected: PASS (the existing history tests are the regression check that every commit stages what it staged before).

- [ ] **Step 5: Typecheck, test, commit**

Run: `corepack pnpm typecheck && corepack pnpm test`

```bash
git -C <worktree> add packages/workspace/src/history.ts packages/workspace/test/history-index.test.ts
git -C <worktree> commit -m "feat(workspace): history commits keep the file index; catch-up and rebuild"
```

---
### Task 4: A file's timeline from the history

**Files:**
- Modify: `packages/workspace/src/history.ts`
- Test: `packages/workspace/test/history-timeline.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/workspace/test/history-timeline.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { History, REVIEWS_PREFIX } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-tl-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

let folder: string;
let history: History;
const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
  fs.writeFileSync(path.join(folder, rel), content);
};
const label = (id: string | null) => (id === "spec" ? "Spec writer" : "A question");
const DOC = "specs/filter.md";

beforeEach(async () => {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  folder = path.join(base, "work");
  fs.mkdirSync(folder);
  history = new History(folder, path.join(base, "history.git"), [".harness/", "AGENTS.md"], [REVIEWS_PREFIX]);
  await history.init();
});

describe("History.fileTimeline (file-timeline spec §3)", () => {
  it("an agent's task, the person's answer, an approval, an outside change and a restore", async () => {
    await history.save("Start");
    await history.save("Before message", { task: "t1", action: "spec" });
    write(DOC, "Filter by size.\n");
    const turn = (await history.save("Turn: write the spec", { task: "t1", action: "spec" }))!;
    write(DOC, "Filter by size and colour.\n");
    await history.save(`Answer: ${DOC} · Size only?`, { task: "t1", action: "spec" });
    write(`${REVIEWS_PREFIX}${DOC}.json`, "{}");
    await history.save(`Approved: ${DOC}`, { task: "t1", action: "spec" });
    write(DOC, "Filter by colour.\n");
    await history.save("Before message", { task: "t2" });
    await history.restore(turn, "Went back to an earlier point");
    const entries = await history.fileTimeline(DOC, label);
    expect(entries.map((e) => [e.kind, e.author.label])).toEqual([
      ["goBack", "You"],
      ["outside", "Outside the app"],
      ["approval", "You"],
      ["answers", "You"],
      ["task", "Spec writer"],
    ]);
    expect(entries[0].back).toEqual({ at: entries[4].at });
    expect(entries[2].version).toBe(1);
    expect(entries[4].from).not.toBeNull();
    expect(await history.readBytesAt(entries[4].from!, DOC)).toBeNull();
    expect((await history.readBytesAt(entries[4].to, DOC))?.toString()).toBe("Filter by size.\n");
  });

  it("a deleted file ends with a Deleted entry; nothing yet: no entries", async () => {
    expect(await history.fileTimeline(DOC, label)).toEqual([]);
    write(DOC, "x");
    await history.save("Turn: write", { task: "t1" });
    fs.rmSync(path.join(folder, DOC));
    await history.save("Turn: remove", { task: "t2" });
    const [gone, made] = await history.fileTimeline(DOC, label);
    expect(gone.deleted).toBe(true);
    expect(made.deleted).toBeUndefined();
  });

  it("reads at most `max` commits, the newest", async () => {
    for (let i = 0; i < 5; i++) {
      write("a.md", String(i));
      await history.save(`Turn: ${i}`, { task: `t${i}` });
    }
    const entries = await history.fileTimeline("a.md", label, 3);
    expect(entries.map((e) => e.commits[0].subject)).toEqual(["Turn: 4", "Turn: 3", "Turn: 2"]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/workspace/test/history-timeline.test.ts`
Expected: FAIL (`history.fileTimeline is not a function`).

- [ ] **Step 3: Add `entryAt`, `readBytesAt` and `fileTimeline` to `History`**

Imports: add `type TimelineCommit, type TimelineEntry, groupTimeline` to the `./file-timeline` import.

Constant:

```ts
/** The newest commits of a file a timeline reads (Open questions Q7). */
export const MAX_TIMELINE_COMMITS = 1000;
```

Methods:

```ts
  /** `file`'s mode and blob id at commit `sha`, without reading the blob; null when it is not there. */
  private async entryAt(sha: string, file: string, cache: object = {}): Promise<{ mode: number; oid: string } | null> {
    const cut = file.lastIndexOf("/");
    const dir = cut < 0 ? undefined : file.slice(0, cut);
    const name = file.slice(cut + 1);
    try {
      const { tree } = await git.readTree({ fs, gitdir: this.gitdir, oid: sha, ...(dir ? { filepath: dir } : {}), cache });
      const e = tree.find((t) => t.path === name && t.type === "blob");
      return e ? { mode: parseInt(e.mode, 8), oid: e.oid } : null;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "NotFoundError" || code === "ObjectTypeError") return null;
      throw err;
    }
  }

  /** `file`'s bytes at commit `sha`; null when the commit or the file isn't there. */
  async readBytesAt(sha: string, file: string): Promise<Buffer | null> {
    try {
      const { blob } = await git.readBlob({ fs, gitdir: this.gitdir, oid: sha, filepath: file });
      return Buffer.from(blob);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "NotFoundError" || code === "ObjectTypeError") return null;
      throw err;
    }
  }

  /** `file`'s timeline, newest first (file-timeline spec §3), from at most its `max` newest commits. */
  async fileTimeline(file: string, actionLabel: (id: string | null) => string, max = MAX_TIMELINE_COMMITS): Promise<TimelineEntry[]> {
    const ids = (await this.fileCommits(file)).slice(-max);
    const cache = {};
    const commits: TimelineCommit[] = [];
    for (const id of ids) {
      const { commit } = await git.readCommit({ fs, gitdir: this.gitdir, oid: id, cache });
      const { subject, task, action } = parseCommitMessage(commit.message);
      commits.push({
        id,
        parent: commit.parent[0] ?? null,
        subject,
        task,
        action,
        at: new Date(commit.author.timestamp * 1000).toISOString(),
        blob: (await this.entryAt(id, file, cache))?.oid ?? null,
      });
    }
    return groupTimeline(commits, file, actionLabel);
  }
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `corepack pnpm vitest run packages/workspace/test/history-timeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit**

Run: `corepack pnpm typecheck && corepack pnpm test`

```bash
git -C <worktree> add packages/workspace/src/history.ts packages/workspace/test/history-timeline.test.ts
git -C <worktree> commit -m "feat(workspace): read a file's timeline and its bytes at a commit"
```

---

### Task 5: Going back one file

**Files:**
- Modify: `packages/workspace/src/history.ts`
- Test: `packages/workspace/test/history-restore-file.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/workspace/test/history-restore-file.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import git from "isomorphic-git";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { History } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-rf-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

let folder: string;
let gitdir: string;
let history: History;
const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
  fs.writeFileSync(path.join(folder, rel), content);
};
const read = (rel: string) => fs.readFileSync(path.join(folder, rel), "utf8");

beforeEach(async () => {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  folder = path.join(base, "work");
  gitdir = path.join(base, "history.git");
  fs.mkdirSync(folder);
  history = new History(folder, gitdir, [".harness/", "AGENTS.md"]);
  await history.init();
});

describe("History.restoreFile (file-timeline spec §5)", () => {
  it("brings back one file and commits only it; other edits stay uncommitted", async () => {
    write("a.md", "a1");
    write("b.md", "b1");
    const v1 = (await history.save("Turn: one", { task: "t1" }))!;
    write("a.md", "a2");
    write("b.md", "b2");
    await history.save("Turn: two", { task: "t2" });
    write("b.md", "b3 (the person's, not committed)");
    const r = await history.restoreFile("a.md", v1, "Go back: a.md to v1");
    expect(r.skipped).toEqual([]);
    expect(read("a.md")).toBe("a1");
    expect(read("b.md")).toBe("b3 (the person's, not committed)");
    expect(await git.listFiles({ fs, gitdir, ref: r.sha! })).toEqual(["a.md", "b.md"]);
    expect((await history.readBytesAt(r.sha!, "b.md"))?.toString()).toBe("b2");
    const { commit } = await git.readCommit({ fs, gitdir, oid: r.sha! });
    expect(commit.message.trim()).toBe("Go back: a.md to v1");
    // The next save takes the person's edit.
    expect(await history.save("Before message")).not.toBeNull();
  });

  it("a deleted file comes back with its folders", async () => {
    write("deep/er/c.md", "c");
    const v1 = (await history.save("Turn: make", { task: "t1" }))!;
    fs.rmSync(path.join(folder, "deep"), { recursive: true });
    await history.save("Turn: delete", { task: "t2" });
    await history.restoreFile("deep/er/c.md", v1, "Go back: deep/er/c.md to v1");
    expect(read("deep/er/c.md")).toBe("c");
  });

  it("the same content: no commit", async () => {
    write("a.md", "a1");
    const v1 = (await history.save("Turn: one"))!;
    expect(await history.restoreFile("a.md", v1, "Go back: a.md to v1")).toEqual({ sha: null, skipped: [] });
  });

  it("never writes through a linked folder", async () => {
    write("d/c.md", "c");
    const v1 = (await history.save("Turn: make"))!;
    const outside = fs.mkdtempSync(path.join(root, "out-"));
    fs.rmSync(path.join(folder, "d"), { recursive: true });
    fs.symlinkSync(outside, path.join(folder, "d"));
    const r = await history.restoreFile("d/c.md", v1, "Go back: d/c.md to v1");
    expect(r).toEqual({ sha: null, skipped: ["d/c.md"] });
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("refuses a path the history does not track or a version without it", async () => {
    write("a.md", "a1");
    const v1 = (await history.save("Turn: one"))!;
    await expect(history.restoreFile(".harness/tasks.json", v1, "x")).rejects.toThrow("not tracked");
    await expect(history.restoreFile("nope.md", v1, "x")).rejects.toThrow("not in that version");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/workspace/test/history-restore-file.test.ts`
Expected: FAIL (`history.restoreFile is not a function`).

- [ ] **Step 3: Extract the restore's write, add `restoreFile`**

In `restoreNow`, the body of the second loop (`for (const [file, { mode, oid }] of target)`) becomes a call to a new method, so a whole restore and a one-file restore write the same way:

```ts
    for (const [file, entry] of target) await this.writeEntry(root, file, entry, staysInside, (dir) => inside.delete(dir), skip);
```

```ts
  /**
   * Writes one entry of a restore point (never through a link): a link entry as a link, a file with O_NOFOLLOW; its
   * parent's real path checked before and again right after `mkdir`. False when it was skipped.
   */
  private async writeEntry(
    root: string,
    file: string,
    { mode, oid }: { mode: number; oid: string },
    staysInside: (dir: string) => Promise<boolean>,
    forget: (dir: string) => void,
    skip: (file: string, why: unknown) => void,
  ): Promise<boolean> {
    const absolute = path.join(this.folder, file);
    const parent = path.dirname(absolute);
    if (!(await staysInside(parent))) {
      skip(file, "its folder leads outside the folder");
      return false;
    }
    try {
      const { blob } = await git.readBlob({ ...this.repo(), oid });
      const wanted = Buffer.from(blob);
      const existing = await fs.promises.lstat(absolute).catch(() => null);
      if (existing?.isDirectory()) {
        skip(file, "a folder is in its place");
        return false;
      }
      if (mode === LINK_MODE) {
        if (existing?.isSymbolicLink() && wanted.equals(await fs.promises.readlink(absolute, { encoding: "buffer" }))) return true;
      } else if (existing?.isFile() && wanted.equals(await fs.promises.readFile(absolute))) return true;
      // unlink removes a link itself, never its target.
      if (existing) await fs.promises.unlink(absolute);
      await fs.promises.mkdir(parent, { recursive: true });
      // mkdir follows links: check again, as close to the write as possible.
      if (!(await resolvesInside(root, parent))) {
        forget(parent);
        skip(file, "its folder leads outside the folder");
        return false;
      }
      if (mode === LINK_MODE) await fs.promises.symlink(wanted.toString(), absolute);
      else await writeNoFollow(absolute, wanted, mode & 0o111 ? 0o777 : 0o666);
      return true;
    } catch (err) {
      skip(file, err);
      return false;
    }
  }

  /**
   * Brings `file` back to how it was at `sha`, and nothing else (file-timeline spec §5): the commit stages only that
   * path, so the person's other edits wait for the next commit. Untagged, like every restore.
   */
  restoreFile(file: string, sha: string, message: string): Promise<RestoreResult> {
    return this.serialize(async () => {
      if (!this.tracked(file)) throw new Error("That file is not tracked");
      const entry = await this.entryAt(sha, file);
      if (!entry) throw new Error("That file is not in that version");
      const root = await fs.promises.realpath(this.folder);
      const skipped: string[] = [];
      const written = await this.writeEntry(
        root,
        file,
        entry,
        (dir) => resolvesInside(root, dir),
        () => undefined,
        (f, why) => {
          console.error(`Restore skipped ${f}`, why);
          skipped.push(f);
        },
      );
      if (!written) return { sha: null, skipped };
      return { sha: await this.saveNow(withTrailer(message), new Set([file])), skipped };
    });
  }
```

The test expects `rejects.toThrow("not tracked")` and `"not in that version"`: the messages above contain both.

- [ ] **Step 4: Run the tests to see them pass**

Run: `corepack pnpm vitest run packages/workspace/test/history-restore-file.test.ts packages/workspace/test/history.test.ts`
Expected: PASS (the existing restore tests check the extracted `writeEntry`).

- [ ] **Step 5: Typecheck, test, commit**

Run: `corepack pnpm typecheck && corepack pnpm test`

```bash
git -C <worktree> add packages/workspace/src/history.ts packages/workspace/test/history-restore-file.test.ts
git -C <worktree> commit -m "feat(workspace): bring one file back to a version"
```

---

### Task 6: Line and word changes, binary files, text diffs

**Files:**
- Modify: `packages/workspace/package.json`, `pnpm-lock.yaml` (by `pnpm install`), `packages/workspace/src/index.ts`
- Create: `packages/workspace/src/file-diff.ts`
- Test: `packages/workspace/test/file-diff.test.ts`

- [ ] **Step 1: Add the dependencies**

In `packages/workspace/package.json`:

```json
  "dependencies": {
    "@humanharness/engines": "workspace:*",
    "@humanharness/harness-sdk": "workspace:*",
    "diff": "^9.0.0",
    "isomorphic-git": "^1.43.3",
    "remark-gfm": "^4.0.1",
    "remark-parse": "^11.0.0",
    "unified": "^11.0.5",
    "zod": "^4.6.5"
  },
  "devDependencies": { "@types/mdast": "^4.0.4" }
```

Run: `corepack pnpm install --offline`
Expected: the lockfile gains only the importer lines for `packages/workspace` (every package is already in it: `diff@9.0.0` and the remark packages are resolved). If `--offline` fails, run `corepack pnpm install` and check `git -C <worktree> diff --stat pnpm-lock.yaml` touches only the workspace importer. jsdiff 9 ships its own types.

- [ ] **Step 2: Write the failing tests**

Create `packages/workspace/test/file-diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MAX_DIFF_BYTES, cutBytes, diffFile, isBinary, lineChanges, wordParts } from "../src/file-diff";

const side = (text: string) => ({ kind: "bytes" as const, bytes: Buffer.from(text), size: Buffer.byteLength(text) });
const absent = { kind: "absent" as const };
/** One side of a word diff, read back: the common parts plus that side's own. */
const sideOf = (parts: { kind: string; text: string }[], kind: "del" | "ins") => parts.filter((p) => p.kind === "same" || p.kind === kind).map((p) => p.text).join("");

describe("file diff basics (file-timeline spec §4)", () => {
  it("line changes carry old and new line numbers", () => {
    expect(lineChanges("a\nb\nc\n", "a\nB\nc\nd\n")).toEqual([
      { kind: "same", text: "a", old: 1, new: 1 },
      { kind: "del", text: "b", old: 2 },
      { kind: "ins", text: "B", new: 2 },
      { kind: "same", text: "c", old: 3, new: 3 },
      { kind: "ins", text: "d", new: 4 },
    ]);
  });

  it("word parts keep the spaces: each side reads back whole", () => {
    const parts = wordParts("Filter by size.", "Filter by size and colour.");
    expect(sideOf(parts, "del")).toBe("Filter by size.");
    expect(sideOf(parts, "ins")).toBe("Filter by size and colour.");
    expect(parts[0]).toEqual({ kind: "same", text: expect.stringContaining("Filter by ") });
    expect(parts.some((p) => p.kind === "ins" && p.text.includes("colour"))).toBe(true);
    expect(wordParts("same", "same")).toEqual([{ kind: "same", text: "same" }]);
  });

  it("binary: a NUL in the first 8 KB, or a known extension", () => {
    expect(isBinary("a.txt", Buffer.from("plain"))).toBe(false);
    expect(isBinary("a.txt", Buffer.from([65, 0, 66]))).toBe(true);
    expect(isBinary("photo.PNG", Buffer.from("not really"))).toBe(true);
    expect(isBinary("a.txt", Buffer.concat([Buffer.alloc(9000, 65), Buffer.from([0])]))).toBe(false);
  });

  it("cuts to whole UTF-8 characters", () => {
    expect(cutBytes(Buffer.from("aé"), 2).toString()).toBe("a");
  });

  it("a text file: lines, its language from the extension, same or not", () => {
    const d = diffFile("src/a.ts", side("let a = 1;\n"), side("let a = 2;\n"));
    expect(d).toMatchObject({ ok: true, kind: "text", same: false, truncated: false, lang: "ts" });
    expect(diffFile("notes.txt", side("x"), side("x"))).toMatchObject({ kind: "text", same: true, lang: null });
    expect(diffFile("new.txt", absent, side("x\n"))).toMatchObject({ kind: "text", lines: [{ kind: "ins", text: "x", new: 1 }] });
  });

  it("binary: sizes only", () => {
    expect(diffFile("a.png", side("12"), absent)).toEqual({ ok: true, kind: "binary", same: false, sizes: { before: 2, after: null } });
  });

  it("large sides are cut to 200 KB, with a notice", () => {
    const big = "x\n".repeat(MAX_DIFF_BYTES);
    expect(diffFile("big.txt", side(big), side(`${big}y\n`))).toMatchObject({ kind: "text", truncated: true, same: false });
  });

  it("never stalls on long runs of spaces (no backtracking on document text)", () => {
    const start = performance.now();
    wordParts(`${" ".repeat(50_000)}a`, `${" ".repeat(50_000)}b`);
    lineChanges(`${" ".repeat(50_000)}\n`, `${" ".repeat(49_999)}\n`);
    expect(performance.now() - start).toBeLessThan(2500);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `corepack pnpm vitest run packages/workspace/test/file-diff.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Write `file-diff.ts` (text part)**

Create `packages/workspace/src/file-diff.ts`:

```ts
import { diffLines, diffWordsWithSpace } from "diff";

/** Each side of a diff is cut to this many bytes (file-timeline spec §4.2 "Large files"). */
export const MAX_DIFF_BYTES = 200 * 1024;
/** jsdiff gives up after this long; the piece then shows as all removed, then all added. */
export const DIFF_TIMEOUT_MS = 2000;
/** Bytes looked at for a NUL. */
const SNIFF_BYTES = 8 * 1024;
const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "heic", "ico", "bmp", "tif", "tiff", "psd",
  "mp3", "wav", "m4a", "aac", "flac", "ogg", "mp4", "mov", "m4v", "avi", "mkv", "webm",
  "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "tar", "dmg", "pdf",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "key", "numbers", "pages", "odt", "ods", "odp",
  "woff", "woff2", "ttf", "otf", "eot", "sqlite", "db", "bin", "exe", "dll", "so", "dylib", "class", "jar", "wasm",
]);

export type DiffPart = { kind: "same" | "ins" | "del"; text: string };
/** One line of a line diff; `old`/`new` are 1-based line numbers on each side. */
export interface LineChange {
  kind: "same" | "ins" | "del";
  text: string;
  old?: number;
  new?: number;
}
/** One side of a diff: the file's bytes (with its full size), or no file. */
export type DiffSide = { kind: "absent" } | { kind: "bytes"; bytes: Uint8Array; size: number };

/** The lower-case extension of `file` (no dot), or "". */
export function extensionOf(file: string): string {
  const name = file.slice(file.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function isBinary(file: string, bytes: Uint8Array): boolean {
  if (BINARY_EXTENSIONS.has(extensionOf(file))) return true;
  return bytes.subarray(0, SNIFF_BYTES).includes(0);
}

/** The first `max` bytes of `bytes`, backed up to the start of a UTF-8 character. */
export function cutBytes(bytes: Uint8Array, max: number): Uint8Array {
  if (bytes.length <= max) return bytes;
  let end = max;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end);
}

/** Splits jsdiff's value into lines (its last line ending dropped), without a regex. */
function splitLines(value: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = value.indexOf("\n"); i !== -1; i = value.indexOf("\n", start)) {
    out.push(value.slice(start, i));
    start = i + 1;
  }
  if (start < value.length) out.push(value.slice(start));
  return out;
}

/** A line diff with line numbers; a timed-out diff is every old line removed, then every new line added. */
export function lineChanges(before: string, after: string): LineChange[] {
  const changes = diffLines(before, after, { timeout: DIFF_TIMEOUT_MS }) ?? [
    { value: before, removed: true, added: false, count: 0 },
    { value: after, added: true, removed: false, count: 0 },
  ];
  const out: LineChange[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const c of changes) {
    for (const text of splitLines(c.value)) {
      if (c.added) out.push({ kind: "ins", text, new: ++newNo });
      else if (c.removed) out.push({ kind: "del", text, old: ++oldNo });
      else out.push({ kind: "same", text, old: ++oldNo, new: ++newNo });
    }
  }
  return out;
}

/** A word diff that keeps the spaces; a timed-out diff is the old text removed, then the new one added. */
export function wordParts(before: string, after: string): DiffPart[] {
  const changes = diffWordsWithSpace(before, after, { timeout: DIFF_TIMEOUT_MS });
  if (!changes) return [...(before ? [{ kind: "del" as const, text: before }] : []), ...(after ? [{ kind: "ins" as const, text: after }] : [])];
  return changes.filter((c) => c.value !== "").map((c) => ({ kind: c.added ? "ins" : c.removed ? "del" : "same", text: c.value }));
}

const text = (s: DiffSide): string => (s.kind === "absent" ? "" : Buffer.from(cutBytes(s.bytes, MAX_DIFF_BYTES)).toString("utf8"));
const sizeOf = (s: DiffSide): number | null => (s.kind === "absent" ? null : s.size);
const same = (a: DiffSide, b: DiffSide): boolean =>
  a.kind === "absent" ? b.kind === "absent" : b.kind !== "absent" && a.size === b.size && Buffer.from(a.bytes).equals(Buffer.from(b.bytes));
const truncated = (a: DiffSide, b: DiffSide): boolean => (sizeOf(a) ?? 0) > MAX_DIFF_BYTES || (sizeOf(b) ?? 0) > MAX_DIFF_BYTES;
```

The `FileDiffView` type and `diffFile` (Markdown goes in Task 7; until then `.md` is diffed as text):

```ts
export type FileDiffView =
  | { ok: true; kind: "markdown"; same: boolean; truncated: boolean; blocks: MdDiffBlock[]; source: LineChange[] }
  | { ok: true; kind: "text"; same: boolean; truncated: boolean; lines: LineChange[]; lang: string | null }
  | { ok: true; kind: "binary"; same: boolean; sizes: { before: number | null; after: number | null } };

/** What changed in `file` from `before` to `after` (§4.2): blocks for Markdown, lines for text, sizes for binary. */
export function diffFile(file: string, before: DiffSide, after: DiffSide): FileDiffView {
  const equal = same(before, after);
  const binary = (before.kind === "bytes" && isBinary(file, before.bytes)) || (after.kind === "bytes" && isBinary(file, after.bytes));
  if (binary) return { ok: true, kind: "binary", same: equal, sizes: { before: sizeOf(before), after: sizeOf(after) } };
  const ext = extensionOf(file);
  return { ok: true, kind: "text", same: equal, truncated: truncated(before, after), lines: lineChanges(text(before), text(after)), lang: ext || null };
}
```

For this task declare `MdDiffBlock` as a placeholder-free minimal type so the union compiles, replaced in Task 7 by the full one:

```ts
/** A block of a Markdown diff (Task 7 fills it in). */
export interface MdDiffBlock {
  type: string;
  status: "same" | "added" | "removed" | "changed";
}
```

Add `export * from "./file-diff";` to `packages/workspace/src/index.ts`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `corepack pnpm vitest run packages/workspace/test/file-diff.test.ts`
Expected: PASS. If the line-diff test's expected order of `del`/`ins` differs from jsdiff 9's (it puts removals first), keep the implementation and fix only the literal.

- [ ] **Step 6: Typecheck, test, commit**

Run: `corepack pnpm typecheck && corepack pnpm test`

```bash
git -C <worktree> add packages/workspace/package.json pnpm-lock.yaml packages/workspace/src/file-diff.ts packages/workspace/src/index.ts packages/workspace/test/file-diff.test.ts
git -C <worktree> commit -m "feat(workspace): line and word changes, binary files, text diffs"
```

---

### Task 7: The Markdown diff, block by block

**Files:**
- Modify: `packages/workspace/src/file-diff.ts`
- Test: `packages/workspace/test/file-diff-markdown.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/workspace/test/file-diff-markdown.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { diffFile, diffMarkdown, markdownBlocks } from "../src/file-diff";

const side = (text: string) => ({ kind: "bytes" as const, bytes: Buffer.from(text), size: Buffer.byteLength(text) });

describe("Markdown blocks", () => {
  it("front-matter, headings, paragraphs, list items, table rows, code, Mermaid, callouts", () => {
    const text = [
      "---", "title: Filter", "---", "## Scope", "", "Filter by size.", "", "- one", "- two", "", "| a | b |", "|---|---|", "| 1 | 2 |", "",
      "```ts", "let a = 1;", "```", "", "```mermaid", "graph TD; A-->B", "```", "", "> [!note]", "> Mind the order.", "", "> Plain quote.", "",
    ].join("\n");
    expect(markdownBlocks(text).map((b) => b.type)).toEqual([
      "frontMatter", "heading", "paragraph", "listItem", "listItem", "tableRow", "tableRow", "code", "mermaid", "callout", "quote",
    ]);
    const blocks = markdownBlocks(text);
    expect(blocks[1]).toMatchObject({ source: "## Scope", text: "Scope", depth: 2 });
    expect(blocks[3].source).toBe("- one");
    expect(blocks[6].cells).toEqual(["1", "2"]);
    expect(blocks[7].text).toBe("let a = 1;");
  });
});

describe("diffMarkdown (file-timeline spec §4.2)", () => {
  it("aligns blocks and diffs a changed paragraph word by word", () => {
    const blocks = diffMarkdown("## Scope\n\nFilter by size.\n\nThe list loads.\n", "## Scope\n\nFilter by size and colour.\n\nThe list loads.\n");
    expect(blocks.map((b) => [b.type, b.status])).toEqual([
      ["heading", "same"],
      ["paragraph", "changed"],
      ["paragraph", "same"],
    ]);
    const parts = blocks[1].parts ?? [];
    const read = (kind: string) => parts.filter((p) => p.kind === "same" || p.kind === kind).map((p) => p.text).join("");
    expect(read("del")).toBe("Filter by size.");
    expect(read("ins")).toBe("Filter by size and colour.");
    expect(parts.some((p) => p.kind === "ins" && p.text.includes("colour"))).toBe(true);
    expect(blocks[1].before).toBe("Filter by size.");
    expect(blocks[1].after).toBe("Filter by size and colour.");
  });

  it("a moved paragraph is removed in one place and added in another", () => {
    const blocks = diffMarkdown("A.\n\nB.\n\nC.\n", "B.\n\nC.\n\nA.\n");
    expect(blocks.map((b) => [b.status, b.before ?? b.after])).toEqual([
      ["removed", "A."],
      ["same", "B."],
      ["same", "C."],
      ["added", "A."],
    ]);
  });

  it("a changed table row diffs cell by cell; added and removed rows keep their cells", () => {
    const blocks = diffMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\n", "| a | b |\n|---|---|\n| 1 | 3 |\n| 4 | 5 |\n");
    expect(blocks.map((b) => [b.type, b.status])).toEqual([
      ["tableRow", "same"],
      ["tableRow", "changed"],
      ["tableRow", "added"],
    ]);
    expect(blocks[1].cells).toEqual({
      before: ["1", "2"],
      after: ["1", "3"],
      parts: [[{ kind: "same", text: "1" }], [{ kind: "del", text: "2" }, { kind: "ins", text: "3" }]],
    });
    expect(blocks[2].cells).toEqual({ after: ["4", "5"] });
  });

  it("a changed Mermaid fence keeps both sources and their line diff", () => {
    const [b] = diffMarkdown("```mermaid\ngraph TD; A-->B\n```\n", "```mermaid\ngraph TD; A-->C\n```\n");
    expect(b).toMatchObject({ type: "mermaid", status: "changed" });
    expect(b.before).toContain("A-->B");
    expect(b.after).toContain("A-->C");
    expect(b.lines?.map((l) => l.kind)).toEqual(["del", "ins"]);
  });

  it("different block types never pair: a paragraph turned into a heading is removed + added", () => {
    expect(diffMarkdown("Scope\n", "## Scope\n").map((b) => [b.type, b.status])).toEqual([
      ["paragraph", "removed"],
      ["heading", "added"],
    ]);
  });

  it("diffFile on .md: blocks plus the raw line diff for the Source toggle", () => {
    const d = diffFile("specs/a.md", side("A.\n"), side("B.\n"));
    expect(d).toMatchObject({ ok: true, kind: "markdown", same: false, truncated: false });
    if (d.kind !== "markdown") throw new Error("not markdown");
    expect(d.source.map((l) => l.kind)).toEqual(["del", "ins"]);
    expect(d.blocks).toHaveLength(1);
    expect(diffFile("a.markdown", { kind: "absent" }, side("x\n")).kind).toBe("markdown");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/workspace/test/file-diff-markdown.test.ts`
Expected: FAIL (`markdownBlocks` is not exported).

- [ ] **Step 3: Write the Markdown part**

In `packages/workspace/src/file-diff.ts`, add the imports:

```ts
import { diffArrays } from "diff";
import type { Blockquote, Nodes, RootContent, Table } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { CALLOUTS, splitFrontMatter } from "@humanharness/harness-sdk/documents";
```

(merge `diffArrays` into the existing `diff` import line). Replace the placeholder `MdDiffBlock` with:

```ts
export type MdBlockType = "frontMatter" | "heading" | "paragraph" | "listItem" | "tableRow" | "code" | "mermaid" | "callout" | "quote" | "other";

/** A top-level block of a Markdown text: its exact source, its plain text, and for rows their cells' text. */
export interface MdBlock {
  type: MdBlockType;
  source: string;
  text: string;
  depth?: number;
  cells?: string[];
}

/** A block of a Markdown diff. `before`/`after`: the block's source on each side. */
export interface MdDiffBlock {
  type: MdBlockType;
  status: "same" | "added" | "removed" | "changed";
  before?: string;
  after?: string;
  /** A changed heading, paragraph, list item, callout, quote or other block: its plain text, word by word. */
  parts?: DiffPart[];
  /** A changed code, Mermaid or front-matter block: its lines. */
  lines?: LineChange[];
  /** A table row: its cells on each side, and word parts per cell when it changed. */
  cells?: { before?: string[]; after?: string[]; parts?: DiffPart[][] };
  depth?: number;
}
```

The parser and blocks:

```ts
/** The reader's parser (document-reader spec §3): remark-parse + remark-gfm, no raw HTML path. */
const processor = unified().use(remarkParse).use(remarkGfm);

function plain(node: Nodes): string {
  if ("value" in node && typeof node.value === "string" && node.type !== "html") return node.value;
  if ("children" in node) return (node.children as Nodes[]).map(plain).join(node.type === "listItem" || node.type === "blockquote" ? "\n" : "");
  return "";
}

const slice = (text: string, n: { position?: { start: { offset?: number }; end: { offset?: number } } }): string =>
  text.slice(n.position?.start.offset ?? 0, n.position?.end.offset ?? 0);

/** A blockquote whose first text starts with `[!note]` (or another callout marker), checked without a regex. */
function isCallout(q: Blockquote): boolean {
  const lead = plain(q).trimStart().toLowerCase();
  return lead.startsWith("[!") && CALLOUTS.some((c) => lead.startsWith(`[!${c}]`));
}

function blockOf(body: string, n: RootContent): MdBlock[] {
  switch (n.type) {
    case "heading":
      return [{ type: "heading", source: slice(body, n), text: plain(n), depth: n.depth }];
    case "paragraph":
      return [{ type: "paragraph", source: slice(body, n), text: plain(n) }];
    case "list":
      return n.children.map((item) => ({ type: "listItem" as const, source: slice(body, item), text: plain(item) }));
    case "table":
      return (n as Table).children.map((row) => {
        const cells = row.children.map((cell) => plain(cell));
        return { type: "tableRow" as const, source: slice(body, row), text: cells.join(" | "), cells };
      });
    case "code":
      return [{ type: n.lang?.toLowerCase() === "mermaid" ? "mermaid" : "code", source: slice(body, n), text: n.value }];
    case "blockquote":
      return [{ type: isCallout(n) ? "callout" : "quote", source: slice(body, n), text: plain(n) }];
    default:
      return [{ type: "other", source: slice(body, n), text: slice(body, n) }];
  }
}

/** The text's top-level blocks (§4.2 step 2): front-matter first when there is one. */
export function markdownBlocks(text: string): MdBlock[] {
  const fm = splitFrontMatter(text);
  const head = text.slice(0, text.length - fm.body.length);
  const out: MdBlock[] = head ? [{ type: "frontMatter", source: head.trimEnd(), text: head.trimEnd() }] : [];
  const root = processor.parse(fm.body);
  for (const n of root.children) out.push(...blockOf(fm.body, n));
  return out;
}
```

The diff:

```ts
const byLines = (t: MdBlockType) => t === "code" || t === "mermaid" || t === "frontMatter";

function changed(a: MdBlock, b: MdBlock): MdDiffBlock {
  const base = { type: a.type, status: "changed" as const, before: a.source, after: b.source, ...(b.depth ? { depth: b.depth } : {}) };
  if (byLines(a.type)) return { ...base, lines: lineChanges(a.text, b.text) };
  if (a.type === "tableRow") {
    const before = a.cells ?? [];
    const after = b.cells ?? [];
    const parts = Array.from({ length: Math.max(before.length, after.length) }, (_, i) => wordParts(before[i] ?? "", after[i] ?? ""));
    return { ...base, cells: { before, after, parts } };
  }
  return { ...base, parts: wordParts(a.text, b.text) };
}

const removed = (a: MdBlock): MdDiffBlock => ({ type: a.type, status: "removed", before: a.source, ...(a.depth ? { depth: a.depth } : {}), ...(a.cells ? { cells: { before: a.cells } } : {}) });
const added = (b: MdBlock): MdDiffBlock => ({ type: b.type, status: "added", after: b.source, ...(b.depth ? { depth: b.depth } : {}), ...(b.cells ? { cells: { after: b.cells } } : {}) });
const kept = (b: MdBlock): MdDiffBlock => ({ type: b.type, status: "same", before: b.source, after: b.source, ...(b.depth ? { depth: b.depth } : {}), ...(b.cells ? { cells: { before: b.cells, after: b.cells } } : {}) });

/**
 * Blocks aligned on their source (§4.2): in a run of removed-then-added blocks, the i-th of each pair up when they are
 * the same type ("changed"); the rest stay removed or added.
 */
export function diffMarkdown(before: string, after: string): MdDiffBlock[] {
  const a = markdownBlocks(before);
  const b = markdownBlocks(after);
  const changes = diffArrays(a, b, { comparator: (x, y) => x.type === y.type && x.source === y.source, timeout: DIFF_TIMEOUT_MS }) ?? [
    { value: a, removed: true, added: false, count: a.length },
    { value: b, added: true, removed: false, count: b.length },
  ];
  const out: MdDiffBlock[] = [];
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    if (!c.added && !c.removed) {
      out.push(...c.value.map(kept));
      continue;
    }
    const gone = c.removed ? c.value : [];
    const next = c.removed && changes[i + 1]?.added ? changes[++i].value : c.added ? c.value : [];
    const pairs = Math.min(gone.length, next.length);
    for (let k = 0; k < pairs; k++) {
      if (gone[k].type === next[k].type) out.push(changed(gone[k], next[k]));
      else out.push(removed(gone[k]), added(next[k]));
    }
    out.push(...gone.slice(pairs).map(removed), ...next.slice(pairs).map(added));
  }
  return out;
}
```

In `diffFile`, before the text branch:

```ts
  if (ext === "md" || ext === "markdown") {
    const a = text(before);
    const b = text(after);
    return { ok: true, kind: "markdown", same: equal, truncated: truncated(before, after), blocks: diffMarkdown(a, b), source: lineChanges(a, b) };
  }
```

(move `const ext = extensionOf(file);` above it).

- [ ] **Step 4: Run the tests to see them pass**

Run: `corepack pnpm vitest run packages/workspace/test/file-diff-markdown.test.ts packages/workspace/test/file-diff.test.ts`
Expected: PASS. If `plain()` of a list item or a callout gives other separators than the test's literals, fix the separator in `plain` (the cards' text in Task 11 uses it) rather than the test.

- [ ] **Step 5: Typecheck, test, commit**

Run: `corepack pnpm typecheck && corepack pnpm test`

```bash
git -C <worktree> add packages/workspace/src/file-diff.ts packages/workspace/test/file-diff-markdown.test.ts
git -C <worktree> commit -m "feat(workspace): Markdown diff by block, word by word inside a block"
```

---

### Task 8: The main process — `FileTimelineService`

**Files:**
- Modify: `packages/workspace/src/safe-read.ts`
- Create: `packages/shell/src/main/file-timeline.ts`
- Test: `packages/shell/test/file-timeline.test.ts`

The result types (`FileRefusal`, `FileTimelineResult`, `FileDiffResult`, `FileRestorePrompt…`) are declared in `packages/ui/src/client.ts` in Task 9; this task declares them first (Step 3) so the service compiles, and Task 9 adds the client interface around them.

- [ ] **Step 1: Write the failing tests**

Create `packages/shell/test/file-timeline.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { History, REVIEWS_PREFIX } from "@humanharness/workspace";
import { FileTimelineService } from "../src/main/file-timeline";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-fts-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const DOC = "specs/filter.md";
let folder: string;
let history: History;
let busy: boolean;
let restored: number;
let approvals: { blob: string; at: string; reason?: string }[];
let svc: FileTimelineService;
const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
  fs.writeFileSync(path.join(folder, rel), content);
};

beforeEach(async () => {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  folder = path.join(base, "work");
  fs.mkdirSync(folder);
  history = new History(folder, path.join(base, "history.git"), [".harness/", "AGENTS.md"], [REVIEWS_PREFIX]);
  await history.init();
  busy = false;
  restored = 0;
  approvals = [];
  svc = new FileTimelineService({
    base: async () => folder,
    history: async () => history,
    actionLabel: (id) => (id === "spec" ? "Spec writer" : "A question"),
    approvals: async () => approvals,
    busy: () => busy,
    restore: async (run) => void (await run(history)),
    restored: () => void restored++,
  });
});

async function writeSpec() {
  await history.save("Start");
  write(DOC, "## Scope\n\nFilter by size.\n");
  const t1 = (await history.save("Turn: write", { task: "t1", action: "spec" }))!;
  write(DOC, "## Scope\n\nFilter by size and colour.\n");
  const t2 = (await history.save("Turn: edit", { task: "t2", action: "spec" }))!;
  return { t1, t2 };
}

describe("FileTimelineService (file-timeline spec §3–§5)", () => {
  it("refuses bad, outside and untracked paths, as data", async () => {
    expect(await svc.timeline("../x.md")).toEqual({ ok: false, reason: "outside" });
    expect(await svc.timeline("/etc/passwd")).toEqual({ ok: false, reason: "outside" });
    expect(await svc.timeline(42)).toEqual({ ok: false, reason: "outside" });
    expect(await svc.timeline(".harness/tasks.json")).toEqual({ ok: false, reason: "untracked" });
    expect(await svc.timeline("AGENTS.md")).toEqual({ ok: false, reason: "untracked" });
    expect(await svc.timeline("new.md")).toEqual({ ok: true, entries: [] });
  });

  it("not ready without a folder or a history", async () => {
    const off = new FileTimelineService({ base: async () => null, history: async () => null, actionLabel: () => "", approvals: async () => [], busy: () => false, restore: async () => undefined, restored: () => undefined });
    expect(await off.timeline(DOC)).toEqual({ ok: false, reason: "not-ready" });
  });

  it("the timeline, normalised path, with an approval's reason", async () => {
    const { t2 } = await writeSpec();
    write(`${REVIEWS_PREFIX}${DOC}.json`, "{}");
    await history.save(`Approved: ${DOC}`, { task: "t2", action: "spec" });
    approvals = [{ blob: "b".repeat(40), at: "2026-10-28T10:00:00.000Z", reason: "Decided on the call" }];
    const r = await svc.timeline(`./specs//filter.md`);
    if (!r.ok) throw new Error(r.reason);
    expect(r.entries.map((e) => [e.kind, e.author.label])).toEqual([
      ["approval", "You"],
      ["task", "Spec writer"],
      ["task", "Spec writer"],
    ]);
    expect(r.entries[0].reason).toBe(true);
    expect(r.entries[1].to).toBe(t2);
  });

  it("a diff between two commits, and against the current file", async () => {
    const { t1, t2 } = await writeSpec();
    const here = await svc.diff(DOC, t1, t2);
    expect(here).toMatchObject({ ok: true, kind: "markdown", same: false });
    write(DOC, "## Scope\n\nFilter by size and colour.\n");
    expect(await svc.diff(DOC, t2, "current")).toMatchObject({ ok: true, same: true });
    expect(await svc.diff(DOC, null, t1)).toMatchObject({ ok: true, kind: "markdown" });
    expect(await svc.diff(DOC, "nope", t1)).toEqual({ ok: false, reason: "bad-input" });
    fs.rmSync(path.join(folder, DOC));
    expect(await svc.diff(DOC, t2, "current")).toMatchObject({ ok: true, same: false });
  });

  it("the current side never follows a link out of the folder", async () => {
    const { t2 } = await writeSpec();
    const outside = path.join(root, "secret.md");
    fs.writeFileSync(outside, "secret");
    fs.rmSync(path.join(folder, DOC));
    fs.symlinkSync(outside, path.join(folder, DOC));
    expect(await svc.diff(DOC, t2, "current")).toEqual({ ok: false, reason: "outside" });
  });

  it("restore: a prompt for an entry's version, then one file back, untagged, with its own commit", async () => {
    const { t1 } = await writeSpec();
    expect(await svc.restorePrompt(DOC, "f".repeat(40))).toEqual({ ok: false, reason: "not-found" });
    const p = await svc.restorePrompt(DOC, t1);
    expect(p).toMatchObject({ ok: true, prompt: { path: DOC, author: { label: "Spec writer" }, kind: "task" } });
    expect(await svc.restore(DOC, t1)).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(folder, DOC), "utf8")).toBe("## Scope\n\nFilter by size.\n");
    expect(restored).toBe(1);
    const r = await svc.timeline(DOC);
    if (!r.ok) throw new Error(r.reason);
    expect(r.entries[0]).toMatchObject({ kind: "goBack", author: { kind: "person" }, back: { at: expect.any(String) } });
    expect(r.entries[0].commits[0].subject.startsWith(`Go back: ${DOC} to the version of `)).toBe(true);
  });

  it("restore is refused while a turn runs, and a deleted entry can't be the target", async () => {
    const { t1 } = await writeSpec();
    busy = true;
    expect(await svc.restorePrompt(DOC, t1)).toEqual({ ok: false, reason: "busy" });
    expect(await svc.restore(DOC, t1)).toEqual({ ok: false, reason: "busy" });
    busy = false;
    fs.rmSync(path.join(folder, DOC));
    const gone = (await history.save("Turn: remove", { task: "t3" }))!;
    expect(await svc.restorePrompt(DOC, gone)).toEqual({ ok: false, reason: "deleted" });
    expect(await svc.restore(DOC, t1)).toEqual({ ok: true });
    expect(fs.existsSync(path.join(folder, DOC))).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/shell/test/file-timeline.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Declare the result types in `client.ts`**

Add to `packages/ui/src/client.ts`, after the review types at the end:

```ts
export type { DiffPart, FileDiffView, LineChange, MdBlockType, MdDiffBlock, TimelineAuthor, TimelineEntry, TimelineKind } from "@humanharness/workspace";
import type { FileDiffView, TimelineAuthor, TimelineEntry, TimelineKind } from "@humanharness/workspace";

/** Why a file-timeline call did nothing (file-timeline spec; errors over IPC are data). */
export type FileRefusal = "not-ready" | "outside" | "untracked" | "bad-input" | "not-found" | "deleted" | "busy" | "unsafe" | "failed";
export type FileTimelineResult = { ok: true; entries: TimelineEntry[] } | { ok: false; reason: FileRefusal };
export type FileDiffResult = FileDiffView | { ok: false; reason: FileRefusal };
/** What the core's confirmation says before a file goes back (§5). */
export interface FileRestorePrompt {
  path: string;
  author: TimelineAuthor;
  at: string;
  kind: TimelineKind;
  version?: number;
}
export type FileRestorePromptResult = { ok: true; prompt: FileRestorePrompt } | { ok: false; reason: FileRefusal };
export type FileRestoreAnswer = { ok: true } | { ok: false; reason: FileRefusal };
/** `client.files.restore`'s answer: done, the person said no (or no core is there to ask), or refused. */
export type FileRestoreResult = "restored" | "cancelled" | { refused: FileRefusal };
```

(Put the `import type` line with the other `import type` lines at the top of the file.)

- [ ] **Step 4: Add `readPrefix` to `safe-read.ts`**

Refactor `readCapped` so both share one opening path:

```ts
/** Opens `file` as `readCapped` does (checked, no link, not blocking, a regular file with one name); null when not safe. */
async function openSafe(file: string, stillSafe: () => Promise<boolean>): Promise<{ handle: fs.FileHandle; size: number; mtime: Date } | null> {
  if (!(await stillSafe())) return null;
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null);
  if (!handle) return null;
  const stat = await handle.stat();
  const there = await fs.stat(file).catch(() => null);
  if (!stat.isFile() || stat.nlink > 1 || !there || there.dev !== stat.dev || there.ino !== stat.ino || !(await stillSafe())) {
    await handle.close();
    return null;
  }
  return { handle, size: stat.size, mtime: stat.mtime };
}

async function readUpTo(handle: fs.FileHandle, length: number): Promise<Buffer> {
  const bytes = Buffer.alloc(length);
  let read = 0;
  while (read < bytes.length) {
    const { bytesRead } = await handle.read(bytes, read, bytes.length - read, read);
    if (bytesRead === 0) break;
    read += bytesRead;
  }
  return bytes.subarray(0, read);
}

export async function readCapped(file: string, max: number, stillSafe: () => Promise<boolean>): Promise<CappedRead> {
  const open = await openSafe(file, stillSafe);
  if (!open) return null;
  try {
    if (open.size > max) return { size: open.size };
    return { bytes: await readUpTo(open.handle, open.size), mtime: open.mtime };
  } finally {
    await open.handle.close();
  }
}

/** The first `max` bytes of `file` and its whole size, with `readCapped`'s checks (file-timeline spec §4.2 "Large files"). */
export async function readPrefix(file: string, max: number, stillSafe: () => Promise<boolean>): Promise<{ bytes: Buffer; size: number } | null> {
  const open = await openSafe(file, stillSafe);
  if (!open) return null;
  try {
    return { bytes: await readUpTo(open.handle, Math.min(open.size, max)), size: open.size };
  } finally {
    await open.handle.close();
  }
}
```

(`fs` there is `promises as fs`; its `FileHandle` type is `import("node:fs/promises").FileHandle`; import it as `import type { FileHandle } from "node:fs/promises";` and use `FileHandle`.) The existing `readCapped` tests stay green.

- [ ] **Step 5: Write `file-timeline.ts`**

Create `packages/shell/src/main/file-timeline.ts`:

```ts
import path from "node:path";
import { isMarkdownPath, refusedShape } from "@humanharness/harness-sdk/documents";
import type { FileDiffResult, FileRefusal, FileRestoreAnswer, FileRestorePromptResult, FileTimelineResult, TimelineEntry } from "@humanharness/ui/client";
import { type DiffSide, FILE_RESTORE_PREFIX, type History, MAX_DIFF_BYTES, canonicalDocumentPath, diffFile, readPrefix } from "@humanharness/workspace";
import { locate } from "./documents";
import { isSha } from "./history-view";
import { stillSafe } from "./open-path";

export interface FileTimelineDeps {
  /** The person's folder (the active profile's); null when the app isn't set up. */
  base(): Promise<string | null>;
  /** The history of that folder; null while it moves or before setup. */
  history(): Promise<History | null>;
  /** The label of a task's action; null: a free question. */
  actionLabel(id: string | null): string;
  /** A document's approvals from its review record, oldest first; [] without one. */
  approvals(base: string, doc: string): Promise<{ blob: string; at: string; reason?: string }[]>;
  /** A turn or a task operation runs, turns are held, or the app quits: a go-back waits. */
  busy(): boolean;
  /** Runs a go-back through the restore guard (`restoreWith`): one at a time, turns held meanwhile. */
  restore(run: (history: History) => Promise<unknown>): Promise<void>;
  /** A go-back went through (the settings may have changed). */
  restored(): void;
}

type Resolved = { ok: true; base: string; path: string; history: History } | { ok: false; reason: FileRefusal };

const no = (reason: FileRefusal) => ({ ok: false as const, reason });

/**
 * A file's timeline, its diffs and going back one file (file-timeline spec §3–§5). Every answer is data. Paths are
 * the person's folder's only, checked here; reading the current file never follows a link out of it.
 */
export class FileTimelineService {
  constructor(private readonly d: FileTimelineDeps) {}

  /** `rel` as the history names it: plain, relative, inside the folder, tracked. */
  private async resolve(rel: unknown): Promise<Resolved> {
    if (refusedShape(rel)) return no("outside");
    const base = await this.d.base();
    const history = base ? await this.d.history() : null;
    if (!base || !history) return no("not-ready");
    let p = path.posix.normalize(rel as string);
    while (p.startsWith("./")) p = p.slice(2);
    if (p === "." || p === "" || p.endsWith("/")) return no("bad-input");
    if (isMarkdownPath(p)) {
      const canonical = await canonicalDocumentPath(base, p);
      if (canonical === null) return no("outside");
      p = canonical;
    }
    if (!history.tracks(p)) return no("untracked");
    return { ok: true, base, path: p, history };
  }

  async timeline(rel: unknown): Promise<FileTimelineResult> {
    const r = await this.resolve(rel);
    if (!r.ok) return r;
    const entries = await r.history.fileTimeline(r.path, (id) => this.d.actionLabel(id));
    if (isMarkdownPath(r.path)) await this.markReasons(r.base, r.path, entries);
    return { ok: true, entries };
  }

  /** An approval made with a reason (§3.1 "con motivo"): paired with the record's approvals, newest first. */
  private async markReasons(base: string, doc: string, entries: TimelineEntry[]): Promise<void> {
    const record = [...(await this.d.approvals(base, doc).catch(() => []))].reverse();
    let k = 0;
    for (const e of entries) {
      if (e.kind !== "approval") continue;
      if (record[k]?.reason) e.reason = true;
      k++;
    }
  }

  async diff(rel: unknown, from: unknown, to: unknown): Promise<FileDiffResult> {
    const r = await this.resolve(rel);
    if (!r.ok) return r;
    if ((from !== null && !isSha(from)) || (to !== "current" && !isSha(to))) return no("bad-input");
    const before = from === null ? ({ kind: "absent" } as const) : await this.sideAt(r.history, from, r.path);
    const after = to === "current" ? await this.current(r.base, r.path) : await this.sideAt(r.history, to as string, r.path);
    if (after === "outside") return no("outside");
    return diffFile(r.path, before, after);
  }

  private async sideAt(history: History, sha: string, file: string): Promise<DiffSide> {
    const bytes = await history.readBytesAt(sha, file);
    return bytes === null ? { kind: "absent" } : { kind: "bytes", bytes, size: bytes.length };
  }

  /** The file in the folder now: absent when it isn't there; "outside" when it leads out (a link). */
  private async current(base: string, file: string): Promise<DiffSide | "outside"> {
    const at = await locate(file, [base]);
    if (!at.ok) return at.reason === "missing" ? { kind: "absent" } : "outside";
    const got = await readPrefix(at.file, MAX_DIFF_BYTES, () => stillSafe(at.file, [base]));
    return got ? { kind: "bytes", bytes: got.bytes, size: got.size } : "outside";
  }

  /** The entry whose version `commit` is, for the confirmation; refused when a go-back can't run now. */
  async restorePrompt(rel: unknown, commit: unknown): Promise<FileRestorePromptResult> {
    const r = await this.resolve(rel);
    if (!r.ok) return r;
    const found = await this.entryFor(r, commit);
    if (!("kind" in found)) return found;
    // With one task at a time, any running turn blocks it (Conflicts 1): the one place a per-file check would go.
    if (this.d.busy()) return no("busy");
    return { ok: true, prompt: { path: r.path, author: found.author, at: found.at, kind: found.kind, ...(found.version ? { version: found.version } : {}) } };
  }

  private async entryFor(r: Extract<Resolved, { ok: true }>, commit: unknown): Promise<TimelineEntry | { ok: false; reason: FileRefusal }> {
    if (!isSha(commit)) return no("bad-input");
    const entry = (await r.history.fileTimeline(r.path, (id) => this.d.actionLabel(id))).find((e) => e.to === commit);
    if (!entry) return no("not-found");
    if (entry.deleted) return no("deleted");
    return entry;
  }

  /** "Go back to this version" (§5), after the core's confirmation: one file, its own untagged commit. */
  async restore(rel: unknown, commit: unknown): Promise<FileRestoreAnswer> {
    const r = await this.resolve(rel);
    if (!r.ok) return r;
    const found = await this.entryFor(r, commit);
    if (!("kind" in found)) return found;
    if (this.d.busy()) return no("busy");
    const target = found.kind === "approval" ? `v${found.version}` : `the version of ${found.at}`;
    let skipped: string[] = [];
    try {
      await this.d.restore(async (h) => {
        skipped = (await h.restoreFile(r.path, commit as string, `${FILE_RESTORE_PREFIX}${r.path} to ${target}`)).skipped;
      });
    } catch (err) {
      console.error("Could not bring the file back", err);
      return no(this.d.busy() ? "busy" : "failed");
    }
    if (skipped.length > 0) return no("unsafe");
    this.d.restored();
    return { ok: true };
  }
}
```

Check `stillSafe`'s signature in `packages/shell/src/main/open-path.ts` (`stillSafe(file, roots)`, used by `documents.ts` the same way) and `locate`'s export in `documents.ts` (exported). The `found.kind` checks narrow `TimelineEntry` from the refusal (`"kind" in found`).

- [ ] **Step 6: Run the tests to see them pass**

Run: `corepack pnpm vitest run packages/shell/test/file-timeline.test.ts packages/shell/test/documents.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck, test, commit**

Run: `corepack pnpm typecheck && corepack pnpm test`

```bash
git -C <worktree> add packages/workspace/src/safe-read.ts packages/shell/src/main/file-timeline.ts packages/shell/test/file-timeline.test.ts packages/ui/src/client.ts
git -C <worktree> commit -m "feat(shell): file timelines, diffs and one-file go-backs in main"
```

---
### Task 9: IPC, preload, client and the fake client

**Files:**
- Create: `packages/shell/src/main/file-ipc.ts`, `packages/shell/src/preload/file-restore.ts`
- Modify: `packages/shell/src/main/index.ts`, `packages/shell/src/preload/index.ts`, `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts`
- Test: `packages/shell/test/file-ipc.test.ts`, `packages/shell/test/file-restore.test.ts`, `packages/ui/test/client.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Create `packages/shell/test/file-ipc.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FILE_CHANNELS, fileHandlers } from "../src/main/file-ipc";
import type { FileTimelineService } from "../src/main/file-timeline";

describe("file timeline IPC handlers", () => {
  it("forward every call; a throw, sync or async, answers failed", async () => {
    const calls: unknown[][] = [];
    const svc = {
      timeline: async (...a: unknown[]) => (calls.push(["timeline", ...a]), { ok: true, entries: [] }),
      diff: async () => {
        throw new Error("boom");
      },
      restorePrompt: () => {
        throw new Error("sync boom");
      },
      restore: async (...a: unknown[]) => (calls.push(["restore", ...a]), { ok: true }),
    } as unknown as FileTimelineService;
    const h = fileHandlers(svc);
    expect(Object.keys(h).sort()).toEqual([...FILE_CHANNELS].sort());
    expect(await h["hh:fileTimeline"]("a.md")).toEqual({ ok: true, entries: [] });
    expect(await h["hh:fileDiff"]("a.md", null, "current")).toEqual({ ok: false, reason: "failed" });
    expect(await h["hh:fileRestorePrompt"]("a.md", "x")).toEqual({ ok: false, reason: "failed" });
    expect(await h["hh:fileRestore"]("a.md", "c".repeat(40))).toEqual({ ok: true });
    expect(calls).toEqual([
      ["timeline", "a.md"],
      ["restore", "a.md", "c".repeat(40)],
    ]);
  });
});
```

Create `packages/shell/test/file-restore.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { restoreFlow } from "../src/preload/file-restore";

const SHA = "c".repeat(40);
const prompt = { path: "a.md", author: { kind: "agent", label: "Spec writer" }, at: "2026-10-28T10:00:00.000Z", kind: "task" };

function invoker(answers: Record<string, unknown>) {
  const calls: string[] = [];
  const invoke = async (channel: string, ...args: unknown[]) => {
    calls.push(`${channel} ${args.join(" ")}`);
    return answers[channel];
  };
  return { invoke, calls };
}

describe("restoreFlow (file-timeline spec §6.3: the core always confirms)", () => {
  it("prompt, the core's yes, then the go-back", async () => {
    const { invoke, calls } = invoker({ "hh:fileRestorePrompt": { ok: true, prompt }, "hh:fileRestore": { ok: true } });
    const asked: unknown[] = [];
    const r = await restoreFlow(invoke, async (p) => (asked.push(p), true), "a.md", SHA);
    expect(r).toBe("restored");
    expect(asked).toEqual([prompt]);
    expect(calls).toEqual([`hh:fileRestorePrompt a.md ${SHA}`, `hh:fileRestore a.md ${SHA}`]);
  });

  it("no, or no core to ask, or a confirmer that fails: cancelled, nothing restored", async () => {
    for (const confirm of [async () => false, null, async () => Promise.reject(new Error("gone"))]) {
      const { invoke, calls } = invoker({ "hh:fileRestorePrompt": { ok: true, prompt } });
      expect(await restoreFlow(invoke, confirm, "a.md", SHA)).toBe("cancelled");
      expect(calls).toEqual([`hh:fileRestorePrompt a.md ${SHA}`]);
    }
  });

  it("refusals come back as data, before and after the confirmation", async () => {
    const before = invoker({ "hh:fileRestorePrompt": { ok: false, reason: "busy" } });
    expect(await restoreFlow(before.invoke, async () => true, "a.md", SHA)).toEqual({ refused: "busy" });
    const after = invoker({ "hh:fileRestorePrompt": { ok: true, prompt }, "hh:fileRestore": { ok: false, reason: "unsafe" } });
    expect(await restoreFlow(after.invoke, async () => true, "a.md", SHA)).toEqual({ refused: "unsafe" });
    const odd = invoker({ "hh:fileRestorePrompt": "nonsense" });
    expect(await restoreFlow(odd.invoke, async () => true, "a.md", SHA)).toEqual({ refused: "failed" });
  });
});
```

Append to `packages/ui/test/client.test.ts`:

```ts
describe("files (file-timeline spec §6.3)", () => {
  it("the fake answers like main and confirms through the core's host", async () => {
    const c = new FakeClient();
    const entry = {
      kind: "task" as const,
      author: { kind: "agent" as const, label: "Spec writer", task: "t1", action: "spec" },
      label: "1 change",
      at: "2026-10-28T10:00:00.000Z",
      from: "a".repeat(40),
      to: "b".repeat(40),
      commits: [{ id: "b".repeat(40), subject: "Turn: write", at: "2026-10-28T10:00:00.000Z" }],
    };
    c.timelines["specs/a.md"] = [entry];
    expect(await c.files.timeline("specs/a.md")).toEqual({ ok: true, entries: [entry] });
    expect(await c.files.timeline("other.md")).toEqual({ ok: false, reason: "untracked" });
    expect(await c.files.restore("specs/a.md", entry.to)).toBe("cancelled");
    const off = c.files.hostConfirm(async () => true);
    expect(await c.files.restore("specs/a.md", entry.to)).toBe("restored");
    off();
    const seen: string[] = [];
    c.files.onChange("specs/a.md", () => seen.push("a"));
    c.emitFileCommit(["specs/a.md", "b.md"]);
    c.emitFileCommit(["b.md"]);
    expect(seen).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/shell/test/file-ipc.test.ts packages/shell/test/file-restore.test.ts packages/ui/test/client.test.ts`
Expected: FAIL (modules and `files` missing).

- [ ] **Step 3: `file-ipc.ts`**

Create `packages/shell/src/main/file-ipc.ts`:

```ts
import type { FileTimelineService } from "./file-timeline";

export const FILE_CHANNELS = ["hh:fileTimeline", "hh:fileDiff", "hh:fileRestorePrompt", "hh:fileRestore"] as const;
export type FileChannel = (typeof FILE_CHANNELS)[number];

const failed = { ok: false as const, reason: "failed" as const };

/** The `hh:file*` handlers (file-timeline spec §6.3). Every answer is data; a throw is a bug, logged, answered `failed`. */
export function fileHandlers(svc: FileTimelineService): Record<FileChannel, (...args: unknown[]) => Promise<unknown>> {
  const call = (fn: () => unknown): Promise<unknown> =>
    Promise.resolve()
      .then(fn)
      .catch((err: unknown) => {
        console.error("A file timeline call failed", err);
        return failed;
      });
  return {
    "hh:fileTimeline": (file) => call(() => svc.timeline(file)),
    "hh:fileDiff": (file, from, to) => call(() => svc.diff(file, from, to)),
    "hh:fileRestorePrompt": (file, commit) => call(() => svc.restorePrompt(file, commit)),
    "hh:fileRestore": (file, commit) => call(() => svc.restore(file, commit)),
  };
}
```

- [ ] **Step 4: `file-restore.ts` (preload)**

Create `packages/shell/src/preload/file-restore.ts`:

```ts
import type { FileRefusal, FileRestorePrompt, FileRestoreResult } from "@humanharness/ui/client";

export type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

const answer = (v: unknown): { ok: true; prompt?: FileRestorePrompt } | { ok: false; reason: FileRefusal } => {
  if (typeof v === "object" && v !== null && "ok" in v) return v as { ok: true; prompt?: FileRestorePrompt } | { ok: false; reason: FileRefusal };
  return { ok: false, reason: "failed" };
};

/**
 * `client.files.restore` (file-timeline spec §5, §6.3): main's prompt, then the core's confirmation, then the go-back.
 * Without a confirmer (no core chat on screen) or on any failure to ask, nothing goes back: "cancelled".
 */
export async function restoreFlow(
  invoke: Invoke,
  confirm: ((prompt: FileRestorePrompt) => Promise<boolean>) | null,
  file: string,
  commit: string,
): Promise<FileRestoreResult> {
  const asked = answer(await invoke("hh:fileRestorePrompt", file, commit));
  if (!asked.ok) return { refused: asked.reason };
  if (!confirm || !asked.prompt) return "cancelled";
  let yes = false;
  try {
    yes = (await confirm(asked.prompt)) === true;
  } catch {
    yes = false;
  }
  if (!yes) return "cancelled";
  const done = answer(await invoke("hh:fileRestore", file, commit));
  return done.ok ? "restored" : { refused: done.reason };
}
```

- [ ] **Step 5: The client interface**

In `packages/ui/src/client.ts`, `HarnessClient` gains (after `focus`):

```ts
  /** File timelines (file-timeline spec §6.3). Every call answers with data; the core always confirms a go-back. */
  files: {
    /** The file's entries, newest first. */
    timeline(path: string): Promise<FileTimelineResult>;
    /** What changed between two commits, or from a commit to the file now ("current"); `from` null: nothing before. */
    diff(path: string, from: string | null, to: string | "current"): Promise<FileDiffResult>;
    /** Brings the file back to `commit` (an entry's `to`) after the core's confirmation; nothing else changes. */
    restore(path: string, commit: string): Promise<FileRestoreResult>;
    /** A commit touched `path`: its timeline has a new entry. Returns the unsubscribe. */
    onChange(path: string, listener: () => void): () => void;
    /** The core's chat only: answers the confirmation every `restore` shows. Returns the unregister. */
    hostConfirm(confirm: (prompt: FileRestorePrompt) => Promise<boolean>): () => void;
  };
```

- [ ] **Step 6: The preload**

In `packages/shell/src/preload/index.ts` import `restoreFlow` from `./file-restore` and the `FileRestorePrompt` type, and next to `focusListeners`:

```ts
/** The core's chat answers "go back?" for every `files.restore` (file-timeline spec §6.3); null while none is on screen. */
let restoreConfirm: ((prompt: FileRestorePrompt) => Promise<boolean>) | null = null;
```

In the client object, after `focus`:

```ts
  files: {
    timeline: (file) => ipcRenderer.invoke("hh:fileTimeline", file),
    diff: (file, from, to) => ipcRenderer.invoke("hh:fileDiff", file, from, to),
    restore: (file, commit) => restoreFlow((channel, ...args) => ipcRenderer.invoke(channel, ...args), restoreConfirm, file, commit),
    onChange: (file, listener) =>
      subscribe<unknown>("hh:fileCommits", (paths) => {
        if (Array.isArray(paths) && paths.includes(file)) listener();
      }),
    hostConfirm: (confirm) => {
      restoreConfirm = confirm;
      return () => {
        if (restoreConfirm === confirm) restoreConfirm = null;
      };
    },
  },
```

- [ ] **Step 7: Wire main**

In `packages/shell/src/main/index.ts`:
- Imports: `import { fileHandlers } from "./file-ipc";`, `import { FileTimelineService } from "./file-timeline";`, and `loadReview` from `@humanharness/workspace` (with the other workspace imports).
- After `const reviews = new ReviewService({ … })`:

```ts
/** File timelines (file-timeline spec): read from the history; a one-file go-back goes through the restore guard. */
const files = new FileTimelineService({
  base: async () => {
    const c = await validConfig();
    return c ? baseOf(c) : null;
  },
  history: () => currentHistory(),
  actionLabel: (id) => (id === null ? "A question" : Object.hasOwn(harness.actions, id) ? harness.actions[id].label : id),
  approvals: async (base, doc) => (await loadReview(base, doc).catch(() => null))?.approvals ?? [],
  busy: () => quitting || tasks.isBusy() || turnBlocked() !== null,
  restore: (run) => restoreWith(run),
  restored: () => void settingsCtl?.changed(),
});

/** Tells the window which paths each commit touched: an open timeline gets its new entry (§6.3 `onChange`). */
const announceCommits = (history: History) => history.onCommit((c) => sendToWindow("hh:fileCommits", c.paths));
```

- In the `runtime` memoise, right before `kickMaterial();`: `announceCommits(rt.history);`
- In `standaloneHistory`, after `await history.init();`: `announceCommits(history);`
- Next to the review handlers' loop: `for (const [channel, fn] of Object.entries(fileHandlers(files))) handle(channel, fn);`

(`files` must be declared after `restoreWith`, `turnBlocked` and `tasks`, which it reads lazily; place it right after `reviews` as written. If `files` clashes with a name in scope, call it `fileTimelines`.)

- [ ] **Step 8: The fake client**

In `packages/ui/test/fake-client.ts` import the types `FileDiffResult`, `FileRestoreAnswer`, `FileRestorePrompt`, `TimelineEntry`, and add to `FakeClient`:

```ts
  /** Timelines by path, and diffs by `${path}|${from}|${to}`; the fake's `files` answers from here like main. */
  timelines: Record<string, TimelineEntry[]> = {};
  diffs: Record<string, FileDiffResult> = {};
  /** Every files call, in order. */
  fileCalls: { op: string; args: unknown[] }[] = [];
  /** What a confirmed restore answers. */
  restoreAnswer: FileRestoreAnswer = { ok: true };
  private fileListeners = new Map<string, Set<() => void>>();
  private confirmer: ((prompt: FileRestorePrompt) => Promise<boolean>) | null = null;
  /** As main does after a commit. */
  emitFileCommit(paths: string[]) {
    for (const p of paths) for (const l of [...(this.fileListeners.get(p) ?? [])]) l();
  }
  files: HarnessClient["files"] = {
    timeline: async (path) => {
      this.fileCalls.push({ op: "timeline", args: [path] });
      return Object.hasOwn(this.timelines, path) ? { ok: true, entries: this.timelines[path] } : { ok: false, reason: "untracked" };
    },
    diff: async (path, from, to) => {
      this.fileCalls.push({ op: "diff", args: [path, from, to] });
      return this.diffs[`${path}|${from}|${to}`] ?? { ok: false, reason: "not-found" };
    },
    restore: async (path, commit) => {
      this.fileCalls.push({ op: "restore", args: [path, commit] });
      const e = (this.timelines[path] ?? []).find((x) => x.to === commit);
      if (!e) return { refused: "not-found" };
      if (!this.confirmer) return "cancelled";
      const yes = await this.confirmer({ path, author: e.author, at: e.at, kind: e.kind, ...(e.version ? { version: e.version } : {}) });
      if (!yes) return "cancelled";
      return this.restoreAnswer.ok ? "restored" : { refused: this.restoreAnswer.reason };
    },
    onChange: (path, listener) => {
      const set = this.fileListeners.get(path) ?? new Set();
      set.add(listener);
      this.fileListeners.set(path, set);
      return () => void set.delete(listener);
    },
    hostConfirm: (confirm) => {
      this.confirmer = confirm;
      return () => {
        if (this.confirmer === confirm) this.confirmer = null;
      };
    },
  };
```

- [ ] **Step 9: Run the tests to see them pass**

Run: `corepack pnpm vitest run packages/shell/test/file-ipc.test.ts packages/shell/test/file-restore.test.ts packages/ui/test/client.test.ts`
Expected: PASS.

- [ ] **Step 10: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`

```bash
git -C <worktree> add packages/shell/src/main/file-ipc.ts packages/shell/src/main/index.ts packages/shell/src/preload/file-restore.ts packages/shell/src/preload/index.ts packages/shell/test/file-ipc.test.ts packages/shell/test/file-restore.test.ts packages/ui/src/client.ts packages/ui/test/fake-client.ts packages/ui/test/client.test.ts
git -C <worktree> commit -m "feat: client.files over IPC; the core confirms every go-back"
```

---

### Task 10: The entry list — `<FileTimeline>`

**Files:**
- Create: `packages/ui/src/FileTimeline.tsx`
- Modify: `packages/ui/src/index.ts`, `packages/ui/src/styles.css`, `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/file-timeline.test.tsx`

- [ ] **Step 1: Add the strings**

In `packages/i18n/src/locales/en.json`, a new top-level `timeline` object (all of this plan's strings, so later tasks only use them):

```json
  "timeline": {
    "open": "File history",
    "title": "File history",
    "entries": "Versions and changes",
    "loading": "Loading history…",
    "empty": "No history yet. It starts when the turn ends.",
    "noHistory": "This file has no history.",
    "loadFailed": "I couldn't read this file's history. Try again in a moment.",
    "you": "You",
    "outsideAuthor": "Outside the app",
    "changes_one": "{{count}} change",
    "changes_other": "{{count}} changes",
    "answers": "Your answers ({{count}})",
    "unapproved": "not approved",
    "approved": "v{{version}} approved",
    "approvedReason": "v{{version}} approved, with a reason",
    "outside": "Outside the app",
    "deleted": "Deleted",
    "wentBackVersion": "You went back to v{{version}}",
    "wentBackTime": "You went back to the version of {{time}}",
    "wentBack": "You went back to an earlier version",
    "turns_one": "{{count}} turn",
    "turns_other": "{{count}} turns",
    "compare": "Compare",
    "compareHere": "What changed here",
    "compareCurrent": "Against the current version",
    "layout": "Layout",
    "inline": "Inline",
    "sideBySide": "Side by side",
    "source": "Source",
    "diff": "Changes",
    "before": "Before",
    "after": "After",
    "added": "Added",
    "removed": "Removed",
    "noChanges": "No changes",
    "binary": "Binary file, no preview ({{before}} → {{after}})",
    "noFile": "none",
    "truncated": "Only the first 200 KB of each version is compared.",
    "diffFailed": "I couldn't compare these versions.",
    "goBack": "Go back to this version",
    "backToDocument": "Back to the document",
    "backToList": "Back to the list",
    "busy": "The AI is working. You can go back when it finishes.",
    "confirm": "Go back {{file}} to how it was after {{author}} ({{ago}})? The rest of the folder doesn't change.",
    "confirmYes": "Yes, go back",
    "cancel": "Cancel",
    "restored": "{{file}} is back to that version.",
    "refused": {
      "busy": "The AI is working. You can go back when it finishes.",
      "deleted": "That version has no file to bring back.",
      "unsafe": "I couldn't write the file safely, so nothing changed.",
      "other": "I couldn't go back to that version. Try again in a moment."
    },
    "panelTitle": "History of {{file}}",
    "close": "Close"
  },
```

In `history`: `"openTimeline": "History of {{file}}"`, and in `history.entry`: `"fileBack": "You went back to an earlier version of {{file}}"` (Task 14 uses both).

- [ ] **Step 2: Write the failing tests**

Create `packages/ui/test/file-timeline.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TimelineEntry } from "../src/client";
import { FileTimeline, timeAgo } from "../src/FileTimeline";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const sha = (n: number) => n.toString(16).padStart(40, "0");
const at = (m: number) => new Date(Date.UTC(2026, 9, 28, 10, m)).toISOString();
const DOC = "specs/filter.md";
const entries: TimelineEntry[] = [
  { kind: "goBack", author: { kind: "person", label: "You" }, label: "", at: at(50), from: sha(6), to: sha(7), back: { version: 1 }, commits: [{ id: sha(7), subject: `Go back: ${DOC} to v1`, at: at(50) }] },
  { kind: "outside", author: { kind: "outside", label: "Outside the app" }, label: "", at: at(40), from: sha(5), to: sha(6), commits: [{ id: sha(6), subject: "Start", at: at(40) }] },
  { kind: "approval", author: { kind: "person", label: "You" }, label: "", at: at(30), from: sha(4), to: sha(5), version: 1, reason: true, commits: [{ id: sha(5), subject: `Approved: ${DOC}`, at: at(30) }] },
  { kind: "answers", author: { kind: "person", label: "You" }, label: "", at: at(20), from: sha(3), to: sha(4), unapproved: true, commits: [{ id: sha(4), subject: `Answer: ${DOC} · q`, at: at(20) }] },
  {
    kind: "task",
    author: { kind: "agent", label: "Spec writer", task: "t1", action: "spec" },
    label: "",
    at: at(10),
    from: sha(1),
    to: sha(3),
    commits: [
      { id: sha(3), subject: "Note: Filter", at: at(10) },
      { id: sha(2), subject: "Turn: write", at: at(9) },
    ],
  },
  { kind: "task", author: { kind: "agent", label: "A question", task: "t2" }, label: "", at: at(5), from: sha(0), to: sha(1), deleted: true, commits: [{ id: sha(1), subject: "Turn: q", at: at(5) }] },
];

describe("FileTimeline (file-timeline spec §6.1)", () => {
  it("shows each entry's author, text and chips, newest first", async () => {
    const client = new FakeClient();
    client.timelines[DOC] = entries;
    await renderIn("en", <FileTimeline client={client} path={DOC} />);
    const list = await screen.findByRole("list", { name: "Versions and changes" });
    const items = within(list).getAllByRole("listitem").filter((li) => li.parentElement === list);
    expect(items.map((li) => li.querySelector(".hh-timeline-author")?.textContent)).toEqual(["You", "Outside the app", "You", "You", "Spec writer", "A question"]);
    expect(items[0].textContent).toContain("You went back to v1");
    expect(items[1].textContent).toContain("Outside the app");
    expect(items[2].textContent).toContain("v1 approved, with a reason");
    expect(items[3].textContent).toContain("Your answers (1)");
    expect(items[3].textContent).toContain("not approved");
    expect(items[4].textContent).toContain("2 changes");
    expect(items[5].textContent).toContain("Deleted");
  });

  it("an entry expands into its turns; picking one calls onPick", async () => {
    const client = new FakeClient();
    client.timelines[DOC] = entries;
    const picked: string[] = [];
    await renderIn("en", <FileTimeline client={client} path={DOC} onPick={(e) => picked.push(e.to)} selected={sha(3)} />);
    fireEvent.click(await screen.findByRole("button", { name: "2 turns" }));
    expect(screen.getByText("Note saved: Filter")).toBeTruthy();
    expect(screen.getByText("The AI finished")).toBeTruthy();
    const current = screen.getByRole("button", { current: true });
    expect(current.textContent).toContain("Spec writer");
    fireEvent.click(screen.getAllByRole("button", { name: /Outside the app/ })[0]);
    expect(picked).toEqual([sha(6)]);
  });

  it("loading, empty, no history, and a new commit reloads it", async () => {
    const client = new FakeClient();
    await renderIn("en", <FileTimeline client={client} path="other.bin" />);
    expect(await screen.findByText("This file has no history.")).toBeTruthy();
    cleanup();
    client.timelines[DOC] = [];
    await renderIn("en", <FileTimeline client={client} path={DOC} />);
    expect(await screen.findByText("No history yet. It starts when the turn ends.")).toBeTruthy();
    client.timelines[DOC] = entries.slice(4, 5);
    client.emitFileCommit([DOC]);
    expect(await screen.findByText("Spec writer")).toBeTruthy();
  });

  it("timeAgo says how long ago, in the window's language", () => {
    const now = Date.parse(at(30));
    expect(timeAgo(at(10), "en", now)).toBe("20 minutes ago");
    expect(timeAgo(at(30), "en", now)).toBe("now");
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `corepack pnpm vitest run packages/ui/test/file-timeline.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 4: Write `FileTimeline.tsx`**

Create `packages/ui/src/FileTimeline.tsx`:

```tsx
import { type ReactNode, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { FileTimelineResult, HarnessClient, TimelineAuthor, TimelineEntry } from "./client";
import { entryLabel } from "./HistoryPanel";

export interface FileTimelineProps {
  client: HarnessClient;
  /** The file, relative to the folder. */
  path: string;
  /** The entry whose diff shows now (its `to`). */
  selected?: string;
  /** Picking an entry; absent: the list is read-only. */
  onPick?: (entry: TimelineEntry) => void;
}

/** Who made an entry, in the window's language (§3.1). */
export function authorName(t: TFunction, a: TimelineAuthor): string {
  if (a.kind === "person") return t("timeline.you");
  if (a.kind === "outside") return t("timeline.outsideAuthor");
  return a.action ? a.label : t("history.question");
}

/** "20 minutes ago", "now", "3 days ago". */
export function timeAgo(iso: string, language: string, now = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const f = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return f.format(0, "second");
  if (abs < 3600) return f.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return f.format(Math.round(seconds / 3600), "hour");
  return f.format(Math.round(seconds / 86_400), "day");
}

export const clock = (iso: string, language: string) => new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** The entry's own line (the chips say the rest). */
function entryText(t: TFunction, e: TimelineEntry, language: string): string | null {
  if (e.deleted) return null;
  if (e.kind === "task") return t("timeline.changes", { count: e.commits.length });
  if (e.kind === "answers") return t("timeline.answers", { count: e.commits.length });
  if (e.kind === "goBack") {
    if (e.back?.version !== undefined) return t("timeline.wentBackVersion", { version: e.back.version });
    if (e.back?.at !== undefined) return t("timeline.wentBackTime", { time: clock(e.back.at, language) });
    return t("timeline.wentBack");
  }
  return null;
}

function chips(t: TFunction, e: TimelineEntry): ReactNode {
  const out: ReactNode[] = [];
  if (e.unapproved) out.push(<span key="u" className="hh-chip hh-chip-amber">{t("timeline.unapproved")}</span>);
  if (e.kind === "approval") out.push(<span key="a" className="hh-chip hh-chip-green">{t(e.reason ? "timeline.approvedReason" : "timeline.approved", { version: e.version })}</span>);
  if (e.kind === "outside") out.push(<span key="o" className="hh-chip hh-chip-grey">{t("timeline.outside")}</span>);
  if (e.deleted) out.push(<span key="d" className="hh-chip hh-chip-grey">{t("timeline.deleted")}</span>);
  return out;
}

/** A turn's subject in plain language (the History panel's words), else the subject itself. */
function turnText(t: TFunction, subject: string): string {
  const l = entryLabel(subject);
  return l ? t(l.key, l.values) : subject;
}

/** A file's timeline (file-timeline spec §6.1), newest first; an entry expands into its turns. */
export function FileTimeline({ client, path, selected, onPick }: FileTimelineProps) {
  const { t, i18n } = useTranslation();
  const [result, setResult] = useState<FileTimelineResult | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const id = useId();
  useEffect(() => {
    let live = true;
    let seq = 0;
    const load = () => {
      const mine = ++seq;
      const done = (r: FileTimelineResult) => live && mine === seq && setResult(r);
      client.files.timeline(path).then(done, () => done({ ok: false, reason: "failed" }));
    };
    setResult(null);
    setOpen(new Set());
    load();
    const off = client.files.onChange(path, load);
    return () => {
      live = false;
      off();
    };
  }, [client, path]);
  if (!result) return <p className="hh-caption" role="status">{t("timeline.loading")}</p>;
  if (!result.ok) {
    const none = result.reason === "untracked" || result.reason === "outside";
    return <p className={none ? "hh-caption" : "hh-warn"} role={none ? undefined : "alert"}>{t(none ? "timeline.noHistory" : "timeline.loadFailed")}</p>;
  }
  if (result.entries.length === 0) return <p className="hh-caption">{t("timeline.empty")}</p>;
  const toggle = (key: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <ol className="hh-timeline" aria-label={t("timeline.entries")}>
      {result.entries.map((e, i) => {
        const turnsId = `${id}-turns-${i}`;
        const text = entryText(t, e, i18n.language);
        return (
          <li key={e.to} className={`hh-timeline-entry${selected === e.to ? " hh-timeline-selected" : ""}`}>
            <button type="button" className="hh-timeline-pick" aria-current={selected === e.to ? "true" : undefined} disabled={!onPick} onClick={() => onPick?.(e)}>
              <span className="hh-timeline-author">{authorName(t, e.author)}</span>
              {text && <span className="hh-timeline-text">{text}</span>}
              {chips(t, e)}
              <time className="hh-caption" dateTime={e.at}>
                {clock(e.at, i18n.language)}
              </time>
            </button>
            {e.commits.length > 1 && (
              <button type="button" className="hh-link hh-timeline-more" aria-expanded={open.has(e.to)} aria-controls={turnsId} onClick={() => toggle(e.to)}>
                {t("timeline.turns", { count: e.commits.length })}
              </button>
            )}
            {open.has(e.to) && (
              <ol id={turnsId} className="hh-timeline-turns">
                {e.commits.map((c) => (
                  <li key={c.id}>
                    {turnText(t, c.subject)}{" "}
                    <time className="hh-caption" dateTime={c.at}>
                      {clock(c.at, i18n.language)}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </li>
        );
      })}
    </ol>
  );
}
```

In `packages/ui/src/index.ts`: `export { FileTimeline, type FileTimelineProps } from "./FileTimeline";`

- [ ] **Step 5: Styles**

In `packages/ui/src/styles.css`, tokens in the light `:root` block:

```css
  --hh-diff-ins: #e3f2e6;
  --hh-diff-del: #fbe3e3;
  --hh-diff-bar-ins: #2e8a5c;
  --hh-diff-bar-del: #b3402f;
```

and in the dark block:

```css
    --hh-diff-ins: #1e3026;
    --hh-diff-del: #3a2222;
    --hh-diff-bar-ins: #4fb07f;
    --hh-diff-bar-del: #e07a6a;
```

Rules (next to the History panel's):

```css
/* File timeline (file-timeline spec §6.1). */
.hh-timeline { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.hh-timeline-pick { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; width: 100%; height: auto; padding: 6px 8px; text-align: left; border-radius: 6px; background: none; border: 1px solid transparent; }
.hh-timeline-pick:hover:not(:disabled), .hh-timeline-selected .hh-timeline-pick { border-color: var(--hh-line-strong); background: var(--hh-surface); }
.hh-timeline-author { font-weight: 600; }
.hh-timeline-more { margin-left: 8px; font-size: 12px; }
.hh-timeline-turns { margin: 2px 0 4px 16px; padding: 0; list-style: none; font-size: 13px; }
.hh-chip { padding: 0 6px; border-radius: 999px; font-size: 12px; color: var(--hh-ink); }
.hh-chip-amber { background: var(--hh-review-question); }
.hh-chip-green { background: var(--hh-diff-ins); color: var(--hh-ok); }
.hh-chip-grey { background: var(--hh-review-done); }
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `corepack pnpm vitest run packages/ui/test/file-timeline.test.tsx packages/ui/test/styles.test.ts`
Expected: PASS. ("Note saved: Filter" and "The AI finished" are the History panel's existing `history.entry.note` and `history.entry.turn` strings.)

- [ ] **Step 7: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`

```bash
git -C <worktree> add packages/ui/src/FileTimeline.tsx packages/ui/src/index.ts packages/ui/src/styles.css packages/i18n/src/locales/en.json packages/ui/test/file-timeline.test.tsx
git -C <worktree> commit -m "feat(ui): a file's timeline, with authors, chips and turns"
```

---

### Task 11: The diff view — `<FileDiff>`

**Files:**
- Create: `packages/ui/src/FileDiff.tsx`
- Modify: `packages/ui/src/index.ts`, `packages/ui/src/styles.css`
- Test: `packages/ui/test/file-diff.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/file-diff.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { FileDiffResult, LineChange } from "../src/client";
import { FileDiff, aroundChanges, sideRows } from "../src/FileDiff";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const A = "a".repeat(40);
const B = "b".repeat(40);
const DOC = "specs/filter.md";
const md: FileDiffResult = {
  ok: true,
  kind: "markdown",
  same: false,
  truncated: false,
  blocks: [
    { type: "heading", status: "same", before: "## Scope", after: "## Scope", depth: 2 },
    {
      type: "paragraph",
      status: "changed",
      before: "Filter by size.",
      after: "Filter by size and colour.",
      parts: [
        { kind: "same", text: "Filter by size" },
        { kind: "del", text: "." },
        { kind: "ins", text: " and colour." },
      ],
    },
    { type: "paragraph", status: "added", after: "The list loads in pages." },
    { type: "paragraph", status: "removed", before: "The list loads at once." },
    { type: "tableRow", status: "same", before: "| a |", after: "| a |", cells: { before: ["a"], after: ["a"] } },
    { type: "tableRow", status: "changed", before: "| 1 |", after: "| 2 |", cells: { before: ["1"], after: ["2"], parts: [[{ kind: "del", text: "1" }, { kind: "ins", text: "2" }]] } },
  ],
  source: [
    { kind: "same", text: "## Scope", old: 1, new: 1 },
    { kind: "del", text: "Filter by size.", old: 2 },
    { kind: "ins", text: "Filter by size and colour.", new: 2 },
  ],
};

describe("FileDiff (file-timeline spec §4)", () => {
  it("Markdown inline: whole blocks drawn, word marks in a changed block, bars on added and removed ones", async () => {
    const client = new FakeClient();
    client.diffs[`${DOC}|${A}|${B}`] = md;
    await renderIn("en", <FileDiff client={client} path={DOC} from={A} to={B} />);
    const region = await screen.findByRole("region", { name: "Changes" });
    expect(within(region).getByRole("heading", { name: "Scope" })).toBeTruthy();
    expect(region.querySelector("ins")?.textContent).toBe(" and colour.");
    expect(region.querySelector("del")?.textContent).toBe(".");
    expect(region.querySelector(".hh-filediff-added")?.textContent).toContain("The list loads in pages.");
    expect(region.querySelector(".hh-filediff-removed")?.textContent).toContain("The list loads at once.");
    expect(region.querySelectorAll("table tr")).toHaveLength(2);
  });

  it("side by side: two columns, before and after, block by block", async () => {
    const client = new FakeClient();
    client.diffs[`${DOC}|${A}|${B}`] = md;
    await renderIn("en", <FileDiff client={client} path={DOC} from={A} to={B} />);
    fireEvent.click(await screen.findByRole("button", { name: "Side by side" }));
    const region = screen.getByRole("region", { name: "Changes" });
    const before = region.querySelectorAll(".hh-filediff-before");
    const after = region.querySelectorAll(".hh-filediff-after");
    expect(before.length).toBe(after.length);
    expect([...before].map((b) => b.textContent).join("")).not.toContain("and colour");
    expect([...after].map((b) => b.textContent).join("")).toContain("and colour");
  });

  it("the Source toggle shows the raw line diff", async () => {
    const client = new FakeClient();
    client.diffs[`${DOC}|${A}|${B}`] = md;
    await renderIn("en", <FileDiff client={client} path={DOC} from={A} to={B} />);
    fireEvent.click(await screen.findByRole("button", { name: "Source" }));
    expect(screen.getByText("Filter by size and colour.").closest("tr")?.className).toContain("hh-filediff-ins");
  });

  it("text: line numbers; binary: sizes; same: No changes; truncated: a notice; refused: a line", async () => {
    const client = new FakeClient();
    client.diffs[`a.ts|${A}|current`] = { ok: true, kind: "text", same: false, truncated: true, lang: "ts", lines: [{ kind: "del", text: "let a = 1;", old: 1 }, { kind: "ins", text: "let a = 2;", new: 1 }] };
    await renderIn("en", <FileDiff client={client} path="a.ts" from={A} to="current" />);
    expect(await screen.findByText("Only the first 200 KB of each version is compared.")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Changes" }).textContent).toContain("let a = 2;");
    cleanup();
    client.diffs[`a.png|${A}|${B}`] = { ok: true, kind: "binary", same: false, sizes: { before: 2048, after: null } };
    await renderIn("en", <FileDiff client={client} path="a.png" from={A} to={B} />);
    expect(await screen.findByText("Binary file, no preview (2 KB → none)")).toBeTruthy();
    cleanup();
    client.diffs[`b.md|${A}|current`] = { ok: true, kind: "markdown", same: true, truncated: false, blocks: [], source: [] };
    await renderIn("en", <FileDiff client={client} path="b.md" from={A} to="current" />);
    expect(await screen.findByText("No changes")).toBeTruthy();
    cleanup();
    await renderIn("en", <FileDiff client={client} path="c.md" from={A} to={B} />);
    expect(await screen.findByText("I couldn't compare these versions.")).toBeTruthy();
  });

  it("aroundChanges keeps context and marks gaps; sideRows pairs deleted and added lines", () => {
    const lines: LineChange[] = [
      ...Array.from({ length: 10 }, (_, i) => ({ kind: "same" as const, text: `s${i}`, old: i + 1, new: i + 1 })),
      { kind: "del", text: "x", old: 11 },
      { kind: "ins", text: "y", new: 11 },
      { kind: "ins", text: "z", new: 12 },
    ];
    const kept = aroundChanges(lines);
    expect(kept[0]).toBeNull();
    expect(kept.filter((l) => l !== null).map((l) => l!.text)).toEqual(["s7", "s8", "s9", "x", "y", "z"]);
    expect(sideRows(lines.slice(10)).map((r) => [r.left?.text, r.right?.text])).toEqual([
      ["x", "y"],
      [undefined, "z"],
    ]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/ui/test/file-diff.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `FileDiff.tsx`**

Create `packages/ui/src/FileDiff.tsx`:

```tsx
import { type ReactNode, createElement, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DiffPart, FileDiffResult, HarnessClient, LineChange, MdDiffBlock } from "./client";
import { formatSize } from "./DocumentReader";
import { highlightCode } from "./highlight";
import { Markdown } from "./markdown";

/** Unchanged lines kept on each side of a change. */
const CONTEXT = 3;
/** Under this width the side-by-side layout falls back to inline (§4.3). */
const SIDE_MIN_PX = 900;

export type DiffLayout = "inline" | "side";

export interface FileDiffProps {
  client: HarnessClient;
  path: string;
  /** null: nothing before (the file was new). */
  from: string | null;
  /** A commit, or the file now. */
  to: string | "current";
  /** The layout to start with; the person can switch. */
  layout?: DiffLayout;
}

/** The changed items and up to CONTEXT unchanged ones around each; null marks a gap ("…") between kept runs. */
export function aroundChanges<T extends { kind: string }>(lines: T[]): (T | null)[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].kind === "same") continue;
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(lines.length - 1, i + CONTEXT); j++) keep[j] = true;
  }
  const out: (T | null)[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (keep[i]) out.push(lines[i]);
    else if (out.at(-1) !== null) out.push(null);
  }
  if (out.at(-1) === null) out.pop();
  return out;
}

/** Lines as rows of two columns: a run of deleted lines beside the run of added lines that follows it. */
export function sideRows(lines: LineChange[]): { left?: LineChange; right?: LineChange }[] {
  const rows: { left?: LineChange; right?: LineChange }[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind === "same") {
      rows.push({ left: lines[i], right: lines[i] });
      i++;
      continue;
    }
    const dels: LineChange[] = [];
    const inss: LineChange[] = [];
    while (i < lines.length && lines[i].kind === "del") dels.push(lines[i++]);
    while (i < lines.length && lines[i].kind === "ins") inss.push(lines[i++]);
    for (let k = 0; k < Math.max(dels.length, inss.length); k++) rows.push({ ...(dels[k] ? { left: dels[k] } : {}), ...(inss[k] ? { right: inss[k] } : {}) });
  }
  return rows;
}

/** Word parts as text: `ins`/`del` marks, or one side only. Never HTML. */
function Parts({ parts, side }: { parts: DiffPart[]; side: "both" | "before" | "after" }) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "same" ? (
          <span key={i}>{p.text}</span>
        ) : p.kind === "ins" ? (
          side === "before" ? null : <ins key={i}>{p.text}</ins>
        ) : side === "after" ? null : (
          <del key={i}>{p.text}</del>
        ),
      )}
    </>
  );
}

function Lines({ lines, lang }: { lines: LineChange[]; lang: string | null }) {
  const { t } = useTranslation();
  return (
    <table className="hh-filediff-lines">
      <tbody>
        {aroundChanges(lines).map((l, i) =>
          l === null ? (
            <tr key={i} className="hh-filediff-gap" aria-hidden="true">
              <td colSpan={4}>…</td>
            </tr>
          ) : (
            <tr key={i} className={`hh-filediff-${l.kind}`}>
              <td className="hh-filediff-no">{l.old ?? ""}</td>
              <td className="hh-filediff-no">{l.new ?? ""}</td>
              <td className="hh-filediff-sign">
                {l.kind === "ins" ? "+" : l.kind === "del" ? "−" : ""}
                <span className="hh-sr-only">{l.kind === "ins" ? t("timeline.added") : l.kind === "del" ? t("timeline.removed") : ""}</span>
              </td>
              <td>
                <code>{highlightCode(lang, l.text) ?? l.text}</code>
              </td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}

function SideLines({ lines, lang }: { lines: LineChange[]; lang: string | null }) {
  return (
    <div className="hh-filediff-grid">
      {sideRows(lines).map((r, i) => (
        <div key={i} className="hh-filediff-row">
          <div className={`hh-filediff-before${r.left ? ` hh-filediff-${r.left.kind}` : ""}`}>{r.left && <code>{highlightCode(lang, r.left.text) ?? r.left.text}</code>}</div>
          <div className={`hh-filediff-after${r.right ? ` hh-filediff-${r.right.kind}` : ""}`}>{r.right && <code>{highlightCode(lang, r.right.text) ?? r.right.text}</code>}</div>
        </div>
      ))}
    </div>
  );
}

/** One block's look on one side: whole with the reader's renderer, or its plain text with word marks when it changed. */
function BlockView({ b, side, path, n }: { b: MdDiffBlock; side: "both" | "before" | "after"; path: string; n: number }) {
  const { t } = useTranslation();
  const [source, setSource] = useState(false);
  const whole = (text: string | undefined) => (text === undefined ? null : <Markdown source={text} document path={path} idPrefix={`hh-d${n}-${side}-`} />);
  if (b.status !== "changed") {
    const text = side === "before" ? (b.status === "added" ? undefined : b.before) : side === "after" ? (b.status === "removed" ? undefined : b.after) : (b.after ?? b.before);
    return whole(text);
  }
  if (b.type === "mermaid") {
    return (
      <div className="hh-filediff-diagrams">
        {side !== "after" && (
          <figure>
            <figcaption>{t("timeline.before")}</figcaption>
            {whole(b.before)}
          </figure>
        )}
        {side !== "before" && (
          <figure>
            <figcaption>{t("timeline.after")}</figcaption>
            {whole(b.after)}
          </figure>
        )}
        <button type="button" aria-pressed={source} onClick={() => setSource((s) => !s)}>
          {t("timeline.source")}
        </button>
        {source && b.lines && <Lines lines={b.lines} lang={null} />}
      </div>
    );
  }
  if (b.lines) return <Lines lines={b.lines} lang={null} />;
  const parts = <Parts parts={b.parts ?? []} side={side} />;
  if (b.type === "heading") return createElement(`h${Math.min(Math.max(b.depth ?? 2, 1), 6)}`, null, parts);
  if (b.type === "listItem")
    return (
      <ul>
        <li>{parts}</li>
      </ul>
    );
  return <p>{parts}</p>;
}

function rowCells(b: MdDiffBlock, side: "both" | "before" | "after"): ReactNode[] {
  const c = b.cells ?? {};
  if (b.status === "changed" && c.parts) return c.parts.map((p, i) => <td key={i}>{<Parts parts={p} side={side} />}</td>);
  const cells = (side === "before" ? c.before : side === "after" ? c.after : (c.after ?? c.before)) ?? [];
  return cells.map((text, i) => <td key={i}>{text}</td>);
}

const statusClass = (b: MdDiffBlock) => (b.status === "same" ? "" : ` hh-filediff-${b.status}`);

/** Consecutive table rows drawn as one table; every other block on its own. */
function groups(blocks: MdDiffBlock[]): (MdDiffBlock | MdDiffBlock[])[] {
  const out: (MdDiffBlock | MdDiffBlock[])[] = [];
  for (const b of blocks) {
    const last = out.at(-1);
    if (b.type === "tableRow" && Array.isArray(last)) last.push(b);
    else out.push(b.type === "tableRow" ? [b] : b);
  }
  return out;
}

function MarkdownDiff({ blocks, path, layout }: { blocks: MdDiffBlock[]; path: string; layout: DiffLayout }) {
  const { t } = useTranslation();
  const label = (b: MdDiffBlock) => (b.status === "added" ? t("timeline.added") : b.status === "removed" ? t("timeline.removed") : "");
  if (layout === "side") {
    return (
      <div className="hh-filediff-grid">
        {blocks.map((b, i) => (
          <div key={i} className={`hh-filediff-row${statusClass(b)}`}>
            <div className="hh-filediff-before">{b.type === "tableRow" ? <table><tbody><tr>{rowCells(b, "before")}</tr></tbody></table> : <BlockView b={b} side="before" path={path} n={i} />}</div>
            <div className="hh-filediff-after">{b.type === "tableRow" ? <table><tbody><tr>{rowCells(b, "after")}</tr></tbody></table> : <BlockView b={b} side="after" path={path} n={i} />}</div>
          </div>
        ))}
      </div>
    );
  }
  let n = 0;
  return (
    <>
      {groups(blocks).map((g, i) =>
        Array.isArray(g) ? (
          <table key={i} className="hh-filediff-table">
            <tbody>
              {g.map((b, k) => (
                <tr key={k} className={statusClass(b).trim() || undefined}>
                  {rowCells(b, "both")}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div key={i} className={`hh-filediff-block${statusClass(g)}`}>
            {label(g) && <span className="hh-sr-only">{label(g)}</span>}
            <BlockView b={g} side="both" path={path} n={n++} />
          </div>
        ),
      )}
    </>
  );
}

/** The width of `ref`'s box, followed while it changes (null before the first measure or without ResizeObserver). */
function useWidth(ref: React.RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/** What changed in a file between two versions (file-timeline spec §4), inline or side by side. Text only, never HTML. */
export function FileDiff({ client, path, from, to, layout: initial = "inline" }: FileDiffProps) {
  const { t } = useTranslation();
  const [diff, setDiff] = useState<FileDiffResult | null>(null);
  const [layout, setLayout] = useState<DiffLayout>(initial);
  const [source, setSource] = useState(false);
  const box = useRef<HTMLElement>(null);
  const width = useWidth(box);
  useEffect(() => {
    let live = true;
    setDiff(null);
    client.files.diff(path, from, to).then(
      (d) => live && setDiff(d),
      () => live && setDiff({ ok: false, reason: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [client, path, from, to]);
  // Narrow: inline whatever was picked (§4.3).
  const shown: DiffLayout = layout === "side" && width !== null && width < SIDE_MIN_PX ? "inline" : layout;
  let body: ReactNode;
  if (diff === null) body = <p className="hh-caption" role="status">{t("timeline.loading")}</p>;
  else if (!diff.ok) body = <p className="hh-warn" role="alert">{t("timeline.diffFailed")}</p>;
  else if (diff.same) body = <p className="hh-caption">{t("timeline.noChanges")}</p>;
  else if (diff.kind === "binary")
    body = (
      <p className="hh-caption">
        {t("timeline.binary", {
          before: diff.sizes.before === null ? t("timeline.noFile") : formatSize(diff.sizes.before),
          after: diff.sizes.after === null ? t("timeline.noFile") : formatSize(diff.sizes.after),
        })}
      </p>
    );
  else if (diff.kind === "text") body = shown === "side" ? <SideLines lines={diff.lines} lang={diff.lang} /> : <Lines lines={diff.lines} lang={diff.lang} />;
  // The raw text, unhighlighted: it is what the person reads to check the marks.
  else if (source) body = shown === "side" ? <SideLines lines={diff.source} lang={null} /> : <Lines lines={diff.source} lang={null} />;
  else body = <MarkdownDiff blocks={diff.blocks} path={path} layout={shown} />;
  const canLayout = diff?.ok === true && !diff.same && diff.kind !== "binary";
  return (
    <section ref={box} className={`hh-filediff hh-filediff-${shown}`} aria-label={t("timeline.diff")}>
      {canLayout && (
        <div className="hh-filediff-tools">
          <div className="hh-segmented" role="group" aria-label={t("timeline.layout")}>
            <button type="button" aria-pressed={layout === "inline"} onClick={() => setLayout("inline")}>
              {t("timeline.inline")}
            </button>
            <button type="button" aria-pressed={layout === "side"} onClick={() => setLayout("side")}>
              {t("timeline.sideBySide")}
            </button>
          </div>
          {diff?.ok && diff.kind === "markdown" && (
            <button type="button" aria-pressed={source} onClick={() => setSource((s) => !s)}>
              {t("timeline.source")}
            </button>
          )}
        </div>
      )}
      {diff?.ok && diff.kind !== "binary" && diff.truncated && (
        <p className="hh-caption" role="note">
          {t("timeline.truncated")}
        </p>
      )}
      {body}
    </section>
  );
}
```

A changed code fence is drawn as plain lines (`lang={null}`): the fence's language is not in the block, and highlighting inside a changed fence is not needed in v1.

`formatSize` is already exported by `DocumentReader.tsx`; `FileDiff` importing it is fine (no cycle: `DocumentReader` imports `EntryDiff` only from Task 13, and `EntryDiff` imports `FileDiff`; if the bundler or vitest reports a cycle, move `formatSize` to a new `packages/ui/src/sizes.ts` and import it from both).

In `packages/ui/src/index.ts`: `export { FileDiff, type FileDiffProps } from "./FileDiff";`

- [ ] **Step 4: Styles**

```css
/* File diff (file-timeline spec §4): marks carry a line or strike as well as colour. */
.hh-filediff { display: flex; flex-direction: column; gap: 8px; }
.hh-filediff-tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.hh-filediff ins { background: var(--hh-diff-ins); text-decoration: underline; text-decoration-color: var(--hh-diff-bar-ins); }
.hh-filediff del { background: var(--hh-diff-del); text-decoration: line-through; text-decoration-color: var(--hh-diff-bar-del); }
.hh-filediff-block { padding-left: 10px; border-left: 3px solid transparent; }
.hh-filediff-added { border-left-color: var(--hh-diff-bar-ins); background: var(--hh-diff-ins); }
.hh-filediff-removed { border-left-color: var(--hh-diff-bar-del); background: var(--hh-diff-del); text-decoration: line-through; }
.hh-filediff-lines { width: 100%; border-collapse: collapse; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.hh-filediff-lines td { padding: 0 6px; vertical-align: top; white-space: pre-wrap; overflow-wrap: anywhere; }
.hh-filediff-no { width: 1%; color: var(--hh-muted); text-align: right; user-select: none; }
.hh-filediff-sign { width: 1%; user-select: none; }
.hh-filediff-ins { background: var(--hh-diff-ins); }
.hh-filediff-del { background: var(--hh-diff-del); }
.hh-filediff-gap td { color: var(--hh-muted); }
.hh-filediff-table { border-collapse: collapse; }
.hh-filediff-table td { padding: 2px 8px; border: 1px solid var(--hh-line); }
.hh-filediff-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 12px; }
.hh-filediff-row { display: contents; }
.hh-filediff-before, .hh-filediff-after { min-width: 0; padding: 2px 6px; }
.hh-filediff-diagrams figure { margin: 0 0 8px; }
.hh-filediff-diagrams figcaption { font-size: 12px; color: var(--hh-muted); }
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `corepack pnpm vitest run packages/ui/test/file-diff.test.tsx`
Expected: PASS. (happy-dom has no `ResizeObserver` by default: `useWidth` stays null and the chosen layout shows.)

- [ ] **Step 6: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`

```bash
git -C <worktree> add packages/ui/src/FileDiff.tsx packages/ui/src/index.ts packages/ui/src/styles.css packages/ui/test/file-diff.test.tsx
git -C <worktree> commit -m "feat(ui): the file diff view, inline and side by side"
```

---

### Task 12: Picking an entry, the confirmation

**Files:**
- Create: `packages/ui/src/EntryDiff.tsx`, `packages/ui/src/RestoreConfirm.tsx`
- Modify: `packages/ui/src/ChatView.tsx`, `packages/ui/src/styles.css`
- Test: `packages/ui/test/entry-diff.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/entry-diff.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { FileRestorePrompt, HarnessClient, TimelineEntry } from "../src/client";
import { EntryDiff } from "../src/EntryDiff";
import { RestoreConfirm } from "../src/RestoreConfirm";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const A = "a".repeat(40);
const B = "b".repeat(40);
const DOC = "specs/filter.md";
const entry: TimelineEntry = {
  kind: "task",
  author: { kind: "agent", label: "Spec writer", task: "t1", action: "spec" },
  label: "1 change",
  at: "2026-10-28T10:00:00.000Z",
  from: A,
  to: B,
  commits: [{ id: B, subject: "Turn: write", at: "2026-10-28T10:00:00.000Z" }],
};
const same = { ok: true as const, kind: "markdown" as const, same: true, truncated: false, blocks: [], source: [] };
const changed = { ...same, same: false, blocks: [{ type: "paragraph" as const, status: "added" as const, after: "New." }] };

function setup() {
  const client = new FakeClient();
  client.timelines[DOC] = [entry];
  client.diffs[`${DOC}|${A}|${B}`] = changed;
  client.diffs[`${DOC}|${B}|current`] = same;
  return client;
}

describe("EntryDiff (file-timeline spec §4.1, §5, §6.1)", () => {
  it("compares here by default, or against the current version", async () => {
    const client = setup();
    await renderIn("en", <EntryDiff client={client} path={DOC} entry={entry} onBack={() => undefined} />);
    expect(await screen.findByText("New.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Against the current version" }));
    expect(await screen.findByText("No changes")).toBeTruthy();
    expect(client.fileCalls.filter((c) => c.op === "diff").map((c) => c.args)).toEqual([
      [DOC, A, B],
      [DOC, B, "current"],
    ]);
  });

  it("go back: the core's confirmation, then the restore; cancel keeps everything", async () => {
    const client = setup();
    let restored = 0;
    await renderIn(
      "en",
      <>
        <RestoreHost client={client} />
        <EntryDiff client={client} path={DOC} entry={entry} onBack={() => undefined} onRestored={() => restored++} />
      </>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Go back to this version" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(`Go back ${DOC} to how it was after Spec writer`);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(restored).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Go back to this version" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, go back" }));
    expect(await screen.findByText(`${DOC} is back to that version.`)).toBeTruthy();
    expect(restored).toBe(1);
  });

  it("disabled while a turn runs, and for a deleted entry; refusals are shown", async () => {
    const client = setup();
    await renderIn("en", <EntryDiff client={client} path={DOC} entry={entry} busy onBack={() => undefined} />);
    expect((await screen.findByRole("button", { name: "Go back to this version" })).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("The AI is working. You can go back when it finishes.")).toBeTruthy();
    cleanup();
    client.restoreAnswer = { ok: false, reason: "unsafe" };
    client.files.hostConfirm(async () => true);
    await renderIn("en", <EntryDiff client={client} path={DOC} entry={entry} onBack={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Go back to this version" }));
    expect(await screen.findByText("I couldn't write the file safely, so nothing changed.")).toBeTruthy();
    cleanup();
    await renderIn("en", <EntryDiff client={client} path={DOC} entry={{ ...entry, deleted: true }} onBack={() => undefined} />);
    expect((await screen.findByRole("button", { name: "Go back to this version" })).hasAttribute("disabled")).toBe(true);
  });
});

/** What ChatView does: registers the confirmation with the client and draws it. */
function RestoreHost({ client }: { client: HarnessClient }) {
  const [ask, setAsk] = useState<{ prompt: FileRestorePrompt; answer: (yes: boolean) => void } | null>(null);
  useEffect(() => client.files.hostConfirm((prompt) => new Promise<boolean>((answer) => setAsk({ prompt, answer }))), [client]);
  return ask ? <RestoreConfirm prompt={ask.prompt} onAnswer={(yes) => (ask.answer(yes), setAsk(null))} /> : null;
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/ui/test/entry-diff.test.tsx`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write `RestoreConfirm.tsx`**

Create `packages/ui/src/RestoreConfirm.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { FileRestorePrompt } from "./client";
import { authorName, timeAgo } from "./FileTimeline";

/**
 * The core's "go back?" (file-timeline spec §5): says which file, to whose version and when, and that nothing else in
 * the folder changes. Cancel has focus first; Esc cancels.
 */
export function RestoreConfirm({ prompt, onAnswer }: { prompt: FileRestorePrompt; onAnswer: (yes: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  const author = prompt.kind === "approval" && prompt.version ? t("timeline.approved", { version: prompt.version }) : authorName(t, prompt.author);
  return (
    <div className="hh-backdrop">
      <div
        className="hh-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="hh-restore-confirm-text"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onAnswer(false);
          }
        }}
      >
        <p id="hh-restore-confirm-text">{t("timeline.confirm", { file: prompt.path, author, ago: timeAgo(prompt.at, i18n.language) })}</p>
        <div className="hh-confirm-actions">
          <button type="button" ref={cancel} onClick={() => onAnswer(false)}>
            {t("timeline.cancel")}
          </button>
          <button type="button" className="hh-primary" onClick={() => onAnswer(true)}>
            {t("timeline.confirmYes")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Check `styles.css` for the existing backdrop/confirm classes (the History panel's confirmation and the review bar's prompt use some); reuse what exists. If there is no `.hh-backdrop`/`.hh-confirm`, add:

```css
.hh-backdrop { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; background: var(--hh-backdrop); }
.hh-confirm { max-width: 440px; padding: 16px; border-radius: 10px; background: var(--hh-surface); border: 1px solid var(--hh-line); }
.hh-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
```

- [ ] **Step 4: Write `EntryDiff.tsx`**

Create `packages/ui/src/EntryDiff.tsx`:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { FileRestoreResult, HarnessClient, TimelineEntry } from "./client";
import { FileDiff } from "./FileDiff";

/** One entry's diff (file-timeline spec §4.1, §6.1): what changed here or against now, and going back to it. */
export function EntryDiff({
  client,
  path,
  entry,
  busy = false,
  backLabel,
  onBack,
  onRestored,
}: {
  client: HarnessClient;
  path: string;
  entry: TimelineEntry;
  /** A turn runs: going back waits. */
  busy?: boolean;
  /** "Back to the document" (default) or "Back to the list". */
  backLabel?: string;
  onBack: () => void;
  onRestored?: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"here" | "current">("here");
  const [status, setStatus] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const goBack = async () => {
    setWorking(true);
    setStatus(null);
    const r: FileRestoreResult = await client.files.restore(path, entry.to).catch(() => ({ refused: "failed" as const }));
    setWorking(false);
    if (r === "cancelled") return;
    if (r === "restored") {
      setStatus(t("timeline.restored", { file: path }));
      onRestored?.();
      return;
    }
    const known = r.refused === "busy" || r.refused === "deleted" || r.refused === "unsafe";
    setStatus(t(known ? `timeline.refused.${r.refused}` : "timeline.refused.other"));
  };
  return (
    <div className="hh-entry-diff">
      <div className="hh-filediff-tools">
        <div className="hh-segmented" role="group" aria-label={t("timeline.compare")}>
          <button type="button" aria-pressed={mode === "here"} onClick={() => setMode("here")}>
            {t("timeline.compareHere")}
          </button>
          <button type="button" aria-pressed={mode === "current"} onClick={() => setMode("current")}>
            {t("timeline.compareCurrent")}
          </button>
        </div>
        <button type="button" disabled={busy || working || entry.deleted === true} onClick={goBack}>
          {t("timeline.goBack")}
        </button>
        <button type="button" onClick={onBack}>
          {backLabel ?? t("timeline.backToDocument")}
        </button>
      </div>
      {busy && <p className="hh-caption">{t("timeline.busy")}</p>}
      {status && (
        <p className="hh-caption" role="status">
          {status}
        </p>
      )}
      <FileDiff key={mode} client={client} path={path} from={mode === "here" ? entry.from : entry.to} to={mode === "here" ? entry.to : "current"} />
    </div>
  );
}
```

- [ ] **Step 5: ChatView hosts the confirmation**

In `packages/ui/src/ChatView.tsx` (imports: `RestoreConfirm` and the `FileRestorePrompt` type):

```tsx
  /** The core's "go back?" for every `client.files.restore`, from the reader, a panel or a harness view (§5). */
  const [restoreAsk, setRestoreAsk] = useState<{ prompt: FileRestorePrompt; answer: (yes: boolean) => void } | null>(null);
  useEffect(
    () =>
      client.files.hostConfirm(
        (prompt) =>
          new Promise<boolean>((answer) =>
            setRestoreAsk((open) => {
              // A second request while one is open: the first is answered no.
              open?.answer(false);
              return { prompt, answer };
            }),
          ),
      ),
    [client],
  );
```

and next to the `HistoryPanel` mount (inside the outer `<div>`):

```tsx
        {restoreAsk && (
          <RestoreConfirm
            prompt={restoreAsk.prompt}
            onAnswer={(yes) => {
              restoreAsk.answer(yes);
              setRestoreAsk(null);
            }}
          />
        )}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `corepack pnpm vitest run packages/ui/test/entry-diff.test.tsx packages/ui/test/flow.test.tsx`
Expected: PASS (the flow test renders `ChatView` with the fake client, whose `files.hostConfirm` now exists).

- [ ] **Step 7: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`

```bash
git -C <worktree> add packages/ui/src/EntryDiff.tsx packages/ui/src/RestoreConfirm.tsx packages/ui/src/ChatView.tsx packages/ui/src/styles.css packages/ui/test/entry-diff.test.tsx
git -C <worktree> commit -m "feat(ui): an entry's diff, compare modes, and the core's go-back confirmation"
```

---
### Task 13: The reader's "File history" drawer

**Files:**
- Modify: `packages/ui/src/DocumentReader.tsx`, `packages/ui/src/styles.css`
- Test: `packages/ui/test/document-reader-timeline.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/document-reader-timeline.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineEntry } from "../src/client";
import { DocumentReader } from "../src/DocumentReader";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const DOC = "docs/cache.md";
const A = "a".repeat(40);
const B = "b".repeat(40);
const entry: TimelineEntry = {
  kind: "task",
  author: { kind: "agent", label: "Spec writer", task: "t1", action: "spec" },
  label: "1 change",
  at: "2026-10-28T10:00:00.000Z",
  from: A,
  to: B,
  commits: [{ id: B, subject: "Turn: write", at: "2026-10-28T10:00:00.000Z" }],
};

function setup(over: Partial<Parameters<typeof DocumentReader>[0]> = {}) {
  const client = new FakeClient();
  client.docTexts[DOC] = "## Context\n\nSlow calls.\n";
  client.timelines[DOC] = [entry];
  client.diffs[`${DOC}|${A}|${B}`] = { ok: true, kind: "markdown", same: false, truncated: false, blocks: [{ type: "paragraph", status: "added", after: "Slow calls." }], source: [] };
  const props = { client, target: { path: DOC }, prefs: {}, onPrefs: vi.fn(), full: false, onFull: vi.fn(), onClose: vi.fn(), onOpen: vi.fn(), ...over };
  return { client, props, view: renderIn("en", <DocumentReader {...props} />) };
}

describe("the reader's file history (file-timeline spec §6.1)", () => {
  it("the button opens the drawer; picking an entry shows its diff in place of the document; back returns", async () => {
    setup();
    await screen.findByText("Slow calls.");
    expect(screen.queryByRole("region", { name: "File history" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "File history" }));
    const drawer = screen.getByRole("region", { name: "File history" });
    fireEvent.click(await within(drawer).findByRole("button", { name: /Spec writer/ }));
    const diff = await screen.findByRole("region", { name: "Changes" });
    expect(diff.querySelector(".hh-filediff-added")?.textContent).toContain("Slow calls.");
    expect(screen.queryByRole("article")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to the document" }));
    expect(screen.queryByRole("region", { name: "Changes" })).toBeNull();
    expect(await screen.findByText("Slow calls.")).toBeTruthy();
  });

  it("opens with the drawer when the target asks (the History panel's link)", async () => {
    setup({ target: { path: DOC, timeline: true } });
    expect(await screen.findByRole("region", { name: "File history" })).toBeTruthy();
  });

  it("focus mode hides the drawer; the button leaves focus mode and opens it", async () => {
    const onFocus = vi.fn();
    setup({ review: true, focus: true, onFocus, target: { path: DOC, timeline: true } });
    await screen.findByText("Slow calls.");
    expect(screen.queryByRole("region", { name: "File history" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "File history" }));
    expect(onFocus).toHaveBeenCalledWith(false);
  });

  it("the review footer bar is hidden while a diff shows", async () => {
    setup({ review: true, target: { path: DOC, timeline: true } });
    await screen.findByRole("button", { name: "Approve" });
    fireEvent.click(await screen.findByRole("button", { name: /Spec writer/ }));
    await screen.findByRole("region", { name: "Changes" });
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});
```

(If the reader's `<article>` has no implicit `article` role in happy-dom, assert on `document.querySelector(".hh-reader-doc")` instead.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/ui/test/document-reader-timeline.test.tsx`
Expected: FAIL (no "File history" button).

- [ ] **Step 3: Change `DocumentReader.tsx`**

- `ReaderTarget` gains:

```ts
  /** Open with the "File history" drawer (the History panel's link, file-timeline spec §6.2). */
  timeline?: boolean;
```

- Imports: `EntryDiff` from `./EntryDiff`, `FileTimeline` from `./FileTimeline`, and the `TimelineEntry` type.
- State, after `peek`:

```tsx
  /** The "File history" drawer (file-timeline spec §6.1), and the entry whose diff shows in place of the document. */
  const [drawer, setDrawer] = useState(target.timeline === true);
  const [picked, setPicked] = useState<TimelineEntry | null>(null);
  const drawerId = useId();
  // The History panel's link opens the drawer, also on a document already shown.
  useEffect(() => {
    if (target.timeline) setDrawer(true);
  }, [path, target.nonce, target.timeline]);
  // Focus mode hides the drawer and shows the document itself.
  useEffect(() => {
    if (inFocus) setPicked(null);
  }, [inFocus]);
```

- In the path-change effect's resets, add `setPicked(null);`.
- `onKeyDown`: before `if (pick) closePick();` add `if (picked) setPicked(null); else` so Esc leaves the diff first.
- The footer bar is hidden while a diff shows: `const bar = review && !picked && doc?.ok && !source && rv?.ok && (` …
- The selection button too: `{review && pick && !picked && doc?.ok && !source && (` …
- The header button, right before the Focus button:

```tsx
          <button
            type="button"
            aria-pressed={drawer && !inFocus}
            aria-controls={drawer && !inFocus ? drawerId : undefined}
            disabled={refused}
            onClick={() => {
              // In focus mode the drawer is hidden (§6.1): the button leaves focus mode and opens it.
              if (inFocus && onFocus) {
                onFocus(false);
                setDrawer(true);
              } else setDrawer((d) => !d);
            }}
          >
            {t("timeline.open")}
          </button>
```

- In `.hh-reader-scroll`, the article becomes:

```tsx
          {picked ? (
            <EntryDiff client={client} path={path} entry={picked} busy={busy} onBack={() => setPicked(null)} />
          ) : (
            <article className={`hh-reader-doc hh-reader-${look.font}${look.size === "large" ? " hh-reader-large" : ""}`}>{body}</article>
          )}
```

and the `ApprovedDiff` line above it gets `!picked &&` in its condition.
- The drawer, in `.hh-reader-columns` right after the `.hh-reader-scroll` div and before the review column:

```tsx
        {drawer && !inFocus && !refused && (
          <section className="hh-timeline-drawer" id={drawerId} aria-label={t("timeline.title")}>
            <FileTimeline client={client} path={path} selected={picked?.to} onPick={setPicked} />
          </section>
        )}
```

- [ ] **Step 4: Styles**

```css
/* The reader's "File history" drawer (file-timeline spec §6.1). */
.hh-timeline-drawer { flex: 0 0 280px; overflow-y: auto; padding: 12px; border-left: 1px solid var(--hh-line); background: var(--hh-sheet); }
.hh-entry-diff { max-width: 72ch; margin: 0 auto; display: flex; flex-direction: column; gap: 8px; }
.hh-reader-is-full .hh-entry-diff { max-width: none; }
@container (max-width: 900px) {
  .hh-timeline-drawer { flex-basis: 220px; }
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `corepack pnpm vitest run packages/ui/test/document-reader-timeline.test.tsx packages/ui/test/document-reader.test.tsx packages/ui/test/focus-mode.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`

```bash
git -C <worktree> add packages/ui/src/DocumentReader.tsx packages/ui/src/styles.css packages/ui/test/document-reader-timeline.test.tsx
git -C <worktree> commit -m "feat(ui): the reader's File history drawer and an entry's diff in place of the document"
```

---

### Task 14: The History panel's links and the timeline panel

**Files:**
- Create: `packages/ui/src/FileTimelinePanel.tsx`
- Modify: `packages/ui/src/HistoryPanel.tsx`, `packages/ui/src/ChatView.tsx`, `packages/ui/src/client.ts`
- Test: `packages/ui/test/file-timeline-panel.test.tsx`, `packages/ui/test/history-panel.test.tsx` (append)

- [ ] **Step 1: Write the failing tests**

Append to `packages/ui/test/history-panel.test.tsx`:

```tsx
describe("changed files open their timeline (file-timeline spec §6.2)", () => {
  it("with onOpenFile, each changed file is a link that says which file and how it changed", async () => {
    const client = new FakeClient();
    client.historyGroups = groups;
    const opened: [string, string][] = [];
    await renderIn("en", <HistoryPanel client={client} actions={actions} onClose={() => undefined} onOpenFile={(p, k) => opened.push([p, k])} />);
    fireEvent.click(await screen.findByRole("button", { name: "History of plan.md" }));
    fireEvent.click(screen.getByRole("button", { name: "History of old.md" }));
    expect(opened).toEqual([
      ["plan.md", "modified"],
      ["old.md", "deleted"],
    ]);
  });

  it("D0: without onOpenFile the paths stay plain text", async () => {
    const client = new FakeClient();
    client.historyGroups = groups;
    await renderIn("en", <HistoryPanel client={client} actions={actions} onClose={() => undefined} />);
    await screen.findAllByText("plan.md");
    expect(screen.queryByRole("button", { name: "History of plan.md" })).toBeNull();
  });

  it("a one-file go-back reads in plain language", () => {
    expect(entryLabel("Go back: specs/a to b.md to v2")).toEqual({ key: "history.entry.fileBack", values: { file: "specs/a to b.md" } });
  });
});
```

Create `packages/ui/test/file-timeline-panel.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TimelineEntry } from "../src/client";
import { FileTimelinePanel } from "../src/FileTimelinePanel";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const FILE = ".harness/reviews/specs/filter.md.json";
const A = "a".repeat(40);
const B = "b".repeat(40);
const entry: TimelineEntry = {
  kind: "task",
  author: { kind: "agent", label: "Spec writer", task: "t1", action: "spec" },
  label: "1 change",
  at: "2026-10-28T10:00:00.000Z",
  from: A,
  to: B,
  commits: [{ id: B, subject: "Turn: write", at: "2026-10-28T10:00:00.000Z" }],
};

describe("FileTimelinePanel (file-timeline spec §6.2)", () => {
  it("a dialog with the file's timeline; an entry opens its diff; back to the list; Esc closes", async () => {
    const client = new FakeClient();
    client.timelines[FILE] = [entry];
    client.diffs[`${FILE}|${A}|${B}`] = { ok: true, kind: "text", same: false, truncated: false, lang: "json", lines: [{ kind: "ins", text: "{}", new: 1 }] };
    let closed = 0;
    await renderIn("en", <FileTimelinePanel client={client} path={FILE} onClose={() => closed++} />);
    const dialog = screen.getByRole("dialog", { name: `History of ${FILE}` });
    fireEvent.click(await screen.findByRole("button", { name: /Spec writer/ }));
    expect((await screen.findByRole("region", { name: "Changes" })).textContent).toContain("{}");
    fireEvent.click(screen.getByRole("button", { name: "Back to the list" }));
    expect(await screen.findByRole("list", { name: "Versions and changes" })).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(closed).toBe(1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/ui/test/file-timeline-panel.test.tsx packages/ui/test/history-panel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: The History panel**

In `packages/ui/src/client.ts`, add `FILE_RESTORE_PREFIX` to the `@humanharness/workspace/subjects` re-export line.

In `packages/ui/src/HistoryPanel.tsx`:
- import `FILE_RESTORE_PREFIX` and the `HistoryFileChange` type from `./client`;
- `entryLabel`, before the `NOTE` check:

```ts
  if (message.startsWith(FILE_RESTORE_PREFIX)) {
    // `Go back: <path> to <target>`: the target never holds " to " (v2, "the version of <ISO time>"), so the last one splits.
    const rest = message.slice(FILE_RESTORE_PREFIX.length);
    const cut = rest.lastIndexOf(" to ");
    return { key: "history.entry.fileBack", values: { file: cut < 0 ? rest : rest.slice(0, cut) } };
  }
```

- a prop:

```ts
  /** A changed file was picked: its timeline opens (file-timeline spec §6.2). Absent: the paths stay plain text. */
  onOpenFile?: (path: string, kind: HistoryFileChange["kind"]) => void;
```

- the file row:

```tsx
                            <li key={c.path}>
                              <span className={`hh-change ${c.kind}`}>{t(`history.change.${c.kind}`)}</span>
                              {onOpenFile ? (
                                <button type="button" className="hh-link" title={c.path} aria-label={t("history.openTimeline", { file: c.path })} onClick={() => onOpenFile(c.path, c.kind)}>
                                  <code>{c.path}</code>
                                </button>
                              ) : (
                                <code title={c.path}>{c.path}</code>
                              )}
                            </li>
```

- [ ] **Step 4: `FileTimelinePanel.tsx`**

Create `packages/ui/src/FileTimelinePanel.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CloseIcon } from "./chrome";
import type { HarnessClient, TimelineEntry } from "./client";
import { EntryDiff } from "./EntryDiff";
import { FileTimeline } from "./FileTimeline";

/** A file's timeline outside the reader (file-timeline spec §6.2): any file but a `.md` the reader can open. */
export function FileTimelinePanel({ client, path, busy = false, onClose }: { client: HarnessClient; path: string; busy?: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<TimelineEntry | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
  }, []);
  const close = () => {
    const back = opener.current;
    onClose();
    if (back?.isConnected) back.focus();
  };
  const title = t("timeline.panelTitle", { file: path });
  return (
    <aside
      className="hh-history hh-timeline-panel"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        if (picked) setPicked(null);
        else close();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button ref={closeRef} className="hh-icon-button" aria-label={t("timeline.close")} onClick={close}>
          <CloseIcon />
        </button>
      </header>
      {picked ? (
        <EntryDiff client={client} path={path} entry={picked} busy={busy} backLabel={t("timeline.backToList")} onBack={() => setPicked(null)} />
      ) : (
        <FileTimeline client={client} path={path} onPick={setPicked} />
      )}
    </aside>
  );
}
```

- [ ] **Step 5: ChatView wiring**

In `packages/ui/src/ChatView.tsx` (imports: `FileTimelinePanel`; `isMarkdownPath` from `@humanharness/harness-sdk/documents`):

```tsx
  /** A non-`.md` file's timeline (or a deleted `.md`), opened from the History panel (file-timeline spec §6.2). */
  const [timelineFile, setTimelineFile] = useState<string | null>(null);
```

On the `HistoryPanel` mount:

```tsx
            onOpenFile={(file, kind) => {
              setShowHistory(false);
              if (kind !== "deleted" && isMarkdownPath(file) && !slim) showReader({ path: file, timeline: true });
              else setTimelineFile(file);
            }}
```

After the `HistoryPanel` mount:

```tsx
        {timelineFile && (
          <FileTimelinePanel client={client} path={timelineFile} busy={Boolean(chat.live) || closing || checkpoint} onClose={() => setTimelineFile(null)} />
        )}
```

and pass `busy` the same way the reader gets it (the `DocumentReader` already receives `busy={Boolean(chat.live) || closing || checkpoint}`, which `EntryDiff` uses).

- [ ] **Step 6: Run the tests to see them pass**

Run: `corepack pnpm vitest run packages/ui/test/file-timeline-panel.test.tsx packages/ui/test/history-panel.test.tsx packages/ui/test/flow.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`

```bash
git -C <worktree> add packages/ui/src/FileTimelinePanel.tsx packages/ui/src/HistoryPanel.tsx packages/ui/src/ChatView.tsx packages/ui/src/client.ts packages/ui/test/file-timeline-panel.test.tsx packages/ui/test/history-panel.test.tsx
git -C <worktree> commit -m "feat(ui): the History panel's changed files open their timeline"
```

---

### Task 15: "See what changed" uses the timeline's diff

**Files:**
- Modify: `packages/ui/src/ApprovedDiff.tsx`, `packages/ui/src/DocumentReader.tsx`, `packages/ui/src/styles.css`
- Modify: `packages/ui/test/document-reader.test.tsx`

The review spec's "See what changed" (§5.4) becomes this spec's diff from the last approval to the current text (§9).

- [ ] **Step 1: Change the two tests first**

In `packages/ui/test/document-reader.test.tsx`, the test "an approved version that can't be read says so, not 'too large'" keeps its assertion (the fake's `files.timeline` answers `untracked` for the path, so there is no approval entry: the same sentence shows). The test "'See what changed' shows the lines added and removed since the approval" becomes:

```tsx
  it("'See what changed' shows what changed since the approval, with the timeline's diff", async () => {
    const { client } = setup({ review: true });
    await screen.findByRole("button", { name: "Approve" });
    client.reviews["docs/cache.md"] = { path: "docs/cache.md", task: null, comments: [], approvals: [{ blob: "0".repeat(40), at: "2026-10-28T10:00:00.000Z" }] };
    client.currentBlobs["docs/cache.md"] = "1".repeat(40);
    const approved = "c".repeat(40);
    client.timelines["docs/cache.md"] = [
      { kind: "approval", author: { kind: "person", label: "You" }, label: "v1 approved", at: "2026-10-28T10:00:00.000Z", from: "d".repeat(40), to: approved, version: 1, commits: [{ id: approved, subject: "Approved: docs/cache.md", at: "2026-10-28T10:00:00.000Z" }] },
    ];
    client.diffs[`docs/cache.md|${approved}|current`] = {
      ok: true,
      kind: "markdown",
      same: false,
      truncated: false,
      blocks: [{ type: "paragraph", status: "changed", before: "Slow calls.", after: "Fast calls.", parts: [{ kind: "del", text: "Slow" }, { kind: "ins", text: "Fast" }, { kind: "same", text: " calls." }] }],
      source: [],
    };
    act(() => client.emitReviewChanged("docs/cache.md"));
    fireEvent.click(await screen.findByRole("button", { name: "See what changed" }));
    const diff = await screen.findByRole("region", { name: "Changes since the approval" });
    await waitFor(() => expect(diff.querySelector("ins")?.textContent).toBe("Fast"));
    expect(diff.querySelector("del")?.textContent).toBe("Slow");
    fireEvent.click(screen.getByRole("button", { name: "Hide changes" }));
    expect(screen.queryByRole("region", { name: "Changes since the approval" })).toBeNull();
  });
```

- [ ] **Step 2: Run them to see the second fail**

Run: `corepack pnpm vitest run packages/ui/test/document-reader.test.tsx`
Expected: FAIL on the changed test (the old `ApprovedDiff` reads `approvedTexts`).

- [ ] **Step 3: Rewrite `ApprovedDiff.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient } from "./client";
import { FileDiff } from "./FileDiff";

/**
 * "See what changed" (review spec §5.4, file-timeline spec §9): the last approved version against the file now, drawn
 * with the timeline's diff. The approval is the newest `approval` entry of the file's timeline.
 */
export function ApprovedDiff({ client, path }: { client: HarnessClient; path: string }) {
  const { t } = useTranslation();
  const [from, setFrom] = useState<string | null | "loading">("loading");
  useEffect(() => {
    let live = true;
    const load = () =>
      client.files.timeline(path).then(
        (r) => live && setFrom((r.ok ? r.entries.find((e) => e.kind === "approval")?.to : undefined) ?? null),
        () => live && setFrom(null),
      );
    setFrom("loading");
    load();
    const off = client.files.onChange(path, load);
    return () => {
      live = false;
      off();
    };
  }, [client, path]);
  if (from === "loading") return null;
  return (
    <section className="hh-diff" aria-label={t("review.diff")}>
      {from === null ? <p className="hh-caption">{t("review.noApproved")}</p> : <FileDiff client={client} path={path} from={from} to="current" />}
    </section>
  );
}
```

In `DocumentReader.tsx` the call becomes `<ApprovedDiff client={client} path={path} />` (no `current`). In `styles.css` the old line-diff rules under `/* "See what changed" (§5.4) … */` (`.hh-diff ol`, `.hh-diff-added`, `.hh-diff-removed`, `.hh-diff-same`, `.hh-diff-gap`) go; `.hh-diff` keeps its box. `review.noDiff` stays in `en.json` only if something else uses it (`grep -rn "review.noDiff" packages`); otherwise remove it. `client.documents.approvedText` stays (public API; harness views may use it).

- [ ] **Step 4: Run the tests to see them pass**

Run: `corepack pnpm vitest run packages/ui/test/document-reader.test.tsx packages/ui/test/review-bar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`

```bash
git -C <worktree> add packages/ui/src/ApprovedDiff.tsx packages/ui/src/DocumentReader.tsx packages/ui/src/styles.css packages/i18n/src/locales/en.json packages/ui/test/document-reader.test.tsx
git -C <worktree> commit -m "feat(ui): 'See what changed' draws the timeline's diff from the last approval"
```

---

### Task 16: End to end in mock mode

**Files:**
- Modify: `packages/e2e/tests/review.spec.ts`

The review fixture (`packages/fake-agent/fixtures/review-harness`) already has an agent that writes `specs/filter.md` and asks two questions in it; its build is shared by the tests in `review.spec.ts`'s `describe`, so the timeline test goes there.

- [ ] **Step 1: Write the test**

Inside `test.describe("the review fixture", …)` in `packages/e2e/tests/review.spec.ts`, after the existing tests:

```ts
  test("file timeline: what the agent changed, the person's answer, go back and undo it, from the reader and the History panel", async () => {
    test.setTimeout(120_000);
    const s = makeSandbox("timeline");
    let app: ElectronApplication | undefined;
    try {
      const launched = await launchMock(s, path.join(fixture, "mock"), mainJs);
      app = launched.app;
      const page = launched.page;
      const csp: string[] = [];
      page.on("console", (m) => {
        if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text());
      });
      const doc = path.join(s.folder, "specs", "filter.md");
      await startTicket(page);
      const written = fs.readFileSync(doc, "utf8");

      // The reader's File history: one entry by the ticket's agent; its diff shows the text it wrote.
      await page.getByRole("button", { name: /Filter/ }).first().click();
      const reader = page.getByRole("complementary", { name: "Document" });
      await reader.getByRole("button", { name: "File history" }).click();
      const drawer = reader.getByRole("region", { name: "File history" });
      await expect(drawer.getByRole("button", { name: /Ticket/ })).toContainText("1 change");

      // An answer swaps the passage: a "Your answers (1)" entry, not approved yet.
      await reader.getByRole("region", { name: "Comments" }).getByRole("radio", { name: "Size and colour" }).click();
      await expect.poll(() => fs.readFileSync(doc, "utf8")).toContain("Filter by size and colour.");
      const answers = drawer.getByRole("button", { name: /Your answers \(1\)/ });
      await expect(answers).toContainText("not approved");

      // The agent's entry: what changed here, then against the current version.
      await drawer.getByRole("button", { name: /Ticket/ }).click();
      const diff = reader.getByRole("region", { name: "Changes" });
      await expect(diff).toContainText("Filter by size.");
      await reader.getByRole("button", { name: "Against the current version" }).click();
      await expect(diff.locator("ins")).toContainText(["and colour"]);

      // Go back to the agent's version: the core asks first; only this file changes.
      await reader.getByRole("button", { name: "Go back to this version" }).click();
      const confirm = page.getByRole("alertdialog");
      await expect(confirm).toContainText("Go back specs/filter.md to how it was after Ticket");
      await confirm.getByRole("button", { name: "Yes, go back" }).click();
      await expect.poll(() => fs.readFileSync(doc, "utf8")).toBe(written);
      await expect(drawer.getByRole("button", { name: /You went back to the version of/ })).toBeVisible();

      // Undo the go-back the same way: back to the answers entry.
      await drawer.getByRole("button", { name: /Your answers \(1\)/ }).click();
      await reader.getByRole("button", { name: "Go back to this version" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Yes, go back" }).click();
      await expect.poll(() => fs.readFileSync(doc, "utf8")).toContain("Filter by size and colour.");
      await reader.getByRole("button", { name: "Back to the document" }).click();
      await reader.getByRole("button", { name: "Close" }).click();

      // The History panel: the task's changed files are links; the .md opens in the reader with the drawer…
      await page.getByRole("button", { name: "History", exact: true }).click();
      const panel = page.getByRole("dialog", { name: "History" });
      await panel.getByRole("button", { name: "History of specs/filter.md" }).click();
      await expect(page.getByRole("complementary", { name: "Document" }).getByRole("region", { name: "File history" })).toBeVisible();
      await page.getByRole("complementary", { name: "Document" }).getByRole("button", { name: "Close" }).click();

      // …and the review record, not a document, in the timeline panel.
      await page.getByRole("button", { name: "History", exact: true }).click();
      await page.getByRole("dialog", { name: "History" }).getByRole("button", { name: "History of .harness/reviews/specs/filter.md.json" }).click();
      const files = page.getByRole("dialog", { name: "History of .harness/reviews/specs/filter.md.json" });
      await expect(files.getByRole("list", { name: "Versions and changes" })).toBeVisible();

      expect(csp).toEqual([]);
    } finally {
      if (app) await closeAndClean(app, s);
      else fs.rmSync(s.root, { recursive: true, force: true });
    }
  });
```

Notes for the implementer:
- The ticket's action label is "Ticket" (`harness.config.ts`), so the agent's entries read "Ticket".
- The History panel's newest row starts open; if the review record is not in the newest task's files (it is written by the agent's tool in the first turn, so it is), open the "Ticket" row first.
- The existing review test's "See what changed" step (after `appendFileSync`) now runs through `ApprovedDiff` → `FileDiff`; its assertion (`toContainText("One more line.")`) stays as it is.

- [ ] **Step 2: Run the end-to-end tests**

Run: `corepack pnpm app:build && corepack pnpm e2e`
Expected: PASS, including the existing `history.spec.ts` and `review.spec.ts` tests.

- [ ] **Step 3: Commit**

```bash
git -C <worktree> add packages/e2e/tests/review.spec.ts
git -C <worktree> commit -m "test(e2e): file timeline from the reader and the History panel, go back and undo"
```

---

### Task 17: Documentation

**Files:**
- Create: `docs/architecture/timeline.md`
- Modify: `docs/architecture/history.md`, `docs/architecture/documents.md`, `docs/architecture/reviews.md`, `docs/superpowers/specs/2026-10-27-file-timeline-design.md`

- [ ] **Step 1: Write `docs/architecture/timeline.md`**

Same shape as `docs/architecture/reviews.md` (short sections, plain English, file paths in "Where to look"). Sections and what each says:

- **What a timeline is.** Every file the history tracks; entries newest first; who made each; the reader's drawer, the History panel's links, the timeline panel; for every harness (Q1).
- **Entries.** The five kinds and how a commit is classified (subject first, then `Task:`), merging, `from`/`to`/`at`, approvals numbered, `unapproved`, `deleted`, `back` found by blob, `reason` from the review record, authors (a crash undo is the task's agent; `Before message` is outside), the 1,000-commit cap.
- **The index.** `<historyDir>/hh-file-index.json`, its shape, updated after each commit when its parent is the head, caught up on (up to 2,000 commits) or rebuilt on read, never a source of truth, moves and is set aside with the history; it never enters the folder or a commit.
- **The diff.** Computed in main (`file-diff.ts`): blocks, pairing, word parts, lines for code/Mermaid/front-matter, cells for rows, binary, the 200 KB cut, jsdiff's timeout and its fallback; the window draws whole blocks with `<Markdown>` and changed blocks as plain text with `ins`/`del` (no HTML, no CSP change); inline and side by side, the 900 px fallback, the Source toggle, the Mermaid before/after.
- **Going back one file.** `client.files.restore` → prompt → the core's `RestoreConfirm` → `History.restoreFile` (the restore's link checks, a commit staging only that path, `Go back: <path> to <target>`, untagged); refused while any turn runs; the same content makes no commit; a reviewed document goes stale, its record stays.
- **For harness views.** `client.files.*` with results as data, `files.onChange`, `<FileTimeline client path onPick />`, `<FileDiff client path from to />`.
- **"See what changed".** Now the diff from the last approval entry to the current file.
- **D0.** The list from this plan's D0 rule.
- **Known gaps.** No per-file wait or job/partial-commit authors (parallel tasks); no linked folders (hatches); renames start a new timeline; a crashed turn leaves no trace on a file; changed blocks drop inline formatting; no diff between two arbitrary entries in the UI yet (`client.files.diff` already takes any two commits).
- **Where to look.** The files of the File Structure table.

- [ ] **Step 2: Cross references**

- `history.md`: under "History", the index file in the history's data folder and `History.onCommit`; the `Go back: <path> to <target>` commit next to the other restores, and that it stages only that path; under "The History panel", changed files are links to their timelines, and the `fileBack` entry text; a pointer to `timeline.md`.
- `documents.md`: the reader's "File history" button and drawer in "The reader".
- `reviews.md`: "See what changed" now draws the timeline's diff from the last approval; answers and approvals appear on the document's timeline.
- The spec's status line: `Status: implemented (plan docs/superpowers/plans/2026-10-28-file-timeline.md)`, keeping the approval note.

- [ ] **Step 3: Check the docs against the code**

Run: `corepack pnpm typecheck && corepack pnpm test`. Read each changed doc once against the code it names.

- [ ] **Step 4: Commit**

```bash
git -C <worktree> add docs
git -C <worktree> commit -m "docs: file timeline, one-file go-back, See what changed"
```

---

## Self-review against the spec

| Spec | Where |
|---|---|
| §1 the gap: per-file history, who, one file back | Tasks 1–5, 12–14 |
| D1 one entry per task plus milestones, approvals numbered | Task 1 |
| D2 every tracked file; `.md` word diff, text line diff, binary entries only | Tasks 3, 6, 7, 11 |
| D3 one file back, its own commit, undoable | Tasks 5, 8, 12, 16 |
| D4 inline default, side-by-side toggle, two compare modes | Tasks 11, 12 |
| §3.1 kinds, authors, labels, subject before trailer, non-adjacent tasks, deleted file | Tasks 1, 4; partial commits/jobs: Conflicts 1 |
| §3.2 shape | Task 1 (differences: Conflicts 5) |
| §3.3 cache: incremental, rebuild when missing or foreign, not a source of truth | Tasks 2, 3 |
| §3.4 renames, linked folders, skipped files | Task 8 (`untracked`); renames: by design; linked folders: Conflicts 2 |
| §4.1 compare modes | Task 12 |
| §4.2 `.md` pipeline, Mermaid, Source, text with highlighting, binary, large files | Tasks 6, 7, 11 |
| §4.3 inline, side by side, 900 px fallback, "No changes" | Task 11 |
| §5 go back: one file, `Go back:` commit, asks first, refused during a turn, stale review, deleted file with folders | Tasks 5, 8, 9, 12 |
| §6.1 reader button, drawer, chips, turns, diff in the document column, focus mode | Tasks 10, 13 |
| §6.2 History panel links, timeline panel | Task 14 |
| §6.3 `client.files`, `<FileTimeline>`, `<FileDiff>` | Tasks 9, 10, 11 (shape: Conflicts 5, 6) |
| §7 edge cases: no commits yet, cache loading, set-aside history, crashed turn, outside path | Tasks 3, 4, 8, 10 (crash: Conflicts 4) |
| §8 unit and e2e tests | Every task; Task 16 |
| §9 "See what changed" switches to this diff | Task 15 |
| §10 slices 1–5 | Tasks 1–5 (1, 4), 6–7 & 11 (2), 13–14 (3), 9 & 12 (4), 9–11 & 15 (5) |
| §11 decided: no arbitrary pair in v1, no folder timeline, size later | Not built; `client.files.diff` takes any two commits |
| D0 | Tasks 3, 5, 14 (and every existing test left unchanged) |

## Open questions

Each has a proposed default; the plan is written with the default.

- **Q1. Which harnesses get the timeline?** Default: every harness, including those whose agent cannot edit the folder (the demo): it reads the history every harness has and adds nothing to the manifest, the agent or `AppState`. The alternative is to hide it for `permissions.edit: "none"`.
- **Q2. A `Before message` commit that changed the file.** Default: an `outside` entry ("Outside the app"), since it holds the person's own edits made between turns, not the agent's. The alternative is to count it in the task's entry, as its trailer says.
- **Q3. Who made a crash undo (`Undo: …`)?** Default: the task's agent (it carries the task's trailer and undoes that agent's turn). The spec's table says "You" for every go-back.
- **Q4. Where the confirmation lives.** Default: drawn in the window by the core's chat (`files.hostConfirm`), not a native dialog. Harness code runs in the same window and could reach the preload's API, as it already can with `client.restore`; a native dialog would make the confirmation unforgeable at the cost of the app's look and harder end-to-end tests.
- **Q5. Inline formatting inside a changed block.** Default: a changed block shows its plain text with word marks (bold, links and code spans are not drawn there); unchanged, added and removed blocks are drawn whole with the reader's renderer.
- **Q6. Where the index lives.** Default: inside the history's git data folder (`<historyDir>/hh-file-index.json`), so it moves, is set aside and is pruned with the history, rather than a sibling file the move would leave behind.
- **Q7. How much of a file's history a timeline reads.** Default: the newest 1,000 commits of the file.
- **Q8. The reader's button label.** Default: "File history", so the top bar's "History" stays the only button with that name.
- **Q9. Going back to the content the file already has.** Default: no commit, and the answer is "restored" (the drawer then shows "No changes" against the current version).
- **Q10. A deleted `.md` from the History panel.** Default: the timeline panel (the reader can't open a missing document); "Go back to this version" on the entry before "Deleted" brings it back.
- **Q11. Copy.** Default: the spec's Spanish mockup strings become English keys (`timeline.*`); translations come from the language-on-demand feature.
- **Q12. The side-by-side fallback.** Default: measured on the diff's own box with `ResizeObserver` (below 900 px it draws inline, the toggle keeps the choice for when it widens).
- **Q13. jsdiff's limits.** Default: a 2-second timeout per call; a piece that times out shows as all removed, then all added.
- **Q14. The spec file.** Default: Task 0 brings it from `origin/master` onto the branch so the plan and spec travel together.
