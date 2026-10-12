# Engines

An engine is an official AI command-line tool the person already pays for. Human Harness uses their subscription through that tool: no API keys.

## The registry

`packages/engines/src/index.ts` describes each engine: its legal status (`allowed`, `pending`, `excluded`) with the source and date, the plan it requires, where data goes, how to detect it (`detect.binary`, `versionArgs`, `minVersion`), its transport and its setup commands (`install`, `login`, `status`, `update`, `logout`). `availableEngines` keeps the harness's engines that are allowed, plus the pending ones in development.

## Two transports

- **Claude** (`packages/runtime/src/claude-cli.ts`): one `claude -p` process per turn with `--output-format stream-json`; the message goes in through stdin. A new session starts with `--session-id <uuid>`, later turns use `--resume`. Tools come from the manifest's permissions (`--allowedTools`, `--disallowedTools`), our MCP servers from `--mcp-config` with `--strict-mcp-config`, reference folders from `--add-dir` plus deny rules for edits there.
- **Codex** (`packages/runtime/src/acp.ts`): the bundled `codex-acp` adapter speaks the Agent Client Protocol. One long-lived process; `session/new`, `session/prompt`, `session/cancel`, `session/close`. Permission requests are answered from the manifest without asking the person.

## Getting an engine ready

Settings → Engine walks the steps in order; `engineProblem` (`packages/ui/src/client.ts`) picks the first one left from the status check (`detectEngine` in `packages/shell/src/main/engine-status.ts`): the legal notice, install (the official installer), update when below `minVersion`, sign in (the tool's own login, in the browser), and a tiny test prompt (`engine-check.ts`). The app finds the tool through the login shell's `PATH` (`engine-command.ts`); Codex runs from the copy bundled with the adapter. `~/.humanharness/engines.json` (`shared-config.ts`) keeps the accepted notice, the version and the last successful test, never credentials.

## Compliance

- Only the official tools, unmodified.
- The app never reads `~/.claude` or `~/.codex`, and never adds or removes authentication environment variables.
- `claude auth status --json` prints the account's email: the app reads only `loggedIn` from it.
