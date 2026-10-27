# Profiles — design

Status: approved by Marco on 2026-10-25, with every open question resolved by its proposal (where a question had none, the simplest option, noted in place). Not in the roadmap yet. Closes gap #2 of `docs/discovery/2026-10-25-student-vs-core.md` (several people per install). Builds on `2026-10-25-scopes-and-data-design.md`. That spec's open question 1 is answered here: a profile is a level **above** scopes.

## 1. Why

The student harness is used by a family: Sofi and her older brother study on the same computer, each with their own topics, style and settings. Today an app has one folder (`config.json` → `folder`) and one of everything. Without a core feature, a harness would fake profiles inside its data, and every session would carry everyone's notes.

## 2. Decisions (proposed)

- **D1. A profile is one person, above scopes.** Each profile owns its own scopes, notes, data, material, chats and harness settings.
- **D2. Each profile is a sub-folder of the app's folder.** That sub-folder is the engine's working folder whenever the profile is active. Every existing per-folder mechanism then works unchanged on it: instructions, history, notes and the runtime's cwd.
- **D3. Some things are shared by the whole app:**
  - the engine and its sign-in;
  - model tiers (Settings › Modelos);
  - the usage window;
  - language and appearance;
  - the folder's place and backup (move, synced-folder notice).

  It is one computer, one AI subscription, one app folder.
- **D4. A harness without `profiles` has one implicit profile at the folder root.** That is today's layout: nothing moves and nothing migrates.
- **D5. One history per profile.** Going back in one person's history must never undo another person's work. The history restores every tracked file of its folder, so each profile folder gets its own gitdir.
- **D6. No authentication between profiles.** Profiles separate work, not secrets. Anyone at the computer can open any profile. The app says so when the second profile is created.
- **D7. The profile's identity is data.** Name, colour, age band and avatar live in the profile's own `profile` collection (an app-wide `single` collection of that profile; scopes-and-data §4.1). The registry keeps only what the app needs before it opens the profile.

## 3. Manifest

```ts
profiles: {
  label: { es: "perfil", en: "profile" },
  fields: ["name", "color", "ageBand"],   // fields of the `profile` collection shown in the switcher
},
```

- `profiles` requires a `data.profile` collection with `scoped: false, single: true`. `check` (plan 4a) reports it when it is missing.
- Without `profiles`, D4 applies.

## 4. Layout

```
<folder>/
  .harness/profiles.json          registry: [{ id, title, color, createdAt, archived }], last active id
  sofi/                           profile folder = engine cwd when Sofi is active
    AGENTS.md                     instructions, written per profile (they include Sofi's settings)
    material/<scope>/…
    .harness/
      scopes.json  chats/  notes/  data/  material/  tasks.json  usage.jsonl
  tomas/
    …
```

- **Id.** A profile id is a slug of the first name it was given (`sofi`, `sofi-2` when taken). Renaming changes only the title; the folder keeps its name. The registry copies the colour from the profile's data, so Home can draw the switcher without opening every folder.
- **Shared engine config.** `config.json` (Electron userData) keeps one `folder`, the app's root. That is also where `move-folder.ts` and the backup check act. It gains `profile: <id>`, the active profile.
- **Usage.** `usage.jsonl` stays per profile. Settings › Uso adds up the profiles for the app's window and can show each person.
- **History.**
  - `historyDir(userData, folder)` (`packages/shell/src/main/config.ts`) is called with the profile folder, so each profile gets its own gitdir with no new code.
  - The root's `.harness/profiles.json` is not tracked by any history: it is app-level, like `config.json`.
- **Moving the folder** moves the root, profiles included. `moveFolder` already moves the folder and its history together. With profiles it moves one history per profile, and rolls them all back if any fails.

## 5. Behaviour

- **Creating a profile.**
  1. A name, then the profile folder is made with `prepareFolder` (and the harness seed).
  2. The `profile` record is written.
  3. The harness setup steps run for that profile (`2026-10-25-harness-setup-steps-design.md`).
  4. The harness settings take their defaults (`2026-10-25-harness-settings-design.md`).
- **Switching profiles.**
  - Like switching scopes: the current task closes first, with its closing turn and note.
  - Then the runtime restarts with the new cwd, the active profile is saved and Home redraws.
  - A switch is refused while a turn, a restore or a move runs (the same guards as `restore-guard.ts`).
- **Where the switcher lives.** On Home and on the work screen's top bar: avatar and name. It is shown only when `profiles` is declared. With one profile it shows the name and "Agregar perfil".
- **Archive and delete.**
  - **Archive** hides the profile from the switcher and keeps its folder.
  - **Delete** asks twice, and says it cannot be undone from the app. It moves the profile folder to the system Trash, and its history gitdir with it, so it can still be recovered from the Trash. It never removes files for good. The last active profile cannot be deleted.
- **Engine switch.** It applies to every profile. Each profile's open task ends unfinished, as `engine-switch.ts` does today for the single folder.

## 6. Privacy note

- The person sees it once, when the second profile is created: "Los perfiles separan el trabajo de cada persona, pero no lo protegen: cualquiera que use esta compu puede abrir cualquier perfil."
- A harness that needs real privacy is out of scope; no harness has asked for it.

## 7. What this closes from the gap analysis

| Gap | How |
|---|---|
| #2 Several profiles with their own data, style and settings | Profile folders (D1, D2), settings per profile |
| #18 Age band, "study with an adult" | The age band in the `profile` collection; the copy stays in the harness |

## 8. Delivery slices

1. **Profiles core.** Registry, profile folders, active profile in `config.json`, runtime cwd per profile, one history per profile, the switch guard.
2. **Switcher and lifecycle.** Switcher UI, create (with seed and setup steps), archive, delete to Trash, privacy note.
3. **Shared views.** Usage summed across profiles, `moveFolder` with several histories, the engine switch across profiles.

## 9. Open questions

1. **Can a harness add profiles later?** Moving from D4 (root layout) to profiles would mean moving the root's files into a first profile folder. Proposed: allowed, with a one-time migration that asks first. Or forbid adding `profiles` once the app has data?
2. **Shared material.** Two siblings using the same textbook process it twice. Accept it for now (simple, private), or add an app-wide material library later?
3. **Should Settings › Modelos be per profile?** Proposed: no. Tiers spend the shared subscription, so the decision is app-wide.
