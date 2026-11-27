# Usage

Settings › Usage: how far the person's plan goes with this harness. It has one card with what the engine reported about
its limit windows (a row per window: percent used, a bar, when it renews), one with how much each topic uses, measured
from the local log (how many times it fits in the plan, or, for an engine that reports no limits, a comparison with the
average), the tokens spent apart from the tasks (material, background jobs, subagents, money when the engine reports
it), and the totals per scope and per person. The app knows nothing about plans: it only measures what the engine
reports on each reply and turns that into words.

Usage is a core mod: it ships with the app and is on by default. Turn it off in Settings › Mods; Settings then has no
Usage tab and search offers no Usage rows.

## For agents

- `mod.json`: id `usage`, no `main`: the mod is UI only. The tab still reads the core's usage summary (the existing getUsage channel); the usage log
  (`usage.jsonl`), `summarizeUsage`, the meter and the preflight stay in the core (ChatView and Home use them).
- `src/ui.tsx`: `defineMod({ id: "usage", ui })` registers one Settings tab, `ctx.settingsTab("usage", …)`. The tab list
  keeps its place after Jobs (`settings-tabs.ts` places the id `usage`; the tab shows while the mod is on). Its name
  comes from the app's `settings.tabs.usage` string. Search's rows `usage.plan` and `usage.actions` open it.
- `src/UsageTab.tsx` draws it, with the core's pieces from `@humanharness/ui`. Other mods add lines through
  `ctx.row("usage", …)`; it draws them after its own.
- `src/times.ts` holds the number rules only the tab uses (`timesFit`, `timesLeft`, `compareTokens`). The helpers
  ChatView and the meter also use (`percent`, `formatReset`, `compactTokens`, `preflight`, …) stay in
  `packages/ui/src/usage.ts`.
- `test/` holds the tab's tests and the number rules'. Tests that open Settings register the tab with
  `packages/ui/test/usage-mod.tsx`, as the shell's renderer entry does.
- Design: `docs/superpowers/specs/2026-10-14-usage-tab-design.md`; Settings in general: `docs/architecture/settings.md`.
