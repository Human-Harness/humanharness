# Desktop app: first real run (plan 2a, task 11)

Date: 2026-10-10. macOS (Darwin 27), Electron 44.7.0, `corepack pnpm app:dev` from the worktree, demo harness.

## Claude

Setup: Español, suggested folder `~/Documents/Human Harness Demo`, Claude, Empezar.

| Check | Result |
|---|---|
| Setup screen renders, folder is created with `AGENTS.md`, `CLAUDE.md`, `README.md`, `.harness/` | OK |
| Plain chat turn, streamed reply | OK |
| "Hacé una nota que se llame Compras con leche y pan." → activity `Editando Compras.md`, note card, progress in side panel | OK |
| Close and reopen: chat restored from `.harness/chats/main.jsonl` | OK |
| Historial → "Volver a este punto" on Start: note removed from the folder | OK |
| Detener during a turn: entry saved with `error: cancelled` | OK |

## Codex

Same folder as Claude (the tester did not switch folders), engine changed to Codex.

| Check | Result |
|---|---|
| Turn runs through the bundled `codex-acp` under Electron (`ELECTRON_RUN_AS_NODE`), GUI PATH resolved | OK |
| `session.json` switches to `{"engine":"codex", ...}`: a new session, no crash | OK |
| Agent reads the existing files (`notes/Compras.md`) | OK |
| Note block, history, cancel, resume after reopen | Reported working by the tester; only one Codex turn appears in the chat log, so not independently confirmed |

## Findings and fixes

- **Shared userData across harnesses.** The app used Electron's default `userData` (`~/Library/Application Support/@humanharness/shell`), so every harness would share one config and history. Fixed: the main process loads the manifest with top-level await before `ready` and sets `userData` to `~/Library/Application Support/Human Harness/<harness id>` and the app name to the harness name. Chromium caches land there too, which confirms it runs before `ready`.
- **Raw shell commands in the activity list.** Codex reports `exec` activities with the full command (`pwd && rg --files …`), which non-technical users should not see. Fixed: `activity.exec` is now a fixed phrase ("Revisando la carpeta…" / "Checking the folder…"); the command stays in the chat log.
- **Engine switch in the same folder.** The UI shows the earlier Claude conversation, but Codex starts a fresh session and does not know it. Acceptable for 2a (the engine is chosen once). Follow-up for 2b: when the engine changes, either start a new chat or hand the new engine a short summary.
- **Sandbox warning.** Launching from the Claude Code sandbox prints `sandbox_extension_issue_file failed … Electron Helper.app/Contents/Resources: 1 (Operation not permitted)`. Harmless: the window opens and works.

## After the review fixes (2026-10-11)

Fresh config, Claude, same folder as before.

| Check | Result |
|---|---|
| Earlier conversation restored after picking the existing folder | OK |
| Plain chat turn | OK |
| Cmd+Q during a turn: turn saved as `cancelled`, app quits without hanging | OK |
| Earlier run: `~/Documents` rejected; cancel right after send stops the turn in ~1 s; closing the window mid-turn keeps the entry in the log | OK |
