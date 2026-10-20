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
| dev | rounds 1–2 done | v1 in progress | – |
| student | – | – | – |
| teacher | – | – | – |
| thinker | – | – | – |
| writer | – | – | – |

**Next step:** dev harness mockup v1. Compare a console-first layout (cockpit-like) with a decision-first layout (flow + decision log in the center, console/diff as a drawer). Q7 (which cockpit parts carry over) is still pending.

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
| _none yet_ | | | |

## Open questions across harnesses

_none yet_
