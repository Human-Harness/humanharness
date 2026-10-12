# Flow and context management — design

Status: draft for review · 2026-10-12
Parent spec: `2026-10-10-humanharness-core-design.md`
Mockups: "Plan 3 · Explicador" page of the mockup canvas

## 1. Why

Every Human Harness stands on three pillars:

1. **Decision UI.** The interface helps the user decide: options, criteria, confirmation at key points.
2. **Agentic flow.** Underneath, a flow steers the AI toward the goal the user picked.
3. **Context management.** Spend fewer tokens, and never lose a key decision.

The core shipped through plan 2b has blocks (part of pillar 1), but no flow and no context strategy. Today a harness is one long chat that grows until the CLI compacts it. Switching engines archives that chat, and everything in it is lost to the new engine.

This spec adds pillars 2 and 3 to the core as generic pieces. It also replaces the notes-chat demo with an architecture explainer that exercises them.

## 2. What the CLIs let us control

Checked on 2026-10-12 against Claude Code 2.1.296 (`claude --help`) and the `@agentclientprotocol/codex-acp@2.2.2` source.

| Control | Claude (`claude -p`) | Codex (ACP) |
|---|---|---|
| Base instructions | `--system-prompt`, `--append-system-prompt` | `AGENTS.md` in the working folder only |
| Tools | `--tools`, `--allowedTools`, `--disallowedTools` | Permission policy (already in the runtime) |
| Our own MCP tools | `--mcp-config` + `--strict-mcp-config` | `mcpServers` on `session/new` / `session/load` |
| Sessions | `--session-id`, `--resume`, `--fork-session`, `--no-session-persistence` | `session/new`, `load`, `resume`, `fork`, `close`, `delete` |
| Compaction | Automatic, `--autocompact` sets the window. `/compact` under `-p` is unverified | `/compact` prompt command (`runCompact`) |
| Structured output | `--json-schema` | None; we use MCP blocks |
| Model and effort | `--model`, `--effort` | `session/set_model`, `session/set_config_option` |
| Usage per turn | The `result` event | `usage_update` |
| Edit a session's history | No. It lives in `~/.claude`, and our compliance rules forbid reading it | No. Same with `~/.codex` |

`--bare` is not an option: it accepts only API-key auth, and Human Harness uses the user's subscription.

**Consequence:**
- We control what enters a session (instructions, tools, the first message) and when a session starts and ends.
- We do not control what happens inside a session.
- So **long-term memory belongs to the harness and short-term memory belongs to the CLI.**
- The strategy below only relies on what both engines share: an instructions file, MCP tools, new or resumed sessions, and compaction.

## 3. Decisions

| # | Decision | Alternatives rejected |
|---|---|---|
| D1 | **One engine session per task.** A task is one topic or unit of work. Finishing it closes the session; the next task starts a fresh one. | One long session that the CLI compacts: unpredictable cost, and the history is lost on an engine switch |
| D2 | **The app drives the flow.** The manifest declares the tasks. The app builds each task's prompt, enables its tools and moves between tasks based on what the user picks. The AI carries out a task but does not choose the next one. | The AI decides when to move on: drifts, cost cannot be predicted |
| D3 | **The harness owns long-term memory.** When a task closes, the agent saves a structured note through a core MCP tool. The app writes it to `<folder>/.harness/notes/`. | Rely on the CLI session history: we cannot read or edit it, and it is tied to one engine |
| D4 | **New sessions start small:** the stable instructions, a short index of notes and decisions, and the request. The agent reads a full note only when it needs it. | Paste every note into each session |
| D5 | **The demo is an architecture explainer for developers.** It reads the Human Harness repo read-only. It is never signed or distributed to end users. | Notes chat, decision helper, project planner, trip planner, harness creator (kept as a future option), inspector panel (not now) |

## 4. Flow: tasks

### 4.1 Manifest

`actions` (added in plan 2b with cost hints and pre-flight warnings) grow into tasks. Each action keeps `label` and `cost` and gains a prompt:

```ts
actions: {
  turn: {
    label: { es: "Un turno de punta a punta", en: "A turn end to end" },
    description: { es: "Desde que escribís hasta que aparece la respuesta.", en: "From typing to the answer on screen." },
    prompt: "./agent/tasks/turn.md",   // task brief sent as the session's first message
    cost: "medium",
  },
  // …
},
path: ["manifest", "engines", "turn", "blocks", "context", "history"], // optional guided order ("Recorrido")
```

Rules:
- `prompt` is a file in the harness folder, resolved with `resolveInHarness`. It may use `{{language}}` and `{{notesIndex}}`. The app fills both.
- `path` lists action ids in order. It is optional; without it the screen shows the actions as plain buttons.
- A free question typed in the composer is an implicit task with a core prompt: "answer this question; the notes index is below."

### 4.2 Task lifecycle (app state machine)

```
idle ──pick action / ask──▶ running ──turn ends──▶ waiting
waiting ──user follows up (same task)──▶ running        (same session)
waiting ──user picks "next" / another action──▶ closing ──note saved──▶ idle → next task
closing ──note not saved after one turn──▶ idle          (task marked "unsaved"; the user can retry)
```

- **running:** The task's session runs turns, as today (`turn-controller.ts`).
- **waiting:** The agent ends each answer with a `choices` block (§4.3). Options marked `followUp` stay in the session. Options that point at an action, or `next`, end the task.
- **closing:** The app sends one last turn in the same session, a fixed core prompt asking the agent to call `save_note`. The cost is light because the context is already cached. Then the app drops the session:
  - Claude: never resumes it;
  - Codex: `session/close`.
- **Interruptions:** Cancel, engine switch and app quit while running or waiting all close the task **without** a note and mark it "unfinished". The index shows it, so the user can resume it later, and resuming starts a new session.

The task state lives in `<folder>/.harness/tasks.json`: current task, session id, status per action. This replaces today's single `session.json`.

### 4.3 Core blocks

Every harness gets these core blocks automatically, listed in the managed section of `AGENTS.md`:

| Block | Visible | Purpose |
|---|---|---|
| `choices` | yes | Ask the user to pick one option. Each option is `{ label, followUp?: string, action?: string, next?: true }`. The app turns a pick into a transition. |
| `save_note` | no | Close a task: `{ title, summary: string[] (≤5), decisions: string[], files: string[], open: string[] }`. The app validates it and writes the note. The agent never writes into `.harness/` itself, so this works with `edit: "none"`. |

The demo adds its own visible blocks: `diagram` (nodes and edges, rendered as a simple flow) and `files` (paths with a one-line role and an "Open" button that opens the file in the user's editor through the shell).

## 5. Context management

### 5.1 Notes

Each note is `<folder>/.harness/notes/<action-or-slug>.md`:

```md
---
title: A turn end to end
action: turn
date: 2026-10-12T11:20:00Z
engine: claude
files: [packages/runtime/src/runtime.ts, packages/runtime/src/claude-cli.ts]
---
## Summary
- …
## Decisions
- …
## Open questions
- …
```

- The format is plain Markdown, so the user and git can read it.
- Writes are atomic, and the history commit already covers the folder.
- Notes do not depend on the engine and survive engine switches.

### 5.2 Notes index

The app builds the index from the notes' front matter and summaries. Each new session's first message contains:

```
## What we already covered
- A turn end to end (turn): ui → shell → runtime → CLI; events come back… → .harness/notes/turn.md
## Decisions so far
- …
```

- The budget is about 1,500 tokens, estimated as characters / 4.
- Past the budget, the oldest notes keep only their title and path.
- The agent is told it may open a note with Read when it needs details.

### 5.3 Token savings

- **Stable prefix.** `AGENTS.md` does not change between sessions. The index goes into the first user message, not the instructions, so the engine can reuse the cached prefix.
- **Small sessions.** A task session starts at instructions + index + brief instead of the whole conversation so far.
- **Bounded reading.** Task briefs set a reading budget ("read at most ~8 files; start from `docs/architecture/`").
- **Fallback.** Inside a long task, the CLI's own compaction still applies. We do not drive it.
- **Measured, not claimed.** `usage.jsonl` gains `task` and `phase` (`run` | `close`). The "≈2 k vs ~40 k tokens" line in the mockup is shown only once real numbers from `usage.jsonl` back it up. Until then it reads "starts from your summaries instead of re-reading the code".

### 5.4 Engine switch

The chat is still archived. The task state resets to idle, and the notes stay. The next task on the new engine receives the same index, so the decisions carry over.

## 6. Demo: architecture explainer

- **Audience:** developers who clone the repo. It runs in dev; there is no signed release, so the distribution legal gate does not apply.
- **Folder:** the user's own folder, which holds the notes. The default is `Documents/Human Harness Demo`. `AGENTS.md` is written there, never into the repo.
- **Source to explain:** a read-only **reference folder**, defaulting to the repo the app runs from.
  - New manifest field `folder.references: [{ id, label, default: "app-source" | string }]`.
  - Claude gets `--add-dir <path>` with Read/Glob/Grep only.
  - Codex reads it through its read-only sandbox (spike S2).
- **Permissions:** `{ edit: "none", exec: false, web: false }`.
- **Actions** (path order): manifest, engines, turn, blocks, context, history. Each brief points first at a curated doc under `docs/architecture/` and then at the code.
- **Curated docs:** `docs/architecture/*.md`, one per topic, short. They anchor answers and limit reading. Each answer's `files` block lets the developer check the claim.
- **Screens:** see the mockups.
  - Topic cards plus the "Recorrido" side panel.
  - Answer with `diagram`, `files` and `choices`.
  - The "Lo que quedó claro" panel lists notes, with "Retomar este tema" (resume) and "Abrir el archivo" (open).

## 7. Spikes before the plan

| # | Question | Why it matters |
|---|---|---|
| S1 | Does `--add-dir` make Claude load the reference folder's `CLAUDE.md`, given `--setting-sources project`? | The repo's own `CLAUDE.md` would leak into the explainer's instructions |
| S2 | Can Codex read a folder outside `cwd` under the read-only sandbox, and does ACP accept extra directories? | The reference folder on Codex |
| S3 | Does `/compact` work under `claude -p --resume`? | Optional; only if a manual compaction step turns out to be needed |
| S4 | Is the prompt-cache hit measurable? Does `cache_read_input_tokens` rise on the second session with the same `AGENTS.md`? | Proves the stable-prefix claim |

## 8. Testing

- **Unit:**
  - task state machine (every transition, including interruptions);
  - `save_note` validation and the note writer;
  - index builder (budget, truncation);
  - prompt template filling;
  - manifest schema (`actions.prompt`, `path`, `folder.references`).
- **Runtime:** fake-agent scripts that call `choices` and `save_note`. Claude args include `--add-dir` only for references.
- **E2E (Playwright + fake-agent):**
  - pick a topic → answer with blocks → "next" → note written → second task's first message contains the index;
  - an engine switch keeps the notes.

## 9. Out of scope

- Inspector panel.
- Harness creator demo.
- Plan tiers in Settings → Usage: moved to a later plan.
- Editing notes in the UI: notes are files, and "Abrir el archivo" opens them.
- Any specific harness (Socrates, Ariadna).
