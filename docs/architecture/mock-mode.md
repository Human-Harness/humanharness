# Mock mode

## What it is

`humanharness dev --mock [--keep]` opens the app with a fake engine that replays the harness's recordings from `<harness>/mock/`. No engine CLI runs and no tokens are spent. Everything else is the real app: the runtime, the `ui` MCP server and its blocks, notes, history, usage and the context meter.

It is for the developer only. The window shows a "Test mode (no AI)" badge (`mock.badge` in i18n, drawn in the top bar by `packages/ui/src/chrome.tsx`), so a tester never mistakes it for the real thing. Packaged apps ignore it and `mock/` is never copied into a built app.

## How it starts

`dev --mock` (`packages/cli/src/dev.ts`, `mock-session.ts`) checks the harness first, then sets this env for the shell:

- `HH_TEST_MOCK=1`, `HH_TEST_MINUTE_MS=1000` (a time-box minute is a second), `HH_TEST_USER_DATA`, `HH_TEST_SHARED_DIR` and `HH_TEST_SUGGESTED_FOLDER`.
- `HH_TEST_ENGINES`, one entry for `claude`: the command is `fake-claude` and its env holds only `HH_FAKE_MOCK_DIR` (the `mock/` folder) and `HH_FAKE_MOCK_STATE` (a file, see below).

The shell reads them through `readTestHooks` (`packages/shell/src/main/test-hooks.ts`), the same path the end-to-end tests use. A packaged app returns no hooks. Engine envs keep only `HH_FAKE_*` variables.

- **Folders.** Everything lives under `<tmp>/hh-mock-<harness id>/`: `userData`, `shared`, the suggested work folder and `mock-state.json`. Each start deletes that root first, so the app opens at the first launch. `--keep` reuses it. The path is printed at start.
- **Inherited env.** `dev` removes every `HH_TEST_*` and `HH_DEV_ENGINE` variable it inherited, so a stray setting never leaks into the app.
- **Flags.** `--keep` needs `--mock`. `--engine` with `--mock` must be `claude`: mock mode replays as Claude, so it also needs a harness that offers Claude. Without recordings in `mock/`, `dev --mock` stops and says how to record one. Files that fail the schema are named in the output and skipped.
- **Only faked engines.** `offeredEngines` keeps the engines that have a fake, so no status check reaches a real CLI. Setup steps (install, update, login, logout) and the engine test do nothing for a faked engine and report success (`fakeSetupResult`). The fake reports installed, signed in and verified, and its legal notice counts as accepted (`hasNotice` in `packages/shell/src/main/index.ts`): there is no provider to disclose and nothing leaves the computer. Plain e2e runs with fake engines, outside mock mode, keep the real notice.

## What the tester sees

Plan 3f (spec `2026-10-14-setup-flow-design.md` §4) shows the faked engine as what it is, so a tester never sees Claude where no AI runs:

- **Home.** On the first launch, "Set up <name>" and a card with the two missing steps. The setup flow walks the folder, then the engine, then "All set".
- **The test engine.** One tile, "Simulated AI (mock)", with a generic screen icon instead of a logo. Its id stays `claude`, so config, models and the runtime don't change. The main process sends it with provider Human Harness, no requirements, no install command, `reportsLimits: false` and `mock: true` (`appState` in `packages/shell/src/main/index.ts`). Above the tiles, the setup step says there is only one engine in test mode.
- **Its details.** Engine (and the setup step) show "Test model", answers recorded in the harness's `mock/`, data that stays on this computer and a plan that is not spent. There is no sign out, plan, version or legal line. The usage line on the work screen and Settings › Usage say "Test mode: uses none of your plan." instead of "doesn't report the limits" (the last reply's tokens still show).
- **No notice.** The engine is ready at once: there is no notice to accept, nothing to install and no sign-in.
- **The test model.** `ModelsView` offers one model, `{ id: "mock", name: "Test model" }`, and every tier defaults to it (effort and cap as they are). Settings › Models shows "Test model" for each level. `fake-claude` ignores `--model`.

## The format

One file per action, `mock/<action>.json`, meant to be edited by hand. The schema is in `packages/fake-agent/src/mock.ts` (zod, strict: unknown keys are errors). The fake, `run --record` and `check` all use it.

```json
{
  "version": 1,
  "action": "manifest",
  "match": "# Topic: the manifest",
  "recordedWith": "claude",
  "fallback": { "text": "This answer is not recorded in this test." },
  "turns": [
    {
      "id": "t1",
      "text": "The manifest declares the whole harness.",
      "blocks": [
        { "tool": "show_choices", "input": { "options": [{ "label": "Go deeper", "followUp": "Tell me more." }, { "label": "Next →", "next": true }] } }
      ],
      "writes": [{ "path": "plan.md", "content": "…" }],
      "usage": { "input": 1200, "output": 300, "cacheRead": 0, "cacheWrite": 0 },
      "delayMs": 800,
      "next": { "Go deeper": "t2", "*": "t2" }
    },
    { "id": "t2", "text": "…" },
    { "id": "close", "note": { "title": "The manifest", "summary": ["…"], "decisions": [], "files": [], "open": [] } }
  ]
}
```

- `version`: always 1.
- `action`: the manifest action. The file is named `<action>.json`.
- `match`: plain text that the task's first message (its brief) contains. It must not be blank.
- `recordedWith`: informational. A recording made with Codex replays through `fake-claude` too.
- `fallback.text`: played when a reply is not recorded. Without it, a fixed English text is used.
- `turns`: at least one. Ids are unique.
- `id`: the turn's name. `close` is the closing turn.
- `text`: streamed in about eight chunks over `delayMs` (default 600 ms, up to 60 s).
- `blocks`: MCP calls on the app's `ui` server by tool name (`show_choices`, `show_<block>`). The app validates them as it does for a real engine.
- `note`: a `save_note` call (`title` required, the rest as the app's note fields).
- `writes`: file writes in the work folder. `content: null` deletes the file. Paths are relative, with no `..`. A written `.md` becomes a document card, as in a real turn (`docs/architecture/documents.md`); `packages/e2e/fixtures/reader-mock` records one.
- `usage`: feeds the usage and context meters (400 in, 20 out when missing).
- `next`: reply to next turn id. A key is the label of a choice the turn offers, or `*` for anything else. A turn with no `next` ends the script.
- `respond`: recorded answers to an input block the turn shows, each `{ "block", "value", "next" }`. An answer whose JSON equals `value` (key order aside) plays `next`; any other answer follows the turn's `next["*"]`, then the fallback.
- `setPhase`: a phase id. This turn is the recorded answer to the app's move into that part (its phase change turn, `docs/architecture/phases.md`), never a first message or a reply.
- `timeUp: true`: this turn is the recorded answer to the time box's wrap-up.

The agent's own request to move stays a recorded `set_phase` call in `blocks` (`{ "tool": "set_phase", "input": { "to": "main", "reason": "…" } }`).

## How replay walks it

`fake-claude` runs once per engine turn, so `HH_FAKE_MOCK_STATE` is a JSON file holding each session's action and current turn. It is written atomically (temp file, then rename) and only after a turn succeeded: a failed or cancelled turn does not advance the session. A lost state file is treated as a first message. The code is in `mock-replay.ts` (the walk) and `mock-claude.ts` (the output), both in `packages/fake-agent/src`.

- **First message.** A new engine session picks the recording whose `match` appears in the prompt; the longest `match` wins. The first turn that is not `close` plays. No match: the default fallback, and the session has no action.
- **A reply.** The prompt is turned into a choice label: the option whose `followUp` (or its `label`, when it has none) equals the reply. Then `next[label]`, else `next["*"]`. If neither leads to a turn, the fallback plays and the turn's `show_choices` blocks are offered again, so the tester can get back on the path.
- **An answer.** A prompt that ends with an answer's ```json fence (`readAnswer` in `packages/harness-sdk/src/answer.ts`) is matched against the turn's `respond` first.
- **Closing.** The app's closing prompt plays the `close` turn (its blocks dropped; a default note titled after the action when it has none). Without a `close` turn, a default note is saved.
- **Checkpoint.** A checkpoint prompt saves the closing note and changes nothing else.
- **Phase change and wrap-up.** `promptKind` knows the app's own prompts by their start: `Next part of this task:` (`PHASE_PROMPT`, whose first line names the part's id) and `Time is almost up:` (`WRAP_UP_PROMPT`). A phase change plays the turn whose `setPhase` is that id, the wrap-up the turn with `timeUp`, and the session continues from it. An unrecorded one plays the fallback and stays where it was. The first message never plays a `setPhase` or `timeUp` turn.
- **Time.** `dev --mock` sets `HH_TEST_MINUTE_MS=1000`: a time-box minute lasts one second, so a 15-minute box wraps up in about 13 seconds of test.
- **Free questions.** They match no recording and always get the default fallback.
- **Errors.** Any failure inside a turn (a write refused, a `ui` call rejected) becomes an error result `mock: <reason>` and exit code 1. The app shows it as an engine error.
- **Write containment.** A write or delete is refused when its path leaves the work folder, lands in `.claude` or `.harness`, goes through a symlinked folder that resolves outside, or targets a symlink itself.

## Recording

`humanharness run <action> --record [--force]` runs the task with the real engine, as `run` does, and writes `mock/<action>.json` at the end (`packages/cli/src/record.ts`, `run.ts`).

- **Refuses to start** when the file exists, unless `--force`. Actions reached by a choice are recorded into their own files only when none exists yet ("Not recorded: … already exists").
- **Per turn** it saves the text, the blocks (with their tool names), the usage and the files the AI changed, found by comparing the work folder before and after the turn (`.harness`, `.claude`, `.git`, `node_modules` and the files the app generates, `AGENTS.md` and the engine's instructions file, left out). A recording's `writes` may not point into `.claude/` or `.harness/` either (`mock-schema`).
- **Files.** Text files up to 64 KB. Binary files, larger files and symlinks are skipped (a symlink is never read). The skipped paths are listed once at the end, and only those that are new or changed during the run.
- **`match`** is the first line of the brief, past any front matter and cut before a `{{` placeholder.
- **Replies.** The person's reply becomes the `next` key along the path walked: the picked choice's label, or `*` for typed text. Other branches are added by hand.
- **Answers.** `a` at `run`'s prompt answers the pending input block field by field; the accepted answer is recorded under the turn's `respond`, leading to the next turn. A typed reply after an answer that never got its turn (a Stop) links by `*` as usual, not by the stale answer.
- **Notes.** A note written right after a turn belongs to that turn. The closing turn's note becomes the `close` turn's note. A checkpoint is not a turn, and its note is replaced by the closing one.
- **Phases and the time box.** A phase change turn is recorded with `setPhase` (the part it entered) and a wrap-up turn with `timeUp: true`. Neither is linked from the previous turn's `next`: replay finds them by the app's prompt. `>phase <id>` at the prompt records no reply for the same reason.
- **Failed turns.** A failed or held attempt is dropped. The retry carries any files the attempt wrote and is linked by the same reply.
- **First visit only.** If an action is run again in the same folder as another task, only its first visit is recorded, with a warning.
- **Atomic write.** Each file is written to a temp file and renamed, so a recording is never half written.
- **Review.** The output says the recording holds what you typed and what the AI answered, and should be reviewed before committing.

## check rules

`humanharness check` validates every `*.json` in `mock/` (`mockFindings` in `packages/cli/src/check.ts`). All are errors in `check`. `dev` without `--mock` reports them as warnings and still opens the app (a broken recording only matters to the app that replays it); `dev --mock` keeps them as errors. A harness without `mock/` gets nothing.

- `mock-schema`: the file is JSON and matches the schema.
- `mock-action`: the action is in the manifest, and the file is named after it.
- `mock-match`: `match` appears in the action's brief. It also fails when `match` appears in another action's brief, since replay could pick the wrong recording. That is allowed only when the other action has a longer `match` of its own that its brief contains (the longest match wins).
- `mock-next`: turn ids are unique and every `next` target is a turn.
- `mock-choice`: every `next` key except `*` is the label of a choice that turn's `show_choices` offers.
- `mock-input`: each `respond` answers an input block the turn shows (by its tool) with a value the block's `input` accepts; a `respond[].next` that is no turn is `mock-next`.

`run --record` warns up front when the match it will save is also in another brief.

`check` also warns with `setup-mock` when an interview setup step's action has no recording, since mock mode can't play the interview. It does so only when `mock/` already holds at least one recording: a harness that doesn't use mock mode gets no warning (`docs/architecture/setup.md`).

## Tests

- `packages/fake-agent/test/mock.test.ts` and `mock-replay.test.ts`: the schema and the walk (branch, `*`, fallback, close, missing close, state, phase changes and the wrap-up). `packages/fake-agent/fixtures/phases-harness/mock/session.json` is a recording with them.
- `packages/cli/test/record.test.ts`, `run.test.ts`, `dev.test.ts` and `check.test.ts`: the recorder, `run --record`, `dev --mock` and each `check` rule.
- `packages/e2e/tests/mock.spec.ts`: `launchMock` opens the demo with its recordings and walks a topic end to end, including one off-script reply, the note and the engine list (only the test engine). A second test starts from a fresh app (`makeFreshSandbox`) and walks the setup flow to the demo, then checks Settings › Models shows the test model.
- `packages/e2e/tests/scripts.ts` keeps the hand-written scripts for what a recording can't express: crashes, resume failures, model fallback.

## Known gaps

- Only Claude's transport (stream-json) is replayed. Codex is not.
- Free questions always get the default fallback.
- The folder step still offers the computer's real synced places. A tester who picks one creates a real folder there.
- Errors from a recording (rate limits, crashes) cannot be simulated. Use the e2e scripts.
- Recording is `run --record` only, not from the desktop app.
- A recording keeps only the first visit of an action in a run.
- Harness settings work in mock mode (the tab saves, `AGENTS.md` follows), but a recording plays the same whatever the settings.
- Task modes: `m <id>` under `run --record` is recorded like a typed follow-up (the `*` link), even when nothing switched. Replay plays a switch as any other reply, so a recording can't branch by mode.
