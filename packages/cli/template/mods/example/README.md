# Example

The template's sample mod: a UI-only mod (no `main`) with one block, `card`. The manifest turns it on
(`mods: { example: {} }`) and `layouts/main.json` places it in the header of home.

## Files

- `mod.json`: the mod's id, name and version, and its one part, `ui`.
- `ui.tsx`: registers the block `card`. A layout places it with `{ "mod": "example", "block": "card" }`.

## Imports

A mod may import only `react`, `react/jsx-runtime`, `@humanharness/mod-sdk`, `@humanharness/ui` and `zod`, and its
own files inside this folder. Build blocks from the app's pieces (`Rx`), so the theme decides the look.

## Next

- `corepack pnpm check` checks every mod in `mods/` and every layout in `layouts/`.
- Replace it with the harness's own mods, or delete the folder, its `mods` entry and its place in the layout.
