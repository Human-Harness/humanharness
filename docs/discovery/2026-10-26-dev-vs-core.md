# Dev harness vs the core: what goes into the core

Date: 2026-10-26. Marco asked which dev-harness features the core is still missing.

**Filter (Marco, 2026-10-26):** "no me interesa implementar TODO lo del dev en el core, solo lo que realmente puede llegar a ser útil para otros harness". A dev feature goes into the core only if other harnesses are likely to use it. Everything else the dev harness builds itself. For those features the core only opens the minimum **hatch**, so the harness can build them without forking the core.

Sources:
- the dev section of `2026-10-20-harness-discovery.md` (rounds 1–3, mockup v3 rounds 1–5);
- `docs/architecture/*` on `origin/master` (47c8503);
- the core specs in `docs/superpowers/specs/`;
- the student gap analysis, `2026-10-25-student-vs-core.md`.

Teacher, thinker, writer and cooker have no interviews yet. The "Who else" column is therefore **Claude's guess** wherever it names them. Only student is backed by Marco's answers. The guesses are for Marco to confirm.

## 1. Already covered (on master or in an approved spec)

| Dev feature | Covered by | State |
|---|---|---|
| Project as the unit of work, with its own tickets, notes and chat | Scopes (spec #1) | master |
| Local cache of Jira tickets, project notes, ADRs as records | Harness data (spec #1) | master |
| Answers to spec questions and import notes, as picks | Input blocks (spec #2) | master |
| Autonomy level, test/run commands, project settings | Harness settings (spec #3) | master |
| Modes inside a ticket | Task modes (spec #4) | in progress |
| Stages Spec › Plan › Implement › Review › QA › PR, "waiting for you", where the flow stops | Task phases (spec #5): `phases` without `auto` + `phaseProposal` | approved |
| First-run steps for GitHub and Jira; learn on import (confirm notes) | Harness setup steps (spec #6): a `component` step | approved |
| Agent chain (spec writer → planner → dev → reviewer → QA → PR writer), each with its brief and model | Manifest actions + `path` + tier per action. Each agent = one action, one session | master |
| Jira and GitHub through the engine's MCP and `gh`, no app-held token | `permissions.exec` + the engine's own MCP config | master |
| Claude and Codex, usage, tiers, history, undo, mock mode | Core baseline | master |

## 2. Core candidates: useful beyond dev

| # | Feature | Who else | Confidence | Notes |
|---|---|---|---|---|
| C1 | **Several sidekicks**, each with its own personality (a prompt) and purposes, turned on per scope | every harness | **decided by Marco** (round 4) | Update spec #9. Keep its rules: suggest only, no tools, visible and capped spend. Importing a sidekick from a prompt file is generic too. |
| C2 | **Reviewable document**: an AI-written `.md` with margin comments, questions whose answers change until approval, and an approve action that locks it | writer (drafts), teacher (course plans), thinker (essays), student (summaries) | Claude's guess, strong | Builds on input blocks. Today the core has no "document the person reviews and approves". |
| C3 | **Focus mode** for a document: one centered column, comments behind a toggle, everything else paused, approve at the end | same as C2 | Claude's guess, strong | Part of C2. Sans serif (Marco). |
| C4 | **Timeline per file, with who changed it (you or which agent) and a diff between versions** | writer, teacher, thinker | Claude's guess, strong | The history already exists, but it is per task. This adds a per-file view and an author on each change. |
| C5 | **"What the AI takes into account" panel**: the session-start context made visible, with add/pin | every harness | Claude's guess, strong | Pillar 3 (context management). Today the context is assembled but not shown. |
| C6 | **Background agent jobs**: an app-started job on the light tier (sync external data, prepare something), on start or by hand | student (pre-generate cards?), teacher (prepare material?) | Claude's guess, medium | Today only the person starts tasks. Dev uses it for the Jira sync. |
| C7 | **Several tasks running at once + "waiting for you" across tasks** | writer? teacher? | Claude's guess, **weak** | Biggest change: today, switching to another scope closes the open task (scopes spec §3.3). Student does not need it. If no other harness needs it, it moves to the hatches (§4). |
| C8 | **Command palette ⌘K** over scopes, tasks, files and actions | every harness | Claude's guess, medium | Small, shell-only. Low priority. |

## 3. Stays in the dev harness

| Dev feature | Why it stays | Hatch needed |
|---|---|---|
| IDE layout: explorer, tabs, status bar, bottom panel | Dev's own UI (`ui/App.tsx`) | – |
| Several repos per project, outside the user folder | Only dev works on code repos | H1 |
| The user's own git: branches, a worktree per ticket, PRs, CI | Core design: "no terminals, ports, Node or git in sight" for its non-technical audience | H1, H2 |
| Embedded terminal (PTY), one tab per agent session + shell | Same reason | H2 |
| Engine preset per project (skills, plugins, MCP, hooks, isolated or on top of the global config) | Only dev users have their own CLI setup | H3 |
| `devharness` MCP open to external agents, with changes as proposals | Only dev has external agents | – (a harness MCP server can already listen) |
| Importing a process (`ticket2`, `AGENTS.md`) into `flow.md` | Dev-specific format | – |
| Readiness check, AC coverage, QA evidence per AC | Rules on the data store, like the student's map | – (promote later if teacher's goals need it) |
| Ticket folder of generated `.md` files with git-like marks | Dev's explorer over C2 and C4 | – |
| Dark/light toggle | Check first whether the app-look spec already covers it | – |

## 4. Hatches: the minimum the core must open

Each hatch is smaller than a core feature. It lets the dev harness build the feature itself.

- **H1. Writable folders outside the user folder, per scope.** Today `permissions.edit` is `folder` or `none`, and `folder.references` are read-only. Dev needs the project's repos writable. This might not be needed if the user folder can be the parent of the repos: to check.
- **H2. Harness-side processes for the UI.** A harness's MCP servers run as processes, but only for the agent. The UI (`ui/App.tsx`) has no backend, so it cannot open a PTY or run `git`/`gh`. Options: a harness "backend" entry in the manifest, or a core terminal API through `client`.
- **H3. Per-scope engine config.** Extra instructions, MCP servers and engine flags (Claude `--settings`/plugin dirs, Codex profile) per scope, applied when the session starts. Today `instructions`, `mcp` and `permissions` are per harness.
- **H4 (only if C7 does not go into the core).** Let a harness keep several sessions open, each in its own worktree, with the core's turn, usage and history machinery. Without it, dev would reimplement the engine layer.

## 5. Decisions for Marco

1. C2–C5 (documents, focus, file timeline, context panel): core? They look generic, but the evidence is only dev plus guesses.
2. C6 (background jobs): core, or a dev-only hatch?
3. C7 (parallel tasks): core feature, or hatch H4 just for dev? This is the most expensive item either way.
4. C8 (⌘K): core now, later, or never?
5. Hatches H1–H3: OK as the dev-only minimum?

**Answers (Marco, 2026-10-26):**
1. C2–C5 go into the core.
2. C6 (background jobs) goes into the core.
3. C7 (parallel tasks) goes into the core. H4 is therefore dropped.
4. C8 (⌘K) does not go into the core. The dev harness may build it in its own UI.
5. H1–H3 are OK. They are built in the core, but as generic, small extension points: any harness can declare them, and the core does nothing dev-specific with them.

Proposed spec grouping (Claude, not confirmed):
- **A.** Parallel tasks + background jobs (C7 + C6). They share the machinery for several sessions open at once.
- **B.** Reviewable documents + focus mode (C2 + C3).
- **C.** File timeline with author + diff (C4).
- **D.** Context panel (C5).
- **E.** Several sidekicks: an update of spec #9 (C1).
- **F.** Harness hatches H1–H3.

After these answers: core specs for the chosen candidates and hatches, ordered after the current list (plans 4–9). Development of the dev harness can start once phases (spec #5) and the hatches it uses are on master.
