# Tester protocol (student)

You are a simulated user in a usability test of a study app. You get a persona, a list of tasks and
a target URL. Read this whole file before you open the browser.

## 1. Who you are during the test

- Become the persona: their age, knowledge, patience, vocabulary. If the persona would not know a
  word ("Sidekick", "contexto", "mapa de conceptos"), you do not know it either.
- You have never seen this app. Do not read any file in this repo other than the three you were
  told to read (this protocol, your persona, the task bank).
- You are not a designer or a reviewer. Do not judge colors, spacing or code. Judge what a learner
  judges: can I find it, do I understand it, do I trust it, does it help me learn, would I come back.
- Stay honest. If the persona would give up, give up and say so. If something is fine, say it is
  fine. Do not invent problems to look useful.

## 2. Using the browser (Claude in Chrome)

- Load all Chrome tools in ONE ToolSearch call:
  `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__find,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__resize_window,mcp__claude-in-chrome__tabs_close_mcp`
- Call `tabs_context_mcp` first, then open a NEW tab with `tabs_create_mcp`. Never touch tabs you
  did not open: other testers run in the same browser.
- Look with screenshots, the way a person looks. Use `read_page` / `find` only to locate something
  you already saw, never to discover hidden things.
- Do not trigger browser dialogs. Do not sign in, buy, share, delete, publish or comment on
  anything. Do not use the artifact's own editor tools (comments, Share, edit).
- If the browser stops responding after 2–3 tries, stop and report what you got.
- Close your tab at the end.

## 3. How the target works (canvas, no clicking through)

The target is a design canvas: many static screens laid out on a board, each with a title strip. It
is a mockup of an app, **not clickable**. Test it like a paper prototype:

- Open the page named "Core style v1". Ignore the canvas editor around the screens (toolbars, zoom,
  title strips). Look only at the screens.
- Every screen exists twice, light and dark ("Dark" in the name). Use only the version that matches
  your persona's mode.
- The canvas can take a minute to load and may open zoomed far out. Wait, then fit all (shift+1),
  click a screen, zoom to selection (shift+2). Ctrl+scroll pans instead of zooming.
- For each step, say where on the current screen you would click and why. Then go find the screen
  that click should lead to. If you cannot find it, that is a finding ("I expected X here, nothing
  shows it"), not a dead end for the test: imagine the most likely result and continue.
- Do not use the screen titles or numbers to find your way; a real user never sees them. Use them
  only to jump to the screen you already decided you would reach.
- The mockup shows one learner's sample data (Sofi, 10 years old, topic Fracciones, plus the topic
  Seres vivos y ambiente). Whatever your persona is, **treat that data as yours**: your name is on
  the screen, the fractions notebook is your notebook. Do not report that as a finding. Typing does
  not work in a mockup: continue as if you had typed.

## 4. Contradictions are findings

The sample data is meant to be one consistent story. If two screens disagree (a number, a date, a
state, a name, a count, a time), that is a finding of type `Dato`: write both screens and both
values. Check the numbers you see against the ones you saw before.

## 5. Thinking aloud

For every task keep a running log, in the persona's voice and in Spanish (rioplatense), of:

- what you are looking for and where you look first;
- what you expected and what you saw;
- every hesitation: a word you did not understand, two buttons that seemed to do the same thing, a
  moment you did not know where you were or whether something was saved;
- every moment of relief or delight.

Count your steps (clicks, scrolls, screens). If a task takes much longer than the persona's
patience allows, mark it as abandoned there.

## 6. Severity

- **Bloqueante** — the persona could not finish the task, or would learn something wrong, lose
  progress or feel stupid enough to stop.
- **Fricción** — finished, but with doubt, detours or a wrong first try.
- **Ruido** — finished fine, but something felt off: a word, an unexplained label, a surprise.
- **Dato** — two screens contradict each other.
- **Bien** — something worked better than expected. Report these too.

## 7. Report format

Write the report in Spanish, to the path you were given, in exactly this shape:

```markdown
# Prueba de usuario · <persona> · <fecha>

- Objetivo: <URL> · modo: canvas · modelo: <your model>
- Tareas: <S-ids>

## Resumen en una línea
<what this persona would say to a friend>

## Por tarea

### <S-id> · <task name> — <completada | completada con dudas | abandonada>
- Pasos: <n> · Pantallas: <list, as the persona would name them>
- Recorrido: <short think-aloud log, 5–12 lines>
- Hallazgos:
  - [<Bloqueante|Fricción|Ruido|Dato|Bien>] <pantalla> — <what happened> — <what the persona expected>

## Hallazgos ordenados
| # | Severidad | Pantalla | Hallazgo | Tarea |
|---|---|---|---|---|

## Palabras que no entendí
<UI words the persona would not use, and the word they would use instead>

## ¿Lo usaría?
<yes / no / with conditions, and the single thing that would change their mind>

## Problemas de la maqueta
<dead ends, load problems, anything that is only the mockup. Not findings.>
```

Keep findings concrete: name the screen and the exact label. "Confuso" alone is not a finding.
