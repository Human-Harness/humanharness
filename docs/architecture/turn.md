# A turn end to end

A turn is one message from the person and the agent's complete answer. It crosses five pieces, each in its own package.

1. **Screen** (`packages/ui`): `ChatView` sends the message through the `HarnessClient` contract (`client.send`, or `client.choose` for an option of a `choices` block). The preload (`packages/shell/src/preload/index.ts`) turns each call into IPC.
2. **Main process** (`packages/shell/src/main`): the IPC handler (`index.ts`) passes it to the `TaskManager` (`task-manager.ts`), which decides whether it starts a task or follows up the current one and builds a new task's first message (`task-prompts.ts`). `TurnController` (`turn-controller.ts`) logs the message, starts the runtime if needed and runs the turn.
3. **Runtime** (`packages/runtime/src/runtime.ts`): saves the folder in the history, then runs the turn through the engine's transport. It opens a private local socket (the bridge) for blocks.
4. **Engine tool**: `claude -p` or Codex through ACP. When the agent calls one of our tools, the `ui` MCP server (`packages/blocks/src/ui-server.ts`) checks it and forwards it over the bridge.
5. **Back as events** (`packages/runtime/src/events.ts`): `text`, `paragraph`, `activity`, `block`, `limits`, `usage`, and exactly one `done`. The main process sends each event to the window as it comes; at the end it saves the answer in `.harness/chats/main.jsonl` (`chat-log.ts`) and the tokens in `.harness/usage.jsonl` (`usage-log.ts`), then sends `done`.

## When it goes wrong

- `done` carries an error code (`engine-not-installed`, `session-expired`, `out-of-quota`, `agent-crashed`, `cancelled`, `outdated-version`, `notice-required`); the screen shows a card with a way to fix it (`packages/ui/src/ErrorCard.tsx`).
- If the agent crashes mid-turn, the runtime puts the folder back as it was before the message.
- Stop cancels the turn: Claude's process group gets SIGTERM, then SIGKILL after 3 seconds; Codex gets `session/cancel`.
