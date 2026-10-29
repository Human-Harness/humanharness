# example-harness

The living decision log of this harness. The `/new-harness` guide fills each section; `humanharness check` reads the Flow table and the permission lines. Everything here is in English.

## Task

<!-- What job does the person get done, and for whom? A concrete outcome, never "a chat about X". -->

## Decisions

<!-- Each choice the person makes along the way, what they need to see to decide, and the block that shows it. -->

## Flow

<!-- One row per action, plus (questions) for free questions. `check` compares this table with harness.config.ts. -->

<!-- Parallel tasks: declare `parallel` only when the person runs independent tasks side by side, not for one guided flow. Note the suggested cap and why (the person can change it), and whether the core inbox shows or the harness draws its own from `client.tasks` (`inbox: false`). -->

<!-- Background jobs: list each job (a sync, a check after a task, a periodic digest) with its trigger, its scope, its tier (`light` unless there is a reason), its `dailyTokens` when it runs on `every`, and its permissions if narrower than the harness's (`{ edit: "none" }` for a data-only sync). Each job ends with `job_result`; name the action a `needs-you` result points to. -->

| Action | Tier | Cost | Purpose |
|---|---|---|---|
| example | standard | light | Shows how an action works |
| (questions) | light | – | Free questions |

## Context

Each closed task saves a note with the core `save_note` fields: a title, up to five summary points, the decisions taken, the files that back them and the questions left open.

## Models

- example: standard — the template's default until the Models phase.
- (questions): light — free questions are short.

## Permissions and engines

- edit: none — the template changes no files.
- exec: false — no commands are needed.
- web: false — no web access is needed.
- engines: claude, codex

## Identity

<!-- Name, tagline, author and logo. No provider or model brands. -->

## Open questions

<!-- Anything still undecided. `check` warns while this section has content. -->

## Decision log

<!-- Dated entries: decision, reason, alternatives rejected. -->
