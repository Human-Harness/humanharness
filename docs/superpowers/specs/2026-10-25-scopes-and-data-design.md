# Scopes and harness data — design

Status: draft, 2026-10-25, waiting for Marco's review. Not in the roadmap yet. Comes from the student-vs-core gap analysis (`docs/discovery/2026-10-25-student-vs-core.md`), which puts these two first, because most of the other gaps and the material processing spec (`2026-10-25-material-processing-design.md`) depend on them.

## 1. Why

- **Everything in the core is app-wide today.** Tasks, notes, the notes index, the chat and the action statuses. A harness whose work comes in units (the student's topics, the dev's projects) has nowhere to put "this belongs to topic X". So the agent would get every topic's notes in every session.
- **A harness cannot keep structured data.** A state-only block feeds the side panel and keeps nothing. A harness needs records: a concept map, flashcards, a profile, a tickets cache. Today it would have to make the agent edit JSON files by hand, with no schema, no checks and no clean undo.

Both are wheels every harness would reinvent.

## 2. Decisions (proposed)

- **D1. A scope is the core's unit of work.** It is declared by the harness (a topic, a project). Each scope groups its own tasks, notes, notes index, chat, action statuses, material and data.
- **D2. Harnesses without scopes keep working.** They get one implicit scope, `main`, and the folder layout stays as today.
- **D3. Data lives in collections declared in the manifest.** Each collection has a zod schema and a key. It can belong to a scope or to the whole app.
- **D4. Data is plain JSON in the folder and tracked by the history.**
  - Undo works on it.
  - "What changed in this task" comes from the history's per-task diff.
  - The data survives an engine switch.
- **D5. Every write is checked:** first against the schema, then against the harness's own rules. The agent writes only through tools that check. The harness UI writes through the client, which also checks.
- **D6. Data reaches the agent compactly.**
  - A collection declares which fields go into a task's first message, within a token budget.
  - The agent reads the rest on demand.
  - The person's profile is just an app-wide collection that is always loaded. This closes the "person-context file" gap with no extra feature.

## 3. Scopes

### 3.1 Manifest

```ts
scopes: {
  label: { es: "tema", en: "topic" },
  plural: { es: "temas", en: "topics" },
},
```

Without `scopes`, the app runs with the single scope `main` (D2).

### 3.2 Storage

```
.harness/scopes.json                    registry: [{ id, title, createdAt, archived }]
.harness/chats/<scope>.jsonl            one chat per scope (main.jsonl for "main")
.harness/notes/<scope>/<slug>.md        notes of the scope's tasks
.harness/notes/_app/<slug>.md           app-wide notes (tasks outside any scope)
.harness/data/<scope>/<collection>.json
.harness/data/_app/<collection>.json    app-wide collections
.harness/material/<scope>/              (material spec)
material/<scope>/                       visible originals (material spec)
```

- **Ids.** A scope id is a slug of its title (`fracciones`, `fracciones-2` when taken). It never changes: renaming changes only `title`.
- **Migration.** On first start with a harness that declares `scopes`, the existing notes and chat move into `main`, so nothing is lost.

### 3.3 Tasks inside a scope

- A task belongs to exactly one scope, or to `_app` for app-wide actions such as onboarding.
- Changing to a task in another scope closes the current task first, like picking another action does today.
- The action declares where it runs, with a new manifest key:
  - `scope: "required"` (default when scopes exist);
  - `scope: "none"` (runs in `_app`).
- Free questions run in the open scope.
- **Action statuses and the guided `path` are kept per scope.** Each topic walks its own path.
- **A new session gets the open scope's own context:**
  - the notes index of that scope only;
  - the app-wide notes index (`_app`), trimmed;
  - the loaded data (§4.4);
  - the material sheet (material spec).
- **History and usage.**
  - Commits get one more trailer, `Scope: <id>`, and the History panel can filter by scope.
  - `usage.jsonl` lines carry `scope`, so Settings › Uso can show cost per topic.

### 3.4 Client

- `HarnessClient.scopes`:
  - `list()`;
  - `create(title)`;
  - `rename(id, title)`;
  - `archive(id)` / `unarchive(id)`;
  - `open(id)`;
  - `current()`.
- `send(message, { action, scope })`: `scope` defaults to the open one.
- **Delete.** There is no delete in the first version, only archive. A deletion would go through the history, so it could be undone. That comes later if harnesses ask for it.

## 4. Harness data

### 4.1 Manifest

```ts
data: {
  concepts: {
    scoped: true,                       // one file per scope; false = app-wide
    key: "id",
    schema: z.object({
      id: z.string(), name: z.string(), prereqs: z.array(z.string()),
      state: z.enum(["unseen", "seen", "practising", "mastered", "review"]),
      evidence: z.array(z.object({ kind: z.string(), date: z.string(), detail: z.string() })),
    }),
    agent: "write",                     // "write" | "read" | "none"
    context: { fields: ["id", "name", "state"], tokens: 400 },
    rules: (next, prev, ctx) => …,      // optional, see 4.3
  },
  flashcards: { scoped: true, key: "id", schema: …, agent: "read", context: false },
  profile:    { scoped: false, single: true, schema: …, agent: "read", context: { fields: "all", tokens: 300 } },
}
```

- **`single: true`.** The collection holds one record, such as a profile or settings.
- **`agent`.** What the agent may do with the collection.
  - `read`: the person writes, the agent only reads. For example, the student's own flashcards, which the AI corrects through comments rather than rewriting them.
  - `none`: hidden from the agent.
- **`context`.** What goes into a task's first message (§4.4).
- **`check`** (plan 4a) validates every schema. The authoring guide asks about data in its "context" phase.

### 4.2 Storage

- **One JSON file per collection and scope.** The records are sorted by key, with 2-space indentation and one record per block, so history diffs stay readable.
- **The history tracks `.harness/data/`.** It is the only part of `.harness/` tracked besides notes.
- **Writes are atomic:** the app writes a temp file, then renames it. Writes are serialized in the main process.

### 4.3 Checks on every write

1. **Schema.** The record is parsed with the collection's zod schema. Invalid → refused, with the zod issues.
2. **Key.** The key must be present. A put either creates a record or replaces the one with that key.
3. **Harness rules** (optional). `rules(next, prev, ctx)` is a pure function with no I/O.
   - It returns `true` to accept, or a message to refuse. The message goes back to the agent as the tool's error.
   - `ctx` holds the task (action, scope), who writes (agent / person / app), and read access to the other collections.
   - Student example: "state can rise only when a new evidence entry justifies it".
4. **Permission.** An agent write to a collection marked `read` or `none` is refused.

### 4.4 How data reaches the agent

- **Loaded at task start.** Every collection with `context` adds a compact table of its `fields` to the first message, after the notes index. It is cut at `tokens`, keeping the records most related to the action first.
  - "Most related" means the records the harness's `context.order` picks, or the most recently changed when there is no order.
  - When rows are left out, the table says how many, so the agent knows there are more.
- **Fetched on demand.** A `data` MCP server sits next to `ui` when the manifest declares `data`. Its tools act on the task's scope by default:
  - `data_get(collection, key)`;
  - `data_query(collection, { where?, fields?, limit? })`, where `where` takes equality and `in` only;
  - `data_put(collection, record)`;
  - `data_patch(collection, key, patch)`;
  - `data_delete(collection, key)`.

  The write tools are only offered for collections marked `agent: "write"`.
- **Pre-filled before closing.** The checkpoint and the closing turn are unchanged. Data is already saved as it is written, so the note only needs the decisions.

### 4.5 The harness UI

- **Calls.**
  - `HarnessClient.data`: `get`, `query`, `put`, `patch` and `delete`. They take the same arguments and go through the same checks, with `who: "person"`.
  - `subscribe(collection, scope, listener)` → a `data-change` event on every write, from any writer.
- **What the harness builds on it** (student examples):
  - the home "Para hoy" (deterministic, from `concepts` and `flashcards`);
  - the map;
  - the evidence panel during a session;
  - "what changed in this session". `historyTasks()` already gives the task's file diff, and the client adds `dataDiff(taskId)`, which parses the JSON diff into records added, changed and removed.

## 5. What this closes from the gap analysis

| Gap | How |
|---|---|
| #4 Topics, #17 free questions inside a topic | Scopes |
| #3b Person-context file | An app-wide `single` collection with `context` |
| #6 Concept map, #7 evidence rules | A collection + `rules` |
| #12 Open questions | A collection, or the scope's notes |
| #13 What changed in the session | History + `dataDiff` |
| #14 Home, #15 flashcards and scheduler | The harness's logic over the client API |
| Material: scope id and the `items` file | `material.items` names a collection instead of a file path |

Still open after this spec: profiles (several people), harness settings, task modes, input blocks, phases and time box, and harness setup steps.

## 6. Delivery slices

1. **Scopes.**
   - Registry and client.
   - Per-scope chats, notes, notes index, action statuses and path.
   - `Scope:` trailer, `usage.jsonl` field, migration into `main`.
2. **Data store.**
   - Manifest field, storage, schema and permission checks.
   - The client API with `subscribe`.
   - History tracking.
3. **Agent access.**
   - The `data` MCP server.
   - Context loading with budgets.
   - `rules`.
   - `dataDiff`.

## 7. Open questions

1. ~~Profiles.~~ Settled by `2026-10-25-profiles-design.md`. A profile is a level above scopes, with one sub-folder per person. Every path in §3.2 and §4.2 is relative to the active profile's folder: the folder root when the harness has no profiles. The name `settings` is reserved for the harness-settings collection (`2026-10-25-harness-settings-design.md`).
2. **Big collections.** One JSON file per collection is fine for hundreds of records. Thousands (a large ticket cache) may need JSONL or one file per record. Measure with the dev harness.
3. **Can a person edit data by hand in the folder?** It is plain JSON in `.harness/`. The app should re-read the file and re-check it on change, and say so when a hand edit breaks the schema.
4. **`rules` runs harness code in the main process.** It is the harness's own app, so this is trusted. Keep it a pure function (no I/O, no imports beyond the manifest) and time-box it.
