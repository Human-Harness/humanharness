# Plan 3e — Mock mode

Date: 2026-10-13. Status: approved design.

## Why

Usability tests of a harness today cost tokens: every pass through the app runs the real engine. A developer wants to walk through the whole app (onboarding, Home, a task with its blocks and choices, notes, history, the usage and context meters) without an AI, and the same recordings should drive the automated end-to-end tests.

## 1. Starting it

`humanharness dev --mock` starts the app with a fake engine instead of the real one. The fake is `packages/fake-agent`'s `fake-claude`, fed with the harness's recordings in `<harness>/mock/`. No engine CLI runs and no tokens are spent; everything else is the real app: the runtime, the `ui` MCP server and its blocks, notes, history, usage and the context meter.

- **Fresh each launch.** Each start uses a new temporary data folder and work folder, so every test session begins at the first launch. `--keep` reuses the previous mock session's folders (kept under the OS temp dir, path printed at start).
- **Visible.** The window shows a "Test mode (no AI)" badge (`mock.badge` in i18n, es/en), so a tester never mistakes it for the real thing.
- **Dev only.** The shell reads the mock settings through `readTestHooks` (`packages/shell/src/main/test-hooks.ts`), which packaged builds ignore. `mock/` is never copied into a built app.
- **Only the fake engine.** In mock mode the app offers only the engines that have a fake (Claude), so no status check reaches a real CLI. The suggested folder is inside the mock session's temp folder; synced places are still offered as they are on the computer.
- **Engine status.** As with the existing test hooks, the fake engine reports installed and signed in; the legal notice stays real, so onboarding looks as it does for a person.

`dev --mock` passes `HH_MOCK_DIR` (the harness's `mock/` folder) to the shell; the shell turns it into a test-engine entry for `claude` whose command is `fake-claude` and whose env holds only `HH_FAKE_*` variables, the same path the e2e tests use today.

## 2. The recording format

One file per action, `mock/<action>.json`, readable and meant to be edited by hand:

```json
{
  "version": 1,
  "action": "manifest",
  "match": "# Topic: the manifest",
  "recordedWith": "claude",
  "fallback": { "text": "Esta respuesta no está grabada en esta prueba." },
  "turns": [
    {
      "id": "t1",
      "text": "El manifiesto declara todo el harness.",
      "blocks": [
        { "tool": "show_choices", "input": { "options": [{ "label": "Profundizar", "followUp": "Contame más." }, { "label": "Seguir →", "next": true }] } }
      ],
      "writes": [{ "path": "plan.md", "content": "…" }],
      "usage": { "input": 1200, "output": 300, "cacheRead": 0, "cacheWrite": 0 },
      "delayMs": 800,
      "next": { "Profundizar": "t2", "*": "t2" }
    },
    { "id": "t2", "text": "…" },
    { "id": "close", "note": { "title": "El manifiesto", "summary": ["…"], "decisions": [], "files": [], "open": [] } }
  ]
}
```

- **Which recording.** A task's first message is its action's brief, so a new engine session picks the recording whose `match` (plain text) appears in that message. `--record` fills it with the first line of the brief. A session no recording matches (a free question, for example) gets the fallback.
- **Turns.** The first turn whose id isn't `close` answers the first message. `text` is streamed in chunks over `delayMs` (default 600 ms). `blocks` are MCP tool calls on the app's `ui` server, named by their tool (`show_choices`, `show_<block>`); `note` is a `save_note` call; `writes` are file writes in the work folder (`"content": null` deletes the file; paths are relative and stay inside the folder). `usage` feeds the usage and context meters.
- **Branches.** `next` maps the person's reply to the next turn: the label of a choice the turn offered (clicking it sends its `followUp`, or its label when it has none), or `*` for free text and anything else. A turn with no `next` ends the script.
- **Off script.** When the reply matches nothing in `next`, the fake plays `fallback` and offers again the turn's `show_choices` block, so the tester can get back on the recorded path. Without `fallback`, a fixed two-language text is used ("Respuesta no grabada en esta prueba · Not recorded in this test").
- **Closing and checkpoints.** The app's closing turn plays the turn with id `close`; when there is none, the fake saves a default note titled after the action. A checkpoint turn saves the same note and changes nothing else.
- **Position.** `fake-claude` runs once per engine turn (resumed by session id), so it keeps each session's action and current turn in a small state file under the mock session's temp folder.
- **Any engine.** A recording made with Codex replays through `fake-claude` too: the format holds only engine-agnostic content (text, blocks, notes, writes, usage). `recordedWith` is informational.

The schema lives in `packages/fake-agent` (zod), shared by the fake, `run --record` and `check`.

## 3. Recording and checking

**`humanharness run <action> --record`** runs the task with the real engine, as `run` does today, and at the end writes `mock/<action>.json`. It refuses to start when that file exists, unless `--force` is given. Per turn it saves the text, the blocks (with their tool names), the usage, and the files the AI changed, found by comparing the work folder before and after the turn (`.harness/` left out): up to 64 KB per text file, binary and larger files skipped and listed in the output. The closing turn saves the task's note. The person's replies become the `next` keys along the path that was walked (the picked choice's label, `*` for typed text); the other branches are added by hand. When a choice leads into another action, that action is recorded too, into its own file when none exists yet.

**`humanharness check`** also validates every file in `mock/`:

- `mock-schema`: the file is JSON and matches the schema;
- `mock-action`: the action exists in the manifest and the file is named after it;
- `mock-match`: `match` appears in the action's brief;
- `mock-next`: turn ids are unique and every `next` target is one of them;
- `mock-choice`: every `next` key except `*` is the label of a choice that turn's `show_choices` block offers.

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
