# Teacher harness · design decisions

Every design decision Marco made on the teacher canvas, in one place. The findings behind them
(who hit what, in which test round) are in `hallazgos.md`; the testing setup is in `user-testing/`.

- **Canvas:** https://claude.ai/artifact/L6ecCUaJuku6Cq5xnME2kL (v51 at the time of writing).
  Source snapshot of v51 in `canvas/project/` (201 components and boards). Check every link:
  `node canvas/check.cjs canvas/project canvas/components.txt`.
- **Flows map:** https://claude.ai/artifact/ULXM45E1PZtWgUDxCj798u
- **Rule for every decision:** options with mockups first, Marco picks, then the canvas changes.
  Quoted UI copy stays in Spanish, as the canvas shows it.

## Decisions

| Finding | Problem | Decision | Canvas | Options page |
|---|---|---|---|---|
| H01 | No action confirms what it did | **C**: if the result is on screen, it changes there (green tag, "Aprobada" button, Deshacer); if it lands elsewhere, a toast with a button to go there ("Ver las clases", "Mostrar en la carpeta", "Ver en 2026") | v33–v34, v50 (rest via H29) | https://claude.ai/artifact/8nFmbxXhwUyEQ5Fg8uGZpv |
| H03 | No way to start a new year choosing what to keep | **A**: a "+ 2027" tab in the subject's year selector | v35 | — |
| H04 | "Materias que ya no doy" unreachable | **B**: dashed row at the end of the subject list, on every dashboard with subjects | v35 | — |
| H05 | Categories cannot be managed | **C**: "Editar categorías" button in the Library header, next to "Agregar fuente" (Marco's name) | v35, v37 | — |
| H06 | Exam from material talks about classes | **A**: the exam built from material has its own working screen and review ("sale de 5 fuentes que elegiste"), and approve/export stay on that path | v46–v47 | — |
| H07 | No citation style per subject | **D** (after rejecting A–C): "Editar materia" button in the subject header; the dialog holds name, course, school and "Estilo para exportar", tagged "Del colegio" | v36 | https://claude.ai/artifact/4Ye9BcQFpPN9xJSKsByc2H |
| H08 | Numbers differ between screens | One fact sheet for all sample data. Marco's picks: class 28 Ciclo del carbono, 29 Humedales; exams say "Aprobado", never "Listo"; Química only among past subjects; 4 units, no U5; Settings stays on the basic 1+1 scenario; "Taller de ciencias" stays; Historia 4º A 24 of 28 (86 %) | v42–v46 | — |
| H10 | Rail icons have no names | **B**: the rail keeps icons only and each one shows its name on hover; Settings moves to the gear. The core rail is unchanged. Check in round 3 whether hover is enough | v49 | https://claude.ai/artifact/VN4zw3QyZU9GhWHyL7g1P3 |
| H12 | "Para revisar" has no dates | **A**: each row says when it is due, sorted by date, tomorrow in amber; "1 desactualizada" on the subject card is a link to the review | v50 | https://claude.ai/artifact/FbdvLBnyJ21GrizRdtCkD4 |
| H13 | Search does nothing | **A**: a window over the current screen, results grouped in Clases, Unidades, Exámenes, Biblioteca; every magnifier opens it | v38 | https://claude.ai/artifact/FogKPNuVYbBvr2rzhChVSK |
| H14 | Creating a class opens a long form | **Marco's own answer**: the create button always opens the form, and everything can also be asked in the chat. Nueva clase and Nuevo examen show "También podés pedirla en una frase: Escribile al Asistente" | v51 | https://claude.ai/artifact/WLrM8r85NYfJDBnegQVhTp |
| H15 | No "Nuevo examen" on the dashboard | **C**: no dashboard change; reached through Exámenes, whose main action is "Nuevo examen". Depends on H10 being enough | v49 | https://claude.ai/artifact/VN4zw3QyZU9GhWHyL7g1P3 |
| H17 | A scan gives no sign it is being read | **A**: Library row "Leyendo el texto · 62%" + "Falta 1 min"; the source sheet says it is an 18-page scan, how long it takes, that it can be closed, and offers "Ver lo leído hasta ahora". The mod is "Leer escaneos" everywhere (not "OCR") | v50 | https://claude.ai/artifact/FbdvLBnyJ21GrizRdtCkD4 |
| H18 | No sign that slide text is editable | **A**: dotted border on hover, opens in place with an amber border and cursor on click; next to the title "Guardado · tu cambio en la diapositiva 3" with Deshacer | v49 | https://claude.ai/artifact/VN4zw3QyZU9GhWHyL7g1P3 |
| H19 | "Acortala a 40 minutos" shows no change | **A**: the value changes where it lives: "40 min" tag by the title and "antes 80" in the data line; the chat answers with "Ver antes y después · Deshacer" | v50 | https://claude.ai/artifact/FbdvLBnyJ21GrizRdtCkD4 |
| H20 | Secondary text small and grey; selected options not filled | **A**: secondary text 12 → 14 px; muted darker (#505359 light, contrast 7.7 on white; #b8bcc1 dark); the selected option in segmented controls is filled amber, weight 600. **Pending:** a separate core PR to update core DESIGN.md (`hh-muted`, "Secondary text 12") | v51 | https://claude.ai/artifact/WLrM8r85NYfJDBnegQVhTp |
| H21 | Look-alike verbs | **A**, by hand or with the AI: in the exam "Editar" (by hand) and "Pedir a la IA…" ("Otra versión" as a suggestion); a class's sources only "Usar" / "No usar" | v51 | https://claude.ai/artifact/WLrM8r85NYfJDBnegQVhTp |
| H22 | The AI worries: "la IA ve esta materia"; no sources shown | **A**: the chat says what it uses ("la IA usa esta materia y sus 18 fuentes", "esta clase y sus 3 fuentes"); in Planificar "15 más" opens the full list | v51 | https://claude.ai/artifact/WLrM8r85NYfJDBnegQVhTp |
| H23 | Three ways to start, unclear which | **B**: first run asks "¿Por dónde empezás?" with three cards: Una clase (para la semana que viene), La materia (para planificar el año), Tus materiales (si ya tenés PDFs) | v51 | https://claude.ai/artifact/WLrM8r85NYfJDBnegQVhTp |
| H25 | "Aprobar" does not say whether it notifies anyone | **A**: Aprobar opens a popover with what the class or exam contains and "Queda marcada como lista. No se manda a nadie.", with Seguir revisando / Aprobar | v51 | https://claude.ai/artifact/WLrM8r85NYfJDBnegQVhTp |
| H26 | Export does not say the bibliography is inside each PDF | **A**: the bibliography is a question (end of each file / separate file / none); the footer says "3 PDF, cada uno con su bibliografía al final" | v38 | https://claude.ai/artifact/FogKPNuVYbBvr2rzhChVSK |
| H27 | Nueva clase arrives prefilled, unclear from where | **A**: each value the AI filled has a "Sale de: …" line | v51 | https://claude.ai/artifact/WLrM8r85NYfJDBnegQVhTp |
| H28 | Library header has too many counts | **A**: the header says "146 fuentes"; the breakdown lives in the type filter | v51 | https://claude.ai/artifact/WLrM8r85NYfJDBnegQVhTp |
| H36 | Planificar does not say where the 4 units come from | **A**: each proposed unit says "Sale de: Diseño curricular 2º año, bloque N · ver el párrafo" | v51 | https://claude.ai/artifact/WLrM8r85NYfJDBnegQVhTp |
| H38 | Many repeated "Copiar" buttons in last year | **A**: "Copiar todo a 2026" in the 2025 notice, with a summary first and a toast after; unit buttons stay, class buttons only on hover | v51 | https://claude.ai/artifact/WLrM8r85NYfJDBnegQVhTp |

## Fixed without options

These had one obvious fix, so no options were shown.

- **H09, H31:** the "Agregar fuente" menu closes when you pick and Cancel goes back to the Library (v49).
- **H11:** with the answer key, the grading grid comes checked (v50).
- **H24:** next to "Seguir en segundo plano": "cuando esté lista, te avisamos y queda en Para revisar" (v51).
- **H29:** Copiar a 2026 on one class, Juntar categorías and Agregar a la Biblioteca confirm in place with Deshacer (v50).
- **H32:** creating a unit shows "U5 · Evolución creada" with Deshacer and an empty unit; no "la IA las está armando" (v50).
- **H35:** the citation example follows the chosen style (v50).
- **H37:** exporting a draft exam warns "Este examen todavía no está aprobado. Podés exportarlo igual." with "Revisar primero" (v51).
- **H40:** the offline bar may wrap to two lines; next to "Reintentar ahora": "Último intento hace 20 s: sin internet" (v51).
- Prototype bugs H30, H33, H34, H39 (v48); see `hallazgos.md`.

## Still open

- Core PR for H20: update `hh-muted` and secondary text size in core DESIGN.md, so every harness gets it.
- Visual check of v51: secondary text grew in 418 places; nothing was checked by eye yet.
- Round 3 testing, mainly H10 / H15 (are hover names enough?) and the v49–v51 changes.
