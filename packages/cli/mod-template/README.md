# __NAME__

__DESCRIPTION__

## Files

- `mod.json`: the mod's id, name and version, and its two parts.
- `main.ts`: runs in the app (node) while the mod is on.
- `ui.tsx`: registers the block `__BLOCK__`. A layout places it with `{ "mod": "__ID__", "block": "__BLOCK__" }`.

## Imports

A mod may import only `react`, `react/jsx-runtime`, `@humanharness/mod-sdk`, `@humanharness/ui` and `zod`, and its
own files inside this folder. `main` gets `zod` and `@humanharness/mod-sdk`; `react` and `@humanharness/ui` are for
`ui` only. `hh.d.ts` in the home folder types them.

## Next

- Check it without the app: `humanharness mod check mods/__ID__`.
- A new mod starts off: the person turns it on in Settings › Mods.
