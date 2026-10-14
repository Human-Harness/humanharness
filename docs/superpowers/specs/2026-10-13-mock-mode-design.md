# Plan 3e — Mock mode

Date: 2026-10-13. Status: approved design.

## Why

Usability tests of a harness today cost tokens: every pass through the app runs the real engine. A developer wants to walk through the whole app (onboarding, Home, a task with its blocks and choices, notes, history, the usage and context meters) without an AI, and the same recordings should drive the automated end-to-end tests.

## 1. Starting it

`humanharness dev --mock` starts the app with a fake engine instead of the real one. The fake is `packages/fake-agent`'s `fake-claude`, fed with the harness's recordings in `<harness>/mock/`. No engine CLI runs and no tokens are spent; everything else is the real app: the runtime, the `ui` MCP server and its blocks, notes, history, usage and the context meter.

- **Fresh each launch.** Each start uses a new temporary data folder and work folder, so every test session begins at the first launch. `--keep` reuses the previous mock session's folders (kept under the OS temp dir, path printed at start).
- **Visible.** The window shows a "Test mode (no AI)" badge (`mock.badge` in i18n, es/en), so a tester never mistakes it for the real thing.
- **Dev only.** The shell reads the mock settings through `readTestHooks` (`packages/shell/src/main/test-hooks.ts`), which packaged builds ignore. `mock/` is never copied into a built app.
- **Engine status.** As with the existing test hooks, the fake engine reports installed and signed in; the legal notice stays real, so onboarding looks as it does for a person.

`dev --mock` passes `HH_MOCK_DIR` (the harness's `mock/` folder) to the shell; the shell turns it into a test-engine entry for `claude` whose command is `fake-claude` and whose env holds only `HH_FAKE_*` variables, the same path the e2e tests use today.

## 2. The recording format

One file per action, `mock/<action>.json`, readable and meant to be edited by hand:

```json
{
  "version": 1,
  "action": "plan-week",
  "recordedWith": "claude",
  "fallback": { "text": "This answer isn't recorded in this test." },
  "turns": [
    {
      "id": "t1",
      "text": "Here is a first draft…",
      "blocks": [{ "name": "choices", "input": { "…": "…" } }],
      "writes": [{ "path": "plan.md", "content": "…" }],
      "usage": { "input": 1200, "output": 300, "cacheRead": 0, "cacheWrite": 0 },
      "delayMs": 800,
      "next": { "opt-a": "t2", "opt-b": "t3", "*": "t2" }
    },
    { "id": "close", "text": "Saved.", "note": { "title": "…", "body": "…" } }
  ]
}
```

- **Turns.** The first turn answers the task's first prompt. `text` is streamed in chunks over `delayMs` (default 600 ms). `blocks` are emitted as `ui` MCP tool calls, `note` as `save_note`, `writes` as file writes in the work folder (a `"content": null` deletes the file). `usage` feeds the usage and context meters.
- **Branches.** `next` maps the person's reply to the next turn: a choice id, or `*` for free text and anything else. A turn with no `next` ends the script.
- **Off script.** When the reply matches nothing in `next` (or the script has ended), the fake plays `fallback` and offers again the last turn's `choices` block, so the tester can get back on the recorded path. Without `fallback`, a default text in the harness's language is used.
- **Closing.** The closing turn (the app's close, which asks for the note) plays the turn with id `close`; when there is none, the fake saves a default note titled after the action.
- **Position.** `fake-claude` runs once per engine turn (resumed by session id), so it keeps the current turn id per session in a small state file under the mock session's temp folder.
- **Any engine.** A recording made with Codex replays through `fake-claude` too: the format holds only engine-agnostic content (text, blocks, notes, writes, usage). `recordedWith` is informational.

The schema lives in `packages/fake-agent` (zod), shared by the fake, `run --record` and `check`.

## 3. Recording and checking

**`humanharness run <action> --record`** runs the task with the real engine, as `run` does today, and at the end writes `mock/<action>.json` (asking before overwriting an existing file). Per turn it saves the text, the blocks, the note, the usage, and the files the AI changed, taken from the turn's history changes: up to 64 KB per file, binary files skipped (and listed in the output). The person's replies become the `next` keys along the path that was walked; the other branches are added by hand.

**`humanharness check`** also validates every file in `mock/`:

- `mock-schema`: the file matches the schema;
- `mock-action`: the action exists in the manifest;
- `mock-next`: every `next` target is a turn id in the file;
- `mock-choice`: every `next` key except `*` is a choice id offered by that turn's `choices` block.

These are errors; a harness without `mock/` gets no warning.

## 4. Tests

- Unit: the schema; the fake's tree walk (branch, `*`, fallback, close, missing close, state across processes); `--record` output from a scripted run; each `check` rule.
- E2E: the demo ships `harnesses/demo/mock/*.json` for its actions. `packages/e2e` gets a `launchMock(action)` helper, and one test walks a demo task end to end through a recording, including one off-script reply. The hand-written scripts in `packages/e2e/tests/scripts.ts` stay for the edge cases a recording can't express (crashes, resume failures, model fallback).

## 5. What is out

- Replaying the Codex (ACP) transport. Recordings always replay as Claude's stream-json.
- Mock mode in packaged apps, for anyone but the developer.
- Recording from the desktop app; recording is `run --record` only.
- Simulating errors from a recording (rate limits, crashes): those stay in the e2e scripts.

## Compliance

Mock mode runs no engine CLI and reads no engine files. The fake's env carries only `HH_FAKE_*` variables. Recordings hold what the developer typed and what the AI answered; they live in the harness's repository, and `--record` prints that the file should be reviewed before committing it.

## Docs

Add `docs/architecture/mock-mode.md` (format, `dev --mock`, `--record`, `check` rules) and a line in `docs/architecture/authoring.md`. In the roadmap, add row 3e.
