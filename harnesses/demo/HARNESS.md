# demo

The living decision log of the demo harness. It explains how Human Harness works to a developer who cloned the repository. Everything here is in English.

## Task

A developer wants to understand the core. The demo walks them through six topics (manifest, engines, a turn, blocks, context, history) by reading the repository's own docs and code. The outcome is a short explanation of one topic, the files that back it, and a note they can come back to. It never changes the repository.

## Decisions

- Which topic to read next. The person needs to see the six topics and a one-line description of each. Shown as choices on Home, then at the end of every answer (`show_choices`).
- Whether to go deeper or move on. Each answer ends with one or two deeper options, one related topic and one "next" on the guided path (`show_choices`).
- What to read behind an answer. The paths that back it are listed with a role each (`show_files`).
- How a flow fits together, when a diagram helps (`show_diagram`).

## Flow

| Action | Tier | Cost | Purpose |
|---|---|---|---|
| manifest | standard | medium | What a harness declares in harness.config.ts and what the core does with it |
| engines | standard | medium | How Claude, Codex or OpenCode is detected, installed and connected without the app handling keys |
| turn | deep | medium | From typing to the answer on screen |
| blocks | standard | medium | How the AI shows cards and options instead of loose text |
| context | deep | medium | What goes to the engine each turn and what is kept |
| history | standard | medium | How every change is recorded and how to go back |
| (questions) | light | – | Free questions |

The guided path is manifest, engines, turn, blocks, context, history.

## Context

Each closed topic saves a note with the core `save_note` fields: a title, up to five summary points, the decisions taken, the files that back them and the questions left open. The harness adds no fields. Each turn also sends the explainer instructions (`agent/AGENTS.md`) and the topic's brief (`agent/tasks/<action>.md`). The reference folder is the Human Harness source (`app-source`), read-only.

## Models

- manifest: standard — a short, well-documented topic.
- engines: standard — mostly detection and setup flow.
- turn: deep — it crosses UI, shell, runtime and engine.
- blocks: standard — one mechanism, a few files.
- context: deep — caps, checkpoints and notes interact.
- history: standard — one package with a clear doc.
- (questions): light — free questions are short.

## Permissions and engines

- edit: none — the demo only reads the repository.
- exec: false — no commands are needed.
- web: false — no web access is needed.
- engines: claude, codex, opencode

## Identity

Name: Demo (es, en). Tagline: "How Human Harness works". Author: Marco Zanger. Two custom blocks, `diagram` and `files`. The suggested folder is `Documents/Human Harness Demo`, seeded from `agent/seed`.

## Open questions

## Decision log

- 2026-10-14 — Added this file so `humanharness check` and `dev --mock` accept the demo. It describes the manifest as it is; it adds no decision.
