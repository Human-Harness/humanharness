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
| dev | in progress | – | – |
| student | – | – | – |
| teacher | – | – | – |
| thinker | – | – | – |
| writer | – | – | – |

**Next step:** dev harness round 2 (ORCA reference, Jira/GitHub auth, terminal vs flow, worktrees, ticket context).

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
