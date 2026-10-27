# A turn end to end

A turn is one message from the person and the agent's complete answer. It crosses five pieces, each in its own package.

1. **Screen** (`packages/ui`): `ChatView` sends the message through the `HarnessClient` contract (`client.send`, or `client.choose` for an option of a `choices` block). The preload (`packages/shell/src/preload/index.ts`) turns each call into IPC.
2. **Main process** (`packages/shell/src/main`): the IPC handler (`index.ts`) passes it to the `TaskManager` (`task-manager.ts`), which decides whether it starts a task or follows up the current one and builds a new task's first message (`task-prompts.ts`). `TurnController` (`turn-controller.ts`) logs the message, starts the runtime if needed and runs the turn.
3. **Runtime** (`packages/runtime/src/runtime.ts`): saves the folder in the history, then runs the turn through the engine's transport. It opens a private local socket (the bridge) for blocks.
4. **Engine tool**: `claude -p` or Codex through ACP. When the agent calls one of our tools, the `ui` MCP server (`packages/blocks/src/ui-server.ts`) checks it and forwards it over the bridge.
5. **Back as events** (`packages/runtime/src/events.ts`): `text`, `paragraph`, `activity`, `block`, `limits`, `usage`, and exactly one `done`. The main process sends each event to the window as it comes; at the end it saves the answer in `.harness/chats/main.jsonl` (`chat-log.ts`) and the tokens in `.harness/usage.jsonl` (`usage-log.ts`), then sends `done`.

## Turns the app starts

Not every turn starts with a message from the person. For a task with phases or a time box (`docs/architecture/phases.md`) the `TaskManager` starts two more kinds, both run turns of the task's session whose answer shows:

- `phase-change`: the task entered another part (the agent's `auto` move, the person's pick, the time box's move to the close part). Its message is the part's change prompt; the chat's user entry is the system line `— <label> —` (`ChatEntry.phase`).
- `wrap-up`: the time box is almost over. Its message is `WRAP_UP_PROMPT`; the chat's line is "Time is almost up" (`ChatEntry.timeUp`).

Input blocks get ids in these turns too, as in a run turn (`takesInputs` in `turn-controller.ts`). Before either turn's events, the main process sends `hh:taskTurn` (`client.onTaskTurn`, `{ task, kind, phase?, by?, back? }`) so the window draws the line and then the live turn; the window never draws a change itself. In `usage.jsonl` the turn's `phase` is `phase-change` or `wrap-up`, and every turn of a phased task carries `taskPhase`.

## When it goes wrong

- `done` carries an error code (`engine-not-installed`, `session-expired`, `out-of-quota`, `agent-crashed`, `cancelled`, `outdated-version`, `notice-required`); the screen shows a card with a way to fix it (`packages/ui/src/ErrorCard.tsx`).
- If the agent crashes mid-turn, the runtime puts the folder back as it was before the message.
- Stop cancels the turn: Claude's process group gets SIGTERM, then SIGKILL after 3 seconds; Codex gets `session/cancel`.
