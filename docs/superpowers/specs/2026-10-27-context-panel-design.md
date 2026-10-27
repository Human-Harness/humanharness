# Context panel — design

Status: draft, 2026-10-27, written after a brainstorming session with Marco, who approved every decision below that day. Waiting for his review of this file. Not in the roadmap yet.

This is spec D from the dev-vs-core gap analysis (`docs/discovery/2026-10-26-dev-vs-core.md`, candidate C5). It builds on context and memory (`docs/architecture/context.md`) and on scopes and data (`docs/architecture/data.md`). It shares the `activity` paths of parallel tasks (`2026-10-27-parallel-tasks-and-jobs-design.md` §5.2) and respects its cap and queue. It does not need that spec to land first.

## 1. Why

Context management is one of the core's three pillars, but today the person cannot see it:

- The app builds each task's first message from the instructions, the brief, the notes indexes, the data tables and the material sheet (`task-prompts.ts`). None of that is shown.
- During the task, the agent opens files and notes on its own. The chat shows these as passing activity rows, with no summary.
- The context meter shows a percentage, not what fills it.
- To change what the agent knows, the person has to type it in the chat. "Always start from `conventions.md`" has to be repeated in every task, and a stale note ("we use Redux") keeps appearing in every index.

The dev harness wanted a "what the AI takes into account" panel per ticket (mockup v3, the "Este ticket" tab). Every harness has the same need: the student's formula sheet for a topic, the writer's style guide, the teacher's course outline.

## 2. Decisions (approved by Marco)

- **D1. The panel shows the start and what was read.**
  - "Al empezar" lists what the app loaded into the first message, each item with its approximate size.
  - "Durante la tarea" lists the files, notes and tools the agent used, from its tool events.
  - The context meter sits on top, and after a compaction the earlier items are marked as possibly summarized.
- **D2. Three actions.**
  - **Agregar ahora:** the open task is told to read something now.
  - **Fijar:** something enters the first message of every new task in the scope.
  - **Excluir:** a note leaves the notes index of new tasks in the scope, without being deleted.
- **D3. The panel never edits the running session's start.** Pinning and excluding apply from the next task, so the prompt cache of the open session stays valid (spec 3c). "Agregar ahora" covers the open task.

## 3. What the core records

### 3.1 At the start

When `task-prompts.ts` builds a task's first message, it also returns the list of what it put there. The list is stored with the task in `tasks.json`:

```ts
type ContextItem = {
  id: string;
  kind: "instructions" | "brief" | "notes-index" | "app-notes-index" | "data" | "material" | "pinned" | "pinned-title";
  label: string;              // "Instrucciones del harness", "Notas de Fracciones (6)", "Datos · tickets"
  path?: string;              // relative to the folder, when the item is a file
  tokens: number;             // estimate: characters / 4, rounded to 100
};
```

- `instructions` is `AGENTS.md` with its managed section: one item, even though the engine caches it.
- `brief` is the action's prompt. Mode and phase briefs are added when they are sent (task modes and phases specs), as `brief` items with the time they arrived.
- `data` gives one item per collection that has `context`, with the rows it actually loaded.
- `pinned` and `pinned-title` are explained in §4.2.
- **Totals.** The panel shows the sum of estimates. After the first turn, it also shows the real input tokens of that turn (from its `usage` event) as "Primer mensaje: 6.300 tokens reales".
- **A resumed task** (after a folder move) records its resume message the same way.

### 3.2 During the task

- `activity` events gain an optional `paths: string[]`. Parallel tasks adds it for edits (its §5.2); this spec fills it for reads too:
  - Claude: the `file_path` of `Read`, the `path` of `Grep` and `Glob`;
  - Codex: the `locations` of read tool calls.
- **Tools.** A harness MCP or engine MCP tool call is recorded by its server and tool name: "Consultó Atlassian · getJiraIssue".
- **Per task.** The main process keeps one entry per path or tool, with the time of the first use and a count: `{ kind: "read" | "tool", label, path?, firstAt, count }`. It lives in `tasks.json` with the task.
- **Not recorded:** the content read, and the tokens of each read. The engines do not report per-tool tokens, and an estimate would mislead.
- **Compaction.** When a compaction is detected (context.md, Checkpoints), items before it get `compacted: true`. The panel shows them faint, with "puede estar resumido".

## 4. Actions

### 4.1 Agregar ahora

- The person picks a file from the folder, a note or a document (a picker scoped to the person's folder).
- The open task gets a quiet turn: "The person wants you to take `<path>` into account. Read it now and say in one line what changes for this task."
- The turn follows the cap and the queue of parallel tasks, like any quiet turn.
- When the agent reads it, it shows up under "Durante la tarea", like any read.
- It works only on an open task that is not a job.

### 4.2 Fijar

- **Stored in** `.harness/context/<scope>.json`: `{ pinned: [{ path, at }], excluded: [{ note, at }] }`. Tracked by the history (it joins notes, data and reviews in the list of tracked `.harness/` folders), so undo covers it.
- **At the start of every new task in the scope,** pinned files are added after the notes index and the data tables, as "Pinned by the person:", each under its path.
- **Budget.** `context.pinnedTokens` in the manifest suggests a budget (default 3,000); the person changes it in Settings › Modelos, next to the context caps. Files enter in pin order until the budget is spent. The rest enter as their title and path only (`pinned-title`), and the agent opens them on demand, like older notes in the index (`buildNotesIndex`).
- **Allowed files:** files inside the person's folder only. A `folder.references` folder is refused too: the agent can already read those, and the pin would hide where the text came from.
- **App-wide pins.** With scopes, a pin can be for the scope or for `_app` (every task). Without scopes, the scope is `main`.

### 4.3 Excluir

- **What can be excluded:** a note listed in the scope's notes index, or in the app-wide one.
- **What it does:** the note is listed under `excluded`, and `buildNotesIndex` skips it for new tasks. The note file stays. The agent can still open it if something points to it.
- **"Volver a incluir"** in the panel's "Excluidas" section takes it off the list.
- **Data and material are not excludable here.** Their loading is the harness's design (`context` fields, the material spec). A harness that wants it can expose its own switch.

## 5. UI

### 5.1 The panel

- **Opening it.** The context meter in the task header becomes a button that opens the panel beside the chat, with the same width as the reader. On narrow windows it covers the chat, with "Cerrar".
- **Four sections:**
  1. "Al empezar": items with their sizes, the total, and the real first-message tokens.
  2. "Durante la tarea": reads and tools, newest first, with counts.
  3. "Fijado": the scope's and the app's pins, with what is over the budget marked "solo título".
  4. "Excluidas": excluded notes, each with "Volver a incluir".
- **"Agregar…"** at the top opens the picker, with two buttons: "Para esta tarea" (§4.1) and "Fijar en `<scope>`" (§4.2).
- **Each item opens:** a `.md` in the reader, a note in the reader, any other file in the file timeline view (file-timeline spec §6.2) when that spec is in.
- **Next to each note** in "Al empezar": "Excluir". Next to each file read: "Fijar".
- **Jobs.** A job run's panel is read-only and opens from its row in the inbox.

### 5.2 Harness client

```ts
client.context.get(taskId): TaskContext          // start items, reads, compaction flag, pins and exclusions of its scope
client.context.onChange(taskId, cb): Unsubscribe
client.context.add(taskId, path): Promise<void>  // §4.1
client.context.pin(scope | "_app", path): Promise<void>
client.context.unpin(scope | "_app", path): Promise<void>
client.context.exclude(scope | "_app", notePath): Promise<void>
client.context.include(scope | "_app", notePath): Promise<void>
```

The SDK exports `<ContextPanel taskId />` with the core's look, so the dev harness can put it in its "Este ticket" tab.

## 6. Edge cases

| Case | Behavior |
|---|---|
| A pinned file was deleted or moved | Skipped when the first message is built. The panel shows it struck through, with "Quitar" |
| Pinning a path outside the folder, or in a reference folder | Refused: "Solo archivos de tu carpeta" |
| Excluding a note the open task already has in its index | Nothing changes for that task. The panel says "Aplica desde la próxima tarea" |
| A pinned file is also read during the task | Listed in both sections; that is what happened |
| "Agregar ahora" on a waiting task while the cap is full | Queued, shown as "En espera" (parallel spec §7) |
| A pinned file over 1 MB | Never inlined: it enters as `pinned-title`, whatever the budget |
| Undo of a task that pinned or excluded something | The `.harness/context/` change is undone with the task |

## 7. Tests

- **Unit:**
  - the start items returned by `task-prompts.ts` for every kind, with estimates;
  - the real first-message total from `usage`;
  - reads from Claude and Codex events; tool calls; no duplicates; counts;
  - the compaction flag;
  - pins within and over the budget; the 1 MB rule; a deleted pin;
  - exclusion and inclusion in `buildNotesIndex`, for the scope and `_app`;
  - the quiet "agregar" turn, and its refusal on a job.
- **E2E (mock mode):**
  - open the panel from the meter;
  - add a file to the open task and see the read appear;
  - pin a file and find it in the next task's start;
  - exclude a note and see it missing from the next task's index.

## 8. What this closes from the gap analysis

| Gap | How |
|---|---|
| C5 "What the AI takes into account" + add/pin | §3–§5 |
| Dev: the "Este ticket" tab's context list | `<ContextPanel>` or `client.context` |
| Dev: project files every ticket should start from (`conventions.md`) | A pin in the project's scope |

## 9. Delivery slices

1. **Recording.** Start items from `task-prompts.ts`, read paths in both transports, tool calls, the compaction flag, storage in `tasks.json`.
2. **The panel.** The four sections, opening items, the meter as a button.
3. **Actions.** "Agregar ahora", pins with their budget, exclusions in `buildNotesIndex`, `.harness/context/` in the history.
4. **Client and SDK.** `client.context`, `<ContextPanel>`.
5. **Mock.** The fake agent's recordings report read paths, so the demo fills "Durante la tarea".

## 10. Open questions

1. **Per-item real tokens.** The engines report tokens per turn, not per item, so items show estimates. Proposal: keep estimates, labelled "aprox.", and show the real total only.
2. **Pin order.** Today pins enter in the order they were pinned. A drag to reorder may matter once a scope has many pins. Proposal: not in v1.
3. **The agent proposing pins.** At the end of a task, the agent could suggest "pin `conventions.md` for this project". Proposal: later, as a Sidekick purpose, not a core flow.
