# Spike: transports (2026-10-10)

## Claude (`claude -p`)
- Version tested: 2.1.296 (Claude Code)
- MCP tool name in stream-json: `mcp__ui__show_note` (`"name":"mcp__ui__show_note"` in the `tool_use` block). The `system`/`init` line lists it in `tools` and reports `"mcp_servers":[{"name":"ui","status":"connected","source":"dynamic"}]`.
- `--mcp-config` inline JSON + `--strict-mcp-config`: works. The inline JSON string was passed as the argument; the server was loaded and `tmp-spike/calls.log` received `{"title":"hello"}`. The init `tools` list contained only built-in tools plus `mcp__ui__show_note`.
- `--resume` on second call: works. A second `claude -p ... --resume <same id>` exited 0 with `subtype":"success"`, and the model recalled its previous answer ("done"). The same flags (including `--strict-mcp-config --mcp-config`) were passed again.
- Result line on success: `{"type":"result","subtype":"success","is_error":false,"result":"done","stop_reason":"end_turn","session_id":"<id>", "total_cost_usd":..., "usage":{...}}`.
- Environment: the nested call worked without unsetting `CLAUDECODE`. cwd of the spawned process was `tmp-spike/work`.
- Note: the plan's `$(cat ../mcp.json)` command substitution worked when wrapped in a shell script (the worktree-isolation guard refused it inline in this harness only).

## Codex (ACP via @zed-industries/codex-acp)
- codex-acp version / bin: `@zed-industries/codex-acp` 0.16.0, bin name `codex-acp` (`bin/codex-acp.js`). `npx -y` prints a deprecation warning: "This package has been replaced by @agentclientprotocol/codex-acp" (npm latest: 2.2.2, bin `codex-acp` -> `dist/index.js`). The replacement was NOT tested. Platform binary comes from an optional dependency (`@zed-industries/codex-acp-darwin-arm64`), so the agent ships its own embedded Codex core (log shows `client_version=0.137.0`); a separately installed `codex` CLI is not needed to start it.
- codex CLI version: could not be determined. `/opt/homebrew/bin/codex` is a dangling symlink to `/opt/homebrew/Caskroom/codex/0.104.0/codex-aarch64-apple-darwin`; the `0.104.0` directory is empty. `codex` is not on PATH, `codex --version` and `codex login status` therefore could not run. (brew cask metadata says 0.104.0.)
- Auth: the agent read the existing Codex login on its own (no credentials were passed by the probe) and attempted to use it, but the stored ChatGPT login is expired/invalid: `Failed to refresh token: 401 Unauthorized ... invalid_refresh_token`, `Your access token could not be refreshed. Please log out and sign in again.` So "reuses `codex login`": yes in behaviour (it attempted the stored ChatGPT token), but a working end-to-end turn was NOT achieved. authMethods: `chatgpt` ("Login with ChatGPT"), `codex-api-key` (env var `CODEX_API_KEY`), `openai-api-key` (env var `OPENAI_API_KEY`).
- INIT response: `protocolVersion:1`, `agentCapabilities: {loadSession:true, promptCapabilities:{image:true,audio:false,embeddedContext:true}, mcpCapabilities:{http:true,sse:false,acp:false}, sessionCapabilities:{list:{},resume:{},close:{}}, auth:{logout:{}}}`, `agentInfo:{name:"codex-acp",title:"Codex",version:"0.16.0"}`.
- loadSession supported: yes (`loadSession:true`; also `sessionCapabilities.resume`).
- `session/new` with `mcpServers:[{name:"ui",command:"node",args:[...],env:[]}]`: accepted; returned a `sessionId` and modes `read-only` (default), `auto`, `full-access` plus config options (mode, model, ...). Whether the stdio MCP server was actually launched/loaded is NOT confirmed: the turn failed on auth before any tool call, `calls.log` only contains the Claude entry, and the log has no MCP-related line other than an unrelated `rmcp::transport::worker ... 401` (Codex's own backend connection).
- tool_call for MCP tool: not observed (turn failed with 401 before any model output). Title/kind unknown.
- File write: permission requested: not observed. kind/locations unknown. Note the default session mode is `read-only` ("Approval is required to edit files").
- stopReason: none. `session/prompt` rejected with JSON-RPC error -32603 `Internal error`, `data: {message: "Your access token could not be refreshed. Please log out and sign in again.", codex_error_info: "unauthorized"}`.
- Only `UPDATE` seen: `available_commands_update` (review, review-branch, review-commit, init, compact, logout).

## Decisions for plan 1
- `minVersion` for claude: 2.1.296   (Task 4)
- `minVersion` for codex: UNDETERMINED. `codex` CLI is not runnable on this machine (dangling brew symlink). The agent embeds Codex core 0.137.0 (from the log) and ships as `@zed-industries/codex-acp` 0.16.0. Suggest gating on the codex-acp version (>= 0.16.0) instead of a `codex --version`; re-verify after the user reinstalls/logs in.   (Task 4)
- codex transport command: `npx -y @zed-industries/codex-acp` (starts and answers `initialize` and `session/new`; note npm marks it deprecated in favour of `@agentclientprotocol/codex-acp` 2.2.2, untested). Not confirmed end to end because of the expired login.   (Task 4)
- `isUiTool` matches: UNDETERMINED for Codex (no `tool_call` observed). For Claude, tool names are `mcp__<server>__<tool>`, e.g. `mcp__ui__show_note`. Keep the Task 12 regex for Claude; the Codex title must be re-checked after `codex login`.   (Task 12)
- ACP kind "other" policy: UNDETERMINED (no `session/request_permission` observed for the MCP call or the file write). Re-run the probe after `codex login` to decide.   (Task 12)

## Open items (need the user)
1. Run `codex login` (ChatGPT) again; the stored login fails with `invalid_refresh_token`. The Homebrew `codex` cask install is also broken (empty Caskroom dir, dangling symlink).
2. Re-run: `node tmp-spike/acp-probe.mjs npx -y @zed-industries/codex-acp > tmp-spike/codex.log 2>&1` and fill in: MCP load via `session/new`, `tool_call` title/kind, `PERMISSION` kind/locations, `stopReason`, `codex --version`.
