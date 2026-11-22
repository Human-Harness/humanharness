# Sidekick

The prompt coach beside the chat. Before a send it reviews what the person wrote; after a reply it notes gaps and
next steps. It also checks a document before approval, comments when a phase moves, writes the daily card and learns
from the person between tasks. Sidekick runs in its own tool-less sessions, on the model the person picks for the
`sidekick` process in Settings › Models, and it stops at its token cap.

Sidekick is a core mod: it ships with the app and runs only for a harness whose manifest has a `sidekick` key (`{}` is
enough).

## For agents

- `mod.json`: id `sidekick`, `main: main.js`. There is no `ui` yet: Sidekick's UI still lives in `@humanharness/ui`
  and talks to main over its old channels.
- `src/main.ts` turns the mod on only when the harness has a `sidekick` key. It then builds the `SidekickController`
  and registers the 26 app channels (listed in `src/ipc.ts`) under their old names.
  The controller's state goes to the window on its existing push channel. Hooks:
  - `turnStart`, `turnEnd`, `taskOpen`, `taskClose`, `betweenTasks`, `phaseMoved`, `daily` and `close`. Model turns
    run detached from the hook.
  - the core-only `ctx.onRefresh` (a profile switch or an undo) runs the controller's `refresh`, like `taskOpen`.
  - `beforeSend` passes, because the window still asks for each review over its own channel.
- `src/deps.ts` adapts the core mod's `ctx` (`ctx.app`, `ctx.stores`, `ctx.usage`, `ctx.notes`, `ctx.push`) to
  `SidekickDeps`. `src/controller.ts` is the controller as it was in the core.
- `src/manifest.ts` holds the `sidekick` key's schema and the record shapes, and `src/collection.ts` the reserved
  `sidekick` collection. Next to them:
  - `src/store.ts`: the store
  - `src/turns.ts`: the prompts and parsers
  - `src/route.ts`: routing
  - `src/import.ts`: import
  - `src/checks.ts`, `src/brief.ts`, `src/events.ts`: the local checks, the session brief and the learning events
  - `src/usage.ts`: Sidekick's lines in the usage log
  - `src/session.ts`: the session
- The core's main imports nothing from here: it lists Sidekick in `CORE_MOD_LIST`
  (`packages/shell/src/main/mods/core-mod-list.ts`) and hands each window call on the 26 channels to the mod host
  (`packages/shell/src/main/mods/app-channels.ts`). The session folders and briefs are the core's
  (`packages/shell/src/main/mods/core-sessions.ts`), reached through `ctx.app`.
- `harness-sdk` and `runtime` still re-export the manifest, collection and session names from here for the UI and
  other packages; `docs/architecture/sidekick.md` has the full picture.
