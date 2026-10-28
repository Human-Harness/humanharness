# Student harness: UI references

Date: 2026-10-27. For dev, the IDE turned out to be the right shape, because it is where developers already work. This note looks for the same thing for the student harness: the "IDE of studying".

Mockups: page "Layout v3 (study IDE)" in `mockups/student/canvas.json`. The boards are `InicioCamino.dc.html` and `SesionTresPaneles.dc.html`. Compare them with 2.1 and 4.1 in "Mockup v2".

## Reference apps

| App | Metaphor | What to take | Student feature |
|---|---|---|---|
| NotebookLM | Notebook with sources | Sources, chat and studio in three panes. Answers cite the source. | Material and grounding, notes |
| Math Academy | Knowledge graph | Diagnosis, prerequisites, mastery per concept. The system picks what comes next. | Concept map, evidence, "Para hoy" |
| Duolingo | Path | Home with one obvious next step. Short sessions. | Home, time box, under-12 |
| Brilliant | Problem first | Each step is an input, not chat. It explains after you try. | Input blocks, worked examples |
| Khanmigo | Tutor beside the exercise | Socratic side panel. Never gives the answer. Adult view. | Socratic method, no homework |
| Anki / RemNote | Deck / notes that become cards | Cards written inside the notes. Plain review screen. | Close: learner-written cards, SRS |
| Heptabase / Obsidian graph | Canvas / graph | Concepts with visible relations | Topic map view |
| Pomodoro apps | Clock | Visible timer, a closing ritual | Session phases, time box |

## Direction

The study IDE is NotebookLM plus Math Academy:

| IDE | Student harness |
|---|---|
| Explorer | Topic sources |
| Editor | Session: exercise and tutor |
| Side panel | Topic map and live evidence |
| Status bar | Method, phase, time, context |
| Command palette | Switch method (⌘K) |

Chat is a panel, not the screen. The screen shows progress and the next step, the same lesson as the IDE for dev.

## Open questions

- With chat this small, do Socratic and Feynman still work? Both are conversation methods.
- Should the sources column start collapsed?
