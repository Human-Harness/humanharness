# Spike: parallel sessions per engine, idle adapters, edit events (2026-10-28)

Checks the assumptions of the parallel tasks part 1 plan (`docs/superpowers/plans/2026-10-28-parallel-tasks-part1.md`, Task 1) against the real CLIs on Marco's machine. Only the CLIs were run (tiny prompts) and their stdout read; no engine config or credential folder was read, nothing was installed.

- Versions: `claude` 2.1.312 (Claude Code), `codex-cli` 0.160.1, `@agentclientprotocol/codex-acp` 2.2.2 (already in the npx cache: `npx --no-install @agentclientprotocol/codex-acp@2.2.2` answered `initialize`), `@agentclientprotocol/sdk` 1.8.0 from the repo's `node_modules`. OpenCode: not installed (`opencode` not on PATH, not in `~/.opencode/bin`).
- Folder: written below as `/tmp/pt-spike/...`; it really ran in the session scratchpad, `/private/tmp/claude-501/<project>/<session>/scratchpad/pt/part1/pt-spike/`, one fresh subfolder per run. `/tmp` is a symlink to `/private/tmp`, which is what makes the path-form question below testable.

## Summary

| # | Question | Verdict | What later tasks must do |
|---|---|---|---|
| PT-S1 | Two Claude `-p` turns at once in one folder; path form in `tool_use` | Holds: both exit 0, both files, each resume answers its own word. `file_path` is absolute and always the **real path** (`/private/tmp/...`), even when the folder was entered as `/tmp/...` | Task 7's `TurnLedger` accepts both the folder and `fs.realpathSync(folder)` as roots (as planned) |
| PT-S2 | Claude `-p` denies a tool that needs approval without asking | Holds: the turn ends on its own in 8–11 s, no prompt, no hang | None. Note: read-only Bash (`echo hi`) is auto-allowed in `default` mode; only commands that need approval are denied |
| PT-S3 | Two Codex adapters at once; edit event shape; memory | Holds: both `end_turn`, both files, no permission request in `workspace-write`. **Edit calls carry no `locations`**; the path is only in `content[].type === "diff"` `path`, absolute and **as given** (not realpath). **Codex often writes files through the shell** (`kind: "execute"`, a heredoc), which names no path at all. RSS ≈ 285–330 MB per adapter (npx + node + codex group); `initialize` 2.2–2.6 s after spawn | ACP parser reads `diff` paths (planned) and must not rely on `locations` for Codex. `edits` is a hint, not a complete list: attribution must treat a changed path no window named as "nobody's edits" (shared), never as an error. Per-slot adapter cost (~0.3 GB) supports part 2's idle sleep |
| PT-S4 | `session/load` after a process restart | Holds: `loadSession: true`; after SIGTERM to the process group, a new process `initialize`s (1.6–1.9 s), `session/load` succeeds (2.0–2.7 s from spawn) and answers `c.txt` (4.4–5.7 s from spawn) | `slot.sleep()` works for Codex on the happy path (3 short runs; long idle and a failed load untested) |
| PT-S5 | OpenCode twice at once | **Not run**: OpenCode is not installed | Unverified. Part 2 keeps the OpenCode cap at 1 until a run with OpenCode installed shows two concurrent `opencode acp` processes work; the open question stays open |

## PT-S1: two Claude turns at once

Commands (run concurrently, `&` then `wait`, distinct lowercase `uuidgen` ids):

```bash
cd /tmp/pt-spike/s1
claude -p "Create the file a.txt containing the word alpha. Reply OK." --output-format stream-json --verbose \
  --include-partial-messages --session-id <uuid-A> --permission-mode acceptEdits --allowedTools "Edit(./**)" "Write(./**)" &
claude -p "Create the file b.txt containing the word beta. Reply OK." --output-format stream-json --verbose \
  --include-partial-messages --session-id <uuid-B> --permission-mode acceptEdits --allowedTools "Edit(./**)" "Write(./**)" &
wait
```

Observed:

- Both exit 0. Wall time 6 s and 9 s (`result.duration_ms` 2876 and 5693). `a.txt` = `alpha`, `b.txt` = `beta`. Empty stderr. No lock or session clash between the two processes.
- `system/init` `cwd`: the real path of the folder.
- `tool_use`: `name: "Write"`, `input.file_path` = absolute real path, e.g. `/private/tmp/.../s1/a.txt`.
- Resume, also concurrently: `claude -p "What word did you write? One word." --output-format stream-json --verbose --resume <uuid>` → `result` `"alpha"` for A, `"beta"` for B.

Path form, extra run: `cd /tmp/pt-spike/s1link` (through the `/tmp` symlink; `pwd` prints `/tmp/...`) then the same Write prompt for `c.txt`. `system/init.cwd` and `tool_use.input.file_path` are both `/private/tmp/.../s1link/...`: Claude reports the **real path**, never the folder as given.

**PT-S1 conclusion:** concurrent Claude sessions in one folder work and keep their own context. Claude names edited files by absolute real path; a folder opened through a symlink (`/tmp`, `/var` on macOS) only matches after `fs.realpathSync(folder)`. Task 7's `TurnLedger` must accept both roots.

## PT-S2: Claude `-p` and tools that need approval

1. `--disallowedTools Bash`, prompt `Run the shell command echo hi and tell me the output.`: exit 0 in 8 s; the model gets no Bash tool at all (no `tool_use`), `result` says it has no shell tool. `permission_denials: []`.
2. Bash available, not allowed (`--permission-mode default --allowedTools "Edit(./**)"`), prompt `echo hi` with Bash: **it ran** (`tool_result` `hi`). Claude Code auto-allows read-only commands.
3. Same flags, prompt `Use the Bash tool to run exactly: mkdir zz && touch zz/x.txt`: exit 0 in 11 s. `tool_result` `is_error: true`, `"This Bash command contains multiple operations. The following parts require approval: mkdir zz, touch zz/x.txt"`; `zz/` was not created; `result.permission_denials` lists the Bash call. No prompt, no hang (timeout was 120 s).

The spike ran without the app's `--setting-sources project --strict-mcp-config` (the replies show user settings loaded); a re-run of `echo hi` with the app's flags was still auto-allowed.

**PT-S2 conclusion:** in `-p` a tool call that needs approval is denied at once and the turn continues to its end; this backs spec §8. A disallowed tool is not offered at all. Read-only shell commands are not "needing confirmation" and run.

## PT-S3: two Codex adapters at once

`/tmp/pt-spike/s3/run.mjs` (scratch only) spawns `npx --no-install @agentclientprotocol/codex-acp@2.2.2` twice (`detached`, as `AcpTransport`), with the SDK's `acp.client(...).connect(ndJsonStream(...))`, then `initialize` (no fs, no terminal), `session/new { cwd, mcpServers: [] }`, `session/set_mode "workspace-write"`, and both `session/prompt`s at the same time. The permission handler would pick `allow_once` and log the request.

Run 1 (two folders, prompts `Create c.txt containing gamma. Reply OK.` / `... d.txt ... delta ...`):

- `initialize` answered 2.5–2.6 s after spawn; `agentCapabilities.loadSession: true`, `sessionCapabilities` include `resume`, `close`, `fork`.
- Both `stopReason: "end_turn"` (6.5 s, 7.0 s); `c.txt` = `gamma`, `d.txt` = `delta`.
- Codex wrote both files **through the shell**: `tool_call` `kind: "execute"`, title `cat > c.txt <<'EOF' ...`, `rawInput` keys `command`, `cwd`; no `locations`, no `diff`. (C also ran `pwd` first.)
- RSS after the turn, summed over the process group: 324 MB and 328 MB.
- No `session/request_permission`.

Run 2 (both sessions in **one** folder, prompts with ` Use your apply_patch file-editing tool, not the shell.` appended):

- Both `end_turn` (4.1 s, 4.3 s), both files present.
- Each edit: `tool_call` `kind: "edit"`, `title: "Editing files"`, **no `locations`**, `content` with one `type: "diff"` whose `path` is absolute (`/private/tmp/.../s3b/c/c.txt`). The `tool_call_update` (`status: "completed"`) carries no diff.
- RSS 289 MB and 284 MB. No permission requests.

Run 3 (as run 2, `cwd` given as `/tmp/...`): the diff `path` is `/tmp/.../c.txt`, i.e. **as given**, not resolved. RSS 316 MB and 329 MB.

The app runs the bundled adapter with Electron as node (no npx), so its own number is slightly lower; ~0.3 GB per adapter is the order of magnitude.

**PT-S3 conclusion:** two Codex adapters run side by side, in separate folders or one. Codex edit paths come only from `diff.path`, absolute, in the form of the `cwd` it was given; `locations` is empty for edits. Codex frequently edits through shell commands that name no path, so `edits` is a partial hint: a path changed during a turn and named by no window must be handled as unowned (shared), never as a failure. Memory per adapter is ≈ 0.3 GB.

## PT-S4: sleep and resume a Codex session

Same script, after run 1/2/3: SIGTERM to both process groups (`process.kill(-pid)`, as `AcpTransport.terminate`), wait 1 s, spawn a new adapter in C's folder, `initialize`, `session/load { sessionId: <C's>, cwd, mcpServers: [] }`, `session/set_mode`, prompt `Which file did you create? Just the name.`

- `agentCapabilities.loadSession: true`.
- `initialize` 1.6–1.9 s after spawn; `session/load` succeeded 2.0–2.7 s after spawn.
- Answer `c.txt` (three of three runs), 4.4–5.7 s from spawn to the end of the turn.

**PT-S4 conclusion:** a Codex session survives the adapter process; `slot.sleep()` (terminate) followed by a lazy `session/load` on the next turn works on the happy path. Waking costs ~2–3 s before the turn starts. Untested: a long idle, a large session, and a failed load — `AcpTransport.openSession` falls back to `session/new` silently on any load failure except an expired login, so the context would be lost without notice. In the first run the folder held only `c.txt`, so that answer could also come from listing the folder. Whether `session/load` replays history was not checked (today `emit` is set only after `openSession`, so a replay isn't emitted). The adapter ran through `npx`, not the bundled copy. S3/S4's timings and RSS figures were read from stdout and not saved.

## PT-S5: OpenCode twice at once

Not run: `opencode --version` fails (not on PATH, nothing in `~/.opencode/bin`). Its data folder was not looked at.

**PT-S5 conclusion:** unverified. Until a spike with OpenCode installed shows two `opencode acp` processes finishing concurrent turns without a lock or port error, part 2 caps OpenCode at one open slot, and spec open question 1's OpenCode half stays open.
