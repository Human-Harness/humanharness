# Profiles

Several people use one app on one computer, each with their own work. A harness turns this on with `profiles` in its
manifest. Without it, nothing on this page happens: the app works on one folder, as before (spec D4). Spec:
`docs/superpowers/specs/2026-10-25-profiles-design.md`.

## The manifest

From the `family` test fixture (`packages/fake-agent/fixtures/profiles-harness`):

```ts
data: {
  profile: {
    scoped: false,
    single: true,
    schema: z.object({
      name: z.string().min(1).max(40),
      color: z.enum(PROFILE_COLORS).optional(),
      ageBand: z.enum(["6-9", "10-12", "13-17", "adult"]).optional(),
    }),
    agent: "read",
    context: { fields: "all", tokens: 100 },
  },
},
profiles: { label: "student", fields: ["name", "color", "ageBand"] },
```

- `label` (1–40): the English singular the app uses: "Add student", "Choose student".
- `fields` (1–6, each once): the fields of the `profile` collection the add and edit form asks for, in order. The first
  is `name`. The switcher itself draws only the avatar and the name.
- It needs a `profile` collection (`PROFILE_COLLECTION`) with `single: true`, `scoped: false` and a `name` field that is
  a string (`z.string()`, with or without bounds). Every listed field must be one of its fields the core form can draw.
  These are rules of the manifest's schema: `check` reports them as `schema` findings and adds no warning of its own.
- Otherwise `profile` is an ordinary collection: the harness picks its `agent` permission and its `context`. The agent
  learns who it talks to only through that `context`.
- `PROFILE_COLORS` (from `@humanharness/harness-sdk`) are the colours an avatar can take. A `color` field of that enum
  gives each person one; the window draws any other colour as a neutral avatar.
- Code: `packages/harness-sdk/src/profiles.ts` (`profilesSchema`, `hasProfiles`, `profileFormSpec`), the rules in the
  `superRefine` of `packages/harness-sdk/src/index.ts`.

## On disk

    <folder>/
      .harness/profiles.json       the registry: { version: 1, profiles: [{ id, title, color?, createdAt, archived }] }
      sofi/                        one profile: everything a folder held before (.harness/, notes, AGENTS.md…)
      tomas/

- The registry is `ProfileStore` (`packages/workspace/src/profiles.ts`): atomic writes, one at a time; a file that isn't
  JSON is set aside as `profiles.json.corrupt-<time>`. The root's `.harness/` holds only this file.
- The id is a slug of the first name (`sofi`, `sofi-2`): lowercase letters, digits and dashes, at most 40. It is never a
  name the registry or the root folder already has (any case), so a folder "Sofi" made by hand is never reused. It never
  changes: renaming changes only the title.
- A title is one line, 1–40 characters (`cleanProfileTitle`); an empty or blank name is refused.
- `title` and `color` are copies of the profile's record. Every write to the `profile` collection, from any writer,
  makes the registry copy them (`Profiles.sync`). A colour is kept only when it is a plain lowercase word (≤ 20).
- The active profile is `config.json` → `profile`, and only there. Only a switch writes it (`ConfigStore.setProfile`):
  `hh:saveConfig` drops a `profile` the window sends. At start, a profile the registry no longer lists, or lists as
  archived, is cleared, and Home asks for one.
- Each profile has its own history: `historyDir(userData, <folder>/<id>)`. Nothing tracks the root.

## What is per profile, what is app-wide

- Per profile: tasks, chats, notes, scopes, data, settings (they are a collection), setup steps (`setup.json`), usage,
  AGENTS.md (and the engine's own instructions file), the agent's working folder and its history, and the paths
  `hh:openPath`/`hh:revealPath` open (a path the agent names is relative to its working folder).
- App-wide: the engine and its sign-in, `config.json` (models, language, appearance, text size, `backupDismissed`), the
  folder's place, its backup status and "Move folder…", the reference folders. The agent and
  `hh:openPath`/`hh:revealPath` never get a reference folder inside the app's folder (another profile's folder),
  besides one that is or contains the working folder (`usableReferences` with the root, `references.ts`).
- In code: `baseFor(config, profiles)` (`packages/shell/src/main/profile-base.ts`) is `<folder>/<profile>` in a
  profiles app, `<folder>` otherwise, and null in a profiles app with no active profile. `baseOf` in
  `packages/shell/src/main/index.ts` throws rather than answer the root of a profiles app, and `validConfig()` is null
  until a profile is active, so nothing under `.harness/` is touched then. The runtime, the standalone history and the
  chat log all start from the base.

## Switching (`profile-switch.ts`)

`ProfileSwitch.run(target)`, behind `client.profiles.open(id)` (`hh:profileOpen`) and `create`:

1. Refused (`busy`) while the app quits, a turn or a task operation runs, a restore, a move, an engine change, an
   archive, an edit or a delete runs, or another switch runs. The check and the flag happen with no `await` between.
2. The open task closes with its closing turn and note (`tasks.finish()`). A stopped closing turn leaves the task open
   and refuses the switch (`open`).
3. `target()` names the profile: an existing one, or a new one made right here (below). Then the runtime closes and
   `config.json` names the profile.
4. Arrival: a task left open there by a crash ends unfinished (`tasks.interrupt()`); the settings controller forgets the
   old AGENTS.md and reads afresh; the scopes migrate and are sent; the setup steps' state and the tasks are sent. A
   failed arrival is logged; the switch stands.

The window gets the new `AppState` in the result (`ProfileResult`) and goes to Home, from the work screen too, so the
new profile's required setup steps are checked before its work screen. Switching to the active profile does
nothing. While a switch runs, new turns, restores, moves and engine changes are refused ("Switching profiles"). An
engine change also waits for an archive, an edit or a delete (it archives every profile's chat). Which
guard waits for which lives in one place, `packages/shell/src/main/holds.ts`.

## Creating, editing, archiving, deleting (`profiles.ts`)

The `Profiles` controller (`packages/shell/src/main/profiles.ts`), over IPC as `client.profiles` (`get`, `create`,
`open`, `edit`, `archive`, `unarchive`, `delete`, `onChange`; the `hh:profiles` channel sends every change). Every
refusal comes back as data: `not-ready`, `busy`, `open`, `invalid` (with `errors` by field), `unknown`, `active`,
`failed`.

- **Create.** The fields are checked against the `profile` schema first; nothing is made on a refusal. Then, inside the
  switch: the registry entry, the folder (`prepareFolder` with the harness's seed), the `profile` record (the person's
  write, app-wide, in the new folder's own store), then the profile becomes active. A history already under the new
  id (a deleted profile's that the Trash refused, or a folder removed by hand) is someone else's: it is set aside as
  `<history>.replaced-<ms>` first, so the new person never sees it, and pruned later like a move's. Its settings take their defaults
  and its setup steps start missing. A switch that fails after the entry was made answers `failed` with `made: <id>`:
  the profile exists, not active, and the window says to open it from the switcher.
- **Edit.** Only the active profile (`client.profiles.edit`, `hh:profileEdit`). The form's fields come only from what it
  sends: a listed field it sends no value for is cleared; the record's other fields stay. The merged record is checked
  like a create, by field, then written as the person (`hh:data`'s write: its checks and its `Data: profile` commit);
  the registry copies the name and colour.
- **Archive** hides a profile from the switcher. Settings › General › People lists it with "Bring back".
- **Delete** asks twice in the window. The profile's folder goes to the system Trash (`shell.trashItem`), then its
  history folder (when there is one), then the entry goes. A folder already gone is skipped. A Trash that refuses the
  folder changes nothing (`failed`); one that refuses the history is logged and leaves it where it is (a new profile
  that gets the same id sets it aside, above). Nothing is deleted for good.
- Archive and delete never work on the active profile (`active`): switch first. Once the first profile exists one is
  always active, so the last one can't be deleted. Edit, archive and delete wait (`busy`) while a switch, a turn, a
  restore, a move or an engine change runs, and a switch or a move waits for them.

## The window

- **The setup screen.** One core step after "AI engine", "Who's using it" ("Who's using <name>?"), in a profiles app
  with no active profile, and whenever the person presses "Add <label>" (it opens the setup screen at that step). Its
  form is `profiles.fields`; Next creates the profile, then the flow goes on with that profile's own setup steps, then
  "All set". Once a profile is active the title is "Set up <name> for <profile>" (`docs/architecture/setup.md`).
- **Home** with no active profile says "One step left: add a <label>", and "Set up" opens the profile step.
- **The switcher** (`ProfileSwitcher.tsx`), in Home's top bar and the work screen's (next to the scope picker): the
  avatar (the title's first letter on its colour) and the name; with two or more profiles not archived (or one, while
  none is active), a select. Then "Add <label>". It is disabled while a turn runs. A refusal shows one line: "Wait until
  the AI finishes, then try again." (`busy`), "The open topic is still closing. Try again." (`open`), "That didn't work.
  Try again." (anything else). On Home it is also disabled while the folder moves.
- **Settings › General › People** (`ProfilesSection.tsx`): one row per profile with its avatar and name. The active one
  says "In use now" and has "Edit" (its form in place). Every other one has "Archive" (or "Bring back") and "Delete…",
  which asks "Delete <name>? This can't be undone from the app.", then "<name>'s folder and history go to the Trash. You
  can still get them back from there."
- **Settings › Usage** adds "Usage by person" (below).
- `SetupStepProps.profile` is the active profile (`ProfileView`) for a harness's component step; null without profiles.

## Shared views

- **Usage** (`profilesUsage` in `packages/shell/src/main/usage-log.ts`). The AI plan is the app's, so Settings › Usage
  merges every registered profile's records of the engine in use (archived ones too) in time order, then sums them: the
  window and the estimates see everyone's turns. `UsageSummary.profiles` holds tokens per profile id over each whole
  log; "Usage by person" lists them, most first (a profile with no log shows 0). The per-scope list shows the active
  profile's scopes only (scope ids repeat across people). A deleted profile's usage goes to the Trash with its folder.
- **Engine change** (`archiveChatsOnEngineChange` in `engine-switch.ts`). The active profile's chat is archived as
  before; every other registered profile's chat is archived right away too. Only the active profile can have an open
  task (a switch closes it); one a crash left elsewhere ends on arrival.
- **Moving the folder** (`MoveDeps.subfolders` in `move-folder.ts`). The registry's ids, archived ones included: every
  profile's tracked files are compared after the copy (each prefixed with its id), each profile's notes are made
  relative, and each profile's history moves to its new place. A failure puts every moved history back. The journal
  lists them from the start (`histories: [{ rel, setAside? }]`), and `recoverMove` settles each. In a profiles app with
  no active profile a move is refused as "not set up": switch to a profile first.

## Privacy

Profiles keep work apart; they don't protect it. There is no password: anyone who uses the computer can open any
profile, and every profile's files are in the same folder. The window says so once, on the profile step, while the
second profile is created.

## Tests

- `packages/harness-sdk/test/profiles.test.ts`: the manifest rules and the form. `packages/workspace/test/profiles.test.ts`:
  the registry.
- `packages/shell/test/profile-base.test.ts`, `profile-switch.test.ts`, `profiles.test.ts`, `holds.test.ts`,
  `config.test.ts`, `usage-log.test.ts`, `engine-switch.test.ts`, `move-folder.test.ts`.
- `packages/ui/test/profiles.test.tsx` (the switcher), `profile-setup.test.tsx` (the setup screen and Home),
  `profiles-settings.test.tsx` (People and Usage by person).
- `packages/fake-agent/fixtures/profiles-harness` (id `family`).

## Known gaps

- A harness that adds `profiles` after people used it: the old root files stay where they are, untouched and unread, and
  the first profile starts empty. No migration yet. A history the root kept from before is not moved by a folder move.
- No avatar image: the title's first letter on its colour.
- Only the active profile can be edited: its record lives in its own folder and history.
- Editing a profile keeps only the fields its schema declares: a key in the stored record that the schema doesn't name
  is dropped on save (zod drops it, as for any record).
- Each profile processes its own material; there is no shared library. Models stay app-wide.
- `humanharness run` works on one folder, as one profile's folder would; it reads no registry.
