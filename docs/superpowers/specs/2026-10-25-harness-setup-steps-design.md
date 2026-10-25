# Harness setup steps — design

Status: approved by Marco on 2026-10-25, with every open question resolved by its proposal (where a question had none, the simplest option, noted in place). Not in the roadmap yet. Closes gap #3a of `docs/discovery/2026-10-25-student-vs-core.md` (the "Conocerte" interview) and dev's "multi-step setup with extra steps declared by the harness" (accounts). Builds on:
- plan 3f, the setup flow (`2026-10-14-setup-flow-design.md`);
- `2026-10-25-scopes-and-data-design.md`;
- `2026-10-25-profiles-design.md`.

## 1. Why

The core setup flow has fixed steps: "Tu carpeta", "Motor de IA" and "Todo listo". Harnesses need their own steps before the first real task:

- the student harness interviews the learner;
- the dev harness connects accounts.

Today a harness could only fake this as a first action on its `path`. Home would then say "Iniciar" before the app is really ready, and nothing would stop the person from skipping the step.

## 2. Decisions (proposed)

- **D1. Harness steps come after the core steps** and before "Todo listo", in the same setup screen, stepper and footer as plan 3f.
- **D2. Three kinds of step:**
  - `form`: fields generated from a schema;
  - `interview`: an AI conversation, one question at a time;
  - `component`: the harness's own React step.
- **D3. A step's result is data.** Every step writes to a data collection (scopes-and-data §4) or to the harness settings (`2026-10-25-harness-settings-design.md`). Nothing lives only in the step.
- **D4. Steps are per profile when profiles exist.** Every new profile runs the harness steps. The core steps (folder, engine) run once per app.
- **D5. Each step is required or skippable.**
  - A missing required step keeps Home on "Configurar".
  - A skipped step is remembered and offered again from Settings, never forced.
- **D6. Any step can be run again** from Settings, under the tab of the profile or harness. Running it again edits the same data.

## 3. Manifest

```ts
setup: [
  { id: "conocerte", kind: "interview", label: { es: "Conocerte", … },
    action: "conocerte", writes: "profile", required: true },
  { id: "estilo", kind: "form", label: { … },
    settings: ["tone", "explanationLength"], required: false },
  { id: "cuentas", kind: "component", label: { … },
    component: "AccountsStep", writes: "accounts", required: false },
]
```

- **`form`.**
  - `fields` are taken from a data collection (`collection: "profile", fields: [...]`) or from the harness settings (`settings: [...]`).
  - The core renders them from the zod schema: text, number, enum as radios or select, boolean as a switch.
  - Submitting goes through the same checks as any write.
- **`interview`.**
  - `action` names a manifest action that runs in the `_app` scope (scopes-and-data §3.3) with its own tier, `light` or `standard`.
  - The brief tells the agent to ask one question at a time, using `choices` or input blocks (`2026-10-25-input-blocks-design.md`, `client.respond`).
  - It writes the result to `writes` through the `data` tools.
  - It runs on the setup screen, in a slim chat view.
  - The step is done when the task closes **and** the `writes` record passes its schema. A task that closes without a valid record stays not done, with "Seguir la entrevista".
  - A "what the app understands about you" panel is optional: the harness can show it with a state-only block over the same record.
- **`component`.**
  - A React component the harness registers, like a block component.
  - It gets `{ client, profile, done(), skip() }`.
  - It writes through `client.data` or `client.settings`.
  - The dev harness's accounts step is this kind: it runs CLI checks through the harness's own MCP or client calls.
- **`check`** (plan 4a) validates step ids, that every `action`, `writes`, `settings` and `component` exists, and that an interview's action is not on the `path`.

## 4. Flow and state

- **Stepper.** The 3f stepper grows: "1 Tu carpeta — 2 Motor de IA — 3 Conocerte — 4 …". The core steps are skipped when done, as 3f does today.
- **New profile.** Creating a profile opens the setup screen directly at its harness steps, with the profile's name in the title.
- **Where state is kept.** It goes in the profile's `.harness/setup.json`: `{ <stepId>: "done" | "skipped", at }`. With no profiles, it goes in the root's `.harness/setup.json`.
- **Home** (3f §1) counts required harness steps as missing steps.
  - The card says "Falta un paso: Conocerte".
  - "Configurar {{name}}" opens the setup at that step.
  - Skippable steps never block "Iniciar". Once skipped, they show as a quiet line in Settings.
- **Cancelar / Atrás.** They behave as in 3f.
  - Leaving an interview halfway keeps its open task. Coming back resumes the same session.
  - Leaving a form discards unsaved fields.
- **Engine first.** An interview needs the engine, so harness steps always come after "Motor de IA". A `form` or `component` step that needs no AI could run before it, but the order stays fixed for simplicity.

## 5. Settings

Each step is listed in Settings, under the tab of the profile or harness, with:
- its state (done, skipped, missing);
- "Volver a hacer" (run it again);
- for a `form` step, its fields editable in place.

Running an interview again starts a new task in `_app`. The agent gets the current record in its first message (the `context` of the collection), so it asks only what changed.

## 6. What this closes from the gap analysis

| Gap | How |
|---|---|
| #3a "Conocerte" interview | An `interview` step writing the `profile` collection |
| Dev: setup steps for accounts | A `component` step |
| Dev: learn on import (confirm notes) | Partly: a `component` step can show what the AI proposes for the person to confirm |

## 7. Delivery slices

1. **Steps in the setup flow.** Manifest field, `setup.json`, stepper, Home's missing-step card, `form` steps from schemas, required and skippable.
2. **`interview` and `component`.** Interviews in `_app` with the slim chat view, the done rule, components with `done` / `skip`.
3. **Settings and profiles.** Listing in Settings, "Volver a hacer", running per profile on creation.

## 8. Open questions

1. **Interview cost warning.** An interview spends tokens before the person has seen the app. Show the action's cost hint on the step, or only when it is `medium`/`heavy`?
2. **Mock mode.** Interviews need recordings (`mock/conocerte.json`). Should `check` require a recording for every interview step when the harness has a `mock/` folder?
3. **Steps added in a harness update.** A required step added by an update would block Home for existing users. Proposed: new required steps added by an update show as missing but do not block "Iniciar" until the person opens Settings.
