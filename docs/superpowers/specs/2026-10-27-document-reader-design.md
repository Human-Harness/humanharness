# Document reader — design

Status: approved by Marco on 2026-10-27, section by section. Not in the roadmap yet. Comes from the dev harness: its user works mostly by reading `.md` files (context, decisions, analyses). Mockup, approved as the look: https://claude.ai/artifact/L1DxW1KuL6LbCy4i93z3zp.

It is the base layer under three core features from the dev gap analysis (`docs/discovery/2026-10-26-dev-vs-core.md`, on the discovery branch): C2 (reviewable document), C3 (focus mode) and C4 (timeline per file). Those get their own specs and build on this one. This spec only covers reading well.

## 1. Why

Today:

- **The renderer is a chat-only subset.** `packages/ui/src/markdown.tsx` draws paragraphs, lists, inline code, bold, italics and fenced code. It has no tables and no diagrams. Headings are bold lines and links can't be clicked.
- **There is no document view.** A `.md` the agent writes into the person's folder can only be read outside the app.
- **Agents format as they like.** Nothing tells them when a table, a diagram or a short summary helps the reader, so each harness repeats that advice in its own instructions, or nobody gives it.

A dev-harness user reads an architecture analysis, an ADR and a plan for every ticket. Writer, teacher, thinker and student also produce documents. Reading them well is a core job.

## 2. Decisions

- **D1. One rich renderer**, shared by the chat and the reader: `remark` + `remark-gfm`, turned into React elements. No raw HTML, ever.
- **D2. Diagrams are Mermaid only.** Models write it well, and the same `.md` renders on GitHub. It is drawn locally in strict mode.
- **D3. A core document reader** opens as a panel beside the chat, with a full-screen option. It is reached from cards in the chat, from `.md` links, and from `client.openDocument(path)`.
- **D4. Two-layer format contract for agents.** The core always adds a base writing guide to the managed section of `AGENTS.md`. On top of it, a harness may declare **document kinds**, each with a template of required sections.
- **D5. The template check only warns.** A missing section or an unknown kind is shown; nothing is refused.

## 3. The renderer

### 3.1 Pipeline

`remark-parse` + `remark-gfm` → mdast → hast → React, with no raw-HTML step. HTML in the source stays visible as text, as today. The plan picks the exact packages (for example `mdast-util-to-hast` and `hast-util-to-jsx-runtime`). It replaces `packages/ui/src/markdown.tsx` and keeps its exported `markdownToPlain`, which the chat uses for its screen-reader announcement.

### 3.2 What it draws

| Element | How it shows |
|---|---|
| Headings `#` to `####` | Real headings with a clear scale, each with an anchor id (slug of its text, deduplicated) |
| GFM tables | Soft borders and a sticky header. A wide table scrolls inside its own box. Columns aligned with `--:` are right-aligned with tabular numbers |
| ```` ```mermaid ```` | A drawn diagram in the app's colors, light and dark (§3.3). A "Source" toggle shows the code |
| Callouts `> [!NOTE]`, `[!TIP]`, `[!WARNING]`, `[!SUMMARY]`, `[!DECISION]`, `[!QUESTION]` | A tinted box with an icon and a label. The first three are GitHub's. The last three are the core's own, and the set is fixed |
| Fenced code | Syntax highlighting for a fixed set of common languages (a light highlighter, chosen by the plan), the file or language label, and a Copy button |
| Inline code, bold, italics, strikethrough | As usual |
| Links | Clickable (§3.4) |
| Task lists | Read-only checkboxes |
| Footnotes | Listed at the end, with links there and back |
| Images | Only local files inside the person's folder or a reference folder. A remote image shows as a link with its domain |
| Front-matter | Never shown as text. `title` and `kind` feed the reader's header (§5.2) |

An italic paragraph right after a diagram or a table is styled as its caption.

### 3.3 Mermaid

- It is loaded lazily, the first time a diagram appears, so a chat without diagrams pays nothing.
- It uses `securityLevel: "strict"`, with no HTML labels and no click handlers.
- The theme variables come from the app's tokens, and the diagram is drawn again when the theme changes.
- **While a message is streaming**, an unclosed fence shows its source. It is drawn once the fence closes.
- **A diagram that fails to parse** shows its source with one line above it: "This diagram could not be drawn (line 3: …). Showing its source." The page never breaks.

### 3.4 Links

- Relative `.md` (`adr-007.md`, `../notes/x.md#context`) → opens in the reader, at the anchor if there is one.
- `#anchor` → scrolls within the document.
- External `http(s)` → the system browser, through the main process. The domain is always shown next to the link text.
- Any other scheme (`file:`, `javascript:` and so on) → plain text.

## 4. The format contract

### 4.1 Base guide (always)

The core adds a "Writing for the reader" part to the managed section of `AGENTS.md` (`packages/workspace/src/instructions.ts`). It is in English and about 40 lines long, and it says:

- **Structure.** One idea per section. `##` for sections, `###` for subsections, never skip a level. Paragraphs of two to four sentences.
- **Summary first.** Any document longer than about 300 words starts with `> [!SUMMARY]` holding the conclusion.
- **Pick the element by the content:**
  - two or more options compared on two or more criteria → a table;
  - a flow, a sequence, states or components → Mermaid, with a one-line italic caption;
  - a decision → `[!DECISION]`, with the reason;
  - a question for the person → `[!QUESTION]`;
  - a risk → `[!WARNING]`;
  - pending steps → a task list.
- **Limits.** Tables up to about six columns; split them or use a list beyond that. Diagrams up to about 15 nodes; split them beyond that. No raw HTML. Relative links between documents.
- **Front-matter.** `title` always, and `kind` when the harness declares kinds.

The guide lists the six callouts and nothing else.

### 4.2 Document kinds (per harness, optional)

```ts
documents: {
  kinds: {
    adr: {
      when: "A decision with real alternatives.",
      sections: ["Status", "Context", "Decision", "Alternatives considered", "Consequences"],
      status: ["proposed", "accepted", "superseded"],
    },
    analysis: {
      when: "Exploring options before deciding.",
      sections: ["Context", "Options", "Comparison", "Recommendation", "Risks"],
    },
  },
}
```

- `kinds` keys are lowercase ids (`/^[a-z][a-z0-9-]*$/`). `when` is one sentence. `sections` is a non-empty list of `##` headings, in order. `status` is optional.
- The managed section lists each kind: its id, `when`, and its template, written as the front-matter plus the headings in order.
- A harness without `documents` gets only the base guide.

### 4.3 Template check

The check runs in the renderer whenever a document is shown, and it never blocks anything:

| Case | Shown |
|---|---|
| A required `##` section is missing (matched without case, trimmed) | A note at the bottom of the reader's table of contents: "Template **analysis**: missing section **Risks**." |
| `kind` is not declared by the harness | A grey chip, "unknown kind" |
| `status` is not in the kind's list | A warning next to the status chip |
| No `kind`, or the harness declares no kinds | No check |

Sections in a different order are fine. Extra sections are fine.

## 5. The reader

### 5.1 Where it opens

- **Cards in the chat.** When a turn ends, the core compares the turn's "Before message" and "Turn: …" commits (`docs/architecture/history.md`). Every `.md` added or changed in between becomes a card on that assistant entry. A card shows the title (front-matter `title`, else the first `#`, else the file name), the kind, "new" or "updated", and the reading time at 230 words a minute. Cards are saved in the chat log entry, so they come back when the task is reopened. Changes the person makes outside a turn make no card.
- **Links** to `.md` files, in the chat or in a document (§3.4).
- **The harness UI.** `client.openDocument(path)` opens the panel. The SDK exports `<Markdown source={…} />`, so a harness can render documents in its own views (dev's explorer, for example) with the same look and checks.

### 5.2 Layout

The layout is the mockup's:

- **A panel beside the chat.** Its header bar holds the path as breadcrumbs, a "Full screen" button (it hides the chat, and "Show chat" brings it back) and Close.
- **A table of contents** on the left, built from `##` and `###`. It follows the scroll and holds the template note. It is hidden on narrow windows.
- **The document column**, about 72 characters wide. Above the title sit the kind chip, the status chip, when it last changed (the file's mtime), and the reading time. When the reader was opened from a card, the line also names the agent of that turn. Who changed a file in general is C4's job.
- **Reading preferences**: sans or serif, and normal or large text. They are global app preferences, stored with the other app preferences.
- **"Source"**: shows the raw `.md` as read-only text.

### 5.3 Reading the file

- `hh:readDocument(path)` in main returns `{ text, mtime }`. It accepts only paths inside the person's folder or a `folder.references` folder. Anything else is refused ("This file is outside your folder"). It never writes.
- **Live reload.** While a document is open, main watches it. On a change, the reader renders it again and keeps the reader's place at the nearest heading. That covers the agent rewriting it mid-task.
- **Terminal** (`humanharness run`): at the end of a turn it prints `Documents: tickets/MUS-412/analysis.md (new)`, one line per card.
- **Mock mode**: a recording may write `.md` files, so the demo shows cards and the reader.

## 6. Errors

| Case | Behavior |
|---|---|
| Mermaid fails to parse | Its source plus the one-line notice (§3.3) |
| The file was deleted or moved | The panel says "This document was moved or deleted." The card is struck through and can't be clicked |
| The file is over 1 MB | The first 200 KB are rendered, then a notice: "Showing the first 200 KB of 1.4 MB. Open Source to see all of it." |
| Broken front-matter | Ignored. The document renders without a header chip |
| The path is outside the folder | Refused in main (§5.3) |

## 7. Testing

- **Renderer, unit**:
  - tables, alignment, wide-table box;
  - every callout, footnotes, task lists, captions;
  - heading ids, deduplicated;
  - raw HTML stays text;
  - each link rule of §3.4;
  - Mermaid: lazy load, unclosed fence while streaming, parse-error fallback;
  - `markdownToPlain` unchanged for the chat.
- **Template check, unit**: a missing section, case and spacing, an unknown kind, an invalid status, no kinds.
- **Manifest**: `documents.kinds` validation (bad id, empty `sections`).
- **`AGENTS.md`**: snapshot of the managed section with and without kinds.
- **Cards, unit**: from a turn's diff (an added `.md`, a changed `.md`, a non-`.md` file, a change outside a turn), title fallback, reading time.
- **`hh:readDocument`**: refuses paths outside the folder and through links that point outside it.
- **E2E** (mock mode):
  - a card opens the reader;
  - the table of contents jumps;
  - full screen and back;
  - a `.md` link between documents;
  - live reload after the agent rewrites the file.

## 8. Out of scope

| What | Where |
|---|---|
| Comments, questions in the margin, approve and lock | C2, its own spec |
| Focus mode | C3, its own spec |
| A timeline per file, with author and diff | C4, its own spec |
| Editing in the reader | Not planned |
| Export to PDF or Word | Not planned |
| Remote images | Not planned (security) |
| Harness-defined callouts or diagram languages other than Mermaid | Not planned (YAGNI) |
