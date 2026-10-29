# Sidekick, part 1 (pre-send review) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship delivery slice 1 of the Sidekick spec: one prompt-coach sidekick that checks the person's prompt locally before it goes out, asks a light model only when something looks off (or when the action says `always`, or the person presses Review), and shows a suggestion card in its own panel; with its own no-tools session per task, a 6 s timeout, usage tagging, a per-task cap, settings in the reserved `sidekick` collection, Settings › Sidekick, a Sidekick row in Settings › Models and a Sidekick line in Settings › Usage.

**Architecture:** A deterministic local check (`packages/workspace/src/sidekick-checks.ts`, 0 tokens) runs first in the main process. When the review needs the model, a `SidekickController` (`packages/shell/src/main/sidekick.ts`) opens, once per task, a `SidekickSession` (`packages/runtime/src/sidekick.ts`): a second transport with its own session id, no tools, no MCP servers, and its own working folder holding a generated `AGENTS.md` (the core's Sidekick rules plus the harness `tips`). The model answers a JSON contract, parsed with zod; anything wrong (timeout, invalid JSON, engine error, cap reached) sends the prompt as typed. The renderer asks for a review on Enter, shows "Reviewing…" with the countdown, and renders the card in a 330 px right panel (a 52 px rail when collapsed). Turns are logged in `usage.jsonl` as their own kind, kept out of the task estimates.

**Tech Stack:** TypeScript, zod 4, Electron 44 (main + preload), React 19, i18next, Vitest (+ happy-dom for UI), Playwright e2e with fake-claude, pnpm via corepack.

**Spec:** `docs/superpowers/specs/2026-10-25-sidekick-design.md` (§3 manifest, §4.1 before you send, §5 the Sidekick session, §7 UI, §8 Settings and cost, §10 slice 1). Part 2 (`docs/superpowers/plans/2026-10-27-sidekick-part2.md`) covers slices 2–5.

---

## Conventions

**Code.**
- Every UI string goes in `packages/i18n/src/locales/en.json` under a **new top-level `"sidekick"` block**, added once (Task 14) and extended only inside that block. Never edit other blocks of en.json: the document-reader line edits the same file. The Settings tab label is `sidekick.tab`, so the one-line `settings.tabs` object stays untouched.
- `@humanharness/ui` imports only types from other packages. Colours only through `--hh-*` tokens.
- Main-process modules take their I/O as deps (like `material-stage.ts`), so they test without Electron.
- English everywhere: code, comments, prompts, the Sidekick brief, UI labels.
- Hot files shared with the document-reader line get only small additive edits: `packages/i18n/src/locales/en.json` (one new block), `packages/ui/src/client.ts` (new types at the end, one field in `AppState`, one namespace in `HarnessClient`), `packages/shell/src/main/index.ts` (a few imports, one controller block next to `settingsCtl`, one getter line, one `registerSidekickIpc` call, one `modelsView` entry, one `appState` entry), and the `AGENTS.md` managed section (`packages/workspace/src/instructions.ts`) is **not touched at all**: the Sidekick brief is a separate file in a separate folder.

**Commands and git.** Run everything from the worktree root with `git -C <worktree>` or absolute paths. Never a bare `git stash`. Never push. Every commit message ends with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7
```

Every task ends with `corepack pnpm typecheck` and `corepack pnpm test` green; tasks that touch main, preload or UI also run `corepack pnpm app:build`; Task 21 runs `corepack pnpm e2e`.

**Compliance.** Never read `~/.claude`, `~/.codex`, `~/.gemini`, `~/.config/opencode`, `~/.local/share/opencode` or any credential file, in code or in a spike. The Sidekick session runs the unmodified official CLIs with the same flags policy as task sessions (`--setting-sources project`, strict empty MCP config), never touches auth, and its working folder is inside the app's own `userData`.

**D0 is a hard rule.** Sidekick is a core feature (D1), but anything the spec doesn't name stays unchanged for every harness, and the person can turn it off. Concretely, and each with a regression test:
- a manifest without `sidekick` parses to the same object as before (Task 2);
- `dataCollections(h)` still returns `h.data` itself; the `sidekick` collection lives in its own store (Task 3, Task 9);
- `claudeArgs` without `noTools` returns exactly the old argv (Task 6);
- `summarizeUsage` over a log with no Sidekick lines returns exactly the old summary, with no `sidekick` key (Task 8);
- the task's `AGENTS.md` and engine file are never written by Sidekick (Task 5);
- with Sidekick off, a send goes out with no review, no session, no file written and no usage line (Task 11, Task 21);
- ChatView, Settings, Models and Usage render exactly as before when `state.sidekick` is absent (Tasks 15, 17, 18): the existing UI tests (FakeClient without `sidekick`) stay green unchanged.

What the spec names and therefore appears in every harness: the top-bar toggle, the panel/rail, the Settings › Sidekick tab, the Sidekick row in Settings › Models, the Sidekick line in Settings › Usage (only once a Sidekick turn ran). Without a `sidekick` block in the manifest Sidekick starts **off** (spec §3).

## Decisions this plan takes where the spec leaves room

1. **Working folder outside the base.** The spec puts the session's cwd at `<base>/.harness/sidekick/<id>/`. Claude Code loads every `CLAUDE.md` from cwd up to `/`, and Codex reads `AGENTS.md` from the git root down to cwd; the base is a git repo (the history) with the task's `CLAUDE.md`/`AGENTS.md` at its root, so the task's instructions would leak into the Sidekick session (spec §5 "The task's instructions … never load"). The plan uses `<userData>/sidekick/<sha256(resolved base)[0..16]>/<sidekick id>/` instead (still per profile, since each profile has its own base). Task 1 (A2) checks the leak; if the spike shows no leak, the plan still keeps the userData folder (it is never wrong). Part 2's `events.jsonl` stays in `<base>/.harness/sidekick/` as the spec says.
2. **Usage tagging.** `phase` in `usage.jsonl` is already the turn kind (`TurnKind`), so the spec's "`phase` set to `pre`, `after` or `learn`" becomes `phase: "sidekick"` plus the spec's new `process: "sidekick"`, a `moment: "pre" | "after" | "learn"` field and `sidekick: "<id>"`. `summarizeUsage` leaves Sidekick lines out of task estimates, tokens and per-scope totals (like material), marks the turn before one as unmeasurable, and adds `UsageSummary.sidekick` (absent when no Sidekick turn ever ran).
3. **What counts toward the cap.** Input + output + cache-write tokens of the task's Sidekick turns; cache reads are left out (they are the cheap, repeated prefix). The foot shows the same number.
4. **Off-phase without keywords.** Phases have no keywords in the manifest today (`id`, `label`, `brief`, …). The local check uses the words of the other phases' `label`s (4+ letters, minus a stop list). Good enough to flag; the model decides.
5. **Threshold.** Part 1 shows a `suggest` card when `confidence ≥ 0.5` (the spec's starting threshold). Per-kind thresholds come with learning in part 2.
6. **"Always wait"** waits up to 60 s, then sends as typed: a stuck CLI never holds the composer forever.
7. **What is reviewed.** Only free text typed in the composer (a new free question, a new action's prompt typed in the composer, or a follow-up). Block answers, choices' follow-ups and harness UI sends are never reviewed in part 1 (input-block free text comes in part 2). The mode is the open task's action via `sidekick.actions` (default `auto`); free questions are `auto`.
8. **Settings storage.** The `sidekick` collection (app-wide, keyed by `id`, `agent: "none"`) lives in its **own** `DataStore`, not in `dataCollections(h)`: the harness's `rules` snapshot, the history's data diff and the harness UI's `client.data` never see it (D0). Writes go through the person's data path (`personDataRequests`, `Data: sidekick` commit with the open task's trailer, undo with it) via a new optional `storeFor` hook, so they share the person-writes queue.
9. **One sidekick in part 1:** id `sidekick`, name "Sidekick", a neutral SVG mark. Part 2 adds the records.
10. **Panel layout.** Expanded (330 px) when Sidekick is on at start, the 52 px rail when off. When the harness has `renderSide`, the expanded panel's head has a **Sidekick | Harness** segmented switch, and the collapsed rail sits beside the harness panel.
11. **Shown only with `state.sidekick`.** Main always sends `state.sidekick` (core feature). The renderer draws the toggle, panel, tab and Models row only when it is present, so tests with a FakeClient lacking it are unchanged, and `slim` (interview) mode never shows Sidekick.
12. **Mock mode** answers the Sidekick prompt with a canned JSON built from the flags in the prompt (Task 20), so `humanharness dev --mock` shows the card without a model.
13. **Tier.** Process key `sidekick` in `models.tasks`, recommended `light`, resolved when the session opens and fixed for it (plan 3c). The manifest refuses an action whose id is `sidekick`, and `RESERVED_COLLECTIONS` gains `"sidekick"`.
14. **Session per task.** The controller binds a session to the open task's id. A review with no task open (a new question or action being sent) opens a session bound to "no task" which the next task adopts. `betweenTasks` closes any session whose task is no longer open.
15. **Claude with no tools.** A new `noTools?: true` transport option makes `claudeArgs` pass `--tools ""` and deny every built-in tool by name, with an empty strict MCP config; ACP sessions get no MCP servers and the read-only mode.
16. **Card outcomes** are reported back (`client.sidekick.resolve`) in part 1 so the card leaves the panel; part 2 logs them to `events.jsonl`.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `docs/spikes/2026-10-27-sidekick.md` | Create | Spike results A1–A7 |
| `packages/harness-sdk/src/sidekick.ts` | Create | Manifest `sidekick` block, settings record, constants, helpers |
| `packages/harness-sdk/src/index.ts` | Modify | `sidekick` field, reserved action id, unknown actions check, export |
| `packages/harness-sdk/src/data.ts` | Modify | `"sidekick"` in `RESERVED_COLLECTIONS` |
| `packages/harness-sdk/test/sidekick.test.ts` | Create | SDK tests |
| `packages/workspace/src/sidekick-checks.ts` | Create | The local check |
| `packages/workspace/src/sidekick-brief.ts` | Create | Brief text, working folder, brief writer |
| `packages/workspace/src/index.ts` | Modify | Exports |
| `packages/workspace/test/sidekick-checks.test.ts`, `sidekick-brief.test.ts` | Create | Tests |
| `packages/runtime/src/transport.ts` | Modify | `noTools` option |
| `packages/runtime/src/claude-cli.ts` | Modify | No-tools argv |
| `packages/runtime/src/sidekick.ts` | Create | `SidekickSession` |
| `packages/runtime/src/index.ts` | Modify | Exports |
| `packages/runtime/test/sidekick.test.ts` | Create | Tests |
| `packages/shell/src/main/sidekick-turns.ts` | Create | Pre-send prompt and reply parser |
| `packages/shell/src/main/usage-log.ts` | Modify | Sidekick lines, totals, spend |
| `packages/shell/src/main/sidekick-store.ts` | Create | Settings record read/write |
| `packages/shell/src/main/data-requests.ts` | Modify | Optional `storeFor` hook; harness UI refuses `sidekick` |
| `packages/shell/src/main/sidekick.ts` | Create | `SidekickController` |
| `packages/shell/src/main/sidekick-ipc.ts` | Create | IPC handlers |
| `packages/shell/src/main/task-manager.ts` | Modify | `phaseNow()` |
| `packages/shell/src/main/index.ts` | Modify | Wiring (small, additive) |
| `packages/shell/src/preload/index.ts` | Modify | `client.sidekick` |
| `packages/shell/test/sidekick-*.test.ts`, `usage-log.test.ts`, `data-requests.test.ts` | Create/Modify | Tests |
| `packages/ui/src/client.ts` | Modify | Types, `AppState.sidekick`, `HarnessClient.sidekick`, `UsageSummary.sidekick` |
| `packages/ui/src/sidekick/useSidekick.ts` | Create | State hook |
| `packages/ui/src/sidekick/word-diff.ts` | Create | Word diff for the rewrite |
| `packages/ui/src/sidekick/SidekickPanel.tsx` | Create | Panel, rail, card, foot, intro |
| `packages/ui/src/sidekick/FlaggedText.tsx` | Create | Underlined spans behind the composer |
| `packages/ui/src/sidekick/SidekickTab.tsx` | Create | Settings › Sidekick |
| `packages/ui/src/sidekick/mark.tsx` | Create | The Sidekick mark (SVG) |
| `packages/ui/src/ChatView.tsx` | Modify | Composer states, keys, right column |
| `packages/ui/src/chrome.tsx` | Modify | `SidekickToggle` for the top bar |
| `packages/ui/src/HarnessApp.tsx` | Modify | Opens Settings › Sidekick |
| `packages/ui/src/SettingsSheet.tsx` | Modify | The tab |
| `packages/ui/src/ModelsTab.tsx` | Modify | Sidekick row |
| `packages/ui/src/UsageTab.tsx` | Modify | Sidekick line |
| `packages/ui/src/styles.css` | Modify | `.hh-sk-*` styles (appended block) |
| `packages/ui/test/fake-client.ts` | Modify | `sidekick` namespace (off) |
| `packages/ui/test/sidekick-*.test.tsx` | Create | UI tests |
| `packages/i18n/src/locales/en.json` | Modify | New `sidekick` block |
| `packages/cli/src/check.ts` | Modify | `sidekick-tips` warning |
| `packages/fake-agent/src/mock-claude.ts` | Modify | Canned Sidekick answer |
| `packages/e2e/tests/sidekick.spec.ts`, `scripts.ts`, `settings.spec.ts` | Create/Modify | E2E |
| `harnesses/demo/harness.config.ts` | Modify | `sidekick` block (default off) |
| `docs/architecture/sidekick.md` | Create | Architecture page |

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-10-27-sidekick-part1.md`

- [ ] **Step 1: Copy the plan into the repo**

Copy this file to `docs/superpowers/plans/2026-10-27-sidekick-part1.md` in the `feat/sidekick` worktree.

- [ ] **Step 2: Commit**

```bash
git -C <worktree> add docs/superpowers/plans/2026-10-27-sidekick-part1.md
git -C <worktree> commit -m "docs(plans): sidekick part 1 (pre-send review)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 1: Spike — a no-tools Sidekick session on Claude and Codex

Check, with the real CLIs on Marco's machine and a throwaway folder under `/tmp`, the assumptions the rest of the plan builds on. **Never read `~/.claude`, `~/.codex` or credentials**: only run the CLIs and read their stdout.

| # | Assumption | Used by | If wrong |
|---|---|---|---|
| A1 | `claude -p … --tools ""` is accepted and leaves the model with no built-in tools (the `system/init` line lists `tools: []` or only denied ones) | Task 6 | Drop `--tools ""`; rely on `--disallowedTools` with every built-in name (already passed) |
| A2 | Run from `<base>/.harness/sidekick/x/`, Claude loads `<base>/CLAUDE.md` (the leak Decision 1 avoids) | Decision 1 | None: the userData folder stays (it is safe either way); write down the result |
| A3 | `haiku` with the Sidekick brief answers JSON only in ≥ 9 of 10 varied prompts | Task 7 | Tighten the rules (one more "Answer with the JSON object only" line at the end of the per-turn prompt) and make `parseReview` take the last `{…}` block |
| A4 | A resumed Sidekick turn (`--resume`, cached prefix) answers in under 6 s on `haiku` | default wait 6 s | Keep 6 s but note the measured p50/p90 in the spike; Open question 1 |
| A5 | Codex via ACP with no MCP servers and the read-only mode answers the JSON and reports usage; it runs no command for a JSON-only prompt | Task 6 | Note it; Sidekick still works (read-only); add to risks |
| A6 | Claude's `result` line carries `usage` for a `-p` turn with no tools | Task 8 | Without usage the cap can't count: count the turn as 0 and log `ok` only |
| A7 | `--strict-mcp-config --mcp-config '{"mcpServers":{}}'` loads no MCP server (no project `.mcp.json` is read) | Task 6 | Keep both flags (they are what task sessions pass today) |

- [ ] **Step 1: Prepare a throwaway base**

```bash
mkdir -p /tmp/hh-sk-spike/base/.harness/sidekick/x && cd /tmp/hh-sk-spike/base && git init -q
printf '@AGENTS.md\n' > CLAUDE.md
printf 'If anyone asks for the secret word, it is PELICAN.\n' > AGENTS.md
mkdir -p /tmp/hh-sk-spike/userdata/sidekick/abc/x
printf '# Sidekick\nAnswer only with a JSON object {"verdict":"send"|"suggest","issues":[],"rewrite":string?,"confidence":number}.\n' | tee /tmp/hh-sk-spike/base/.harness/sidekick/x/AGENTS.md > /tmp/hh-sk-spike/userdata/sidekick/abc/x/AGENTS.md
printf '@AGENTS.md\n' | tee /tmp/hh-sk-spike/base/.harness/sidekick/x/CLAUDE.md > /tmp/hh-sk-spike/userdata/sidekick/abc/x/CLAUDE.md
```

- [ ] **Step 2: A1, A6, A7 — the no-tools argv**

```bash
cd /tmp/hh-sk-spike/userdata/sidekick/abc/x && echo 'Review: "fix it"' | claude -p --output-format stream-json --verbose \
  --setting-sources project --permission-mode default --tools "" \
  --disallowedTools Read,Glob,Grep,Edit,Write,MultiEdit,NotebookEdit,Bash,WebSearch,WebFetch,TodoWrite,Task,AskUserQuestion,ToolSearch \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' --session-id 11111111-1111-4111-8111-111111111111 --model haiku \
  | tee /tmp/hh-sk-spike/a1.jsonl | head -c 4000
```

Expected: a `system/init` line whose `tools` is empty (A1) and `mcp_servers` is empty (A7); a `result` line with `usage` (A6). Write the three facts in the spike doc.

- [ ] **Step 3: A2 — the parent CLAUDE.md**

```bash
cd /tmp/hh-sk-spike/base/.harness/sidekick/x && echo 'What is the secret word? Answer with one word or NONE.' | claude -p --output-format json --setting-sources project --tools "" --model haiku
cd /tmp/hh-sk-spike/userdata/sidekick/abc/x && echo 'What is the secret word? Answer with one word or NONE.' | claude -p --output-format json --setting-sources project --tools "" --model haiku
```

Expected: the first says PELICAN (leak), the second NONE. Record both.

- [ ] **Step 4: A3, A4 — JSON compliance and latency**

Run 10 prompts (vague, two asks, fine, Spanish, very long) through one session: first with `--session-id`, then `--resume` with the same id; time each with `/usr/bin/time -p`. Record: valid JSON count, p50/p90 seconds of the resumed turns.

- [ ] **Step 5: A5 — Codex**

Use the app's own ACP path: run `corepack pnpm --filter @humanharness/runtime exec tsx -e` with a small script that builds an `AcpTransport` like Task 6's `SidekickSession` does (folder `/tmp/hh-sk-spike/userdata/sidekick/abc/x`, `mcp: []`, `permissions: { edit: "none", exec: false, web: false }`, `...acpFields(codex, "none")`) and sends one review prompt; print the events. Record: text is JSON, `usage` present, no `activity` event of kind `exec`.

- [ ] **Step 6: Write `docs/spikes/2026-10-27-sidekick.md`**

One section per assumption: command, observed output (trimmed), verdict (holds / fails → fallback taken). If a CLI is not installed or not logged in, write "not run" and keep the fallback column's choice.

- [ ] **Step 7: Commit**

```bash
git -C <worktree> add docs/spikes/2026-10-27-sidekick.md
git -C <worktree> commit -m "docs(spikes): sidekick no-tools session on Claude and Codex

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---
### Task 2: SDK — the manifest's `sidekick` block

**Files:**
- Create: `packages/harness-sdk/src/sidekick.ts`
- Modify: `packages/harness-sdk/src/index.ts` (field after `material`, two checks in `superRefine`, `export * from "./sidekick"`)
- Modify: `packages/harness-sdk/src/data.ts:6`
- Test: `packages/harness-sdk/test/sidekick.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/harness-sdk/test/sidekick.test.ts
import { describe, expect, it } from "vitest";
import { RESERVED_COLLECTIONS, SIDEKICK_MIN_WORDS, defineHarness, sidekickMinWords, sidekickMode, sidekickTips } from "../src";

const minimal = {
  id: "notes",
  name: "Notes",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Notes" },
  instructions: "./AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  author: "Me",
} as const;
const action = { label: "Draft", brief: "Draft a section." };

describe("manifest sidekick", () => {
  it("D0: a manifest without sidekick parses as before (no sidekick key)", () => {
    const h = defineHarness({ ...minimal });
    expect(Object.hasOwn(h, "sidekick")).toBe(false);
    expect(sidekickMode(h.sidekick, "anything")).toBe("auto");
    expect(sidekickTips(h.sidekick)).toBeUndefined();
    expect(sidekickMinWords(h.sidekick)).toBe(SIDEKICK_MIN_WORDS);
  });

  it("parses default, tips, actions and checks", () => {
    const h = defineHarness({
      ...minimal,
      actions: { draft: action, export: action },
      sidekick: { default: "on", tips: "Claims need a source.", actions: { draft: "always", export: "off" }, checks: { minWords: 4 } },
    });
    expect(h.sidekick?.default).toBe("on");
    expect(sidekickMode(h.sidekick, "draft")).toBe("always");
    expect(sidekickMode(h.sidekick, "export")).toBe("off");
    expect(sidekickMode(h.sidekick, undefined)).toBe("auto");
    expect(sidekickTips(h.sidekick)).toBe("Claims need a source.");
    expect(sidekickMinWords(h.sidekick)).toBe(4);
  });

  it("default is off when omitted", () => {
    expect(defineHarness({ ...minimal, sidekick: {} }).sidekick?.default).toBe("off");
  });

  it("per-purpose tips: prompt-coach's for the prompt coach", () => {
    const h = defineHarness({ ...minimal, sidekick: { tips: { "prompt-coach": "Short prompts.", mentor: "Be kind." } } });
    expect(sidekickTips(h.sidekick)).toBe("Short prompts.");
    expect(sidekickTips(h.sidekick, "mentor")).toBe("Be kind.");
  });

  it("refuses an unknown action, an unknown check and an unknown purpose", () => {
    expect(() => defineHarness({ ...minimal, sidekick: { actions: { nope: "auto" } } })).toThrow(/nope/);
    expect(() => defineHarness({ ...minimal, sidekick: { checks: { maxWords: 3 } } as never })).toThrow();
    expect(() => defineHarness({ ...minimal, sidekick: { tips: { wizard: "x" } } as never })).toThrow();
  });

  it("reserves the action id and the collection", () => {
    expect(() => defineHarness({ ...minimal, actions: { sidekick: action } })).toThrow(/reserved/);
    expect(RESERVED_COLLECTIONS).toContain("sidekick");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm --filter @humanharness/harness-sdk test -- sidekick`
Expected: FAIL — `sidekickMode` is not exported.

- [ ] **Step 3: Implement**

```ts
// packages/harness-sdk/src/sidekick.ts
import { z } from "zod";

/** The process key of Sidekick's turns in Settings › Models (`models.tasks`) and its reserved action id (spec §5). */
export const SIDEKICK_PROCESS = "sidekick";
/** The reserved app-wide collection that holds Sidekick's settings (and, in part 2, its learned items and records). */
export const SIDEKICK_COLLECTION = "sidekick";
/** Over this many tokens, `humanharness check` warns about the manifest's tips (spec §3). */
export const SIDEKICK_TIPS_TOKENS_WARN = 300;
/** Below this many words a prompt with a vague word is flagged (spec §4.1); `checks.minWords` overrides it. */
export const SIDEKICK_MIN_WORDS = 6;

/** The core's purposes (spec §2a.2). Part 1 uses only `prompt-coach`. */
export const SIDEKICK_PURPOSES = ["prompt-coach", "focus", "process-guard", "mentor", "daily-summary", "custom"] as const;
export type SidekickPurpose = (typeof SIDEKICK_PURPOSES)[number];

/** How an action's prompts are reviewed before they go out (spec §3). */
export const SIDEKICK_ACTION_MODES = ["auto", "always", "off"] as const;
export type SidekickActionMode = (typeof SIDEKICK_ACTION_MODES)[number];

const tipText = z.string().min(1).max(4000);

/** The manifest's `sidekick` block (spec §3). Absent: Sidekick is available, default off, no tips. */
export const sidekickSchema = z.strictObject({
  /** The state for a new profile. */
  default: z.enum(["on", "off"]).default("off"),
  /** Domain hints appended to the brief, in English; one text, or one per purpose. */
  tips: z.union([tipText, z.partialRecord(z.enum(SIDEKICK_PURPOSES), tipText)]).optional(),
  /** The pre-send mode per action id; free questions and unlisted actions are `auto`. */
  actions: z.record(z.string(), z.enum(SIDEKICK_ACTION_MODES)).optional(),
  /** Local-check thresholds (spec §4.1); unknown keys are refused. */
  checks: z.strictObject({ minWords: z.number().int().min(1).max(50).optional() }).optional(),
});
export type SidekickManifest = z.output<typeof sidekickSchema>;

/** The tips for `purpose`: the single text for every purpose, or that purpose's own. */
export function sidekickTips(m: SidekickManifest | undefined, purpose: SidekickPurpose = "prompt-coach"): string | undefined {
  const tips = m?.tips;
  if (tips === undefined) return undefined;
  return typeof tips === "string" ? tips : tips[purpose];
}

/** The pre-send mode of `action` (free questions: undefined → `auto`). */
export function sidekickMode(m: SidekickManifest | undefined, action: string | undefined): SidekickActionMode {
  if (action === undefined || !m?.actions || !Object.hasOwn(m.actions, action)) return "auto";
  return m.actions[action];
}

export const sidekickMinWords = (m: SidekickManifest | undefined): number => m?.checks?.minWords ?? SIDEKICK_MIN_WORDS;
```

In `packages/harness-sdk/src/data.ts` line 6:

```ts
/** Collections the core keeps: `settings` (harness settings) and `sidekick` (sidekick spec §6.4). Literal names: no import cycle. */
export const RESERVED_COLLECTIONS: readonly string[] = ["settings", "sidekick"];
```

In `packages/harness-sdk/src/index.ts`: add `import { SIDEKICK_PROCESS, sidekickSchema } from "./sidekick";`, `export * from "./sidekick";` next to the other `export *` lines, the field after `material`:

```ts
  /** The prompt coach's hints and per-action review modes (sidekick spec §3). Absent: available, default off (D0). */
  sidekick: sidekickSchema.optional(),
```

and in `superRefine`, right after the `"questions"` check:

```ts
  // Sidekick's model setting lives under the "sidekick" key, next to the action ids (sidekick spec §5).
  if (Object.hasOwn(m.actions, SIDEKICK_PROCESS)) {
    ctx.addIssue({ code: "custom", path: ["actions", SIDEKICK_PROCESS], message: `"${SIDEKICK_PROCESS}" is reserved for Sidekick: use another action id` });
  }
  for (const id of Object.keys(m.sidekick?.actions ?? {})) {
    if (!Object.hasOwn(m.actions, id)) ctx.addIssue({ code: "custom", path: ["sidekick", "actions", id], message: `"${id}" is not an action of this harness` });
  }
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/harness-sdk test`
Expected: PASS (the new file and every existing one; `data.test.ts` still passes since `settings` stays reserved).

- [ ] **Step 5: Typecheck and commit**

```bash
corepack pnpm typecheck
git -C <worktree> add packages/harness-sdk
git -C <worktree> commit -m "feat(sdk): manifest sidekick block (tips, per-action modes, checks)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 3: SDK — the `sidekick` collection and the settings record

**Files:**
- Modify: `packages/harness-sdk/src/sidekick.ts`
- Test: `packages/harness-sdk/test/sidekick.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/harness-sdk/test/sidekick.test.ts
import { SIDEKICK_COLLECTION, SIDEKICK_SETTINGS_ID, dataCollections, sidekickCollection, sidekickSettings } from "../src";

describe("sidekick collection", () => {
  it("is app-wide, keyed by id, hidden from the agent", () => {
    const c = sidekickCollection();
    expect(c.scoped).toBe(false);
    expect(c.key).toBe("id");
    expect(c.agent).toBe("none");
  });

  it("accepts the settings record and refuses unknown values", () => {
    const schema = sidekickCollection().schema;
    expect(schema.safeParse({ id: SIDEKICK_SETTINGS_ID, type: "settings", on: true, wait: 10, cap: "none" }).success).toBe(true);
    expect(schema.safeParse({ id: SIDEKICK_SETTINGS_ID, type: "settings", wait: 7 }).success).toBe(false);
    expect(schema.safeParse({ id: SIDEKICK_SETTINGS_ID, type: "settings", cap: 1 }).success).toBe(false);
    expect(schema.safeParse({ id: "x", type: "settings" }).success).toBe(false);
  });

  it("settings fall back to the manifest default and the core defaults", () => {
    expect(sidekickSettings(null, undefined)).toEqual({ on: false, preSend: true, wait: 6, cap: 20_000, introSeen: false });
    expect(sidekickSettings(null, { default: "on" }).on).toBe(true);
    expect(sidekickSettings({ id: "settings", type: "settings", on: false, cap: 50_000 }, { default: "on" })).toEqual({ on: false, preSend: true, wait: 6, cap: 50_000, introSeen: false });
  });

  it("D0: dataCollections never includes it", () => {
    const h = defineHarness({ ...minimal });
    expect(dataCollections(h)).toBe(h.data);
    expect(Object.hasOwn(dataCollections(h), SIDEKICK_COLLECTION)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm --filter @humanharness/harness-sdk test -- sidekick`
Expected: FAIL — `sidekickCollection` is not exported.

- [ ] **Step 3: Implement (append to `sidekick.ts`)**

```ts
import { type Collection, collectionSchema } from "./data";

/** Longest wait before a prompt goes out as typed (spec §4.1 step 5); "always" waits up to SIDEKICK_ALWAYS_MAX_MS. */
export const SIDEKICK_WAITS = [6, 10, "always"] as const;
export type SidekickWait = (typeof SIDEKICK_WAITS)[number];
/** Sidekick's tokens per task (spec §8). */
export const SIDEKICK_CAPS = [20_000, 50_000, "none"] as const;
export type SidekickCap = (typeof SIDEKICK_CAPS)[number];
export const SIDEKICK_ALWAYS_MAX_MS = 60_000;
/** The id of the one settings record. */
export const SIDEKICK_SETTINGS_ID = "settings";

const literalOf = <T extends readonly (string | number)[]>(values: T) =>
  z.union(values.map((v) => z.literal(v)) as unknown as [z.ZodLiteral<T[number]>, z.ZodLiteral<T[number]>, ...z.ZodLiteral<T[number]>[]]);

/**
 * A record of the `sidekick` collection. Part 1 has one type, `settings`; part 2 adds `learned`, `sidekick` and
 * `scope` records to the same object (one ZodObject, as collections need). Only changed values are stored.
 */
export const sidekickRecordSchema = z
  .strictObject({
    id: z.string().min(1).max(80),
    type: z.enum(["settings"]),
    on: z.boolean().optional(),
    preSend: z.boolean().optional(),
    wait: literalOf(SIDEKICK_WAITS).optional(),
    cap: literalOf(SIDEKICK_CAPS).optional(),
    /** The off-state intro card was answered (Turn on / Not now). */
    introSeen: z.boolean().optional(),
  })
  .superRefine((r, ctx) => {
    if (r.type === "settings" && r.id !== SIDEKICK_SETTINGS_ID) ctx.addIssue({ code: "custom", path: ["id"], message: `The settings record's id is "${SIDEKICK_SETTINGS_ID}"` });
  });
export type SidekickRecord = z.output<typeof sidekickRecordSchema>;

/** The reserved collection (spec §6.4): app-wide, keyed by `id`, never seen by the task agent. */
export function sidekickCollection(): Collection {
  return collectionSchema.parse({ scoped: false, key: "id", schema: sidekickRecordSchema, agent: "none" });
}

/** Every setting's value: the stored one, else its default (the manifest's `default` for `on`). */
export interface SidekickSettings {
  on: boolean;
  preSend: boolean;
  wait: SidekickWait;
  cap: SidekickCap;
  introSeen: boolean;
}

export function sidekickSettings(stored: Partial<SidekickRecord> | null, m: Pick<SidekickManifest, "default"> | undefined): SidekickSettings {
  return {
    on: stored?.on ?? m?.default === "on",
    preSend: stored?.preSend ?? true,
    wait: stored?.wait ?? 6,
    cap: stored?.cap ?? 20_000,
    introSeen: stored?.introSeen ?? false,
  };
}
```

If `collectionSchema.parse` refuses the refined object (the `schema` field must be a `ZodObject`: in zod 4 `.superRefine` on a `ZodObject` returns a `ZodObject`), keep the check but move it into the collection's `rules` instead:

```ts
rules: (next) => (next && next.type === "settings" && next.id !== SIDEKICK_SETTINGS_ID ? `The settings record's id is "${SIDEKICK_SETTINGS_ID}"` : true),
```

and drop `.superRefine` (adjust the test's last `safeParse` to go through `DataStore` in Task 9 instead).

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/harness-sdk test`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
corepack pnpm typecheck
git -C <worktree> add packages/harness-sdk
git -C <worktree> commit -m "feat(sdk): sidekick collection and settings record

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 4: Workspace — the local check

**Files:**
- Create: `packages/workspace/src/sidekick-checks.ts`
- Modify: `packages/workspace/src/index.ts` (`export * from "./sidekick-checks";`)
- Test: `packages/workspace/test/sidekick-checks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/workspace/test/sidekick-checks.test.ts
import { describe, expect, it } from "vitest";
import { type CheckContext, localCheck } from "../src/sidekick-checks";

const ctx: CheckContext = { minWords: 6, known: ["Chapter 2 outline", "Sources list"] };
const kinds = (prompt: string, c: CheckContext = ctx) => localCheck(prompt, c).map((f) => f.kind);

describe("localCheck", () => {
  it("passes a concrete prompt", () => {
    expect(kinds("Rewrite the second paragraph of chapter 2 so it cites Smith 2019 and stays under 120 words.")).toEqual([]);
  });

  it("vague: a vague word in a short prompt, with its span", () => {
    const [flag] = localCheck("make it better", ctx);
    expect(flag.kind).toBe("vague");
    expect(flag.match).toBe("better");
    expect("make it better".slice(...flag.span)).toBe("better");
  });

  it("vague: a long prompt with nothing concrete beside the vague words", () => {
    expect(kinds("please fix it and improve the stuff so that everything works well for us")).toContain("vague");
  });

  it("vague: not when something concrete is beside it (a number, a quote, a path)", () => {
    expect(kinds('make the intro better: use "In 2019" as the opening and keep it under 80 words')).toEqual([]);
  });

  it("missing-context: a reference with nothing attached and no known title", () => {
    expect(kinds("Summarize the sources like before, in bullet points please")).toContain("missing-context");
  });

  it("missing-context: not when a known note or data title is named", () => {
    expect(kinds("Use the sources from Sources list to write the conclusion of the essay")).not.toContain("missing-context");
  });

  it("two-asks: two imperative clauses joined by 'and also'", () => {
    const flags = localCheck("Write the introduction for chapter 3 and also translate chapter 2 into Spanish", ctx);
    expect(flags.map((f) => f.kind)).toContain("two-asks");
  });

  it("two-asks: two imperative lines", () => {
    expect(kinds("Write the introduction for chapter 3\nTranslate chapter 2 into Spanish")).toContain("two-asks");
  });

  it("two-asks: not for one ask over two lines", () => {
    expect(kinds("Write the introduction for chapter 3\nit should open with the 2019 study")).not.toContain("two-asks");
  });

  it("off-phase: words of another phase's label and none of the open one's", () => {
    const phases = { open: { id: "outline", label: "Outline" }, others: [{ id: "review", label: "Review citations" }] };
    expect(kinds("Check the citations in section 2 against the bibliography file", { ...ctx, phases })).toContain("off-phase");
    expect(kinds("Outline the citations section with 5 headings for chapter 2", { ...ctx, phases })).not.toContain("off-phase");
  });

  it("drops muted kinds", () => {
    expect(kinds("make it better", { ...ctx, muted: ["vague"] })).toEqual([]);
  });

  it("matches whole words in any script, case-insensitive", () => {
    expect(kinds("Betterment of the 2019 table in chapter 4 please, with the totals")).toEqual([]);
    expect(kinds("Make it BETTER")).toContain("vague");
  });

  it("is fast: 10 000 characters under 50 ms", () => {
    const long = "Write the introduction and also fix it. ".repeat(250);
    const t0 = performance.now();
    localCheck(long, ctx);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm --filter @humanharness/workspace test -- sidekick-checks`
Expected: FAIL — cannot find module `../src/sidekick-checks`.

- [ ] **Step 3: Implement**

```ts
// packages/workspace/src/sidekick-checks.ts

/** What the local check flags (sidekick spec §4.1). The model adds `other`. */
export type SidekickFlagKind = "vague" | "missing-context" | "two-asks" | "off-phase";
export const SIDEKICK_FLAG_KINDS: readonly SidekickFlagKind[] = ["vague", "missing-context", "two-asks", "off-phase"];

export interface SidekickFlag {
  kind: SidekickFlagKind;
  /** The words that raised it, as typed. */
  match: string;
  /** [start, end) in the prompt, for the underline in the composer. */
  span: [number, number];
}

export interface CheckContext {
  /** Below this many words a vague word is flagged even beside something concrete. */
  minWords: number;
  /** Titles a reference may point at: the scope's note titles and the data tables the agent sees. */
  known: readonly string[];
  /** The open task's phases, when its action has them. */
  phases?: { open: { id: string; label: string }; others: readonly { id: string; label: string }[] };
  /** Kinds the person muted (part 2). */
  muted?: readonly SidekickFlagKind[];
}

// English lists (spec §12 Q2: other languages come with the language spec's agentic translation).
const VAGUE = ["better", "improve", "fix it", "fix this", "the stuff", "stuff", "etc", "something", "things", "make it good", "clean it up", "whatever", "nicer"];
const REFERENCES = ["that file", "this file", "the file", "the sources", "the source", "like before", "as before", "the document", "the doc", "that one", "the other one", "the previous one", "what we discussed", "the usual"];
const VERBS = new Set([
  "add", "analyze", "build", "change", "check", "compare", "create", "delete", "describe", "draft", "edit", "explain", "find", "fix",
  "generate", "list", "make", "move", "outline", "plan", "read", "remove", "rename", "review", "rewrite", "run", "search", "send",
  "show", "summarize", "test", "translate", "update", "write",
]);
const STOP = new Set(["with", "from", "into", "that", "this", "your", "their", "about", "phase", "step", "final", "first"]);
const JOINERS = /\band also\b|\band then\b|\n+/giu;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole words or phrases in any script: letters and digits on either side don't count. */
const wordRe = (phrase: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(phrase).replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu");

function find(prompt: string, phrases: readonly string[]): { match: string; span: [number, number] } | null {
  let best: { match: string; span: [number, number] } | null = null;
  for (const phrase of phrases) {
    const m = wordRe(phrase).exec(prompt);
    if (m && (!best || m.index < best.span[0])) best = { match: m[0], span: [m.index, m.index + m[0].length] };
  }
  return best;
}

const words = (s: string): string[] => s.match(/[\p{L}\p{N}]+/gu) ?? [];

/** A number, a quote, a path or file name, inline code or a URL: something the model can hold on to. */
function concrete(prompt: string): boolean {
  return /\p{N}|["“”«»'`]|[\\/]|\.[a-z0-9]{1,5}\b|https?:/iu.test(prompt);
}

function namesKnown(prompt: string, known: readonly string[]): boolean {
  const lower = prompt.toLowerCase();
  return known.some((title) => title.trim().length > 2 && lower.includes(title.trim().toLowerCase()));
}

function labelWords(label: string): string[] {
  return words(label.toLowerCase()).filter((w) => w.length >= 4 && !STOP.has(w));
}

function vague(prompt: string, ctx: CheckContext): SidekickFlag | null {
  const hit = find(prompt, VAGUE);
  if (!hit) return null;
  return words(prompt).length < ctx.minWords || !concrete(prompt) ? { kind: "vague", ...hit } : null;
}

function missingContext(prompt: string, ctx: CheckContext): SidekickFlag | null {
  const hit = find(prompt, REFERENCES);
  if (!hit || concrete(prompt) || namesKnown(prompt, ctx.known)) return null;
  return { kind: "missing-context", ...hit };
}

function twoAsks(prompt: string): SidekickFlag | null {
  const parts: { text: string; joiner?: { match: string; span: [number, number] } }[] = [];
  let last = 0;
  for (const m of prompt.matchAll(JOINERS)) {
    parts.push({ text: prompt.slice(last, m.index), joiner: { match: m[0], span: [m.index, m.index + m[0].length] } });
    last = m.index + m[0].length;
  }
  parts.push({ text: prompt.slice(last) });
  const imperative = (s: string) => VERBS.has((words(s)[0] ?? "").toLowerCase());
  for (let i = 0; i + 1 < parts.length; i++) {
    if (imperative(parts[i].text) && imperative(parts[i + 1].text)) {
      const j = parts[i].joiner!;
      // A bare new line shows no text: underline the second clause's first word instead.
      if (j.match.trim() === "") {
        const start = j.span[1];
        const first = words(parts[i + 1].text)[0] ?? "";
        return { kind: "two-asks", match: first, span: [start, start + first.length] };
      }
      return { kind: "two-asks", ...j };
    }
  }
  return null;
}

function offPhase(prompt: string, ctx: CheckContext): SidekickFlag | null {
  if (!ctx.phases) return null;
  const own = labelWords(ctx.phases.open.label);
  if (find(prompt, own)) return null;
  for (const other of ctx.phases.others) {
    const hit = find(prompt, labelWords(other.label));
    if (hit) return { kind: "off-phase", ...hit };
  }
  return null;
}

/** The deterministic check (spec §4.1): 0 tokens, under 50 ms. At most one flag per kind, in a fixed order. */
export function localCheck(prompt: string, ctx: CheckContext): SidekickFlag[] {
  const muted = new Set(ctx.muted ?? []);
  const flags = [vague(prompt, ctx), missingContext(prompt, ctx), twoAsks(prompt), offPhase(prompt, ctx)];
  return flags.filter((f): f is SidekickFlag => f !== null && !muted.has(f.kind));
}
```

Note on the "two asks over two lines" test: `"it should open…"` does not start with a verb from `VERBS`, so it is not flagged.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/workspace test -- sidekick-checks`
Expected: PASS. If the "concrete" test fails because `"In 2019"` has a capital after a quote, keep the regex: the digit already makes it concrete; fix the test only if it is the test that is wrong.

- [ ] **Step 5: Typecheck and commit**

```bash
corepack pnpm typecheck
git -C <worktree> add packages/workspace
git -C <worktree> commit -m "feat(workspace): sidekick local check (vague, missing context, two asks, off-phase)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 5: Workspace — the Sidekick brief and its folder

**Files:**
- Create: `packages/workspace/src/sidekick-brief.ts`
- Modify: `packages/workspace/src/index.ts` (`export * from "./sidekick-brief";`)
- Test: `packages/workspace/test/sidekick-brief.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/workspace/test/sidekick-brief.test.ts
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { sidekickBrief, sidekickWorkDir, writeSidekickBrief } from "../src/sidekick-brief";

describe("sidekick brief", () => {
  it("holds the core rules, the harness and the tips, in English", () => {
    const text = sidekickBrief({ name: "Sidekick", harness: "Essay Coach", tips: "Claims need a source." });
    expect(text).toMatch(/^# Sidekick/);
    expect(text).toContain("Essay Coach");
    expect(text).toMatch(/Answer only with one JSON object/);
    expect(text).toMatch(/Never act/);
    expect(text).toMatch(/same language as the person's prompt/);
    expect(text).toContain("Claims need a source.");
  });

  it("has no tips section without tips", () => {
    expect(sidekickBrief({ name: "Sidekick", harness: "Notes" })).not.toContain("## Harness tips");
  });

  it("the folder is under userData, per base and sidekick, never inside the base", () => {
    const dir = sidekickWorkDir("/u", "/Users/me/Notes", "sidekick");
    expect(dir.startsWith(path.join("/u", "sidekick"))).toBe(true);
    expect(dir.endsWith(path.join("sidekick"))).toBe(true);
    expect(dir).not.toContain("/Users/me/Notes");
    expect(sidekickWorkDir("/u", "/Users/me/Notes/", "sidekick")).toBe(dir);
    expect(sidekickWorkDir("/u", "/Users/me/Other", "sidekick")).not.toBe(dir);
    expect(() => sidekickWorkDir("/u", "/b", "../x")).toThrow();
  });

  it("writes AGENTS.md and the engine file only when they changed", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "hh-sk-"));
    const engine = getEngine("claude");
    expect(await writeSidekickBrief(folder, "# A\n", engine)).toBe(true);
    expect(await fs.readFile(path.join(folder, "AGENTS.md"), "utf8")).toBe("# A\n");
    expect(await fs.readFile(path.join(folder, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    expect(await writeSidekickBrief(folder, "# A\n", engine)).toBe(false);
    expect(await writeSidekickBrief(folder, "# B\n", engine)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm --filter @humanharness/workspace test -- sidekick-brief`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```ts
// packages/workspace/src/sidekick-brief.ts
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { EngineDef } from "@humanharness/engines";

/** The core's Sidekick rules (spec §5, §11). English: Sidekick thinks in English like every core agent. */
export const SIDEKICK_RULES: readonly string[] = [
  "You review the person's prompt before it goes to the main assistant of this app. You never answer the prompt itself.",
  "Answer only with one JSON object, exactly as the turn asks. No prose before or after it, no code fences.",
  "Suggest; never act. You have no tools and you change nothing.",
  "Be brief: issues are one short sentence each.",
  "Say `send` when the prompt is clear enough; a good prompt needs no rewrite.",
  "Write the rewrite and the queued prompts in the same language as the person's prompt.",
  "Write the issues in the app's UI language that the turn names.",
  "Keep the person's intent. Add only what is missing; do not invent facts, files or sources.",
];

const ID = /^[a-z][a-z0-9-]{0,63}$/;

export function sidekickBrief(o: { name: string; harness: string; tips?: string; learned?: readonly string[] }): string {
  const lines = [`# ${o.name}`, "", `You are ${o.name}, the prompt coach inside the app "${o.harness}".`, "", "## Rules", "", ...SIDEKICK_RULES.map((r) => `- ${r}`)];
  if (o.tips?.trim()) lines.push("", "## Harness tips", "", o.tips.trim());
  if (o.learned && o.learned.length > 0) lines.push("", "## About this person", "", ...o.learned.map((l) => `- ${l}`));
  return lines.join("\n") + "\n";
}

/**
 * The session's working folder (plan Decision 1): under the app's userData, one per base (so per profile) and
 * sidekick, never inside the base, so the task's CLAUDE.md / AGENTS.md never load into the Sidekick session.
 */
export function sidekickWorkDir(userData: string, base: string, id: string): string {
  if (!ID.test(id)) throw new Error(`Invalid sidekick id: "${id}"`);
  const key = createHash("sha256").update(path.resolve(base)).digest("hex").slice(0, 16);
  return path.join(userData, "sidekick", key, id);
}

/** Writes the brief as AGENTS.md (+ the engine's own file) when it changed: the cached prefix survives. True when it wrote. */
export async function writeSidekickBrief(folder: string, text: string, engine: EngineDef): Promise<boolean> {
  await fs.mkdir(folder, { recursive: true });
  let wrote = false;
  const put = async (name: string, content: string) => {
    const file = path.join(folder, name);
    if ((await fs.readFile(file, "utf8").catch(() => null)) === content) return;
    const tmp = path.join(folder, `.${name}.${randomUUID()}.tmp`);
    await fs.writeFile(tmp, content);
    await fs.rename(tmp, file);
    wrote = true;
  };
  await put("AGENTS.md", text);
  const extra = engine.instructionsFile;
  if (extra) {
    if (path.basename(extra.path) !== extra.path) throw new Error(`Engine instructions file must be a plain file name, got "${extra.path}"`);
    await put(extra.path, extra.content);
  }
  return wrote;
}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/workspace test`
Expected: PASS (the new tests; `instructions.test.ts` unchanged — D0: the task's managed section is not touched).

- [ ] **Step 5: Typecheck and commit**

```bash
corepack pnpm typecheck
git -C <worktree> add packages/workspace
git -C <worktree> commit -m "feat(workspace): sidekick brief and its working folder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---
### Task 6: Runtime — no-tools transports and `SidekickSession`

**Files:**
- Modify: `packages/runtime/src/transport.ts` (`noTools` field)
- Modify: `packages/runtime/src/claude-cli.ts:74-97` (`claudeArgs`)
- Create: `packages/runtime/src/sidekick.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/test/claude-cli.test.ts` (append), `packages/runtime/test/sidekick.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/runtime/test/claude-cli.test.ts` (it already defines `permissions` and `uiServer`):

```ts
describe("claudeArgs noTools (sidekick spec §5)", () => {
  it("D0: without noTools the argv is exactly the old one", () => {
    const args = claudeArgs({ session: { id: "abc", started: false }, mcp: [uiServer], permissions });
    expect(args).toContain("--allowedTools");
    expect(args).not.toContain("--tools");
  });

  it("passes no tools, denies every built-in and loads no MCP server", () => {
    const args = claudeArgs({ session: { id: "abc", started: true }, mcp: [], permissions: { edit: "none", exec: false, web: false }, noTools: true });
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args).not.toContain("--allowedTools");
    const denied = args[args.indexOf("--disallowedTools") + 1].split(",");
    for (const t of ["Read", "Glob", "Grep", "Edit", "Write", "Bash", "WebSearch", "WebFetch", "Task", "TodoWrite"]) expect(denied).toContain(t);
    expect(args).toContain("--strict-mcp-config");
    expect(JSON.parse(args[args.indexOf("--mcp-config") + 1])).toEqual({ mcpServers: {} });
    expect(args).toContain("--resume");
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("project");
  });

  it("refuses MCP servers or reference folders with noTools", () => {
    expect(() => claudeArgs({ session: { id: "a", started: false }, mcp: [uiServer], permissions, noTools: true })).toThrow(/no-tools/);
    expect(() => claudeArgs({ session: { id: "a", started: false }, mcp: [], permissions, references: ["/x"], noTools: true })).toThrow(/no-tools/);
  });
});
```

```ts
// packages/runtime/test/sidekick.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { type AcpScript, type ClaudeScript, claudeTextLines, fakeAcpCommand, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { SidekickSession } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-sk-rt-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const profile = { engine: "claude", tier: "light" as const, model: "haiku", effort: "low" as const, cap: 80 };
const result = (text: string) => ({ line: { type: "result", subtype: "success", is_error: false, result: text, usage: { input_tokens: 300, output_tokens: 40, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 } } });

function fakeClaude(script: ClaudeScript) {
  const dir = fs.mkdtempSync(path.join(root, "c-"));
  const argsFile = path.join(dir, "args.json");
  return { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(dir, script), HH_FAKE_ARGS: argsFile }, args: () => JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[], folder: dir };
}

describe("SidekickSession", () => {
  it("Claude: no tools, its own folder, the text and usage; the second turn resumes", async () => {
    const json = '{"verdict":"send","issues":[],"confidence":0.9}';
    const fake = fakeClaude({ steps: [...claudeTextLines(json), result(json)] });
    const s = new SidekickSession({ engine: getEngine("claude"), command: fake.command, env: fake.env, folder: fake.folder, profile });
    const a = await s.ask("Sidekick: pre-send review\n…", new AbortController().signal);
    expect(a.ok).toBe(true);
    expect(a.text).toBe(json);
    expect(a.usage?.inputTokens).toBe(300);
    expect(fake.args()).toContain("--tools");
    expect(fake.args()).toContain("--session-id");
    await s.ask("again", new AbortController().signal);
    expect(fake.args()).toContain("--resume");
    await s.close();
  });

  it("turns are serial: a second ask waits for the first", async () => {
    const fake = fakeClaude({ steps: [{ sleep: 150 }, ...claudeTextLines("{}"), result("{}")] });
    const s = new SidekickSession({ engine: getEngine("claude"), command: fake.command, env: fake.env, folder: fake.folder, profile });
    const order: number[] = [];
    await Promise.all([s.ask("a", new AbortController().signal).then(() => order.push(1)), s.ask("b", new AbortController().signal).then(() => order.push(2))]);
    expect(order).toEqual([1, 2]);
    await s.close();
  });

  it("an abort is a failed answer, never a throw", async () => {
    const fake = fakeClaude({ steps: [{ sleep: 5000 }] });
    const s = new SidekickSession({ engine: getEngine("claude"), command: fake.command, env: fake.env, folder: fake.folder, profile });
    const c = new AbortController();
    setTimeout(() => c.abort(), 100);
    const a = await s.ask("x", c.signal);
    expect(a.ok).toBe(false);
    expect(a.error?.code).toBe("cancelled");
    await s.close();
  });

  it("ACP: session/new with no MCP servers, in the Sidekick folder", async () => {
    const dir = fs.mkdtempSync(path.join(root, "a-"));
    const log = path.join(dir, "log.jsonl");
    const script: AcpScript = { usage: { inputTokens: 10, outputTokens: 5 }, turns: [[{ update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "{}" } } }]] };
    const s = new SidekickSession({ engine: getEngine("codex"), command: fakeAcpCommand(), env: { HH_FAKE_SCRIPT: writeScript(dir, script), HH_FAKE_LOG: log }, folder: dir, profile: { ...profile, engine: "codex", model: undefined } });
    const a = await s.ask("x", new AbortController().signal);
    expect(a.ok).toBe(true);
    const created = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { method: string; params: { cwd?: string; mcpServers?: unknown[] } }).find((l) => l.method === "session/new");
    expect(created?.params.mcpServers).toEqual([]);
    expect(created?.params.cwd).toBe(dir);
    await s.close();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/runtime test -- claude-cli sidekick`
Expected: FAIL — `noTools` is not a known option; `SidekickSession` is not exported.

- [ ] **Step 3: Implement**

In `packages/runtime/src/transport.ts`, inside `TransportOptions` after `persistSession`:

```ts
  /**
   * The Sidekick session (sidekick spec §5): no tools at all. Claude gets `--tools ""` and every built-in denied;
   * it must come with no MCP servers and no reference folders. ACP sessions get no MCP servers and the read-only mode.
   */
  noTools?: boolean;
```

In `packages/runtime/src/claude-cli.ts`:

```ts
/** Every built-in Claude Code tool, denied by name in a no-tools session (in case `--tools ""` is ignored). */
export const ALL_BUILTIN_TOOLS = [
  "Read", "Glob", "Grep", "Edit", "Write", "MultiEdit", "NotebookEdit", "Bash", "WebSearch", "WebFetch", "TodoWrite", "Task", "AskUserQuestion", "ToolSearch",
] as const;

export function claudeArgs(
  o: Pick<TransportOptions, "session" | "mcp" | "permissions" | "persistSession" | "references" | "noTools"> & { profile?: ModelProfile },
): string[] {
  if (o.session.id.startsWith("-")) throw new Error(`Refusing a session id that reads as a flag: ${JSON.stringify(o.session.id)}`);
  if (o.noTools && (o.mcp.length > 0 || (o.references ?? []).length > 0)) throw new Error("A no-tools session takes no MCP servers or reference folders");
  const mcpServers = Object.fromEntries(
    o.mcp.map((s) => [s.name, { type: "stdio", command: s.command, args: s.args, env: s.env }]),
  );
  const tools = o.noTools
    ? ["--tools", "", "--disallowedTools", ALL_BUILTIN_TOOLS.join(",")]
    : ["--allowedTools", allowedTools(o.permissions, o.mcp).join(","), "--disallowedTools", disallowedTools(o.permissions, o.references ?? []).join(",")];
  return [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--setting-sources", "project",
    "--permission-mode", o.permissions.edit === "folder" ? "acceptEdits" : "default",
    ...tools,
    "--strict-mcp-config",
    "--mcp-config", JSON.stringify({ mcpServers }),
    ...(o.references ?? []).flatMap((dir) => ["--add-dir", dir]),
    ...(o.session.started ? ["--resume", o.session.id] : ["--session-id", o.session.id]),
    ...(o.persistSession === false ? ["--no-session-persistence"] : []),
    ...profileArgs(o.profile),
  ];
}
```

(The non-`noTools` argv keeps the same flags in the same order: the existing `claude-cli.test.ts` assertions are the D0 check. If Task 1 found A1 false, change the `noTools` branch to `["--disallowedTools", ALL_BUILTIN_TOOLS.join(",")]` and drop the `--tools` assertion.)

```ts
// packages/runtime/src/sidekick.ts
import type { EngineDef, ModelProfile } from "@humanharness/engines";
import { AcpTransport } from "./acp";
import { ClaudeCliTransport } from "./claude-cli";
import type { EngineError, Event } from "./events";
import type { SystemTaskResult } from "./system";
import { type Transport, type TransportOptions, acpFields } from "./transport";
import { randomUUID } from "node:crypto";

export interface SidekickSessionOptions {
  engine: EngineDef;
  command: string[];
  env?: Record<string, string>;
  /** The session's own working folder (holds its AGENTS.md); never the base. */
  folder: string;
  /** Fixed for the session (plan 3c). */
  profile: ModelProfile;
  /** Tests only: builds the transport. */
  transport?: (o: TransportOptions) => Transport;
}

export interface SidekickAnswer {
  ok: boolean;
  /** The reply's text (paragraphs joined by a blank line). */
  text: string;
  usage?: SystemTaskResult["usage"];
  model?: string;
  error?: EngineError;
}

/**
 * Sidekick's session for one task (sidekick spec §5): a second transport with its own session id, no tools, no MCP
 * servers, no permissions. Turns run one at a time. Never throws from `ask`: a crash, an abort or an engine error
 * is a failed answer.
 */
export class SidekickSession {
  private readonly transport: Transport;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(readonly o: SidekickSessionOptions) {
    const options: TransportOptions = {
      folder: o.folder,
      session: { id: randomUUID(), started: false },
      mcp: [],
      permissions: { edit: "none", exec: false, web: false },
      ...acpFields(o.engine, "none"),
      noTools: true,
      command: o.command,
      ...(o.env ? { env: o.env } : {}),
      onSessionStarted: () => {},
    };
    this.transport = o.transport?.(options) ?? (o.engine.transport.kind === "claude-cli" ? new ClaudeCliTransport(options) : new AcpTransport(options));
  }

  get profile(): ModelProfile {
    return this.o.profile;
  }

  ask(prompt: string, signal: AbortSignal): Promise<SidekickAnswer> {
    const run = () => this.turn(prompt, signal);
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async turn(prompt: string, signal: AbortSignal): Promise<SidekickAnswer> {
    if (this.closed) return { ok: false, text: "", error: { code: "cancelled" } };
    if (signal.aborted) return { ok: false, text: "", error: { code: "cancelled" } };
    const answer: SidekickAnswer = { ok: false, text: "" };
    const parts: string[] = [""];
    const onEvent = (e: Event) => {
      if (e.type === "text") parts[parts.length - 1] += e.delta;
      else if (e.type === "paragraph") parts.push("");
      else if (e.type === "usage") {
        const u = answer.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
        answer.usage = {
          inputTokens: u.inputTokens + e.inputTokens,
          outputTokens: u.outputTokens + e.outputTokens,
          cacheReadTokens: u.cacheReadTokens + e.cacheReadTokens,
          cacheWriteTokens: u.cacheWriteTokens + e.cacheWriteTokens,
          ...(u.costUsd !== undefined || e.costUsd !== undefined ? { costUsd: (u.costUsd ?? 0) + (e.costUsd ?? 0) } : {}),
        };
        if (e.model) answer.model = e.model;
      } else if (e.type === "done") {
        answer.ok = e.ok;
        if (!e.ok) answer.error = e.error;
      }
    };
    try {
      await this.transport.turn(prompt, onEvent, signal, this.o.profile);
    } catch (err) {
      answer.ok = false;
      answer.error = { code: "agent-crashed", detail: err instanceof Error ? err.message : String(err) };
    }
    if (signal.aborted) {
      answer.ok = false;
      answer.error = { code: "cancelled" };
    }
    answer.text = parts.filter((p) => p.trim()).join("\n\n").trim();
    return answer;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.queue.catch(() => undefined);
    await this.transport.close().catch(() => undefined);
  }
}
```

Note: `close()` waits for a running turn; callers that need it gone at once abort the turn's signal first (the controller does, Task 11).

In `packages/runtime/src/index.ts`:

```ts
export { ClaudeCliTransport, ALL_BUILTIN_TOOLS, allowedTools, claudeArgs, profileArgs } from "./claude-cli";
export { SidekickSession, type SidekickAnswer, type SidekickSessionOptions } from "./sidekick";
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/runtime test`
Expected: PASS, every existing `claude-cli.test.ts` case unchanged.

- [ ] **Step 5: Typecheck and commit**

```bash
corepack pnpm typecheck
git -C <worktree> add packages/runtime
git -C <worktree> commit -m "feat(runtime): no-tools transports and the Sidekick session

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 7: Shell — the pre-send prompt and the reply contract

**Files:**
- Create: `packages/shell/src/main/sidekick-turns.ts`
- Test: `packages/shell/test/sidekick-turns.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shell/test/sidekick-turns.test.ts
import { describe, expect, it } from "vitest";
import { SIDEKICK_PRE_MARK, parseReview, preSendPrompt } from "../src/main/sidekick-turns";

const input = {
  harness: { name: "Essay Coach", tagline: "Write better essays" },
  phase: { label: "Outline", brief: "Agree on the sections." },
  notes: ["Chapter 2 outline"],
  data: ["sources"],
  flags: [{ kind: "vague" as const, match: "better", span: [8, 14] as [number, number] }],
  uiLanguage: "English",
  prompt: "make it better",
};

describe("preSendPrompt", () => {
  it("starts with the marker and holds the compact context, never the task's history", () => {
    const p = preSendPrompt(input);
    expect(p.startsWith(SIDEKICK_PRE_MARK)).toBe(true);
    expect(p).toContain("Essay Coach — Write better essays");
    expect(p).toContain("Open phase: Outline — Agree on the sections.");
    expect(p).toContain("- Chapter 2 outline");
    expect(p).toContain("- vague: \"better\"");
    expect(p).toContain("UI language: English");
    expect(p).toContain("<prompt>\nmake it better\n</prompt>");
    expect(p).toMatch(/Answer with the JSON object only/);
  });

  it("says when there are no flags and no phase", () => {
    const p = preSendPrompt({ ...input, flags: [], phase: undefined, notes: [], data: [] });
    expect(p).toContain("Local flags: none (the person asked for a review)");
    expect(p).not.toContain("Open phase");
  });
});

describe("parseReview", () => {
  it("parses the contract", () => {
    const r = parseReview('{"verdict":"suggest","issues":[{"kind":"vague","text":"Say what better means.","span":[8,14]}],"rewrite":"Make the intro shorter.","queued":["Translate it"],"confidence":0.8}');
    expect(r?.verdict).toBe("suggest");
    expect(r?.issues[0].span).toEqual([8, 14]);
    expect(r?.queued).toEqual(["Translate it"]);
  });

  it("tolerates code fences and prose around one object", () => {
    expect(parseReview('Sure:\n```json\n{"verdict":"send","issues":[],"confidence":0.9}\n```')?.verdict).toBe("send");
  });

  it("defaults missing issues; refuses bad confidence, bad verdicts and non-JSON", () => {
    expect(parseReview('{"verdict":"send","confidence":1}')?.issues).toEqual([]);
    expect(parseReview('{"verdict":"send","issues":[],"confidence":2}')).toBeNull();
    expect(parseReview('{"verdict":"maybe","issues":[],"confidence":0.5}')).toBeNull();
    expect(parseReview("no")).toBeNull();
  });

  it("a suggest without a rewrite or issues is a send", () => {
    expect(parseReview('{"verdict":"suggest","issues":[],"confidence":0.9}')?.verdict).toBe("send");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm --filter @humanharness/shell test -- sidekick-turns`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```ts
// packages/shell/src/main/sidekick-turns.ts
import { z } from "zod";
import type { SidekickFlag } from "@humanharness/workspace";

/** The first line of every pre-send turn (mock mode and the e2e scripts match on it). */
export const SIDEKICK_PRE_MARK = "Sidekick: pre-send review";

export interface PreSendInput {
  harness: { name: string; tagline?: string };
  phase?: { label: string; brief?: string };
  /** The scope's note titles (latest first), at most 20. */
  notes: readonly string[];
  /** The data tables the task agent sees. */
  data: readonly string[];
  flags: readonly SidekickFlag[];
  /** The app's UI language, by name ("English"). */
  uiLanguage: string;
  prompt: string;
}

const list = (items: readonly string[]) => (items.length ? items.map((i) => `- ${i}`) : ["- (none)"]);

/** The per-turn context (spec §5): compact, never the task's history. */
export function preSendPrompt(i: PreSendInput): string {
  return [
    SIDEKICK_PRE_MARK,
    "",
    `App: ${i.harness.name}${i.harness.tagline ? ` — ${i.harness.tagline}` : ""}`,
    ...(i.phase ? [`Open phase: ${i.phase.label}${i.phase.brief ? ` — ${i.phase.brief.split("\n")[0]}` : ""}`] : []),
    "Notes in this scope:",
    ...list(i.notes.slice(0, 20)),
    "Data tables:",
    ...list(i.data),
    i.flags.length ? "Local flags:" : "Local flags: none (the person asked for a review)",
    ...i.flags.map((f) => `- ${f.kind}: "${f.match}" at [${f.span[0]}, ${f.span[1]}]`),
    `UI language: ${i.uiLanguage}`,
    "",
    "<prompt>",
    i.prompt,
    "</prompt>",
    "",
    'Answer with the JSON object only: {"verdict":"send"|"suggest","issues":[{"kind":"vague"|"missing-context"|"two-asks"|"off-phase"|"other","text":string,"span":[start,end]?}],"rewrite":string?,"queued":string[]?,"confidence":number 0..1}.',
  ].join("\n");
}

export const reviewSchema = z.object({
  verdict: z.enum(["send", "suggest"]),
  issues: z
    .array(
      z.object({
        kind: z.enum(["vague", "missing-context", "two-asks", "off-phase", "other"]),
        text: z.string().min(1).max(400),
        span: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
      }),
    )
    .max(6)
    .default([]),
  rewrite: z.string().min(1).max(8000).optional(),
  queued: z.array(z.string().min(1).max(4000)).max(5).optional(),
  confidence: z.number().min(0).max(1),
});
export type SidekickReviewReply = z.output<typeof reviewSchema>;

/** The reply, parsed (spec §4.1 step 3); null when it isn't the contract. Fences and prose around one object are dropped. */
export function parseReview(text: string): SidekickReviewReply | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  // Nothing to show is a send.
  if (r.verdict === "suggest" && !r.rewrite && r.issues.length === 0 && !r.queued?.length) return { ...r, verdict: "send" };
  return r;
}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/shell test -- sidekick-turns`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
corepack pnpm typecheck
git -C <worktree> add packages/shell/src/main/sidekick-turns.ts packages/shell/test/sidekick-turns.test.ts
git -C <worktree> commit -m "feat(shell): sidekick pre-send prompt and reply contract

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 8: Usage — Sidekick lines, totals and spend

**Files:**
- Modify: `packages/shell/src/main/usage-log.ts`
- Modify: `packages/ui/src/client.ts` (`UsageSummary.sidekick?: number`)
- Test: `packages/shell/test/usage-log.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/shell/test/usage-log.test.ts
import { sidekickRecord, sidekickSpent, sidekickWeek, summarizeUsage } from "../src/main/usage-log";

describe("sidekick lines (sidekick spec §8)", () => {
  const profile = { engine: "claude", tier: "light" as const, model: "haiku", effort: "low" as const, cap: 80 };
  const usage = { inputTokens: 300, outputTokens: 40, cacheReadTokens: 2000, cacheWriteTokens: 100 };
  const turn = (task: string, at: string) => ({ at, engine: "claude", task, action: "draft", ok: true, usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 } });

  it("a line is tagged process, phase, moment and sidekick", () => {
    const r = sidekickRecord({ engine: "claude", task: "t1", action: "draft", sidekick: "sidekick", moment: "pre", profile, ok: true, usage }, "2026-10-27T10:00:00Z");
    expect(r).toMatchObject({ phase: "sidekick", process: "sidekick", moment: "pre", sidekick: "sidekick", task: "t1", tier: "light" });
  });

  it("D0: a log without sidekick lines summarizes exactly as before", () => {
    const records = [turn("t1", "2026-10-27T10:00:00Z"), turn("t1", "2026-10-27T10:01:00Z")];
    const s = summarizeUsage(records, undefined);
    expect(Object.hasOwn(s, "sidekick")).toBe(false);
    expect(s.tokens).toEqual({ draft: 2200 });
  });

  it("sidekick lines stay out of task tokens and add a sidekick total", () => {
    const sk = sidekickRecord({ engine: "claude", task: "t1", action: "draft", sidekick: "sidekick", moment: "pre", profile, ok: true, usage }, "2026-10-27T10:00:30Z");
    const s = summarizeUsage([turn("t1", "2026-10-27T10:00:00Z"), sk, turn("t1", "2026-10-27T10:01:00Z")], undefined);
    expect(s.tokens).toEqual({ draft: 2200 });
    expect(s.sidekick).toBe(2440);
  });

  it("spend toward the cap: input + output + cache writes of the task's lines", () => {
    const a = sidekickRecord({ engine: "claude", task: "t1", sidekick: "sidekick", moment: "pre", profile, ok: true, usage }, "2026-10-27T10:00:00Z");
    const b = sidekickRecord({ engine: "claude", task: "t2", sidekick: "sidekick", moment: "pre", profile, ok: true, usage }, "2026-10-27T10:00:00Z");
    expect(sidekickSpent([a, b, turn("t1", "2026-10-27T10:00:00Z")], "t1")).toBe(440);
  });

  it("the week's tokens", () => {
    const old = sidekickRecord({ engine: "claude", task: "t0", sidekick: "sidekick", moment: "pre", profile, ok: true, usage }, "2026-10-01T10:00:00Z");
    const now = sidekickRecord({ engine: "claude", task: "t1", sidekick: "sidekick", moment: "pre", profile, ok: true, usage }, "2026-10-26T10:00:00Z");
    expect(sidekickWeek([old, now], new Date("2026-10-27T12:00:00Z"))).toBe(2440);
  });
});
```

(The `turn` lines carry no limits, so estimates stay `{}` either way; the measurability rule is covered by the next assertion you add to the existing "measures a turn" test: a turn followed by a sidekick line with limits is not measured — copy that test's two-turn fixture, put a `sidekickRecord` with `limits` between them, and expect `estimates` to be `{}`.)

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm --filter @humanharness/shell test -- usage-log`
Expected: FAIL — `sidekickRecord` is not exported.

- [ ] **Step 3: Implement**

In `usage-log.ts`:

```ts
export type TurnKind = "run" | "close" | "checkpoint" | "phase-change" | "wrap-up" | "material" | "sidekick";
```

(Update the doc comment above it: "`sidekick`: a Sidekick turn (sidekick spec §8), not a task's turn.")

Add to `UsageRecord` (after `fragments`):

```ts
  /** Sidekick lines only (sidekick spec §8): the process, the moment and which sidekick spoke. */
  process?: "sidekick";
  moment?: "pre" | "after" | "learn";
  sidekick?: string;
```

New functions:

```ts
/** One Sidekick turn (sidekick spec §8): `phase: "sidekick"` (a turn kind), `process`, `moment` and `sidekick`. */
export function sidekickRecord(
  o: { engine: string; task?: string; scope?: string; action?: string; sidekick: string; moment: "pre" | "after" | "learn"; profile: ModelProfile; ok: boolean; usage?: TurnUsage; limits?: LimitWindow[] },
  at: string = new Date().toISOString(),
): UsageRecord {
  return {
    at,
    engine: o.engine,
    ...(o.action ? { action: o.action } : {}),
    ...(o.task ? { task: o.task } : {}),
    ...(o.scope ? { scope: o.scope } : {}),
    phase: "sidekick",
    process: "sidekick",
    moment: o.moment,
    sidekick: o.sidekick,
    ...profileMeta(o.profile),
    ok: o.ok,
    ...(o.usage ? { usage: o.usage } : {}),
    ...(o.limits ? { limits: o.limits } : {}),
  };
}

/** What counts toward the cap (plan Decision 3): input, output and cache writes; cache reads are left out. */
export const capTokens = (u: TurnUsage): number => u.inputTokens + u.outputTokens + u.cacheWriteTokens;

/** Sidekick's tokens toward the cap in `task`. */
export function sidekickSpent(records: UsageRecord[], task: string): number {
  return records.filter((r) => r.phase === "sidekick" && r.task === task && r.usage).reduce((n, r) => n + capTokens(r.usage!), 0);
}

/** Sidekick's tokens (all four counts) in the last 7 days, for Settings › Sidekick. */
export function sidekickWeek(records: UsageRecord[], now: Date = new Date()): number {
  const since = now.getTime() - 7 * 86_400_000;
  return records.filter((r) => r.phase === "sidekick" && r.usage && Date.parse(r.at) >= since).reduce((n, r) => n + turnTokens(r.usage!), 0);
}
```

In `summarizeUsage`:

```ts
    if (r.phase === "close" || r.phase === "material" || r.phase === "sidekick" || r.kind) continue;
```
```ts
    // A material stage or a Sidekick turn right after the turn would be charged to it: the turn can't be measured.
    if (!before || !after || before.resetsAt !== after.resetsAt || next?.phase === "material" || next?.phase === "sidekick") task.measured = false;
```
```ts
  for (const r of all) if (r.scope && r.phase !== "material" && r.phase !== "sidekick") perScope.set(r.scope, (perScope.get(r.scope) ?? 0) + (r.usage ? turnTokens(r.usage) : 0));
```
```ts
  // Sidekick's own total (sidekick spec §8); absent when it never ran (D0).
  const sidekick = all.filter((r) => r.phase === "sidekick" && r.usage).reduce((n, r) => n + turnTokens(r.usage!), 0);
```
and in the returned object after `material`:

```ts
    ...(sidekick > 0 ? { sidekick } : {}),
```

In `profilesUsage`, treat it like `material` (each profile's own):

```ts
  const { scopes: _everyone, material: _all, sidekick: _allSk, ...summary } = summarizeUsage(merged, primary, now);
  …
  return { ...summary, ...(own.scopes ? { scopes: own.scopes } : {}), ...(own.material !== undefined ? { material: own.material } : {}), ...(own.sidekick !== undefined ? { sidekick: own.sidekick } : {}), profiles: perPerson };
```

In `packages/ui/src/client.ts`, inside `UsageSummary` after `material?`:

```ts
  /** Tokens of Sidekick's turns (sidekick spec §8); absent when it never ran. */
  sidekick?: number;
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/shell test -- usage-log`
Expected: PASS, every existing case unchanged.

- [ ] **Step 5: Typecheck and commit**

```bash
corepack pnpm typecheck
git -C <worktree> add packages/shell/src/main/usage-log.ts packages/shell/test/usage-log.test.ts packages/ui/src/client.ts
git -C <worktree> commit -m "feat(shell): sidekick usage lines, total and spend

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 9: Shell — the settings store and the person's write path

**Files:**
- Modify: `packages/shell/src/main/data-requests.ts` (optional `storeFor`; harness UI refuses `sidekick`)
- Create: `packages/shell/src/main/sidekick-store.ts`
- Test: `packages/shell/test/data-requests.test.ts` (append), `packages/shell/test/sidekick-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shell/test/data-requests.test.ts`. Its `setup()` helper returns `{ base, store, run, commits }` built from a `PersonDataDeps`; extend `setup` with an optional `storeFor` passed into `deps` (`...(opts.storeFor ? { storeFor: opts.storeFor } : {})`):

```ts
import { SIDEKICK_COLLECTION, sidekickCollection } from "@humanharness/harness-sdk";

describe("storeFor (sidekick spec §6.4)", () => {
  it("routes a collection to its own store and records the write as the person's", async () => {
    let own: DataStore | null = null;
    const t = setup({ storeFor: (c) => (c === SIDEKICK_COLLECTION ? Promise.resolve(own) : undefined) });
    own = new DataStore(t.base, { [SIDEKICK_COLLECTION]: sidekickCollection() });
    await t.run({ op: "put", collection: SIDEKICK_COLLECTION, record: { id: "settings", type: "settings", on: true } }, { scope: "_app" });
    expect(await own.get(SIDEKICK_COLLECTION, "settings", { who: "person", scope: "_app" })).toMatchObject({ on: true });
    expect(t.commits.map((c) => c.message)).toEqual(["Data: sidekick"]);
  });

  it("D0: without storeFor a sidekick request reaches the harness store (unknown collection)", async () => {
    const t = setup();
    await expect(t.run({ op: "get", collection: SIDEKICK_COLLECTION, key: "settings" }, { scope: "_app" })).rejects.toThrow(/no collection/);
  });

  it("the harness UI never reaches the sidekick collection", async () => {
    const ui = harnessUiDataRequests(async () => "reached", () => false);
    await expect(ui({ op: "get", collection: SIDEKICK_COLLECTION, key: "settings" }, {})).rejects.toThrow(/no collection "sidekick"/);
    await expect(ui({ op: "query", collection: "notes" }, {})).resolves.toBe("reached");
  });
});
```

```ts
// packages/shell/test/sidekick-store.test.ts
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SIDEKICK_COLLECTION, sidekickCollection } from "@humanharness/harness-sdk";
import { APP_SCOPE, DataStore, runDataRequest } from "@humanharness/workspace";
import { SidekickStore } from "../src/main/sidekick-store";

async function store(manifest?: { default: "on" | "off" }) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "hh-sks-"));
  const ds = new DataStore(base, { [SIDEKICK_COLLECTION]: sidekickCollection() });
  const writes: unknown[] = [];
  const s = new SidekickStore({
    read: () => ds.get(SIDEKICK_COLLECTION, "settings", { who: "person", scope: APP_SCOPE }) as never,
    write: async (request) => {
      writes.push(request);
      return runDataRequest(ds, request, { who: "person", scope: APP_SCOPE });
    },
    manifest,
  });
  return { s, ds, writes, base };
}

describe("SidekickStore", () => {
  it("defaults without a record; the manifest's default decides on", async () => {
    expect((await (await store()).s.settings()).on).toBe(false);
    expect((await (await store({ default: "on" })).s.settings()).on).toBe(true);
  });

  it("stores only values that differ from the defaults", async () => {
    const { s, ds } = await store();
    await s.set({ on: true, wait: 10 });
    expect(await ds.get(SIDEKICK_COLLECTION, "settings", { who: "person", scope: APP_SCOPE })).toEqual({ id: "settings", type: "settings", on: true, wait: 10 });
    expect(await s.settings()).toMatchObject({ on: true, wait: 10, cap: 20_000 });
  });

  it("back to every default deletes the record", async () => {
    const { s, writes } = await store();
    await s.set({ on: true });
    await s.set({ on: false });
    expect(writes.at(-1)).toMatchObject({ op: "delete", collection: "sidekick" });
  });

  it("refuses bad values as data", async () => {
    const { s } = await store();
    expect(await s.set({ wait: 7 } as never)).toMatchObject({ ok: false });
    expect(await s.set({ nope: 1 } as never)).toMatchObject({ ok: false });
  });

  it("a write failure comes back as data", async () => {
    const s = new SidekickStore({ read: async () => null, write: async () => Promise.reject(new Error("The app is closing")) });
    expect(await s.set({ on: true })).toEqual({ ok: false, message: "The app is closing" });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/shell test -- data-requests sidekick-store`
Expected: FAIL — `storeFor` unknown; module missing.

- [ ] **Step 3: Implement**

In `data-requests.ts`, add to `PersonDataDeps`:

```ts
  /**
   * A core collection kept in its own store (the reserved `sidekick` one): its store, or undefined for any other
   * collection. Absent: every request goes to `store()` (D0).
   */
  storeFor?(collection: string): Promise<DataStore | null> | undefined;
```

and in `personDataRequests`, a helper used in both branches instead of `d.store()`:

```ts
  const storeOf = async (request: unknown): Promise<DataStore | null> => {
    const collection = typeof request === "object" && request !== null ? (request as { collection?: unknown }).collection : undefined;
    const own = typeof collection === "string" ? d.storeFor?.(collection) : undefined;
    return own !== undefined ? own : d.store();
  };
```

(`const store = await d.store();` → `const store = await storeOf(request);` in both places.)

In `harnessUiDataRequests`, first line of the returned function:

```ts
    // The core's Sidekick collection is never the harness UI's (sidekick spec §6.4): it reads as unknown, as before.
    if (typeof request === "object" && request !== null && (request as { collection?: unknown }).collection === SIDEKICK_COLLECTION) {
      throw new DataError("unknown-collection", `There is no collection "${SIDEKICK_COLLECTION}"`);
    }
```

(import `SIDEKICK_COLLECTION` from `@humanharness/harness-sdk`.)

```ts
// packages/shell/src/main/sidekick-store.ts
import { z } from "zod";
import {
  SIDEKICK_CAPS, SIDEKICK_COLLECTION, SIDEKICK_SETTINGS_ID, SIDEKICK_WAITS,
  type SidekickManifest, type SidekickRecord, type SidekickSettings, sidekickSettings,
} from "@humanharness/harness-sdk";

export type SidekickSettingsPatch = Partial<SidekickSettings>;
export type SidekickSetResult = { ok: true; settings: SidekickSettings } | { ok: false; message: string };

const literal = <T extends readonly (string | number)[]>(values: T) => z.custom<T[number]>((v) => (values as readonly unknown[]).includes(v));
const patchSchema = z.strictObject({
  on: z.boolean().optional(),
  preSend: z.boolean().optional(),
  wait: literal(SIDEKICK_WAITS).optional(),
  cap: literal(SIDEKICK_CAPS).optional(),
  introSeen: z.boolean().optional(),
});

export interface SidekickStoreDeps {
  /** The settings record in the profile's `sidekick` collection; null when none. */
  read(): Promise<SidekickRecord | null>;
  /** A data request as the person, app-wide (the person's write path: checks, `Data: sidekick` commit). */
  write(request: unknown): Promise<unknown>;
  manifest?: Pick<SidekickManifest, "default">;
}

/** Sidekick's settings (spec §8): the stored values over the defaults; only changed values are stored. */
export class SidekickStore {
  constructor(private readonly d: SidekickStoreDeps) {}

  async settings(): Promise<SidekickSettings> {
    const stored = await this.d.read().catch(() => null);
    return sidekickSettings(stored, this.d.manifest);
  }

  async set(patch: SidekickSettingsPatch): Promise<SidekickSetResult> {
    const parsed = patchSchema.safeParse(patch);
    if (!parsed.success) return { ok: false, message: "Unknown Sidekick setting" };
    try {
      const next = { ...(await this.settings()), ...parsed.data };
      const defaults = sidekickSettings(null, this.d.manifest);
      const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => defaults[k as keyof SidekickSettings] !== v));
      if (Object.keys(changed).length === 0) {
        if (await this.d.read().catch(() => null)) await this.d.write({ op: "delete", collection: SIDEKICK_COLLECTION, key: SIDEKICK_SETTINGS_ID });
      } else {
        await this.d.write({ op: "put", collection: SIDEKICK_COLLECTION, record: { id: SIDEKICK_SETTINGS_ID, type: "settings", ...changed } });
      }
      return { ok: true, settings: next };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}
```

(The request shapes `{ op: "put", collection, record }` and `{ op: "delete", collection, key }` are `dataRequestSchema`'s, `packages/workspace/src/data.ts:470-484`.)

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/shell test -- data-requests sidekick-store`
Expected: PASS, the existing data-requests cases unchanged.

- [ ] **Step 5: Typecheck and commit**

```bash
corepack pnpm typecheck
git -C <worktree> add packages/shell
git -C <worktree> commit -m "feat(shell): sidekick settings store over the person's data path

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---
### Task 10: Shell — `SidekickController`: types, state, settings and the cap

**Files:**
- Modify: `packages/ui/src/client.ts` (Sidekick types appended at the end of the file)
- Create: `packages/shell/src/main/sidekick.ts`
- Test: `packages/shell/test/sidekick-controller.test.ts`

- [ ] **Step 1: Add the shared types (client.ts, appended)**

```ts
// ── Sidekick (sidekick spec; plan 2026-10-27 part 1) ──

/** The sidekick that speaks. Part 1 has one: `{ id: "sidekick", name: "Sidekick" }`. */
export interface SidekickInfo {
  id: string;
  name: string;
}

export interface SidekickSettings {
  on: boolean;
  /** The pre-send moment (spec §8 "the three moments, each on its own"). */
  preSend: boolean;
  /** Longest wait before the prompt goes out as typed, in seconds; "always" waits up to 60 s. */
  wait: 6 | 10 | "always";
  /** Sidekick's tokens per task. */
  cap: 20_000 | 50_000 | "none";
  /** The off-state intro was answered. */
  introSeen: boolean;
}
export type SidekickSettingsPatch = Partial<SidekickSettings>;
export type SidekickSetResult = { ok: true; settings: SidekickSettings } | { ok: false; message: string };

export type SidekickFlagKind = "vague" | "missing-context" | "two-asks" | "off-phase";
export interface SidekickFlagView {
  kind: SidekickFlagKind;
  match: string;
  span: [number, number];
}
export interface SidekickIssue {
  kind: SidekickFlagKind | "other";
  text: string;
  span?: [number, number];
}

/** A suggestion (spec §4.1 step 4). */
export interface SidekickCard {
  id: string;
  /** The prompt as typed. */
  prompt: string;
  flags: SidekickFlagView[];
  issues: SidekickIssue[];
  rewrite?: string;
  queued?: string[];
  confidence: number;
  at: string;
}

/** Off · Watching · Reading your prompt… · Has a suggestion · Past its cap (spec §7). */
export type SidekickStatus = "off" | "watching" | "reading" | "suggestion" | "capped";

export interface SidekickState {
  info: SidekickInfo;
  settings: SidekickSettings;
  status: SidekickStatus;
  /** Tokens toward the cap in the open task (input + output + cache writes). */
  spent: number;
  /** The cap in tokens; null for no cap. */
  cap: number | null;
  /** The tier Sidekick's turns run at (Settings › Models), or "custom". */
  tier: string;
  card: SidekickCard | null;
  /** Sidekick's tokens in the last 7 days. */
  week: number;
  /** The last review could not finish: the prompt went as typed (spec §5 "Errors"). */
  notice?: "failed" | "timeout";
}

/**
 * What the composer does with a review: `send` the prompt as typed (no flags, a clean verdict, Sidekick off or past
 * its cap), show the `card`, send as typed after a `timeout` or an `error`, or nothing (`cancelled`: the person
 * sent at once or the review was replaced).
 */
export type SidekickReview = { kind: "send" } | { kind: "card"; card: SidekickCard } | { kind: "timeout" } | { kind: "error" } | { kind: "cancelled" };
export type SidekickOutcome = "used" | "edited" | "sent-anyway" | "dismissed";
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/shell/test/sidekick-controller.test.ts
import { describe, expect, it, vi } from "vitest";
import { getEngine } from "@humanharness/engines";
import type { SidekickAnswer } from "@humanharness/runtime";
import type { SidekickRecord } from "@humanharness/harness-sdk";
import { SidekickController, type SidekickDeps } from "../src/main/sidekick";
import { SidekickStore } from "../src/main/sidekick-store";
import { type UsageRecord, sidekickRecord } from "../src/main/usage-log";

const profile = { engine: "claude", tier: "light" as const, model: "haiku", effort: "low" as const, cap: 80 };
const json = (o: unknown) => JSON.stringify(o);
const SUGGEST = json({ verdict: "suggest", issues: [{ kind: "vague", text: "Say what better means." }], rewrite: "Make the intro shorter.", confidence: 0.8 });

export function harness(o: { record?: Partial<SidekickRecord> | null; answers?: (string | ((signal: AbortSignal) => Promise<SidekickAnswer>))[]; task?: { id: string; action?: string; scope: string; phase?: string } | null; usage?: UsageRecord[]; manifest?: SidekickDeps["manifest"]; waitMs?: number } = {}) {
  let record: Partial<SidekickRecord> | null = o.record ?? null;
  const asked: string[] = [];
  const opened: string[] = [];
  const closed: string[] = [];
  const logged: UsageRecord[] = [];
  const briefs: string[] = [];
  const states: unknown[] = [];
  let task = o.task === undefined ? { id: "t1", scope: "main" } : o.task;
  const answers = [...(o.answers ?? [])];
  const store = new SidekickStore({
    read: async () => record as SidekickRecord | null,
    write: async (req) => {
      const r = req as { op: string; record?: Partial<SidekickRecord> };
      record = r.op === "delete" ? null : (r.record ?? null);
    },
    ...(o.manifest ? { manifest: o.manifest } : {}),
  });
  const deps: SidekickDeps = {
    ...(o.manifest ? { manifest: o.manifest } : {}),
    harness: { name: "Essay Coach" },
    phases: () => [],
    store,
    setup: async () => ({ engineId: "claude", base: "/base" }),
    hasNotice: async () => true,
    engine: getEngine,
    command: async () => ({ command: ["claude"], env: {} }),
    profile: async () => profile,
    workDir: () => "/ud/sidekick/k/sidekick",
    writeBrief: async (_f, text) => void briefs.push(text),
    open: (s) => {
      const id = `s${opened.length + 1}`;
      opened.push(id);
      return {
        profile: s.profile,
        ask: async (prompt, signal) => {
          asked.push(prompt);
          const next = answers.shift() ?? SUGGEST;
          if (typeof next === "function") return next(signal);
          return { ok: true, text: next, usage: { inputTokens: 300, outputTokens: 40, cacheReadTokens: 2000, cacheWriteTokens: 0 } };
        },
        close: async () => void closed.push(id),
      };
    },
    task: async () => task,
    context: async () => ({ notes: ["Chapter 2 outline"], data: ["sources"] }),
    uiLanguage: async () => "English",
    usage: async () => [...(o.usage ?? []), ...logged],
    log: async (_b, r) => void logged.push(r),
    changed: (s) => void states.push(s),
    waitMs: () => o.waitMs ?? 5_000,
  };
  return { ctl: new SidekickController(deps), asked, opened, closed, logged, briefs, states, setTask: (t: typeof task) => (task = t), record: () => record };
}

describe("SidekickController state and settings", () => {
  it("off by default without a manifest block", async () => {
    const h = harness();
    const s = await h.ctl.state();
    expect(s).toMatchObject({ info: { id: "sidekick", name: "Sidekick" }, status: "off", settings: { on: false }, cap: 20_000, spent: 0, card: null, tier: "light" });
  });

  it("on by default when the manifest says so", async () => {
    expect((await harness({ manifest: { default: "on" } }).ctl.state()).status).toBe("watching");
  });

  it("set stores the change and pushes the new state", async () => {
    const h = harness();
    expect(await h.ctl.set({ on: true, cap: "none" })).toMatchObject({ ok: true });
    expect(h.record()).toMatchObject({ on: true, cap: "none" });
    expect(h.states.at(-1)).toMatchObject({ status: "watching", cap: null });
  });

  it("spent is the open task's Sidekick tokens from the log; past the cap reads capped", async () => {
    const line = sidekickRecord({ engine: "claude", task: "t1", sidekick: "sidekick", moment: "pre", profile, ok: true, usage: { inputTokens: 19_000, outputTokens: 1_500, cacheReadTokens: 0, cacheWriteTokens: 0 } });
    const h = harness({ record: { id: "settings", type: "settings", on: true }, usage: [line] });
    expect(await h.ctl.state()).toMatchObject({ spent: 20_500, status: "capped" });
    h.setTask({ id: "t2", scope: "main" });
    expect(await h.ctl.state()).toMatchObject({ spent: 0, status: "watching" });
  });

  it("the week's tokens", async () => {
    const line = sidekickRecord({ engine: "claude", task: "t0", sidekick: "sidekick", moment: "pre", profile, ok: true, usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 } });
    expect((await harness({ usage: [line] }).ctl.state()).week).toBe(110);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `corepack pnpm --filter @humanharness/shell test -- sidekick-controller`
Expected: FAIL — cannot find module `../src/main/sidekick`.

- [ ] **Step 4: Implement (the review comes in Task 11)**

```ts
// packages/shell/src/main/sidekick.ts
import { randomUUID } from "node:crypto";
import type { EngineDef, ModelProfile } from "@humanharness/engines";
import { SIDEKICK_ALWAYS_MAX_MS, type SidekickManifest, sidekickMinWords, sidekickMode, sidekickTips } from "@humanharness/harness-sdk";
import type { SidekickAnswer, SidekickSessionOptions } from "@humanharness/runtime";
import type { SidekickCard, SidekickOutcome, SidekickReview, SidekickSetResult, SidekickSettings, SidekickSettingsPatch, SidekickState } from "@humanharness/ui/client";
import { localCheck, sidekickBrief } from "@humanharness/workspace";
import type { SidekickStore } from "./sidekick-store";
import { parseReview, preSendPrompt } from "./sidekick-turns";
import { type UsageRecord, capTokens, sidekickRecord, sidekickSpent, sidekickWeek } from "./usage-log";

/** Part 1's one sidekick (plan Decision 9). */
export const SIDEKICK_ID = "sidekick";
export const SIDEKICK_NAME = "Sidekick";
/** A `suggest` shows a card at or above this confidence (spec §6.2's starting threshold; per kind in part 2). */
export const SIDEKICK_THRESHOLD = 0.5;

/** What the controller needs of a session (SidekickSession, or a fake in tests). */
export interface SidekickLike {
  readonly profile: ModelProfile;
  ask(prompt: string, signal: AbortSignal): Promise<SidekickAnswer>;
  close(): Promise<void>;
}

export interface OpenTask {
  id: string;
  action?: string;
  scope: string;
  /** The open phase's id, when the action has phases. */
  phase?: string;
}

export interface SidekickDeps {
  manifest?: SidekickManifest;
  harness: { name: string; tagline?: string };
  /** The phases of `action`, in order ([] without). */
  phases(action: string | undefined): readonly { id: string; label: string; brief?: string }[];
  store: SidekickStore;
  /** The set-up app's engine and base; null when it isn't set up. */
  setup(): Promise<{ engineId: string; base: string } | null>;
  hasNotice(engineId: string): Promise<boolean>;
  engine(engineId: string): EngineDef;
  /** The engine's CLI; null when it can't be found. */
  command(engine: EngineDef): Promise<{ command: string[]; env: Record<string, string> } | null>;
  /** Sidekick's model (the `sidekick` process in Settings › Models), resolved when a session opens. */
  profile(engine: EngineDef): Promise<ModelProfile>;
  /** The session's working folder for `base` (sidekickWorkDir). */
  workDir(base: string): string;
  writeBrief(folder: string, text: string, engine: EngineDef): Promise<unknown>;
  open(o: SidekickSessionOptions): SidekickLike;
  task(): Promise<OpenTask | null>;
  /** The scope's note titles (latest first) and the data tables the task agent sees. */
  context(base: string, scope: string | undefined): Promise<{ notes: string[]; data: string[] }>;
  /** The app's UI language, by name. */
  uiLanguage(): Promise<string>;
  usage(base: string): Promise<UsageRecord[]>;
  log(base: string, record: UsageRecord): Promise<void>;
  changed(state: SidekickState): void;
  /** The wait for a setting, in ms (tests shorten it). */
  waitMs?(wait: SidekickSettings["wait"]): number;
}

const defaultWaitMs = (wait: SidekickSettings["wait"]): number => (wait === "always" ? SIDEKICK_ALWAYS_MAX_MS : wait * 1000);
/** Sessions are bound to the open task; a review with no task open binds to NO_TASK, adopted by the next task. */
const NO_TASK = "";

/**
 * Sidekick (spec §4.1, §5, §8): the local check, the decision, the model review with its timeout, the card, the
 * cap, and one no-tools session per task. Never blocks a send: every failure sends the prompt as typed.
 */
export class SidekickController {
  private readonly sessions = new Map<string, { session: SidekickLike; base: string }>();
  /** Tokens toward the cap of reviews that ran before their task existed (moved on adoption). */
  private readonly pending = new Map<string, number>();
  private running: AbortController | null = null;
  private card: SidekickCard | null = null;
  private notice: SidekickState["notice"];
  private closed = false;

  constructor(private readonly d: SidekickDeps) {}

  async state(): Promise<SidekickState> {
    const settings = await this.d.store.settings();
    const setup = await this.d.setup().catch(() => null);
    const task = await this.d.task().catch(() => null);
    const records = setup ? await this.d.usage(setup.base).catch(() => []) : [];
    const spent = (task ? sidekickSpent(records, task.id) : 0) + (this.pending.get(task?.id ?? NO_TASK) ?? 0);
    const cap = settings.cap === "none" ? null : settings.cap;
    let tier = "light";
    if (setup) {
      const p = await this.d.profile(this.d.engine(setup.engineId)).catch(() => null);
      if (p) tier = p.tier;
    }
    const status: SidekickState["status"] = !settings.on
      ? "off"
      : this.running
        ? "reading"
        : this.card
          ? "suggestion"
          : cap !== null && spent >= cap
            ? "capped"
            : "watching";
    return {
      info: { id: SIDEKICK_ID, name: SIDEKICK_NAME },
      settings,
      status,
      spent,
      cap,
      tier,
      card: this.card,
      week: sidekickWeek(records),
      ...(this.notice ? { notice: this.notice } : {}),
    };
  }

  async set(patch: SidekickSettingsPatch): Promise<SidekickSetResult> {
    const r = await this.d.store.set(patch);
    if (r.ok && !r.settings.on) {
      // Off: nothing runs and nothing stays open (D0: "the person can turn it off").
      this.running?.abort();
      this.card = null;
      await this.closeSessions(() => true);
    }
    await this.push();
    return r;
  }

  async resolve(cardId: string, _outcome: SidekickOutcome): Promise<void> {
    // Part 2 appends the outcome to events.jsonl (spec §6.1).
    if (this.card?.id !== cardId) return;
    this.card = null;
    await this.push();
  }

  cancel(): void {
    this.running?.abort();
  }

  /** Between tasks (TaskDeps.betweenTasks): sessions of tasks no longer open close (spec §5 "closed when the task closes"). */
  async betweenTasks(): Promise<void> {
    const open = (await this.d.task().catch(() => null))?.id;
    await this.closeSessions((key) => key !== NO_TASK && key !== open);
    if (this.card && open === undefined) {
      this.card = null;
      await this.push();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.running?.abort();
    await this.closeSessions(() => true);
  }

  review(req: { text: string; force?: boolean }): Promise<SidekickReview> {
    // Task 11.
    void req;
    return Promise.resolve({ kind: "send" });
  }

  private async closeSessions(which: (key: string) => boolean): Promise<void> {
    const gone = [...this.sessions].filter(([key]) => which(key));
    for (const [key] of gone) {
      this.sessions.delete(key);
      this.pending.delete(key);
    }
    await Promise.all(gone.map(([, s]) => s.session.close().catch(() => undefined)));
  }

  private async push(): Promise<void> {
    if (this.closed) return;
    this.d.changed(await this.state());
  }
}
```

(The imports used only by Task 11 — `randomUUID`, `sidekickMinWords`, `sidekickMode`, `sidekickTips`, `localCheck`, `sidekickBrief`, `parseReview`, `preSendPrompt`, `capTokens`, `sidekickRecord` — go in with Task 11 if the linter complains about unused imports.)

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm --filter @humanharness/shell test -- sidekick-controller`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
corepack pnpm typecheck
git -C <worktree> add packages/shell packages/ui/src/client.ts
git -C <worktree> commit -m "feat(shell): sidekick controller state, settings and cap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 11: Shell — the pre-send review

**Files:**
- Modify: `packages/shell/src/main/sidekick.ts` (`review`, `sessionFor`)
- Test: `packages/shell/test/sidekick-controller.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

```ts
// append to packages/shell/test/sidekick-controller.test.ts
const on = { id: "settings", type: "settings" as const, on: true };

describe("SidekickController.review (spec §4.1)", () => {
  it("D0: off → send, no session, nothing logged", async () => {
    const h = harness();
    expect(await h.ctl.review({ text: "make it better" })).toEqual({ kind: "send" });
    expect(h.opened).toEqual([]);
    expect(h.logged).toEqual([]);
    expect(h.briefs).toEqual([]);
  });

  it("pre-send off, or the action off → send", async () => {
    expect(await harness({ record: { ...on, preSend: false } }).ctl.review({ text: "make it better" })).toEqual({ kind: "send" });
    const h = harness({ record: on, task: { id: "t1", action: "export", scope: "main" }, manifest: { default: "off", actions: { export: "off" } } });
    expect(await h.ctl.review({ text: "make it better", force: true })).toEqual({ kind: "send" });
    expect(h.opened).toEqual([]);
  });

  it("auto with no flags → send without the model", async () => {
    const h = harness({ record: on });
    expect(await h.ctl.review({ text: "Rewrite the second paragraph of chapter 2 so it cites Smith 2019." })).toEqual({ kind: "send" });
    expect(h.asked).toEqual([]);
  });

  it("a flag → the model → a card; the prompt carries the flags and the context", async () => {
    const h = harness({ record: on });
    const r = await h.ctl.review({ text: "make it better" });
    expect(r.kind).toBe("card");
    if (r.kind !== "card") return;
    expect(r.card).toMatchObject({ prompt: "make it better", rewrite: "Make the intro shorter.", flags: [{ kind: "vague", match: "better" }] });
    expect(h.asked[0]).toContain('- vague: "better"');
    expect(h.asked[0]).toContain("- Chapter 2 outline");
    expect((await h.ctl.state()).status).toBe("suggestion");
  });

  it("Review (force) and `always` ask the model without flags", async () => {
    const forced = harness({ record: on });
    expect((await forced.ctl.review({ text: "Rewrite paragraph 2 of chapter 2 to cite Smith 2019.", force: true })).kind).toBe("card");
    const always = harness({ record: on, task: { id: "t1", action: "draft", scope: "main" }, manifest: { default: "off", actions: { draft: "always" } } });
    expect((await always.ctl.review({ text: "Rewrite paragraph 2 of chapter 2 to cite Smith 2019." })).kind).toBe("card");
  });

  it("a send verdict or low confidence → send", async () => {
    expect(await harness({ record: on, answers: [json({ verdict: "send", issues: [], confidence: 0.9 })] }).ctl.review({ text: "make it better" })).toEqual({ kind: "send" });
    expect(await harness({ record: on, answers: [json({ verdict: "suggest", issues: [{ kind: "vague", text: "x" }], rewrite: "y", confidence: 0.3 })] }).ctl.review({ text: "make it better" })).toEqual({ kind: "send" });
  });

  it("invalid JSON or an engine error → error, with the quiet notice", async () => {
    const h = harness({ record: on, answers: ["not json"] });
    expect(await h.ctl.review({ text: "make it better" })).toEqual({ kind: "error" });
    expect((await h.ctl.state()).notice).toBe("failed");
    const e = harness({ record: on, answers: [async () => ({ ok: false, text: "", error: { code: "model-not-found" } })] });
    expect(await e.ctl.review({ text: "make it better" })).toEqual({ kind: "error" });
  });

  it("the wait runs out → timeout; the late answer is dropped", async () => {
    const slow = (signal: AbortSignal) => new Promise<SidekickAnswer>((resolve) => signal.addEventListener("abort", () => resolve({ ok: false, text: "", error: { code: "cancelled" } })));
    const h = harness({ record: on, answers: [slow], waitMs: 30 });
    expect(await h.ctl.review({ text: "make it better" })).toEqual({ kind: "timeout" });
    expect((await h.ctl.state())).toMatchObject({ card: null, notice: "timeout", status: "watching" });
  });

  it("cancel (⌘⏎) → cancelled, no card", async () => {
    const slow = (signal: AbortSignal) => new Promise<SidekickAnswer>((resolve) => signal.addEventListener("abort", () => resolve({ ok: false, text: "", error: { code: "cancelled" } })));
    const h = harness({ record: on, answers: [slow] });
    const p = h.ctl.review({ text: "make it better" });
    await vi.waitFor(() => expect(h.asked.length).toBe(1));
    h.ctl.cancel();
    expect(await p).toEqual({ kind: "cancelled" });
  });

  it("past the cap → send without the model", async () => {
    const line = sidekickRecord({ engine: "claude", task: "t1", sidekick: "sidekick", moment: "pre", profile, ok: true, usage: { inputTokens: 20_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } });
    const h = harness({ record: on, usage: [line] });
    expect(await h.ctl.review({ text: "make it better" })).toEqual({ kind: "send" });
    expect(h.asked).toEqual([]);
  });

  it("logs one tagged usage line per model turn", async () => {
    const h = harness({ record: on, task: { id: "t1", action: "draft", scope: "main" } });
    await h.ctl.review({ text: "make it better" });
    expect(h.logged).toHaveLength(1);
    expect(h.logged[0]).toMatchObject({ phase: "sidekick", process: "sidekick", moment: "pre", sidekick: "sidekick", task: "t1", action: "draft", tier: "light" });
  });

  it("one session per task: reused, a new task gets a new one, betweenTasks closes the old", async () => {
    const h = harness({ record: on });
    await h.ctl.review({ text: "make it better" });
    await h.ctl.review({ text: "make it better" });
    expect(h.opened).toEqual(["s1"]);
    expect(h.briefs).toHaveLength(1);
    expect(h.briefs[0]).toContain("Essay Coach");
    h.setTask({ id: "t2", scope: "main" });
    await h.ctl.betweenTasks();
    expect(h.closed).toEqual(["s1"]);
    await h.ctl.review({ text: "make it better" });
    expect(h.opened).toEqual(["s1", "s2"]);
  });

  it("a review before the task exists opens a session the task adopts", async () => {
    const h = harness({ record: on, task: null });
    await h.ctl.review({ text: "make it better" });
    h.setTask({ id: "t9", scope: "main" });
    await h.ctl.betweenTasks();
    await h.ctl.review({ text: "make it better" });
    expect(h.opened).toEqual(["s1"]);
    expect(h.closed).toEqual([]);
  });

  it("turning off closes the sessions", async () => {
    const h = harness({ record: on });
    await h.ctl.review({ text: "make it better" });
    await h.ctl.set({ on: false });
    expect(h.closed).toEqual(["s1"]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/shell test -- sidekick-controller`
Expected: FAIL — `review` always returns `send`.

- [ ] **Step 3: Implement (replace the stub `review`, add `sessionFor` and `spendFor`)**

```ts
  async review(req: { text: string; force?: boolean }): Promise<SidekickReview> {
    this.running?.abort();
    this.card = null;
    this.notice = undefined;
    const settings = await this.d.store.settings();
    if (this.closed || !settings.on || !settings.preSend) return { kind: "send" };
    const task = await this.d.task().catch(() => null);
    const mode = sidekickMode(this.d.manifest, task?.action);
    if (mode === "off") return { kind: "send" };
    const setup = await this.d.setup().catch(() => null);
    if (!setup || !(await this.d.hasNotice(setup.engineId).catch(() => false))) return { kind: "send" };

    // 1. The local check (0 tokens).
    const ctx = await this.d.context(setup.base, task?.scope).catch(() => ({ notes: [], data: [] }));
    const phases = this.d.phases(task?.action);
    const open = phases.find((p) => p.id === task?.phase);
    const flags = localCheck(req.text, {
      minWords: sidekickMinWords(this.d.manifest),
      known: [...ctx.notes, ...ctx.data],
      ...(open ? { phases: { open, others: phases.filter((p) => p.id !== open.id) } } : {}),
    });
    // 2. The decision.
    if (flags.length === 0 && mode === "auto" && !req.force) return { kind: "send" };
    const key = task?.id ?? NO_TASK;
    const records = await this.d.usage(setup.base).catch(() => []);
    const spent = (task ? sidekickSpent(records, task.id) : 0) + (this.pending.get(key) ?? 0);
    if (settings.cap !== "none" && spent >= settings.cap) return { kind: "send" };

    // 3. The model, within the wait.
    const controller = new AbortController();
    this.running = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, (this.d.waitMs ?? defaultWaitMs)(settings.wait));
    await this.push();
    try {
      const engine = this.d.engine(setup.engineId);
      const session = await this.sessionFor(setup.base, engine, key, task?.id);
      if (!session || controller.signal.aborted) return this.finish(timedOut ? "timeout" : controller.signal.aborted ? "cancelled" : "error");
      const harness = this.d.harness;
      const prompt = preSendPrompt({
        harness,
        ...(open ? { phase: { label: open.label, ...(open.brief ? { brief: open.brief } : {}) } } : {}),
        notes: ctx.notes,
        data: ctx.data,
        flags,
        uiLanguage: await this.d.uiLanguage().catch(() => "English"),
        prompt: req.text,
      });
      const answer = await session.ask(prompt, controller.signal);
      if (answer.usage) {
        if (!task) this.pending.set(key, (this.pending.get(key) ?? 0) + capTokens(answer.usage));
        const record = sidekickRecord({
          engine: engine.id,
          ...(task ? { task: task.id, scope: task.scope } : {}),
          ...(task?.action ? { action: task.action } : {}),
          sidekick: SIDEKICK_ID,
          moment: "pre",
          profile: session.profile,
          ok: answer.ok,
          usage: answer.usage,
        });
        await this.d.log(setup.base, record).catch((err: unknown) => console.error("Could not record the Sidekick turn", err));
      }
      if (timedOut) return this.finish("timeout");
      if (controller.signal.aborted) return this.finish("cancelled");
      const reply = answer.ok ? parseReview(answer.text) : null;
      if (!reply) return this.finish("error");
      if (reply.verdict === "send" || reply.confidence < SIDEKICK_THRESHOLD) return this.finish("send");
      // 4. The card.
      this.card = {
        id: randomUUID(),
        prompt: req.text,
        flags,
        issues: reply.issues,
        ...(reply.rewrite ? { rewrite: reply.rewrite } : {}),
        ...(reply.queued?.length ? { queued: reply.queued } : {}),
        confidence: reply.confidence,
        at: new Date().toISOString(),
      };
      return { kind: "card", card: this.card };
    } catch (err) {
      console.error("Sidekick could not review the prompt", err);
      return this.finish("error");
    } finally {
      clearTimeout(timer);
      if (this.running === controller) this.running = null;
      await this.push();
    }
  }

  /** Records the quiet notice for a failed review (spec §5 "Errors") and returns what the composer does. */
  private finish(kind: "send" | "timeout" | "error" | "cancelled"): SidekickReview {
    if (kind === "timeout") this.notice = "timeout";
    if (kind === "error") this.notice = "failed";
    return { kind };
  }

  /**
   * The session for `key` (the open task, or NO_TASK): reused; a task adopts the NO_TASK session a review opened
   * before it existed; else a new one, with its brief written first (only when it changed). Null without a CLI.
   */
  private async sessionFor(base: string, engine: EngineDef, key: string, taskId: string | undefined): Promise<SidekickLike | null> {
    const have = this.sessions.get(key);
    if (have && have.base === base) return have.session;
    if (taskId !== undefined) {
      const loose = this.sessions.get(NO_TASK);
      if (loose && loose.base === base) {
        this.sessions.delete(NO_TASK);
        this.sessions.set(key, loose);
        this.pending.delete(NO_TASK);
        return loose.session;
      }
    }
    if (have) {
      this.sessions.delete(key);
      await have.session.close().catch(() => undefined);
    }
    const cmd = await this.d.command(engine).catch(() => null);
    if (!cmd) return null;
    const profile = await this.d.profile(engine);
    const folder = this.d.workDir(base);
    await this.d.writeBrief(folder, sidekickBrief({ name: SIDEKICK_NAME, harness: this.d.harness.name, ...(sidekickTips(this.d.manifest) ? { tips: sidekickTips(this.d.manifest) } : {}) }), engine);
    const session = this.d.open({ engine, command: cmd.command, env: cmd.env, folder, profile });
    this.sessions.set(key, { session, base });
    return session;
  }
```

Note: the NO_TASK review's tokens are logged without a task (they still count in the week's total and in `UsageSummary.sidekick`); its `pending` spend is dropped on adoption: the task's own log lines start the cap from there. This is the Decision 14 trade-off, accepted for part 1.

The adoption test expects `betweenTasks` to keep the NO_TASK session: `closeSessions` already skips `NO_TASK`.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/shell test -- sidekick-controller`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
corepack pnpm typecheck
git -C <worktree> add packages/shell
git -C <worktree> commit -m "feat(shell): sidekick pre-send review with timeout, cap and one session per task

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 12: Main wiring, IPC, preload and the client

**Files:**
- Create: `packages/shell/src/main/sidekick-ipc.ts`
- Modify: `packages/shell/src/main/task-manager.ts` (`phaseNow()`)
- Modify: `packages/shell/src/main/index.ts` (small, additive)
- Modify: `packages/shell/src/preload/index.ts`
- Modify: `packages/ui/src/client.ts` (`AppState.sidekick?`, `HarnessClient.sidekick`)
- Modify: `packages/ui/test/fake-client.ts`
- Test: `packages/shell/test/sidekick-ipc.test.ts`, `packages/shell/test/task-manager-phases.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shell/test/sidekick-ipc.test.ts
import { describe, expect, it } from "vitest";
import { registerSidekickIpc } from "../src/main/sidekick-ipc";

function wire() {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const calls: unknown[][] = [];
  const ctl = {
    state: async () => ({ status: "off" }),
    set: async (p: unknown) => (calls.push(["set", p]), { ok: true }),
    review: async (r: unknown) => (calls.push(["review", r]), { kind: "send" }),
    cancel: () => void calls.push(["cancel"]),
    resolve: async (id: unknown, o: unknown) => void calls.push(["resolve", id, o]),
  };
  registerSidekickIpc((ch, fn) => void handlers.set(ch, fn), () => ctl as never);
  const call = (ch: string, ...args: unknown[]) => (handlers.get(ch) as (...a: unknown[]) => unknown)(...args);
  return { call, calls };
}

describe("sidekick IPC", () => {
  it("passes valid requests through", async () => {
    const w = wire();
    expect(await w.call("hh:sidekickGet")).toEqual({ status: "off" });
    await w.call("hh:sidekickSet", { on: true });
    await w.call("hh:sidekickReview", { text: "make it better", force: true });
    await w.call("hh:sidekickCancel");
    await w.call("hh:sidekickResolve", "c1", "used");
    expect(w.calls).toEqual([["set", { on: true }], ["review", { text: "make it better", force: true }], ["cancel"], ["resolve", "c1", "used"]]);
  });

  it("refuses malformed requests", async () => {
    const w = wire();
    expect(await w.call("hh:sidekickSet", "on")).toMatchObject({ ok: false });
    expect(await w.call("hh:sidekickReview", { text: 3 })).toEqual({ kind: "send" });
    expect(await w.call("hh:sidekickReview", { text: "x".repeat(20_001) })).toEqual({ kind: "send" });
    await w.call("hh:sidekickResolve", "c1", "nope");
    expect(w.calls).toEqual([]);
  });
});
```

Append to `packages/shell/test/task-manager-phases.test.ts`, inside its main `describe` (its `setup()` builds a manager over the `session` action whose first phase is `warmup`):

```ts
  it("phaseNow: the open task's phase id; undefined without a task", async () => {
    const t = setup();
    expect(await t.manager.phaseNow()).toBeUndefined();
    await t.manager.start("session");
    expect(await t.manager.phaseNow()).toBe("warmup");
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/shell test -- sidekick-ipc task-manager-phases`
Expected: FAIL — module missing; `phaseNow` missing.

- [ ] **Step 3: Implement**

```ts
// packages/shell/src/main/sidekick-ipc.ts
import type { SidekickOutcome, SidekickReview, SidekickSetResult, SidekickState } from "@humanharness/ui/client";
import type { SidekickController } from "./sidekick";

const OUTCOMES: readonly SidekickOutcome[] = ["used", "edited", "sent-anyway", "dismissed"];
const MAX_PROMPT = 20_000;

type Handle = (channel: string, fn: (...args: never[]) => unknown) => void;
type Ctl = Pick<SidekickController, "state" | "set" | "review" | "cancel" | "resolve">;

/** Sidekick's channels (sidekick spec §7). A malformed request never reaches the controller; a bad review sends as typed. */
export function registerSidekickIpc(handle: Handle, ctl: () => Ctl | null): void {
  handle("hh:sidekickGet", async (): Promise<SidekickState | null> => (await ctl()?.state()) ?? null);
  handle("hh:sidekickSet", async (patch: unknown): Promise<SidekickSetResult> => {
    const c = ctl();
    if (!c) return { ok: false, message: "Sidekick is not available" };
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return { ok: false, message: "A Sidekick change must be an object" };
    return c.set(patch as never);
  });
  handle("hh:sidekickReview", async (req: unknown): Promise<SidekickReview> => {
    const c = ctl();
    if (!c || typeof req !== "object" || req === null) return { kind: "send" };
    const { text, force } = req as { text?: unknown; force?: unknown };
    if (typeof text !== "string" || !text.trim() || text.length > MAX_PROMPT) return { kind: "send" };
    return c.review({ text, ...(force === true ? { force: true } : {}) });
  });
  handle("hh:sidekickCancel", () => ctl()?.cancel());
  handle("hh:sidekickResolve", async (id: unknown, outcome: unknown) => {
    if (typeof id !== "string" || !OUTCOMES.includes(outcome as SidekickOutcome)) return;
    await ctl()?.resolve(id, outcome as SidekickOutcome);
  });
}
```

In `task-manager.ts`, right after `runningTask()`:

```ts
  /** The open task's phase id (task-phases spec), for Sidekick's off-phase check; undefined without one. */
  async phaseNow(): Promise<string | undefined> {
    return (await this.d.store.load()).current?.phase?.id;
  }
```

In `packages/ui/src/client.ts`:
- in `AppState`, next to `settings?`: 

```ts
  /** Sidekick, the core's prompt coach (sidekick spec). Absent: no Sidekick UI (tests, older mains). */
  sidekick?: SidekickInfo;
```

- in `HarnessClient`, after `settings`:

```ts
  /** Sidekick (sidekick spec): its state, settings and the pre-send review. */
  sidekick: {
    get(): Promise<SidekickState | null>;
    set(patch: SidekickSettingsPatch): Promise<SidekickSetResult>;
    /** Reviews the prompt before it goes out; the composer sends as typed unless a card comes back or it was cancelled. */
    review(req: { text: string; force?: boolean }): Promise<SidekickReview>;
    /** Stops a running review (⌘⏎ sends at once). */
    cancelReview(): Promise<void>;
    /** What the person did with a card; it leaves the panel. */
    resolve(cardId: string, outcome: SidekickOutcome): Promise<void>;
    onChange(listener: (state: SidekickState) => void): () => void;
  };
```

In `packages/shell/src/preload/index.ts`, after `settings`:

```ts
  sidekick: {
    get: () => ipcRenderer.invoke("hh:sidekickGet"),
    set: (patch) => ipcRenderer.invoke("hh:sidekickSet", patch),
    review: (req) => ipcRenderer.invoke("hh:sidekickReview", req),
    cancelReview: () => ipcRenderer.invoke("hh:sidekickCancel"),
    resolve: (id, outcome) => ipcRenderer.invoke("hh:sidekickResolve", id, outcome),
    onChange: (listener) => subscribe<SidekickState>("hh:sidekick", listener),
  },
```

In `packages/ui/test/fake-client.ts` (FakeClient), a Sidekick that is off and never reviews, plus hooks tests can set:

```ts
  sidekickState: SidekickState | null = null;
  sidekickReviews: SidekickReview[] = [];
  readonly sidekickCalls: unknown[][] = [];
  private sidekickListeners = new Set<(s: SidekickState) => void>();
  emitSidekick(s: SidekickState) {
    this.sidekickState = s;
    for (const l of this.sidekickListeners) l(s);
  }
  sidekick = {
    get: async () => this.sidekickState,
    set: async (patch: SidekickSettingsPatch): Promise<SidekickSetResult> => {
      this.sidekickCalls.push(["set", patch]);
      if (!this.sidekickState) return { ok: false, message: "off" };
      const settings = { ...this.sidekickState.settings, ...patch };
      this.emitSidekick({ ...this.sidekickState, settings, status: settings.on ? "watching" : "off" });
      return { ok: true, settings };
    },
    review: async (req: { text: string; force?: boolean }): Promise<SidekickReview> => {
      this.sidekickCalls.push(["review", req]);
      return this.sidekickReviews.shift() ?? { kind: "send" };
    },
    cancelReview: async () => void this.sidekickCalls.push(["cancel"]),
    resolve: async (id: string, outcome: SidekickOutcome) => void this.sidekickCalls.push(["resolve", id, outcome]),
    onChange: (l: (s: SidekickState) => void) => {
      this.sidekickListeners.add(l);
      return () => void this.sidekickListeners.delete(l);
    },
  };
```

In `packages/shell/src/main/index.ts` (each a few lines):

1. Imports: `SIDEKICK_COLLECTION, SIDEKICK_PROCESS, SIDEKICK_SETTINGS_ID, type SidekickRecord, sidekickCollection, languageName` from `@humanharness/harness-sdk`; `SidekickSession` from `@humanharness/runtime`; `readNotes, notesPrefix, sidekickWorkDir, writeSidekickBrief` from `@humanharness/workspace` (add only the names not imported yet); `SidekickController` from `./sidekick`; `SidekickStore` from `./sidekick-store`; `registerSidekickIpc` from `./sidekick-ipc`.

2. Next to `dataStoreFor`:

```ts
/** Sidekick's own store per base (plan Decision 8): never in dataCollections, so harness rules and the UI never see it. */
const sidekickStores = new Map<string, DataStore>();
function sidekickStoreFor(base: string): DataStore {
  let s = sidekickStores.get(base);
  if (!s) {
    s = new DataStore(base, { [SIDEKICK_COLLECTION]: sidekickCollection() });
    sidekickStores.set(base, s);
  }
  return s;
}
```

3. In `personDataRequests({ … })`, one more dep:

```ts
  // The reserved `sidekick` collection lives in its own store (sidekick spec §6.4); every other collection as before.
  storeFor: (collection) =>
    collection === SIDEKICK_COLLECTION ? validConfig().then((c) => (c ? sidekickStoreFor(baseOf(c)) : null)) : undefined,
```

4. `let sidekickCtl: SidekickController | null = null;` next to `let settingsCtl`, and in the `if (loaded)` block right after the `settingsCtl` block:

```ts
  // Sidekick is core (sidekick spec D1): every harness gets the controller; it does nothing while off.
  sidekickCtl = new SidekickController({
    ...(harness.sidekick ? { manifest: harness.sidekick } : {}),
    harness: { name: harness.name, ...(harness.tagline ? { tagline: harness.tagline } : {}) },
    phases: (action) => (action && Object.hasOwn(harness.actions, action) ? (harness.actions[action].phases ?? []) : []),
    store: new SidekickStore({
      read: async () => {
        const c = await validConfig();
        if (!c) return null;
        return (await sidekickStoreFor(baseOf(c)).get(SIDEKICK_COLLECTION, SIDEKICK_SETTINGS_ID, { who: "person", scope: APP_SCOPE }).catch(() => null)) as SidekickRecord | null;
      },
      write: (request) => personData(request, { scope: APP_SCOPE }),
      ...(harness.sidekick ? { manifest: harness.sidekick } : {}),
    }),
    setup: async () => {
      const c = await validConfig();
      return c ? { engineId: c.engineId, base: baseOf(c) } : null;
    },
    hasNotice,
    engine: getEngine,
    command: async (engine) => hooks.engines?.[engine.id] ?? engineCommand(engine, commandDeps),
    profile: async (engine) => {
      const models = cleanModels((await config.load()).models);
      const saved = await savedOffer(engine.id);
      return supportedEffort(firstOffered(resolveProfile({ engine: engine.id, action: SIDEKICK_PROCESS, manifestTier: "light", models }), models, saved.models), saved);
    },
    workDir: (base) => sidekickWorkDir(app.getPath("userData"), base, "sidekick"),
    writeBrief: writeSidekickBrief,
    open: (o) => new SidekickSession(o),
    task: async () => {
      const t = await tasks.runningTask();
      if (!t) return null;
      const phase = await tasks.phaseNow();
      return { ...t, ...(phase ? { phase } : {}) };
    },
    context: async (base, scope) => {
      const notes = await readNotes(base, notesPrefix(scoped(), scope ?? MAIN_SCOPE)).catch(() => []);
      const data = Object.entries(harness.data).filter(([, c]) => c.agent !== "none").map(([name]) => name);
      // readNotes returns newest first.
      return { notes: notes.map((n) => n.title).slice(0, 20), data };
    },
    uiLanguage: async () => languageName((await config.load()).language ?? "en"),
    usage: (base) => new UsageLog(base).load(2000),
    log: (base, record) => new UsageLog(base).append(record),
    changed: (state) => sendToWindow("hh:sidekick", state),
  });
```

(`languageName` takes the canonical language code the config stores.)

5. The `betweenTasks` getter in the TaskManager deps (around line 780):

```ts
  get betweenTasks() {
    const settings = settingsCtl;
    const sidekick = sidekickCtl;
    if (!settings && !sidekick) return undefined;
    return async () => {
      await settings?.betweenTasks();
      await sidekick?.betweenTasks();
    };
  },
```

6. In `registerIpc()`, after the settings handlers: `registerSidekickIpc(handle, () => sidekickCtl);`

7. In `appState()`, next to `settings`: `sidekick: { id: "sidekick", name: "Sidekick" },`

8. In `modelsView()`'s `recommended`, after the material line:

```ts
      // Sidekick is a process of its own (sidekick spec §5), light by default.
      [SIDEKICK_PROCESS]: "light",
```

9. In `before-quit`, next to `turns.close()`: `void sidekickCtl?.close();`

- [ ] **Step 4: Run the tests and the build**

Run: `corepack pnpm --filter @humanharness/shell test && corepack pnpm --filter @humanharness/ui test`
Expected: PASS (UI tests unchanged: the FakeClient's Sidekick is off and its `AppState` has no `sidekick`).

Run: `corepack pnpm typecheck && corepack pnpm app:build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/shell packages/ui/src/client.ts packages/ui/test/fake-client.ts
git -C <worktree> commit -m "feat(shell): wire Sidekick into main, IPC, preload and the client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---
### Task 13: UI — the `useSidekick` hook

**Files:**
- Create: `packages/ui/src/sidekick/useSidekick.ts`
- Test: `packages/ui/test/sidekick-hook.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/test/sidekick-hook.test.tsx
// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SidekickState } from "../src/client";
import { useSidekick } from "../src/sidekick/useSidekick";
import { FakeClient } from "./fake-client";

afterEach(cleanup);
export const SK_ON: SidekickState = {
  info: { id: "sidekick", name: "Sidekick" },
  settings: { on: true, preSend: true, wait: 6, cap: 20_000, introSeen: true },
  status: "watching",
  spent: 1200,
  cap: 20_000,
  tier: "light",
  card: null,
  week: 3400,
};

describe("useSidekick", () => {
  it("null when disabled; never asks the client", async () => {
    const client = new FakeClient({ language: "en" });
    client.sidekickState = SK_ON;
    const { result } = renderHook(() => useSidekick(client, false));
    expect(result.current).toBeNull();
  });

  it("loads the state and follows pushes", async () => {
    const client = new FakeClient({ language: "en" });
    client.sidekickState = SK_ON;
    const { result } = renderHook(() => useSidekick(client, true));
    await waitFor(() => expect(result.current?.status).toBe("watching"));
    act(() => client.emitSidekick({ ...SK_ON, status: "reading" }));
    expect(result.current?.status).toBe("reading");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm --filter @humanharness/ui test -- sidekick-hook`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// packages/ui/src/sidekick/useSidekick.ts
import { useEffect, useState } from "react";
import type { HarnessClient, SidekickState } from "../client";

/** Sidekick's state, live; null while loading, when disabled (no `state.sidekick`, slim mode) or when main has none. */
export function useSidekick(client: HarnessClient, enabled: boolean): SidekickState | null {
  const [state, setState] = useState<SidekickState | null>(null);
  useEffect(() => {
    if (!enabled) {
      setState(null);
      return;
    }
    let live = true;
    const off = client.sidekick.onChange((s) => live && setState(s));
    client.sidekick.get().then(
      (s) => live && setState((now) => now ?? s),
      () => undefined,
    );
    return () => {
      live = false;
      off();
    };
  }, [client, enabled]);
  return enabled ? state : null;
}
```

- [ ] **Step 4: Run the test**

Run: `corepack pnpm --filter @humanharness/ui test -- sidekick-hook`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
corepack pnpm typecheck
git -C <worktree> add packages/ui
git -C <worktree> commit -m "feat(ui): useSidekick hook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 14: UI — the panel, the card, the strings and the styles

**Files:**
- Create: `packages/ui/src/sidekick/word-diff.ts`, `packages/ui/src/sidekick/mark.tsx`, `packages/ui/src/sidekick/SidekickPanel.tsx`
- Modify: `packages/i18n/src/locales/en.json` (new top-level `"sidekick"` block, before `"errors"`)
- Modify: `packages/ui/src/styles.css` (one appended `/* Sidekick */` block)
- Test: `packages/ui/test/sidekick-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/test/sidekick-panel.test.tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SidekickCard, SidekickState } from "../src/client";
import { SidekickPanel } from "../src/sidekick/SidekickPanel";
import { wordDiff } from "../src/sidekick/word-diff";
import { renderIn } from "./render";
import { SK_ON } from "./sidekick-hook.test";

afterEach(cleanup);
const CARD: SidekickCard = {
  id: "c1",
  prompt: "make it better",
  flags: [{ kind: "vague", match: "better", span: [8, 14] }],
  issues: [{ kind: "vague", text: "Say what better means." }],
  rewrite: "make the intro shorter, under 80 words",
  queued: ["Translate chapter 2 into Spanish"],
  confidence: 0.8,
  at: "2026-10-27T10:00:00Z",
};
const handlers = () => ({
  onCollapse: vi.fn(), onTurnOn: vi.fn(), onNotNow: vi.fn(), onSendSuggested: vi.fn(), onEdit: vi.fn(), onSendAnyway: vi.fn(), onPutInComposer: vi.fn(), onView: vi.fn(),
});
const panel = (state: SidekickState, h = handlers(), extra: Partial<Parameters<typeof SidekickPanel>[0]> = {}) =>
  renderIn("en", <SidekickPanel state={state} view="sidekick" sendKey="⌘" {...h} {...extra} />).then(() => h);

describe("wordDiff", () => {
  it("marks the added words", () => {
    expect(wordDiff("make it better", "make it shorter please")).toEqual([
      { text: "make it ", added: false },
      { text: "shorter please", added: true },
    ]);
  });
});

describe("SidekickPanel", () => {
  it("head: mark, name and state; foot: tokens, cap, tier and the ⌘⏎ hint", async () => {
    await panel(SK_ON);
    expect(screen.getByRole("heading", { name: "Sidekick" })).toBeTruthy();
    expect(screen.getByText("Watching")).toBeTruthy();
    expect(screen.getByText("Sidekick in this task — 1,200 / 20,000 tokens")).toBeTruthy();
    expect(screen.getByText("Tier: Light")).toBeTruthy();
    expect(screen.getByText("⌘⏎ sends now")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("the card: issues, the rewrite with added words marked, the three buttons", async () => {
    const h = await panel({ ...SK_ON, status: "suggestion", card: CARD });
    expect(screen.getByText("Say what better means.")).toBeTruthy();
    expect(screen.getByText("the intro shorter, under 80 words", { selector: "ins" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send suggested" }));
    expect(h.onSendSuggested).toHaveBeenCalledWith(CARD);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(h.onEdit).toHaveBeenCalledWith(CARD);
    fireEvent.click(screen.getByRole("button", { name: "Send anyway" }));
    expect(h.onSendAnyway).toHaveBeenCalledWith(CARD);
  });

  it("queued prompts: Put in composer and Drop", async () => {
    const h = await panel({ ...SK_ON, status: "suggestion", card: CARD });
    fireEvent.click(screen.getByRole("button", { name: "Put in composer" }));
    expect(h.onPutInComposer).toHaveBeenCalledWith("Translate chapter 2 into Spanish");
    fireEvent.click(screen.getByRole("button", { name: "Drop" }));
    expect(screen.queryByText("Translate chapter 2 into Spanish")).toBeNull();
  });

  it("a card without a rewrite has no Send suggested or Edit", async () => {
    const { rewrite: _r, ...noRewrite } = CARD;
    await panel({ ...SK_ON, status: "suggestion", card: noRewrite });
    expect(screen.queryByRole("button", { name: "Send suggested" })).toBeNull();
    expect(screen.getByRole("button", { name: "Send anyway" })).toBeTruthy();
  });

  it("the quiet notice after a failed review", async () => {
    await panel({ ...SK_ON, notice: "failed" });
    expect(screen.getByText("Sidekick couldn't review this one. Your prompt went as typed.")).toBeTruthy();
  });

  it("off, first time: the intro with Turn on and Not now", async () => {
    const h = await panel({ ...SK_ON, status: "off", settings: { ...SK_ON.settings, on: false, introSeen: false } });
    expect(screen.getByText(/reads your prompt before it goes out/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(h.onTurnOn).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(h.onNotNow).toHaveBeenCalled();
  });

  it("with a harness panel: the Sidekick | Harness switch shows the harness's side", async () => {
    const h = handlers();
    await renderIn("en", <SidekickPanel state={SK_ON} view="harness" sendKey="⌘" harnessSide={<p>Harness side</p>} {...h} />);
    expect(screen.getByText("Harness side")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sidekick" }));
    expect(h.onView).toHaveBeenCalledWith("sidekick");
  });

  it("never takes focus (spec §7 accessibility)", async () => {
    const input = document.createElement("textarea");
    document.body.appendChild(input);
    input.focus();
    await panel({ ...SK_ON, status: "suggestion", card: CARD });
    expect(document.activeElement).toBe(input);
  });
});
```

(`Segmented` in `chrome.tsx` renders a `role="group"` of buttons with `aria-pressed`; the head's mark has no accessible name, so the only button named "Sidekick" is the switch's.)

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm --filter @humanharness/ui test -- sidekick-panel`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

The strings (en.json, a new top-level block placed right before `"errors"`; nothing else in the file changes):

```json
  "sidekick": {
    "tab": "Sidekick",
    "toggle": "Sidekick",
    "toggleOn": "Sidekick is on. Turn it off",
    "toggleOff": "Sidekick is off. Turn it on",
    "open": "Open Sidekick",
    "collapse": "Collapse Sidekick",
    "waiting": "Sidekick has a suggestion",
    "status": {
      "off": "Off",
      "watching": "Watching",
      "reading": "Reading your prompt…",
      "suggestion": "Has a suggestion",
      "capped": "Past its cap for this task"
    },
    "switch": { "label": "Show", "sidekick": "Sidekick", "harness": "Harness" },
    "flag": {
      "vague": "“{{match}}” is vague",
      "missing-context": "“{{match}}” points at something that isn't attached",
      "two-asks": "Two asks in one prompt",
      "off-phase": "“{{match}}” belongs to another phase"
    },
    "card": {
      "title": "Before you send",
      "rewrite": "Suggested prompt",
      "queued": "For later",
      "sendSuggested": "Send suggested",
      "edit": "Edit",
      "sendAnyway": "Send anyway",
      "putInComposer": "Put in composer",
      "drop": "Drop",
      "announce": "Sidekick has a suggestion for your prompt."
    },
    "notice": {
      "failed": "Sidekick couldn't review this one. Your prompt went as typed.",
      "timeout": "Sidekick took too long. Your prompt went as typed."
    },
    "foot": "Sidekick in this task — {{spent}} / {{cap}} tokens",
    "footNoCap": "Sidekick in this task — {{spent}} tokens",
    "tier": "Tier: {{tier}}",
    "tiers": { "light": "Light", "standard": "Standard", "deep": "Deep", "custom": "Custom" },
    "sendNow": "{{key}}⏎ sends now",
    "off": "Sidekick is off.",
    "intro": {
      "title": "Meet Sidekick",
      "body": "Sidekick reads your prompt before it goes out and suggests a clearer one when something looks off. It uses a small model, up to {{cap}} tokens per task, and you can turn it off at any time.",
      "turnOn": "Turn on",
      "notNow": "Not now"
    },
    "composer": {
      "reviewing": "Reviewing…",
      "countdown": "Sends anyway in {{seconds}} s",
      "waitingLong": "Waiting for Sidekick",
      "review": "Review"
    },
    "settings": {
      "on": "Sidekick",
      "onHint": "Reads your prompt before it goes out and suggests a clearer one.",
      "preSend": "Before you send",
      "preSendHint": "Review prompts before they go out.",
      "wait": "Longest wait",
      "wait6": "6 s",
      "wait10": "10 s",
      "waitAlways": "Always wait",
      "tier": "Model",
      "changeTier": "Change in Models",
      "cap": "Cap per task",
      "cap20": "20k tokens",
      "cap50": "50k tokens",
      "capNone": "No cap",
      "week": "This week: {{tokens}} tokens",
      "failed": "Could not save: {{message}}"
    },
    "models": { "label": "Sidekick", "hint": "Reviews your prompts before they go out" },
    "usage": "Sidekick: about {{tokens}} tokens"
  },
```

```ts
// packages/ui/src/sidekick/word-diff.ts
export interface DiffPart {
  text: string;
  added: boolean;
}

/** What `after` adds to `before`, word by word (LCS over words and the spaces after them); removed words are dropped. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.split(/(?<=\s)/);
  const b = after.split(/(?<=\s)/);
  const norm = (w: string) => w.trim().toLowerCase();
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = norm(a[i]) === norm(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const parts: DiffPart[] = [];
  const push = (text: string, added: boolean) => {
    const last = parts.at(-1);
    if (last && last.added === added) last.text += text;
    else parts.push({ text, added });
  };
  let i = 0;
  let j = 0;
  while (j < m) {
    if (i < n && norm(a[i]) === norm(b[j])) {
      push(b[j], false);
      i++;
      j++;
    } else if (i < n && dp[i + 1][j] >= dp[i][j + 1]) i++;
    else {
      push(b[j], true);
      j++;
    }
  }
  return parts;
}
```

Check the test's expectation against this algorithm: `"make it better"` → `["make ", "it ", "better"]`, `"make it shorter please"` → `["make ", "it ", "shorter ", "please"]`; the result is `[{ "make it ", false }, { "shorter please", true }]`. 

```tsx
// packages/ui/src/sidekick/mark.tsx
/** Sidekick's mark: a small speech bubble with a spark. Colour from the token, grey when off. */
export function SidekickMark({ off, size = 20 }: { off?: boolean; size?: number }) {
  return (
    <svg className={`hh-sk-mark${off ? " hh-sk-mark-off" : ""}`} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M4 4h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 6.5l.9 1.9 1.9.9-1.9.9-.9 1.9-.9-1.9-1.9-.9 1.9-.9z" fill="currentColor" />
    </svg>
  );
}
```

```tsx
// packages/ui/src/sidekick/SidekickPanel.tsx
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Segmented } from "../chrome";
import type { SidekickCard, SidekickState } from "../client";
import { shownLanguage } from "../language";
import { SidekickMark } from "./mark";
import { wordDiff } from "./word-diff";

export interface SidekickPanelProps {
  state: SidekickState;
  /** Which side shows when the harness also has one (spec §7). */
  view: "sidekick" | "harness";
  onView(view: "sidekick" | "harness"): void;
  /** The harness's own side panel (renderSide), when it has one. */
  harnessSide?: ReactNode;
  /** "⌘" on macOS, "Ctrl" elsewhere. */
  sendKey: string;
  onCollapse(): void;
  onTurnOn(): void;
  onNotNow(): void;
  onSendSuggested(card: SidekickCard): void;
  onEdit(card: SidekickCard): void;
  onSendAnyway(card: SidekickCard): void;
  onPutInComposer(text: string): void;
}

/** The expanded Sidekick panel, 330 px (spec §7, mockup boards 1–3). Never takes focus. */
export function SidekickPanel(p: SidekickPanelProps) {
  const { t, i18n } = useTranslation();
  const n = (v: number) => v.toLocaleString(shownLanguage(i18n));
  const s = p.state;
  const showHarness = p.harnessSide !== undefined && p.view === "harness";
  return (
    <aside className="hh-sk-panel" aria-label={s.info.name}>
      <header className="hh-sk-head">
        <SidekickMark off={!s.settings.on} />
        <h2 className="hh-sk-name">{s.info.name}</h2>
        <span className="hh-sk-status">{t(`sidekick.status.${s.status}`)}</span>
        <span className="hh-spacer" />
        <button type="button" className="hh-sk-collapse" aria-label={t("sidekick.collapse")} onClick={p.onCollapse} tabIndex={0}>
          ›
        </button>
      </header>
      {p.harnessSide !== undefined && (
        <Segmented
          label={t("sidekick.switch.label")}
          options={[
            { value: "sidekick", label: t("sidekick.switch.sidekick") },
            { value: "harness", label: t("sidekick.switch.harness") },
          ]}
          value={p.view}
          onChange={p.onView}
        />
      )}
      {showHarness ? (
        <div className="hh-sk-harness">{p.harnessSide}</div>
      ) : (
        <div className="hh-sk-body">
          {!s.settings.on ? (
            s.settings.introSeen ? (
              <div className="hh-sk-off">
                <p>{t("sidekick.off")}</p>
                <button type="button" onClick={p.onTurnOn}>{t("sidekick.intro.turnOn")}</button>
              </div>
            ) : (
              <div className="hh-sk-intro">
                <h3>{t("sidekick.intro.title")}</h3>
                <p>{t("sidekick.intro.body", { cap: n(s.cap ?? 20_000) })}</p>
                <div className="hh-sk-actions">
                  <button type="button" className="hh-primary" onClick={p.onTurnOn}>{t("sidekick.intro.turnOn")}</button>
                  <button type="button" onClick={p.onNotNow}>{t("sidekick.intro.notNow")}</button>
                </div>
              </div>
            )
          ) : (
            <>
              {s.notice && <p className="hh-caption hh-sk-notice">{t(`sidekick.notice.${s.notice}`)}</p>}
              {s.card && <Card card={s.card} {...p} />}
            </>
          )}
        </div>
      )}
      {s.settings.on && (
        <footer className="hh-sk-foot">
          <p>{s.cap === null ? t("sidekick.footNoCap", { spent: n(s.spent) }) : t("sidekick.foot", { spent: n(s.spent), cap: n(s.cap) })}</p>
          {s.cap !== null && <progress max={s.cap} value={Math.min(s.spent, s.cap)} aria-label={t("sidekick.toggle")} />}
          <p className="hh-caption">
            {t("sidekick.tier", { tier: t(`sidekick.tiers.${s.tier}`, { defaultValue: s.tier }) })} · {t("sidekick.sendNow", { key: p.sendKey })}
          </p>
        </footer>
      )}
    </aside>
  );
}

function Card({ card, onSendSuggested, onEdit, onSendAnyway, onPutInComposer }: { card: SidekickCard } & SidekickPanelProps) {
  const { t } = useTranslation();
  const [dropped, setDropped] = useState<string[]>([]);
  const queued = (card.queued ?? []).filter((q) => !dropped.includes(q));
  return (
    <section className="hh-sk-card" aria-label={t("sidekick.card.title")}>
      <h3>{t("sidekick.card.title")}</h3>
      <ul className="hh-sk-issues">
        {card.issues.length > 0
          ? card.issues.map((issue, i) => <li key={i}>{issue.text}</li>)
          : card.flags.map((f) => <li key={f.kind}>{t(`sidekick.flag.${f.kind}`, { match: f.match })}</li>)}
      </ul>
      {card.rewrite && (
        <div className="hh-sk-rewrite">
          <h4>{t("sidekick.card.rewrite")}</h4>
          <p>
            {wordDiff(card.prompt, card.rewrite).map((part, i) => (part.added ? <ins key={i}>{part.text}</ins> : <span key={i}>{part.text}</span>))}
          </p>
        </div>
      )}
      {queued.length > 0 && (
        <div className="hh-sk-queued">
          <h4>{t("sidekick.card.queued")}</h4>
          <ul>
            {queued.map((q) => (
              <li key={q}>
                <p>{q}</p>
                <button type="button" onClick={() => onPutInComposer(q)}>{t("sidekick.card.putInComposer")}</button>
                <button type="button" onClick={() => setDropped((d) => [...d, q])}>{t("sidekick.card.drop")}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="hh-sk-actions">
        {card.rewrite && (
          <>
            <button type="button" className="hh-primary" onClick={() => onSendSuggested(card)}>{t("sidekick.card.sendSuggested")}</button>
            <button type="button" onClick={() => onEdit(card)}>{t("sidekick.card.edit")}</button>
          </>
        )}
        <button type="button" onClick={() => onSendAnyway(card)}>{t("sidekick.card.sendAnyway")}</button>
      </div>
    </section>
  );
}
```

(`shownLanguage` is the helper `UsageTab.tsx` already uses for numbers; import it from the same module `UsageTab.tsx` does.)

The styles (appended once to `packages/ui/src/styles.css`; tokens only):

```css
/* Sidekick (sidekick spec §7) */
.hh-sk-panel { width: 330px; flex: none; display: flex; flex-direction: column; border-left: 1px solid var(--hh-line); background: var(--hh-paper); min-height: 0; }
.hh-sk-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--hh-line); }
.hh-sk-name { font-size: 1rem; margin: 0; }
.hh-sk-status { color: var(--hh-muted); font-size: 0.85rem; }
.hh-sk-body, .hh-sk-harness { flex: 1; overflow-y: auto; padding: 12px 14px; }
.hh-sk-card { border: 1px solid var(--hh-line); border-radius: 10px; padding: 12px; background: var(--hh-surface); }
.hh-sk-card h3 { margin: 0 0 8px; font-size: 0.95rem; }
.hh-sk-card h4 { margin: 10px 0 4px; font-size: 0.8rem; color: var(--hh-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.hh-sk-issues { margin: 0; padding-left: 18px; }
.hh-sk-rewrite ins { text-decoration: none; background: var(--hh-accent-soft); border-radius: 3px; }
.hh-sk-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.hh-sk-foot { border-top: 1px solid var(--hh-line); padding: 10px 14px; font-size: 0.85rem; }
.hh-sk-foot progress { width: 100%; height: 4px; accent-color: var(--hh-accent); }
.hh-sk-mark { color: var(--hh-accent); flex: none; }
.hh-sk-mark-off { color: var(--hh-muted); }
.hh-sk-rail { width: 52px; flex: none; display: flex; flex-direction: column; align-items: center; padding-top: 12px; border-left: 1px solid var(--hh-line); background: var(--hh-paper); }
.hh-sk-rail button { position: relative; }
.hh-sk-rail .hh-sk-dot { position: absolute; top: 2px; right: 2px; width: 8px; height: 8px; border-radius: 50%; background: var(--hh-accent); }
.hh-sk-toggle .hh-sk-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid var(--hh-accent); margin-right: 6px; }
.hh-sk-toggle[aria-pressed="true"] .hh-sk-dot { background: var(--hh-accent); }
.hh-sk-composer-hint { color: var(--hh-muted); font-size: 0.85rem; margin: 4px 0 0; }
.hh-sk-flagged { position: relative; }
.hh-sk-backdrop { position: absolute; inset: 0; pointer-events: none; color: transparent; white-space: pre-wrap; overflow-wrap: break-word; overflow: hidden; }
.hh-sk-backdrop mark { color: transparent; background: none; text-decoration: underline wavy var(--hh-warn); text-underline-offset: 3px; }
@media (max-width: 720px) { .hh-sk-panel, .hh-sk-rail { display: none; } }
```

Before writing, check which tokens exist (`grep -o -- '--hh-[a-z-]*' packages/ui/src/styles.css | sort -u`) and use the nearest existing names for `--hh-line`, `--hh-paper`, `--hh-surface`, `--hh-muted`, `--hh-accent`, `--hh-accent-soft`, `--hh-warn`; never a raw colour (`packages/ui/test/styles.test.ts` checks this).

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/ui test -- sidekick-panel styles`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/ui packages/i18n/src/locales/en.json
git -C <worktree> commit -m "feat(ui): Sidekick panel, card, intro and strings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 15: UI — the composer, the keys, the right column and the top-bar toggle

**Files:**
- Modify: `packages/ui/src/chrome.tsx` (`SidekickToggle`)
- Modify: `packages/ui/src/ChatView.tsx` (composer around lines 764-767 and 1139-1162, side column at 1165, top bar at 854)
- Modify: `packages/ui/src/HarnessApp.tsx` (pass `onSidekickSettings`)
- Test: `packages/ui/test/sidekick-chat.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/test/sidekick-chat.test.tsx
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp } from "../src";
import type { SidekickCard } from "../src/client";
import { FakeClient } from "./fake-client";
import { SK_ON } from "./sidekick-hook.test";

afterEach(cleanup);
const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const CARD: SidekickCard = { id: "c1", prompt: "make it better", flags: [{ kind: "vague", match: "better", span: [8, 14] }], issues: [{ kind: "vague", text: "Say what better means." }], rewrite: "make the intro shorter", confidence: 0.8, at: "2026-10-27T10:00:00Z" };

function client(withSidekick = true) {
  const c = new FakeClient(ready);
  if (withSidekick) {
    c.state.sidekick = { id: "sidekick", name: "Sidekick" };
    c.sidekickState = SK_ON;
  }
  return c;
}
async function open(c: FakeClient) {
  render(<HarnessApp client={c} />);
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  return (await screen.findByRole("textbox")) as HTMLTextAreaElement;
}
const type = (box: HTMLTextAreaElement, text: string) => fireEvent.change(box, { target: { value: text } });
const enter = (box: HTMLTextAreaElement, mods: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(box, { key: "Enter", ...mods });

describe("Sidekick in the chat", () => {
  it("D0: without state.sidekick, Enter sends at once and there is no toggle or panel", async () => {
    const c = client(false);
    const box = await open(c);
    type(box, "make it better");
    enter(box);
    await waitFor(() => expect(c.sent).toEqual(["make it better"]));
    expect(c.sidekickCalls).toEqual([]);
    expect(screen.queryByRole("button", { name: /Sidekick is/ })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Sidekick" })).toBeNull();
  });

  it("Enter asks for a review; `send` sends as typed", async () => {
    const c = client();
    const box = await open(c);
    type(box, "make it better");
    enter(box);
    await waitFor(() => expect(c.sent).toEqual(["make it better"]));
    expect(c.sidekickCalls[0]).toEqual(["review", { text: "make it better" }]);
  });

  it("a card holds the prompt: nothing is sent; Send suggested sends the rewrite and resolves the card", async () => {
    const c = client();
    c.sidekickReviews = [{ kind: "card", card: CARD }];
    const box = await open(c);
    type(box, "make it better");
    enter(box);
    act(() => c.emitSidekick({ ...SK_ON, status: "suggestion", card: CARD }));
    fireEvent.click(await screen.findByRole("button", { name: "Send suggested" }));
    await waitFor(() => expect(c.sent).toEqual(["make the intro shorter"]));
    expect(c.sidekickCalls).toContainEqual(["resolve", "c1", "used"]);
    expect(box.value).toBe("");
  });

  it("Edit puts the rewrite in the composer; Send anyway sends the original", async () => {
    const c = client();
    c.sidekickReviews = [{ kind: "card", card: CARD }];
    const box = await open(c);
    type(box, "make it better");
    enter(box);
    act(() => c.emitSidekick({ ...SK_ON, status: "suggestion", card: CARD }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(box.value).toBe("make the intro shorter");
    expect(c.sent).toEqual([]);
  });

  it("⌘⏎ (or Ctrl⏎) sends at once with no review", async () => {
    const c = client();
    const box = await open(c);
    type(box, "make it better");
    enter(box, { metaKey: true });
    await waitFor(() => expect(c.sent).toEqual(["make it better"]));
    expect(c.sidekickCalls.filter(([k]) => k === "review")).toEqual([]);
  });

  it("⌥⏎ asks for a review even without flags", async () => {
    const c = client();
    const box = await open(c);
    type(box, "Rewrite paragraph 2");
    enter(box, { altKey: true });
    await waitFor(() => expect(c.sidekickCalls[0]).toEqual(["review", { text: "Rewrite paragraph 2", force: true }]));
  });

  it("while reviewing: the send button reads Reviewing… with the countdown; ⌘⏎ cancels and sends", async () => {
    const c = client();
    let resolve!: (r: { kind: "cancelled" }) => void;
    c.sidekick.review = (req) => (c.sidekickCalls.push(["review", req]), new Promise((r) => (resolve = r)));
    const box = await open(c);
    type(box, "make it better");
    enter(box);
    expect(await screen.findByRole("button", { name: "Reviewing…" })).toBeTruthy();
    expect(screen.getByText(/Sends anyway in \d+ s/)).toBeTruthy();
    enter(box, { metaKey: true });
    await waitFor(() => expect(c.sent).toEqual(["make it better"]));
    expect(c.sidekickCalls).toContainEqual(["cancel"]);
    resolve({ kind: "cancelled" });
  });

  it("Sidekick off: Enter sends without a review; the top-bar toggle turns it on", async () => {
    const c = client();
    c.sidekickState = { ...SK_ON, status: "off", settings: { ...SK_ON.settings, on: false } };
    const box = await open(c);
    type(box, "make it better");
    enter(box);
    await waitFor(() => expect(c.sent).toEqual(["make it better"]));
    expect(c.sidekickCalls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Sidekick is off. Turn it on" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["set", { on: true, introSeen: true }]));
  });

  it("a new card is announced once in the polite live region", async () => {
    const c = client();
    c.sidekickReviews = [{ kind: "card", card: CARD }];
    const box = await open(c);
    type(box, "make it better");
    enter(box);
    await waitFor(() => expect(document.querySelector('[aria-live="polite"]')?.textContent).toContain("Sidekick has a suggestion for your prompt."));
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm --filter @humanharness/ui test -- sidekick-chat`
Expected: FAIL — no review call (Enter sends directly).

- [ ] **Step 3: Implement**

In `chrome.tsx`:

```tsx
/** The top-bar Sidekick switch (spec §7): a state dot, filled when on. */
export function SidekickToggle({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" className="hh-sk-toggle" aria-pressed={on} aria-label={label} onClick={onToggle}>
      <span className="hh-sk-dot" aria-hidden="true" />
      Sidekick
    </button>
  );
}
```

In `ChatView.tsx`:

1. Imports: `SidekickToggle` from `./chrome`; `type SidekickCard, type SidekickReview` from `./client`; `useSidekick` from `./sidekick/useSidekick`; `SidekickPanel` from `./sidekick/SidekickPanel`; `SidekickMark` from `./sidekick/mark`; `FlaggedText` from `./sidekick/FlaggedText` (Task 16; until then leave the composer textarea as is).

2. A new optional prop `onSidekickSettings?: () => void` (opens Settings › Sidekick; used by the panel's tier line later).

3. State, near the other `useState`s:

```tsx
  const SEND_KEY = /Mac/.test(navigator.userAgent) ? "⌘" : "Ctrl";
  const sidekick = useSidekick(client, state.sidekick !== undefined && !slim);
  const reviewOn = sidekick !== null && sidekick.settings.on && sidekick.settings.preSend;
  /** A review in flight: until when the countdown runs (null: "always wait"). */
  const [reviewing, setReviewing] = useState<{ until: number | null } | null>(null);
  const reviewSeq = useRef(0);
  const [skOpen, setSkOpen] = useState<boolean | null>(null);
  const [skView, setSkView] = useState<"sidekick" | "harness">("sidekick");
  const skExpanded = sidekick !== null && (skOpen ?? sidekick.settings.on);
```

4. The review gate, next to `send`:

```tsx
  /** Enter: review first when Sidekick is on (spec §4.1); `force` is ⌥⏎ / Review. */
  const submit = async (text: string, force = false) => {
    if (!text.trim()) return;
    if (!reviewOn || reviewing) {
      if (send(text)) setDraft("");
      return;
    }
    const seq = ++reviewSeq.current;
    const wait = sidekick!.settings.wait;
    setReviewing({ until: wait === "always" ? null : Date.now() + wait * 1000 });
    const r: SidekickReview = await client.sidekick.review({ text, ...(force ? { force: true } : {}) }).catch(() => ({ kind: "error" }) as const);
    if (seq !== reviewSeq.current) return;
    setReviewing(null);
    if (r.kind === "card") {
      setAnnouncement(t("sidekick.card.announce"));
      setSkOpen(true);
      setSkView("sidekick");
      return;
    }
    if (r.kind === "cancelled") return;
    if (send(text)) setDraft("");
  };
  /** ⌘⏎: send now, cancelling a running review. */
  const sendNow = (text: string) => {
    if (reviewing) {
      reviewSeq.current++;
      setReviewing(null);
      void client.sidekick.cancelReview();
    }
    if (send(text)) setDraft("");
  };
  const resolveCard = (card: SidekickCard, outcome: "used" | "edited" | "sent-anyway") => void client.sidekick.resolve(card.id, outcome);
```

5. `onSubmit` (line ~764) becomes:

```tsx
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit(draft);
  };
```

6. The composer (line ~1139):

```tsx
            <form className="hh-composer" onSubmit={onSubmit}>
              <textarea
                ref={inputRef}
                aria-label={placeholder}
                placeholder={placeholder}
                value={draft}
                readOnly={reviewing !== null}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.shiftKey) return;
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  e.preventDefault();
                  if (e.metaKey || e.ctrlKey) sendNow(draft);
                  else void submit(draft, e.altKey);
                }}
              />
              {chat.live || closing || checkpoint ? (
                <button type="button" onClick={() => void client.cancel()}>
                  {t("chat.stop")}
                </button>
              ) : reviewing ? (
                <button type="button" disabled>{t("sidekick.composer.reviewing")}</button>
              ) : (
                <>
                  {reviewOn && (
                    <button type="button" onClick={() => void submit(draft, true)}>{t("sidekick.composer.review")}</button>
                  )}
                  <button type="submit">{t("chat.send")}</button>
                </>
              )}
            </form>
          )}
          {reviewing && <ReviewHint until={reviewing.until} sendKey={SEND_KEY} />}
```

and, at the bottom of the file:

```tsx
/** "Sends anyway in N s · ⌘⏎ sends now": the countdown's text equivalent (spec §7 accessibility). */
function ReviewHint({ until, sendKey }: { until: number | null; sendKey: string }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const left = until === null ? null : Math.max(0, Math.ceil((until - now) / 1000));
  return (
    <p className="hh-sk-composer-hint">
      {left === null ? t("sidekick.composer.waitingLong") : t("sidekick.composer.countdown", { seconds: left })} · {t("sidekick.sendNow", { key: sendKey })}
    </p>
  );
}
```

7. The top bar (line ~854), before the history button:

```tsx
          {sidekick && (
            <SidekickToggle
              on={sidekick.settings.on}
              label={t(sidekick.settings.on ? "sidekick.toggleOn" : "sidekick.toggleOff")}
              onToggle={() => {
                const on = !sidekick.settings.on;
                void client.sidekick.set(on ? { on, introSeen: true } : { on });
                setSkOpen(on);
              }}
            />
          )}
```

8. The right column (line ~1165) replaces the single `hh-side` line:

```tsx
        {(() => {
          const harnessSide = renderSide && !slim ? renderSide(chat.blockState, sendFromHarness) : undefined;
          // D0: without Sidekick, exactly the harness's side panel as before.
          if (!sidekick) return harnessSide !== undefined ? <aside className="hh-side">{harnessSide}</aside> : null;
          if (!skExpanded) {
            return (
              <>
                {harnessSide !== undefined && <aside className="hh-side">{harnessSide}</aside>}
                <div className="hh-sk-rail">
                  <button type="button" aria-label={sidekick.card ? t("sidekick.waiting") : t("sidekick.open")} onClick={() => setSkOpen(true)}>
                    <SidekickMark off={!sidekick.settings.on} />
                    {sidekick.card && <span className="hh-sk-dot" aria-hidden="true" />}
                  </button>
                </div>
              </>
            );
          }
          return (
            <SidekickPanel
              state={sidekick}
              view={harnessSide !== undefined ? skView : "sidekick"}
              onView={setSkView}
              {...(harnessSide !== undefined ? { harnessSide } : {})}
              sendKey={SEND_KEY}
              onCollapse={() => setSkOpen(false)}
              onTurnOn={() => void client.sidekick.set({ on: true, introSeen: true })}
              onNotNow={() => {
                void client.sidekick.set({ introSeen: true });
                setSkOpen(false);
              }}
              onSendSuggested={(card) => {
                resolveCard(card, "used");
                if (card.rewrite && send(card.rewrite)) setDraft("");
              }}
              onEdit={(card) => {
                resolveCard(card, "edited");
                setDraft(card.rewrite ?? card.prompt);
                inputRef.current?.focus();
              }}
              onSendAnyway={(card) => {
                resolveCard(card, "sent-anyway");
                if (send(card.prompt)) setDraft("");
              }}
              onPutInComposer={(text) => {
                setDraft(text);
                inputRef.current?.focus();
              }}
            />
          );
        })()}
```

`send(card.rewrite)` goes through `send` directly, never through `submit`: a suggestion is never reviewed again.

In `HarnessApp.tsx`, pass `onSidekickSettings={() => setSettings("sidekick")}` to `ChatView` (the `"sidekick"` tab id exists after Task 17; until then this line is added in Task 17).

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/ui test`
Expected: PASS — the new file and every existing UI test unchanged (they use a FakeClient without `state.sidekick`).

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/ui
git -C <worktree> commit -m "feat(ui): Sidekick in the composer, the right column and the top bar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 16: UI — flagged spans underlined in the composer

**Files:**
- Create: `packages/ui/src/sidekick/FlaggedText.tsx`
- Modify: `packages/ui/src/ChatView.tsx` (wrap the textarea)
- Test: `packages/ui/test/sidekick-flagged.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/test/sidekick-flagged.test.tsx
// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FlaggedText, flaggedParts } from "../src/sidekick/FlaggedText";

afterEach(cleanup);

describe("FlaggedText", () => {
  it("splits the text at the spans, merging overlaps and dropping spans out of range", () => {
    expect(flaggedParts("make it better", [[8, 14], [10, 12], [20, 30]])).toEqual([
      { text: "make it ", flagged: false },
      { text: "better", flagged: true },
    ]);
  });

  it("draws marks behind the field, hidden from screen readers", () => {
    const { container } = render(<FlaggedText text="make it better" spans={[[8, 14]]}><textarea /></FlaggedText>);
    const backdrop = container.querySelector(".hh-sk-backdrop")!;
    expect(backdrop.getAttribute("aria-hidden")).toBe("true");
    expect(backdrop.querySelector("mark")?.textContent).toBe("better");
  });

  it("no spans: only the field", () => {
    const { container } = render(<FlaggedText text="x" spans={[]}><textarea /></FlaggedText>);
    expect(container.querySelector(".hh-sk-backdrop")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm --filter @humanharness/ui test -- sidekick-flagged`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```tsx
// packages/ui/src/sidekick/FlaggedText.tsx
import type { ReactNode } from "react";

export function flaggedParts(text: string, spans: readonly (readonly [number, number])[]): { text: string; flagged: boolean }[] {
  const valid = spans.filter(([a, b]) => a >= 0 && b > a && b <= text.length).map(([a, b]) => [a, b] as [number, number]).sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const s of valid) {
    const last = merged.at(-1);
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  const parts: { text: string; flagged: boolean }[] = [];
  let at = 0;
  for (const [a, b] of merged) {
    if (a > at) parts.push({ text: text.slice(at, a), flagged: false });
    parts.push({ text: text.slice(a, b), flagged: true });
    at = b;
  }
  if (at < text.length) parts.push({ text: text.slice(at), flagged: false });
  return parts;
}

/**
 * The composer with the card's flagged spans underlined (spec §7): a backdrop with the same text and metrics sits
 * behind the transparent-backed textarea. Hidden from screen readers: the card says the same in words.
 */
export function FlaggedText({ text, spans, children }: { text: string; spans: readonly (readonly [number, number])[]; children: ReactNode }) {
  if (spans.length === 0) return <>{children}</>;
  return (
    <div className="hh-sk-flagged">
      <div className="hh-sk-backdrop" aria-hidden="true">
        {flaggedParts(text, spans).map((p, i) => (p.flagged ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
      </div>
      {children}
    </div>
  );
}
```

In `ChatView.tsx`, wrap the composer's `<textarea …/>`:

```tsx
              <FlaggedText
                text={draft}
                spans={sidekick?.card && sidekick.card.prompt === draft ? [...sidekick.card.flags.map((f) => f.span), ...sidekick.card.issues.flatMap((i) => (i.span ? [i.span] : []))] : []}
              >
                <textarea … />
              </FlaggedText>
```

Add to the Sidekick CSS block: `.hh-sk-flagged textarea { background: transparent; position: relative; }` and give `.hh-sk-backdrop` the composer textarea's padding, font and line-height (copy them from the `.hh-composer textarea` rule).

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/ui test`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/ui
git -C <worktree> commit -m "feat(ui): underline Sidekick's flagged spans in the composer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 17: UI — Settings › Sidekick

**Files:**
- Create: `packages/ui/src/sidekick/SidekickTab.tsx`
- Modify: `packages/ui/src/SettingsSheet.tsx:14-16, 55-57, 149` (the tab)
- Modify: `packages/ui/src/HarnessApp.tsx` (`onSidekickSettings`)
- Modify: `packages/e2e/tests/settings.spec.ts:50` (the tab list)
- Test: `packages/ui/test/sidekick-tab.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/test/sidekick-tab.test.tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidekickTab } from "../src/sidekick/SidekickTab";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";
import { SK_ON } from "./sidekick-hook.test";

afterEach(cleanup);

describe("Settings › Sidekick (spec §8)", () => {
  it("shows on/off, pre-send with the longest wait, the tier, the cap and the week", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickState = SK_ON;
    await renderIn("en", <SidekickTab client={c} onModels={() => {}} />);
    expect(await screen.findByRole("checkbox", { name: "Sidekick" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Before you send" })).toBeTruthy();
    expect(screen.getByText("Longest wait")).toBeTruthy();
    expect(screen.getByText("Light")).toBeTruthy();
    expect(screen.getByText("Cap per task")).toBeTruthy();
    expect(screen.getByText("This week: 3,400 tokens")).toBeTruthy();
  });

  it("saves each change", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickState = SK_ON;
    await renderIn("en", <SidekickTab client={c} onModels={() => {}} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Sidekick" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["set", { on: false }]));
    fireEvent.click(screen.getByRole("button", { name: "10 s" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["set", { wait: 10 }]));
    fireEvent.click(screen.getByRole("button", { name: "No cap" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["set", { cap: "none" }]));
  });

  it("Change in Models opens the Models tab", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickState = SK_ON;
    const onModels = vi.fn();
    await renderIn("en", <SidekickTab client={c} onModels={onModels} />);
    fireEvent.click(await screen.findByRole("button", { name: "Change in Models" }));
    expect(onModels).toHaveBeenCalled();
  });
});
```

Add to `packages/ui/test/settings.test.tsx`, next to "adds a Models tab when the app sends its view" (it uses the file's `Sheet` helper and `ready`):

```tsx
  it("adds the Sidekick tab after Models only with state.sidekick (D0 without)", async () => {
    const client = new FakeClient(ready);
    client.state.models = {
      recommended: { questions: "standard", sidekick: "light" },
      defaults: { claude: { light: { model: "haiku", effort: "low", cap: 100_000 }, standard: { model: "sonnet", effort: "medium", cap: 200_000 }, deep: { model: "opus", effort: "high", cap: 400_000 } } },
      offered: { claude: { models: [{ id: "haiku" }, { id: "sonnet" }, { id: "opus" }], efforts: ["low", "medium", "high", "xhigh", "max"] } },
    };
    const first = await renderIn("en", <Sheet client={client} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["General", "Engine", "Models", "Usage"]);
    first.unmount();
    client.state.sidekick = { id: "sidekick", name: "Sidekick" };
    client.sidekickState = { info: { id: "sidekick", name: "Sidekick" }, settings: { on: false, preSend: true, wait: 6, cap: 20_000, introSeen: false }, status: "off", spent: 0, cap: 20_000, tier: "light", card: null, week: 0 };
    await renderIn("en", <Sheet client={client} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["General", "Engine", "Models", "Sidekick", "Usage"]);
    fireEvent.click(screen.getByRole("tab", { name: "Sidekick" }));
    expect(await screen.findByRole("checkbox", { name: "Sidekick" })).toBeTruthy();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/ui test -- sidekick-tab settings`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// packages/ui/src/sidekick/SidekickTab.tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Segmented } from "../chrome";
import type { HarnessClient, SidekickSettings, SidekickSettingsPatch } from "../client";
import { shownLanguage } from "../language";
import { useSidekick } from "./useSidekick";

/** Settings › Sidekick (spec §8, mockup board 6), slice 1: no learned section yet. */
export function SidekickTab({ client, onModels }: { client: HarnessClient; onModels: () => void }) {
  const { t, i18n } = useTranslation();
  const state = useSidekick(client, true);
  const [failed, setFailed] = useState<string | null>(null);
  if (!state) return null;
  const s = state.settings;
  const save = (patch: SidekickSettingsPatch) => {
    setFailed(null);
    void client.sidekick.set(patch).then((r) => !r.ok && setFailed(r.message), (err: unknown) => setFailed(String(err)));
  };
  const waits: { value: string; label: string }[] = [
    { value: "6", label: t("sidekick.settings.wait6") },
    { value: "10", label: t("sidekick.settings.wait10") },
    { value: "always", label: t("sidekick.settings.waitAlways") },
  ];
  const caps: { value: string; label: string }[] = [
    { value: "20000", label: t("sidekick.settings.cap20") },
    { value: "50000", label: t("sidekick.settings.cap50") },
    { value: "none", label: t("sidekick.settings.capNone") },
  ];
  const parseWait = (v: string): SidekickSettings["wait"] => (v === "always" ? "always" : (Number(v) as 6 | 10));
  const parseCap = (v: string): SidekickSettings["cap"] => (v === "none" ? "none" : (Number(v) as 20_000 | 50_000));
  return (
    <div className="hh-tab">
      <label className="hh-row">
        <input type="checkbox" checked={s.on} onChange={(e) => save({ on: e.target.checked })} />
        <span>{t("sidekick.settings.on")}</span>
      </label>
      <p className="hh-caption">{t("sidekick.settings.onHint")}</p>
      <fieldset disabled={!s.on}>
        <label className="hh-row">
          <input type="checkbox" checked={s.preSend} onChange={(e) => save({ preSend: e.target.checked })} />
          <span>{t("sidekick.settings.preSend")}</span>
        </label>
        <p className="hh-caption">{t("sidekick.settings.preSendHint")}</p>
        <p>{t("sidekick.settings.wait")}</p>
        <Segmented label={t("sidekick.settings.wait")} options={waits} value={String(s.wait)} onChange={(v) => save({ wait: parseWait(v) })} />
        <p>{t("sidekick.settings.tier")}</p>
        <p>
          <span>{t(`sidekick.tiers.${state.tier}`, { defaultValue: state.tier })}</span>{" "}
          <button type="button" className="hh-link" onClick={onModels}>{t("sidekick.settings.changeTier")}</button>
        </p>
        <p>{t("sidekick.settings.cap")}</p>
        <Segmented label={t("sidekick.settings.cap")} options={caps} value={String(s.cap)} onChange={(v) => save({ cap: parseCap(v) })} />
      </fieldset>
      <p className="hh-caption">{t("sidekick.settings.week", { tokens: state.week.toLocaleString(shownLanguage(i18n)) })}</p>
      {failed && <p role="alert">{t("sidekick.settings.failed", { message: failed })}</p>}
    </div>
  );
}
```

In `SettingsSheet.tsx`:

```tsx
export type SettingsTab = "general" | "harness" | "engine" | "models" | "sidekick" | "usage";
/** `harness` is the harness's own tab, right after General (harness-settings spec §4); Sidekick after Models (sidekick spec §8). */
const TABS: SettingsTab[] = ["general", "harness", "engine", "models", "sidekick", "usage"];
```

the filter gains `&& (id !== "sidekick" || state.sidekick !== undefined)`, the label line becomes:

```tsx
                {id === "harness" ? (state.settings?.tab ?? t("settings.tabs.setup")) : id === "sidekick" ? t("sidekick.tab") : t(`settings.tabs.${id}`)}
```

and the panel switch renders `<SidekickTab client={client} onModels={() => onTab("models")} />` for `tab === "sidekick"` (next to where `ModelsTab` is rendered).

In `HarnessApp.tsx`: `onSidekickSettings={() => setSettings("sidekick")}` on `ChatView`. In `ChatView`, the panel foot's tier text becomes a button calling `onSidekickSettings` when given (add `onTier?: () => void` to `SidekickPanelProps` and render the tier as `<button className="hh-link">` when present).

In `packages/e2e/tests/settings.spec.ts:50` the expected tabs become `["General", "How I learn", "Engine", "Models", "Sidekick", "Usage"]`.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/ui test`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/ui packages/e2e/tests/settings.spec.ts
git -C <worktree> commit -m "feat(ui): Settings › Sidekick

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 18: UI — the Sidekick row in Models and its line in Usage

**Files:**
- Modify: `packages/ui/src/ModelsTab.tsx:59-68, 119-131`
- Modify: `packages/ui/src/UsageTab.tsx:38-39`
- Test: `packages/ui/test/models-tab.test.tsx`, `packages/ui/test/usage-tab.test.tsx` (append)

- [ ] **Step 1: Write the failing tests**

```tsx
// append to packages/ui/test/models-tab.test.tsx
import { taskRows } from "../src/ModelsTab";

describe("Sidekick row (sidekick spec §5)", () => {
  it("comes last, only when given", () => {
    const state = { actions: { a: { label: "A" } }, path: [] } as never;
    const q = { key: "questions", label: "Questions" };
    expect(taskRows(state, q).map((r) => r.key)).toEqual(["a", "questions"]);
    expect(taskRows(state, q, undefined, { key: "sidekick", label: "Sidekick" }).map((r) => r.key)).toEqual(["a", "questions", "sidekick"]);
  });
});
```

```tsx
// append to packages/ui/test/usage-tab.test.tsx (it has the `Sheet` and `claude()` helpers)
describe("Sidekick's line (sidekick spec §8)", () => {
  it("shows Sidekick's tokens once it has run, and nothing without (D0)", async () => {
    const client = claude();
    client.usage = { limits: [], estimates: {}, tokens: {}, primary: "five_hour", sidekick: 2440 };
    const first = await renderIn("en", <Sheet client={client} />);
    expect(await screen.findByText("Sidekick: about 2,440 tokens")).toBeTruthy();
    first.unmount();
    client.usage = { limits: [], estimates: {}, tokens: {}, primary: "five_hour" };
    await renderIn("en", <Sheet client={client} />);
    await screen.findByRole("tab", { name: "Usage" });
    expect(screen.queryByText(/^Sidekick: about/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/ui test -- models-tab usage`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
export function taskRows(state: AppState, questions: TaskRowInfo, material?: Record<string, string>, sidekick?: TaskRowInfo): TaskRowInfo[] {
  …
  return [
    ...ids.map((id) => ({ key: id, label: state.actions[id].label, description: state.actions[id].description })),
    questions,
    ...stages.map((key) => ({ key, label: material?.[key] ?? key })),
    ...(sidekick ? [sidekick] : []),
  ];
}
```

At the call site, the fourth argument:

```tsx
    state.sidekick ? { key: "sidekick", label: t("sidekick.models.label"), description: t("sidekick.models.hint") } : undefined,
```

In `UsageTab.tsx`, after the material caption:

```tsx
      {/* Sidekick spec §8: its own spend, apart from the tasks' (only once it has run). */}
      {usage?.sidekick !== undefined && <p className="hh-caption">{t("sidekick.usage", { tokens: usage.sidekick.toLocaleString(shownLanguage(i18n)) })}</p>}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/ui test`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/ui
git -C <worktree> commit -m "feat(ui): Sidekick row in Models and its line in Usage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---
### Task 19: CLI — `humanharness check` warns about long tips

**Files:**
- Modify: `packages/cli/src/check.ts` (`RuleId` gains `"sidekick-tips"`; `sidekickFindings`; one `findings.push` line next to `settingsFindings`)
- Test: `packages/cli/test/check.test.ts` (append)

The schema already refuses unknown action ids in `sidekick.actions` and unknown `checks` keys (Task 2); the CLI reports them as `schema` errors like any other manifest error. This task adds only the budget warning (spec §3 "`tips` must stay within budget").

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/cli/test/check.test.ts
describe("check: sidekick (sidekick spec §3)", () => {
  const AFTER = '  questions: { tier: "light" },';
  const withSidekick = (block: string) => (d: string) => replaceIn(d, "harness.config.ts", AFTER, `${AFTER}\n  sidekick: ${block},`);
  const rules = (r: CheckResult) => r.findings.filter((f) => f.rule === "sidekick-tips" || f.message.startsWith("sidekick.")).map((f) => `${f.severity}:${f.rule}`);

  it("short tips and known actions: no finding", async () => {
    const r = await checkHarness(await fixture(withSidekick('{ default: "off", tips: "Claims need a source." }')));
    expect(errors(r)).toEqual([]);
    expect(rules(r)).toEqual([]);
  });

  it("an unknown action is a schema error", async () => {
    const r = await checkHarness(await fixture(withSidekick('{ actions: { nope: "auto" } }')));
    expect(rules(r)).toEqual(["error:schema"]);
  });

  it("sidekick-tips: warns over 300 tokens, per purpose too", async () => {
    const long = JSON.stringify("Every claim needs a source from the reading list, cited in APA style with page numbers. ".repeat(20).trim());
    for (const tips of [long, `{ "prompt-coach": ${long} }`]) {
      const r = await checkHarness(await fixture(withSidekick(`{ tips: ${tips} }`)));
      const found = r.findings.filter((f) => f.rule === "sidekick-tips");
      expect(found.map((f) => f.severity)).toEqual(["warning"]);
      expect(found[0].message).toMatch(/^Sidekick's tips take about \d+ tokens \(more than 300\)/);
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm --filter @humanharness/cli test -- check`
Expected: FAIL — no `sidekick-tips` finding.

- [ ] **Step 3: Implement**

```ts
  | "sidekick-tips";
```

```ts
/** Sidekick's tips (sidekick spec §3): each text within SIDEKICK_TIPS_TOKENS_WARN tokens of its brief. */
function sidekickFindings(h: LoadedHarness): Finding[] {
  const tips = h.sidekick?.tips;
  if (tips === undefined) return [];
  const texts = typeof tips === "string" ? [["", tips] as const] : Object.entries(tips).map(([purpose, text]) => [` (${purpose})`, text ?? ""] as const);
  return texts.flatMap(([which, text]) => {
    const tokens = estimateTokens(text);
    if (tokens <= SIDEKICK_TIPS_TOKENS_WARN) return [];
    return [warning("sidekick-tips", `Sidekick's tips take about ${tokens} tokens (more than ${SIDEKICK_TIPS_TOKENS_WARN})${which}: keep them to the few hints that matter in every review.`, MANIFEST)];
  });
}
```

(import `SIDEKICK_TIPS_TOKENS_WARN` with the other harness-sdk names; `findings.push(...sidekickFindings(harness));` right after `settingsFindings`.)

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/cli test`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
corepack pnpm typecheck
git -C <worktree> add packages/cli
git -C <worktree> commit -m "feat(cli): check warns about long Sidekick tips

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 20: Mock mode and the demo — Sidekick without a model

**Files:**
- Modify: `packages/fake-agent/src/mock-claude.ts` (`playTurn`'s first lines; new exported `mockSidekickReply`)
- Modify: `harnesses/demo/harness.config.ts` (`sidekick` block, default off)
- Test: `packages/fake-agent/test/mock.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/fake-agent/test/mock.test.ts
import { mockSidekickReply } from "../src/mock-claude";

describe("mock Sidekick (sidekick plan Decision 12)", () => {
  const prompt = (flags: string[], text: string) =>
    ["Sidekick: pre-send review", "", "App: Demo", flags.length ? "Local flags:" : "Local flags: none (the person asked for a review)", ...flags, "UI language: English", "", "<prompt>", text, "</prompt>", ""].join("\n");

  it("a flagged prompt gets a suggestion that keeps the prompt and adds what is missing", () => {
    const r = JSON.parse(mockSidekickReply(prompt(['- vague: "better" at [8, 14]'], "make it better")));
    expect(r.verdict).toBe("suggest");
    expect(r.issues[0].kind).toBe("vague");
    expect(r.rewrite.startsWith("make it better")).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("no flags: send", () => {
    expect(JSON.parse(mockSidekickReply(prompt([], "Rewrite paragraph 2"))).verdict).toBe("send");
  });

  it("two asks: the second one is queued", () => {
    const r = JSON.parse(mockSidekickReply(prompt(['- two-asks: "and also" at [9, 17]'], "Write it and also translate it")));
    expect(r.queued).toEqual(["translate it"]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm --filter @humanharness/fake-agent test -- mock`
Expected: FAIL — `mockSidekickReply` is not exported.

- [ ] **Step 3: Implement**

```ts
/** The first line of Sidekick's pre-send turns (shell `SIDEKICK_PRE_MARK`; a copy: fake-agent never imports the shell). */
const SIDEKICK_MARK = "Sidekick: pre-send review";

const HINTS: Record<string, string> = {
  vague: "Say exactly what should change and how you'll know it's done.",
  "missing-context": "Name the note or file you mean.",
  "two-asks": "One ask per prompt: the second one is kept for later.",
  "off-phase": "This looks like another phase's work.",
};

/** A canned Sidekick answer in mock mode, built from the flags the prompt lists: no model, no recordings. */
export function mockSidekickReply(prompt: string): string {
  const typed = /<prompt>\n([\s\S]*)\n<\/prompt>/.exec(prompt)?.[1] ?? "";
  const kinds = [...prompt.matchAll(/^- (vague|missing-context|two-asks|off-phase): "([^"]*)"/gm)].map((m) => ({ kind: m[1], match: m[2] }));
  if (kinds.length === 0) return JSON.stringify({ verdict: "send", issues: [], confidence: 0.9 });
  const two = kinds.find((k) => k.kind === "two-asks");
  const [first, ...rest] = two ? typed.split(two.match) : [typed];
  const keep = (two ? first : typed).trim();
  return JSON.stringify({
    verdict: "suggest",
    issues: kinds.map((k) => ({ kind: k.kind, text: HINTS[k.kind] })),
    rewrite: kinds.some((k) => k.kind !== "two-asks") ? `${keep} (mock: name the part and the result you want)` : keep,
    ...(two ? { queued: [rest.join(two.match).trim()] } : {}),
    confidence: 0.8,
  });
}
```

At the top of `playTurn`, before `loadRecordings`:

```ts
  // Sidekick's own turns never touch the recordings or the session state (sidekick plan Decision 12).
  if (prompt.startsWith(SIDEKICK_MARK)) {
    const text = mockSidekickReply(prompt);
    print({ type: "system", subtype: "init", session_id: sessionId, tools: [] });
    print({ type: "stream_event", parent_tool_use_id: null, session_id: sessionId, event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
    print({ type: "stream_event", parent_tool_use_id: null, session_id: sessionId, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });
    print({ type: "stream_event", parent_tool_use_id: null, session_id: sessionId, event: { type: "content_block_stop", index: 0 } });
    print({ type: "result", subtype: "success", is_error: false, result: text, session_id: sessionId, usage: { input_tokens: 400, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    return;
  }
```

In `harnesses/demo/harness.config.ts`, after `questions`:

```ts
  // Sidekick (sidekick spec §3): off by default until dogfooding sets the cap and thresholds (spec §12 Q1).
  sidekick: {
    default: "off",
    tips: "The person is learning how Human Harness works. A good prompt names the part (manifest, engines, a turn, blocks, context, history) and what they want to understand about it.",
  },
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/fake-agent test && corepack pnpm test`
Expected: PASS (the demo manifest still loads; the existing e2e-free suites are unchanged).

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/fake-agent harnesses/demo/harness.config.ts
git -C <worktree> commit -m "feat(fake-agent): mock Sidekick answers; demo gets a sidekick block

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 21: E2E — the pre-send review end to end

**Files:**
- Create: `packages/e2e/tests/sidekick.spec.ts`
- Modify: `packages/e2e/tests/scripts.ts` (a `sidekickScript`)

- [ ] **Step 1: Write the scripts**

```ts
// append to packages/e2e/tests/scripts.ts
const sidekickReply = (o: unknown) => [...claudeTextLines(JSON.stringify(o)), result];

/** Claude where Sidekick's pre-send turn suggests a rewrite; every other turn answers "Listo." (sidekick spec §4.1). */
export const sidekickScript: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    {
      match: "^Sidekick: pre-send review",
      steps: sidekickReply({ verdict: "suggest", issues: [{ kind: "vague", text: "Say which part should be better." }], rewrite: "Explain how the manifest declares actions", confidence: 0.8 }),
    },
  ],
};

/** Sidekick's turn never answers in time: the prompt goes as typed after the wait. */
export const slowSidekickScript: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [{ match: "^Sidekick: pre-send review", steps: [{ sleep: 15_000 }] }],
};
```

- [ ] **Step 2: Write the specs**

```ts
// packages/e2e/tests/sidekick.spec.ts
import { expect, test } from "@playwright/test";
import { closeAndClean, launch, makeSandbox, readJsonl, usageFile } from "./helpers";
import { sidekickScript, slowSidekickScript } from "./scripts";

type Run = { argv: string[]; prompt: string };
const isSidekick = (r: Run) => r.prompt.startsWith("Sidekick: pre-send review");

async function start(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Start Demo" }).click();
  await page.getByRole("button", { name: "Sidekick is off. Turn it on" }).click();
  await expect(page.getByRole("button", { name: "Sidekick is on. Turn it off" })).toBeVisible();
  return page.getByRole("textbox").first();
}

test("D0: with Sidekick off a vague prompt goes straight out; no Sidekick turn, no line", async () => {
  const s = makeSandbox("sidekick-off");
  const { app, page } = await launch(s, { claude: sidekickScript });
  try {
    await page.getByRole("button", { name: "Start Demo" }).click();
    const box = page.getByRole("textbox").first();
    await box.fill("make it better");
    await box.press("Enter");
    await expect(page.getByRole("main").getByText("Listo.")).toBeVisible();
    expect(readJsonl<Run>(s.claudePrompts).filter(isSidekick)).toEqual([]);
    expect(readJsonl<{ phase?: string }>(usageFile(s)).filter((r) => r.phase === "sidekick")).toEqual([]);
  } finally {
    await closeAndClean(app, s);
  }
});

test("a vague prompt gets a card; Send suggested sends the rewrite; the turn is tagged in usage", async () => {
  const s = makeSandbox("sidekick-card");
  const { app, page } = await launch(s, { claude: sidekickScript });
  try {
    const box = await start(page);
    await box.fill("make it better");
    await box.press("Enter");
    const card = page.getByRole("region", { name: "Before you send" });
    await expect(card.getByText("Say which part should be better.")).toBeVisible();
    await card.getByRole("button", { name: "Send suggested" }).click();
    await expect(page.getByRole("main").getByText("Listo.")).toBeVisible();

    const runs = readJsonl<Run>(s.claudePrompts);
    const sk = runs.filter(isSidekick);
    expect(sk).toHaveLength(1);
    expect(sk[0].argv).toContain("--tools");
    expect(sk[0].argv[sk[0].argv.indexOf("--model") + 1]).toBe("haiku");
    expect(runs.filter((r) => !isSidekick(r)).map((r) => r.prompt)).toContainEqual(expect.stringContaining("Explain how the manifest declares actions"));
    await expect.poll(() => readJsonl<{ phase?: string; process?: string; moment?: string }>(usageFile(s)).filter((r) => r.phase === "sidekick")).toEqual([
      expect.objectContaining({ process: "sidekick", moment: "pre", sidekick: "sidekick" }),
    ]);
  } finally {
    await closeAndClean(app, s);
  }
});

test("⌘⏎ / Ctrl⏎ sends at once with no review", async () => {
  const s = makeSandbox("sidekick-now");
  const { app, page } = await launch(s, { claude: sidekickScript });
  try {
    const box = await start(page);
    await box.fill("make it better");
    await box.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
    await expect(page.getByRole("main").getByText("Listo.")).toBeVisible();
    expect(readJsonl<Run>(s.claudePrompts).filter(isSidekick)).toEqual([]);
  } finally {
    await closeAndClean(app, s);
  }
});

test("a review that takes too long: the countdown, then the prompt goes as typed and the panel says so", async () => {
  const s = makeSandbox("sidekick-timeout");
  const { app, page } = await launch(s, { claude: slowSidekickScript });
  try {
    const box = await start(page);
    await box.fill("make it better");
    await box.press("Enter");
    await expect(page.getByRole("button", { name: "Reviewing…" })).toBeVisible();
    await expect(page.getByText(/Sends anyway in \d+ s/)).toBeVisible();
    await expect(page.getByRole("main").getByText("Listo.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Sidekick took too long. Your prompt went as typed.")).toBeVisible();
    const sent = readJsonl<Run>(s.claudePrompts).filter((r) => !isSidekick(r));
    expect(sent.map((r) => r.prompt)).toContainEqual(expect.stringContaining("make it better"));
  } finally {
    await closeAndClean(app, s);
  }
});
```

(How a free question's first prompt is wrapped differs by task type; `stringContaining` keeps the assertion about the typed text only. `--model haiku` is the Claude light tier default in `DEFAULT_TIERS`.)

- [ ] **Step 3: Build and run the e2e suite**

Run: `corepack pnpm app:build && corepack pnpm e2e`
Expected: PASS — the four new tests and every existing one (the settings tab list was updated in Task 17; Sidekick is off by default in the demo, so no other flow sees a review).

- [ ] **Step 4: Commit**

```bash
git -C <worktree> add packages/e2e
git -C <worktree> commit -m "test(e2e): Sidekick pre-send review, send now and timeout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 22: Docs — the architecture page and the spec's status

**Files:**
- Create: `docs/architecture/sidekick.md`
- Modify: `docs/superpowers/specs/2026-10-25-sidekick-design.md` (status line only)

- [ ] **Step 1: Write `docs/architecture/sidekick.md`**

Sections, in English, matching the other architecture pages' tone:
1. **What it is** — the prompt coach, core (D1), off by default without a manifest block.
2. **The flow** — Enter → `client.sidekick.review` → `localCheck` (`packages/workspace/src/sidekick-checks.ts`) → decision (mode, cap, settings) → `SidekickSession.ask` within the wait → `parseReview` → card or send as typed. ⌘⏎ cancels; ⌥⏎/Review forces.
3. **The session** — `packages/runtime/src/sidekick.ts`; no tools (`noTools`, `--tools ""` + every built-in denied, empty strict MCP config; ACP: no MCP servers, read-only mode); working folder `<userData>/sidekick/<hash of base>/sidekick/` with its own `AGENTS.md` (`sidekickBrief`), and why it is outside the base (Decision 1 and the spike's A2 result); one session per task, adoption of a review made before the task existed.
4. **Settings** — the reserved `sidekick` collection in its own store, the `storeFor` hook, `Data: sidekick` commits; why it is not in `dataCollections`.
5. **Usage** — `phase: "sidekick"`, `process`, `moment`, `sidekick`; out of task estimates; the cap counts input + output + cache writes.
6. **D0** — the list from this plan's header and where each is tested.
7. **Part 2** — what comes next (link to the part 2 plan).

- [ ] **Step 2: Update the spec's status line**

Append to the status paragraph: `Slice 1 implemented (plan docs/superpowers/plans/2026-10-27-sidekick-part1.md).`

- [ ] **Step 3: Run everything once more**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build && corepack pnpm e2e`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git -C <worktree> add docs/architecture/sidekick.md docs/superpowers/specs/2026-10-25-sidekick-design.md
git -C <worktree> commit -m "docs: Sidekick architecture page; spec slice 1 done

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Self-review against the spec

| Spec | Where |
|---|---|
| §3 manifest `default`, `tips` (string or per purpose), `actions`, `checks`; without `sidekick`: off, no tips | Task 2 |
| §3 check: actions exist, tips budget, known `checks` keys | Task 2 (schema), Task 19 |
| §4.1.1 local check, 4 kinds, spans, muted dropped, < 50 ms | Task 4 |
| §4.1.2 decision (no flags + auto + no Review → send; off; Sidekick off; past cap) | Task 11 |
| §4.1.3 model review, JSON contract, zod, invalid → as typed + quiet line | Tasks 7, 11, 14 |
| §4.1.4 card: issues, rewrite with additions marked, queued, Send suggested · Edit · Send anyway; `send`/below threshold → nothing | Tasks 11, 14, 15 |
| §4.1.4 "why shown" and "Don't flag …" | Part 2 (needs events and muting) |
| §4.1.5 timeout, countdown, late review dropped | Tasks 11, 15, 21 |
| §5 own session per task, second transport, no tools, no MCP, own folder with AGENTS.md, brief rules, tier `sidekick` light fixed per session, serial, errors never block | Tasks 1, 5, 6, 11, 12 (folder location: Decision 1) |
| §5 per-turn context: harness goal, phase and goal, notes titles, data titles, moment input; never history | Tasks 7, 12 |
| §6 learning | Part 2 |
| §7 top-bar toggle with dot, 330 px panel, head states, Sidekick \| Harness switch, 52 px rail lit when a card waits, cards of the current task, composer Reviewing… + countdown + ⌘⏎, underlined spans, Review / ⌥⏎, foot, off-state intro, accessibility | Tasks 14, 15, 16 |
| §7 past cards collapsed "Earlier · used" | Part 2 (with outcomes) |
| §8 Settings › Sidekick: on/off, pre-send with longest wait, tier link, cap 20k/50k/none, week's spend | Task 17 |
| §8 "N of M suggestions used", "What Sidekick learned", the other two moments | Part 2 |
| §8 usage tagging, split from task spend | Tasks 8, 18 |
| §10 slice 1 "The `sidekick` collection for settings" | Tasks 3, 9, 12 |
| §11 language rules in the brief | Task 5 |

Placeholder scan: none of "TBD", "TODO", "similar to Task N". Type names used across tasks: `SidekickFlag`/`SidekickFlagView` (workspace / client), `SidekickState`, `SidekickReview`, `SidekickCard`, `SidekickSettings` (client; the SDK's `SidekickSettings` has the same shape and is what `SidekickStore` returns), `SidekickController.review/cancel/resolve/state/set/betweenTasks/close`, `client.sidekick.get/set/review/cancelReview/resolve/onChange`.

## Open questions (each with the default this plan uses)

1. **Default wait vs. real latency.** If the spike measures resumed Haiku turns above ~4 s at p90, 6 s will often run out. *Default:* keep 6 s (the spec's), report p50/p90 in the spike, and revisit with dogfooding numbers.
2. **Working folder outside the base** (Decision 1). The spec says `<base>/.harness/sidekick/<id>/`. *Default:* `<userData>/sidekick/<hash>/<id>/`, because both CLIs would otherwise load the task's `CLAUDE.md`/`AGENTS.md`. Marco to confirm; the spec's §5 could be amended.
3. **What counts toward the cap.** *Default:* input + output + cache writes (cache reads left out). Alternative: all four counts, which makes the 20k cap bind after a handful of reviews on Codex (≈15k prefix).
4. **Off-phase without phase keywords.** *Default:* other phases' label words. Alternative: add an optional `keywords` field to phases (a task-phases change, out of scope here).
5. **"Always wait".** *Default:* up to 60 s, then as typed.
6. **Reviews before a task exists** (a new question or action typed in the composer). *Default:* reviewed (they are the prompts that matter most), with a session the task adopts; their tokens count in the week but not toward that task's cap.
7. **Block answers and choice follow-ups.** *Default:* never reviewed in part 1; input-block free text comes in part 2.
8. **Usage field naming** (Decision 2): `phase: "sidekick"` + `moment` instead of the spec's `phase: "pre"|"after"|"learn"`. *Default:* as in this plan, so existing `phase` readers keep working.
9. **Rail for every harness while off.** The spec names it (off state, grey mark). *Default:* shown in every harness when main sends `state.sidekick`; hidden in slim (interview) mode and under 720 px.
