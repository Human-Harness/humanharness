# Spike: warm "base session" per harness+tier, forked per task (2026-11-02)

Question: can Human Harness keep a warm base session per harness+tier and fork each new task from it, to skip the cold prompt-prefix cache write (~20k tokens)?

Short answer: the fork primitive exists on all three engines and works, but on Claude the saving we measured is about zero, because the shared prefix is already cache-hit across independent sessions and the TTL is 1 hour. Recommendation: do not build it for Claude now.

Versions: claude 2.1.316 (model claude-opus-5-5, 1M context), codex-cli 0.160.1. OpenCode is not installed here; docs only.

## How sessions start today

`packages/engines/src/claude/transport.ts` (`buildArgs`, around lines 226-245): one `claude -p` process per turn, `--output-format stream-json --verbose --include-partial-messages --setting-sources project --permission-mode ... --strict-mcp-config --mcp-config {...} [--settings ...] --session-id <uuid>` on the first turn and `--resume <uuid>` afterwards, plus `--model/--effort/--autocompact` from the tier profile. No `--system-prompt` is passed (Claude Code's own system prompt is used). `capabilities.forkSession` is `false` for Claude and for the ACP adapter (`claude/adapter.ts:6`, `acp/adapter.ts:13`); nothing uses fork today.

## (a) Does fork exist, and does it leave the base alone?

- `claude --help` lists `--fork-session`: "When resuming, create a new session ID instead of reusing the original (use with --resume or --continue)". It works with `-p`.
- Verified: base session B got "Remember PINEAPPLE" (run 1); a fork of B got "Remember MANGO" (run 2, new session id b8593ff8...); then resuming B and asking for the remembered words answered only `PINEAPPLE` (run 3). The fork's turn is not in the base, and B kept its id.

## (b) Cache numbers

All runs: scratch dir outside the repo, app-like flags (`-p --output-format json --setting-sources project --permission-mode default --strict-mcp-config --mcp-config '{"mcpServers":{}}'`), same `--append-system-prompt nonce-wp-4821` for B and its forks. Prompts are tiny. Not reproduced: the app's MCP servers, `--allowedTools/--disallowedTools`, `--settings`, `--model/--effort`, so the prefix here (~17k) is likely smaller than the app's.

| # | Run | input | cache_read | cache_creation | total prefix | cost USD (reported) |
|---|-----|------:|-----------:|---------------:|-------------:|-------:|
| 1 | Base B, new session (first call of the spike) | 2 | 11,391 | 5,879 | ~17.3k | 0.0503 |
| 2 | Fork of B, immediately | 4 | 17,270 | 68 | ~17.3k | 0.0544 |
| 3 | Resume B (not a fork) after the fork | 4 | 17,270 | 77 | ~17.3k | 0.0546 |
| 4 | Brand-new session, same flags as B | 2 | 13,249 | 4,017 | ~17.3k | 0.0349 |
| 5 | Brand-new session, different append-prompt nonce | 2 | 11,391 | 5,877 | ~17.3k | 0.0503 |
| 6 | Fork of B after ~7 min idle (B last used 12:10:23, fork ~12:17:40) | 4 | 17,347 | 19 | ~17.4k | 0.0583 |

Findings:
- A "cold" new session is not cold. Even run 1 read 11.4k tokens from cache: the Claude Code system prompt and tool schemas are identical across sessions, so the API cache is shared by prefix, not by session. Only the tail after the first differing byte (here the appended prompt plus the first user turn, 4-6k tokens) is written.
- The fork wrote almost nothing (68 tokens) because the whole base conversation hit the cache. But a new session's write is already only 4-6k tokens, so the delta is 4-6k tokens, not 20k.
- Reported cost does not favour the fork: 0.054-0.058 for forks vs 0.035-0.050 for new sessions. Run 2 also included an extra thinking sub-call (`modelUsage` shows 28.7k read / 5.9k created across two requests), so costs are not cleanly comparable; n=1 each. The honest reading is "no measurable saving".
- TTL: every cache write here shows `ephemeral_1h_input_tokens` and `ephemeral_5m_input_tokens: 0`, i.e. this CLI/account wrote 1-hour cache entries, not the 5-minute default. The fork after ~7 min idle still got 17.3k cache_read with 19 created. Caveat: runs 4-5 touched the shared prefix at 12:10:37 (also ~7 min earlier), so this proves the TTL exceeds 5 min for the shared prefix; the base's own tail was last touched at 12:10:23. A base idle for more than 1 h would expire and the next fork would re-write (about 6k tokens, once). The 1h TTL may depend on plan/auth (API-key use defaults to 5 min unless the client asks for 1h); not tested.

## (c) Codex and OpenCode

- Codex: `codex fork [SESSION_ID] [PROMPT]` ("Fork a previous interactive session") and non-interactive `codex exec fork` ("Fork a previous session by id into a new session"), from `codex --help`, `codex fork --help`, `codex exec --help` on 0.160.1. Not executed. OpenAI prompt caching is automatic by prefix with no write premium (cached input is only discounted), so the saving is smaller than on Claude. The app drives Codex over ACP (`session/new|load`); the repo has no ACP fork path (`forkSession: false`), so using it means the CLI or an ACP extension.
- OpenCode: https://opencode.ai/docs/cli/ lists `opencode run --session <id> --fork` ("Fork the session when continuing, use with --continue or --session"), also on `tui` and `attach`. Not installed here, not run.

## (d) Sketch

Per (harness, tier, engine) a base session:
- Create: lazily on the first task of that key, or in the background at app start: `claude -p --session-id <base> <same flags as tasks> "Reply OK"` (one tiny turn). Store `{key, baseSessionId, engine, fingerprint, lastUsedAt}` in the app data dir next to task state.
- Use: a new task's first turn runs `--resume <base> --fork-session`. The transport chooses the id up front today (`--session-id`); with a fork the id is only known after the first turn from the stream's `session_id`.
- Keep warm: nothing on a 1h TTL if tasks arrive at least hourly; otherwise accept one re-write. A keep-alive ping costs a full cache_read of the prefix each time and is not worth it for a 4-6k saving.
- Invalidate (fingerprint = hash of): harness system prompt/instructions, tool set and MCP config (`--mcp-config`, `--allowedTools/--disallowedTools`, `--settings`, plugin dir, agents file), model and effort (cache is per model), `--setting-sources`, engine CLI version (the built-in prompt changes between releases), harness version. On any change, delete the stored base (the CLI's session file can stay) and recreate lazily.
- Problem: per-task flags (reference folders via `--settings`, permission mode, linked folders, engine preset) vary per task. Flags are passed again on resume, and anything that differs from the base changes the prefix and misses the cache anyway. A base is only useful per exact flag set, which multiplies bases.

## (e) Recommendation

Do not build it for Claude. What it would remove per task is the 4-6k-token tail write, roughly $0.01-0.02 at the observed prices, not 20k tokens, because the 11-13k shared prefix is already cached across sessions with a 1h TTL. The measured cost of a fork was not lower than that of a new session. The added complexity (fingerprinting, id known only after the first turn, flag variance per task, extra sessions on disk) outweighs about one cent per task.

Revisit only if: (1) a harness puts a large static context (10k+ tokens of instructions/material) in the first turn or system prompt, where pre-loading it once in a base would save a real cache write on every task; measure with the real app prompt first; or (2) on a 5-minute-TTL path where cold starts are common. Codex and OpenCode: the CLI fork exists, but the app uses ACP and OpenAI-style caching has no write premium, so do not do it there.

Suggested follow-up: repeat runs 1, 2 and 4 with the app's real first-turn prompt and full flag set, n>=3, to size the real prefix.

## Commands (reproduce)

A helper `run.sh <label> <claude args...>` (kept in the session scratchpad, not in the repo) ran, from a scratch dir outside the repo: `claude -p --output-format json --setting-sources project --permission-mode default --strict-mcp-config --mcp-config '{"mcpServers":{}}' <args>`, then printed `usage.input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` and `total_cost_usd` from the JSON.

1. `--append-system-prompt nonce-wp-4821 --session-id 7c1e2b60-1111-4a2b-9c3d-aaaaaaaaaa01 "Remember the word PINEAPPLE. Reply OK"`
2. `--append-system-prompt nonce-wp-4821 --resume 7c1e2b60-1111-4a2b-9c3d-aaaaaaaaaa01 --fork-session "Remember the word MANGO. Reply OK"`
3. `--append-system-prompt nonce-wp-4821 --resume 7c1e2b60-1111-4a2b-9c3d-aaaaaaaaaa01 "List every word I asked you to remember in this conversation. Reply with just the words."`
4. `--append-system-prompt nonce-wp-4821 --session-id 7c1e2b60-2222-4a2b-9c3d-aaaaaaaaaa02 "Remember the word KIWI. Reply OK"`
5. `--append-system-prompt nonce-wp-9937-other --session-id 7c1e2b60-3333-4a2b-9c3d-aaaaaaaaaa03 "Remember the word KIWI. Reply OK"`
6. (after ~7 min idle) `--append-system-prompt nonce-wp-4821 --resume 7c1e2b60-1111-4a2b-9c3d-aaaaaaaaaa01 --fork-session "Reply OK"`

Other: `claude --version`, `claude --help | grep -iE "fork|resume|session"`, `codex --version`, `codex --help`, `codex fork --help`, `codex exec --help`, `codex exec resume --help`; OpenCode flags fetched from https://opencode.ai/docs/cli/. Six real `claude -p` calls in total.
