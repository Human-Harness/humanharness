# A turn end to end

A turn is one message from the person and the agent's complete answer. It crosses five pieces, each in its own package.

1. **Screen** (`packages/ui`): `ChatView` sends the message through the `HarnessClient` contract (`client.send`, or `client.choose` for an option of a `choices` block). The preload (`packages/shell/src/preload/index.ts`) turns each call into IPC.
2. **Main process** (`packages/shell/src/main`): the IPC handler (`index.ts`) passes it to the `TaskManager` (`task-manager.ts`), which decides whether it starts a task or follows up the current one and builds a new task's first message (`task-prompts.ts`). `TurnController` (`turn-controller.ts`) logs the message, starts the runtime if needed and runs the turn.
3. **Runtime** (`packages/runtime/src/runtime.ts`): saves the folder in the history, then runs the turn through the engine's transport. It opens a private local socket (the bridge) for blocks. It is a workspace with one slot (below).
4. **Engine tool**: `claude -p` or Codex through ACP. When the agent calls one of our tools, the `ui` MCP server (`packages/blocks/src/ui-server.ts`) checks it and forwards it over the bridge.
5. **Back as events** (`packages/runtime/src/events.ts`): `text`, `paragraph`, `activity`, `block`, `limits`, `usage`, `documents`, and exactly one `done`. `documents` comes right before `done`, only on a successful turn that added or changed `.md` files: one card per file, saved on the answer's chat entry (`ChatEntry.documents`; `docs/architecture/documents.md`). An `activity` start may carry `paths` (a Claude `Read`, `Grep` or `Glob`; a Codex read or search's `locations`; at most 4,096 characters each) and `tool` (`{ server, name }` for an MCP call, from `mcp__<server>__<tool>` or Codex's own marker) for the context panel (`docs/architecture/context.md`); the task manager records them, and `TurnController` strips both (`forWindow`) before an event reaches the window, so the window and the chat log never see an engine path. The main process sends each event to the window as it comes; at the end it saves the answer in `.harness/chats/main.jsonl` (`chat-log.ts`) and the tokens in `.harness/usage.jsonl` (`usage-log.ts`), then sends `done`.

## The workspace and its slots

Spec: `docs/superpowers/specs/2026-10-27-parallel-tasks-and-jobs-design.md` §4. Part 1 builds the split. A plain harness opens one slot; a harness that declares `parallel` opens one per open task (`parallel.md`).

- `createWorkspace` (`packages/runtime/src/workspace.ts`) sets up the folder once. It runs `prepareFolder`, writes the instructions, opens the `History`, commits "Start" and opens the folder's `TurnLedger`.
- `workspace.openSlot({ key, session, onSession, kind, permissions })` opens a `SessionSlot`. One slot runs one task's engine connection.
- `createRuntime` keeps its signature and its `HarnessRuntime` shape. It is a workspace with one slot, keyed `"main"`. The CLI's `humanharness run` and the shell use it unchanged.
- Slot keys are opaque to the runtime. Board mode keys task slots by task id. Job runs key their slots `job:<run id>` (`jobs.md`).
- One slot per task. Two windows of the same task would own each other's paths. A second turn of a task that already runs a turn throws "A turn of task X is already running".

| Shared, one per folder | Per slot |
|---|---|
| The folder, `prepareFolder`, `AGENTS.md` and its refresh | The transport (a Claude `-p` process per turn, or an ACP adapter process) |
| `History` and its one queue | The engine session |
| The `TurnLedger` of running turns | The block bridge (`openBridge`) |
| The `data` and `material` handlers | The data and material RPC sockets |
| The harness's MCP server specs | The current turn's `AbortController` |

**Per-slot sockets, shared handlers.**
- Each slot opens its own bridge and its own data and material sockets.
- Every socket calls the workspace's one `data` or `material` handler, with the slot's `SlotRef` (`{ key }`).
- The socket decides the `SlotRef`. A request can't claim another slot's identity.
- The data write lock stays the `DataStore`'s one queue.

**A slot's calls.**
- `send` keeps today's contract: one turn at a time per slot, and "A turn is already running" per slot.
- `send` wraps the turn in `beginTurn` and `endTurn` (see `history.md`, "Parallel turns").
- `onAttribution` gets what an overlapped turn owned, shared and collided with. It is never called for a turn that ran alone.
- `endSession` ends the engine session. It refuses while a turn runs.
- `sleep()` closes an idle ACP adapter process and keeps the session id. The next turn reconnects and `session/load`s it. For Claude it does nothing. Board mode calls it after a task has waited 10 minutes, and before each turn on an engine held at one session.
- `close()` cancels a running turn, waits for it, and closes the transport and the sockets. It frees the slot's key.
- After `close()`, `send` and `endSession` throw "The slot is closed" and `sleep` does nothing. A closed ACP slot never reconnects.
- One slot's cancel or crash never touches another slot.

**Job slots.** `kind: "job"` sets `HH_JOB=1` on that slot's `ui` server. Its `permissions` go through `narrowPermissions`, so they only ever narrow the harness's. A task slot's specs are exactly today's.

**Instructions refresh.** `workspace.refreshInstructions()` returns false while any slot runs a turn. It checks again after reading the settings. Board mode then holds new turns for up to 10 s while it waits for a gap (`parallel.md`, "The gate and its queue").

**Edits on activity events.**
- An `activity` start event can carry `edits`: the paths the turn's edit tools named.
- Claude: the `file_path` of `Edit`, `Write` and `MultiEdit`, and the `notebook_path` of `NotebookEdit`.
- ACP: `locations` and the `diff` content's `path` of `edit`, `delete` and `move` calls. At most 50 paths per event.
- Both parsers drop a path longer than 4096 characters (`EDIT_PATH_MAX`).
- The slot passes them to `TurnLedger.noteEdits`. They are a hint, not a full list.
- `forWindow` (`packages/shell/src/main/turn-controller.ts`) strips `edits` before an event reaches the window. Any other event passes as is. The window's events are what they were.
- The chat log gets the raw event: the shell's `recorder.add` runs before `forWindow`. The log stays free of `edits` only because `TurnRecorder.add` (`packages/shell/src/main/chat-log.ts`) keeps just an activity's `kind` and `detail`.

## Turns the app starts

Not every turn starts with a message from the person. For a task with phases or a time box (`docs/architecture/phases.md`) the `TaskManager` starts two more kinds, both run turns of the task's session whose answer shows:

- `phase-change`: the task entered another part (the agent's `auto` move, the person's pick, the time box's move to the close part). Its message is the part's change prompt; the chat's user entry is the system line `— <label> —` (`ChatEntry.phase`).
- `wrap-up`: the time box is almost over. Its message is `WRAP_UP_PROMPT`; the chat's line is "Time is almost up" (`ChatEntry.timeUp`).

Input blocks get ids in these turns too, as in a run turn (`takesInputs` in `turn-controller.ts`). Before either turn's events, the main process sends `hh:taskTurn` (`client.onTaskTurn`, `{ task, kind, phase?, by?, back? }`) so the window draws the line and then the live turn; the window never draws a change itself. In `usage.jsonl` the turn's `phase` is `phase-change` or `wrap-up`, and every turn of a phased task carries `taskPhase`.

The context panel's "Add now" (`docs/architecture/context.md`) starts a third kind, in any task: `context-add`, a run turn of the open task's session with `CONTEXT_ADD_PROMPT` as its message. It waits behind a running turn, never cancels it, and runs like a follow-up (a due checkpoint first, kept lines with it). The main process first sends `hh:taskTurn` with `kind: "context"` and `path`; the chat's user entry is "Take <path> into account" (stored in English). Its input blocks get no ids (`takesInputs` leaves it out). In `usage.jsonl` its `phase` is `context-add`.

## When it goes wrong

- `done` carries an error code (`engine-not-installed`, `session-expired`, `out-of-quota`, `agent-crashed`, `cancelled`, `outdated-version`, `notice-required`); the screen shows a card with a way to fix it (`packages/ui/src/ErrorCard.tsx`).
- If the agent crashes mid-turn, the runtime puts the folder back as it was before the message. A turn that overlapped another puts back only its own paths (`history.md`, "Parallel turns").
- Stop cancels the turn: Claude's process group gets SIGTERM, then SIGKILL after 3 seconds; Codex gets `session/cancel`.
