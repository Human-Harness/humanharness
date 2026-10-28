# File timeline — design

Status: implemented (plan docs/superpowers/plans/2026-10-28-file-timeline.md). Approved by Marco on 2026-10-27, with four fixes from his review (§3.1 subject before trailer, §3.4 linked folders, §5 history queue and core-owned confirmation) and the open questions decided (§11).

This is spec C from the dev-vs-core gap analysis (`docs/discovery/2026-10-26-dev-vs-core.md`, candidate C4). It builds on the history (`docs/architecture/history.md`) and the document reader (`2026-10-27-document-reader-design.md`). It refers to document review (`2026-10-27-document-review-and-focus-design.md`) for answers and approvals, and to parallel tasks (`2026-10-27-parallel-tasks-and-jobs-design.md`) for partial commits. Neither is required: without them, those entry kinds never appear.

## 1. Why

The history records every change, but only by task:

- The History panel lists tasks, with "N files changed" and their entries.
- Nothing answers "what happened to **this file**, and who did it?"
- "Go back here" and "Undo this task" reset every tracked file. There is no way to bring back one file as it was.

The dev harness asked for it (mockup v3, round 5): each `.md` has a timeline of its versions and edits, each with who made it (you, or which agent), and a version opens its diff. A writer comparing two drafts of a chapter, a teacher checking what the agent changed in a course plan, and a thinker going back to yesterday's version of an essay need the same thing.

## 2. Decisions (approved by Marco)

- **D1. One entry per task, plus milestones.**
  - All the turns of one task that changed the file form one entry, which expands into its turns.
  - The person's answers, approvals, changes made outside the app and go-backs get entries of their own.
  - Approvals are numbered as versions: v1, v2…
- **D2. Every tracked file has a timeline.**
  - `.md` files get a diff of the rendered text, word by word.
  - Other text files get a line diff.
  - Binary files show only their entries.
- **D3. One file can go back to a version.** It is restored alone, with a commit of its own, so it can be undone.
- **D4. The diff is inline by default,** with a side-by-side toggle, and compares either "what changed here" or "against the current version". (D4 comes from the dev's round 5. Its default and the two compare modes are Claude's, accepted in the design review.)

## 3. Entries

### 3.1 Kinds and authors

`History.fileTimeline(path)` reads the commits that changed `path` and groups them, newest first:

| Kind | From | Author shown | Label |
|---|---|---|---|
| `task` | Consecutive commits with the same `Task:` trailer (turns, notes, data writes) | The action's label ("Spec writer"), "Una pregunta" for a free question, the job's label for a `Job:` commit | "3 cambios" |
| `answers` | Consecutive `Answer: <path>` commits (review spec §5.1) | "Vos" | "Tus respuestas (2)", plus "sin aprobar" until an approval follows |
| `approval` | `Approved: <path>` (review spec §5.4) | "Vos" | "v2 aprobada", plus ", con motivo" when it has one |
| `outside` | An untagged "Start" commit that changed the file | "Fuera de la app" | "Cambiado fuera de la app" |
| `goBack` | A restore commit ("Go back to …", "Undo: …", and `Go back: <path>` of §5) | "Vos" | "Volviste a v2" / "Volviste a lo de las 10:41" |

- **Subject before trailer.** A commit whose subject starts with `Answer:`, `Approved:`, `Go back`, `Undo:` or is a restore is classified by its subject, even when it carries a `Task:` trailer. Only the remaining commits group by `Task:`.
- **Same task, not adjacent.** A task's commits split by another entry (an answer in between) form two entries: the timeline is in time order.
- **Partial commits.** With parallel tasks, each commit holds only its task's paths (parallel spec §5.2), so authors stay right with no extra work. Shared paths show both tasks on the entry: "Spec writer + Planner".
- **Deleted file.** The last entry says "Borrado" and keeps "Volver a esta versión" on the entry before it.

### 3.2 Shape

```ts
type TimelineEntry = {
  kind: "task" | "answers" | "approval" | "outside" | "goBack";
  author: { kind: "agent" | "person" | "outside"; label: string; task?: string; action?: string; job?: string };
  label: string;
  at: string;                 // time of its last commit
  from: string;               // commit before the entry (the file's previous state)
  to: string;                 // its last commit
  version?: number;           // approvals only: 1, 2…
  unapproved?: boolean;       // answers only
  commits: { id: string; subject: string; at: string }[];   // the turns, for expanding
};
```

### 3.3 Cache

Walking the whole log for each file would get slow on a long history. Instead, the app keeps a per-file index in the app's data folder, next to the history (`historyDir`): `file-index.json`, mapping each path to its commit ids.

- It is updated on every commit, from the commit's changed paths, which the history already computes.
- It is rebuilt from scratch when missing, or when its last commit id is not in the history (after a move that set a history aside).
- It is not a source of truth: losing it costs only a rebuild.

### 3.4 Not covered

- **Renames are not detected.** A moved file starts a new timeline. The old path's timeline ends with "Borrado".
- **Linked folders** (hatches spec §3.4). A file in a tracked linked folder reads that folder's own `History` and index. A file in a linked folder with its own git shows "Esta carpeta tiene su propio git: mirá su historial ahí".
- **Files the history skips** (`.harness/` except notes, data and reviews; the generated `AGENTS.md`) show "Este archivo no tiene historial".

## 4. The diff

### 4.1 Compare modes

- **"Qué cambió acá"** (default): the entry's `from` against its `to`.
- **"Contra la versión actual"**: the entry's `to` against the working file.

### 4.2 By file type

- **`.md`**, rendered:
  1. Both texts are parsed with the reader's pipeline (remark + GFM).
  2. Top-level blocks (paragraphs, headings, list items, table rows, code and Mermaid fences, callouts) are aligned with a sequence diff on their text.
  3. Inside each changed block, the text is diffed word by word.
  4. The result is drawn with the reader's renderer, with `ins` (green, underlined) and `del` (red, struck through) marks. Whole added or removed blocks get a bar in the margin.
  5. A Mermaid fence that changed shows both diagrams, before and after, with the line diff of its source under a "Fuente" toggle.
- **"Fuente" toggle**, for `.md`: the line diff of the raw text.
- **Other text files**: a line diff with line numbers, in a monospace face. Syntax highlighting is used when the reader's highlighter knows the extension.
- **Binary files** (a NUL byte in the first 8 KB, or a known binary extension): "Binario, sin vista previa", with both sizes.
- **Large files**: as in the reader, only the first 200 KB of each side is diffed, with a notice.

### 4.3 Layout

- **Inline:** one column; deleted text struck through before added text.
- **Side by side:** two columns, before | after, with changed blocks kept level. Below about 900 px it falls back to inline.
- **"Sin cambios"** when both sides are equal (for example, against the current version right after a go-back).

The diff library is `diff` (jsdiff): `diffArrays` for blocks, `diffWordsWithSpace` inside them, `diffLines` for sources. The plan confirms the choice.

## 5. Going back

- **"Volver a esta versión"** on an entry writes the file as it was at the entry's `to`, and nothing else.
- It commits `Go back: <path> to <entry label>`, with no task trailer, like today's restores (history.md: a restore is not part of a task). It is itself an entry (`goBack`), so it can be undone the same way. The commit goes through the history's single queue (parallel-tasks spec §5.1).
- **It asks first**: "Volver `spec.md` a como estaba después de Spec writer (hace 20 min). El resto de la carpeta no cambia."
- **Refused while a running turn has touched the file,** with a line saying which task (parallel spec §5.3). With one task at a time, it is refused while a turn runs, as today's restores are.
- **A reviewed document** goes stale after a go-back, like any change (review spec D4). Review records are not restored by a file go-back: the comments stay, and their anchors are matched again.
- **A deleted file** comes back from the entry before "Borrado". Its parent folders are created when missing, with the same link checks as today's restore (history.md, symlinks).

## 6. UI

### 6.1 In the reader

- **A "Historial" button** in the reader's header bar opens the timeline in a drawer beside the document.
- **Each entry** shows its author, label and time, with chips: "sin aprobar" (amber), "v2 aprobada" (green), "Fuera de la app" (grey). An entry expands into its turns.
- **Picking an entry** shows its diff in the document column, with the compare-mode switch, the inline/side-by-side toggle, "Volver a esta versión", and "Volver al documento".
- **Focus mode** (review spec §6.2) hides the drawer, and the button stays reachable.

### 6.2 In the History panel

The changed files listed under each task become links. A link opens that file's timeline:
- for `.md`, in the reader with the drawer open;
- otherwise, in a timeline panel with the same diff view (no rendered document).

### 6.3 Harness client

```ts
client.files.timeline(path): Promise<TimelineEntry[]>
client.files.diff(path, from, to | "current"): Promise<FileDiff>    // blocks for .md, hunks for text, { binary: true } otherwise
client.files.restore(path, commit): Promise<"restored" | "cancelled"> // §5; the core always shows the confirmation itself
client.files.onChange(path, cb): Unsubscribe                         // a new entry for that file
```

The SDK exports `<FileTimeline path />` and `<FileDiff path from to />` with the core's look, so the dev harness can put them in its explorer and its bottom panel.

## 7. Edge cases

| Case | Behavior |
|---|---|
| No commits for the file yet (created and not yet committed) | "Todavía sin historial", until the turn ends |
| The cache is stale or missing | Rebuilt in the background; the timeline shows "Cargando historial…" |
| A history set aside after a move | Its commits are not in the timeline (history.md, known gaps) |
| A file changed by a turn that ended `agent-crashed` | The crash undo restores it; the timeline shows the task entry, then the `goBack` "Undo: the turn did not finish" |
| A path outside the person's folder | Refused, as in `hh:readDocument` |

## 8. Tests

- **Unit:**
  - grouping: a task entry, a task split by answers, answers with and without a later approval, approvals numbered, an outside change, every kind of go-back, a job, partial commits with a shared path;
  - the cache: incremental update, rebuild when missing, rebuild after a foreign history;
  - the `.md` diff: block alignment, word diff inside a block, a moved paragraph, a table row, a Mermaid change, the source toggle;
  - binary detection; large files;
  - go-back of one file; refusal while a running turn touched it; a deleted file back with its folders.
- **E2E (mock mode):**
  - open the timeline from the reader;
  - see what an agent changed;
  - go back to a version, then undo the go-back;
  - open a file's timeline from the History panel.

## 9. What this closes from the gap analysis

| Gap | How |
|---|---|
| C4 Timeline per file with author + diff | §3–§6 |
| Dev: versions and edits of the open md, who made each, a version opens its diff | `fileTimeline` + the reader drawer, or `<FileTimeline>` in the dev's explorer |
| Dev: md diff, inline or side by side; unapproved answers show as changes | §4; `answers` entries with `unapproved` |
| Review spec: "Ver qué cambió" after approval | Opens this diff, from the last approval to the current text, which replaces the review spec's simple line diff |

## 10. Delivery slices

1. **Timeline data.** `fileTimeline`, entry grouping and the cache.
2. **Diff.** Text, `.md` rendered and binary; both layouts.
3. **Reader drawer and History panel links.**
4. **Going back one file.**
5. **Client and SDK components.** `client.files`, `<FileTimeline>`, `<FileDiff>`; "Ver qué cambió" in the review spec switches to this diff.

## 11. Open questions

Decided by Marco on 2026-10-27, as proposed:

1. **Diff between two arbitrary entries** (v1 against v3). Not in v1; added when a harness asks, as `client.files.diff` already takes any two commits.
2. **Timeline for a folder.** Not now; the History panel's task view covers part of it.
3. **History size.** Revisited with the history's existing size gap (history.md, known gaps).
