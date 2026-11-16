# Student · simulated user testing

Same method as `harnesses/teacher/user-testing`: throwaway agents play possible learners, open the
mockup in Chrome, try to get real study tasks done, think aloud and report. They are not installed
agents: a session spawns one, it tests, it reports, it is gone.

## Files

| File | What it holds |
|---|---|
| `protocol.md` | Shared rules: Chrome, canvas mode, contradictions as findings, severity, report format. |
| `tasks.md` | Task bank S01–S16, in the learner's words. |
| `personas/*.md` | One file per simulated learner. |
| `reports/` | One report per persona and round. |

## Personas

| File | Who | Stresses | Mode |
|---|---|---|---|
| `mia-primaria.md` | 11, sixth grade, mother nearby | short words, fear of being wrong, first use | light |
| `tomas-secundaria.md` | 15, impatient, dark mode | skipping, wanting the answer, switching method, settings | dark |
| `lucia-universidad.md` | 19, university, photos and PDFs | source trust, editing the map, search, limits | dark |
| `ernesto-adulto.md` | 58, low tech, zoom 150% | legibility, saved work, offline, plain words | light |

Together they cover S01–S16.

## What gets tested

- **Target:** the student canvas, page "Core style v1" (84 boards = 42 screens, light and dark):
  https://claude.ai/artifact/NxaKxqpNh45nC1iGoL4fx8. Mode `canvas`: the boards have no links yet.
- **Data:** every board agrees with `harnesses/student/datos-ejemplo.md` (consistency pass of
  2026-11-16). Testers see Sofi's data whoever they play; a contradiction between screens is a
  `Dato` finding.
- **Known mock limits (not findings):** Ajustes › Uso has no board ("Ver uso" leads nowhere);
  fields do not take typing; the three 4.x method boards other than Socrático are alternatives of
  the same session at different minutes.
- The tester never gets `definition.md`, `datos-ejemplo.md` or the flows map.

## How to run one tester

Spawn a `general-purpose` agent with:

```
Read and follow, in this order:
1. harnesses/student/user-testing/protocol.md
2. harnesses/student/user-testing/personas/<persona>.md
3. From harnesses/student/user-testing/tasks.md, only these tasks: <S-ids>
Target URL: https://claude.ai/artifact/NxaKxqpNh45nC1iGoL4fx8
Mode: canvas
Write your report to harnesses/student/user-testing/reports/<date>-<persona>.md
```

Run at most 3 at a time (one shared browser). Merge after all reports are in: the same problem hit
by several personas goes first.

## What the results are for

Findings feed the canvas: missing screens, confusing words, wrong order of steps, contradictory
data. Core-owned wording (Sidekick, Contexto, Camino, Te espera) goes to a core request, not into
the student canvas. Testers never edit or comment on the artifact.
