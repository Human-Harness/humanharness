# Harness settings — design

Status: draft, 2026-10-25, waiting for Marco's review. Not in the roadmap yet. Comes from the student-vs-core gap analysis (`docs/discovery/2026-10-25-student-vs-core.md`, gap #16). Builds on `2026-10-25-scopes-and-data-design.md` and `2026-10-25-profiles-design.md`.

## 1. Why

Every harness has knobs that change how the AI works for this person:
- **Student:** tone (patient / neutral / demanding), explanation length, a hint after N tries, an explanation after N tries, questions per message, and per-method settings (for example, which Socratic steps are on).
- **Dev:** autonomy level, which checks to run, how much to explain.

Today the Settings sheet has only the core's tabs (`general`, `engine`, `models`, `usage` in `packages/ui/src/SettingsSheet.tsx`), and `AGENTS.md` comes only from the manifest's `instructions` plus the core's managed section (`managedSection` in `packages/workspace/src/instructions.ts`). So a harness would have to build its own settings screen and invent its own way to tell the agent. socrates-app did exactly that, writing METODO.md between markers.

## 2. Decisions (proposed)

- **D1. The harness declares its settings in the manifest:** each setting has a schema, a default, UI hints, and a sentence for the agent. The core draws the screen and tells the agent.
- **D2. Values are stored in the data store**, as an app-wide `single` collection named `settings` (`2026-10-25-scopes-and-data-design.md` §4).
  - Each profile has its own `.harness/`, so each person has their own settings (`2026-10-25-profiles-design.md`). With no profiles, there is one implicit profile.
  - This gives schema checks, history and undo, and `subscribe` for free, so there is no second storage mechanism.
  - The collection is reserved: `agent: "read"`. The agent never changes a setting; it may suggest a change through `choices`.
- **D3. Values reach the agent as plain sentences in the managed section of `AGENTS.md`,** never as raw JSON. Each setting declares how its value reads, for example "Usá un tono paciente." or "Dá una pista después de 2 intentos fallidos.".
- **D4. A change applies from the next task, never mid-session.**
  - `AGENTS.md` is the stable prefix the engine caches (`context.md`). Rewriting it mid-task would invalidate the cache and change the rules halfway through a conversation.
  - The app rewrites `AGENTS.md` only when a value changes, and only when no task is running, or right after the current one closes.
- **D5. Settings of a mode live under that mode's key** (`2026-10-25-task-modes-design.md`). They reach the agent with the mode's brief, not through `AGENTS.md`, because only the active mode's settings matter.

## 3. Manifest

```ts
settings: {
  tab: { es: "Cómo aprendo", en: "How I learn" },     // name of the Settings tab
  sections: [
    { id: "voice", label: { es: "Cómo te habla la IA", en: "How the AI talks" } },
    { id: "help",  label: { es: "Ayuda", en: "Help" } },
  ],
  fields: {
    tone: {
      schema: z.enum(["patient", "neutral", "demanding"]),
      default: "patient",
      section: "voice",
      control: "segmented",                             // segmented | select | toggle | number | text
      label: { es: "Tono", en: "Tone" },
      options: { patient: { es: "Paciente", en: "Patient" }, neutral: …, demanding: … },
      agent: { es: "Usá un tono {{value:label}}.", en: "Use a {{value:label}} tone." },
    },
    hintAfter: {
      schema: z.number().int().min(1).max(5),
      default: 2,
      section: "help",
      control: "number",
      label: { es: "Pista después de", en: "Hint after" },
      unit: { es: "intentos", en: "tries" },
      agent: { es: "Dá una pista después de {{value}} intentos fallidos, no antes.", en: … },
      advanced: true,
    },
  },
}
```

- **`schema`** is a zod type. The core builds the collection's object schema from all fields, with their defaults.
- **`control`** picks one of the core's controls. A harness that needs something else builds its own tab with `HarnessClient.data` on the same collection; that is allowed but discouraged.
- **`help`** (optional) is one line under the control.
- **`advanced: true`** puts the field under "Más opciones", closed by default.
- **`agent`** is the template for the agent's sentence. It supports `{{value}}`, and `{{value:label}}` for the option's label in the app's language.
  - A field with no `agent` is UI-only: the harness's own screens read it, and the agent never sees it.
  - `agent: false` makes that explicit.
- **`check`** (plan 4a):
  - every `default` must match its `schema`;
  - every `options` key must be a value of the enum;
  - every `section` must exist;
  - every `agent` template must name only `value` or `value:label`;
  - i18n parity.

## 4. The Settings tab

- **Where.** `SettingsSheet` gets a fifth tab, after `general`, with the harness's `tab` label. It is shown only when the manifest declares `settings`.
- **Layout.** Fields are grouped by section, in manifest order. The "Más opciones" disclosure holds the `advanced` fields, and "Volver a los valores de la app" resets them to the defaults.
- **Saving.**
  - Every change saves at once through the data store, with `who: "person"`.
  - An invalid value cannot be entered: the controls come from the schema.
  - Any failed write shows inline.
- **When a task is running.** A quiet line appears under the tab title: "Los cambios se aplican desde la próxima tarea." The line uses `role="status"`, so it is announced once. A field changed during the task shows a small "pendiente" mark until the task closes.

## 5. How values reach the agent

- `managedSection` gets one more input, `settings`: the list of sentences, already filled. They are written under a new heading, "### Cómo trabajar con esta persona" / "### How to work with this person", after the core rules and before the interface tools.
- **Rendering.** For each field with an `agent` template:
  - fill it with the stored value, or the default when no value is stored;
  - skip a field whose value equals its default when the harness marks it `agent: { …, onlyWhenChanged: true }`, to keep the prefix short.
- **When it is written.** `writeInstructions` runs today when the engine or the folder changes. It now also runs when the settings collection changes, deferred while a task is current:
  - The main process watches the `data-change` event for `settings`.
  - When no task is current, it rewrites `AGENTS.md` at once.
  - When one is, it marks `instructionsStale`, and rewrites `AGENTS.md` right after the task closes or is interrupted, before the next task starts.
  - A rewrite with identical content is skipped, so the engine's cached prefix survives.
- **Measuring.** The rendered settings section is usually under 200 tokens. `check` warns above `SETTINGS_TOKENS_WARN` (400).

## 6. Mode settings

- A mode's `settings` (`2026-10-25-task-modes-design.md` §3) use the same field shape. They are stored under `settings.modes.<modeId>` in the same collection.
- They are drawn in the same tab, in a section per mode, which the harness may mark `advanced`.
- Their `agent` sentences are not added to `AGENTS.md`. They are appended to the mode's brief when the mode starts or is switched to, because only the active mode's settings matter, and a mode switch is already a turn of its own.

## 7. What this closes from the gap analysis

| Gap | How |
|---|---|
| #16 Profile settings: tone, length, thresholds, questions per message | Fields with `agent` templates |
| #16 Per-method settings | Mode settings (§6) |
| #3 (part) The profile from "Conocerte" | Already closed by the data store's app-wide `context` collection. Settings stay separate: the person chooses them, while the profile is learned. |
| Dev: autonomy level and checks | The same mechanism |

## 8. Delivery slices

1. **Manifest and storage.** The manifest field and its checks, the reserved `settings` collection with defaults, and the core controls in a new Settings tab.
2. **Agent.** Rendering the settings into `managedSection`, the deferred rewrite with `instructionsStale`, the identical-content skip, and the "applies from the next task" line.
3. **Modes.** Mode settings stored under `modes.<id>` and appended to the mode's brief. Lands with task modes.

## 9. Open questions

1. **Scope-level overrides.** For example, a stricter tone for one topic. Proposed: not now. A scope override would make the agent's rules change between tasks of different scopes, which costs a prefix rewrite per switch.
2. **Who may change settings for a minor's profile.** It is related to profiles. Proposed: no lock; the "study with an adult" note covers it.
3. **The `onlyWhenChanged` default.** If omitting default-valued sentences turns out to change the agent's behaviour, it should default to `false`. Measure with the student harness.
