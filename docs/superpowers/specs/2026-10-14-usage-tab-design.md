# Plan 3b — Usage tab: measured, with no fixed plans

Date: 2026-10-14. Status: approved design. Mockups: https://claude.ai/artifact/PjQb1rrsLKwvyeevLhruYL

## Why

People need to know how far their plan goes with this harness: how many times a topic fits before they hit a limit. Plan names, multipliers, prices and even which windows exist change whenever a provider decides. If the app hard-codes them, it goes stale and can say false things. So the app knows nothing about plans. It only measures what the engine reports on every turn, and turns that into words.

This replaces the core spec's "onboarding explains what each plan tier allows" (§6 Usage awareness) and the roadmap's "user picks the plan".

## 1. What the tab shows (Settings › Uso)

**Tu plan ahora.** One row per limit window the engine reported:
- the window's name, from `usage.<kind>` with a generic fallback ("Límite" / "Limit") for an unknown kind;
- "<n> % usado", a bar, and "se renueva <time>".

A window at or above `WARN_AT` turns to the warning colour. The caption reads "lo informa <engine> en cada respuesta". An engine that reports limits but has not yet sent any shows "Todavía no sé cuánto usaste: <engine> lo informa con tu primera respuesta." An engine that never reports limits shows "<engine> no le dice a la app cuánto te queda, así que no puedo calcular cuántas veces te alcanza. Si llegás al límite, <engine> te avisa cuándo se renueva."

**Cuánto usa cada tema.** One row per action, in path order, then "Pregunta libre". The table depends on what the engine reports.

- **The engine reports limits:**
  - **Cada vez:** "≈ 8 % de 5 h". The window's short name comes from `usage.short.<kind>`, with a fallback of no suffix. The colour is the warning one when the action's cost hint is `heavy`.
  - **Te alcanza para:** with the primary window below `WARN_AT`, "unas N veces", where N = round(1 / estimate), and "más de 50" above 50. At or above `WARN_AT`, the column header becomes "Hasta las <reset time>". Rows then say "N veces más", where N = floor(remaining / estimate), or "no entra entero" when N is 0.
- **The engine does not report limits:**
  - A bar and a phrase comparing the action's typical tokens with the average of all measured actions:
    - "como el promedio" (0.75–1.33×);
    - "la mitad del promedio" (≤ 0.6×);
    - "<x> veces el promedio" (≥ 1.34×, one decimal);
    - otherwise "un poco menos/más que el promedio".
  - The bar width is relative to the largest action.
  - A `title` tooltip shows "≈ <compact tokens> tokens cada vez".
- **Not measured yet:** an action with no measurement shows its cost hint as "Uso bajo / medio / alto" (`light`/`medium`/`heavy`). With limits, it adds "· te digo cuánto después de usarlo".

Captions under the table:
- With limits: "'Te alcanza para' es con una ventana de 5 horas entera y tu plan de hoy. Se recalcula solo si cambia el modelo o tu plan." The window name comes from the primary window.
- Without limits: "Sale de tus últimas veces con cada tema. Pasá el mouse para ver los tokens."
- With nothing measured: "Por ahora es lo que dice el harness de cada tema. Cuando uses uno, acá aparece cuánto usó de verdad y cuántas veces te alcanza."

**Plans link.** The link shows when the engine declares `plansUrl` and either the primary window is at or above `WARN_AT`, or the engine reports no limits. It reads "Si te quedás corto seguido, <provider> tiene planes con más uso." and has a button "Ver planes de <provider>" that opens the URL in the browser.

**Mock mode** keeps its line "Modo prueba: no gasta tu plan." in place of the plan section. The topic table uses the same rules (the mock engine reports no limits, so it compares tokens).

## 2. Data (main process)

- **Engine definition** (`packages/engines`) gains two optional fields:
  - `limits.primary`: the window kind estimates measure, e.g. `"five_hour"` for Claude;
  - `plansUrl`: the provider's page of plans. It is the only plan fact the core keeps, and it is reviewed with the engine.
  - Fill in Claude's real values. Codex gets only `plansUrl`. Verify both URLs exist; leave a field out rather than guess.
- **Usage summary** (`summarizeUsage`):
  - **Recent use only:** each action's estimate is the average of its **last 10 measured tasks**, not all of them, so a change of model or billing settles in after a few uses.
  - **Window:** measure the engine's `limits.primary` instead of the hard-coded `five_hour`, and pass it in.
  - **Tokens:** add `tokens: Record<action, number>`, the average total tokens per task over the last 10 tasks that have usage. A task counts when all of its turns have usage. This works for every engine.
  - **Questions:** free questions (no action) are measured under the key `questions`, like Settings › Modelos does.
- **Client types:**
  - `UsageSummary` gains `tokens` and `primary?: string`, the window kind estimates use;
  - `EngineOption` gains `plansUrl?: string`.
  - Update `packages/ui/src/client.ts` and the IPC.

## 3. Out

- Plan names, prices, multipliers or any plan picker.
- Estimating limits for engines that don't report them.
- Changes to the work screen's usage line and Home's pill.

## Tests

- **Unit:**
  - `summarizeUsage`: last-10 window, `primary`, tokens and `questions`;
  - the UsageTab states (limits with and without history, near the limit, no limits, mock), with the exact phrases and number rules;
  - the plans link conditions.
- **E2E:** extend an existing fake-engine test to open Settings › Uso and check one measured row.

## Changes during implementation

- **Free questions** have no cost hint: before they are measured, their row shows "—" (with limits, "— · te digo cuánto después de usarlo").
- **Singular forms:** "una vez" when N is 1 ("unas 1 veces" read wrong) and "1 vez más" near the limit. Near the limit, more than 50 also reads "más de 50".
- **Window names:** the plan rows use the existing `usage.<kind>` ("5 h", "semana"), which the work screen and Home share. The "Te alcanza para" caption takes the long name from `usage.long.<kind>` ("5 horas"), falling back to the row's name.
- **Comparison phrases:** "<x> veces el promedio" always has one decimal in the UI language ("2,4"). A ratio between 1.33 and 1.34 reads "un poco más que el promedio". The average is over the topics in the table that have tokens, free questions included.
- **Tokens** leave out the closing turn, like estimates. Mock engines and engines without `limits.primary` get no `primary` and no estimates.
- **URLs:** `https://claude.com/pricing` was fetched and lists Pro and Max. `https://chatgpt.com/pricing` answers automated requests with a Cloudflare challenge (403). Several pricing write-ups point to it as OpenAI's plans page, so it stays, to be checked by hand with the engine review.
- **E2E:** the fake Claude script reports the five-hour window on each turn (10 % → 14 % → 15 %), so the flow test checks the manifest row: "≈ 4 % de 5 h", "unas 25 veces".
- The tab moved to `packages/ui/src/UsageTab.tsx`. It reuses Settings › Modelos' row order (`taskRows`).
