# Document Review and Focus Mode Implementation Plan (plan 15)

Plan 15 on the roadmap (plan 11 is the Sidekick). The Task 0 commit on `feat/doc-review` calls it "plan 11"; that commit stays as it is.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A document the agent writes can be reviewed in the reader. The agent asks about a passage with options that carry their own replacement text; the person answers (the passage swaps at once, no turn), comments on selected text, sends the comments as one review round, and approves the document. An approval belongs to a version: a later change makes it stale and shows what changed. A phase may advance when a matching document is approved. Focus mode shows one document in a single quiet column and holds the core's interruptions until the person leaves.

**Architecture:**
- **Pure review logic (`packages/harness-sdk/src/review.ts`, subpath `@humanharness/harness-sdk/review`, no Node imports, no zod).** Heading sections, anchors (find, re-find, create from a quote or from a rendered selection), the option swap with its guard, status and summary, the batch message, a line diff, the `approve` glob. The window, main, the runtime's helpers and the CLI all use it. Zod schemas for the record and the manifest live in `review-schema.ts` (main and the CLI only).
- **The record (`packages/workspace/src/reviews.ts`).** `.harness/reviews/<document path>.json`, written atomically, one writer at a time per document (`ReviewLocks`), tracked by the history (a new `appHistoryKeep` entry). Safe reads and writes of the person's own `.md` files (never a reference folder, never `.harness/`, never through a link). `blobId` is git's blob id (sha1 of `blob <size>\0<bytes>`).
- **The agent's tools.** `ask_in_document`, `reply_to_comment`, `read_review` on the existing `ui` MCP server. The `ui` bridge only says "ok", so these three go through a request/answer `Rpc` (the `data` server's channel type), handled by `runReviewRequest` (`packages/workspace/src/review-requests.ts`). The runtime opens that rpc only when it is given a `review` handler and the harness's agent may edit the folder (D0).
- **The person's side (`packages/shell/src/main/reviews.ts`, `ReviewService`).** Answer, comment drafts, reopen, send a batch, approve, the approved text. Every write waits until no turn runs, then commits (`Answer: …`, `Approved: …`) with the open task's trailer. Results are data over IPC.
- **Tasks (`task-manager.ts`).** A review round goes to the waiting task, or starts a core "Review <title>" task at the `standard` tier. An approval leaves a line for the document's task's next message and, when the current phase declares a matching `approve` glob, moves the task to its next phase.
- **Window (`packages/ui`).** Marks drawn with the CSS Custom Highlight API (no DOM rewrite, no CSP change), a "Comments" column, question cards, comment on a selection, the footer bar, "See what changed", status chips on the chat's cards, and focus mode with paused notices and a summary on leaving. `client.documents` and `client.focus` for harness views.
- **Terminal.** `humanharness run` gets the same tools and prints `Review: …` under a document's line.

**Tech Stack:** TypeScript, pnpm via corepack, Electron 44 + electron-vite 5, React 19, i18next, zod 4, isomorphic-git, `@modelcontextprotocol/sdk`, Vitest + happy-dom, Playwright with the fake agents in mock mode. No new dependency.

Spec: `docs/superpowers/specs/2026-10-27-document-review-and-focus-design.md` (on `origin/master`, not yet on `feat/document-reader`; Task 0 brings it over). "§" and "D" numbers below refer to it. It builds on the document reader (plan 10, `docs/superpowers/plans/2026-10-27-document-reader.md`, `docs/architecture/documents.md`) and adds the `approve` key to task phases (`docs/architecture/phases.md`).

---

## Conventions

**Code**
- Same as plans 1–10:
  - English everywhere (code, comments, docs, UI strings; the spec's Spanish strings are Marco's mockup copy and become English keys under `review.*` and `focus.*`);
  - packages export TS source;
  - extensionless imports;
  - tests in `packages/<name>/test/`;
  - one commit per task.
- React tests are `*.test.tsx` with `// @vitest-environment happy-dom` on the first line. Find elements by role and visible text. Use `renderIn("en", …)` from `packages/ui/test/render.tsx` when the component uses `useTranslation`.
- `@humanharness/ui` imports values from other workspace packages only through browser-safe subpaths (`@humanharness/harness-sdk/documents`, and the new `@humanharness/harness-sdk/review`). Everything else stays `import type`. `packages/ui/src/client.ts` imports nothing but types.
- Colours only through `--hh-*` tokens, in both the light block and the dark `@media` block of `packages/ui/src/styles.css`.
- **No regex that can backtrack on document text.** Every scan of a document, a quote, a selection or a path in this plan is a hand-written loop or `indexOf`. Regexes are allowed only on short ids (comment ids, blob ids) and single characters. Task 1 adds a timing test with about 50,000 spaces, like the reader's.
- **The CSP is not loosened.** `packages/shell/src/renderer/index.html` keeps `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`. Marks use `CSS.highlights` and `::highlight()` rules in `styles.css`; marker positions are set through React's `style` (CSSOM).
- **Errors over IPC travel as data**, never as thrown errors: every `hh:review*` handler answers `{ ok: false, reason }`. The agent's tools answer tool errors with the spec's messages.
- Document text, quotes, comment text and paths are untrusted: they never become HTML, and a path reaches the file system only after `refusedShape` and a real-path containment check in main.

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
  - Task 18 runs `corepack pnpm e2e`.

**Compliance**
- Never read `~/.claude`, `~/.codex`, `~/.gemini`, `~/.config/opencode`, `~/.local/share/opencode` or any credential file, in tests or product code. Tests use temp folders only.
- Main writes a document only inside the person's folder (never a reference folder, never `.harness/`), only `.md`, never through a symlink, never a hard-linked file, and only when the bytes on disk still equal what it read under the lock.

**D0 is a hard rule.** A harness whose agent cannot edit the folder (`permissions.edit: "none"`, e.g. the demo) keeps, byte for byte:
- its `ui` MCP server's tool list (no review tools; `packages/blocks/test/ui-server.test.ts` stays unchanged);
- its `AGENTS.md` (no review lines in "Writing for the reader");
- its `AppState` (no `review` field), its reader (no "Comments" column, no "Comment" button, no footer bar, no "Focus" button), its chat cards (no chip, no `hh:reviewSummaries` call);
- its history commits (no file under `.harness/reviews/` ever exists for it, so the new keep entry tracks nothing);
- its manifest validation (the `approve` and `reviewTier` keys are optional);
- the CLI output.

A harness that can edit the folder but never asks or comments sees only the new tools, the three guide lines, and the reader's Comment/Approve/Focus controls (see Open questions Q1). Tasks 5, 8, 9, 12, 13 and 17 hold the D0 regression tests.

## Decisions this plan takes where the spec leaves room

**Anchors (§3)**
- A *section* is the text from an id-bearing heading line (`#` to `####`, outside code fences, after the front-matter) to the next one. The text before the first heading is the section with `heading: null`. Heading slugs come from `createSlugger` over the heading's inline text with Markdown markers removed (`plainInline`), which matches the reader's ids for plain, bold, italic, code and link text.
- Matches are counted without overlap (`indexOf` from the end of the previous match), when an anchor is made and when it is found again.
- Finding an anchor again: the `occurrence`-th match in its section; fewer matches than that: the last one in the section (the nearest to the old place); none in the section: the first match anywhere; none at all: `lost`. A swap uses the *strict* form (only inside its section), so it never replaces the wrong passage.
- After every swap the comment's `anchor.quote` becomes the passage's new text, so the anchor always names what the document holds.
- `lost` is computed from the current text whenever the record is shown or used; main writes `state: "lost"` only together with another change to the record.
- A person's comment starts from a rendered selection. `anchorForSelection` projects the source to roughly what the reader shows (markup and block markers left out, every whitespace run one space), finds the selection there (preferring the section of the heading above the selection), and maps it back to an exact source substring.
- Marks: the window projects the quote the same way and finds its n-th occurrence in the rendered text of the Markdown body only (`markOccurrence`). A quote it can't find in the rendered text gets no mark; its card still shows. A quote inside a ```` ```mermaid ```` fence never gets a mark; its card says "In the diagram of § <heading>" (§11.1).

**The record**
- `Review` gets two fields the spec does not list: `scope` (the scope of the task that made the record, for a new review task) and, on a comment, `unapplied: true` (an answer the app could not swap in because the passage changed; it travels in the next batch, §5.1 swap guard).
- `task` is the open task when the record is first created (by the agent's first question or the person's first comment), else `null`.
- Comment ids are `c1`, `c2`, … (one more than the highest in the record).
- A record that fails the schema (a hand edit) is "broken": the tools refuse with "the review of spec.md can't be read", the reader shows the document without review controls and a note.

**Writes and commits (§5.1, §5.4)**
- Every write by the person (an answer, an approval) waits until no turn runs (`TaskManager.whenSettled`) and then commits on its own. While it waits the card says "Waiting for the turn to end". This replaces the spec's per-file rule, which needs the parallel-tasks history queue (see Conflicts).
- Commits carry the open task's trailer (none without an open task). Drafts, reopen and the batch's state changes are written to the record and committed with the next commit (the next turn's "Before message"), since they change no document.
- The approval's commit (`Approved: <path>`) includes the document, so the approved blob is always in the history's object store; "See what changed" reads it with `History.readBlob`.

**Rounds and approval (§5.3, §5.4)**
- "Send comments (N)" counts drafts, "Other" answers and unapplied answers. The round goes to the task that waits now (whichever it is), else to a new core task "Review <title>" in the record's scope (the open scope when it has none) at the kind's `reviewTier`, else `standard`. See Q3.
- The batch's item states become `sent` before the turn starts; if the round can't start, they go back.
- "The document's task is told" (§5.4) is a line kept on the task (`CurrentTask.notices`) and put before the task's next message, its next phase-change message, or the next review round, so it costs no extra turn. See Q4.
- The phase advances when the *open* task's current phase has an `approve` glob that matches the path, whatever task created the record. The move is the person's (`by: "person"`), through `TaskManager.setPhase`.
- "Approve anyway, with a reason": the reason is required (1–500 characters, one line) and stored on the approval.

**UI**
- The column is a `<section aria-label="Comments">` right of the document; under 900 px (`@container` on the reader's columns) it moves under the document.
- The footer bar is sticky at the bottom of the reader; in focus mode it is the last thing in the document column.
- Focus mode is a third reader state next to "side" and "full screen": `ReaderTarget` gets nothing new; `ChatView` keeps `focus: boolean`.
- Paused in focus mode, of what exists today: the composer taking focus and the live region reading the answer when a turn ends, and three notices counted for the summary: a turn ended and the task waits ("the task is waiting for you"), the plan limit ran out (`out-of-quota`), and the agent proposed to move to another part. Leaving shows one line ("While you were reading: …") in the chat's notice row.
- `client.documents.review(path)` returns `Promise<ReviewSummary | null>` and `approve` returns a result (IPC is asynchronous; errors are data). See Conflicts.

**Phases (§5.5)**
- `approve` is a glob relative to the folder: `*` within one path part, `**` for any number of parts, `?` one character; no `[`, `]`, `{`, `}`, no backslash, not absolute, no `..`, not under `.harness/`, ending in `.md`, at most 200 characters. Matched by a hand-written matcher.

## Conflicts with the spec

1. **Parallel tasks, jobs and the history queue do not exist yet** (`2026-10-27-parallel-tasks-and-jobs-design.md` has no plan). So: there is no `Who: person` trailer; an answer or approval waits for *any* running turn, not only one whose edits named the file (§5.1); "jobs cannot use them" (§4) has nothing to refuse; "with parallel tasks, the batch obeys the cap" (§5.3) does not apply. The plan keeps the code shaped so a later plan can narrow the wait to the file.
2. **"To the review's task when it is open; otherwise a new task"** (§5.3). With one task at a time, starting a new task closes the open one (its closing turn and note). The plan sends the round to whichever task waits now; only with no task does it start "Review <title>". See Q3.
3. **The Sidekick `before-approve` moment** (§5.4) is not built: the Sidekick (`2026-10-25-sidekick-design.md`) has no plan yet. Approval goes through at once. The approve path has one function (`approveNow` in `ReviewBar`) where the hold can be added.
4. **Notices that do not exist yet** (§6.2): job results and Sidekick heads-ups; "the Dock badge keeps counting" (there is no Dock badge). Focus mode counts the three that exist (see Decisions).
5. **`client.documents.review(path): ReviewSummary`** and **`approve(path, reason?): Promise<void>`** (§5.6): over IPC both are asynchronous and errors are data, so `review` returns `Promise<ReviewSummary | null>` and `approve` returns `Promise<ReviewResult>`.
6. **The record's shape** (§3) gains `scope` and a comment's `unapplied` (see Decisions). Both are optional; a record without them is valid.
7. **"A quiet message"** (§5.4) is not a turn: the line waits for the task's next message (see Q4).

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/harness-sdk/src/review.ts` | create | Pure: types, sections, anchors, projection, swap, status, summary, batch, diff, glob |
| `packages/harness-sdk/src/review-schema.ts` | create | zod: the record, and the tool inputs' shapes |
| `packages/harness-sdk/src/index.ts` | modify | Re-exports; `approve` on a phase; `reviewTier` on a kind; reserved tool names |
| `packages/harness-sdk/src/core-blocks.ts` | modify | `REVIEW_TOOLS` in `RESERVED_BLOCK_NAMES` |
| `packages/harness-sdk/package.json` | modify | `./review` subpath |
| `packages/harness-sdk/test/review-anchors.test.ts`, `review-answers.test.ts`, `review-diff.test.ts`, `review-manifest.test.ts` | create | Pure logic and manifest |
| `packages/workspace/src/reviews.ts` | create | Record files, locks, own-document read/write, `blobId`, sync summary for the CLI |
| `packages/workspace/src/review-requests.ts` | create | The agent's three requests |
| `packages/workspace/src/history.ts` | modify | Keep `.harness/reviews/`; its temp files; `readBlob` |
| `packages/workspace/src/layout.ts` | modify | `REVIEWS_PREFIX` |
| `packages/workspace/src/instructions.ts` | modify | `WritingGuide.review`: three guide lines |
| `packages/workspace/src/index.ts` | modify | Exports |
| `packages/workspace/test/reviews.test.ts`, `review-requests.test.ts`, `history.test.ts`, `instructions.test.ts` | create / modify | Store, requests, history, guide |
| `packages/blocks/src/ui-server.ts`, `ui-server-bin.ts`, `launch.ts` | modify | The three tools over an rpc |
| `packages/blocks/test/review-tools.test.ts` | create | Tools listed, forwarded, errors |
| `packages/runtime/src/runtime.ts` | modify | `review` option, the rpc, `writing.review` |
| `packages/runtime/test/runtime.test.ts` | modify | D0 and the review server |
| `packages/shell/src/main/reviews.ts` | create | `ReviewService`: the person's side |
| `packages/shell/src/main/task-store.ts`, `task-manager.ts`, `task-prompts.ts` | modify | `review`, `notices`, `reviewRound`, `documentApproved`, tier |
| `packages/shell/src/main/index.ts`, `preload/index.ts` | modify | Wiring, IPC, `AppState.review` |
| `packages/shell/test/reviews.test.ts`, `task-manager-review.test.ts`, `task-store.test.ts` | create / modify | Main-side tests |
| `packages/ui/src/client.ts` | modify | Types; `documents`, `focus` |
| `packages/ui/src/review-marks.ts` | create | Text runs, finding a mark, painting highlights |
| `packages/ui/src/ReviewColumn.tsx` | create | The comment column and its cards |
| `packages/ui/src/ReviewBar.tsx` | create | Send, approve, reason, unsent prompt, approved/stale line |
| `packages/ui/src/ApprovedDiff.tsx` | create | "See what changed" |
| `packages/ui/src/FocusMarkers.tsx` | create | Margin markers in focus mode |
| `packages/ui/src/focus-notices.ts` | create | Counting paused notices; the summary line |
| `packages/ui/src/DocumentReader.tsx`, `DocumentCards.tsx`, `Message.tsx`, `ChatView.tsx`, `styles.css`, `index.ts` | modify | Wiring the review and focus |
| `packages/ui/test/*.test.tsx`, `fake-client.ts` | create / modify | UI tests |
| `packages/i18n/src/locales/en.json` | modify | `review.*`, `focus.*` |
| `packages/cli/src/run.ts`, `terminal.ts` | modify | Tools in `run`, the `Review:` line |
| `packages/fake-agent/fixtures/review-harness/**` | create | Fixture harness with a recording |
| `packages/e2e/tests/helpers.ts`, `review.spec.ts` | modify / create | End to end in mock mode |
| `docs/architecture/reviews.md` | create | Architecture doc |
| `docs/architecture/documents.md`, `phases.md`, `manifest.md`, `history.md`, `mock-mode.md` | modify | Cross references |
| `docs/superpowers/specs/2026-10-27-document-review-and-focus-design.md` | add (Task 0), modify (Task 19) | Spec on the branch; status |
| `docs/superpowers/plans/2026-10-28-document-review-and-focus.md` | add (Task 0) | This plan |

---

### Task 0: Branch, spec and this plan

**Files:**
- Add: `docs/superpowers/specs/2026-10-27-document-review-and-focus-design.md` (from `origin/master`)
- Add: `docs/superpowers/plans/2026-10-28-document-review-and-focus.md` (this file)

- [ ] **Step 1: Create the branch**

Run: `git -C <worktree> switch -c feat/doc-review feat/document-reader`
Expected: `Switched to a new branch 'feat/doc-review'`.

- [ ] **Step 2: Bring the spec over**

Run: `git -C <worktree> fetch origin`
Run: `git -C <worktree> checkout origin/master -- docs/superpowers/specs/2026-10-27-document-review-and-focus-design.md`
Expected: the file exists.

- [ ] **Step 3: Put this plan in place**

Copy this file to `<worktree>/docs/superpowers/plans/2026-10-28-document-review-and-focus.md`.

- [ ] **Step 4: Commit**

```bash
git -C <worktree> add docs/superpowers/specs/2026-10-27-document-review-and-focus-design.md docs/superpowers/plans/2026-10-28-document-review-and-focus.md
git -C <worktree> commit -m "docs(plan): document review and focus mode (plan 15)"
```

---

### Task 1: Sections and anchors

**Files:**
- Create: `packages/harness-sdk/src/review.ts`
- Modify: `packages/harness-sdk/package.json`, `packages/harness-sdk/src/index.ts`
- Test: `packages/harness-sdk/test/review-anchors.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/harness-sdk/test/review-anchors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { anchorAt, anchorOf, locate, plainInline, sections } from "../src/review";

const DOC = [
  "---",
  "title: Filter",
  "---",
  "Intro keeps it short.",
  "",
  "## Scope",
  "",
  "The size filter keeps the size. The size filter keeps it.",
  "",
  "```",
  "## not a heading",
  "```",
  "",
  "## The **Risks**",
  "",
  "The size filter keeps nothing.",
  "",
].join("\n");

describe("sections", () => {
  it("splits at #–#### headings outside code, after the front-matter, with the reader's slugs", () => {
    const s = sections(DOC);
    expect(s.map((x) => x.slug)).toEqual([null, "scope", "the-risks"]);
    expect(s.map((x) => x.title)).toEqual(["", "Scope", "The Risks"]);
    expect(s[1].level).toBe(2);
    expect(DOC.slice(s[1].start, s[1].start + 8)).toBe("## Scope");
    expect(s[0].end).toBe(s[1].start);
    expect(s[2].end).toBe(DOC.length);
  });

  it("ignores ##### and deeper, and a # without a space", () => {
    expect(sections("##### deep\n#tag\n# Top\n").map((x) => x.slug)).toEqual([null, "top"]);
  });

  it("deduplicates slugs like the reader", () => {
    expect(sections("## A\n## A\n").map((x) => x.slug)).toEqual([null, "a", "a-1"]);
  });
});

describe("plainInline", () => {
  it("drops emphasis, code and link syntax, keeps snake_case", () => {
    expect(plainInline("The **size** `filter` [docs](a.md) snake_case \\*x")).toBe("The size filter docs snake_case *x");
  });
});

describe("anchorAt and anchorOf", () => {
  it("takes the first match, counted under its heading", () => {
    const r = anchorAt(DOC, "The size filter keeps");
    expect(r).toMatchObject({ ok: true, anchor: { quote: "The size filter keeps", heading: "scope", occurrence: 0 } });
  });

  it("takes the first match under the heading given", () => {
    const r = anchorAt(DOC, "The size filter keeps", "the-risks");
    expect(r).toMatchObject({ ok: true, anchor: { heading: "the-risks", occurrence: 0 } });
  });

  it("refuses a quote that isn't there, or isn't under the heading, or an unknown heading", () => {
    expect(anchorAt(DOC, "no such text")).toEqual({ ok: false, reason: "not-found" });
    expect(anchorAt(DOC, "Intro keeps", "scope")).toEqual({ ok: false, reason: "not-found" });
    expect(anchorAt(DOC, "Intro keeps", "nope")).toEqual({ ok: false, reason: "no-heading" });
    expect(anchorAt(DOC, "")).toEqual({ ok: false, reason: "not-found" });
  });

  it("counts the second match under the same heading", () => {
    const second = DOC.indexOf("The size filter keeps it.");
    expect(anchorOf(DOC, second, "The size filter keeps")).toEqual({ quote: "The size filter keeps", heading: "scope", occurrence: 1 });
  });
});

describe("locate", () => {
  it("finds the n-th match in its section", () => {
    const at = locate(DOC, { quote: "The size filter keeps", heading: "scope", occurrence: 1 });
    expect(at?.start).toBe(DOC.indexOf("The size filter keeps it."));
  });

  it("falls back to the last match in the section, then anywhere, then null", () => {
    expect(locate(DOC, { quote: "The size filter keeps", heading: "scope", occurrence: 7 })?.start).toBe(DOC.indexOf("The size filter keeps it."));
    expect(locate(DOC, { quote: "Intro keeps", heading: "scope", occurrence: 0 })?.start).toBe(DOC.indexOf("Intro keeps"));
    expect(locate(DOC, { quote: "gone", heading: "scope", occurrence: 0 })).toBeNull();
  });

  it("strict: only inside its section", () => {
    expect(locate(DOC, { quote: "Intro keeps", heading: "scope", occurrence: 0 }, { strict: true })).toBeNull();
  });

  it("an unknown heading searches the whole text", () => {
    expect(locate(DOC, { quote: "Intro keeps", heading: "renamed", occurrence: 0 })?.start).toBe(DOC.indexOf("Intro keeps"));
  });
});

describe("no backtracking on document text", () => {
  it("scans 50,000 spaces fast", () => {
    const text = `## A${" ".repeat(50_000)}\n#${" ".repeat(50_000)}x\n${"`".repeat(3)}${" ".repeat(50_000)}`;
    const t0 = performance.now();
    sections(text);
    anchorAt(text, " ".repeat(40) + "y");
    locate(text, { quote: " ".repeat(30) + "z", heading: "a", occurrence: 3 });
    plainInline(`${"*_`[".repeat(10_000)}](${" ".repeat(50_000)}`);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/harness-sdk/test/review-anchors.test.ts`
Expected: FAIL, `Cannot find module '../src/review'`.

- [ ] **Step 3: Write the code**

Create `packages/harness-sdk/src/review.ts`:

```ts
// No Node imports and no zod here: the screens import this file (`@humanharness/harness-sdk/review`).
// No regex runs on document text: every scan is a loop or indexOf (a timing test holds this).
import { createSlugger, splitFrontMatter } from "./documents";

/** The agent's review tools (spec §4): reserved names, like the core blocks. */
export const REVIEW_TOOLS = ["ask_in_document", "reply_to_comment", "read_review"] as const;

export type ReviewAuthor = "agent" | "person";
export type CommentState = "draft" | "open" | "answered" | "sent" | "resolved" | "lost";

/** Where a comment sits (§3): the passage's exact text, the slug of the heading above it, which match under it. */
export interface ReviewAnchor {
  quote: string;
  heading: string | null;
  occurrence: number;
}
export interface ReviewOption {
  label: string;
  /** The text that replaces the passage when this option is picked (D1). */
  text: string;
}
export interface ReviewReply {
  author: ReviewAuthor;
  text: string;
  at: string;
}
export type ReviewAnswer = { option: number } | { other: string };
export interface ReviewComment {
  id: string;
  author: ReviewAuthor;
  kind: "question" | "comment";
  anchor: ReviewAnchor;
  text: string;
  options?: ReviewOption[];
  blocking?: boolean;
  answer?: ReviewAnswer;
  /** The passage before the first answer, so "no answer" can put it back. */
  original?: string;
  /** The answer could not be swapped in (the passage changed): it travels in the next batch (plan addition). */
  unapplied?: true;
  state: CommentState;
  replies: ReviewReply[];
  at: string;
}
export interface ReviewApproval {
  /** git's blob id of the approved text. */
  blob: string;
  at: string;
  reason?: string;
}
export interface Review {
  path: string;
  /** The task open when the record was made; null when none was. */
  task: string | null;
  /** That task's scope (plan addition): where a new review task runs. */
  scope?: string;
  comments: ReviewComment[];
  approvals: ReviewApproval[];
}

/** A part of a document under one id-bearing heading (`heading: null` before the first one). */
export interface Section {
  slug: string | null;
  title: string;
  /** 1–4; 0 for the part before the first heading. */
  level: number;
  start: number;
  end: number;
}

const isWordChar = (c: string | undefined): boolean => c !== undefined && /^[\p{L}\p{N}]$/u.test(c);

/** A heading's or a passage's inline text as the reader shows it: emphasis, code and link syntax left out. */
export function plainInline(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      out += s[++i];
      continue;
    }
    if (c === "*" || c === "`" || c === "~" || c === "[") continue;
    if (c === "_" && !(isWordChar(s[i - 1]) && isWordChar(s[i + 1]))) continue;
    if (c === "]") {
      if (s[i + 1] === "(") {
        const close = s.indexOf(")", i + 2);
        if (close >= 0) i = close;
      }
      continue;
    }
    out += c;
  }
  return out;
}

/** A fence line (```` ``` ```` or `~~~`, up to three spaces in): its character, length and info string. */
function fenceOf(line: string): { char: string; length: number; info: string } | null {
  let i = 0;
  while (i < 3 && line[i] === " ") i++;
  const char = line[i];
  if (char !== "`" && char !== "~") return null;
  let n = 0;
  while (line[i + n] === char) n++;
  if (n < 3) return null;
  return { char, length: n, info: line.slice(i + n).trim() };
}

/** An id-bearing heading line (`#`–`####`, up to three spaces in): its level and raw text; null otherwise. */
function atxHeading(line: string): { level: number; text: string } | null {
  let i = 0;
  while (i < 3 && line[i] === " ") i++;
  let level = 0;
  while (line[i + level] === "#") level++;
  if (level < 1 || level > 4) return null;
  const after = line[i + level];
  if (after !== undefined && after !== " " && after !== "\t") return null;
  let text = line.slice(i + level).trim();
  let j = text.length;
  while (j > 0 && text[j - 1] === "#") j--;
  if (j < text.length && (j === 0 || text[j - 1] === " " || text[j - 1] === "\t")) text = text.slice(0, j).trimEnd();
  return { level, text };
}

/** Each line of `text` from `from`: its start, its end (before `\r\n` or `\n`) and the next line's start. */
function* lines(text: string, from: number): Generator<{ start: number; end: number; next: number }> {
  let at = from;
  while (at <= text.length) {
    const nl = text.indexOf("\n", at);
    const stop = nl < 0 ? text.length : nl;
    const end = stop > at && text[stop - 1] === "\r" ? stop - 1 : stop;
    yield { start: at, end, next: stop + 1 };
    if (nl < 0) return;
    at = nl + 1;
  }
}

/** Where the body starts (after the front-matter block). */
export const bodyStart = (text: string): number => text.length - splitFrontMatter(text).body.length;

/** The document's sections, in order. The first is the part before any heading (maybe empty). */
export function sections(text: string): Section[] {
  const slugger = createSlugger();
  const out: Section[] = [{ slug: null, title: "", level: 0, start: 0, end: text.length }];
  let fence: { char: string; length: number } | null = null;
  for (const l of lines(text, bodyStart(text))) {
    const line = text.slice(l.start, l.end);
    if (fence) {
      const f = fenceOf(line);
      if (f && f.char === fence.char && f.length >= fence.length && f.info === "") fence = null;
      continue;
    }
    const f = fenceOf(line);
    if (f) {
      fence = f;
      continue;
    }
    const h = atxHeading(line);
    if (!h) continue;
    out[out.length - 1].end = l.start;
    const title = plainInline(h.text).trim();
    out.push({ slug: slugger(title), title, level: h.level, start: l.start, end: text.length });
  }
  return out;
}

/** The section that holds offset `at`. */
export function sectionAt(secs: Section[], at: number): Section {
  for (let i = secs.length - 1; i >= 0; i--) if (secs[i].start <= at) return secs[i];
  return secs[0];
}

/** Starts of `quote` in `text[from, to)`, without overlap, stopping after `max`. */
function matches(text: string, quote: string, from: number, to: number, max = Infinity): number[] {
  const out: number[] = [];
  if (!quote) return out;
  for (let at = text.indexOf(quote, from); at >= 0 && at + quote.length <= to && out.length < max; at = text.indexOf(quote, at + quote.length)) out.push(at);
  return out;
}

/** The anchor of the passage `quote` starting at `start`: its section's slug and its rank among the matches there. */
export function anchorOf(text: string, start: number, quote: string, secs: Section[] = sections(text)): ReviewAnchor {
  const sec = sectionAt(secs, start);
  const before = matches(text, quote, sec.start, start + quote.length).filter((m) => m < start).length;
  return { quote, heading: sec.slug, occurrence: before };
}

/**
 * Where an anchor is now (§7): the `occurrence`-th match in its section, else the last match there, else (not strict)
 * the first match anywhere. Null: lost.
 */
export function locate(
  text: string,
  anchor: ReviewAnchor,
  opts: { strict?: boolean; secs?: Section[] } = {},
): { start: number; end: number } | null {
  const { quote } = anchor;
  if (!quote) return null;
  const secs = opts.secs ?? sections(text);
  const region = anchor.heading === null ? secs[0] : secs.find((s) => s.slug === anchor.heading);
  if (region) {
    const found = matches(text, quote, region.start, region.end, anchor.occurrence + 1);
    const at = found[anchor.occurrence] ?? found.at(-1);
    if (at !== undefined) return { start: at, end: at + quote.length };
    if (opts.strict) return null;
  } else if (opts.strict) return null;
  const anywhere = text.indexOf(quote);
  return anywhere >= 0 ? { start: anywhere, end: anywhere + quote.length } : null;
}

export type AnchorAt = { ok: true; anchor: ReviewAnchor; start: number } | { ok: false; reason: "not-found" | "no-heading" };

/** A new anchor for `ask_in_document` (§4): the first match, or the first under `heading` when given. */
export function anchorAt(text: string, quote: string, heading?: string): AnchorAt {
  const secs = sections(text);
  let from = 0;
  let to = text.length;
  if (heading !== undefined) {
    const s = secs.find((x) => x.slug === heading);
    if (!s) return { ok: false, reason: "no-heading" };
    from = s.start;
    to = s.end;
  }
  const [at] = matches(text, quote, from, to, 1);
  if (at === undefined) return { ok: false, reason: "not-found" };
  return { ok: true, anchor: anchorOf(text, at, quote, secs), start: at };
}
```

Add to `packages/harness-sdk/package.json` exports: `"./review": "./src/review.ts"` (after `"./documents"`).

Add to `packages/harness-sdk/src/index.ts`, next to `export * from "./documents";`:

```ts
export * from "./review";
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/harness-sdk/test/review-anchors.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`. Expected: green.

```bash
git -C <worktree> add packages/harness-sdk/src/review.ts packages/harness-sdk/src/index.ts packages/harness-sdk/package.json packages/harness-sdk/test/review-anchors.test.ts
git -C <worktree> commit -m "feat(sdk): sections and anchors for document reviews"
```

---

### Task 2: From the rendered text to the source, and back

**Files:**
- Modify: `packages/harness-sdk/src/review.ts`
- Test: `packages/harness-sdk/test/review-anchors.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `packages/harness-sdk/test/review-anchors.test.ts`:

```ts
import { anchorForSelection, diagramOf, markOccurrence, project } from "../src/review";

describe("project", () => {
  it("leaves out markup and block markers, one space per whitespace run, and maps back", () => {
    const src = "---\ntitle: T\n---\n## The **size**\n\n- [ ] keep `it`\n> quoted [link](x.md)\n| a | b |\n";
    const p = project(src);
    expect(p.plain).toBe("The size keep it quoted link a b");
    expect(src[p.map[p.plain.indexOf("size")]]).toBe("s");
  });

  it("keeps code fences' content literally and drops the fence lines", () => {
    expect(project("```ts\nconst *a* = 1;\n```\n").plain).toBe("const *a* = 1;");
  });

  it("projects a fragment without looking for front-matter", () => {
    expect(project("---\nx\n---", { frontMatter: false }).plain).toBe("--- x ---");
  });
});

describe("anchorForSelection", () => {
  const src = "## Scope\n\nThe **size** filter keeps.\n\n## Risks\n\nThe size filter keeps.\n";
  it("maps a rendered selection to an exact source passage, preferring the heading's section", () => {
    const a = anchorForSelection(src, " The size  filter\n", "risks");
    expect(a).toEqual({ quote: "The size filter", heading: "risks", occurrence: 0 });
    const b = anchorForSelection(src, "The size filter", "scope");
    expect(b).toEqual({ quote: "The **size** filter", heading: "scope", occurrence: 0 });
  });

  it("takes the first match anywhere when the heading's section has none, and null when nothing matches", () => {
    expect(anchorForSelection(src, "The size filter", null)?.heading).toBe("scope");
    expect(anchorForSelection(src, "absent", null)).toBeNull();
    expect(anchorForSelection(src, "   ", null)).toBeNull();
  });
});

describe("markOccurrence", () => {
  it("says which rendered match a passage is", () => {
    const src = "## A\n\nword word\n\n## B\n\nword\n";
    expect(markOccurrence(src, { quote: "word", heading: "b", occurrence: 0 })).toEqual({ want: "word", nth: 2 });
    expect(markOccurrence(src, { quote: "gone", heading: "b", occurrence: 0 })).toBeNull();
  });
});

describe("diagramOf", () => {
  it("names the section of a quote inside a mermaid fence", () => {
    const src = "## Flow\n\n```mermaid\nflowchart LR\n  A --> B\n```\n";
    expect(diagramOf(src, src.indexOf("A --> B"))).toBe("Flow");
    expect(diagramOf(src, src.indexOf("## Flow"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/harness-sdk/test/review-anchors.test.ts`
Expected: FAIL, `project is not a function` (and the others).

- [ ] **Step 3: Write the code**

Append to `packages/harness-sdk/src/review.ts`:

```ts
/** `text` roughly as the reader shows it, and where each of its characters came from. */
export interface Projection {
  plain: string;
  /** `map[i]`: the offset in the source of plain character `i`. */
  map: number[];
}

const isBlank = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "|";

/** The offset after a line's block markers: `#`s, `>`, list bullets and numbers, a task box. One pass, no regex. */
function afterMarkers(text: string, i: number, end: number): number {
  for (;;) {
    while (i < end && (text[i] === " " || text[i] === "\t")) i++;
    const c = text[i];
    if (c === ">") {
      i++;
      continue;
    }
    if ((c === "-" || c === "*" || c === "+") && (text[i + 1] === " " || text[i + 1] === "\t")) {
      i += 2;
      if (text[i] === "[" && (text[i + 1] === " " || text[i + 1] === "x" || text[i + 1] === "X") && text[i + 2] === "]") i += 3;
      continue;
    }
    if (c === "#") {
      let j = i;
      while (j < end && text[j] === "#" && j - i < 6) j++;
      if (j === end || text[j] === " " || text[j] === "\t") {
        i = j;
        continue;
      }
      return i;
    }
    if (c !== undefined && c >= "0" && c <= "9") {
      let j = i;
      while (j < end && j - i < 9 && text[j] >= "0" && text[j] <= "9") j++;
      if ((text[j] === "." || text[j] === ")") && (text[j + 1] === " " || text[j + 1] === "\t")) {
        i = j + 2;
        continue;
      }
    }
    return i;
  }
}

/**
 * The text as the reader shows it, roughly (Decisions "Anchors"): front-matter, fence lines, block markers and inline
 * markup left out; code inside fences kept as written; every run of whitespace (and table pipes) one space.
 */
export function project(text: string, opts: { frontMatter?: boolean } = {}): Projection {
  const plain: string[] = [];
  const map: number[] = [];
  let pendingSpace = -1;
  const emit = (c: string, at: number) => {
    if (pendingSpace >= 0 && plain.length > 0) {
      plain.push(" ");
      map.push(pendingSpace);
    }
    pendingSpace = -1;
    plain.push(c);
    map.push(at);
  };
  const space = (at: number) => {
    if (pendingSpace < 0) pendingSpace = at;
  };
  let fence: { char: string; length: number } | null = null;
  for (const l of lines(text, opts.frontMatter === false ? 0 : bodyStart(text))) {
    const line = text.slice(l.start, l.end);
    const f = fenceOf(line);
    if (fence) {
      if (f && f.char === fence.char && f.length >= fence.length && f.info === "") fence = null;
      else for (let i = l.start; i < l.end; i++) (isBlank(text[i]) && text[i] !== "|" ? space(i) : emit(text[i], i));
      space(l.end);
      continue;
    }
    if (f) {
      fence = f;
      space(l.end);
      continue;
    }
    for (let i = afterMarkers(text, l.start, l.end); i < l.end; i++) {
      const c = text[i];
      if (isBlank(c)) {
        space(i);
        continue;
      }
      if (c === "\\" && i + 1 < l.end) {
        emit(text[i + 1], i + 1);
        i++;
        continue;
      }
      if (c === "*" || c === "`" || c === "~" || c === "[") continue;
      if (c === "_" && !(isWordChar(text[i - 1]) && isWordChar(text[i + 1]))) continue;
      if (c === "]") {
        if (text[i + 1] === "(") {
          const close = text.indexOf(")", i + 2);
          if (close >= 0 && close < l.end) i = close;
        }
        continue;
      }
      emit(c, i);
    }
    space(l.end);
  }
  return { plain: plain.join(""), map };
}

/** Whitespace runs as one space, trimmed (a DOM selection's text). */
function collapse(s: string): string {
  let out = "";
  let gap = false;
  for (const c of s) {
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === " ") gap = out.length > 0;
    else {
      if (gap) out += " ";
      gap = false;
      out += c;
    }
  }
  return out;
}

/** The first index `i` with `map[i] >= at` (map is increasing). */
function plainIndexAt(map: number[], at: number): number {
  let lo = 0;
  let hi = map.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (map[mid] < at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The anchor of a passage the person selected in the reader (§5.2): the selection is found in the projected text,
 * preferring the section of `heading` (the heading above the selection), and mapped back to an exact source passage.
 */
export function anchorForSelection(source: string, selected: string, heading: string | null): ReviewAnchor | null {
  const want = collapse(selected);
  if (!want) return null;
  const p = project(source);
  const secs = sections(source);
  const region = heading === null ? null : (secs.find((s) => s.slug === heading) ?? null);
  let first = -1;
  let inside = -1;
  for (let at = p.plain.indexOf(want); at >= 0; at = p.plain.indexOf(want, at + 1)) {
    if (first < 0) first = at;
    const start = p.map[at];
    if (!region || (start >= region.start && start < region.end)) {
      inside = at;
      break;
    }
  }
  const at = inside >= 0 ? inside : first;
  if (at < 0) return null;
  const start = p.map[at];
  const end = p.map[at + want.length - 1] + 1;
  return anchorOf(source, start, source.slice(start, end), secs);
}

/** Which rendered match of the passage's projected text the anchored passage is (the window's mark, §6.1). */
export function markOccurrence(source: string, anchor: ReviewAnchor): { want: string; nth: number } | null {
  const where = locate(source, anchor);
  if (!where) return null;
  const want = project(anchor.quote, { frontMatter: false }).plain;
  if (!want) return null;
  const p = project(source);
  const k = plainIndexAt(p.map, where.start);
  let nth = 0;
  for (let at = p.plain.indexOf(want); at >= 0 && at < k; at = p.plain.indexOf(want, at + want.length)) nth++;
  return { want, nth };
}

/** The heading title of the diagram that holds offset `at` (§11.1), or null when `at` is not inside a mermaid fence. */
export function diagramOf(text: string, at: number): string | null {
  let fence: { char: string; length: number; mermaid: boolean; start: number } | null = null;
  for (const l of lines(text, bodyStart(text))) {
    if (l.start > at && !fence) return null;
    const f = fenceOf(text.slice(l.start, l.end));
    if (fence) {
      if (f && f.char === fence.char && f.length >= fence.length && f.info === "") {
        if (fence.mermaid && at > fence.start && at < l.start) return sectionAt(sections(text), fence.start).title;
        fence = null;
      }
      continue;
    }
    if (f) fence = { char: f.char, length: f.length, mermaid: f.info.split(" ")[0].toLowerCase() === "mermaid", start: l.next - 1 };
  }
  return null;
}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/harness-sdk/test/review-anchors.test.ts`
Expected: PASS. Extend the timing test of Task 1 with `project(text)` and `anchorForSelection(text, "y", "a")` and run it again: still under 500 ms.

- [ ] **Step 5: Typecheck, test, commit**

```bash
git -C <worktree> add packages/harness-sdk/src/review.ts packages/harness-sdk/test/review-anchors.test.ts
git -C <worktree> commit -m "feat(sdk): map review anchors between the source and the rendered text"
```

---

### Task 3: Answers, status, summary and the batch

**Files:**
- Modify: `packages/harness-sdk/src/review.ts`
- Test: `packages/harness-sdk/test/review-answers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/harness-sdk/test/review-answers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type Review, type ReviewComment, answerQuestion, batchMessage, isUnsent, markSent, nextCommentId, reviewStatus, summarizeReview } from "../src/review";

const TEXT = "## Scope\n\nFilter by size.\n";
const question = (over: Partial<ReviewComment> = {}): ReviewComment => ({
  id: "c1",
  author: "agent",
  kind: "question",
  anchor: { quote: "Filter by size.", heading: "scope", occurrence: 0 },
  text: "Which filter?",
  options: [
    { label: "Size", text: "Filter by size." },
    { label: "Size and colour", text: "Filter by size and colour." },
  ],
  blocking: true,
  state: "open",
  replies: [],
  at: "2026-10-28T10:00:00.000Z",
  ...over,
});

describe("answerQuestion", () => {
  it("swaps the passage, keeps the original, and follows the new text", () => {
    const r = answerQuestion(TEXT, question(), 1);
    expect(r).toMatchObject({ ok: true, text: "## Scope\n\nFilter by size and colour.\n" });
    if (!r.ok) throw new Error();
    expect(r.comment).toMatchObject({ answer: { option: 1 }, original: "Filter by size.", state: "answered", anchor: { quote: "Filter by size and colour." } });
  });

  it("changes the answer there and back, and 'no answer' puts the original back", () => {
    const one = answerQuestion(TEXT, question(), 1);
    if (!one.ok || !one.text) throw new Error();
    const zero = answerQuestion(one.text, one.comment, 0);
    if (!zero.ok || !zero.text) throw new Error();
    expect(zero.text).toBe(TEXT);
    const again = answerQuestion(zero.text, zero.comment, 1);
    if (!again.ok || !again.text) throw new Error();
    const none = answerQuestion(again.text, again.comment, null);
    expect(none).toMatchObject({ ok: true, text: TEXT, comment: { state: "open", anchor: { quote: "Filter by size." } } });
    if (!none.ok) throw new Error();
    expect(none.comment.answer).toBeUndefined();
    expect(none.comment.original).toBeUndefined();
  });

  it("an option equal to the quote is a valid 'keep it'", () => {
    expect(answerQuestion(TEXT, question(), 0)).toMatchObject({ ok: true, text: TEXT, comment: { answer: { option: 0 } } });
  });

  it("'Other' keeps the passage and is unsent", () => {
    const r = answerQuestion(TEXT, question(), { other: " Only in the session " });
    expect(r).toMatchObject({ ok: true, text: null, comment: { answer: { other: "Only in the session" }, state: "answered" } });
    if (!r.ok) throw new Error();
    expect(isUnsent(r.comment)).toBe(true);
  });

  it("swap guard: a rewritten passage makes the answer unapplied, to be sent", () => {
    const r = answerQuestion("## Scope\n\nSomething else.\n", question(), 1);
    expect(r).toMatchObject({ ok: true, text: null, comment: { answer: { option: 1 }, unapplied: true } });
    if (!r.ok) throw new Error();
    expect(isUnsent(r.comment)).toBe(true);
  });

  it("refuses a bad option, a comment, a resolved question", () => {
    expect(answerQuestion(TEXT, question(), 5)).toEqual({ ok: false, reason: "bad-option" });
    expect(answerQuestion(TEXT, question(), { other: "  " })).toEqual({ ok: false, reason: "bad-option" });
    expect(answerQuestion(TEXT, question({ kind: "comment", options: undefined }), 0)).toEqual({ ok: false, reason: "not-a-question" });
    expect(answerQuestion(TEXT, question({ state: "resolved" }), 0)).toEqual({ ok: false, reason: "resolved" });
  });
});

const review = (comments: ReviewComment[], approvals: Review["approvals"] = []): Review => ({ path: "specs/a.md", task: null, comments, approvals });
const BLOB = "a".repeat(40);

describe("status and summary", () => {
  it("none, draft, approved, stale", () => {
    expect(reviewStatus(null, BLOB)).toBe("none");
    expect(reviewStatus(review([]), BLOB)).toBe("draft");
    expect(reviewStatus(review([], [{ blob: BLOB, at: "t" }]), BLOB)).toBe("approved");
    expect(reviewStatus(review([], [{ blob: BLOB, at: "t" }]), "b".repeat(40))).toBe("stale");
  });

  it("counts open questions, blocking ones, unsent items and live comments", () => {
    const draft: ReviewComment = { ...question({ id: "c2", author: "person", kind: "comment", options: undefined, blocking: undefined }), state: "draft", text: "No." };
    const s = summarizeReview(review([question(), question({ id: "c3", blocking: false, state: "resolved" }), draft], [{ blob: BLOB, at: "t1" }]), BLOB);
    expect(s).toEqual({ status: "approved", questions: 1, blocking: 1, unsent: 1, comments: 2, approvedAt: "t1" });
  });
});

describe("the batch", () => {
  it("lists drafts and custom answers in the spec's shape", () => {
    const draft: ReviewComment = {
      ...question({ id: "c4", author: "person", kind: "comment", options: undefined, blocking: undefined }),
      text: "Esto no, tiene que ser por talle y color.",
      state: "draft",
    };
    const other = question({ id: "c2", text: "¿Se guarda el filtro?", answer: { other: "Solo en la sesión, no en la cuenta." }, state: "answered" });
    const b = batchMessage("tickets/SHOP-142/spec.md", review([other, draft, question()]), TEXT);
    expect(b?.ids).toEqual(["c4", "c2"]);
    expect(b?.message).toBe(
      [
        "Review round for tickets/SHOP-142/spec.md.",
        "Comments:",
        '- c4 on "Filter by size." (## Scope): "Esto no, tiene que ser por talle y color."',
        "Custom answers:",
        '- c2 "¿Se guarda el filtro?": "Solo en la sesión, no en la cuenta."',
        "Edit the document, then answer each one with reply_to_comment.",
      ].join("\n"),
    );
  });

  it("says when an option could not be swapped in; null when nothing is unsent", () => {
    const b = batchMessage("a.md", review([question({ answer: { option: 1 }, unapplied: true, state: "answered" })]), TEXT);
    expect(b?.message).toContain('- c1 "Which filter?": picked "Size and colour", but the passage changed: write it as "Filter by size and colour."');
    expect(batchMessage("a.md", review([question()]), TEXT)).toBeNull();
  });

  it("markSent moves the listed items to sent, and ids go up", () => {
    const r = markSent(review([question({ state: "draft" }), question({ id: "c7" })]), ["c1"]);
    expect(r.comments.map((c) => c.state)).toEqual(["sent", "open"]);
    expect(nextCommentId(r)).toBe("c8");
    expect(nextCommentId(review([]))).toBe("c1");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/harness-sdk/test/review-answers.test.ts`
Expected: FAIL, missing exports.

- [ ] **Step 3: Write the code**

Append to `packages/harness-sdk/src/review.ts`:

```ts
/** What the person picks on a question card: an option, "no answer" (null), or "Other" (§5.1). */
export type AnswerPick = number | null | { other: string };

export type AnswerResult =
  | { ok: true; text: string | null; comment: ReviewComment }
  | { ok: false; reason: "not-a-question" | "bad-option" | "resolved" };

/** Longest "Other" answer. */
export const MAX_OTHER = 2000;

/** The comment without the fields an answer replaces. */
function bare(c: ReviewComment): ReviewComment {
  const { answer: _a, unapplied: _u, ...rest } = c;
  return rest;
}

/**
 * An answer to a question (§5.1). An option swaps the anchored passage for its text (the first answer keeps the
 * original); "no answer" puts the original back; "Other" keeps the passage. The swap guard: when the passage is no
 * longer where the anchor says (strictly inside its section), nothing is swapped and the answer is `unapplied`, so it
 * travels in the next batch. `text` is the document's new text, or null when it doesn't change.
 */
export function answerQuestion(text: string, c: ReviewComment, pick: AnswerPick): AnswerResult {
  if (c.kind !== "question" || !c.options) return { ok: false, reason: "not-a-question" };
  if (c.state === "resolved") return { ok: false, reason: "resolved" };
  if (typeof pick === "number" && (!Number.isInteger(pick) || pick < 0 || pick >= c.options.length)) return { ok: false, reason: "bad-option" };
  if (pick !== null && typeof pick === "object") {
    const other = typeof pick.other === "string" ? pick.other.trim() : "";
    if (!other || other.length > MAX_OTHER) return { ok: false, reason: "bad-option" };
    return { ok: true, text: null, comment: { ...bare(c), answer: { other }, state: "answered" } };
  }
  const secs = sections(text);
  const where = c.unapplied ? null : locate(text, c.anchor, { strict: true, secs });
  if (!where) {
    const answer = pick === null ? {} : { answer: { option: pick } };
    return { ok: true, text: null, comment: { ...bare(c), ...answer, unapplied: true, state: pick === null ? "open" : "answered" } };
  }
  const passage = text.slice(where.start, where.end);
  const original = c.original ?? passage;
  const target = pick === null ? original : c.options[pick].text;
  const next = text.slice(0, where.start) + target + text.slice(where.end);
  const anchor = anchorOf(next, where.start, target);
  if (pick === null) {
    const { original: _o, ...rest } = bare(c);
    return { ok: true, text: next, comment: { ...rest, anchor, state: "open" } };
  }
  return { ok: true, text: next, comment: { ...bare(c), anchor, answer: { option: pick }, original, state: "answered" } };
}

/** Goes in the next batch (§5.3): a draft, an "Other" answer, or an answer the app could not swap in. */
export const isUnsent = (c: ReviewComment): boolean =>
  c.state === "draft" || (c.kind === "question" && (c.state === "answered" || c.state === "open") && (c.unapplied === true || (c.answer !== undefined && "other" in c.answer)));

export type ReviewStatus = "none" | "draft" | "approved" | "stale";

/** Approved: the current blob is the last approval's. Stale: approved before, changed since (§3). */
export function reviewStatus(review: Review | null, blob: string | null): ReviewStatus {
  if (!review) return "none";
  const last = review.approvals.at(-1);
  if (!last) return "draft";
  return blob !== null && last.blob === blob ? "approved" : "stale";
}

/** What a chip, the footer bar, a harness view and `humanharness run` show (§5.6). */
export interface ReviewSummary {
  status: ReviewStatus;
  /** Questions without an answer. */
  questions: number;
  /** Of those, the blocking ones. */
  blocking: number;
  /** Items the next batch would carry. */
  unsent: number;
  /** Comments and questions not resolved. */
  comments: number;
  /** The last approval's time, when there is one. */
  approvedAt?: string;
}

export function summarizeReview(review: Review | null, blob: string | null): ReviewSummary {
  const status = reviewStatus(review, blob);
  const all = review?.comments ?? [];
  const live = all.filter((c) => c.state !== "resolved");
  const unanswered = live.filter((c) => c.kind === "question" && c.state === "open" && c.answer === undefined);
  const last = review?.approvals.at(-1);
  return {
    status,
    questions: unanswered.length,
    blocking: unanswered.filter((c) => c.blocking === true).length,
    unsent: all.filter(isUnsent).length,
    comments: live.length,
    ...(last ? { approvedAt: last.at } : {}),
  };
}

/** `c<n+1>` for the highest `c<n>` in the record. */
export function nextCommentId(review: Review): string {
  let max = 0;
  for (const c of review.comments) {
    const n = Number(c.id.slice(1));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `c${max + 1}`;
}

/** `s` cut to `max` characters, with "…". */
export function cut(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

const quoted = (s: string, max: number) => JSON.stringify(cut(collapse(s), max));

function answerLine(c: ReviewComment): string {
  if (c.answer && "other" in c.answer) return JSON.stringify(c.answer.other);
  if (c.answer && "option" in c.answer && c.options) {
    const o = c.options[c.answer.option];
    return `picked ${JSON.stringify(o.label)}, but the passage changed: write it as ${quoted(o.text, 400)}`;
  }
  return "took the answer back, but the passage changed: check it";
}

/**
 * The review round's message (§5.3), or null when nothing is unsent. `text` is the document now (for the headings'
 * titles); null when it can't be read. `ids` are the items it carries, which become `sent`.
 */
export function batchMessage(path: string, review: Review, text: string | null): { message: string; ids: string[] } | null {
  const secs = text === null ? [] : sections(text);
  const headingOf = (slug: string | null): string => {
    const s = slug === null ? undefined : secs.find((x) => x.slug === slug);
    return s ? ` (${"#".repeat(s.level)} ${s.title})` : "";
  };
  const comments = review.comments.filter((c) => c.kind === "comment" && c.state === "draft");
  const answers = review.comments.filter((c) => c.kind === "question" && isUnsent(c));
  if (comments.length === 0 && answers.length === 0) return null;
  const lines = [`Review round for ${path}.`];
  if (comments.length > 0) {
    lines.push("Comments:");
    for (const c of comments) lines.push(`- ${c.id} on ${quoted(c.anchor.quote, 40)}${headingOf(c.anchor.heading)}: ${JSON.stringify(c.text)}`);
  }
  if (answers.length > 0) {
    lines.push("Custom answers:");
    for (const c of answers) lines.push(`- ${c.id} ${quoted(c.text, 80)}: ${answerLine(c)}`);
  }
  lines.push("Edit the document, then answer each one with reply_to_comment.");
  return { message: lines.join("\n"), ids: [...comments, ...answers].map((c) => c.id) };
}

/** The batch's items become `sent`. */
export function markSent(review: Review, ids: readonly string[]): Review {
  const sent = new Set(ids);
  return { ...review, comments: review.comments.map((c) => (sent.has(c.id) ? { ...c, state: "sent" as const } : c)) };
}
```

Note: `collapse` (Task 2) must be declared above this code; it is, since Task 2 appended it earlier in the file.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/harness-sdk/test/review-answers.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit**

```bash
git -C <worktree> add packages/harness-sdk/src/review.ts packages/harness-sdk/test/review-answers.test.ts
git -C <worktree> commit -m "feat(sdk): review answers by option, status, summary and the batch"
```

---

### Task 4: A line diff and the `approve` glob

**Files:**
- Modify: `packages/harness-sdk/src/review.ts`
- Test: `packages/harness-sdk/test/review-diff.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/harness-sdk/test/review-diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MAX_DIFF_LINES, lineDiff, matchGlob, validApproveGlob } from "../src/review";

describe("lineDiff", () => {
  it("marks removed and added lines around what stayed", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
      { kind: "same", text: "c" },
      { kind: "added", text: "d" },
    ]);
  });

  it("gives up above the line limit", () => {
    expect(lineDiff("x\n".repeat(MAX_DIFF_LINES + 1), "y")).toBeNull();
  });
});

describe("matchGlob", () => {
  it.each([
    ["tickets/*/spec.md", "tickets/SHOP-142/spec.md", true],
    ["tickets/*/spec.md", "tickets/a/b/spec.md", false],
    ["tickets/**/spec.md", "tickets/a/b/spec.md", true],
    ["tickets/**/spec.md", "tickets/spec.md", true],
    ["spec?.md", "spec1.md", true],
    ["*.md", "docs/a.md", false],
    ["**/*.md", "docs/a.md", true],
  ])("%s ~ %s → %s", (p, path, want) => expect(matchGlob(p, path)).toBe(want));

  it("is fast on many stars", () => {
    const t0 = performance.now();
    matchGlob(`${"*a".repeat(200)}.md`, `${"a".repeat(5000)}b.md`);
    matchGlob(`${"**/".repeat(50)}x.md`, `${"a/".repeat(500)}y.md`);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("validApproveGlob", () => {
  it.each([
    ["tickets/*/spec.md", true],
    ["**/plan.md", true],
    ["/abs/spec.md", false],
    ["../spec.md", false],
    ["a\\b.md", false],
    ["tickets/[ab]/spec.md", false],
    ["tickets/{a,b}.md", false],
    ["spec.txt", false],
    [".harness/x.md", false],
    ["a**b/x.md", false],
    ["", false],
  ])("%s → %s", (p, ok) => expect(validApproveGlob(p)).toBe(ok));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/harness-sdk/test/review-diff.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the code**

Append to `packages/harness-sdk/src/review.ts`:

```ts
import { refusedShape } from "./documents";
```

(merge this import into the existing `import { createSlugger, splitFrontMatter } from "./documents";` line at the top instead of adding a second one.)

```ts
export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

/** Over this many lines on either side, "See what changed" says it is too long to compare here. */
export const MAX_DIFF_LINES = 2000;

/** A line diff (longest common subsequence) between the approved text and the current one; null when too long. */
export function lineDiff(before: string, after: string): DiffLine[] | null {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) return null;
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  const w = y.length + 1;
  // lcs[i * w + j]: the longest common subsequence of x[i:] and y[j:].
  const lcs = new Uint16Array((x.length + 1) * w);
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--) lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
  const out: DiffLine[] = a.slice(0, head).map((text) => ({ kind: "same" as const, text }));
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      out.push({ kind: "same", text: x[i++] });
      j++;
    } else if (j < y.length && (i === x.length || lcs[i * w + j + 1] > lcs[(i + 1) * w + j])) {
      out.push({ kind: "added", text: y[j++] });
    } else out.push({ kind: "removed", text: x[i++] });
  }
  for (const text of a.slice(a.length - tail)) out.push({ kind: "same", text });
  return out;
}

/** One path part against one pattern part: `*` any run, `?` one character. Greedy with one backtrack point. */
function matchPart(p: string, s: string): boolean {
  let i = 0;
  let j = 0;
  let star = -1;
  let mark = 0;
  while (j < s.length) {
    if (i < p.length && (p[i] === "?" || p[i] === s[j])) {
      i++;
      j++;
    } else if (i < p.length && p[i] === "*") {
      star = i++;
      mark = j;
    } else if (star >= 0) {
      i = star + 1;
      j = ++mark;
    } else return false;
  }
  while (i < p.length && p[i] === "*") i++;
  return i === p.length;
}

/** Whether `path` matches the phase's `approve` glob (§5.5): `*` and `?` within a part, `**` across parts. */
export function matchGlob(pattern: string, path: string): boolean {
  const ps = pattern.split("/");
  const xs = path.split("/");
  const memo = new Map<number, boolean>();
  const go = (i: number, j: number): boolean => {
    const key = i * (xs.length + 1) + j;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let r: boolean;
    if (i === ps.length) r = j === xs.length;
    else if (ps[i] === "**") r = go(i + 1, j) || (j < xs.length && go(i, j + 1));
    else r = j < xs.length && matchPart(ps[i], xs[j]) && go(i + 1, j + 1);
    memo.set(key, r);
    return r;
  };
  return go(0, 0);
}

/** The manifest's check of an `approve` glob (Decisions "Phases"). */
export function validApproveGlob(p: unknown): boolean {
  if (typeof p !== "string" || p.length === 0 || p.length > 200) return false;
  for (const c of "[]{}") if (p.includes(c)) return false;
  if (refusedShape(p.replaceAll("*", "x").replaceAll("?", "x"))) return false;
  const parts = p.split("/");
  if (parts.some((part) => part.includes("**") && part !== "**")) return false;
  if (parts[0] === ".harness") return false;
  return p.toLowerCase().endsWith(".md");
}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/harness-sdk/test/review-diff.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit**

```bash
git -C <worktree> add packages/harness-sdk/src/review.ts packages/harness-sdk/test/review-diff.test.ts
git -C <worktree> commit -m "feat(sdk): line diff and approve globs for reviews"
```

---

### Task 5: The record's schema, reserved names and the manifest keys

**Files:**
- Create: `packages/harness-sdk/src/review-schema.ts`
- Modify: `packages/harness-sdk/src/index.ts`, `packages/harness-sdk/src/core-blocks.ts`
- Test: `packages/harness-sdk/test/review-manifest.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/harness-sdk/test/review-manifest.test.ts` (the base manifest is the one `test/phases.test.ts` uses):

```ts
import { describe, expect, it } from "vitest";
import { type HarnessInput, RESERVED_BLOCK_NAMES, defineHarness, reviewSchema } from "../src";

const base: HarnessInput = {
  id: "dev",
  name: "Dev",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Dev" },
  instructions: "./AGENTS.md",
  permissions: { edit: "folder", exec: false, web: false },
  blocks: {},
  author: "t",
};
const withPhases = (phases: unknown[]): HarnessInput =>
  ({ ...base, actions: { ticket: { label: "Ticket", prompt: "tasks/ticket.md", cost: "medium", phases } } }) as HarnessInput;

describe("approve on a phase", () => {
  it("takes a valid glob", () => {
    expect(() => defineHarness(withPhases([{ id: "spec", label: "Spec", approve: "tickets/*/spec.md" }, { id: "plan", label: "Plan" }]))).not.toThrow();
  });

  it.each(["../x.md", "/x.md", "x.txt", "tickets/[a]/x.md", ".harness/x.md"])("refuses %s", (approve) => {
    expect(() => defineHarness(withPhases([{ id: "spec", label: "Spec", approve }]))).toThrow();
  });
});

describe("reviewTier on a kind", () => {
  const kinds = (reviewTier: unknown) => ({ ...base, documents: { kinds: { spec: { when: "A spec", sections: ["Scope"], reviewTier } } } }) as HarnessInput;
  it("takes a tier and refuses anything else", () => {
    expect(() => defineHarness(kinds("deep"))).not.toThrow();
    expect(() => defineHarness(kinds("huge"))).toThrow();
  });
});

describe("reserved names", () => {
  it("no harness block may be called like a review tool", () => {
    expect(RESERVED_BLOCK_NAMES).toEqual(expect.arrayContaining(["ask_in_document", "reply_to_comment", "read_review"]));
  });
});

describe("reviewSchema", () => {
  const ok = {
    path: "specs/a.md",
    task: null,
    comments: [
      {
        id: "c1",
        author: "agent",
        kind: "question",
        anchor: { quote: "x", heading: null, occurrence: 0 },
        text: "Which?",
        options: [
          { label: "A", text: "x" },
          { label: "B", text: "y" },
        ],
        state: "open",
        replies: [],
        at: "2026-10-28T10:00:00.000Z",
      },
    ],
    approvals: [{ blob: "a".repeat(40), at: "2026-10-28T10:00:00.000Z" }],
  };
  it("takes a valid record and refuses a broken one", () => {
    expect(reviewSchema.safeParse(ok).success).toBe(true);
    expect(reviewSchema.safeParse({ ...ok, approvals: [{ blob: "nope", at: "t" }] }).success).toBe(false);
    expect(reviewSchema.safeParse({ ...ok, comments: [{ ...ok.comments[0], id: "x1" }] }).success).toBe(false);
    expect(reviewSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/harness-sdk/test/review-manifest.test.ts`
Expected: FAIL (unknown keys `approve` and `reviewTier`, no `reviewSchema`).

- [ ] **Step 3: Write the code**

Create `packages/harness-sdk/src/review-schema.ts`:

```ts
import { z } from "zod";
import { MAX_OTHER } from "./review";

/** A comment id: `c1`, `c2`… */
export const COMMENT_ID = /^c[1-9][0-9]{0,5}$/;
const at = z.string().max(40);
const author = z.enum(["agent", "person"]);

const anchorSchema = z.strictObject({
  quote: z.string().min(1).max(20_000),
  heading: z.string().max(200).nullable(),
  occurrence: z.number().int().min(0).max(100_000),
});
export const reviewOptionSchema = z.strictObject({ label: z.string().min(1).max(120), text: z.string().min(1).max(20_000) });

const commentSchema = z.strictObject({
  id: z.string().regex(COMMENT_ID),
  author,
  kind: z.enum(["question", "comment"]),
  anchor: anchorSchema,
  text: z.string().min(1).max(4000),
  options: z.array(reviewOptionSchema).min(2).max(5).optional(),
  blocking: z.boolean().optional(),
  answer: z.union([z.strictObject({ option: z.number().int().min(0).max(4) }), z.strictObject({ other: z.string().min(1).max(MAX_OTHER) })]).optional(),
  original: z.string().max(20_000).optional(),
  unapplied: z.literal(true).optional(),
  state: z.enum(["draft", "open", "answered", "sent", "resolved", "lost"]),
  replies: z.array(z.strictObject({ author, text: z.string().min(1).max(4000), at })).max(200),
  at,
});

/** `.harness/reviews/<path>.json` (§3). A file that fails this is "broken" (a hand edit). */
export const reviewSchema = z.strictObject({
  path: z.string().min(1).max(1000),
  task: z.string().max(200).nullable(),
  scope: z.string().max(64).optional(),
  comments: z.array(commentSchema).max(500),
  approvals: z
    .array(z.strictObject({ blob: z.string().regex(/^[0-9a-f]{40}$/), at, reason: z.string().min(1).max(500).optional() }))
    .max(200),
});
```

In `packages/harness-sdk/src/index.ts`:
- add `export * from "./review-schema";` next to `export * from "./review";`;
- import `validApproveGlob` from `"./review"`;
- in `phaseSchema` add, after `close`:

```ts
  /** A glob of documents (relative to the folder): approving one in this phase moves the task to the next (review spec §5.5). */
  approve: z.string().refine(validApproveGlob, "A relative glob of .md files: * and ? within a part, ** across parts").optional(),
```

- in `documentKindSchema` add:

```ts
  /** The tier of a "Review <title>" task for this kind (review spec §11.3). Absent: standard. */
  reviewTier: z.enum(TIERS).optional(),
```

(`TIERS` is declared above `phaseSchema`; move `documentKindSchema` below it if the file order needs it.)

- In `DocumentKind` (`packages/harness-sdk/src/documents.ts`) add `reviewTier?: "light" | "standard" | "deep";` with a one-line comment.

In `packages/harness-sdk/src/core-blocks.ts`:

```ts
import { REVIEW_TOOLS } from "./review";
```

and extend the list:

```ts
export const RESERVED_BLOCK_NAMES: readonly string[] = [
  ...CORE_BLOCK_NAMES,
  ...Object.keys(INPUT_CORE_BLOCKS),
  ...Object.keys(MODE_CORE_BLOCKS),
  ...Object.keys(PHASE_CORE_BLOCKS),
  // The agent's review tools (review spec §4): not blocks, but no block may take their names.
  ...REVIEW_TOOLS,
];
```

Find the check in `index.ts` that refuses a block whose *tool* name equals a core tool name (around the line building `Object.entries({ ...CORE_BLOCKS, … }).map(([name, b]) => [blockToolName(name, b), name])`) and add the review tools to that map: `...REVIEW_TOOLS.map((t) => [t, t] as const)`.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/harness-sdk/test/review-manifest.test.ts`
Expected: PASS. Run `corepack pnpm vitest run packages/harness-sdk` too: every existing manifest test passes unchanged (D0).

- [ ] **Step 5: Typecheck, test, commit**

```bash
git -C <worktree> add packages/harness-sdk
git -C <worktree> commit -m "feat(sdk): review record schema, approve on phases, reviewTier on kinds"
```

---
### Task 6: The record on disk, the person's own documents, the history

**Files:**
- Create: `packages/workspace/src/reviews.ts`
- Modify: `packages/workspace/src/layout.ts`, `packages/workspace/src/history.ts`, `packages/workspace/src/index.ts`
- Test: `packages/workspace/test/reviews.test.ts`, `packages/workspace/test/history.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Create `packages/workspace/test/reviews.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import git from "isomorphic-git";
import { afterAll, describe, expect, it } from "vitest";
import type { Review } from "@humanharness/harness-sdk";
import { ReviewLocks, ReviewRefused, blobId, loadReview, newReview, readOwnDocument, reviewSummarySync, saveReview, writeOwnDocument } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-reviews-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const folder = () => {
  const f = fs.mkdtempSync(path.join(root, "f-"));
  fs.mkdirSync(path.join(f, "specs"));
  fs.writeFileSync(path.join(f, "specs", "a.md"), "## Scope\n\nFilter by size.\n");
  return f;
};

describe("readOwnDocument", () => {
  it("reads an .md of the person's folder", async () => {
    const f = folder();
    expect(await readOwnDocument(f, "specs/a.md")).toMatchObject({ ok: true, text: "## Scope\n\nFilter by size.\n" });
  });

  it("refuses what a review may never touch", async () => {
    const f = folder();
    const outside = fs.mkdtempSync(path.join(root, "out-"));
    fs.writeFileSync(path.join(outside, "x.md"), "x");
    fs.symlinkSync(path.join(outside, "x.md"), path.join(f, "link.md"));
    fs.symlinkSync(outside, path.join(f, "linked"));
    fs.mkdirSync(path.join(f, ".harness"));
    fs.writeFileSync(path.join(f, ".harness", "n.md"), "n");
    fs.linkSync(path.join(f, "specs", "a.md"), path.join(f, "hard.md"));
    expect(await readOwnDocument(f, "../x.md")).toEqual({ ok: false, reason: "outside" });
    expect(await readOwnDocument(f, "link.md")).toEqual({ ok: false, reason: "outside" });
    expect(await readOwnDocument(f, "linked/x.md")).toEqual({ ok: false, reason: "outside" });
    expect(await readOwnDocument(f, ".harness/n.md")).toEqual({ ok: false, reason: "outside" });
    expect(await readOwnDocument(f, "hard.md")).toEqual({ ok: false, reason: "outside" });
    expect(await readOwnDocument(f, "specs/a.txt")).toEqual({ ok: false, reason: "not-markdown" });
    expect(await readOwnDocument(f, "specs/b.md")).toEqual({ ok: false, reason: "missing" });
  });
});

describe("writeOwnDocument", () => {
  it("writes only when the bytes are still the ones read", async () => {
    const f = folder();
    const first = await readOwnDocument(f, "specs/a.md");
    if (!first.ok) throw new Error();
    expect(await writeOwnDocument(f, "specs/a.md", first.bytes, "## Scope\n\nBy colour.\n")).toMatchObject({ ok: true });
    expect(fs.readFileSync(path.join(f, "specs", "a.md"), "utf8")).toBe("## Scope\n\nBy colour.\n");
    expect(await writeOwnDocument(f, "specs/a.md", first.bytes, "again")).toEqual({ ok: false, reason: "changed" });
    expect(fs.readdirSync(path.join(f, "specs"))).toEqual(["a.md"]);
  });
});

describe("blobId", () => {
  it("is git's blob id", async () => {
    const bytes = Buffer.from("## Scope\n");
    expect(blobId(bytes)).toBe((await git.hashBlob({ object: bytes })).oid);
  });
});

describe("the record", () => {
  const record = (doc: string): Review => newReview(doc, { id: "t1", scope: "main" });

  it("round-trips under .harness/reviews, folders kept", async () => {
    const f = folder();
    await saveReview(f, record("specs/a.md"));
    expect(fs.existsSync(path.join(f, ".harness", "reviews", "specs", "a.md.json"))).toBe(true);
    expect(await loadReview(f, "specs/a.md")).toEqual({ path: "specs/a.md", task: "t1", scope: "main", comments: [], approvals: [] });
    expect(await loadReview(f, "specs/none.md")).toBeNull();
  });

  it("a broken record is refused, never trusted", async () => {
    const f = folder();
    fs.mkdirSync(path.join(f, ".harness", "reviews", "specs"), { recursive: true });
    fs.writeFileSync(path.join(f, ".harness", "reviews", "specs", "a.md.json"), '{"path":"specs/a.md","task":null,"comments":[{}],"approvals":[]}');
    await expect(loadReview(f, "specs/a.md")).rejects.toBeInstanceOf(ReviewRefused);
  });

  it("refuses to write through a linked reviews folder", async () => {
    const f = folder();
    const outside = fs.mkdtempSync(path.join(root, "out-"));
    fs.mkdirSync(path.join(f, ".harness"));
    fs.symlinkSync(outside, path.join(f, ".harness", "reviews"));
    await expect(saveReview(f, record("specs/a.md"))).rejects.toBeInstanceOf(ReviewRefused);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("the CLI's sync summary", async () => {
    const f = folder();
    expect(reviewSummarySync(f, "specs/a.md")).toBeNull();
    await saveReview(f, record("specs/a.md"));
    expect(reviewSummarySync(f, "specs/a.md")).toMatchObject({ status: "draft", questions: 0 });
  });
});

describe("ReviewLocks", () => {
  it("runs one thing at a time per document", async () => {
    const locks = new ReviewLocks();
    const order: string[] = [];
    const slow = locks.run("a.md", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("first");
    });
    const fast = locks.run("a.md", async () => order.push("second"));
    const other = locks.run("b.md", async () => order.push("other"));
    await Promise.all([slow, fast, other]);
    expect(order).toEqual(["other", "first", "second"]);
  });
});
```

Append to `packages/workspace/test/history.test.ts` (import `appHistoryKeep` and `blobId` from `../src` if the file does not yet):

```ts
describe("review records (review spec §3, §7 undo)", () => {
  it("are tracked under .harness/, without their temp files, and a restore brings them back", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-hist-rev-"));
    const history = new History(folder, `${folder}.git`, [".harness/"], appHistoryKeep(false));
    await history.init();
    const rec = path.join(folder, ".harness", "reviews", "specs", "a.md.json");
    fs.mkdirSync(path.dirname(rec), { recursive: true });
    fs.writeFileSync(rec, "{}");
    fs.writeFileSync(`${rec}.0b1c2d3e-aaaa-bbbb-cccc-123456789abc.tmp`, "{}");
    const first = (await history.save("one"))!;
    expect((await history.changes(null, first)).map((c) => c.path)).toEqual([".harness/reviews/specs/a.md.json"]);
    fs.writeFileSync(rec, '{"changed":true}');
    await history.save("two");
    await history.restore(first, "Undo");
    expect(fs.readFileSync(rec, "utf8")).toBe("{}");
  });

  it("readBlob reads an approved version by its blob id", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-hist-blob-"));
    const history = new History(folder, `${folder}.git`);
    await history.init();
    fs.writeFileSync(path.join(folder, "a.md"), "approved\n");
    await history.save("Approved: a.md");
    expect(await history.readBlob(blobId(Buffer.from("approved\n")))).toBe("approved\n");
    expect(await history.readBlob("f".repeat(40))).toBeNull();
    expect(await history.readBlob("nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/workspace/test/reviews.test.ts packages/workspace/test/history.test.ts`
Expected: FAIL (missing exports).

- [ ] **Step 3: Write the code**

In `packages/workspace/src/layout.ts`, next to `DATA_PREFIX`:

```ts
/** Review records (review spec §3): `.harness/reviews/<document path>.json`, tracked by the history. */
export const REVIEWS_PREFIX = ".harness/reviews/";
```

In `packages/workspace/src/history.ts`:
- import `REVIEWS_PREFIX` from `./layout`;
- `appHistoryKeep` becomes (its comment says "the notes, the data and the review records"; a harness that never reviews has no file there, so its commits don't change, D0):

```ts
export const appHistoryKeep = (material: boolean): HistoryKeep[] => [NOTES_PREFIX, DATA_PREFIX, REVIEWS_PREFIX, ...(material ? [MATERIAL_KEEP] : [])];
```

- `isAppTempFile` gains a third line (the regex runs on a path from the history's own walk, not on document text, and has no nested quantifier):

```ts
  (file.startsWith(REVIEWS_PREFIX) && /\.json\.[0-9a-f-]+\.tmp$/.test(file.slice(REVIEWS_PREFIX.length)));
```

- add, after `readFileAt`:

```ts
  /** The text of blob `oid` (an approved version, review spec §5.4); null when the history doesn't have it. */
  async readBlob(oid: string): Promise<string | null> {
    if (!/^[0-9a-f]{40}$/.test(oid)) return null;
    try {
      const { blob } = await git.readBlob({ fs, gitdir: this.gitdir, oid });
      return Buffer.from(blob).toString("utf8");
    } catch (err) {
      if ((err as { code?: string }).code === "NotFoundError") return null;
      throw err;
    }
  }
```

Create `packages/workspace/src/reviews.ts`:

```ts
import { createHash, randomUUID } from "node:crypto";
import nodeFs, { constants, promises as fs } from "node:fs";
import path from "node:path";
import { type Review, type ReviewSummary, isMarkdownPath, refusedShape, reviewSchema, summarizeReview } from "@humanharness/harness-sdk";

/** Over this a document is not reviewed (the reader's own limit). */
export const MAX_REVIEW_DOCUMENT_BYTES = 10 * 1024 * 1024;
/** Over this a record is "broken". */
const MAX_RECORD_BYTES = 5 * 1024 * 1024;

export type ReviewReason = "outside" | "missing" | "not-markdown" | "too-large" | "broken" | "unknown" | "not-found" | "bad-input" | "full";

/** A refusal whose message is safe to show the agent (a tool error) or the person; `reason` is for the window. */
export class ReviewRefused extends Error {
  constructor(
    message: string,
    readonly reason: ReviewReason = "bad-input",
  ) {
    super(message);
    this.name = "ReviewRefused";
  }
}

export type OwnReason = "outside" | "missing" | "not-markdown" | "too-large";
export type OwnDocument = { ok: true; file: string; text: string; bytes: Buffer } | { ok: false; reason: OwnReason };

/** git's blob id of `bytes`: what the history stores for that content, so an approval names a version (D4). */
export function blobId(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/**
 * `rel` as a document of the person's folder a review may touch: a plain relative `.md` path, not under `.harness/`,
 * whose real path is exactly the path asked (a link anywhere on the way is refused, so a write never lands outside).
 */
async function ownPath(base: string, rel: unknown): Promise<{ ok: true; file: string } | { ok: false; reason: OwnReason }> {
  if (refusedShape(rel)) return { ok: false, reason: "outside" };
  const r = rel as string;
  if (!isMarkdownPath(r)) return { ok: false, reason: "not-markdown" };
  if (r.split("/").filter((p) => p && p !== ".")[0] === ".harness") return { ok: false, reason: "outside" };
  const root = await fs.realpath(base);
  const file = path.resolve(root, r);
  if (!file.startsWith(root + path.sep)) return { ok: false, reason: "outside" };
  const real = await fs.realpath(file).catch(() => null);
  if (real === null) return { ok: false, reason: "missing" };
  if (real !== file) return { ok: false, reason: "outside" };
  return { ok: true, file };
}

/** A document the review reads (§4 "inside the person's folder only"): never a reference folder, a link or a hard link. */
export async function readOwnDocument(base: string, rel: unknown): Promise<OwnDocument> {
  const at = await ownPath(base, rel);
  if (!at.ok) return at;
  const handle = await fs.open(at.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null);
  if (!handle) return { ok: false, reason: "missing" };
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.nlink > 1) return { ok: false, reason: "outside" };
    if (st.size > MAX_REVIEW_DOCUMENT_BYTES) return { ok: false, reason: "too-large" };
    const bytes = await handle.readFile();
    return { ok: true, file: at.file, bytes, text: bytes.toString("utf8") };
  } finally {
    await handle.close();
  }
}

/**
 * Writes the document's new text (an answer's swap, §5.1), only when its bytes still equal `expected` (what the caller
 * read under the lock). Through a temp file in the same folder and a rename; the file keeps its mode.
 */
export async function writeOwnDocument(
  base: string,
  rel: string,
  expected: Uint8Array,
  next: string,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; reason: OwnReason | "changed" }> {
  const now = await readOwnDocument(base, rel);
  if (!now.ok) return now;
  if (!Buffer.from(expected).equals(now.bytes)) return { ok: false, reason: "changed" };
  const bytes = Buffer.from(next, "utf8");
  const mode = (await fs.stat(now.file)).mode & 0o777;
  const tmp = path.join(path.dirname(now.file), `.${path.basename(now.file)}.${randomUUID()}.tmp`);
  await fs.writeFile(tmp, bytes, { flag: "wx", mode });
  try {
    await fs.rename(tmp, now.file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return { ok: true, bytes };
}

const broken = (doc: string) => new ReviewRefused(`the review of ${path.posix.basename(doc)} can't be read`, "broken");

/** The record's file, `<real base>/.harness/reviews/<doc>.json`, and the reviews folder. */
async function recordPath(base: string, doc: string): Promise<{ file: string; top: string }> {
  if (refusedShape(doc)) throw new ReviewRefused(`${doc} is outside your folder`, "outside");
  const top = path.join(await fs.realpath(base), ".harness", "reviews");
  const file = path.join(top, ...`${doc}.json`.split("/"));
  if (!file.startsWith(top + path.sep)) throw new ReviewRefused(`${doc} is outside your folder`, "outside");
  return { file, top };
}

/** A new record (§3): `task` and `scope` from the task open now. */
export function newReview(doc: string, task: { id: string; scope: string } | null): Review {
  return { path: doc, task: task?.id ?? null, ...(task ? { scope: task.scope } : {}), comments: [], approvals: [] };
}

/** The record of `doc`; null when there is none. Throws `ReviewRefused` ("broken") when it fails the schema. */
export async function loadReview(base: string, doc: string): Promise<Review | null> {
  const { file } = await recordPath(base, doc);
  const dir = path.dirname(file);
  const realDir = await fs.realpath(dir).catch(() => null);
  if (realDir === null) return null;
  if (realDir !== dir) throw broken(doc);
  let raw: string;
  try {
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const st = await handle.stat();
      if (!st.isFile() || st.size > MAX_RECORD_BYTES) throw broken(doc);
      raw = await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err instanceof ReviewRefused ? err : broken(doc);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw broken(doc);
  }
  const r = reviewSchema.safeParse(parsed);
  if (!r.success || r.data.path !== doc) throw broken(doc);
  return r.data as Review;
}

/** Writes the record atomically (a temp file the history skips, then a rename). Never through a linked folder. */
export async function saveReview(base: string, review: Review): Promise<void> {
  const { file, top } = await recordPath(base, review.path);
  const dir = path.dirname(file);
  // Folder by folder from `.harness` down, each checked before the next is made: a link (or a file) on the way is
  // refused, so no folder is ever created through a link.
  let d = path.dirname(top);
  for (const part of ["", "reviews", ...path.relative(top, dir).split(path.sep).filter(Boolean)]) {
    if (part) d = path.join(d, part);
    const st = await fs.lstat(d).catch(() => null);
    if (st && !st.isDirectory()) throw new ReviewRefused("the review folder is a link", "outside");
    if (!st) await fs.mkdir(d);
  }
  // A swap between the check and the write: caught here.
  if ((await fs.realpath(dir)) !== dir) throw new ReviewRefused("the review folder is a link", "outside");
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(review, null, 2)}\n`, { flag: "wx" });
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/** One writer at a time per document (§3): the agent's tools and the person's actions. */
export class ReviewLocks {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(doc: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(doc) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.tails.set(doc, tail);
    void tail.then(() => {
      if (this.tails.get(doc) === tail) this.tails.delete(doc);
    });
    return next;
  }
}

/** `humanharness run`'s line under a card (§10.6), read synchronously; null without a record or when anything fails. */
export function reviewSummarySync(base: string, doc: string): ReviewSummary | null {
  try {
    if (refusedShape(doc) || !isMarkdownPath(doc)) return null;
    const root = nodeFs.realpathSync(base);
    const recordFile = path.join(root, ".harness", "reviews", ...`${doc}.json`.split("/"));
    const docFile = path.join(root, ...doc.split("/"));
    for (const f of [recordFile, docFile]) {
      const st = nodeFs.lstatSync(f, { throwIfNoEntry: false });
      if (!st || !st.isFile()) return null;
    }
    const parsed = reviewSchema.safeParse(JSON.parse(nodeFs.readFileSync(recordFile, "utf8")));
    if (!parsed.success) return null;
    return summarizeReview(parsed.data as Review, blobId(nodeFs.readFileSync(docFile)));
  } catch {
    return null;
  }
}
```

The `nodeFs` import is only for `reviewSummarySync`.

In `packages/workspace/src/index.ts` add `export * from "./reviews";`.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/workspace/test/reviews.test.ts packages/workspace/test/history.test.ts`
Expected: PASS. Every existing history test passes unchanged.

- [ ] **Step 5: Typecheck, test, commit**

```bash
git -C <worktree> add packages/workspace
git -C <worktree> commit -m "feat(workspace): review records, own-document reads and writes, history keeps reviews"
```

---

### Task 7: The agent's three requests

**Files:**
- Create: `packages/workspace/src/review-requests.ts`
- Modify: `packages/workspace/src/index.ts`
- Test: `packages/workspace/test/review-requests.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/workspace/test/review-requests.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ReviewLocks, loadReview, runReviewRequest } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-revreq-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function setup(task: { id: string; scope: string } | null = { id: "t1", scope: "main" }) {
  const base = fs.mkdtempSync(path.join(root, "f-"));
  fs.mkdirSync(path.join(base, "specs"));
  fs.writeFileSync(path.join(base, "specs", "spec.md"), "## Scope\n\nFilter by size.\n\n## Risks\n\nNone.\n");
  const changed: string[] = [];
  const ctx = { base, locks: new ReviewLocks(), task: async () => task, now: () => new Date("2026-10-28T10:00:00.000Z"), changed: (d: string) => changed.push(d) };
  return { base, ctx, changed };
}
const ask = (over: Record<string, unknown> = {}) => ({
  op: "ask",
  path: "specs/spec.md",
  quote: "Filter by size.",
  question: "Which filter?",
  options: [
    { label: "Size", text: "Filter by size." },
    { label: "Size and colour", text: "Filter by size and colour." },
  ],
  blocking: true,
  ...over,
});

describe("ask", () => {
  it("adds an open question anchored on the quote, in a new record for the open task", async () => {
    const { base, ctx, changed } = setup();
    expect(await runReviewRequest(ctx, ask())).toEqual({ id: "c1" });
    expect(await runReviewRequest(ctx, ask({ quote: "None.", heading: "risks", blocking: undefined }))).toEqual({ id: "c2" });
    const r = await loadReview(base, "specs/spec.md");
    expect(r).toMatchObject({ task: "t1", scope: "main" });
    expect(r?.comments[0]).toMatchObject({ author: "agent", kind: "question", state: "open", blocking: true, anchor: { quote: "Filter by size.", heading: "scope", occurrence: 0 } });
    expect(r?.comments[1].blocking).toBeUndefined();
    expect(changed).toEqual(["specs/spec.md", "specs/spec.md"]);
  });

  it.each([
    [{ quote: "nowhere" }, "quote not found in spec.md"],
    [{ quote: "None.", heading: "scope" }, "quote not found in spec.md"],
    [{ heading: "gone" }, "no heading #gone in spec.md"],
    [{ path: "../spec.md" }, "spec.md is outside your folder"],
    [{ path: ".harness/x.md" }, "x.md is outside your folder"],
    [{ path: "specs/none.md" }, "none.md does not exist"],
    [{ options: [{ label: "Only", text: "x" }] }, "options: 2 to 5"],
    [{ options: Array.from({ length: 6 }, (_, i) => ({ label: `${i}`, text: `${i}` })) }, "options: 2 to 5"],
  ])("refuses %j with %s", async (over, message) => {
    const { ctx } = setup();
    await expect(runReviewRequest(ctx, ask(over))).rejects.toThrow(message);
  });
});

describe("reply", () => {
  it("adds a reply, resolves or keeps it open, and refuses an unknown id", async () => {
    const { base, ctx } = setup();
    await runReviewRequest(ctx, ask());
    await runReviewRequest(ctx, { op: "reply", path: "specs/spec.md", id: "c1", reply: "Which colours?", resolve: false });
    expect((await loadReview(base, "specs/spec.md"))?.comments[0]).toMatchObject({ state: "open", replies: [{ author: "agent", text: "Which colours?" }] });
    await runReviewRequest(ctx, { op: "reply", path: "specs/spec.md", id: "c1", reply: "Done.", resolve: true });
    expect((await loadReview(base, "specs/spec.md"))?.comments[0].state).toBe("resolved");
    await expect(runReviewRequest(ctx, { op: "reply", path: "specs/spec.md", id: "c9", reply: "x", resolve: true })).rejects.toThrow("unknown comment c9");
  });
});

describe("read", () => {
  it("returns what is not resolved, lost passages, and the status", async () => {
    const { base, ctx } = setup(null);
    await runReviewRequest(ctx, ask());
    await runReviewRequest(ctx, ask({ quote: "None.", heading: "risks" }));
    await runReviewRequest(ctx, { op: "reply", path: "specs/spec.md", id: "c2", reply: "ok", resolve: true });
    fs.writeFileSync(path.join(base, "specs", "spec.md"), "## Scope\n\nRewritten.\n");
    const r = (await runReviewRequest(ctx, { op: "read", path: "specs/spec.md" })) as { status: string; comments: { id: string; state: string }[] };
    expect(r.status).toBe("draft");
    expect(r.comments).toEqual([expect.objectContaining({ id: "c1", state: "lost", quote: "Filter by size." })]);
    expect((await loadReview(base, "specs/spec.md"))?.task).toBeNull();
  });

  it("a document without a record has status none", async () => {
    const { ctx } = setup();
    expect(await runReviewRequest(ctx, { op: "read", path: "specs/spec.md" })).toEqual({ path: "specs/spec.md", status: "none", comments: [] });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/workspace/test/review-requests.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the code**

Create `packages/workspace/src/review-requests.ts`:

```ts
import path from "node:path";
import { type ReviewComment, type ReviewOption, anchorAt, locate, nextCommentId, refusedShape, reviewStatus } from "@humanharness/harness-sdk";
import { type OwnReason, type ReviewLocks, ReviewRefused, blobId, loadReview, newReview, readOwnDocument, saveReview } from "./reviews";

/** At most this many comments in one record. */
export const MAX_COMMENTS = 500;
const MAX_REPLIES = 200;

export interface ReviewContext {
  /** The person's folder (the active profile's). */
  base: string;
  locks: ReviewLocks;
  /** The open task and its scope: a new record's `task` (§3). */
  task(): Promise<{ id: string; scope: string } | null>;
  now?(): Date;
  /** A record changed: the window draws it again. */
  changed?(doc: string): void;
}

const name = (p: string) => path.posix.basename(p);
/** The spec's messages (§4): "spec.md is outside your folder", … */
export function documentProblem(doc: string, reason: OwnReason): ReviewRefused {
  const text =
    reason === "outside"
      ? `${name(doc)} is outside your folder`
      : reason === "not-markdown"
        ? `${name(doc)} is not a Markdown (.md) document`
        : reason === "too-large"
          ? `${name(doc)} is too large to review`
          : `${name(doc)} does not exist`;
  return new ReviewRefused(text, reason);
}
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;

/**
 * The agent's review tools (§4), run as the agent in the person's folder. Each refusal throws `ReviewRefused` with the
 * message the agent reads as a tool error; it may retry.
 */
export async function runReviewRequest(ctx: ReviewContext, request: unknown): Promise<unknown> {
  if (!request || typeof request !== "object") throw new ReviewRefused("Bad request");
  const r = request as Record<string, unknown>;
  if (typeof r.path !== "string" || refusedShape(r.path)) throw documentProblem(typeof r.path === "string" ? r.path : "document", "outside");
  const doc = path.posix.normalize(r.path);
  const at = () => (ctx.now?.() ?? new Date()).toISOString();
  if (r.op === "ask") return ask(ctx, doc, r, at);
  if (r.op === "reply") return reply(ctx, doc, r, at);
  if (r.op === "read") return read(ctx, doc);
  throw new ReviewRefused("Unknown request");
}

async function ask(ctx: ReviewContext, doc: string, r: Record<string, unknown>, at: () => string): Promise<{ id: string }> {
  if (!Array.isArray(r.options) || r.options.length < 2 || r.options.length > 5) throw new ReviewRefused("options: 2 to 5");
  const options: ReviewOption[] = r.options.map((o: unknown) => {
    const x = (o ?? {}) as { label?: unknown; text?: unknown };
    if (!text(x.label, 120) || typeof x.text !== "string" || x.text.length === 0 || x.text.length > 20_000)
      throw new ReviewRefused("options: each needs a `label` (up to 120 characters) and the `text` that replaces the passage");
    return { label: x.label.trim(), text: x.text };
  });
  if (!text(r.question, 500)) throw new ReviewRefused("question: 1 to 500 characters");
  if (typeof r.quote !== "string" || r.quote.length === 0 || r.quote.length > 20_000) throw new ReviewRefused(`quote not found in ${name(doc)}`, "not-found");
  if (r.heading !== undefined && !text(r.heading, 200)) throw new ReviewRefused("heading: a heading's slug, as in its link (#scope)");
  if (r.blocking !== undefined && typeof r.blocking !== "boolean") throw new ReviewRefused("blocking: true or false");
  const quote = r.quote;
  const heading = r.heading as string | undefined;
  const question = (r.question as string).trim();
  return ctx.locks.run(doc, async () => {
    const d = await readOwnDocument(ctx.base, doc);
    if (!d.ok) throw documentProblem(doc, d.reason);
    const found = anchorAt(d.text, quote, heading);
    if (!found.ok) throw new ReviewRefused(found.reason === "no-heading" ? `no heading #${heading} in ${name(doc)}` : `quote not found in ${name(doc)}`, "not-found");
    const review = (await loadReview(ctx.base, doc)) ?? newReview(doc, await ctx.task());
    if (review.comments.length >= MAX_COMMENTS) throw new ReviewRefused(`${name(doc)} has too many comments`, "full");
    const id = nextCommentId(review);
    const comment: ReviewComment = {
      id,
      author: "agent",
      kind: "question",
      anchor: found.anchor,
      text: question,
      options,
      ...(r.blocking === true ? { blocking: true } : {}),
      state: "open",
      replies: [],
      at: at(),
    };
    await saveReview(ctx.base, { ...review, comments: [...review.comments, comment] });
    ctx.changed?.(doc);
    return { id };
  });
}

async function reply(ctx: ReviewContext, doc: string, r: Record<string, unknown>, at: () => string): Promise<{ id: string; state: string }> {
  const id = typeof r.id === "string" ? r.id : "";
  if (!text(r.reply, 4000)) throw new ReviewRefused("reply: 1 to 4000 characters");
  if (typeof r.resolve !== "boolean") throw new ReviewRefused("resolve: true when it is done, false when you ask something back");
  const words = (r.reply as string).trim();
  const resolve = r.resolve;
  return ctx.locks.run(doc, async () => {
    const review = await loadReview(ctx.base, doc);
    const c = review?.comments.find((x) => x.id === id);
    if (!review || !c) throw new ReviewRefused(`unknown comment ${id || "(no id)"}`, "unknown");
    if (c.replies.length >= MAX_REPLIES) throw new ReviewRefused(`${id} has too many replies`, "full");
    // §4: resolve marks it resolved; a reply that asks something back keeps it open.
    const state = resolve ? ("resolved" as const) : ("open" as const);
    const next: ReviewComment = { ...c, state, replies: [...c.replies, { author: "agent", text: words, at: at() }] };
    await saveReview(ctx.base, { ...review, comments: review.comments.map((x) => (x.id === id ? next : x)) });
    ctx.changed?.(doc);
    return { id, state };
  });
}

async function read(ctx: ReviewContext, doc: string): Promise<unknown> {
  const d = await readOwnDocument(ctx.base, doc);
  if (!d.ok) throw documentProblem(doc, d.reason);
  const review = await loadReview(ctx.base, doc);
  const comments = (review?.comments ?? [])
    .filter((c) => c.state !== "resolved")
    .map((c) => ({
      id: c.id,
      author: c.author,
      kind: c.kind,
      quote: c.anchor.quote,
      heading: c.anchor.heading,
      text: c.text,
      ...(c.options ? { options: c.options } : {}),
      ...(c.blocking ? { blocking: true } : {}),
      ...(c.answer ? { answer: "option" in c.answer ? { option: c.answer.option, label: c.options?.[c.answer.option]?.label } : c.answer } : {}),
      state: locate(d.text, c.anchor) ? c.state : "lost",
      replies: c.replies,
    }));
  return { path: doc, status: reviewStatus(review, blobId(d.bytes)), comments };
}
```

In `packages/workspace/src/index.ts` add `export * from "./review-requests";`.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/workspace/test/review-requests.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit**

```bash
git -C <worktree> add packages/workspace
git -C <worktree> commit -m "feat(workspace): the agent's review requests: ask, reply, read"
```

---

### Task 8: The review tools on the `ui` server

**Files:**
- Modify: `packages/blocks/src/ui-server.ts`, `packages/blocks/src/ui-server-bin.ts`, `packages/blocks/src/launch.ts`
- Test: `packages/blocks/test/review-tools.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/blocks/test/review-tools.test.ts`:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { type Bridge, type Rpc, devLauncher, openBridge, openRpc, uiServerSpec } from "../src";

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/notes-harness/harness.config.ts");
let bridge: Bridge | undefined;
let rpc: Rpc | undefined;
let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  await rpc?.close();
  await bridge?.close();
});

async function connect(handler: (r: unknown) => Promise<unknown>) {
  bridge = await openBridge(() => {});
  rpc = await openRpc(handler);
  const spec = uiServerSpec({ harnessConfig: FIXTURE, bridge, review: { path: rpc.path, token: rpc.token }, launcher: devLauncher() });
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: spec.command, args: spec.args, env: { ...(process.env as Record<string, string>), ...spec.env } }));
  return client;
}

describe("review tools", () => {
  it("are listed with a review channel, and forward each call", async () => {
    const seen: unknown[] = [];
    const c = await connect(async (r) => {
      seen.push(r);
      return { id: "c1" };
    });
    const names = (await c.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["ask_in_document", "reply_to_comment", "read_review"]));
    const args = { path: "a.md", quote: "x", question: "Q?", options: [{ label: "A", text: "x" }, { label: "B", text: "y" }] };
    const res = await c.callTool({ name: "ask_in_document", arguments: args });
    expect(res.isError).toBeFalsy();
    expect((res.content as { text: string }[])[0].text).toBe('{"id":"c1"}');
    expect(seen).toEqual([{ op: "ask", ...args }]);
  });

  it("a refusal is a tool error with the app's message; one option still reaches the app, which says 2 to 5", async () => {
    const c = await connect(async () => {
      throw new Error("options: 2 to 5");
    });
    const res = await c.callTool({ name: "ask_in_document", arguments: { path: "a.md", quote: "x", question: "Q?", options: [{ label: "A", text: "x" }] } });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0].text).toBe("options: 2 to 5");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/blocks/test/review-tools.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the code**

In `packages/blocks/src/launch.ts`, `uiServerSpec`'s options gain:

```ts
  /** The review tools' channel (review spec §4). Absent: no review tools (D0). */
  review?: { path: string; token: string };
```

and its returned `env` adds `...(opts.review ? { HH_REVIEW_RPC: opts.review.path, HH_REVIEW_RPC_TOKEN: opts.review.token } : {})`.

In `packages/blocks/src/ui-server-bin.ts`, read the two optional variables and pass them:

```ts
  const reviewPath = process.env.HH_REVIEW_RPC;
  const reviewToken = process.env.HH_REVIEW_RPC_TOKEN;
  const server = await createUiServer(harnessConfig, { path: bridgePath, token }, reviewPath && reviewToken ? { path: reviewPath, token: reviewToken } : undefined);
```

In `packages/blocks/src/ui-server.ts`, change the imports and add:

```ts
import { allBlocks, blockToolName, loadHarness, phaseIds, z } from "@humanharness/harness-sdk";
import { RpcRefused, callRpc, sendToBridge } from "./bridge";

export const ASK_IN_DOCUMENT =
  "Asks the person about a passage of a Markdown document in their folder. `quote`: the passage's exact text; it must occur in the file (the first match is used, or the first under `heading`, a heading's slug such as `scope`). `options`: 2 to 5, each with a short `label` and the full `text` that replaces the passage when the person picks it; one option may keep the passage as it is. `blocking: true` only when the document can't be approved without an answer. The person answers in the reader; custom answers come in the next review round.";
export const REPLY_TO_COMMENT =
  "Answers a review comment or question by its `id` (c1, c2…) after a review round. `resolve: true` when it is done; `false` when you ask something back.";
export const READ_REVIEW = "Reads a document's review: the comments and questions not resolved, their answers, and whether the document is approved, or changed since it was.";

/** The review tools (spec §4): each call is a request the app answers; a refusal comes back as a tool error. */
function addReviewTools(server: McpServer, rpc: { path: string; token: string }): void {
  const call = (op: "ask" | "reply" | "read") => async (args: Record<string, unknown>) => {
    try {
      const result = await callRpc(rpc, { op, ...args });
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const text = e instanceof RpcRefused ? message : `Could not reach the app (${message}). Nothing was saved; do not retry in a loop.`;
      return { isError: true, content: [{ type: "text" as const, text }] };
    }
  };
  // Loose shapes on purpose: the app checks and answers with the spec's messages ("options: 2 to 5").
  server.registerTool(
    "ask_in_document",
    {
      description: ASK_IN_DOCUMENT,
      inputSchema: {
        path: z.string(),
        quote: z.string(),
        heading: z.string().optional(),
        question: z.string(),
        options: z.array(z.object({ label: z.string(), text: z.string() })),
        blocking: z.boolean().optional(),
      },
    },
    call("ask"),
  );
  server.registerTool("reply_to_comment", { description: REPLY_TO_COMMENT, inputSchema: { path: z.string(), id: z.string(), reply: z.string(), resolve: z.boolean() } }, call("reply"));
  server.registerTool("read_review", { description: READ_REVIEW, inputSchema: { path: z.string() } }, call("read"));
}
```

`createUiServer` gains a third parameter `review?: { path: string; token: string }` and, after the block loop, `if (review) addReviewTools(server, review);`.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/blocks`
Expected: PASS, `ui-server.test.ts` unchanged (no review channel: the same four tools, D0).

- [ ] **Step 5: Typecheck, test, commit**

```bash
git -C <worktree> add packages/blocks
git -C <worktree> commit -m "feat(blocks): ask_in_document, reply_to_comment and read_review on the ui server"
```

---

### Task 9: The runtime opens the review channel; `AGENTS.md` gains three lines

**Files:**
- Modify: `packages/runtime/src/runtime.ts`, `packages/workspace/src/instructions.ts`
- Test: `packages/runtime/test/runtime.test.ts`, `packages/workspace/test/instructions.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/workspace/test/instructions.test.ts`:

```ts
describe("writing guide: review lines (review spec §4)", () => {
  it("only with review", () => {
    const without = writingLines({ kinds: {} });
    const withReview = writingLines({ kinds: {}, review: true });
    const added = withReview.filter((l) => !without.includes(l));
    expect(added).toEqual([
      "- **Asking about a passage.** Use `ask_in_document`, and give for each option the full text that replaces the passage.",
      "- **Blocking questions.** Mark a question `blocking` only when the document can't be approved without its answer.",
      "- **Review rounds.** After a review round, answer every comment with `reply_to_comment`.",
    ]);
    expect(withReview.filter((l) => without.includes(l))).toEqual(without);
  });
});
```

Append to `packages/runtime/test/runtime.test.ts`, inside `describe("createRuntime", …)`:

```ts
  const uiEnv = (argv: string[]) =>
    (JSON.parse(argv[argv.indexOf("--mcp-config") + 1]) as { mcpServers: { ui: { env: Record<string, string> } } }).mcpServers.ui.env;

  it("with a review handler and an agent that edits the folder: review tools and guide lines (review §4)", async () => {
    const seen: unknown[] = [];
    const { runtime, folder, args } = await setup(
      {
        steps: [
          { write: { path: "spec.md", content: "## Scope\n\nBy size.\n" } },
          {
            mcp: {
              server: "ui",
              tool: "ask_in_document",
              args: { path: "spec.md", quote: "By size.", question: "Which?", options: [{ label: "A", text: "By size." }, { label: "B", text: "By colour." }] },
            },
          },
          claudeResultLine(true),
        ],
      },
      undefined,
      {
        review: async (request) => {
          seen.push(request);
          return { id: "c1" };
        },
      },
    );
    await send(runtime);
    expect(uiEnv(args()).HH_REVIEW_RPC).toBeTruthy();
    expect(seen).toEqual([expect.objectContaining({ op: "ask", path: "spec.md" })]);
    expect(fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8")).toContain("`ask_in_document`");
  });

  it("D0: no review channel without a handler, or for an agent that can't edit the folder", async () => {
    const plain = await setup({ steps: [claudeResultLine(true)] });
    await send(plain.runtime);
    expect(uiEnv(plain.args()).HH_REVIEW_RPC).toBeUndefined();
    expect(fs.readFileSync(path.join(plain.folder, "AGENTS.md"), "utf8")).not.toContain("ask_in_document");
    await plain.runtime.close();
    const readOnly = await setup({ steps: [claudeResultLine(true)] }, undefined, { harness: await loadHarness(READER), review: async () => null });
    await send(readOnly.runtime);
    expect(uiEnv(readOnly.args()).HH_REVIEW_RPC).toBeUndefined();
    expect(fs.readFileSync(path.join(readOnly.folder, "AGENTS.md"), "utf8")).not.toContain("ask_in_document");
  });
```

(`FIXTURE`, the default, is `notes-harness` with `edit: "folder"`; `READER` is `material-harness` with `edit: "none"`.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/workspace/test/instructions.test.ts packages/runtime/test/runtime.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the code**

In `packages/workspace/src/instructions.ts`:
- `WritingGuide` gains:

```ts
  /** The agent has the review tools (review spec §4): three more rules. Absent: none (D0). */
  review?: boolean;
```

- `TEXT` gains:

```ts
  reviewRules: [
    "**Asking about a passage.** Use `ask_in_document`, and give for each option the full text that replaces the passage.",
    "**Blocking questions.** Mark a question `blocking` only when the document can't be approved without its answer.",
    "**Review rounds.** After a review round, answer every comment with `reply_to_comment`.",
  ],
```

- in `writingLines`, right after `const rules = …`:

```ts
  if (writing.review) rules.push(...t.reviewRules.map((r) => `- ${r}`));
```

In `packages/runtime/src/runtime.ts`:
- `RuntimeOptions` gains:

```ts
  /**
   * Answers the agent's review tools (review spec §4) in the person's folder. Used only when the harness's agent may edit
   * the folder; absent, or `permissions.edit: "none"`: no tools and no review lines in AGENTS.md (D0).
   */
  review?: (request: unknown) => Promise<unknown>;
```

- in `createRuntime`, replace the `writing` line:

```ts
  const review = opts.review && harness.permissions.edit === "folder" ? opts.review : undefined;
  // Every harness gets the writing guide; its kinds only when it declares them (document-reader spec D4); the review
  // lines only with the review tools (review spec §4).
  const writing = { kinds: harness.documents?.kinds ?? {}, ...(review ? { review: true } : {}) };
```

- open the channel next to the others:

```ts
  let reviewRpc: Rpc | null = null;
  try {
    if (opts.data && hasAgentData(harness)) rpc = await openRpc(opts.data);
    if (material) materialRpc = await openRpc(material.request);
    if (review) reviewRpc = await openRpc(review);
    return await buildRuntime(bridge, rpc, materialRpc, reviewRpc);
  } catch (err) {
    await reviewRpc?.close().catch(() => {});
    await materialRpc?.close().catch(() => {});
    await rpc?.close().catch(() => {});
    await bridge.close().catch(() => {});
    throw err;
  }
```

- `buildRuntime(bridge, rpc, materialRpc, reviewRpc: Rpc | null)` passes `...(reviewRpc ? { review: reviewRpc } : {})` into the `uiServerSpec({ … })` call, and `close()`'s innermost `finally` becomes:

```ts
            try {
              await rpc?.close();
            } finally {
              try {
                await materialRpc?.close();
              } finally {
                await reviewRpc?.close();
              }
            }
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/workspace/test/instructions.test.ts packages/runtime/test/runtime.test.ts`
Expected: PASS; the snapshot tests of `instructions.test.ts` pass unchanged.

- [ ] **Step 5: Typecheck, test, commit**

```bash
git -C <worktree> add packages/runtime packages/workspace
git -C <worktree> commit -m "feat(runtime): review tools for agents that edit the folder, with three guide lines"
```

---

### Task 10: The person's side in main — `ReviewService`

**Files:**
- Create: `packages/shell/src/main/reviews.ts`
- Modify: `packages/ui/src/client.ts` (types only; the client methods come in Task 12)
- Test: `packages/shell/test/reviews.test.ts`

- [ ] **Step 1: Add the shared types**

In `packages/ui/src/client.ts` (types only, so main and the window agree):

```ts
import type { AnswerPick, Review, ReviewSummary } from "@humanharness/harness-sdk/review";

/** Why a review action did nothing (review spec; errors over IPC are data). */
export type ReviewRefusal =
  | "outside"
  | "missing"
  | "not-markdown"
  | "too-large"
  | "broken"
  | "not-ready"
  | "blocked"
  | "busy"
  | "unknown"
  | "not-found"
  | "bad-input"
  | "full"
  | "locked"
  | "changed"
  | "unsent"
  | "reason-required"
  | "nothing-to-send";
/** `count`: the unsent items (`unsent`) or the open blocking questions (`reason-required`). */
export type ReviewFailure = { ok: false; reason: ReviewRefusal; count?: number };
/** The reader's view of a document's review. `review` null: no record yet (§6.1 "reading only"). */
export type ReviewView = { ok: true; review: Review | null; summary: ReviewSummary } | ReviewFailure;
export type ReviewResult = { ok: true; id?: string; applied?: boolean } | ReviewFailure;
/** `to`: the round went to the task that waits ("open") or starts a "Review <title>" task ("new"). */
export type ReviewSendResult = { ok: true; sent: number; to: "open" | "new" } | ReviewFailure;
export type ApprovedText = { ok: true; text: string } | ReviewFailure;
/** A comment on a rendered selection (§5.2): the selected text, the slug of the heading above it, the comment. */
export interface CommentInput {
  selected: string;
  heading: string | null;
  text: string;
}
/** Focus mode (§6.2): on or off, and the document read. */
export interface FocusState {
  on: boolean;
  path?: string;
}
export type { AnswerPick, Review, ReviewComment, ReviewSummary } from "@humanharness/harness-sdk/review";
```

- [ ] **Step 2: Write the failing tests**

Create `packages/shell/test/reviews.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { History, ReviewLocks, loadReview, runReviewRequest } from "@humanharness/workspace";
import { type ReviewDeps, type ReviewRound, ReviewService } from "../src/main/reviews";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-review-svc-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const DOC = "specs/spec.md";
const TEXT = "---\ntitle: Filter\nkind: spec\n---\n## Scope\n\nFilter by size.\n\nThe size filter keeps.\n";

async function setup(over: Partial<ReviewDeps> = {}) {
  const base = fs.mkdtempSync(path.join(root, "f-"));
  fs.mkdirSync(path.join(base, "specs"));
  fs.writeFileSync(path.join(base, DOC), TEXT);
  const history = new History(base, `${base}.git`, [".harness/"], [".harness/reviews/"]);
  await history.init();
  await history.save("Start");
  const rounds: ReviewRound[] = [];
  const approved: unknown[] = [];
  const changed: string[] = [];
  let release!: () => void;
  const gate = { settled: Promise.resolve() as Promise<void> };
  const svc = new ReviewService({
    base: async () => base,
    history: async () => history,
    trailer: async () => ({ task: "t1", action: "ticket" }),
    openTask: async () => ({ id: "t1", scope: "main" }),
    busy: () => false,
    settled: () => gate.settled,
    blocked: () => null,
    round: async (r) => void rounds.push(r),
    approved: (a) => void approved.push(a),
    reviewTier: (kind) => (kind === "spec" ? "deep" : "standard"),
    changed: (p) => void changed.push(p),
    now: () => new Date("2026-10-28T10:00:00.000Z"),
    ...over,
  });
  // The agent asks two questions through the same service (its tools).
  const ask = (quote: string, blocking: boolean) =>
    svc.agent(base, {
      op: "ask",
      path: DOC,
      quote,
      question: `About ${quote}?`,
      options: [
        { label: "Keep", text: quote },
        { label: "Change", text: `${quote.slice(0, -1)} and colour.` },
      ],
      blocking,
    });
  const hold = () => {
    gate.settled = new Promise<void>((r) => (release = r));
    return () => release();
  };
  const read = () => fs.readFileSync(path.join(base, DOC), "utf8");
  return { svc, base, history, rounds, approved, changed, ask, hold, read };
}

describe("answers (§5.1)", () => {
  it("swap the passage, commit 'Answer: …' with the open task's trailer, and change back", async () => {
    const t = await setup();
    await t.ask("Filter by size.", true);
    expect(await t.svc.answer(DOC, "c1", 1)).toEqual({ ok: true, applied: true });
    expect(t.read()).toContain("Filter by size and colour.");
    const [top] = await t.history.list();
    expect(top).toMatchObject({ message: "Answer: specs/spec.md · About Filter by size.?", task: "t1", action: "ticket" });
    expect((await t.history.readFileAt(top.sha, DOC)) ?? "").toContain("and colour.");
    expect(await t.svc.answer(DOC, "c1", null)).toEqual({ ok: true, applied: true });
    expect(t.read()).toBe(TEXT);
    expect(t.changed).toContain(DOC);
  });

  it("wait until no turn runs", async () => {
    const t = await setup();
    await t.ask("Filter by size.", false);
    const release = t.hold();
    const pending = t.svc.answer(DOC, "c1", 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(t.read()).toBe(TEXT);
    release();
    expect(await pending).toEqual({ ok: true, applied: true });
  });

  it("are locked once approved, and unlock when the file changes", async () => {
    const t = await setup();
    await t.ask("Filter by size.", false);
    expect(await t.svc.approve(DOC)).toMatchObject({ ok: true });
    expect(await t.svc.answer(DOC, "c1", 1)).toEqual({ ok: false, reason: "locked" });
    fs.writeFileSync(path.join(t.base, DOC), `${TEXT}\nMore.\n`);
    expect(await t.svc.answer(DOC, "c1", 1)).toMatchObject({ ok: true });
  });

  it("refuse an unknown id, a bad pick, a document outside", async () => {
    const t = await setup();
    await t.ask("Filter by size.", false);
    expect(await t.svc.answer(DOC, "c9", 0)).toEqual({ ok: false, reason: "unknown" });
    expect(await t.svc.answer(DOC, "c1", 7)).toEqual({ ok: false, reason: "bad-input" });
    expect(await t.svc.answer("../x.md", "c1", 0)).toEqual({ ok: false, reason: "outside" });
  });
});

describe("comments and the batch (§5.2, §5.3)", () => {
  it("a selection becomes a draft; send builds the round, marks it sent, at the kind's tier", async () => {
    const t = await setup();
    await t.ask("Filter by size.", false);
    expect(await t.svc.comment(DOC, { selected: "The size  filter keeps.", heading: "scope", text: "No, by size and colour." })).toEqual({ ok: true, id: "c2" });
    expect(await t.svc.answer(DOC, "c1", { other: "Only in the session." })).toMatchObject({ ok: true, applied: false });
    expect(await t.svc.send(DOC)).toEqual({ ok: true, sent: 2, to: "open" });
    expect(t.rounds).toHaveLength(1);
    expect(t.rounds[0]).toMatchObject({ path: DOC, title: "Filter", task: "t1", scope: "main", tier: "deep" });
    expect(t.rounds[0].message).toContain('- c2 on "The size filter keeps." (## Scope): "No, by size and colour."');
    expect((await loadReview(t.base, DOC))?.comments.map((c) => c.state)).toEqual(["sent", "sent"]);
    expect(await t.svc.send(DOC)).toEqual({ ok: false, reason: "nothing-to-send" });
  });

  it("a selection not in the document is refused; drafts can be edited and deleted", async () => {
    const t = await setup();
    expect(await t.svc.comment(DOC, { selected: "nowhere", heading: null, text: "x" })).toEqual({ ok: false, reason: "not-found" });
    await t.svc.comment(DOC, { selected: "Filter by size.", heading: "scope", text: "x" });
    expect(await t.svc.editDraft(DOC, "c1", "y")).toEqual({ ok: true });
    expect((await loadReview(t.base, DOC))?.comments[0].text).toBe("y");
    expect(await t.svc.editDraft(DOC, "c1", null)).toEqual({ ok: true });
    expect((await loadReview(t.base, DOC))?.comments).toEqual([]);
  });

  it("refuses while a turn runs; puts the items back when the round can't start", async () => {
    const busy = await setup({ busy: () => true });
    await busy.svc.comment(DOC, { selected: "Filter by size.", heading: "scope", text: "x" });
    expect(await busy.svc.send(DOC)).toEqual({ ok: false, reason: "busy" });
    const failing = await setup({ round: async () => Promise.reject(new Error("A turn is already running")) });
    await failing.svc.comment(DOC, { selected: "Filter by size.", heading: "scope", text: "x" });
    await failing.svc.send(DOC);
    await new Promise((r) => setTimeout(r, 20));
    expect((await loadReview(failing.base, DOC))?.comments[0].state).toBe("draft");
  });

  it("the person reopens a resolved comment", async () => {
    const t = await setup();
    await t.svc.comment(DOC, { selected: "Filter by size.", heading: "scope", text: "x" });
    await runReviewRequest({ base: t.base, locks: new ReviewLocks(), task: async () => null }, { op: "reply", path: DOC, id: "c1", reply: "Done.", resolve: true });
    expect(await t.svc.reopen(DOC, "c1")).toEqual({ ok: true });
    expect((await loadReview(t.base, DOC))?.comments[0].state).toBe("draft");
  });
});

describe("approval (§5.4)", () => {
  it("asks for a reason with a blocking question open, stores it, commits, and tells the task", async () => {
    const t = await setup();
    await t.ask("Filter by size.", true);
    expect(await t.svc.approve(DOC)).toEqual({ ok: false, reason: "reason-required", count: 1 });
    expect(await t.svc.approve(DOC, { reason: "Decided on the call" })).toEqual({ ok: true });
    const r = await loadReview(t.base, DOC);
    expect(r?.approvals).toEqual([{ blob: expect.stringMatching(/^[0-9a-f]{40}$/), at: "2026-10-28T10:00:00.000Z", reason: "Decided on the call" }]);
    expect(t.approved).toEqual([{ path: DOC, task: "t1", reason: "Decided on the call" }]);
    expect(await t.svc.view(DOC)).toMatchObject({ ok: true, summary: { status: "approved" } });
    expect((await t.history.list())[0].message).toBe("Approved: specs/spec.md");
  });

  it("with unsent items it asks first; discard drops them and approves", async () => {
    const t = await setup();
    await t.svc.comment(DOC, { selected: "Filter by size.", heading: "scope", text: "x" });
    expect(await t.svc.approve(DOC)).toEqual({ ok: false, reason: "unsent", count: 1 });
    expect(await t.svc.approve(DOC, { discard: true })).toEqual({ ok: true });
    expect((await loadReview(t.base, DOC))?.comments).toEqual([]);
  });

  it("stale after a change; the approved text comes from the history; approving again appends", async () => {
    const t = await setup();
    await t.svc.approve(DOC);
    fs.writeFileSync(path.join(t.base, DOC), `${TEXT}More.\n`);
    expect(await t.svc.view(DOC)).toMatchObject({ ok: true, summary: { status: "stale" } });
    expect(await t.svc.approvedText(DOC)).toEqual({ ok: true, text: TEXT });
    await t.svc.approve(DOC);
    expect((await loadReview(t.base, DOC))?.approvals).toHaveLength(2);
  });
});

describe("summaries", () => {
  it("one per path; null without a record or when the document can't be read", async () => {
    const t = await setup();
    await t.ask("Filter by size.", true);
    expect(await t.svc.summaries([DOC, "specs/none.md", "../x.md"])).toEqual([
      { status: "draft", questions: 1, blocking: 1, unsent: 0, comments: 1 },
      null,
      null,
    ]);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `corepack pnpm vitest run packages/shell/test/reviews.test.ts`
Expected: FAIL, `Cannot find module '../src/main/reviews'`.

- [ ] **Step 4: Write the code**

Create `packages/shell/src/main/reviews.ts`:

```ts
import path from "node:path";
import { documentTitle, splitFrontMatter } from "@humanharness/harness-sdk/documents";
import {
  type AnswerPick,
  type Review,
  type ReviewComment,
  type ReviewSummary,
  type Tier,
  anchorForSelection,
  answerQuestion,
  batchMessage,
  cut,
  isUnsent,
  markSent,
  nextCommentId,
  refusedShape,
  summarizeReview,
} from "@humanharness/harness-sdk";
import type { ApprovedText, CommentInput, ReviewFailure, ReviewResult, ReviewSendResult, ReviewView } from "@humanharness/ui/client";
import {
  type HistoryTrailer,
  MAX_COMMENTS,
  ReviewLocks,
  ReviewRefused,
  blobId,
  loadReview,
  newReview,
  readOwnDocument,
  runReviewRequest,
  saveReview,
  writeOwnDocument,
} from "@humanharness/workspace";

/** A review round for the task manager (§5.3). */
export interface ReviewRound {
  path: string;
  title: string;
  message: string;
  /** The record's task (null: none). */
  task: string | null;
  scope?: string;
  tier: Tier;
}

export interface ReviewDeps {
  /** The person's folder (the active profile's); null when the app isn't set up. */
  base(): Promise<string | null>;
  history(): Promise<{ save(message: string, trailer?: HistoryTrailer): Promise<string | null>; readBlob(oid: string): Promise<string | null> } | null>;
  /** The open task's trailer: an answer's and an approval's commits belong to it (undo, §7). */
  trailer(): Promise<HistoryTrailer | undefined>;
  openTask(): Promise<{ id: string; scope: string } | null>;
  /** A turn or a task operation runs now. */
  busy(): boolean;
  /** Resolves once no turn runs (§5.1 "writes during a turn"). */
  settled(): Promise<void>;
  /** Why writes can't run now (a restore, a folder move, quitting), or null. */
  blocked(): string | null;
  /** Starts the round (task manager); it may run a whole turn. */
  round(r: ReviewRound): Promise<unknown>;
  /** The approval is saved and committed (§5.4): the task manager's part. */
  approved(a: { path: string; task: string | null; reason?: string }): void;
  /** The tier of a "Review <title>" task for a document of `kind` (§11.3). */
  reviewTier(kind: string | undefined): Tier;
  /** A record changed: the window draws it again. */
  changed(path: string): void;
  now?(): Date;
}

/** At most this many paths per `summaries` call. */
export const MAX_SUMMARY_PATHS = 200;

type Doc = { base: string; doc: string; text: string; bytes: Buffer; review: Review | null };

const isPick = (p: unknown): p is AnswerPick =>
  p === null || (typeof p === "number" && Number.isInteger(p) && p >= 0 && p <= 4) || (typeof p === "object" && p !== null && typeof (p as { other?: unknown }).other === "string");

/** Drafts go; "Other" and unapplied answers go back to no answer (§5.4 "Discard and approve"). */
function discardUnsent(comments: ReviewComment[]): ReviewComment[] {
  return comments
    .filter((c) => c.state !== "draft")
    .map((c) => {
      if (!isUnsent(c)) return c;
      const { answer: _a, unapplied: _u, ...rest } = c;
      return { ...rest, state: "open" as const };
    });
}

/**
 * The person's side of document reviews (§5): answers, comments, rounds, approval. Every result is data. Every write
 * holds the document's lock (shared with the agent's tools); an answer or an approval first waits until no turn runs,
 * then commits on its own with the open task's trailer.
 */
export class ReviewService {
  private readonly locks = new ReviewLocks();

  constructor(private readonly d: ReviewDeps) {}

  private at(): string {
    return (this.d.now?.() ?? new Date()).toISOString();
  }

  /** The agent's tools (§4), in the folder its runtime runs in. Refusals throw: the rpc turns them into tool errors. */
  agent(base: string, request: unknown): Promise<unknown> {
    return runReviewRequest({ base, locks: this.locks, task: () => this.d.openTask(), changed: (p) => this.d.changed(p), ...(this.d.now ? { now: this.d.now } : {}) }, request);
  }

  /** Reads the document and its record under its lock, then runs `fn`. Refusals and failures become data. */
  private async withDoc<T extends { ok: boolean }>(rel: unknown, fn: (x: Doc) => Promise<T | ReviewFailure>): Promise<T | ReviewFailure> {
    try {
      if (typeof rel !== "string" || refusedShape(rel)) return { ok: false, reason: "outside" };
      const doc = path.posix.normalize(rel);
      const base = await this.d.base();
      if (!base) return { ok: false, reason: "not-ready" };
      return await this.locks.run(doc, async () => {
        const read = await readOwnDocument(base, doc);
        if (!read.ok) return { ok: false, reason: read.reason } as ReviewFailure;
        return fn({ base, doc, text: read.text, bytes: read.bytes, review: await loadReview(base, doc) });
      });
    } catch (err) {
      if (err instanceof ReviewRefused) return { ok: false, reason: err.reason === "not-found" ? "not-found" : err.reason };
      console.error("A review action failed", err);
      return { ok: false, reason: "not-ready" };
    }
  }

  private async commit(message: string): Promise<void> {
    const history = await this.d.history();
    await history?.save(message, await this.d.trailer());
  }

  view(rel: unknown): Promise<ReviewView> {
    return this.withDoc(rel, async ({ bytes, review }) => ({ ok: true as const, review, summary: summarizeReview(review, blobId(bytes)) }));
  }

  /** One summary per path (the chat's chips, harness views); null without a record or when it can't be read. */
  async summaries(paths: unknown): Promise<(ReviewSummary | null)[]> {
    if (!Array.isArray(paths)) return [];
    if (paths.length > MAX_SUMMARY_PATHS) return paths.map(() => null);
    return Promise.all(
      paths.map(async (p) => {
        const v = await this.view(p);
        return v.ok && v.review ? v.summary : null;
      }),
    );
  }

  /** An answer (§5.1): waits for the turn, swaps under the guard, commits `Answer: <path> · <question>`. */
  async answer(rel: unknown, id: unknown, pick: unknown): Promise<ReviewResult> {
    if (this.d.blocked()) return { ok: false, reason: "blocked" };
    if (typeof id !== "string" || !isPick(pick)) return { ok: false, reason: "bad-input" };
    await this.d.settled();
    return this.withDoc(rel, async ({ base, doc, text, bytes, review }) => {
      const c = review?.comments.find((x) => x.id === id);
      if (!review || !c) return { ok: false, reason: "unknown" };
      if (summarizeReview(review, blobId(bytes)).status === "approved") return { ok: false, reason: "locked" };
      const r = answerQuestion(text, c, pick);
      if (!r.ok) return { ok: false, reason: "bad-input" };
      if (r.text !== null && r.text !== text) {
        const w = await writeOwnDocument(base, doc, bytes, r.text);
        if (!w.ok) return { ok: false, reason: w.reason };
      }
      await saveReview(base, { ...review, comments: review.comments.map((x) => (x.id === c.id ? r.comment : x)) });
      await this.commit(`Answer: ${doc} · ${cut(c.text, 60)}`);
      this.d.changed(doc);
      return { ok: true, applied: r.text !== null };
    });
  }

  /** A comment on a rendered selection (§5.2): a draft. */
  comment(rel: unknown, input: unknown): Promise<ReviewResult> {
    const i = (input ?? {}) as Partial<CommentInput>;
    if (typeof i.selected !== "string" || i.selected.length > 20_000 || (i.heading !== null && typeof i.heading !== "string") || typeof i.text !== "string" || !i.text.trim() || i.text.length > 4000)
      return Promise.resolve({ ok: false, reason: "bad-input" });
    const { selected, heading, text: words } = i as CommentInput;
    return this.withDoc(rel, async ({ base, doc, text, review }) => {
      const anchor = anchorForSelection(text, selected, heading);
      if (!anchor) return { ok: false, reason: "not-found" };
      const r = review ?? newReview(doc, await this.d.openTask());
      if (r.comments.length >= MAX_COMMENTS) return { ok: false, reason: "full" };
      const id = nextCommentId(r);
      const comment: ReviewComment = { id, author: "person", kind: "comment", anchor, text: words.trim(), state: "draft", replies: [], at: this.at() };
      await saveReview(base, { ...r, comments: [...r.comments, comment] });
      this.d.changed(doc);
      return { ok: true, id };
    });
  }

  /** Edits a draft, or deletes it with null. Only the person's drafts. */
  editDraft(rel: unknown, id: unknown, text: unknown): Promise<ReviewResult> {
    if (typeof id !== "string" || (text !== null && (typeof text !== "string" || !text.trim() || text.length > 4000))) return Promise.resolve({ ok: false, reason: "bad-input" });
    return this.withDoc(rel, async ({ base, doc, review }) => {
      const c = review?.comments.find((x) => x.id === id);
      if (!review || !c || c.author !== "person" || c.state !== "draft") return { ok: false, reason: "unknown" };
      const comments = text === null ? review.comments.filter((x) => x.id !== id) : review.comments.map((x) => (x.id === id ? { ...x, text: (text as string).trim() } : x));
      await saveReview(base, { ...review, comments });
      this.d.changed(doc);
      return { ok: true };
    });
  }

  /** The person reopens a resolved comment (§11.2): a comment goes back to draft (the next round carries it), a question to open. */
  reopen(rel: unknown, id: unknown): Promise<ReviewResult> {
    return this.withDoc(rel, async ({ base, doc, review }) => {
      const c = review?.comments.find((x) => x.id === id);
      if (!review || !c || c.state !== "resolved") return { ok: false, reason: "unknown" };
      const state = c.kind === "comment" ? ("draft" as const) : c.answer ? ("answered" as const) : ("open" as const);
      await saveReview(base, { ...review, comments: review.comments.map((x) => (x.id === c.id ? { ...x, state } : x)) });
      this.d.changed(doc);
      return { ok: true };
    });
  }

  /** "Send comments (N)" (§5.3): marks the items sent, then starts the round; when it can't start, they go back. */
  async send(rel: unknown): Promise<ReviewSendResult> {
    if (this.d.blocked()) return { ok: false, reason: "blocked" };
    if (this.d.busy()) return { ok: false, reason: "busy" };
    let ids: string[] = [];
    let before: Review | null = null;
    let round: ReviewRound | null = null;
    const prepared = await this.withDoc(rel, async ({ base, doc, text, review }) => {
      const b = review ? batchMessage(doc, review, text) : null;
      if (!review || !b) return { ok: false, reason: "nothing-to-send" } as ReviewFailure;
      await saveReview(base, markSent(review, b.ids));
      this.d.changed(doc);
      ids = b.ids;
      before = review;
      const kind = splitFrontMatter(text).data.kind?.trim();
      round = { path: doc, title: documentTitle(doc, text), message: b.message, task: review.task, ...(review.scope ? { scope: review.scope } : {}), tier: this.d.reviewTier(kind) };
      return { ok: true as const };
    });
    if (!prepared.ok || !round) return prepared as ReviewFailure;
    const r: ReviewRound = round;
    const to = (await this.d.openTask()) ? ("open" as const) : ("new" as const);
    void this.d.round(r).catch(async (err: unknown) => {
      console.error("The review round could not start", err);
      await this.unsend(r.path, ids, before!);
    });
    return { ok: true, sent: ids.length, to };
  }

  /** The round never started: its items go back to what they were. */
  private async unsend(doc: string, ids: string[], before: Review): Promise<void> {
    await this.withDoc(doc, async ({ base, review }) => {
      if (!review) return { ok: true as const };
      const was = new Map(before.comments.map((c) => [c.id, c.state]));
      const comments = review.comments.map((c) => (ids.includes(c.id) && c.state === "sent" ? { ...c, state: was.get(c.id) ?? c.state } : c));
      await saveReview(base, { ...review, comments });
      this.d.changed(doc);
      return { ok: true as const };
    });
  }

  /** "Approve" (§5.4): appends `{ blob, at, reason? }`, commits `Approved: <path>`, tells the task manager. */
  async approve(rel: unknown, opts: unknown = {}): Promise<ReviewResult> {
    if (this.d.blocked()) return { ok: false, reason: "blocked" };
    const o = (opts ?? {}) as { reason?: unknown; discard?: unknown };
    if (o.reason !== undefined && (typeof o.reason !== "string" || o.reason.length > 500)) return { ok: false, reason: "bad-input" };
    const reason = typeof o.reason === "string" && o.reason.trim() ? o.reason.trim().split("\n").join(" ") : undefined;
    await this.d.settled();
    let told: { path: string; task: string | null; reason?: string } | null = null;
    const r = await this.withDoc(rel, async ({ base, doc, bytes, review }) => {
      const record = review ?? newReview(doc, await this.d.openTask());
      const blob = blobId(bytes);
      if (summarizeReview(record, blob).status === "approved") return { ok: true as const };
      const unsent = record.comments.filter(isUnsent).length;
      if (unsent > 0 && o.discard !== true) return { ok: false, reason: "unsent", count: unsent };
      const comments = o.discard === true ? discardUnsent(record.comments) : record.comments;
      const blocking = summarizeReview({ ...record, comments }, blob).blocking;
      if (blocking > 0 && !reason) return { ok: false, reason: "reason-required", count: blocking };
      const approval = { blob, at: this.at(), ...(reason ? { reason } : {}) };
      await saveReview(base, { ...record, comments, approvals: [...record.approvals, approval].slice(-200) });
      await this.commit(`Approved: ${doc}`);
      this.d.changed(doc);
      told = { path: doc, task: record.task, ...(reason ? { reason } : {}) };
      return { ok: true as const };
    });
    if (told) this.d.approved(told);
    return r;
  }

  /** The last approved version's text (§5.4 "See what changed"), read from the history by its blob id. */
  approvedText(rel: unknown): Promise<ApprovedText> {
    return this.withDoc(rel, async ({ review }) => {
      const blob = review?.approvals.at(-1)?.blob;
      const history = blob ? await this.d.history() : null;
      const text = blob && history ? await history.readBlob(blob) : null;
      return text === null ? { ok: false, reason: "missing" } : { ok: true as const, text };
    });
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/reviews.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, test, commit**

```bash
git -C <worktree> add packages/shell/src/main/reviews.ts packages/shell/test/reviews.test.ts packages/ui/src/client.ts
git -C <worktree> commit -m "feat(shell): the person's side of reviews: answers, comments, rounds, approval"
```

---

### Task 11: Tasks — review rounds, the approval line, the phase's `approve`

**Files:**
- Modify: `packages/shell/src/main/task-store.ts`, `packages/shell/src/main/task-manager.ts`, `packages/shell/src/main/task-prompts.ts`
- Create: `packages/shell/test/task-manager-fixture.ts` (the `setup` of `task-manager-phases.test.ts`, moved)
- Modify: `packages/shell/test/task-manager-phases.test.ts` (imports `setup` from the fixture)
- Test: `packages/shell/test/task-manager-review.test.ts`, `packages/shell/test/task-store.test.ts` (append)

- [ ] **Step 1: Move the phases test's `setup` into a fixture**

Move `setup` (and the constants it uses: `ok`, `NOW`, `PHASES`, `brief`, `profile`) from `packages/shell/test/task-manager-phases.test.ts` into a new `packages/shell/test/task-manager-fixture.ts`, exported. Make `profileFor` record its arguments:

```ts
    profileFor: async (...args) => {
      profileCalls.push(args);
      return profile;
    },
```

with `const profileCalls: unknown[][] = [];` in `setup` and `profileCalls` in its returned object. `task-manager-phases.test.ts` imports what it used from the fixture. Run `corepack pnpm vitest run packages/shell/test/task-manager-phases.test.ts`: still PASS.

- [ ] **Step 2: Write the failing tests**

Create `packages/shell/test/task-manager-review.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Event } from "@humanharness/runtime";
import { REVIEW_PROMPT } from "../src/main/task-prompts";
import { setup } from "./task-manager-fixture";

const ok: Event = { type: "done", ok: true };
const SPEC_PHASES = [
  { id: "spec", label: "Spec", brief: "phases/spec.md", approve: "specs/*.md" },
  { id: "plan", label: "Plan", brief: "phases/plan.md" },
];

describe("review rounds (review spec §5.3)", () => {
  it("go to the waiting task as the person's message", async () => {
    const t = setup();
    await t.manager.start("quiz");
    expect(await t.manager.reviewRound({ path: "specs/a.md", title: "A", message: "Review round for specs/a.md.", tier: "standard" })).toBe("open");
    expect(t.turns.at(-1)?.message).toBe("Review round for specs/a.md.");
    expect(t.turns.at(-1)?.options).toMatchObject({ task: "t1", followUp: true });
  });

  it("with no task, start a core 'Review <title>' task at the given tier", async () => {
    const t = setup();
    expect(await t.manager.reviewRound({ path: "specs/a.md", title: "A", message: "Review round for specs/a.md.", tier: "deep" })).toBe("new");
    expect(t.state().current).toMatchObject({ id: "t1", review: "specs/a.md", question: "Review A\n\nReview round for specs/a.md." });
    expect(t.turns[0].message).toContain("Review round for specs/a.md.");
    expect(t.turns[0].message).toContain("read_review");
    expect(t.profileCalls.at(-1)).toEqual([undefined, undefined, "deep"]);
    expect(REVIEW_PROMPT).toContain("{{question}}");
  });
});

describe("approval (review spec §5.4, §5.5)", () => {
  it("leaves a line for the document's task's next message", async () => {
    const t = setup();
    await t.manager.start("quiz");
    await t.manager.documentApproved({ path: "specs/a.md", task: "t1", reason: "Decided on the call" });
    expect(t.state().current?.notices).toEqual(["The person approved specs/a.md, with reason: Decided on the call."]);
    await t.manager.ask("Next?");
    expect(t.turns.at(-1)?.message).toBe("The person approved specs/a.md, with reason: Decided on the call.\n\nNext?");
    expect(t.turns.at(-1)?.options.display).toBe("Next?");
    expect(t.state().current?.notices).toBeUndefined();
  });

  it("another task's document leaves no line", async () => {
    const t = setup();
    await t.manager.start("quiz");
    await t.manager.documentApproved({ path: "specs/a.md", task: "other" });
    expect(t.state().current?.notices).toBeUndefined();
  });

  it("moves the task on when its phase's approve glob matches, carrying the line in the change message", async () => {
    const t = setup({ phases: SPEC_PHASES, script: [[ok], [ok]] });
    await t.manager.start("session");
    await t.manager.documentApproved({ path: "specs/a.md", task: "t1" });
    expect(t.state().current).toMatchObject({ phase: { id: "plan" }, phases: [{ id: "spec" }, { id: "plan", by: "person" }] });
    expect(t.turns.at(-1)?.message.startsWith("The person approved specs/a.md.\n\n")).toBe(true);
    expect(t.turns.at(-1)?.options).toMatchObject({ phase: "phase-change", phaseChange: "plan" });
  });

  it("no move for a path the glob doesn't match, nor in the last phase", async () => {
    const t = setup({ phases: SPEC_PHASES });
    await t.manager.start("session");
    await t.manager.documentApproved({ path: "notes/a.md", task: "t1" });
    expect(t.state().current?.phase?.id).toBe("spec");
  });
});
```

Append to `packages/shell/test/task-store.test.ts` (it has `tmp()` and the `waiting` file):

```ts
describe("review fields (review spec §5.3, §5.4)", () => {
  const load = async (current: Record<string, unknown>) => {
    const folder = tmp();
    fs.mkdirSync(path.join(folder, ".harness"));
    fs.writeFileSync(path.join(folder, ".harness", "tasks.json"), JSON.stringify({ ...waiting, current: { ...waiting.current, ...current } }));
    return (await new TaskStore(folder).load()).current;
  };

  it("keeps a review task's path and drops one that leaves the folder", async () => {
    expect((await load({ review: "specs/a.md" }))?.review).toBe("specs/a.md");
    expect((await load({ review: "../x.md" }))?.review).toBeUndefined();
  });

  it("keeps the notices that are strings, the last 10, each cut to 600", async () => {
    const many = ["a", 3, "", ...Array.from({ length: 12 }, (_, i) => `n${i}`), "x".repeat(700)];
    const notices = (await load({ notices: many }))?.notices ?? [];
    expect(notices).toHaveLength(10);
    expect(notices[0]).toBe("n3");
    expect(notices.at(-1)).toBe("x".repeat(600));
    expect((await load({ notices: "nope" }))?.notices).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-review.test.ts packages/shell/test/task-store.test.ts`
Expected: FAIL.

- [ ] **Step 4: Write the code**

`packages/shell/src/main/task-store.ts`:

```ts
/** How many lines for the next message a task keeps (review spec §5.4): a bound on a hand-edited file. */
export const NOTICES_MAX = 10;
```

`CurrentTask` gains:

```ts
  /** A core "Review <title>" task: the document it reviews (review spec §5.3). */
  review?: string;
  /** Lines the app puts before the task's next message (review spec §5.4 "the document's task is told"). */
  notices?: string[];
```

`cleanCurrent` gains (import `refusedShape` from `@humanharness/harness-sdk`):

```ts
  const notices = Array.isArray(c.notices) ? c.notices.filter((n): n is string => typeof n === "string" && n.length > 0).map((n) => n.slice(0, 600)).slice(-NOTICES_MAX) : [];
```

and in the returned object:

```ts
    ...(typeof c.review === "string" && !refusedShape(c.review) ? { review: c.review } : {}),
    ...(notices.length > 0 ? { notices } : {}),
```

`packages/shell/src/main/task-prompts.ts`:

```ts
/** The first message of a core "Review <title>" task (review spec §5.3). */
export const REVIEW_PROMPT = [
  "The person is reviewing a document and sent you a review round. Answer in {{language}}.",
  "Edit the document for each item, then answer every item with `reply_to_comment` (resolve it when it is done). Call `read_review` for the rest of the review: open questions, answers and approval.",
  "",
  "{{notesIndex}}",
  "",
  "## Review round",
  "{{question}}",
].join("\n");
```

`packages/shell/src/main/task-manager.ts`:
- import `REVIEW_PROMPT`; `NOTICES_MAX` from `./task-store`; `matchGlob` from `@humanharness/harness-sdk`; `isScopeDir` is already imported from `@humanharness/workspace`.
- `TaskDeps.profileFor` becomes `profileFor?(action: string | undefined, floor?: Tier, tier?: Tier): Promise<ModelProfile>;` with the doc line "`tier`: a core review task's tier (review spec §11.3)".
- `begin`'s `task` parameter type gains `review?: string`, and a sixth parameter `tier?: Tier`; the profile line becomes:

```ts
    const profile = await this.d.profileFor?.(task.action, floor, tier);
```

  (keep the existing call shape when both are undefined: `profileFor(action)` and `profileFor(action, floor)` callers in tests compare arguments; if a test asserts `toHaveBeenCalledWith(action)` exactly, pass only the defined arguments: `floor !== undefined || tier !== undefined ? this.d.profileFor?.(task.action, floor, tier) : this.d.profileFor?.(task.action)`.)
- a helper:

```ts
  /** The lines kept for the task's next message, before `text`, and the state without them (review spec §5.4). */
  private async withNotices(c: CurrentTask, text: string): Promise<string> {
    const notes = c.notices ?? [];
    if (notes.length === 0) return text;
    await this.update((s) => {
      if (s.current?.id !== c.id) return s;
      const { notices: _n, ...rest } = s.current;
      return { ...s, current: rest };
    });
    return `${notes.join("\n")}\n\n${text}`;
  }
```

- `askNow`, in the waiting branch, before the resume line:

```ts
      const hasNotices = (c.notices?.length ?? 0) > 0;
      const said = await this.withNotices(c, text);
      const message = c.resume ? await this.resumeMessageFor(c, said) : said;
```

  and the options' display condition becomes `display || c.resume || hasNotices`.
- `enterPhase`, right before `this.runTurn(now, plan.message, …)`: `const message = await this.withNotices(now, plan.message);` and pass `message`.
- two public methods, after `setPhase`:

```ts
  /**
   * A review round (review spec §5.3): to the task that waits, as the person's message; with no task open, a new core
   * "Review <title>" task in the record's scope (the open scope without one) at `r.tier`. Refused while a turn runs.
   */
  reviewRound(r: { path: string; title: string; message: string; scope?: string; tier: Tier }): Promise<"open" | "new"> {
    return this.op(async () => {
      const c = await this.storedCurrent();
      if (c?.status === "waiting") {
        await this.askNow(r.message);
        return "open" as const;
      }
      if (c) throw new Error("A turn is already running");
      const state = await this.d.store.load();
      const scope = this.d.scoped && r.scope !== undefined && isScopeDir(r.scope) ? r.scope : this.scopeFor(state, undefined);
      const language = await this.d.language();
      await this.begin(
        { ...keptQuestion(`Review ${oneLine(r.title)}\n\n${r.message}`), review: r.path },
        scope,
        (notesIndex) => fillPrompt(REVIEW_PROMPT, { language, notesIndex, question: r.message }),
        r.message,
        undefined,
        r.tier,
      );
      return "new" as const;
    });
  }

  /**
   * The person approved `a.path` (review spec §5.4). The document's task, when it is the open one, gets a line before its
   * next message. When the open task's current phase has an `approve` glob matching the path, the task moves to its next
   * phase as if the person had picked it (§5.5); a stale document never moves it back.
   */
  async documentApproved(a: { path: string; task: string | null; reason?: string }): Promise<void> {
    const c = await this.storedCurrent();
    if (!c) return;
    if (a.task === c.id) {
      const line = `The person approved ${a.path}${a.reason ? `, with reason: ${oneLine(a.reason)}` : ""}.`;
      await this.update((s) => (s.current?.id === c.id ? { ...s, current: { ...s.current, notices: [...(s.current.notices ?? []), line].slice(-NOTICES_MAX) } } : s));
    }
    const phases = this.phasesOf(c.action);
    const here = phases.findIndex((p) => p.id === c.phase?.id);
    const glob = here >= 0 ? phases[here].approve : undefined;
    if (!glob || !matchGlob(glob, a.path) || here + 1 >= phases.length || c.status !== "waiting") return;
    const { accepted, done } = this.setPhase(phases[here + 1].id, c.id);
    accepted.catch(() => undefined);
    await done.catch((err: unknown) => console.error("The approval could not move the task on", err));
  }
```

`storedCurrent`, `scopeFor`, `keptQuestion`, `fillPrompt` and `oneLine` already exist in or are imported by `task-manager.ts`.

In `packages/shell/src/main/index.ts`, `profileFor: async (action, floor, tier) => { … const manifestTier = tier ?? (action !== undefined ? harness.actions[action]?.tier : harness.questions?.tier); … }`.

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test`
Expected: PASS, every existing task-manager test unchanged (no notices, no review: D0).

- [ ] **Step 6: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`. Expected: green.

```bash
git -C <worktree> add packages/shell
git -C <worktree> commit -m "feat(shell): review rounds, the approval line and approve on phases"
```

---

### Task 12: IPC, preload, client and the fake client

**Files:**
- Modify: `packages/shell/src/main/index.ts`, `packages/shell/src/preload/index.ts`
- Modify: `packages/ui/src/client.ts`, `packages/ui/src/index.ts`
- Modify: `packages/ui/test/fake-client.ts`, `packages/ui/test/document-reader.test.tsx`, `packages/ui/test/document-cards.test.tsx`, `packages/ui/test/client.test.ts`
- Test: `packages/ui/test/client.test.ts` (append)

- [ ] **Step 1: Rename the fake client's document texts**

`FakeClient.documents` (a `Record<string, string>`) becomes `docTexts`, so `documents` can be the client's review namespace. Replace `client.documents` / `this.documents` / `c.documents` with `docTexts` in `fake-client.ts`, `document-reader.test.tsx`, `document-cards.test.tsx` and `client.test.ts` (7 places). Run `corepack pnpm vitest run packages/ui`: PASS.

- [ ] **Step 2: Write the failing test**

Append to `packages/ui/test/client.test.ts`:

```ts
describe("documents and focus (review spec §5.6)", () => {
  it("the fake answers like main: a view, a summary, results as data, and change and focus listeners", async () => {
    const c = new FakeClient();
    c.docTexts["specs/a.md"] = "## Scope\n\nBy size.\n";
    expect(await c.documents.view("specs/a.md")).toMatchObject({ ok: true, review: null, summary: { status: "none" } });
    expect(await c.documents.review("specs/a.md")).toBeNull();
    const changed: string[] = [];
    const off = c.documents.onChange((p) => changed.push(p));
    expect(await c.documents.comment("specs/a.md", { selected: "By size.", heading: "scope", text: "No" })).toEqual({ ok: true, id: "c1" });
    expect(changed).toEqual(["specs/a.md"]);
    off();
    expect(await c.documents.review("specs/a.md")).toMatchObject({ status: "draft", unsent: 1 });
    const seen: unknown[] = [];
    c.focus.onChange((s) => seen.push(s));
    c.focus.set({ on: true, path: "specs/a.md" });
    expect(c.focus.current()).toEqual({ on: true, path: "specs/a.md" });
    expect(seen).toEqual([{ on: true, path: "specs/a.md" }]);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `corepack pnpm vitest run packages/ui/test/client.test.ts`
Expected: FAIL.

- [ ] **Step 4: Write the code**

`packages/ui/src/client.ts`:
- `AppState` gains:

```ts
  /** The harness's agent may edit the folder: documents can be reviewed (review spec). Absent: no review UI (D0). */
  review?: true;
```

- `HarnessClient` gains:

```ts
  /** Document reviews (review spec §5.6). Calls answer with data; only useful when `AppState.review` is set. */
  documents: {
    /** The record and summary, for the reader. */
    view(path: string): Promise<ReviewView>;
    /** A harness view's summary of one document; null without a record or when it can't be read. */
    review(path: string): Promise<ReviewSummary | null>;
    summaries(paths: string[]): Promise<(ReviewSummary | null)[]>;
    answer(path: string, id: string, pick: AnswerPick): Promise<ReviewResult>;
    comment(path: string, input: CommentInput): Promise<ReviewResult>;
    /** Edits a draft, or deletes it with null. */
    editDraft(path: string, id: string, text: string | null): Promise<ReviewResult>;
    reopen(path: string, id: string): Promise<ReviewResult>;
    send(path: string): Promise<ReviewSendResult>;
    approve(path: string, reason?: string, opts?: { discard?: boolean }): Promise<ReviewResult>;
    approvedText(path: string): Promise<ApprovedText>;
    /** Any review record or approval changed (`path`: its document). Returns the unsubscribe. */
    onChange(listener: (path: string) => void): () => void;
    /** Opens the document in the reader in focus mode (§6.2). */
    focus(path: string): void;
    /** Every `focus(path)`, whoever called it: the chat listens. */
    onFocus(listener: (path: string) => void): () => void;
  };
  /** Focus mode (§6.2): the chat sets it; a harness view listens to pause its own interruptions. */
  focus: {
    current(): FocusState;
    onChange(listener: (state: FocusState) => void): () => void;
    /** The core's chat only. */
    set(state: FocusState): void;
  };
```

`packages/shell/src/preload/index.ts`, next to `documentOpeners`:

```ts
/** Told of every `documents.focus(path)` (review spec §6.2). */
const focusOpeners = new Set<(path: string) => void>();
/** Focus mode as the chat set it last, and who listens. */
let focusState: FocusState = { on: false };
const focusListeners = new Set<(state: FocusState) => void>();
```

and in the client object:

```ts
  documents: {
    view: (file) => ipcRenderer.invoke("hh:reviewView", file),
    review: async (file) => ((await ipcRenderer.invoke("hh:reviewSummaries", [file])) as (ReviewSummary | null)[])[0] ?? null,
    summaries: (paths) => ipcRenderer.invoke("hh:reviewSummaries", paths),
    answer: (file, id, pick) => ipcRenderer.invoke("hh:reviewAnswer", file, id, pick),
    comment: (file, input) => ipcRenderer.invoke("hh:reviewComment", file, input),
    editDraft: (file, id, text) => ipcRenderer.invoke("hh:reviewEditDraft", file, id, text),
    reopen: (file, id) => ipcRenderer.invoke("hh:reviewReopen", file, id),
    send: (file) => ipcRenderer.invoke("hh:reviewSend", file),
    approve: (file, reason, opts) => ipcRenderer.invoke("hh:reviewApprove", file, { ...(reason !== undefined ? { reason } : {}), ...(opts?.discard ? { discard: true } : {}) }),
    approvedText: (file) => ipcRenderer.invoke("hh:reviewApprovedText", file),
    onChange: (listener) => subscribe<string>("hh:reviewChanged", listener),
    focus: (file) => {
      for (const l of [...focusOpeners]) l(file);
    },
    onFocus: (listener) => {
      focusOpeners.add(listener);
      return () => void focusOpeners.delete(listener);
    },
  },
  focus: {
    current: () => focusState,
    onChange: (listener) => {
      focusListeners.add(listener);
      return () => void focusListeners.delete(listener);
    },
    set: (state) => {
      focusState = { on: state.on === true, ...(typeof state.path === "string" ? { path: state.path } : {}) };
      for (const l of [...focusListeners]) l(focusState);
    },
  },
```

`packages/shell/src/main/index.ts`:
- import `ReviewService` from `./reviews`.
- after `personData`:

```ts
/** Document reviews (review spec): the person's side, and the agent's tools for each runtime's folder. */
const reviews = new ReviewService({
  base: async () => {
    const c = await validConfig();
    return c ? baseOf(c) : null;
  },
  history: () => currentHistory(),
  trailer: () => tasks.trailerNow(),
  openTask: async () => {
    const t = await tasks.runningTask();
    return t ? { id: t.id, scope: t.scope } : null;
  },
  busy: () => tasks.isBusy(),
  settled: () => tasks.whenSettled(async () => undefined),
  blocked: () => (quitting ? "The app is closing" : turnBlocked()),
  round: (r) => tasks.reviewRound(r),
  approved: (a) => void tasks.documentApproved(a).catch((err: unknown) => console.error("Could not act on the approval", err)),
  reviewTier: (kind) => (kind !== undefined && harness.documents?.kinds[kind]?.reviewTier) || "standard",
  changed: (p) => sendToWindow("hh:reviewChanged", p),
});
```

- in `createRuntime({ … })`: `...(harness.permissions.edit === "folder" ? { review: (request: unknown) => reviews.agent(base, request) } : {}),`.
- in the `AppState` builder, next to `documents`: `...(harness.permissions.edit === "folder" ? { review: true as const } : {}),`.
- the handlers, after `hh:unwatchDocument` (each already answers data; a throw would be a bug, so wrap like `hh:readDocument` does):

```ts
  // Reviews (review spec): every answer is data; the service checks every input.
  const reviewCall = <T>(fn: () => Promise<T>, fallback: T) => fn().catch((err: unknown) => (console.error("Review call failed", err), fallback));
  const notReady = { ok: false as const, reason: "not-ready" as const };
  handle("hh:reviewView", (file: unknown) => reviewCall(() => reviews.view(file), notReady));
  handle("hh:reviewSummaries", (paths: unknown) => reviewCall(() => reviews.summaries(paths), [] as (ReviewSummary | null)[]));
  handle("hh:reviewAnswer", (file: unknown, id: unknown, pick: unknown) => reviewCall(() => reviews.answer(file, id, pick), notReady));
  handle("hh:reviewComment", (file: unknown, input: unknown) => reviewCall(() => reviews.comment(file, input), notReady));
  handle("hh:reviewEditDraft", (file: unknown, id: unknown, text: unknown) => reviewCall(() => reviews.editDraft(file, id, text), notReady));
  handle("hh:reviewReopen", (file: unknown, id: unknown) => reviewCall(() => reviews.reopen(file, id), notReady));
  handle("hh:reviewSend", (file: unknown) => reviewCall(() => reviews.send(file), notReady));
  handle("hh:reviewApprove", (file: unknown, opts: unknown) => reviewCall(() => reviews.approve(file, opts), notReady));
  handle("hh:reviewApprovedText", (file: unknown) => reviewCall(() => reviews.approvedText(file), notReady));
```

`packages/ui/test/fake-client.ts` (import `anchorForSelection`, `answerQuestion`, `summarizeReview`, `nextCommentId` from `@humanharness/harness-sdk/review`):

```ts
  /** Review records by document path; the fake's `documents` answers from here like main. */
  reviews: Record<string, Review> = {};
  /** Every review call, in order. */
  reviewCalls: { op: string; args: unknown[] }[] = [];
  /** What `send` and `approve` answer when set (else they act like main, roughly). */
  sendResult: ReviewSendResult | null = null;
  approveResult: ReviewResult | null = null;
  approvedTexts: Record<string, string> = {};
  private reviewListeners = new Set<(path: string) => void>();
  private focusOpeners = new Set<(path: string) => void>();
  private focusListeners = new Set<(s: FocusState) => void>();
  private focusState: FocusState = { on: false };
  /** Tells every `documents.onChange` listener, as main does after a change. */
  emitReviewChanged(path: string) {
    for (const l of [...this.reviewListeners]) l(path);
  }
  /** The current blob id by path; absent: the last approval's (so an approved record reads as approved). */
  currentBlobs: Record<string, string> = {};
  private summaryOf(path: string): ReviewSummary {
    return summarizeReview(this.reviews[path] ?? null, this.currentBlobs[path] ?? this.reviews[path]?.approvals.at(-1)?.blob ?? null);
  }
  documents: HarnessClient["documents"] = {
    view: async (path) => {
      this.reviewCalls.push({ op: "view", args: [path] });
      if (!Object.hasOwn(this.docTexts, path)) return { ok: false, reason: "missing" };
      return { ok: true, review: this.reviews[path] ?? null, summary: this.summaryOf(path) };
    },
    review: async (path) => (this.reviews[path] ? this.summaryOf(path) : null),
    summaries: async (paths) => {
      this.reviewCalls.push({ op: "summaries", args: [paths] });
      return paths.map((p) => (this.reviews[p] ? this.summaryOf(p) : null));
    },
    answer: async (path, id, pick) => {
      this.reviewCalls.push({ op: "answer", args: [path, id, pick] });
      const r = this.reviews[path];
      const c = r?.comments.find((x) => x.id === id);
      if (!r || !c) return { ok: false, reason: "unknown" };
      const a = answerQuestion(this.docTexts[path], c, pick);
      if (!a.ok) return { ok: false, reason: "bad-input" };
      if (a.text !== null) this.docTexts[path] = a.text;
      this.reviews[path] = { ...r, comments: r.comments.map((x) => (x.id === id ? a.comment : x)) };
      this.emitReviewChanged(path);
      return { ok: true, applied: a.text !== null };
    },
    comment: async (path, input) => {
      this.reviewCalls.push({ op: "comment", args: [path, input] });
      const anchor = anchorForSelection(this.docTexts[path] ?? "", input.selected, input.heading);
      if (!anchor) return { ok: false, reason: "not-found" };
      const r = this.reviews[path] ?? { path, task: null, comments: [], approvals: [] };
      const id = nextCommentId(r);
      this.reviews[path] = { ...r, comments: [...r.comments, { id, author: "person", kind: "comment", anchor, text: input.text, state: "draft", replies: [], at: "2026-10-28T10:00:00.000Z" }] };
      this.emitReviewChanged(path);
      return { ok: true, id };
    },
    editDraft: async (path, id, text) => {
      this.reviewCalls.push({ op: "editDraft", args: [path, id, text] });
      const r = this.reviews[path];
      if (!r) return { ok: false, reason: "unknown" };
      this.reviews[path] = { ...r, comments: text === null ? r.comments.filter((c) => c.id !== id) : r.comments.map((c) => (c.id === id ? { ...c, text } : c)) };
      this.emitReviewChanged(path);
      return { ok: true };
    },
    reopen: async (path, id) => {
      this.reviewCalls.push({ op: "reopen", args: [path, id] });
      return { ok: true };
    },
    send: async (path) => {
      this.reviewCalls.push({ op: "send", args: [path] });
      return this.sendResult ?? { ok: true, sent: 1, to: "open" };
    },
    approve: async (path, reason, opts) => {
      this.reviewCalls.push({ op: "approve", args: [path, reason, opts] });
      return this.approveResult ?? { ok: true };
    },
    approvedText: async (path) => (Object.hasOwn(this.approvedTexts, path) ? { ok: true, text: this.approvedTexts[path] } : { ok: false, reason: "missing" }),
    onChange: (listener) => {
      this.reviewListeners.add(listener);
      return () => void this.reviewListeners.delete(listener);
    },
    focus: (path) => {
      for (const l of [...this.focusOpeners]) l(path);
    },
    onFocus: (listener) => {
      this.focusOpeners.add(listener);
      return () => void this.focusOpeners.delete(listener);
    },
  };
  focus: HarnessClient["focus"] = {
    current: () => this.focusState,
    onChange: (listener) => {
      this.focusListeners.add(listener);
      return () => void this.focusListeners.delete(listener);
    },
    set: (s) => {
      this.focusState = s;
      for (const l of [...this.focusListeners]) l(s);
    },
  };
```

`packages/ui/src/index.ts` exports the new types: `ReviewView`, `ReviewResult`, `ReviewSendResult`, `ReviewSummary`, `AnswerPick`, `CommentInput`, `FocusState`.

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/ui packages/shell`
Expected: PASS.

- [ ] **Step 6: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`. Expected: green.

```bash
git -C <worktree> add packages/shell packages/ui
git -C <worktree> commit -m "feat(shell,ui): review IPC, client.documents and client.focus"
```

---

### Task 13: Marks and the "Comments" column

**Files:**
- Create: `packages/ui/src/review-marks.ts`, `packages/ui/src/ReviewColumn.tsx`
- Modify: `packages/ui/src/DocumentReader.tsx`, `packages/ui/src/ChatView.tsx` (passes `review`), `packages/ui/src/styles.css`, `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/review-marks.test.ts`, `packages/ui/test/review-column.test.tsx`, `packages/ui/test/document-reader.test.tsx` (append)

- [ ] **Step 1: Add the strings**

In `packages/i18n/src/locales/en.json`, a new top-level `review` object (Task 14 and 15 add to it):

```json
  "review": {
    "column": "Comments",
    "question": "Question",
    "blocking": "Blocking",
    "noAnswer": "No answer",
    "other": "Other…",
    "otherLabel": "Your answer",
    "otherSave": "Save answer",
    "waiting": "Waiting for the turn to end",
    "applied": "Changed in the document",
    "unapplied": "The passage changed: your answer goes with the next round",
    "lost": "This passage is no longer in the document",
    "diagram": "In the diagram of § {{heading}}",
    "draft": "Draft",
    "sent": "Sent",
    "resolved": "Resolved",
    "open": "Open",
    "answered": "Answered",
    "reopen": "Reopen",
    "edit": "Edit",
    "delete": "Delete",
    "save": "Save",
    "cancel": "Cancel",
    "you": "You",
    "agent": "{{agent}}",
    "locked": "Approved: answers are locked until the document changes",
    "broken": "The review of this document can't be read. Fix or delete {{file}}.",
    "failed": "That didn't work. Try again."
  },
```

- [ ] **Step 2: Write the failing tests**

Create `packages/ui/test/review-marks.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { findMark, paintMarks, textRuns } from "../src/review-marks";

function box(html: string) {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.append(el);
  return el;
}

describe("textRuns (§6.1 marks)", () => {
  it("joins blocks with one space, collapses whitespace, skips diagrams", () => {
    const el = box('<h2>Scope</h2><p>Filter   by <strong>size</strong>.</p><div class="hh-md-diagram"><svg><text>A</text></svg></div><p>End.</p>');
    expect(textRuns(el).plain).toBe("Scope Filter by size. End.");
  });

  it("maps each plain character back to its node and offset", () => {
    const el = box("<p>ab <em>cd</em></p>");
    const r = textRuns(el);
    expect(r.at[3].node.textContent).toBe("cd");
    expect(r.at[3].offset).toBe(0);
  });
});

describe("findMark", () => {
  it("finds the n-th match without overlap, or null", () => {
    expect(findMark("aa aa aa", "aa", 1)).toEqual([3, 5]);
    expect(findMark("aaaa", "aa", 1)).toEqual([2, 4]);
    expect(findMark("aa", "aa", 2)).toBeNull();
    expect(findMark("x", "", 0)).toBeNull();
  });

  it("takes linear time on a long run of spaces", () => {
    const t0 = performance.now();
    findMark(`${" ".repeat(50_000)}x`, " ".repeat(40) + "y", 0);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("paintMarks", () => {
  it("returns a range per mark it found, and draws nothing without CSS.highlights", () => {
    const el = box("<p>Filter by size.</p><p>Filter by size.</p>");
    const ranges = paintMarks(el, [
      { id: "c1", want: "Filter by size.", nth: 1, tone: "question" },
      { id: "c2", want: "nowhere", nth: 0, tone: "comment" },
    ]);
    expect([...ranges.keys()]).toEqual(["c1"]);
    expect(ranges.get("c1")?.toString()).toBe("Filter by size.");
  });
});
```

Create `packages/ui/test/review-column.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Review } from "../src/client";
import { ReviewColumn } from "../src/ReviewColumn";
import { renderIn } from "./render";

afterEach(cleanup);
const TEXT = "## Scope\n\nFilter by size.\n\n```mermaid\ngraph TD; A-->B\n```\n";
const REVIEW: Review = {
  path: "specs/a.md",
  task: "t1",
  approvals: [],
  comments: [
    {
      id: "c1",
      author: "agent",
      kind: "question",
      anchor: { quote: "Filter by size.", heading: "scope", occurrence: 0 },
      text: "Size only?",
      options: [
        { label: "Keep", text: "Filter by size." },
        { label: "Colour too", text: "Filter by size and colour." },
      ],
      blocking: true,
      state: "open",
      replies: [],
      at: "2026-10-28T10:00:00.000Z",
    },
    { id: "c2", author: "agent", kind: "question", anchor: { quote: "A-->B", heading: "scope", occurrence: 0 }, text: "Arrow?", options: [{ label: "Yes", text: "A-->B" }, { label: "No", text: "A---B" }], state: "open", replies: [], at: "2026-10-28T10:00:00.000Z" },
    { id: "c3", author: "person", kind: "comment", anchor: { quote: "gone", heading: null, occurrence: 0 }, text: "Hm", state: "resolved", replies: [{ author: "agent", text: "Done.", at: "2026-10-28T10:01:00.000Z" }], at: "2026-10-28T10:00:00.000Z" },
  ],
};

function setup(over = {}) {
  const props = { review: REVIEW, text: TEXT, agent: "Claude", locked: false, waiting: null as string | null, active: null as string | null, onActive: vi.fn(), onAnswer: vi.fn(), onEditDraft: vi.fn(), onReopen: vi.fn(), ...over };
  renderIn("en", <ReviewColumn {...props} />);
  return props;
}

describe("ReviewColumn (§6.1)", () => {
  it("is a 'Comments' region with a card per comment, the blocking badge, a diagram note and a lost note", () => {
    setup();
    const col = screen.getByRole("region", { name: "Comments" });
    expect(col.querySelectorAll("article")).toHaveLength(3);
    expect(screen.getByText("Blocking")).toBeTruthy();
    expect(screen.getByText("In the diagram of § Scope")).toBeTruthy();
    expect(screen.getByText("This passage is no longer in the document")).toBeTruthy();
    expect(screen.getByText("Done.")).toBeTruthy();
  });

  it("an option, 'No answer' and 'Other…' answer the question", () => {
    const p = setup();
    fireEvent.click(screen.getAllByRole("radio", { name: "Colour too" })[0]);
    expect(p.onAnswer).toHaveBeenCalledWith("c1", 1);
    fireEvent.click(screen.getAllByRole("radio", { name: "No answer" })[0]);
    expect(p.onAnswer).toHaveBeenCalledWith("c1", null);
    fireEvent.click(screen.getAllByRole("button", { name: "Other…" })[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "Your answer" }), { target: { value: "Only in the session" } });
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
    expect(p.onAnswer).toHaveBeenCalledWith("c1", { other: "Only in the session" });
  });

  it("locked: the options are disabled and say why; waiting: the card says so", () => {
    setup({ locked: true, waiting: "c1" });
    expect((screen.getAllByRole("radio", { name: "Keep" })[0] as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Approved: answers are locked until the document changes")).toBeTruthy();
    expect(screen.getByText("Waiting for the turn to end")).toBeTruthy();
  });

  it("a resolved comment can be reopened", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(p.onReopen).toHaveBeenCalledWith("c3");
  });
});
```

Append to `packages/ui/test/document-reader.test.tsx`:

```tsx
describe("review in the reader (review spec §6.1, D0)", () => {
  it("without `review` there is no column and no review call (D0)", async () => {
    const { client } = setup();
    await screen.findByRole("heading", { level: 1, name: "Search cache" });
    expect(screen.queryByRole("region", { name: "Comments" })).toBeNull();
    expect(client.reviewCalls).toEqual([]);
  });

  it("with `review` it shows the record's cards and draws again on a change", async () => {
    const { client } = setup({ review: true });
    await screen.findByRole("region", { name: "Comments" });
    client.reviews["docs/cache.md"] = {
      path: "docs/cache.md",
      task: null,
      approvals: [],
      comments: [{ id: "c1", author: "agent", kind: "question", anchor: { quote: "Slow calls.", heading: "context", occurrence: 0 }, text: "How slow?", options: [{ label: "A", text: "Slow calls." }, { label: "B", text: "Very slow calls." }], state: "open", replies: [], at: "2026-10-28T10:00:00.000Z" }],
    };
    act(() => client.emitReviewChanged("docs/cache.md"));
    expect(await screen.findByText("How slow?")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `corepack pnpm vitest run packages/ui/test/review-marks.test.ts packages/ui/test/review-column.test.tsx packages/ui/test/document-reader.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Write `review-marks.ts`**

```ts
/** One character of the rendered text: the text node it is in and its offset there. */
export interface RunAt {
  node: Text;
  offset: number;
}
export interface TextRuns {
  /** The rendered text, every whitespace run one space, blocks joined by one space (as `project` does with the source). */
  plain: string;
  at: RunAt[];
}

const BLOCKS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "TD", "TH", "TR", "PRE", "BLOCKQUOTE", "DIV", "UL", "OL", "TABLE", "HR", "BR", "FIGURE"]);
const isSpace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === " ";

/** The rendered text under `root` (diagrams and buttons left out) and where each character lives. One pass. */
export function textRuns(root: HTMLElement): TextRuns {
  const plain: string[] = [];
  const at: RunAt[] = [];
  let space: RunAt | null = null;
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      const node = n as Text;
      const s = node.data;
      for (let i = 0; i < s.length; i++) {
        if (isSpace(s[i])) {
          if (!space) space = { node, offset: i };
          continue;
        }
        if (space && plain.length > 0) {
          plain.push(" ");
          at.push(space);
        }
        space = null;
        plain.push(s[i]);
        at.push({ node, offset: i });
      }
      return;
    }
    if (n.nodeType !== 1) return;
    const el = n as HTMLElement;
    if (el.classList.contains("hh-md-diagram") || el.tagName === "BUTTON" || el.tagName === "svg" || el.getAttribute("aria-hidden") === "true") return;
    const block = BLOCKS.has(el.tagName);
    if (block && !space && at.length > 0) space = at[at.length - 1];
    for (const c of el.childNodes) walk(c);
    if (block && !space && at.length > 0) space = at[at.length - 1];
  };
  walk(root);
  return { plain: plain.join(""), at };
}

/** The `nth` non-overlapping match of `want` in `plain`, as [start, end), or null. `indexOf` only. */
export function findMark(plain: string, want: string, nth: number): [number, number] | null {
  if (!want) return null;
  let k = 0;
  for (let i = plain.indexOf(want); i >= 0; i = plain.indexOf(want, i + want.length)) {
    if (k === nth) return [i, i + want.length];
    k++;
  }
  return null;
}

export type MarkTone = "question" | "comment" | "done";
export interface MarkSpec {
  id: string;
  want: string;
  nth: number;
  tone: MarkTone;
}

const HIGHLIGHTS = ["hh-review-question", "hh-review-comment", "hh-review-done", "hh-review-active"] as const;

type HighlightApi = { highlights?: Map<string, unknown> };
type HighlightCtor = new (...ranges: Range[]) => unknown;

/**
 * Finds every mark in the rendered text and draws it with the CSS Custom Highlight API (no change to the DOM, no CSP
 * change). Returns the ranges it found, by comment id (the column and the focus markers place themselves from them).
 * `active` gets a stronger highlight. Without the API (tests), nothing is drawn.
 */
export function paintMarks(root: HTMLElement, marks: MarkSpec[], active: string | null = null): Map<string, Range> {
  const runs = textRuns(root);
  const ranges = new Map<string, Range>();
  const byTone: Record<string, Range[]> = { "hh-review-question": [], "hh-review-comment": [], "hh-review-done": [], "hh-review-active": [] };
  for (const m of marks) {
    const hit = findMark(runs.plain, m.want, m.nth);
    if (!hit) continue;
    const a = runs.at[hit[0]];
    const b = runs.at[hit[1] - 1];
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset + 1);
    ranges.set(m.id, r);
    byTone[m.id === active ? "hh-review-active" : `hh-review-${m.tone}`].push(r);
  }
  const api = (globalThis as { CSS?: HighlightApi }).CSS;
  const Highlight = (globalThis as { Highlight?: HighlightCtor }).Highlight;
  if (api?.highlights && Highlight) for (const name of HIGHLIGHTS) api.highlights.set(name, new Highlight(...byTone[name]));
  return ranges;
}

/** Removes the reader's highlights (the reader closed or the document changed). */
export function clearMarks(): void {
  const api = (globalThis as { CSS?: HighlightApi }).CSS;
  if (api?.highlights) for (const name of HIGHLIGHTS) api.highlights.delete(name);
}
```

- [ ] **Step 5: Write `ReviewColumn.tsx`**

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type AnswerPick, type Review, type ReviewComment, diagramOf, locate } from "@humanharness/harness-sdk/review";

export interface ReviewColumnProps {
  review: Review;
  /** The document's source, for "lost" and the diagram note. */
  text: string;
  agent: string;
  /** Approved and unchanged: answers are locked (§5.4). */
  locked: boolean;
  /** The comment whose answer waits for the turn to end. */
  waiting: string | null;
  active: string | null;
  onActive(id: string): void;
  onAnswer(id: string, pick: AnswerPick): void;
  onEditDraft(id: string, text: string | null): void;
  onReopen(id: string): void;
}

/** The "Comments" column (§6.1): one card per comment or question, in document order is not required; record order is. */
export function ReviewColumn(p: ReviewColumnProps) {
  const { t } = useTranslation();
  return (
    <section className="hh-review-column" aria-label={t("review.column")}>
      {p.locked && (
        <p className="hh-caption" role="note">
          {t("review.locked")}
        </p>
      )}
      {p.review.comments.map((c) => (
        <ReviewCard key={c.id} c={c} {...p} />
      ))}
    </section>
  );
}

function ReviewCard({ c, text, agent, locked, waiting, active, onActive, onAnswer, onEditDraft, onReopen }: ReviewColumnProps & { c: ReviewComment }) {
  const { t } = useTranslation();
  const [other, setOther] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const where = locate(text, c.anchor);
  const diagram = where ? diagramOf(text, where.start) : null;
  const picked = c.answer && "option" in c.answer ? c.answer.option : c.answer ? -1 : null;
  const group = `hh-review-${c.id}`;
  return (
    <article
      className={`hh-review-card hh-review-${c.kind}${active === c.id ? " hh-review-card-active" : ""}`}
      data-comment={c.id}
      aria-label={c.kind === "question" ? `${t("review.question")}: ${c.text}` : c.text}
      onFocus={() => onActive(c.id)}
      onMouseEnter={() => onActive(c.id)}
    >
      <header className="hh-review-card-head">
        <span>{c.author === "person" ? t("review.you") : agent}</span>
        {c.blocking && c.state !== "resolved" && <span className="hh-review-badge">{t("review.blocking")}</span>}
        <span className="hh-review-state">{t(`review.${c.state === "lost" ? "open" : c.state}`)}</span>
      </header>
      {!where && <p className="hh-warn">{t("review.lost")}</p>}
      {diagram && <p className="hh-caption">{t("review.diagram", { heading: diagram })}</p>}
      <blockquote className="hh-review-quote">{c.anchor.quote}</blockquote>
      {editing === null ? <p>{c.text}</p> : (
        <div className="hh-review-edit">
          <textarea aria-label={t("review.edit")} value={editing} maxLength={4000} onChange={(e) => setEditing(e.target.value)} />
          <button type="button" disabled={!editing.trim()} onClick={() => (onEditDraft(c.id, editing), setEditing(null))}>{t("review.save")}</button>
          <button type="button" onClick={() => setEditing(null)}>{t("review.cancel")}</button>
        </div>
      )}
      {c.kind === "question" && c.options && (
        <fieldset className="hh-review-options" disabled={locked || waiting === c.id}>
          <legend className="hh-sr-only">{c.text}</legend>
          {c.options.map((o, i) => (
            <label key={i}>
              <input type="radio" name={group} checked={picked === i} onChange={() => onAnswer(c.id, i)} />
              {o.label}
            </label>
          ))}
          <label>
            <input type="radio" name={group} checked={picked === null} onChange={() => onAnswer(c.id, null)} />
            {t("review.noAnswer")}
          </label>
          {other === null ? (
            <button type="button" onClick={() => setOther(c.answer && "other" in c.answer ? c.answer.other : "")}>{t("review.other")}</button>
          ) : (
            <div className="hh-review-edit">
              <textarea aria-label={t("review.otherLabel")} value={other} maxLength={2000} onChange={(e) => setOther(e.target.value)} />
              <button type="button" disabled={!other.trim()} onClick={() => (onAnswer(c.id, { other: other.trim() }), setOther(null))}>{t("review.otherSave")}</button>
              <button type="button" onClick={() => setOther(null)}>{t("review.cancel")}</button>
            </div>
          )}
        </fieldset>
      )}
      {waiting === c.id && <p className="hh-caption" role="status">{t("review.waiting")}</p>}
      {c.unapplied && <p className="hh-caption">{t("review.unapplied")}</p>}
      {c.replies.length > 0 && (
        <ol className="hh-review-replies">
          {c.replies.map((r, i) => (
            <li key={i}>
              <strong>{r.author === "person" ? t("review.you") : agent}</strong> {r.text}
            </li>
          ))}
        </ol>
      )}
      {c.state === "draft" && editing === null && (
        <div className="hh-review-actions">
          <button type="button" onClick={() => setEditing(c.text)}>{t("review.edit")}</button>
          <button type="button" onClick={() => onEditDraft(c.id, null)}>{t("review.delete")}</button>
        </div>
      )}
      {c.state === "resolved" && (
        <button type="button" onClick={() => onReopen(c.id)}>{t("review.reopen")}</button>
      )}
    </article>
  );
}
```

`locate` and `diagramOf` are exported by Task 1 and Task 2 (`@humanharness/harness-sdk/review`). Card text is rendered as text, never as HTML.

- [ ] **Step 6: Wire the reader**

`DocumentReader.tsx`:
- props gain `review?: boolean` (the column, the bar, the selection; D0 when absent) and, for Task 16, `focus?: boolean; onFocus?(on: boolean): void`.
- state and effects:

```tsx
  const [rv, setRv] = useState<ReviewView | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const [ranges, setRanges] = useState<Map<string, Range>>(() => new Map());
  const loadReview = useCallback(() => {
    if (!review) return;
    client.documents.view(path).then(setRv, () => setRv({ ok: false, reason: "not-ready" }));
  }, [client, path, review]);
  useEffect(() => {
    if (!review) return;
    loadReview();
    return client.documents.onChange((p) => {
      if (p === path) {
        loadReview();
        setNonce((n) => n + 1); // the document may have changed too (an answer swapped a passage): read it again
      }
    });
  }, [client, path, review, loadReview]);
```

  (`setNonce` is the existing "read again" counter of the reader's document effect; if the reader has none, add `const [nonce, setNonce] = useState(0)` and put `nonce` in that effect's dependencies.)
- paint after the body renders:

```tsx
  const record = rv?.ok ? rv.review : null;
  useLayoutEffect(() => {
    const box = textRef.current;
    if (!box || !record || !doc?.ok || source) {
      clearMarks();
      setRanges(new Map());
      return;
    }
    const marks: MarkSpec[] = [];
    for (const c of record.comments) {
      const m = markOccurrence(doc.text, c.anchor);
      if (m) marks.push({ id: c.id, want: m.want, nth: m.nth, tone: c.state === "resolved" ? "done" : c.kind === "question" ? "question" : "comment" });
    }
    setRanges(paintMarks(box, marks, active));
    return clearMarks;
  }, [record, doc, source, active]);
```

- an answer:

```tsx
  const answer = async (id: string, pick: AnswerPick) => {
    setWaiting(id);
    const r = await client.documents.answer(path, id, pick).catch(() => ({ ok: false as const, reason: "not-ready" as const }));
    setWaiting(null);
    setFailed(!r.ok);
    loadReview();
  };
```

  and the same shape for `editDraft` and `reopen` (no `waiting`).
- the body's `<Markdown …/>` goes inside `<div className="hh-review-text" ref={textRef}>…</div>` (only the Markdown, not the meta line or the title, so marks match the body only).
- in `hh-reader-columns`, after `hh-reader-scroll`:

```tsx
        {review && doc?.ok && !source && rv?.ok && rv.review && (
          <ReviewColumn
            review={rv.review}
            text={doc.text}
            agent={target.agent ?? ""}
            locked={rv.summary.status === "approved"}
            waiting={waiting}
            active={active}
            onActive={setActive}
            onAnswer={answer}
            onEditDraft={editDraft}
            onReopen={reopen}
          />
        )}
        {review && rv && !rv.ok && rv.reason === "broken" && (
          <p className="hh-reader-problem" role="alert">{t("review.broken", { file: `.harness/reviews/${path}.json` })}</p>
        )}
        {failed && <p className="hh-warn" role="alert">{t("review.failed")}</p>}
```

- a card click scrolls its mark into view: `onActive` also calls `ranges.get(id)?.startContainer.parentElement?.scrollIntoView({ block: "center" })` when the card was clicked (pass a second argument `scroll: true` from the card's `onClick`, not from hover).

`ChatView.tsx`: `<DocumentReader … review={state.review === true} />`.

`styles.css`, in `:root` and in the dark block:

```css
  --hh-review-question: #fbefc4;
  --hh-review-comment: #dde8f8;
  --hh-review-done: #e9ebe6;
  --hh-review-active: #f6d77a;
```

(dark: `#5a4a16`, `#243a5a`, `#30332e`, `#7a5f12`), and the rules:

```css
::highlight(hh-review-question) { background-color: var(--hh-review-question); }
::highlight(hh-review-comment) { background-color: var(--hh-review-comment); }
::highlight(hh-review-done) { background-color: var(--hh-review-done); }
::highlight(hh-review-active) { background-color: var(--hh-review-active); }
.hh-reader-columns { container-type: inline-size; }
.hh-review-column { flex: 0 0 280px; overflow-y: auto; padding: 12px; border-left: 1px solid var(--hh-line); display: flex; flex-direction: column; gap: 10px; font-size: 13px; }
.hh-review-card { padding: 10px; border: 1px solid var(--hh-line); border-radius: 8px; background: var(--hh-sheet); }
.hh-review-card-active { border-color: var(--hh-line-strong); box-shadow: 0 0 0 2px var(--hh-review-active); }
.hh-review-card-head { display: flex; gap: 6px; align-items: center; color: var(--hh-muted); font-size: 12px; }
.hh-review-state { margin-left: auto; }
.hh-review-badge { padding: 0 6px; border-radius: 999px; border: 1px solid var(--hh-warn); color: var(--hh-warn); }
.hh-review-quote { margin: 6px 0; padding-left: 8px; border-left: 3px solid var(--hh-line-strong); color: var(--hh-slate); overflow-wrap: anywhere; }
.hh-review-options { display: flex; flex-direction: column; gap: 4px; border: 0; padding: 0; margin: 6px 0 0; }
.hh-review-edit { display: flex; flex-direction: column; gap: 4px; }
.hh-review-replies { margin: 6px 0 0; padding-left: 16px; }
.hh-review-actions { display: flex; gap: 6px; }
@container (max-width: 900px) {
  .hh-reader-columns { flex-direction: column; }
  .hh-review-column { flex: none; border-left: 0; border-top: 1px solid var(--hh-line); }
}
```

- [ ] **Step 7: Run the tests**

Run: `corepack pnpm vitest run packages/ui`
Expected: PASS; the reader's existing tests unchanged.

- [ ] **Step 8: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`. Expected: green.

```bash
git -C <worktree> add packages/ui packages/i18n
git -C <worktree> commit -m "feat(ui): review marks and the Comments column in the reader"
```

---

### Task 14: Commenting on a selection, the footer bar, "See what changed"

**Files:**
- Create: `packages/ui/src/ReviewBar.tsx`, `packages/ui/src/ApprovedDiff.tsx`
- Modify: `packages/ui/src/DocumentReader.tsx`, `packages/ui/src/styles.css`, `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/review-bar.test.tsx`, `packages/ui/test/document-reader.test.tsx` (append)

- [ ] **Step 1: Add the strings** (inside `review`)

```json
    "comment": "Comment",
    "commentLabel": "Your comment",
    "saveDraft": "Save draft",
    "send_one": "Send comment ({{count}})",
    "send_other": "Send comments ({{count}})",
    "sentOpen": "Sent to the task.",
    "sentNew": "Sent: a review task started.",
    "busy": "Wait for the turn to end, then send.",
    "approve": "Approve",
    "approveBlocking_one": "Approve · {{count}} blocking open",
    "approveBlocking_other": "Approve · {{count}} blocking open",
    "approveAnyway": "Approve anyway, with a reason",
    "reasonLabel": "Why approve with blocking questions open?",
    "unsent_one": "{{count}} comment or answer is not sent yet.",
    "unsent_other": "{{count}} comments or answers are not sent yet.",
    "sendFirst": "Send first",
    "discardApprove": "Discard and approve",
    "approved": "Approved · {{time}}",
    "approvedReason": "Approved with a reason: {{reason}}",
    "stale": "Changed since approval",
    "seeChanges": "See what changed",
    "hideChanges": "Hide changes",
    "noDiff": "Too large to compare here.",
    "diff": "Changes since the approval",
    "notFound": "That text could not be found in the document. Select plain text, not a diagram."
```

- [ ] **Step 2: Write the failing tests**

Create `packages/ui/test/review-bar.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewSummary } from "../src/client";
import { ReviewBar } from "../src/ReviewBar";
import { renderIn } from "./render";

afterEach(cleanup);
const S = (over: Partial<ReviewSummary> = {}): ReviewSummary => ({ status: "draft", questions: 0, blocking: 0, unsent: 0, comments: 0, ...over });

function setup(summary: ReviewSummary, over = {}) {
  const props = { summary, busy: false, onSend: vi.fn(async () => ({ ok: true as const, sent: 1, to: "open" as const })), onApprove: vi.fn(async () => ({ ok: true as const })), onSeeChanges: vi.fn(), ...over };
  renderIn("en", <ReviewBar {...props} />);
  return props;
}

describe("ReviewBar (§5.3, §5.4)", () => {
  it("counts what the batch carries; disabled while a turn runs", () => {
    setup(S({ unsent: 2 }), { busy: true });
    const send = screen.getByRole("button", { name: "Send comments (2)" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  it("approves at once with nothing open", async () => {
    const p = setup(S());
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(p.onApprove).toHaveBeenCalledWith(undefined, undefined);
  });

  it("with a blocking question it says so, and approving asks for a reason", async () => {
    const p = setup(S({ questions: 1, blocking: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "Approve · 1 blocking open" }));
    expect(p.onApprove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Approve anyway, with a reason" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Why approve with blocking questions open?" }), { target: { value: "Decided on the call" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(p.onApprove).toHaveBeenCalledWith("Decided on the call", undefined);
  });

  it("with unsent items it offers 'Send first' and 'Discard and approve'", async () => {
    const p = setup(S({ unsent: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("1 comment or answer is not sent yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard and approve" }));
    expect(p.onApprove).toHaveBeenCalledWith(undefined, { discard: true });
    fireEvent.click(screen.getByRole("button", { name: "Send first" }));
    expect(p.onSend).toHaveBeenCalled();
  });

  it("approved shows the time; stale shows the change and 'See what changed'", () => {
    setup(S({ status: "approved", approvedAt: "2026-10-28T10:00:00.000Z" }));
    expect(screen.getByText(/^Approved · /)).toBeTruthy();
    cleanup();
    const p = setup(S({ status: "stale", approvedAt: "2026-10-28T10:00:00.000Z" }));
    expect(screen.getByText("Changed since approval")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "See what changed" }));
    expect(p.onSeeChanges).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });
});
```

Append to `packages/ui/test/document-reader.test.tsx`:

```tsx
describe("commenting on a selection (review spec §5.2)", () => {
  it("a selection in the text shows 'Comment'; saving makes a draft with the heading above it", async () => {
    const { client } = setup({ review: true });
    await screen.findByRole("region", { name: "Comments" });
    const para = screen.getByText("Slow calls.");
    const range = document.createRange();
    range.selectNodeContents(para);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.mouseUp(para);
    fireEvent.click(await screen.findByRole("button", { name: "Comment" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Your comment" }), { target: { value: "How slow?" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(client.reviewCalls.find((c) => c.op === "comment")?.args).toEqual(["docs/cache.md", { selected: "Slow calls.", heading: "context", text: "How slow?" }]));
    expect(await screen.findByText("How slow?")).toBeTruthy();
  });

  it("'See what changed' shows the lines added and removed since the approval", async () => {
    const { client } = setup({ review: true });
    client.reviews["docs/cache.md"] = { path: "docs/cache.md", task: null, comments: [], approvals: [{ blob: "0".repeat(40), at: "2026-10-28T10:00:00.000Z" }] };
    client.approvedTexts["docs/cache.md"] = ANALYSIS.replace("Slow calls.", "Fast calls.");
    act(() => client.emitReviewChanged("docs/cache.md"));
    fireEvent.click(await screen.findByRole("button", { name: "See what changed" }));
    const diff = await screen.findByRole("region", { name: "Changes since the approval" });
    expect(within(diff).getByText("Fast calls.").closest("li")?.className).toContain("hh-diff-removed");
    expect(within(diff).getByText("Slow calls.").closest("li")?.className).toContain("hh-diff-added");
  });
});
```

The test must make the record stale: add `client.currentBlobs["docs/cache.md"] = "1".repeat(40);` right after setting `client.reviews[…]` (the fake's `currentBlobs`, Task 12).

- [ ] **Step 3: Run them to see them fail**

Run: `corepack pnpm vitest run packages/ui/test/review-bar.test.tsx packages/ui/test/document-reader.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Write `ReviewBar.tsx`**

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReviewResult, ReviewSendResult, ReviewSummary } from "./client";

export interface ReviewBarProps {
  summary: ReviewSummary;
  /** A turn runs: sending waits (§5.3). */
  busy: boolean;
  onSend(): Promise<ReviewSendResult>;
  onApprove(reason?: string, opts?: { discard?: boolean }): Promise<ReviewResult>;
  onSeeChanges(): void;
}

/** The reader's footer (§5.3, §5.4): send the round, approve, and the approval's line. */
export function ReviewBar({ summary, busy, onSend, onApprove, onSeeChanges }: ReviewBarProps) {
  const { t, i18n } = useTranslation();
  const [asking, setAsking] = useState<"reason" | "unsent" | null>(null);
  const [reason, setReason] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const when = (iso?: string) => (iso ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "");

  const send = async () => {
    const r = await onSend();
    setAsking(null);
    setSaid(r.ok ? t(r.to === "open" ? "review.sentOpen" : "review.sentNew") : r.reason === "busy" ? t("review.busy") : t("review.failed"));
  };
  /** The one place approval happens: a later Sidekick `before-approve` hold goes here (Conflicts 3). */
  const approveNow = async (why?: string, opts?: { discard?: boolean }) => {
    const r = await onApprove(why, opts);
    if (r.ok) {
      setAsking(null);
      setReason("");
      setSaid(null);
    } else if (r.reason === "unsent") setAsking("unsent");
    else if (r.reason === "reason-required") setAsking("reason");
    else setSaid(t("review.failed"));
  };
  const approve = () => {
    if (summary.unsent > 0) setAsking("unsent");
    else if (summary.blocking > 0) setAsking("reason");
    else void approveNow();
  };

  if (summary.status === "approved")
    return (
      <footer className="hh-review-bar" aria-label={t("review.column")}>
        <span className="hh-review-approved">{t("review.approved", { time: when(summary.approvedAt) })}</span>
      </footer>
    );
  return (
    <footer className="hh-review-bar">
      {summary.status === "stale" && (
        <span className="hh-warn">
          {t("review.stale")}{" "}
          <button type="button" onClick={onSeeChanges}>
            {t("review.seeChanges")}
          </button>
        </span>
      )}
      {summary.unsent > 0 && (
        <button type="button" disabled={busy} onClick={send}>
          {t("review.send", { count: summary.unsent })}
        </button>
      )}
      {asking === null && (
        <button type="button" className="hh-review-approve" onClick={approve}>
          {summary.blocking > 0 ? t("review.approveBlocking", { count: summary.blocking }) : t("review.approve")}
        </button>
      )}
      {asking === "reason" && (
        <div className="hh-review-ask" role="group">
          <ReasonForm reason={reason} setReason={setReason} onApprove={() => approveNow(reason.trim())} onCancel={() => setAsking(null)} />
        </div>
      )}
      {asking === "unsent" && (
        <div className="hh-review-ask" role="group">
          <p>{t("review.unsent", { count: summary.unsent })}</p>
          <button type="button" disabled={busy} onClick={send}>
            {t("review.sendFirst")}
          </button>
          <button type="button" onClick={() => approveNow(undefined, { discard: true })}>
            {t("review.discardApprove")}
          </button>
        </div>
      )}
      {said && (
        <p className="hh-caption" role="status">
          {said}
        </p>
      )}
    </footer>
  );
}

function ReasonForm({ reason, setReason, onApprove, onCancel }: { reason: string; setReason(s: string): void; onApprove(): void; onCancel(): void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          {t("review.approveAnyway")}
        </button>
        <button type="button" onClick={onCancel}>
          {t("review.cancel")}
        </button>
      </>
    );
  return (
    <>
      <textarea aria-label={t("review.reasonLabel")} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      <button type="button" disabled={!reason.trim()} onClick={onApprove}>
        {t("review.approve")}
      </button>
      <button type="button" onClick={onCancel}>
        {t("review.cancel")}
      </button>
    </>
  );
}
```

- [ ] **Step 5: Write `ApprovedDiff.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type DiffLine, lineDiff } from "@humanharness/harness-sdk/review";
import type { HarnessClient } from "./client";

/** "See what changed" (§5.4): the approved version against the current one, line by line. Text only, never HTML. */
export function ApprovedDiff({ client, path, current }: { client: HarnessClient; path: string; current: string }) {
  const { t } = useTranslation();
  const [lines, setLines] = useState<DiffLine[] | null | "loading">("loading");
  useEffect(() => {
    let live = true;
    client.documents.approvedText(path).then(
      (r) => live && setLines(r.ok ? lineDiff(r.text, current) : null),
      () => live && setLines(null),
    );
    return () => {
      live = false;
    };
  }, [client, path, current]);
  if (lines === "loading") return null;
  return (
    <section className="hh-diff" aria-label={t("review.diff")}>
      {lines === null ? (
        <p className="hh-caption">{t("review.noDiff")}</p>
      ) : (
        <ol>
          {lines.map((l, i) => (
            <li key={i} className={`hh-diff-${l.kind}`}>
              {l.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
```

Only `added` and `removed` lines, plus up to 2 `same` lines around each change, are worth showing: filter in the component (`keep[i]` true when a change is within 2 lines), and show "…" between kept runs.

- [ ] **Step 6: The selection and the bar in the reader**

`DocumentReader.tsx` (all under `review`):

```tsx
  const [pick, setPick] = useState<{ selected: string; heading: string | null; top: number; left: number } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);

  /** The slug of the heading above `node`, inside the review text. */
  const headingAbove = (node: Node | null): string | null => {
    const box = textRef.current;
    if (!box || !node) return null;
    let found: string | null = null;
    for (const h of box.querySelectorAll<HTMLElement>("[data-heading]")) {
      if (h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING || h.contains(node)) found = h.id || found;
      else break;
    }
    return found;
  };
  const onSelect = () => {
    const sel = window.getSelection();
    const box = textRef.current;
    if (!review || !sel || sel.isCollapsed || !box || sel.rangeCount === 0) return setPick(null);
    const r = sel.getRangeAt(0);
    if (!box.contains(r.commonAncestorContainer)) return setPick(null);
    const selected = sel.toString();
    if (!selected.trim() || selected.length > 20_000) return setPick(null);
    const rect = r.getBoundingClientRect();
    const host = scrollRef.current?.getBoundingClientRect();
    setPick({ selected, heading: headingAbove(r.startContainer), top: rect.bottom - (host?.top ?? 0) + (scrollRef.current?.scrollTop ?? 0), left: rect.left - (host?.left ?? 0) });
  };
  const saveDraft = async () => {
    if (!pick || !draft?.trim()) return;
    const r = await client.documents.comment(path, { selected: pick.selected, heading: pick.heading, text: draft.trim() }).catch(() => ({ ok: false as const, reason: "not-ready" as const }));
    if (!r.ok) setNotice(r.reason === "not-found" ? t("review.notFound") : t("review.failed"));
    setPick(null);
    setDraft(null);
    loadReview();
  };
```

- `<div className="hh-review-text" ref={textRef} onMouseUp={onSelect} onKeyUp={onSelect}>`.
- inside `hh-reader-scroll` (which gets `position: relative`), after the article:

```tsx
          {review && pick && (
            <div className="hh-review-pick" style={{ top: pick.top, left: pick.left }}>
              {draft === null ? (
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setDraft("")}>
                  {t("review.comment")}
                </button>
              ) : (
                <>
                  <textarea aria-label={t("review.commentLabel")} autoFocus value={draft} maxLength={4000} onChange={(e) => setDraft(e.target.value)} />
                  <button type="button" disabled={!draft.trim()} onClick={saveDraft}>
                    {t("review.saveDraft")}
                  </button>
                  <button type="button" onClick={() => (setPick(null), setDraft(null))}>
                    {t("review.cancel")}
                  </button>
                </>
              )}
            </div>
          )}
          {review && diffOpen && doc?.ok && <ApprovedDiff client={client} path={path} current={doc.text} />}
```

  (`setNotice` is a small `useState<string | null>` shown as `<p className="hh-warn" role="alert">` next to `failed`; merge the two into one `notice` state.) The position goes through React's `style` (CSSOM), so the CSP stays as it is.
- after `hh-reader-columns`, inside the aside:

```tsx
      {review && doc?.ok && !source && rv?.ok && (
        <ReviewBar
          summary={rv.summary}
          busy={busy}
          onSend={async () => {
            const r = await client.documents.send(path);
            loadReview();
            return r;
          }}
          onApprove={async (reason, opts) => {
            const r = await client.documents.approve(path, reason, opts);
            loadReview();
            return r;
          }}
          onSeeChanges={() => setDiffOpen((o) => !o)}
        />
      )}
```

  A new prop `busy?: boolean` on the reader (from `ChatView`: `Boolean(chat.live) || closing || checkpoint`).
- `Escape` with a pick open closes the pick first (add it to `onKeyDown` before the prefs branch).

`styles.css`:

```css
.hh-reader-scroll { position: relative; }
.hh-review-pick { position: absolute; z-index: 3; display: flex; flex-direction: column; gap: 4px; max-width: 320px; padding: 6px; border: 1px solid var(--hh-line); border-radius: 8px; background: var(--hh-surface); }
.hh-review-bar { position: sticky; bottom: 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 12px; border-top: 1px solid var(--hh-line); background: var(--hh-surface); }
.hh-review-approve { margin-left: auto; }
.hh-review-approved { color: var(--hh-ok); }
.hh-review-ask { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; width: 100%; }
.hh-diff ol { margin: 0; padding: 0; list-style: none; font-family: var(--hh-mono, monospace); font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
.hh-diff-added { background: var(--hh-callout-tip); }
.hh-diff-removed { background: var(--hh-error-bg); text-decoration: line-through; }
```

- [ ] **Step 7: Run the tests**

Run: `corepack pnpm vitest run packages/ui`
Expected: PASS.

- [ ] **Step 8: Typecheck, test, build, commit**

```bash
git -C <worktree> add packages/ui packages/i18n
git -C <worktree> commit -m "feat(ui): comment on a selection, send the round, approve, see what changed"
```

---

### Task 15: Review chips on the chat's document cards

**Files:**
- Modify: `packages/ui/src/DocumentCards.tsx`, `packages/ui/src/Message.tsx`, `packages/ui/src/ChatView.tsx`, `packages/ui/src/styles.css`, `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/document-cards.test.tsx` (append)

- [ ] **Step 1: Add the strings** (inside `review`)

```json
    "chipQuestions_one": "{{count}} question open",
    "chipQuestions_other": "{{count}} questions open",
    "chipBlocking": "{{count}} blocking",
    "chipDraft": "In review",
    "chipApproved": "Approved",
    "chipStale": "Changed since approval"
```

- [ ] **Step 2: Write the failing tests**

Append to `packages/ui/test/document-cards.test.tsx` (a `ChatView` test: it has `card`, `answer(...)` and `chatWith(...)`; `DocumentCards` is imported for the direct cases):

```tsx
import { DocumentCards } from "../src/DocumentCards";

describe("review chips (review spec §6.1)", () => {
  const at = (path: string) => ({ ...card, path, title: path });
  it("show open questions, blocking ones, approved and stale", () => {
    const reviews = new Map([
      ["a.md", { status: "draft" as const, questions: 2, blocking: 1, unsent: 0, comments: 2 }],
      ["b.md", { status: "approved" as const, questions: 0, blocking: 0, unsent: 0, comments: 0, approvedAt: "2026-10-28T10:00:00.000Z" }],
      ["c.md", { status: "stale" as const, questions: 0, blocking: 0, unsent: 0, comments: 0 }],
    ]);
    renderIn("en", <DocumentCards cards={[at("a.md"), at("b.md"), at("c.md"), at("d.md")]} missing={new Set()} onOpen={() => {}} reviews={reviews} />);
    expect(screen.getByText("2 questions open")).toBeTruthy();
    expect(screen.getByText("1 blocking")).toBeTruthy();
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.getByText("Changed since approval")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });

  it("the chat asks for summaries only when the harness can review (D0)", async () => {
    const plain = await chatWith([answer([card])], { [card.path]: "# A" });
    await screen.findByRole("button", { name: /Analysis/ });
    await new Promise((r) => setTimeout(r, 20));
    expect(plain.client.reviewCalls).toEqual([]);
    cleanup();

    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    client.chat = [answer([card])];
    client.docTexts[card.path] = "## Scope\n\nBy size.\n";
    client.state.review = true;
    await renderIn("en", <ChatView client={client} state={client.state} components={{}} stateBlocks={[]} />);
    await vi.waitFor(() => expect(client.reviewCalls.filter((c) => c.op === "summaries")).toHaveLength(1));
    expect(client.reviewCalls[0].args).toEqual([[card.path]]);
    await act(async () => void (await client.documents.comment(card.path, { selected: "By size.", heading: "scope", text: "x" })));
    await vi.waitFor(() => expect(client.reviewCalls.filter((c) => c.op === "summaries")).toHaveLength(2));
    expect(await screen.findByText("In review")).toBeTruthy();
  });
});
```

(`client.state` is the fake's `AppState`; if it is a getter that builds a new object, add a `review?: true` field on the fake that the getter copies.)

- [ ] **Step 3: Run them to see them fail**

Run: `corepack pnpm vitest run packages/ui/test/document-cards.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Write the code**

`DocumentCards.tsx`: a new optional prop `reviews?: ReadonlyMap<string, ReviewSummary | null>`; inside `hh-doc-card-meta`, after the minutes:

```tsx
                {reviews && <ReviewChip summary={reviews.get(c.path) ?? null} />}
```

and in the same file:

```tsx
function ReviewChip({ summary }: { summary: ReviewSummary | null }) {
  const { t } = useTranslation();
  if (!summary || summary.status === "none") return null;
  if (summary.status === "approved") return <span className="hh-review-chip hh-review-chip-ok">{t("review.chipApproved")}</span>;
  if (summary.status === "stale") return <span className="hh-review-chip hh-review-chip-warn">{t("review.chipStale")}</span>;
  return (
    <>
      <span className="hh-review-chip">{summary.questions > 0 ? t("review.chipQuestions", { count: summary.questions }) : t("review.chipDraft")}</span>
      {summary.blocking > 0 && <span className="hh-review-chip hh-review-chip-warn">{t("review.chipBlocking", { count: summary.blocking })}</span>}
    </>
  );
}
```

`Message.tsx`: the `documents` prop type gains `reviews?: ReadonlyMap<string, ReviewSummary | null>`, passed to `DocumentCards`.

`ChatView.tsx`, next to the `documentsExist` effect:

```tsx
  const [reviewSummaries, setReviewSummaries] = useState<ReadonlyMap<string, ReviewSummary | null> | undefined>(undefined);
  const [reviewTick, setReviewTick] = useState(0);
  useEffect(() => {
    // D0: no review, or no cards: no call, no listener.
    if (!state.review || !cardKey) return;
    return client.documents.onChange(() => setReviewTick((n) => n + 1));
  }, [client, state.review, cardKey]);
  useEffect(() => {
    if (!state.review || !cardKey) return;
    let live = true;
    const paths = cardKey.split("\n");
    client.documents.summaries(paths).then(
      (s) => live && setReviewSummaries(new Map(paths.map((p, i) => [p, s[i] ?? null]))),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [client, state.review, cardKey, reviewTick, docsCheck]);
```

and `cardsFor` returns `{ missing, open, ...(reviewSummaries ? { reviews: reviewSummaries } : {}) }`.

`styles.css`:

```css
.hh-review-chip { padding: 0 6px; border-radius: 999px; background: var(--hh-review-question); color: var(--hh-ink); font-size: 12px; }
.hh-review-chip-ok { background: var(--hh-callout-tip); color: var(--hh-ok); }
.hh-review-chip-warn { background: var(--hh-callout-warning); color: var(--hh-warn); }
```

- [ ] **Step 5: Run the tests, typecheck, test, build, commit**

Run: `corepack pnpm vitest run packages/ui`, `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`. Expected: green.

```bash
git -C <worktree> add packages/ui packages/i18n
git -C <worktree> commit -m "feat(ui): review chips on the chat's document cards"
```

---

### Task 16: Focus mode

**Files:**
- Create: `packages/ui/src/focus-notices.ts`, `packages/ui/src/FocusMarkers.tsx`
- Modify: `packages/ui/src/DocumentReader.tsx`, `packages/ui/src/ChatView.tsx`, `packages/ui/src/styles.css`, `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/focus-notices.test.ts`, `packages/ui/test/focus-mode.test.tsx`

- [ ] **Step 1: Add the strings** (a new top-level `focus` object)

```json
  "focus": {
    "enter": "Focus",
    "leave": "Leave focus",
    "label": "Focus mode",
    "summary": "While you were reading: {{items}}.",
    "waiting": "the task is waiting for you",
    "quota": "your plan's limit ran out",
    "proposal_one": "the AI proposed to move to another part",
    "proposal_other": "the AI proposed to move to another part {{count}} times",
    "marker": "Comment: {{text}}"
  },
```

- [ ] **Step 2: Write the failing tests**

Create `packages/ui/test/focus-notices.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type Paused, NO_PAUSED, countPaused, pausedSummary } from "../src/focus-notices";

const t = (k: string, o?: Record<string, unknown>) =>
  ({
    "focus.summary": `While you were reading: ${o?.items}.`,
    "focus.waiting": "the task is waiting for you",
    "focus.quota": "your plan's limit ran out",
    "focus.proposal": o?.count === 1 ? "the AI proposed to move to another part" : `the AI proposed to move to another part ${o?.count} times`,
  })[k] ?? k;

describe("paused notices (§6.2)", () => {
  it("count what happened and say it in one line", () => {
    let p: Paused = NO_PAUSED;
    p = countPaused(p, { waiting: true });
    p = countPaused(p, { proposal: true });
    p = countPaused(p, { proposal: true });
    expect(pausedSummary(t, p)).toBe("While you were reading: the task is waiting for you, the AI proposed to move to another part 2 times.");
  });

  it("nothing happened: no line", () => {
    expect(pausedSummary(t, NO_PAUSED)).toBeNull();
  });
});
```

Create `packages/ui/test/focus-mode.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatView } from "../src/ChatView";
import type { ChatEntry } from "../src/client";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);
const card = { path: "specs/a.md", title: "Filter", kind: "spec", change: "new" as const, words: 120 };
const answer: ChatEntry = { id: "a1", role: "assistant", text: "I wrote the spec.", blocks: [], activities: [], at: "2026-10-28T10:00:00.000Z", engine: "claude", documents: [card] };

async function chat(review: boolean) {
  const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
  client.chat = [answer];
  client.docTexts[card.path] = "## Scope\n\nFilter by size.\n";
  if (review) client.state.review = true;
  await renderIn("en", <ChatView client={client} state={client.state} components={{}} stateBlocks={[]} />);
  return client;
}
async function openReader() {
  fireEvent.click(await screen.findByRole("button", { name: /Filter/ }));
  return screen.findByRole("complementary", { name: "Document" });
}

describe("focus mode (review spec §6.2)", () => {
  it("'Focus' shows only the document, holds the turn's end, and Esc leaves with a summary", async () => {
    const client = await chat(true);
    const composer = screen.getByRole("textbox");
    fireEvent.change(composer, { target: { value: "Go on" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const reader = await openReader();
    fireEvent.click(within(reader).getByRole("button", { name: "Focus" }));
    expect(document.querySelector(".hh-body.hh-focus")).not.toBeNull();
    expect(client.focus.current()).toEqual({ on: true, path: "specs/a.md" });
    expect(within(reader).getByRole("button", { name: "Leave focus" })).toBeTruthy();
    act(() => client.emit({ type: "done", ok: false, error: { code: "out-of-quota" } }));
    expect(document.activeElement?.tagName).not.toBe("TEXTAREA");
    expect(document.querySelector("[aria-live='polite']")?.textContent).toBe("");
    fireEvent.keyDown(await within(reader).findByRole("heading", { name: "Scope" }), { key: "Escape" });
    expect(document.querySelector(".hh-focus")).toBeNull();
    expect(screen.getByRole("complementary", { name: "Document" })).toBeTruthy();
    expect(await screen.findByText("While you were reading: your plan's limit ran out.")).toBeTruthy();
    expect(client.focus.current()).toEqual({ on: false });
  });

  it("client.documents.focus(path) opens the reader in focus mode", async () => {
    const client = await chat(true);
    await screen.findByText("I wrote the spec.");
    act(() => client.documents.focus("specs/a.md"));
    const reader = await screen.findByRole("complementary", { name: "Document" });
    expect(within(reader).getByRole("button", { name: "Leave focus" })).toBeTruthy();
  });

  it("without `review` there is no Focus button, and documents.focus does nothing (D0)", async () => {
    const client = await chat(false);
    const reader = await openReader();
    await within(reader).findByRole("heading", { name: "Scope" });
    expect(within(reader).queryByRole("button", { name: "Focus" })).toBeNull();
    fireEvent.click(within(reader).getByRole("button", { name: "Close" }));
    act(() => client.documents.focus("specs/a.md"));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("complementary", { name: "Document" })).toBeNull();
  });
});
```

The send in the first test only makes a turn live before focus mode starts; if the composer's button has another name, use that.

- [ ] **Step 3: Run them to see them fail**

Run: `corepack pnpm vitest run packages/ui/test/focus-notices.test.ts packages/ui/test/focus-mode.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Write `focus-notices.ts`**

```ts
/** What focus mode held back (§6.2): the three notices that exist today (Conflicts 4). */
export interface Paused {
  waiting: boolean;
  quota: boolean;
  proposals: number;
}
export const NO_PAUSED: Paused = { waiting: false, quota: false, proposals: 0 };

export function countPaused(p: Paused, e: { waiting?: boolean; quota?: boolean; proposal?: boolean }): Paused {
  return { waiting: p.waiting || e.waiting === true, quota: p.quota || e.quota === true, proposals: p.proposals + (e.proposal ? 1 : 0) };
}

type T = (key: string, opts?: Record<string, unknown>) => string;

/** The line shown on leaving focus mode, or null when nothing was held back. */
export function pausedSummary(t: T, p: Paused): string | null {
  const items = [
    ...(p.waiting ? [t("focus.waiting")] : []),
    ...(p.quota ? [t("focus.quota")] : []),
    ...(p.proposals > 0 ? [t("focus.proposal", { count: p.proposals })] : []),
  ];
  return items.length > 0 ? t("focus.summary", { items: items.join(", ") }) : null;
}
```

- [ ] **Step 5: Write `FocusMarkers.tsx`**

```tsx
import { useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReviewComment } from "./client";

/** Margin dots beside the marks in focus mode (§6.2): the column is hidden; a dot opens its card. */
export function FocusMarkers({ comments, ranges, host, onPick }: { comments: ReviewComment[]; ranges: Map<string, Range>; host: HTMLElement | null; onPick(id: string): void }) {
  const { t } = useTranslation();
  const [tops, setTops] = useState<{ id: string; top: number; text: string }[]>([]);
  useLayoutEffect(() => {
    if (!host) return setTops([]);
    const base = host.getBoundingClientRect().top - host.scrollTop;
    setTops(
      comments.flatMap((c) => {
        const r = ranges.get(c.id);
        return r && c.state !== "resolved" ? [{ id: c.id, top: r.getBoundingClientRect().top - base, text: c.text }] : [];
      }),
    );
  }, [comments, ranges, host]);
  return (
    <div className="hh-focus-markers">
      {tops.map((m) => (
        <button key={m.id} type="button" className="hh-focus-marker" style={{ top: m.top }} aria-label={t("focus.marker", { text: m.text })} onClick={() => onPick(m.id)} />
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Wire focus into the reader and the chat**

`DocumentReader.tsx` (props `focus?: boolean; onFocus?(on: boolean): void` from Task 13):
- in `hh-reader-actions`, before the full-screen button, only with `review && onFocus`:

```tsx
          {review && onFocus && (
            <button type="button" aria-pressed={focus === true} onClick={() => onFocus(!focus)}>
              {focus ? t("focus.leave") : t("focus.enter")}
            </button>
          )}
```

  and the full-screen button is hidden while `focus`.
- the aside's class gains `${focus ? " hh-reader-focus" : ""}`; with `focus`, the contents list is not drawn, the column is not drawn unless a marker picked a card (`const [peek, setPeek] = useState<string | null>(null)`; the column then shows only that card: pass `review={{ ...rv.review, comments: rv.review.comments.filter((c) => c.id === peek) }}`), and `<FocusMarkers comments={rv.review.comments} ranges={ranges} host={scrollRef.current} onPick={setPeek} />` goes inside `hh-reader-scroll`. The `ReviewBar` moves inside `hh-reader-scroll`, after the article (the last thing in the document column, Decisions "UI").
- `onKeyDown`: `Escape` with `focus` (and no pick, no prefs open) calls `onFocus(false)` instead of `onClose()`.

`ChatView.tsx`:

```tsx
  const [focus, setFocus] = useState(false);
  const focusRef = useRef(false);
  const paused = useRef<Paused>(NO_PAUSED);
  const setFocusMode = useCallback(
    (on: boolean, path?: string) => {
      focusRef.current = on;
      setFocus(on);
      client.focus.set(on && path ? { on: true, path } : { on: false });
      if (!on) {
        const line = pausedSummary(t, paused.current);
        paused.current = NO_PAUSED;
        if (line) setNotice(line);
      }
    },
    [client, t],
  );
  useEffect(
    () =>
      client.documents.onFocus((p) => {
        if (!state.review || typeof p !== "string" || !p) return;
        showReader({ path: p });
        setFocusMode(true, p);
      }),
    [client, state.review, setFocusMode],
  );
```

- the turn-end effect (the one that calls `inputRef.current?.focus()` and `setAnnouncement`): when `focusRef.current`, do not call either, and instead count:

```tsx
      if (focusRef.current) {
        const last = chat.entries.at(-1);
        paused.current = countPaused(paused.current, { waiting: tasks.current?.status === "waiting", quota: last?.error?.code === "out-of-quota" });
      } else {
        setAnnouncement(…as today…);
        inputRef.current?.focus();
      }
```

- a new effect counts a phase proposal while in focus: `useEffect(() => { if (focusRef.current && tasks.current?.phaseProposal) paused.current = countPaused(paused.current, { proposal: true }); }, [tasks.current?.phaseProposal?.to, tasks.current?.phaseProposal?.reason])`.
- `closeReader` also calls `setFocusMode(false)` when `focusRef.current`.
- the reader gets `review={state.review === true}`, `busy={…}`, `focus={focus}`, `onFocus={(on) => setFocusMode(on, reader?.path)}`.
- `hh-body` gains `${focus && reader ? " hh-focus" : ""}`.

`styles.css`:

```css
.hh-focus > :not(.hh-reader) { display: none; }
.hh-focus .hh-reader { flex: 1 1 auto; border-left: 0; }
.hh-reader-focus .hh-reader-doc { max-width: 68ch; }
.hh-reader-focus .hh-review-column { position: absolute; right: 16px; top: 56px; width: 300px; max-height: 60vh; border: 1px solid var(--hh-line); border-radius: 8px; background: var(--hh-surface); }
.hh-focus-markers { position: absolute; top: 0; right: 8px; width: 12px; }
.hh-focus-marker { position: absolute; right: 0; width: 10px; height: 10px; padding: 0; border-radius: 50%; border: 0; background: var(--hh-review-active); }
```

- [ ] **Step 7: Run the tests**

Run: `corepack pnpm vitest run packages/ui`
Expected: PASS; every existing chat test unchanged (focus off by default).

- [ ] **Step 8: Typecheck, test, build, commit**

```bash
git -C <worktree> add packages/ui packages/i18n
git -C <worktree> commit -m "feat(ui): focus mode with paused notices and a summary on leaving"
```

---

### Task 17: The terminal — the tools in `run`, and the `Review:` line

**Files:**
- Modify: `packages/cli/src/run.ts`, `packages/cli/src/terminal.ts`
- Test: `packages/cli/test/terminal.test.ts` (append), `packages/cli/test/run.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `packages/cli/test/terminal.test.ts`:

```ts
describe("the Review line (review spec §6.3)", () => {
  it("follows a document's line with its review, when it has one", () => {
    const out = memoryStream();
    const summaries: Record<string, ReviewSummary> = {
      "specs/a.md": { status: "draft", questions: 2, blocking: 1, unsent: 0, comments: 2 },
      "specs/b.md": { status: "approved", questions: 0, blocking: 0, unsent: 0, comments: 0, approvedAt: "2026-10-28T10:00:00.000Z" },
      "specs/c.md": { status: "stale", questions: 0, blocking: 0, unsent: 0, comments: 0 },
    };
    const view = new TerminalView(out.stream, "Claude", false, {}, () => undefined, (p) => summaries[p] ?? null);
    view.event({ type: "documents", documents: ["a", "b", "c", "d"].map((n) => ({ path: `specs/${n}.md`, title: n, change: "updated" as const, words: 10 })) });
    expect(out.text()).toBe(
      [
        "Documents: specs/a.md (updated)",
        "Review: 2 questions open (1 blocking)",
        "Documents: specs/b.md (updated)",
        "Review: approved",
        "Documents: specs/c.md (updated)",
        "Review: changed since approval",
        "Documents: specs/d.md (updated)",
        "",
      ].join("\n"),
    );
  });

  it("without a review function nothing changes (D0)", () => {
    const out = memoryStream();
    const view = new TerminalView(out.stream, "Claude");
    view.event({ type: "documents", documents: [{ path: "a.md", title: "a", change: "new", words: 1 }] });
    expect(out.text()).toBe("Documents: a.md (new)\n");
  });
});
```

(import `type ReviewSummary` from `@humanharness/harness-sdk/review`.)

Append to `packages/cli/test/run.test.ts`, inside `describe("runTask", …)` (it reuses the file's `ui`, `result`, `lines`, `root` and the fake-claude helpers; `data-harness` is an edit-folder harness, `material-harness` an edit-none one, both with a `study` action):

```ts
  it("an edit-folder harness's agent asks in a document and the run prints the Review line (review spec §6.3)", { timeout: 60_000 }, async () => {
    const study = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/data-harness");
    const folder = path.join(root, "study-review");
    const script: ClaudeScript = {
      steps: [...claudeTextLines("Done."), result],
      turns: [
        { match: "save_note", steps: [ui("save_note", { title: "Plan", summary: ["x"], decisions: [], files: [], open: [] }), result] },
        {
          match: "# Task: study",
          steps: [
            { write: { path: "notes/plan.md", content: "## Scope\n\nBy size.\n" } },
            ui("ask_in_document", { path: "notes/plan.md", quote: "By size.", question: "Size only?", options: [{ label: "Keep", text: "By size." }, { label: "Colour", text: "By size and colour." }] }),
            ...claudeTextLines("I asked in the plan."),
            result,
          ],
        },
      ],
    };
    const out = memoryStream();
    await runTask({
      harnessDir: study,
      action: "study",
      engine: "claude",
      folder,
      input: lines("q\n"),
      output: out.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, script) } },
    });
    expect(out.text()).toContain("Documents: notes/plan.md (new)\nReview: 1 question open\n");
    expect(fs.existsSync(path.join(folder, ".harness", "reviews", "notes", "plan.md.json"))).toBe(true);
  });

  it("an edit-none harness prints no Review line and keeps no record (D0)", { timeout: 60_000 }, async () => {
    const material = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/material-harness");
    const folder = path.join(root, "study-no-review");
    const script: ClaudeScript = {
      steps: [...claudeTextLines("Done."), result],
      turns: [
        { match: "save_note", steps: [ui("save_note", { title: "x", summary: ["x"], decisions: [], files: [], open: [] }), result] },
        { match: "# Task: study", steps: [...claudeTextLines("Read it."), result] },
      ],
    };
    const out = memoryStream();
    await runTask({
      harnessDir: material,
      action: "study",
      engine: "claude",
      folder,
      input: lines("q\n"),
      output: out.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, script) } },
    });
    expect(out.text()).not.toContain("Review:");
    expect(fs.existsSync(path.join(folder, ".harness", "reviews"))).toBe(false);
  });
```

If `material-harness`'s `runTask` needs extra setup (its material folder), copy what that file's material case does; the assertions stay the same. The tool list of an edit-none harness is checked in Tasks 8 and 9.

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/cli/test/terminal.test.ts packages/cli/test/run.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the code**

`packages/cli/src/terminal.ts`: a sixth constructor parameter:

```ts
    /** A document's review summary (review spec §6.3); absent for a harness whose agent can't edit the folder (D0). */
    private readonly reviewOf: (path: string) => ReviewSummary | null = () => null,
```

and in `event`, the documents branch:

```ts
    else if (e.type === "documents")
      for (const d of e.documents) {
        const path = plain(d.path);
        if (!path) continue;
        this.line(`Documents: ${path} (${d.change})`);
        const r = this.reviewOf(d.path);
        if (r) this.line(`Review: ${reviewLine(r)}`);
      }
```

with, above the class:

```ts
/** The terminal's review line (§6.3). */
export function reviewLine(r: ReviewSummary): string {
  if (r.status === "approved") return "approved";
  if (r.status === "stale") return "changed since approval";
  if (r.questions === 0) return r.comments > 0 ? `${r.comments} comment${r.comments === 1 ? "" : "s"} open` : "in review";
  return `${r.questions} question${r.questions === 1 ? "" : "s"} open${r.blocking > 0 ? ` (${r.blocking} blocking)` : ""}`;
}
```

`summarizeReview` for a record with an open question returns `status: "draft"`; the line reads the counts.

`packages/cli/src/run.ts`:

```ts
import { ReviewLocks, reviewSummarySync, runReviewRequest } from "@humanharness/workspace";

  const canReview = harness.permissions.edit === "folder";
  const reviewLocks = new ReviewLocks();
```

- the `TerminalView` gets `canReview ? (p) => reviewSummarySync(folder, p) : undefined` as its sixth argument (pass `undefined` explicitly: the default applies).
- in `createRuntime({ … })`:

```ts
      // The review tools (review spec §4), as the app's main process wires them; only when the agent may edit (D0).
      ...(canReview ? { review: (request: unknown) => runReviewRequest({ base: folder, locks: reviewLocks, task: async () => {
        const t = await tasks.runningTask();
        return t ? { id: t.id, scope: t.scope } : null;
      } }, request) } : {}),
```

`reviewSummarySync` (Task 6) reads the document and its record without the lock (a read-only line) and returns null on any problem.

- [ ] **Step 4: Run the tests, typecheck, test, commit**

Run: `corepack pnpm vitest run packages/cli`, `corepack pnpm typecheck`, `corepack pnpm test`. Expected: green.

```bash
git -C <worktree> add packages/cli
git -C <worktree> commit -m "feat(cli): review tools in run and a Review line under each document"
```

---

### Task 18: End to end in mock mode

**Files:**
- Create: `packages/fake-agent/fixtures/review-harness/harness.config.ts`, `packages/fake-agent/fixtures/review-harness/agent/AGENTS.md`, `packages/fake-agent/fixtures/review-harness/agent/tasks/ticket.md`, `packages/fake-agent/fixtures/review-harness/agent/phases/spec.md`, `packages/fake-agent/fixtures/review-harness/agent/phases/plan.md`, `packages/fake-agent/fixtures/review-harness/mock/ticket.json`
- Modify: `packages/e2e/tests/helpers.ts`
- Create: `packages/e2e/tests/review.spec.ts`

- [ ] **Step 1: The fixture harness**

`packages/fake-agent/fixtures/review-harness/harness.config.ts`:

```ts
// Test fixture for document reviews: the agent edits the folder; a ticket's spec part ends when specs/*.md is approved.
import { defineHarness } from "@humanharness/harness-sdk";

export default defineHarness({
  id: "reviewer",
  name: "Reviewer",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Reviewer" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "folder", exec: false, web: false },
  blocks: {},
  documents: { kinds: { spec: { when: "A feature's spec.", sections: ["Scope"], reviewTier: "standard" } } },
  actions: {
    ticket: {
      label: "Ticket",
      prompt: "./agent/tasks/ticket.md",
      cost: "light",
      phases: [
        { id: "spec", label: "Spec", brief: "./agent/phases/spec.md", approve: "specs/*.md" },
        { id: "plan", label: "Plan", brief: "./agent/phases/plan.md" },
      ],
    },
  },
  path: ["ticket"],
  author: "Human Harness tests",
});
```

(Check the `documents.kinds` shape against `documentKindSchema` from plan 10; adjust the keys it requires.)

`agent/AGENTS.md`: `You write specs for tickets in specs/.`; `agent/tasks/ticket.md`: `# Task: ticket\n\nWrite the spec for the ticket the person describes.`; `agent/phases/spec.md`: `Write the spec in specs/.`; `agent/phases/plan.md`: `Plan the work.`.

`packages/fake-agent/fixtures/review-harness/mock/ticket.json`:

```json
{
  "version": 1,
  "action": "ticket",
  "match": "# Task: ticket",
  "recordedWith": "hand-written",
  "turns": [
    {
      "id": "t1",
      "text": "I wrote the spec in specs/filter.md and left two questions in it.",
      "writes": [
        {
          "path": "specs/filter.md",
          "content": "---\ntitle: Filter\nkind: spec\n---\n## Scope\n\nFilter by size.\n\nResults keep their order.\n\nThe list loads at once.\n"
        }
      ],
      "blocks": [
        {
          "tool": "ask_in_document",
          "input": {
            "path": "specs/filter.md",
            "quote": "Filter by size.",
            "question": "Size only, or colour too?",
            "options": [
              { "label": "Size only", "text": "Filter by size." },
              { "label": "Size and colour", "text": "Filter by size and colour." }
            ],
            "blocking": true
          }
        },
        {
          "tool": "ask_in_document",
          "input": {
            "path": "specs/filter.md",
            "quote": "Results keep their order.",
            "question": "Keep the order?",
            "options": [
              { "label": "Keep", "text": "Results keep their order." },
              { "label": "Sort by name", "text": "Results are sorted by name." }
            ]
          }
        }
      ],
      "next": { "*": "t2" }
    },
    {
      "id": "t2",
      "text": "Done: the list now loads in pages.",
      "writes": [
        {
          "path": "specs/filter.md",
          "content": "---\ntitle: Filter\nkind: spec\n---\n## Scope\n\nFilter by size and colour.\n\nResults keep their order.\n\nThe list loads in pages of 50.\n"
        }
      ],
      "blocks": [{ "tool": "reply_to_comment", "input": { "path": "specs/filter.md", "id": "c3", "reply": "Pages of 50.", "resolve": true } }]
    },
    { "id": "t3", "text": "Plan: one step per filter.", "setPhase": "plan" },
    { "id": "close", "note": { "title": "Filter", "summary": ["Spec approved"], "decisions": [], "files": ["specs/filter.md"], "open": [] } }
  ]
}
```

The t2 write keeps the person's answer ("size and colour", already swapped in by the app before the round) and changes the commented line. `c3` is the person's comment (the agent's questions are c1 and c2). The mock writes its files before it calls the tools (`mock-claude.ts`), so `ask_in_document` finds the file.

- [ ] **Step 2: `launchMock` takes an app path**

`packages/e2e/tests/helpers.ts`:

```ts
export async function launchMock(s: Sandbox, mockDir: string = demoMockDir, app: string = shellDir): Promise<{ app: ElectronApplication; page: Page }> {
  …
    args: [app, "--lang=en"],
  …
}
```

Every existing caller passes two arguments; nothing else changes.

- [ ] **Step 3: Write the e2e test**

Create `packages/e2e/tests/review.spec.ts`:

```ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, expect, test } from "@playwright/test";
import { closeAndClean, launchMock, makeSandbox, shellDir } from "./helpers";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/review-harness");
const readTasks = (folder: string) => JSON.parse(fs.readFileSync(path.join(folder, ".harness", "tasks.json"), "utf8"));
const readRecord = (folder: string) => JSON.parse(fs.readFileSync(path.join(folder, ".harness", "reviews", "specs", "filter.md.json"), "utf8"));

test("review a spec: answer, comment, send, focus, approve with a reason, the part moves on, stale after a change", async () => {
  test.setTimeout(300_000);
  const s = makeSandbox("review");
  const outDir = path.join(shellDir, "out", "review");
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: outDir };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined;
  try {
    execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
    const launched = await launchMock(s, path.join(fixture, "mock"), path.join(outDir, "main", "index.js"));
    app = launched.app;
    const page = launched.page;
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await page.getByRole("button", { name: "Start Reviewer" }).click();
    await page.getByRole("button", { name: /Ticket/ }).first().click();
    await page.getByRole("textbox").fill("Filter the list");
    await page.keyboard.press("Enter");

    // The card carries the review chip; it opens the reader with the Comments column.
    const card = page.getByRole("button", { name: /Filter/ }).first();
    await expect(card).toContainText("2 questions open");
    await expect(card).toContainText("1 blocking");
    await card.click();
    const reader = page.getByRole("complementary", { name: "Document" });
    const column = reader.getByRole("region", { name: "Comments" });
    await expect(column.locator("article")).toHaveCount(2);

    // An answer swaps the passage at once, with no turn.
    await column.getByRole("radio", { name: "Size and colour" }).click();
    await expect(reader.getByText("Filter by size and colour.")).toBeVisible();
    await expect.poll(() => fs.readFileSync(path.join(s.folder, "specs", "filter.md"), "utf8")).toContain("Filter by size and colour.");

    // "Other…" on the second question: kept for the round, the text stays.
    await column.getByRole("button", { name: "Other…" }).nth(1).click();
    await column.getByRole("textbox", { name: "Your answer" }).fill("Newest first");
    await column.getByRole("button", { name: "Save answer" }).click();

    // A comment on a selected paragraph.
    await reader.getByText("The list loads at once.").click({ clickCount: 3 });
    await reader.getByRole("button", { name: "Comment" }).click();
    await reader.getByRole("textbox", { name: "Your comment" }).fill("Load in pages.");
    await reader.getByRole("button", { name: "Save draft" }).click();
    await expect(column.locator("article")).toHaveCount(3);

    // One round carries the comment and the Other answer; the agent edits and replies.
    await reader.getByRole("button", { name: "Send comments (2)" }).click();
    await expect(reader.getByText("The list loads in pages of 50.")).toBeVisible({ timeout: 30_000 });
    await expect(column.getByText("Pages of 50.")).toBeVisible();

    // Focus mode: only the document. The blocking question has an answer, so approving needs no reason.
    await reader.getByRole("button", { name: "Focus" }).click();
    await expect(page.locator(".hh-body.hh-focus")).toHaveCount(1);
    await reader.getByRole("button", { name: /^Approve/ }).click();
    await expect(reader.getByText(/^Approved · /)).toBeVisible();
    expect(readRecord(s.folder).approvals).toHaveLength(1);

    // The spec part ended: the task moved to Plan on its own, by the person.
    await expect.poll(() => readTasks(s.folder).current?.phase?.id, { timeout: 30_000 }).toBe("plan");
    await page.keyboard.press("Escape");
    await expect(page.locator(".hh-focus")).toHaveCount(0);
    await expect(page.getByText(/^While you were reading: /)).toBeVisible();

    // A change after approval: stale, and "See what changed" shows the diff.
    fs.appendFileSync(path.join(s.folder, "specs", "filter.md"), "\nOne more line.\n");
    await reader.getByRole("button", { name: "Close" }).click();
    await card.click();
    await expect(reader.getByText("Changed since approval")).toBeVisible();
    await reader.getByRole("button", { name: "See what changed" }).click();
    await expect(reader.getByRole("region", { name: "Changes since the approval" })).toContainText("One more line.");

    expect(errors.filter((e) => e.includes("Content Security Policy"))).toEqual([]);
  } finally {
    try {
      if (app) await closeAndClean(app, s);
      else fs.rmSync(s.root, { recursive: true, force: true });
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
});

test("approve anyway, with a reason, while a blocking question is open", async () => {
  test.setTimeout(300_000);
  const s = makeSandbox("review-reason");
  const outDir = path.join(shellDir, "out", "review");
  let app: ElectronApplication | undefined;
  try {
    build(outDir);
    const launched = await launchMock(s, path.join(fixture, "mock"), path.join(outDir, "main", "index.js"));
    app = launched.app;
    const page = launched.page;
    await startTicket(page);
    const card = page.getByRole("button", { name: /Filter/ }).first();
    await card.click();
    const reader = page.getByRole("complementary", { name: "Document" });
    await reader.getByRole("button", { name: "Approve · 1 blocking open" }).click();
    await reader.getByRole("button", { name: "Approve anyway, with a reason" }).click();
    await reader.getByRole("textbox", { name: "Why approve with blocking questions open?" }).fill("Decided on the call");
    await reader.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(reader.getByText(/^Approved · /)).toBeVisible();
    expect(readRecord(s.folder).approvals.at(-1).reason).toBe("Decided on the call");
    await expect.poll(() => readTasks(s.folder).current?.phase?.id, { timeout: 30_000 }).toBe("plan");
    expect(readTasks(s.folder).current.phases.at(-1)).toMatchObject({ id: "plan", by: "person" });
    await expect(card).toContainText("Approved");
  } finally {
    try {
      if (app) await closeAndClean(app, s);
      else fs.rmSync(s.root, { recursive: true, force: true });
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
});
```

Factor the first test's build and start into two helpers at the top of the file, and use them in both tests:

```ts
function build(outDir: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: outDir };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
}
async function startTicket(page: Page) {
  await page.getByRole("button", { name: "Start Reviewer" }).click();
  await page.getByRole("button", { name: /Ticket/ }).first().click();
  await page.getByRole("textbox").fill("Filter the list");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /Filter/ }).first()).toContainText("2 questions open");
}
```

(`Page` comes from `@playwright/test`.) The line the task gets ("The person approved specs/filter.md, with reason: …") is checked in Task 11's unit test; mock mode does not log prompts.

- [ ] **Step 4: Run it**

Run: `corepack pnpm e2e -- review.spec.ts`
Expected: PASS. Then the whole suite: `corepack pnpm e2e`. Expected: PASS (the reader's, phases' and mock specs unchanged).

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/fake-agent/fixtures/review-harness packages/e2e/tests/helpers.ts packages/e2e/tests/review.spec.ts
git -C <worktree> commit -m "test(e2e): review a spec in mock mode, from questions to approval"
```

---

### Task 19: Documentation

**Files:**
- Create: `docs/architecture/reviews.md`
- Modify: `docs/architecture/documents.md`, `docs/architecture/phases.md`, `docs/architecture/manifest.md`, `docs/architecture/history.md`, `docs/architecture/mock-mode.md`, `docs/superpowers/specs/2026-10-27-document-review-and-focus-design.md`

- [ ] **Step 1: Write `docs/architecture/reviews.md`**

Same shape as `docs/architecture/documents.md` and `phases.md` (short sections, plain English, file paths in "Where to look"). Sections and what each says:

- **What a review is.** Questions the agent asks in a document, with options that carry their replacement text; the person's comments on selected text; rounds; approval of a version. Only for harnesses whose agent edits the folder (D0).
- **The record.** `.harness/reviews/<path>.json`: the fields (`path`, `task`, `scope`, `comments`, `approvals`), comment states (`draft`, `open`, `answered`, `sent`, `resolved`, `lost`), ids `cN`, the extra `unapplied`. Written atomically, one writer per document (`ReviewLocks`), tracked by the history; a broken record shows the document without review controls.
- **Anchors.** Quote + heading slug + occurrence; how they are found again; `lost`; the strict form for swaps; selections mapped back through `project`; marks drawn with `CSS.highlights` (no CSP change); diagrams get a note, never a mark.
- **The agent's tools.** `ask_in_document`, `reply_to_comment`, `read_review`; the rpc channel (`HH_REVIEW_RPC`); the error messages; the three lines in `AGENTS.md`.
- **The person's side.** Answers (swap guard, wait for the turn, `Answer:` commit), comments and drafts, the batch message format, where the round goes (waiting task, else a "Review <title>" task at the kind's `reviewTier`), approval (`Approved:` commit, reason when a blocking question is open, unsent prompt), stale and "See what changed".
- **Phases.** The `approve` glob and how an approval moves the open task (`by: "person"`).
- **Focus mode.** What it hides, what it pauses (the three notices), the summary line, `client.focus`.
- **For harness views.** `client.documents.*` and `client.focus.*`, results as data.
- **Terminal.** The `Review:` line.
- **D0.** The list from this plan's D0 rule.
- **Known gaps.** No per-file wait (parallel tasks); no Sidekick before-approve; notices that do not exist yet; marks are best-effort (a quote whose rendered text differs from its projection gets no mark).
- **Where to look.** The files of the File Structure table.

- [ ] **Step 2: Cross references**

- `documents.md`: a "Reviews" paragraph pointing to `reviews.md`; the reader's footer, column and Focus button in its "The reader" section.
- `phases.md`: under "What a phase is", the optional `approve` glob (syntax from Decisions "Phases") and "Who moves": an approval can move the task (`by: "person"`).
- `manifest.md`: `phases[].approve` and `documents.kinds.*.reviewTier`, and the three reserved tool names.
- `history.md`: `.harness/reviews/` is kept like notes and data; the `Answer:` and `Approved:` commits; `readBlob`.
- `mock-mode.md`: recordings can call `ask_in_document` and `reply_to_comment` like any ui tool; the review fixture.
- The spec's status line: `Status: implemented (plan docs/superpowers/plans/2026-10-28-document-review-and-focus.md)`.

- [ ] **Step 3: Check the docs against the code**

Run: `corepack pnpm typecheck` and `corepack pnpm test` (the docs tests that check file references, if any, stay green). Read each changed doc once against the code it names.

- [ ] **Step 4: Commit**

```bash
git -C <worktree> add docs
git -C <worktree> commit -m "docs: document reviews, approve on phases, focus mode"
```

---

## Self-review against the spec

| Spec | Where |
|---|---|
| §3 record, anchors, `lost`, occurrence | Tasks 1, 5, 6 |
| §4 three tools, errors, `AGENTS.md` lines, jobs | Tasks 7, 8, 9 (jobs: Conflicts 1) |
| §5.1 answer swaps at once, guard, "No answer", "Other", wait for the turn, commit | Tasks 3, 10, 13 |
| §5.2 comment on a selection, drafts | Tasks 2, 10, 14 |
| §5.3 batch, "Send comments (N)", where the round goes, tier | Tasks 3, 10, 11, 14 |
| §5.4 approve, blocking + reason, unsent prompt, stale, "See what changed", the task told | Tasks 4, 10, 11, 14 |
| §5.5 `approve` on a phase | Tasks 4, 5, 11 |
| §5.6 `client.documents`, `client.focus` | Task 12 (shape: Conflicts 5) |
| §6.1 marks, column, cards, chips, diagrams | Tasks 2, 13, 15 |
| §6.2 focus mode, paused notices, summary, Esc | Task 16 (notices: Conflicts 4) |
| §6.3 terminal | Task 17 |
| §7 history, undo | Tasks 6, 10 |
| §8 tests, e2e | Every task; Task 18 |
| §11.1 diagrams | Tasks 2, 13 |
| §11.2 reopen | Tasks 10, 13 |
| §11.3 `reviewTier` | Tasks 5, 10, 11 |
| D0 | Tasks 5, 8, 9, 12, 13, 15, 16, 17 |

## Open questions

Each has a proposed default; the plan is written with the default.

- **Q1. Which harnesses get reviews?** Default: every harness whose agent may edit the folder (`permissions.edit: "folder"`): the tools, the three guide lines and the reader's Comment/Approve/Focus controls, even if it never uses them. The alternative is an opt-in manifest key (`documents.review: true`).
- **Q2. Approve a document with no record?** Default: yes. "Approve" is always there for an edit-folder harness; approving makes the record.
- **Q3. Where does a round go when the open task isn't the record's task?** Default: to whichever task waits now; only with no task open does it start "Review <title>" (starting one would close the open task).
- **Q4. "The document's task is told" (§5.4).** Default: a line put before that task's next message, no extra turn. The alternative is a short app-started turn, which costs tokens.
- **Q5. Comments after approval.** Default: allowed; answers are locked until the document changes, comments are not (a round's edits then make the approval stale).
- **Q6. Reopen.** Default: a resolved comment goes back to draft (the next round carries it); a resolved question to open, or answered if it has an answer.
- **Q7. Marks are best-effort.** Default: a quote the window can't find in the rendered text (tables with inline markup, footnotes) gets no mark; its card still shows and works.
- **Q8. Copy.** Default: the spec's Spanish mockup strings become English keys (`review.*`, `focus.*`); translations come from the language-on-demand feature.
- **Q9. The spec file.** Default: Task 0 brings it from `origin/master` onto the branch so the plan and spec travel together.
