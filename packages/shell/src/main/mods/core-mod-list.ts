/**
 * The mods the core ships (spec D2) and whether each is on by default (absent: off, unless a harness declares it or
 * the person turns it on). Plain data: the shell build reads it too, to copy each one's `mod.json`, `README.md` and
 * `src/` from `packages/mods/<id>/` to `out/core-mods/<id>/`. Sidekick runs only for a harness that declares it.
 */
export const CORE_MOD_LIST: Record<string, { on?: boolean }> = { sidekick: { on: true }, "history-view": { on: true }, "usage": { on: true }, "context-panel": { on: true }, search: { on: true }, documents: { on: true } };
