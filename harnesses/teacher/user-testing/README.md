# Teacher · simulated user testing

Prompts for throwaway agents that play possible users of the teacher harness. Each agent opens the
app in Chrome, tries to get real work done as its persona, thinks aloud, and reports what felt
intuitive and what got in the way. They are not installed agents: a session spawns one, it tests,
it reports, it is gone.

## Files

| File | What it holds |
|---|---|
| `protocol.md` | Shared rules for every tester: how to use Chrome, how to think aloud, what not to do, the report format. |
| `tasks.md` | The task bank. Goals in the teacher's words, never the UI's words, mapped to the flows. |
| `personas/*.md` | One file per simulated user: who they are, what they know, what they expect, how they talk. |

## Personas

Together they cover every task in `tasks.md` (T01–T34).

| File | Who | What they stress |
|---|---|---|
| `laura-historia.md` | 54, Historia, 3 schools, low tech | reuse of old material, citations, plain words |
| `matias-matematica.md` | 31, Matemática/Física, power user, dark mode | chat-first speed, AI quality, undo, shortcuts |
| `sofia-lengua.md` | 25, Lengua, first year | guidance from zero, year plan, trust in the AI |
| `graciela-biologia.md` | 61, Biología head of dept, zoom 150%, dark mode | structure, consistency, exams, legibility |
| `diego-tecnica.md` | 43, escuela técnica, narrow window | quick manual fixes, photocopies, failures, no patience |

## What gets tested

- **Target:** the URL handed to the agent at launch. Today that is the screen canvas
  (https://claude.ai/artifact/L6ecCUaJuku6Cq5xnME2kL) with the flows map
  (https://claude.ai/artifact/ULXM45E1PZtWgUDxCj798u) as reference for the orchestrator only.
- **Clickable since 2026-11-13 (canvas version 30):** the screens carry links, and every screen
  board except the three "Pregunta" boards has a Play button. Run testers in `prototype` mode with a
  start board:

  | Persona | Start board |
  |---|---|
  | Sofía (first use) | `B · Primera vez, sin datos (claro)` |
  | Laura, Diego | `B · Tablero de materias (claro)` |
  | Matías, Graciela (dark) | `B · Tablero de materias (oscuro)` |

  Tasks that start elsewhere, because no click reaches their screen:

  | Task | Start board |
  |---|---|
  | T34 | `Sin conexión (claro)`, or `Sin conexión (oscuro)` for a dark-mode persona |

  Before launching, check on the canvas that each start board exists with exactly that title.

- **Known mock limits as of canvas v62.** Not findings. The protocol tells testers to list them
  under `## Problemas de la maqueta`; when one shows up as a finding anyway, triage it as `maqueta`:

  | Where | What the mockup does | From |
  |---|---|---|
  | Nuevo examen, from Biología 3º A | The class picker shows Biología 2º B's classes | H43 |
  | Nuevo examen, quick picks | Only "Las últimas 3 dadas" is wired | H44 |
  | Editar ficha of a book | "Un capítulo" does not switch | H47 |
  | Ajustes › Con estilo propio | Historia 4º A › Cambiar opens Biología 2º B's dialog | H48 |
  | Material para alumnos | Opens on page 2 of 2; "No poner" (Fuentes) is not wired | H49 |
  | Exportar la clase › Cambiar formato, partes o bibliografía | The choices do not change | H54 |
  | Across screens | Sample counts and names do not always match (classes, questions, pages) | H27, H41, H55 |

  The links were added by `demo/linkify.py` (op list per component, line-anchored to canvas
  version 29) and checked by `demo/check.js` (every href resolves to an existing board, dark links
  to dark). If the canvas session reworks a screen, its line numbers shift: update the ops and
  rerun on a fresh copy of the project. Known dead ends on purpose:
  Buscar, copy/regenerate actions, form fields, and the non-chosen options (A, C, Chat B/C, Work B/C).
- The tester never receives the flows map. Knowing the intended path would spoil the test.

## How to run one tester

From any Claude Code session that has Claude in Chrome connected, spawn a `general-purpose` agent
with this prompt (paths relative to the repo root):

```
Read and follow, in this order:
1. harnesses/teacher/user-testing/protocol.md
2. harnesses/teacher/user-testing/personas/<persona>.md
3. From harnesses/teacher/user-testing/tasks.md, only these tasks: <T-ids>
Target URL: <url>
Mode: <canvas | prototype>
Start board: <board title, prototype on a canvas only>
Write your report to harnesses/teacher/user-testing/reports/<date>-<persona>.md
```

Each persona file lists the tasks that fit it. Pass those, or pick others.

## Running several at once

- Every tester opens its own Chrome tab, so several can run in parallel. Keep it to 3 at a time:
  they share one browser, and more tabs mean slower, flakier clicks.
- Use a cheaper model for a first pass (Sonnet); keep Opus for the personas whose reports you want
  to trust most.
- After all reports are in, one more agent (or the orchestrating session) merges them: the same
  problem hit by several personas goes first. `protocol.md` › Report format is built for that merge.

## What the results are for

Findings feed the canvas session: missing screens, confusing words, wrong order of steps. They do
not change the canvas directly. Testers never edit or comment on the artifacts.
