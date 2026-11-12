# Home

The screen the app opens on. It shows the harness's name and logo, says whether the app is ready, and offers the one
way forward: **Start** when everything is set up, **Set up** when a step is missing, or the engine card when the engine
needs attention. Below it: the tasks to pick up again, the profile switcher, the plan's usage, the backup notice for a
work folder that may be lost, and, once, the offer to show the app in the person's language.

Home is a core mod: it ships with the app and is on by default. Turn it off in Settings › Mods; the layout then shows
"Mod Home is off" with **Turn on** where Home was.

## For agents

- `mod.json`: id `home`, no `main` (Home has nothing to run in main).
- `src/ui.tsx`: `defineMod({ id: "home", ui })` registers one block, `home`. The layout places it as
  `{ "mod": "home", "block": "home" }` (the default `main` layout's `home` child).
- The block takes no `props`. It reads the app with `useApp()` from `@humanharness/ui`: the state, the client, the
  engine's status and usage, the setup steps' state, the folder move, the language control, and `nav` (start, setup,
  settings, engine, add a profile, open a search result).
- `src/Home.tsx` draws the screen; `src/PickUp.tsx` is its "pick up where you left off" list. Everything else comes
  from `@humanharness/ui`.
- `test/` holds the tests that render Home, alone or inside `HarnessApp`; `test/home-block.ts` registers the block as
  the shell's renderer entry does.
