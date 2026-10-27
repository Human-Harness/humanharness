# Sidekick

Spec: `docs/superpowers/specs/2026-10-25-sidekick-design.md` ("§" below). Plan: `docs/superpowers/plans/2026-10-27-sidekick-part1.md` (slice 1, "Decision N" below). Spike: `docs/spikes/2026-10-27-sidekick.md` (A1–A7).

## What it is

- A prompt coach. Before the person's prompt goes to the task agent, a free local check looks at it; when something looks off (or the action asks for it, or the person presses Review) a light model reviews it in its own session and a card in the right panel suggests a rewrite. The person sends the suggestion, edits it, or sends as typed. Sidekick suggests and never acts: it has no tools and changes nothing.
- It is core (D1): every harness gets the controller, the top-bar toggle, the panel or its rail, Settings › Sidekick, a Sidekick row in Settings › Models and (once a Sidekick turn ran) a Sidekick line in Settings › Usage.
- It starts **off** unless the manifest says `sidekick: { default: "on" }` (§3). Off, nothing runs: no review, no session, no folder, no usage line (D0, below).
- Part 1 has one sidekick: id `sidekick`, name "Sidekick" (`SIDEKICK_ID`, `SIDEKICK_NAME` in `packages/shell/src/main/sidekick.ts`, Decision 9), and one moment: before you send.

## The manifest

`sidekick` (`sidekickSchema` in `packages/harness-sdk/src/sidekick.ts`), optional; absent, Sidekick is available, off, with no tips.

- `default`: `on` or `off` (default `off`): the state for a new profile.
- `tips`: domain hints appended to the brief, in English; one text or one per purpose (`sidekickTips`). `humanharness check` warns above `SIDEKICK_TIPS_TOKENS_WARN` (300) tokens (`sidekick-tips` in `packages/cli/src/check.ts`).
- `actions`: the pre-send mode per action id, `auto` (review only when the local check flags), `always` or `off` (`sidekickMode`). Free questions and unlisted actions are `auto`. An unknown action id is a parse error, not a check warning.
- `checks.minWords` (default `SIDEKICK_MIN_WORDS`, 6): below it a prompt with a vague word is flagged even beside something concrete.
- `sidekick` is reserved: an action can't use it as its id (Settings › Models keys Sidekick's model by it, `SIDEKICK_PROCESS`), and `RESERVED_COLLECTIONS` (`packages/harness-sdk/src/data.ts`) holds it.

## The flow

1. **Enter** in the composer, with Sidekick on: `submit` in `packages/ui/src/ChatView.tsx` shows "Reviewing…" with the countdown and calls `client.sidekick.review({ text, force?, attached? })` (IPC `hh:sidekickReview`, `packages/shell/src/main/sidekick-ipc.ts`; a malformed request answers `send`). Plain Enter during a review does nothing. `attached` is set when the open scope has material, so "the file" is not missing context.
2. **What is reviewed** (Decision 7): only free text typed in the composer (a new question, a new action's prompt, a follow-up). Block answers, choices' follow-ups and harness UI sends are never reviewed in part 1. Slim (interview) mode never shows Sidekick.
3. `SidekickController.review` (`packages/shell/src/main/sidekick.ts`) returns `send` at once when Sidekick is off, pre-send is off, the action's mode is `off`, or the app isn't set up (or the engine's notice isn't accepted).
4. **The local check** (`localCheck` in `packages/workspace/src/sidekick-checks.ts`, 0 tokens): at most one flag per kind, in order `vague`, `missing-context`, `two-asks`, `off-phase`, each with the words and the `[start, end)` span that raised it. The lists are English (§12 Q2). `known` is the scope's note titles plus the data tables the agent sees; a reference that names one of them is not missing context. `off-phase` uses the words (4+ letters, minus a stop list) of the other phases' labels, since phases have no keywords (Decision 4); the open phase comes from `TaskManager.openPhase()`. `attached` mutes `missing-context`.
5. **The decision**: no flag and mode `auto` and no `force` → `send`. The cap reached → `send`.
6. **The model**, within the wait (6 s, 10 s, or "always", which waits up to `SIDEKICK_ALWAYS_MAX_MS`, 60 s; Decision 6): the session for the open task (below), the per-turn prompt `preSendPrompt` (`packages/shell/src/main/sidekick-turns.ts`): `SIDEKICK_PRE_MARK` first, the app, the open phase, up to 20 note titles, the data tables, the local flags, the UI language by name, the prompt between `<prompt>` tags, and the JSON contract with "Answer with the JSON object only" (A3 was measured with it) and "Omit `rewrite` when the verdict is `send`" (Haiku echoes the prompt otherwise). Never the task's history.
7. `parseReview(reply, prompt)`: the outermost `{…}` checked against `reviewSchema` (zod); a `rewrite` equal to the prompt is dropped; a `suggest` with nothing to show is a `send`. A `suggest` shows a card when `confidence ≥ SIDEKICK_THRESHOLD` (0.5, Decision 5); otherwise `send`.
8. **The card** (`SidekickPanel`, `packages/ui/src/sidekick/`): "Before you send": the issues, the suggested prompt as a word diff (`word-diff.ts`), queued prompts ("For later": Put in composer / Drop), and Send suggested / Edit / Send anyway. The flagged spans are underlined behind the composer (`FlaggedText.tsx`, spans clamped to the text, `start > end` skipped). Each new card is announced once in the polite live region. The outcome (`used`, `edited`, `sent-anyway`, `dismissed`) goes back through `client.sidekick.resolve` so the card leaves; part 2 logs it.
9. **Anything wrong sends the prompt as typed**: a timeout (the notice "timeout"), an engine error, a crash or a reply that isn't the contract (the notice "failed", "couldn't review"), the cap. A late answer is dropped.
10. **Keys.** ⌘⏎ / Ctrl⏎ sends at once, cancelling a running review (`hh:sidekickCancel`), and a card still waiting resolves as `sent-anyway`. ⌥⏎ and the Review button force a review (`force`). The IME guard (`isComposing`, keyCode 229) comes first.
11. **Superseding.** Every review, cancel, turn-off and close bumps a counter (`reviews`); a review overtaken while it waited for its inputs (or its session) ends as `cancelled` and opens nothing. In the renderer a `cancelled` sends as typed (Sidekick turned off mid-review).

The renderer (`useSidekick(client, enabled, refresh)`, `packages/ui/src/sidekick/useSidekick.ts`) reads `client.sidekick.get()` and follows `hh:sidekick` pushes; the refresh key is bumped after a restore. The panel is 330 px, expanded when Sidekick is on at start; the rail is 52 px; both hide under 720 px. With a harness `renderSide`, the expanded head has a Sidekick | Harness switch and the rail sits beside the harness panel (Decision 10). `status` is `off`, `watching`, `reading`, `suggestion` or `capped`. While off, the panel shows a one-time intro card (Turn on / Not now, stored as `introSeen`).

## The session

`SidekickSession` (`packages/runtime/src/sidekick.ts`): a second transport with its own session id, beside the task's.

- **No tools.** `noTools: true` on the transport (`packages/runtime/src/transport.ts`). Claude (`claudeArgs` in `claude-cli.ts`): `--tools ""` (A1: `tools: []`) and `--disallowedTools` with every built-in by name (`ALL_BUILTIN_TOOLS`), the strict empty MCP config (A7), the same `--setting-sources project` as tasks; a no-tools session refuses MCP servers or reference folders. ACP (Codex, OpenCode): no MCP servers, permissions `{ edit: "none", exec: false, web: false }`, the read-only session mode (`acpFields(engine, "none")`); A5 saw no activity or permission request.
- **Turns** run one at a time. `ask` never throws: a crash, an abort or an engine error is a failed answer, with the usage and limits the engine reported. `close()` waits for a running turn, so the controller aborts the turn's signal first. An aborted first turn leaves the session un-started; the next turn reuses the same id.
- **The model** is the `sidekick` process in Settings › Models (`models.tasks.sidekick`), recommended `light` (Decision 13), resolved when the session opens and fixed for it (plan 3c). Settings shows the tier from the saved models, also while off.
- **The working folder** is `<userData>/sidekick/<sha256(resolved base)[0..16]>/sidekick/` (`sidekickWorkDir` in `packages/workspace/src/sidekick-brief.ts`), so per profile, since each profile has its own base. It holds the session's `AGENTS.md` (`sidekickBrief`: `SIDEKICK_RULES`, then the harness tips; part 2 adds what it learned) and the engine's own file, written by `writeSidekickBrief` only when they changed (the cached prefix survives). The brief is written when a session opens and never again for that session (§5).
- **Why outside the base** (Decision 1): the spec puts it at `<base>/.harness/sidekick/<id>/`, but Claude Code loads every `CLAUDE.md` from the working folder up, and Codex reads `AGENTS.md` from the git root down; the base is a git repo with the task's `CLAUDE.md`/`AGENTS.md` at its root. The spike (A2) confirmed the leak, so the folder lives in the app's `userData`. The task's `AGENTS.md` and engine file are never written by Sidekick. Part 2's `events.jsonl` stays in `<base>/.harness/sidekick/`.
- **One session per task** (Decision 14). The controller keys sessions by the open task's id (`runningTask()`). A review with no task open (a new question or action being sent) binds to a "no task" session; the task that starts next adopts it (its pre-task spend stays in the week's total; the task's own lines start its cap). `betweenTasks` (the task manager's hook, called before a task's `current` is set and after it ends) closes every session whose task is no longer open; the no-task session survives exactly one `betweenTasks` after a review used it (the one right before its task starts), so it never outlives the task it was made for. Turning Sidekick off and quitting abort the running review and close every session.
- **Mock mode** (`humanharness dev --mock`): `mockSidekickReply` (`packages/fake-agent/src/mock-claude.ts`) answers prompts starting with `SIDEKICK_PRE_MARK` with a canned JSON from the flags in the prompt: `suggest` (confidence 0.8) for flagged prompts, `send` for a forced review with none (Decision 12).

Latency (spike A4, resumed Haiku turns): p50 4.2 s; 8/9 under 5 s; max 66 s (an API stall). The 6 s wait will run out now and then by design. Codex's cold first turn is about 10 s (adapter spawn and `session/new`), warm turns about 1.3 s.

## Settings

- The reserved `sidekick` collection (§6.4): app-wide, keyed by `id`, `agent: "none"` (`sidekickCollection()`). Part 1 has one record, `{ id: "settings", type: "settings", on?, preSend?, wait?, cap?, introSeen? }` (`sidekickRecordSchema`, which refuses another id for a `settings` record). Only changed values are stored; back at the defaults, the record is deleted. Defaults (`sidekickSettings`): `on` from the manifest's `default`, `preSend` true, `wait` 6, `cap` 20,000, `introSeen` false.
- It lives in its **own** `DataStore` per base (`sidekickStoreFor` in `packages/shell/src/main/index.ts`), never in `dataCollections(h)` (Decision 8): the harness's rules snapshot, the history's data diff and the harness UI's `client.data` never see it. Its file is `<base>/.harness/data/_app/sidekick.json`, beside the others, so it is in the history and undo restores it.
- Writes go through the person's data path: `SidekickStore` (`packages/shell/src/main/sidekick-store.ts`) sends a `put` or `delete` as the person, app-wide, to `personDataRequests`, which finds the store through the optional `storeFor` hook (`PersonDataDeps.storeFor`, `packages/shell/src/main/data-requests.ts`). So a change shares the person-writes queue, its checks and turn-blocked refusals, and is one `Data: sidekick` commit under the open task's trailer. `SidekickStore.set` runs one change at a time, skips a no-op, and never throws (`{ ok: false, message }`). `harnessUiDataRequests` refuses `sidekick` as an unknown collection.
- IPC: `hh:sidekickGet`, `hh:sidekickSet`; the state is pushed on `hh:sidekick` (no `hh:dataChange`). Turning off aborts a running review, clears the card and the notice, and closes every session.
- Settings › Sidekick (`SidekickTab.tsx`, after Models): on/off, pre-send review, the wait, the cap, the tier (a link to Settings › Models) and the week's tokens. "N of M suggestions used" and "What Sidekick learned" are part 2.

## Usage

- Every model turn writes one line in the base's `usage.jsonl` (`sidekickRecord` in `packages/shell/src/main/usage-log.ts`): `phase: "sidekick"` (a `TurnKind`, since `phase` already names the turn kind), `process: "sidekick"`, `moment: "pre"` (part 2 adds `after` and `learn`), `sidekick: "<id>"`, and `task`, `scope`, `action` when a task is open, with the profile, `ok`, `usage` and `limits` when the engine reported them (Decision 2: the spec's `phase: "pre" | "after" | "learn"` would have broken the readers of `phase`). Haiku's thinking tokens are inside `outputTokens` (A6).
- `summarizeUsage` leaves Sidekick lines out of the per-action estimates, task totals and per-scope totals (like material stages), marks a task turn followed by a Sidekick line as unmeasured, and adds `UsageSummary.sidekick` (all four counts) only when there is at least one; with profiles it is the active profile's. Their limit windows still count as the latest window.
- **The cap** (Decision 3): `capTokens` counts input + output + cache writes; cache reads (the cheap repeated prefix, ~16k on Codex) are left out. `sidekickSpent(records, task)` is the task's figure, plus the tokens of reviews made before the task existed while their session is still unadopted. At the cap a review sends as typed and the status is `capped`. The panel's foot shows the same number.
- `sidekickWeek` is the last 7 days' tokens for Settings › Sidekick. The controller caches Sidekick's usage lines per base and drops the copy after each line it logs (it assumes one app process per base).

## D0

Anything the spec doesn't name stays unchanged for every harness, and the person can turn it off. Each rule has a regression test:

| Rule | Test |
|---|---|
| A manifest without `sidekick` parses to the same object as before | `packages/harness-sdk/test/sidekick.test.ts` ("D0: a manifest without sidekick parses as before") |
| `dataCollections(h)` never includes `sidekick`; its own store | `packages/harness-sdk/test/sidekick.test.ts` ("D0: dataCollections never includes it"), `packages/shell/test/data-requests.test.ts` ("D0: without storeFor…") |
| `claudeArgs` without `noTools` returns the old argv | `packages/runtime/test/claude-cli.test.ts` ("D0: without noTools the argv is exactly the old one") |
| `summarizeUsage` without Sidekick lines returns the old summary, no `sidekick` key | `packages/shell/test/usage-log.test.ts` ("D0: a log without sidekick lines summarizes exactly as before") |
| Sidekick never writes the task's `AGENTS.md` or engine file | `packages/workspace/test/sidekick-brief.test.ts` ("the folder is under userData, … never inside the base") |
| Off: no review, no session, no file, no usage line | `packages/shell/test/sidekick-controller.test.ts` ("D0: off → send, no session, nothing logged"), `packages/e2e/tests/sidekick.spec.ts` ("D0: with Sidekick off…") |
| Without `state.sidekick`, ChatView, Settings, Models and Usage render as before | `packages/ui/test/sidekick-chat.test.tsx` (two D0 tests), `settings.test.tsx`, `models-tab.test.tsx`, `usage-tab.test.tsx` (D0 tests); every existing UI test runs a FakeClient without Sidekick |

Main always sends `state.sidekick` (Decision 11); the renderer draws Sidekick only with it.

## Part 2

`docs/superpowers/plans/2026-10-27-sidekick-part2.md` (slices 2–5): the after-reply moment and queued prompts, the heads-ups, learning (`events.jsonl` with every card outcome, thresholds per kind, muting, "What Sidekick learned"), several sidekicks with purposes and their own sessions under a shared cap, the `phase-change`, `daily` and `before-approve` moments, harness places (`client.sidekick.ask`), presets, import, and the free text of input blocks.
