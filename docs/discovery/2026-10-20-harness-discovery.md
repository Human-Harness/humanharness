# Harness discovery — mockups to find shared core features

Started 2026-10-20. Living document: updated after every answer so the work can resume at any time.

## Goal

Mock up five harnesses one at a time — dev, student, teacher, thinker, writer — to find every feature they need, and mark which ones belong in the Human Harness core so no harness reinvents them. These mockups are discovery only; the harnesses themselves stay separate developments (see scope rule: core + demo only).

## Method

1. For each harness, interview Marco. Nothing is assumed: every fact below comes from his answers.
2. Record answers under the harness section (context, users, tasks, decisions, flow, context/memory, models, UI).
3. Build a mockup artifact once the picture is clear enough; Marco reviews it.
4. Extract features into the core-candidates table, tagged with which harnesses need them.
5. After all five, rank candidates: in core already, core extension point, harness-only.

## Core baseline (already exists, 2026-10-20)

Manifest (`defineHarness`) with actions + tiers + `path`; blocks (`defineBlock`, visible or state-only) as MCP tools (`show_choices`, `show_files`, `show_diagram`); harness MCP tools; one engine session per task; `save_note` → `.harness/notes/` + index at session start; model tiers light/standard/deep per action; usage meter + Usage tab; user folder + hidden git history with restore; synced-folder detection; mock mode; setup flow; authoring CLI (`init/check/run/dev`) + HARNESS.md; es/en; Claude + Codex engines.

## Status

| Harness | Interview | Mockup | Features extracted |
|---|---|---|---|
| dev | rounds 1–3 done | v2 (whole app) published, review pending | draft |
| student | – | – | – |
| teacher | – | – | – |
| thinker | – | – | – |
| writer | – | – | – |

**Next step:** Marco reviews dev mockup v2 (18 screens) and the Claude proposals listed under dev. Q7 (which cockpit parts carry over) is still pending.

## Harnesses

### dev

Questions asked, round 1 (2026-10-20): who uses it, what tasks, relation to existing tools (cockpit, ticket2), repo/folder model, what decisions the user takes, outputs.

Answers, round 1 (2026-10-20):

- **What it is.** A general-purpose version of Marco's cockpit app (workspace `cockpit/`, which is Flutter-specific) for any developer doing standard software development. "Our version of ORCA, but ticket-oriented, so the dev is closer to the product."
- **Core loop.** Work on Jira tickets, open PRs on GitHub. An embedded console runs Claude Code or Codex "inside the ticket", with the ticket and all its context visible next to it.
- **Users.** All developers, not only Marco. Does not replace cockpit (cockpit stays Flutter-specific).
- **Tasks.** All of a dev's daily tasks: start a project, implement a feature, debug, review code, understand a foreign repo.
- **Folder.** The user picks one project folder or several, each with its own repo. The remote repo matters much more than in other harnesses.
- **Decisions.** Daily dev work: drive the implementation, review the diff with AI help, etc.
- **Output.** Depends on the work; most of it ends in a PR.

Answers, round 2 (2026-10-20):

- **Vision (key).** ORCA is very code-centric. The dev harness sits further from the code: between the ticket's product information and the code that represents it. "An app for devs that takes them away from the code but gives them control over the agentic flow." They can go down to the code when needed; when everything goes well they can skip the code entirely.
- **From ORCA.** Several agents in parallel, one worktree per task, a diff viewer — or rather a viewer of **the dev's and the AI's decisions**, used for review.
- **Console vs guided flow.** Open. His first idea is cockpit-style console access, but he is open to an approach more useful for this task. To explore it in the mockup.
- **Parallelism.** Yes, several tickets at once.
- **Ticket context.** All of it: description + AC, Jira comments, linked tickets, plan, notes, branch + diff, PR status, CI, review comments. All of it is key for the dev to understand what is being done.
- **Integrations.** For now: Jira, GitHub, MCPs, and `gh` CLI.
- **Ticket lifecycle.** Yes: the app moves Jira states, and after the PR it reads review comments + CI and helps resolve them.
- Still open: which cockpit parts carry over (Hoy inbox, Camino view, advisors, version pilot, Taller, re-injecting context after compaction).

Answers, round 3 (2026-10-20), after mockup v1:

- **Feedback.** v1 covered too few use cases. He wants mockups of the whole app: first run, home, create/import project, etc.
- **First run.** The core onboarding (engine, no app account) plus a step to connect GitHub (`gh`) and Jira.
- **Create project from zero.** AI scaffold of the chosen stack + create the GitHub repo(s) + create the Jira project/board.
- **Project model.** One Jira project ↔ N repos.
- **Ticket screen.** Both modes (console first / decision first), switchable by the dev.

Mockup v2, the whole app (2026-10-20, waiting for Marco's review). Same URL as v1. Source backup: `docs/discovery/mockups/dev/`. 18 clickable screens:

1. **First run.** Welcome (what's missing) → Engine (core tiles; no folder step, since repos come with each project) → Accounts (GitHub through `gh`, no stored token; Jira: personal token **or** the engine's Atlassian MCP — open choice) → All set.
2. **Home and projects.** Empty Home (Import / Create) → Import (Jira project + GitHub repos, already local or cloned; the AI reads the repos and proposes project notes — stack, how to test, conventions — for the user to confirm) → Create: the idea (name, description, kind of software, team standards; the AI asks clarifying questions) → Create: stack decisions one by one (repos, frontend, DB, auth, hosting, CI; option cards with trade-offs; each saved as an ADR) → Create: confirm (GitHub repo, Jira project, scaffold, CI, ADRs, first tickets proposed by the AI, a progress checklist; one confirmation for actions on real accounts).
3. **Daily work.** Hoy → Project (board by Jira status with agent badges; tabs Tickets / PRs / Repos / Notes & decisions) → Take ticket (readiness check, e.g. missing AC → the AI proposes them or asks the PO; repos estimated by the AI; decision or console mode; when the agent stops; what the app does on start; estimated usage).
4. **Ticket.** Decision mode and console mode with a mode toggle; review by decisions; after the PR.
5. **Settings.** Core tabs + **Accounts** (GitHub, Jira, extra MCPs for the agents) + **Agents** (parallel limit, model per stage, default mode); project settings (repos, stage ↔ Jira status mapping, test/run commands, PR template/reviewers/branch naming, project notes & decisions).

**Decision (Marco, 2026-10-20): only agents touch Jira** (through the engine's Atlassian MCP). The app holds no Jira token. The user can still edit Jira by hand, and the app must pick up those changes. Mockup updated (Accounts, Settings › Accounts).

**Decision (Marco, 2026-10-20): Jira sync by an agent into a local copy.** On app start, an agent fetches the missing/changed tickets. The user can press "Update from Jira" to fetch new ones. When an agent works on a ticket, it first checks that the local ticket matches Jira. Mockup updated (Hoy, Project, ticket agent panel).

Proposals added by Claude in v2, not yet confirmed by Marco: readiness check when taking a ticket; "when does the agent stop me" autonomy levels; ADRs for stack decisions; the AI proposing first tickets; project notes learned at import; extra MCPs in settings; a "New ticket" button.

Mockup v1 (2026-10-20, superseded by v2): https://claude.ai/artifact/JkYwnWjmArqrHzSz92A5CV

1. **Hoy.** Tickets in parallel, grouped as "waiting for you" / in progress (phase, worktree, model tier) / next from Jira; plan usage visible.
2A. **Ticket, console first** (cockpit-like): ticket on the left, interactive terminal in the center, changes/PR on the right.
2B. **Ticket, decision first**: phase stepper (Understand → Plan → Implement → Review → PR → Feedback & CI), product + numbered AC on the left, the current decision in the center (plan options with trade-offs, AC coverage, files touched), the ticket's decision log (dev vs AI, assumptions to confirm), the agent's state + "what the AI takes into account" on the right, and "go down to the code" (console, diff, editor) as a closed bottom drawer.
3. **Review by decisions**: the AI's implementation decisions, each tied to an AC and to its slice of the diff; approve / change / ask the PO in Jira; AC coverage with tests; work outside the ticket's scope; PR description generated from the decisions; PR gated until every decision is reviewed.
4. **After the PR**: CI failures and review comments triaged into decisions with proposed actions; reply on GitHub; move Jira states; clean up the worktree on merge.

Reference: cockpit inventory (read from `workspace/cockpit`, 2026-10-20):

- Local Node web app (no framework; node-pty, ws, chokidar, xterm.js), `127.0.0.1:4100`. A supervisor keeps PTYs alive across server restarts. It is also a Claude Code plugin (`board` CLI, `.board/board.json`).
- Screens: Hoy (an inbox of what needs the dev now: decide, reply, test, merge, red CI), Tickets (list, plus a "Camino" view per version, with a stage per ticket), Ticket page (Jira detail, /ticket2 phase + artifacts + command buttons, pinned files, changes, history, a "tested" mark, mockups, assumptions), Diff per ticket/repo/branch, Project page, Version prep + autonomous "pilot", Asesores (PO + experts), Taller (git merges/prune/push, CI incidents analysed by Claude, loose terminals, jobs), Ajustes, and a terminal dock (min/side/full).
- Integrations: Jira REST with a personal token (read only; agents move tickets through the Atlassian MCP); GitHub through the `gh` CLI; git worktrees/branches linked to a ticket key. No Codex.
- AI: interactive `claude` in a PTY, not `claude -p`. Context is passed with `--append-system-prompt` from a file of up to 24k chars, and hooks with `--settings` (the repo is never touched). At most one live agent per ticket; follow-ups go into the live session. /ticket2 creates the worktrees.
- Ticket context: metadata, description, the /ticket2 folder + phase + artifact list, the last 10 comments, worktrees/branches, pinned files. After compaction, a hook re-injects the user's last messages, branch + git status, and in-flight work.
- Flutter/iOS-only parts: run app, TestFlight, App Store, dev releases. Everything else is generic.
- Compliance gap for a distributable version: cockpit reads `~/.claude/skills/ticket2/...`. The core rules forbid touching `~/.claude`, so the dev harness must own its flow state.

Facts implied for the core (to confirm, not yet decided):
- Multi-folder / multi-repo workspace (core today: one folder).
- The user's own git + remote is primary (core today: hidden internal git).
- External integrations: Jira, GitHub.
- Embedded terminal running the engine's interactive CLI (core today: headless `claude -p` turns).

### student

_not started_

### teacher

_not started_

### thinker

_not started_

### writer

_not started_

## Core candidates

| Feature | Needed by | Core status | Notes |
|---|---|---|---|
| Decision log per task, with author (user / AI) and an "assumption" kind the user confirms | dev | proposed (mockup v1) | Extends `save_note` decisions; also the input for review |
| Phase stepper driven by the manifest flow, with a "waiting for you" state | dev | proposed | Core has actions + `path`; needs visible phases per task |
| Several tasks running in parallel + a cross-task inbox ("Hoy") | dev | proposed | Core today: one task at a time |
| Multi-folder / multi-repo workspace | dev | proposed | Core today: one folder |
| User's own git as primary (branches, worktree per task, remote) | dev | proposed | Core uses hidden git; needs a mode for user-owned repos |
| External integrations as harness capabilities (Jira, GitHub through `gh`/MCP) | dev | proposed | Auth: reuse the user's CLI/MCP; no app-held OAuth tokens (3d rule) |
| "What the AI takes into account" panel + add/pin context | dev | proposed | Visible version of the session-start context |
| Embedded terminal (PTY) as an optional "go down" drawer | dev | proposed | Core runs headless turns; an interactive CLI is a new engine mode |
| Multi-step setup with extra steps declared by the harness (accounts) | dev | proposed (v2) | Core setup has fixed steps (folder, engine) |
| Accounts / connections registry (CLI-backed or token, tested) + an extra-MCP list | dev | proposed (v2) | Settings tab provided by core |
| Project = named group of folders + external source (Jira project) | dev | proposed (v2) | Generalizes "the folder" |
| Learn on import: the AI proposes project notes the user confirms | dev | proposed (v2) | Uses notes; needs a confirm-notes block |
| Wizard of sequential decisions (options with trade-offs, one at a time, saved as decisions) | dev | proposed (v2) | Likely generic: thinker/writer/teacher? |
| Single confirmation for outward actions (create repo, create tickets) with a progress checklist | dev | proposed (v2) | Pairs with the core's "warn before heavy actions" |
| Autonomy level per task (where the flow pauses) | dev | proposed (v2) | Flow/manifest-level setting |
| Background/system agent jobs (sync external data into a local cache with a light model; on start + manual refresh) | dev | proposed | Core today: only user-started tasks |
| Freshness check of external sources at task/stage start | dev | proposed | Generic "verify inputs" step in the flow |
| Requirement coverage view (criteria ↔ evidence) | dev | proposed | Possibly generic: teacher/student goals? check later |

## Open questions across harnesses

_none yet_
