# Missing screens for a clickable demo (audit 2026-11-16)

Walked every click from Inicio over the 51 boards. A click that leads nowhere is a gap.

## Dead ends from Inicio and the left menu

| # | Click | Missing | Needs a design decision? |
|---|---|---|---|
| 1 | Inicio › "Seres vivos y ambiente" | Tema board for that topic (7 of 12, 3 cards due) | No, same pattern as Tema |
| 2 | Left menu › "Repaso" | Repaso landing (due per topic, "Empezar repaso", empty state "Hoy no tenés repaso") | Yes |
| 3 | Top bar › gear (top right) | Core already places Ajustes there; the Ajustes boards exist. Only the link is missing in the demo | No, core-owned |
| 4 | Inicio › "Lo último que estudiaste", Historial rows, old session rows | Past session, read-only: conversation + summary | No |
| 5 | Inicio / Tema / InicioVacio › "Preparar una prueba" | No entry from Inicio with topics or from Tema; plan screen after "Armar mi plan" not drawn | Entry: yes. Plan screen: no |
| 6 | Task rail › "Notas" | Core-owned page (Notes), not drawn by the student harness; the demo shows a placeholder | No, core-owned |

## Dead ends deeper in

- Nuevo tema paso 4 › "Armar el mapa": no "armando tu mapa…" waiting state before 2.3.
- Flashcards › "Escribir mi respuesta": no "Revisé tu respuesta" step.
- Tema › Resúmenes: no open summary. Tema › Material: no photo viewer. Tema › Flashcards: no "Nueva flashcard" form.
- Tema › Material › "Agregar fotos o archivos": the upload step before "Cambios propuestos al mapa".
- Búsqueda: no "sin resultados" state.
- Topic menu: rename, archive, delete not drawn.

## Cleanup

- 5.2 "Ajustes del tutor" and 5.4 "Ajustes › Perfil" are two Ajustes boards with overlapping tabs (Perfil, Tutor, Métodos, Uso). Merge or rename.
- Core-owned and out of scope here: Sidekick, Contexto %, Camino, Te espera.

## Status 2026-11-16

Drawn (14 new screens, canvas now 65 screens): Repaso landing + empty state, Preparar una prueba entry (Inicio, Tema) + topic chooser + plan, Seres vivos tema, past session, building the map, flashcard answer review, open summary, photo, new flashcard, upload reading, topic menu, empty search. 5.2 renamed "Ajustes > Tutor" (it is the Tutor tab, not a duplicate). Decisions: Repaso A, Preparar una prueba entry C. Topic menu trigger is a ghost "..." button (not yet confirmed by Marco).
