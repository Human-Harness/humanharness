# Demo harness: the architecture explainer

The demo explains Human Harness to developers who clone this repository, and exercises the core's flow and context management. It reads the repository read-only and keeps what each topic made clear in the user's folder. It runs in development only (it is never signed or distributed):

    corepack pnpm app:dev

## Files

| File | What it is |
|---|---|
| `harness.config.ts` | The manifest: read-only permissions (`edit: "none"`, no commands, no web), the repository as a reference folder (`"app-source"`), the `diagram` and `files` blocks, six topics as actions with their briefs, and the guided path. |
| `agent/AGENTS.md` | How the explainer answers: start from the curated doc, read at most about 8 files, end with `show_choices`. The core adds the managed section (language, the tools, the reference folder). |
| `agent/tasks/*.md` | One brief per topic: the first message of the topic's session. `{{language}}` and `{{notesIndex}}` are filled by the app. |
| `agent/seed/` | Copied into the user's folder the first time. |
| `ui/App.tsx` | Mounts `HarnessApp` with the two block components and the start view's strings. |
| `ui/DiagramBlock.tsx`, `ui/FilesBlock.tsx`, `ui/demo.css` | The demo's blocks. |
| `test/` | The manifest and the block components. |

## Topics

`manifest`, `engines`, `turn`, `blocks`, `context`, `history`, in that order. Each brief points first at `docs/architecture/<topic>.md`, a short curated doc in the repository, then at the code. Each topic runs in its own engine session; choosing "next" closes it, the agent saves a note through the core `save_note` block, and the next topic starts from the notes index.

## Blocks

- `diagram` (visible, `show_diagram`): nodes in order and extra edges.
- `files` (visible, `show_files`): paths relative to the repository with a one-line role. Docs, data and images get "Abrir", which opens them in their default app; any other file (source code such as `.ts`, which the app never opens) gets "Mostrar en Finder". Both go through the app, which only acts on regular files inside the reference folder or the user's folder.
- Core: `choices` (how to continue) and `save_note` (the closing note).
