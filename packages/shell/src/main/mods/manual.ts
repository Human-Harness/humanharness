import { LAYOUT_MAX_DEPTH, LAYOUT_MAX_NODES, MOD_API_VERSION } from "@humanharness/mod-sdk";
import { SHARED_IMPORTS } from "@humanharness/mod-sdk/bundle";
import hhDts from "../../../scripts/hh.d.ts?raw";

/**
 * The manual the app's home folder carries (minimal-core spec §5.1): `AGENTS.md`, for a person or any agent that
 * works in the folder, and `hh.d.ts`, the mod API's types. Both are rewritten on every start.
 */
export function agentsMd(): string {
  // The example's imports go through q(), so the repo's import scanners don't read them as this file's imports.
  const q = (spec: string) => JSON.stringify(spec);
  const imports = [...SHARED_IMPORTS].map((s) => `\`${s}\``).join(", ");
  return `# This app's home folder

This folder holds the parts of the app you may change by hand: your own mods (code that adds blocks and reacts to
what the app does) and your own layouts (how the screen is arranged). The app watches it: a saved change shows at
once, and a broken file never breaks the app. This file and \`hh.d.ts\` are rewritten on every start: don't edit them.

## The layers

Three layers, read in this order: yours, the harness's, the core's.

| Folder | What it is | Can you edit it? |
|---|---|---|
| \`mods/<id>/\` | Your mods and your clones | Yes |
| \`layouts/<name>.json\` | Your layouts and your clones | Yes |
| \`settings.json\` | Your choices: \`{ "layout": "<name>" }\` picks the layout the screen shows | Yes |
| \`harness/mods/<id>/\`, \`harness/layouts/<name>.json\` | The harness's mods and layouts | No: read-only |
| \`core/mods/<id>/\`, \`core/layouts/main.json\` | The core's mods and its default layout | No: read-only |

\`core/\` and \`harness/\` are read-only: the app rewrites them on every start. A file you edit there is moved, on the
next start, to \`mods/<id>-edited/\` (or \`layouts/<name>-edited.json\`), the original comes back, and the app says so.
To change one, clone it into your layer first (\`humanharness mod clone\`, \`humanharness layout clone\`).

Other files:

- \`AGENTS.md\` (this file) and \`hh.d.ts\` (the types of the mod API): the app's, rewritten on every start.
- \`<file>.error\`: why the app refused \`<file>\` (see "Live reload" below).
- \`.layers.json\`: the app's record of what it wrote in \`core/\` and \`harness/\`. Don't edit it.
- \`.control.json\`: while the app runs, how the \`status\` and \`shot\` commands reach it. Private to you.
- \`shots/\`: screenshots \`humanharness shot\` saved.

## Working with an agent

An agent (Claude Code, Codex or any other that speaks MCP) works on this folder through \`humanharness mcp\`, a server
that runs on your computer and reads and writes only this folder. To connect one, run in this folder the line for
your agent and paste what it prints:

- \`humanharness mcp --config claude\`: the \`claude mcp add\` command to run.
- \`humanharness mcp --config codex\`: the \`[mcp_servers.humanharness]\` block for Codex's \`config.toml\`.

Add \`--home <dir>\` when you run it elsewhere. The tools:

| Tool | What it does | Needs the app open |
|---|---|---|
| \`catalog\` | What the app is made of: every mod of the three layers with its blocks, hooks and any \`.error\`, the layouts and which one shows, the names \`hh.d.ts\` types | No |
| \`mod_new\` | A new mod in \`mods/<id>/\` from the template, with one block | No |
| \`mod_clone\` | A core or harness mod copied into \`mods/<as>/\` to change it | No |
| \`layout_clone\` | A harness or core layout copied into \`layouts/<as>.json\` | No |
| \`mod_check\` | Checks a mod without the app: \`mod.json\`, the bundles, \`main\` against a fake \`ctx\`, each block rendered once | No |
| \`status\` | Which mods run, which failed and why, and the layout shown | Yes |
| \`shot\` | A screenshot of the window, as an image the agent sees, saved under \`shots/\` | Yes |

The loop:

1. \`catalog\` first: see what exists before you make anything.
2. \`mod_clone\` to change a core or harness mod, or \`mod_new\` for something new (\`layout_clone\` to place a block).
3. Edit the files in \`mods/<id>/\` (and \`layouts/<name>.json\`).
4. \`mod_check\` after every edit, until each check is ok.
5. A new mod or clone starts off: ask the person to turn it on in Settings › Mods (and the original off, for a clone),
   and to pick a new layout there. Say what the mod does; never turn it on yourself.
6. \`status\` to see that the app runs it, \`shot\` to see what the screen shows; read any \`.error\`.
7. To go back, the person undoes the last change in Settings › Mods.

## Layouts

A layout is a JSON tree of nodes. Each node has a \`type\`:

- \`"row"\`, \`"column"\`: \`children\` side by side or one above the other.
- \`"stack"\`: \`children\` of which one is shown, with an optional \`header\` block content.
- \`"block"\`: shows its \`content\`: \`{ "mod": "<id>", "block": "<name>", "props": { ... } }\` (a block a mod registered;
  \`props\` is optional) or \`{ "core": "task" }\` (the app's task view).

Every node may take \`id\` (lowercase letters, digits and \`-\`), \`size\` (\`{ "px": 240 }\` or \`{ "weight": 1 }\`),
\`min\` and \`max\` (pixels) and \`hidden\`. A layout arranges; the look comes from the app's theme.

The rules \`layoutSchema\` checks:

- The root is a \`"stack"\`, with a child whose id is \`"home"\` and a child whose id is \`"work"\`.
- There is exactly one \`{ "core": "task" }\` block, inside the \`"work"\` child. Ids are unique; at most ${LAYOUT_MAX_DEPTH} levels deep (\`LAYOUT_MAX_DEPTH\`) and ${LAYOUT_MAX_NODES} nodes (\`LAYOUT_MAX_NODES\`).
- Only the root takes \`"overlay"\` (mod blocks over the whole screen). Without it you get the app's ⌘K palette (\`{ "mod": "search", "block": "palette" }\`); your list replaces it, \`[]\` turns it off.
- No other keys. \`blockContentSchema\` checks a block's \`content\`; \`Layout\`, \`LayoutNode\` and \`BlockContent\` are their types.

The screen shows the layout \`settings.json\` picks (\`layouts/<name>.json\`, then \`harness/layouts/<name>.json\`), else
\`harness/layouts/main.json\`, else \`core/layouts/main.json\`. A block whose mod is off shows "Mod <id> is off".

## Mods

A mod is a folder \`mods/<id>/\` with a \`mod.json\` and its code:

\`\`\`json
{ "id": "hello", "name": "Hello", "version": "0.1.0", "apiVersion": ${MOD_API_VERSION}, "main": "main.ts", "ui": "ui.tsx" }
\`\`\`

\`mod.json\` (checked by \`modJsonSchema\`, typed \`ModJson\`):

- \`id\`: lowercase letters, digits and \`-\`, at most 40 (\`MOD_ID\`); unique among every mod of the app.
- \`name\`, \`version\` (\`x.y.z\`), \`apiVersion\`: ${MOD_API_VERSION} (\`MOD_API_VERSION\`).
- \`main\`, \`ui\`: in your layer, the **source** files (\`.ts\`, \`.tsx\`, \`.js\`): the app bundles them itself. Both are
  optional; paths stay inside the folder.
- \`requires\`: ids of mods that must run first. \`history\`: whether \`.harness/mods/<id>/\` in the work folder is in its
  history.
- \`clonedFrom\`: \`{ "id", "version" }\`, set by \`mod clone\`. A clone is never updated from its original.

Each part exports a mod with \`defineMod\` (\`ModDefinition\`); its \`id\` must match \`mod.json\`:

\`\`\`tsx
import { defineMod } from ${q("@humanharness/mod-sdk")};
import { Rx, type BlockProps } from ${q("@humanharness/ui")};

function Hello({ props }: BlockProps) {
  return <Rx.Text>Hello {String(props.name ?? "")}</Rx.Text>;
}

export default defineMod({
  id: "hello",
  ui(ctx) {
    ctx.block("hello", Hello);
  },
});
\`\`\`

- \`main(ctx)\` runs in the app (node). \`ctx\` is a \`MainCtx\`: hooks (\`ctx.on.beforeSend\` answers a \`SendInfo\` with a
  \`SendVerdict\`, which may hold the send until \`ctx.holds.resolve(token, verdict)\` with a \`HoldVerdict\`; \`turnStart\`,
  \`turnEnd\` with a \`TurnEndInfo\`, \`taskOpen\`, \`taskClose\` with a \`TaskRef\`, \`betweenTasks\`, \`phaseMoved\` with a
  \`PhaseMovedInfo\`, \`daily\` with a \`DailyInfo\`, \`close\` when the app quits; for the agent, given an \`AgentInfo\`,
  \`ctx.on.instructions?.(fn)\` answers lines added to its instructions as one section, and \`ctx.on.agentTools?.(fn)\` answers
  \`AgentTool\`s for its \`ui\` server: \`name\`, \`description\`, a JSON-schema \`inputSchema\`, \`handle(args)\` and an optional
  \`tasksOnly\`), \`ipc\`, \`engine.run(tier, prompt)\` (a
  \`Tier\`: light, standard or deep; an \`EngineRunResult\` back), \`tasks\`, \`notes\`, \`storage\`, \`stores.open(name,
  collection)\` (a \`ModStore\`), \`usage.record(kind, entry)\` (a \`UsageEntry\` with \`ModTokens\`) and \`usage.summary()\`
  (a \`UsageSummary\`), \`focus.set(taskId, on)\`, \`dataDir\`, \`notify\`, \`provide\`, \`mods\`, \`log\`. Every registration returns a \`Disposer\`; the app runs
  them before a reload. A \`schema\` (zod) checks the mod's config.
- \`ui(ctx)\` runs in the window. \`ctx\` is a \`UiCtx\`: \`ctx.block(name, Component)\` registers a block a layout places.
  A block is a \`BlockComponent\`: it gets \`BlockProps\` (\`props\` from the layout, and \`app\`, an \`AppValue\`); \`useApp()\`
  gives the same \`app\` anywhere inside it.
- Build blocks with the app's pieces: \`Rx\` (the Radix Themes pieces the app allows: \`Rx.Button\`, \`Rx.Text\`,
  \`Rx.Flex\`, \`Rx.Card\`, ...), \`Icon\`, \`Hidden\` (text only screen readers get) and \`HhTheme\` (the app's theme root;
  blocks are already inside it). No colours or sizes of your own: the theme decides the look.

### Imports

A mod may import only ${imports}, and its own files inside its folder. Anything else is refused when it is bundled.
\`main\` gets the app's \`zod\` and \`@humanharness/mod-sdk\`; \`react\` and \`@humanharness/ui\` are for \`ui\` only.
\`hh.d.ts\` types \`@humanharness/mod-sdk\` and \`@humanharness/ui\`; its \`_internal\` modules are not importable.

### Turning a mod on

A new mod in \`mods/\` is listed **off** in Settings › Mods, marked "Local". Mods run with the app's full access, so the
first time the person turns one on the app shows a warning they must confirm; then it is trusted. An agent never
turns a mod on: it says what the mod does and lets the person decide.

## Live reload and .error

The app watches \`mods/\`, \`layouts/\` and \`settings.json\`. When you save, it bundles the mod again (a fraction of a
second), runs the new \`main\` after the old one's disposers, and remounts its blocks; a layout change redraws the
screen.

If a file can't be used (JSON that doesn't parse, a bundle error, a schema error, a \`main\` that throws), the app keeps
the last good version and writes \`<file>.error\` beside it with why (\`mod.json.error\`, \`ui.tsx.error\`,
\`layouts/<name>.json.error\`). Fixing the file deletes the \`.error\`. Read it after every change.

## Commands

The same kit from a terminal (an agent uses the tools of "Working with an agent" instead). Run them in this folder (or
pass \`--home <dir>\`):

- \`humanharness mod check <folder>\`: checks a mod without the app: \`mod.json\`, the bundle of each part, \`main\`
  against a fake \`ctx\`, and each block rendered once. One line per check; exit 1 on any failure.
- \`humanharness status\`: which mods run, which failed and why, and the layout shown (and the problems of the files
  passed over).
- \`humanharness shot [file.png]\`: the running app saves its window as a PNG (\`shots/<time>.png\` by default) and
  prints the path. Look at it after a change to the screen.
- \`humanharness mod clone <id> [as]\`: copies \`core/mods/<id>\` or \`harness/mods/<id>\` to \`mods/<as>\` (default
  \`<id>\`), with its source entries, the new id and \`clonedFrom\`. Refuses an existing folder. Turn the original off
  and the clone on in Settings › Mods.
- \`humanharness layout clone <name> [as]\`: copies \`harness/layouts/<name>.json\` or \`core/layouts/<name>.json\` to
  \`layouts/<as>.json\`. Refuses an existing file.

\`status\` and \`shot\` need the app running.

## When something goes wrong

- **Escape hatch:** ⌘⌥⇧Esc (Ctrl+Alt+Shift+Esc on Windows and Linux) shows the harness's \`main\` layout and turns off
  every mod of yours; the app says how to turn them back on. Starting the app with \`--safe\` (or
  \`humanharness dev --safe\`) does the same.
- **Undo:** this folder has a history of its own. Settings › Mods undoes the last change to the app.
- A mod whose hooks fail three times in a row is turned off, with a notice.
`;
}

/** The two files the home folder gets on every start. */
export function manualFiles(): { "AGENTS.md": string; "hh.d.ts": string } {
  return { "AGENTS.md": agentsMd(), "hh.d.ts": hhDts };
}
