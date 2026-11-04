# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

The platform is an Electron desktop app for macOS. Windows and Linux come later ("macOS first"). Plugin panels run inside sandboxed iframes inside the app window. Impeccable has no Electron value, so `web` is recorded above: the screens are a web renderer.

React 19 and TypeScript in an Electron renderer, with pnpm workspaces.
Screens use Radix Themes pieces, behind one barrel in `packages/ui/src/guide`.
UI work follows the Impeccable loop (shape, build, look, critique).
Design rules live in `DESIGN.md`.

Sources: `README.md`, `docs/architecture/plugins.md`, `docs/superpowers/specs/2026-11-04-radix-impeccable-design.md`.

## Users

Two audiences appear in the docs.

- **The person who uses a harness.** The docs call them non-technical. They already pay for an AI subscription. They do not want API keys, a terminal, Node or git.
- **The harness author.** They build a harness in their own repository with `defineHarness()`, `defineBlock()` and the `/new-harness` guide. They never hold a user's key.

The primary user today is the maintainer, using the app for his own work. The app is validated by daily use (decided 2026-11-04).
The harness author is a user of the framework only: the CLI, the SDK and `/new-harness`. The app and its design think only of the person who uses a harness. A harness that builds other harnesses would be one more harness, with its own non-technical user (decided 2026-11-04).

Sources: `README.md`, `site/index.html`, `docs/architecture/authoring.md`.

## Product Purpose

Human Harness is an open-source framework (Apache-2.0) for building harnesses.
A harness is an installable desktop app. It puts a purpose-built interface and workflow on top of the AI agent a person already pays for.

A chat is the least specific app there is. A harness organizes the person's work first and points the AI at it second.

Three pillars:

1. A screen for decisions. The interface shows options, criteria and trade-offs, and asks for confirmation at the moments that matter. The person decides. The agent prepares the decision.
2. An agentic flow underneath. Phases declared in the harness keep the AI moving toward one goal. Each action runs as a task with its own session.
3. Care with context and models. Notes in the person's folder carry key decisions across sessions and engines. Each task gets a light, standard or deep model.

The goal: bring the person close to the best result for their task, with close to the best use of their resources.

Deferred (2026-11-04): how success is measured. Any measure must respect "no telemetry".

Sources: `README.md`, `site/index.html`, `docs/superpowers/specs/2026-10-10-humanharness-core-design.md`.

## Positioning

The site compares a harness with a generic chat:

| | Generic chat | Human Harness |
|---|---|---|
| Starting point | A blank prompt | A screen built for the task |
| Who keeps the goal | You, by re-prompting | A flow of phases |
| Decisions | Buried in the scroll | Cards with trade-offs, saved as notes |
| Memory | Grows until it compacts or ends | Notes in your folder start every new session |
| Model | The same one for everything | Light, standard or deep per step |

Other claims the docs make:

- The app uses the person's own subscription through the provider's official CLI.
- An engine is offered only if its terms allow it. Working technically is not enough.
- The code is split by how fast each part ages, so a new engine or model replaces one module.

Deferred (2026-11-04): which neighbouring products to position against besides a generic chat.

Sources: `site/index.html`, `README.md`, `docs/architecture/replaceable-parts.md`.

## Operating Context

- The person signs in to the official tool of their provider. The app installs and configures it.
- Everything lives in a visible folder the person picks. An invisible local git history lets them undo what the agent did.
- Each action runs as a task with one engine session. Notes from earlier tasks start every new session.
- The app shows the person's position on their plan's limits before a heavy workflow starts. It records tokens per task.
- The app ships in English. The AI thinks in English and answers in the person's language. After setup, the person can ask for the screens to be translated by their own engine.
- Engines today: Claude (official `claude` CLI), Codex and OpenCode (both over ACP).
- Plugins add sources, panels, attention items and prepared tasks. Their code is treated as hostile and runs in a sandbox.

Sources: `README.md`, `docs/architecture/engines.md`, `docs/architecture/history.md`, `docs/architecture/language.md`, `docs/architecture/plugins.md`.

## Capabilities and Constraints

Capabilities:

- Harness manifest, phases, actions and decision blocks.
- Task modes and phases, time boxes and reviews.
- A document reader with review marks.
- A context panel that shows what the agent takes into account.
- Parallel tasks and jobs.
- Profiles, settings, setup steps and search (⌘K).
- A Sidekick that coaches the person's prompt before it is sent.
- Plugins, secrets and a tool broker.

Constraints:

- Users own their data. Nothing leaves the machine except toward the AI provider they chose.
- No telemetry.
- A harness author never holds a user's key and never pays for anyone's tokens.
- Legal texts stay in English and are never sent for translation.
- Right-to-left languages are out of the current version.
- The word "harness" is the product's term for one installable app.

Sources: `README.md`, `docs/architecture/`, `docs/superpowers/specs/2026-10-25-*`.

## Brand Commitments

- The name is "Human Harness". The repository ships a logo and a logotype (`hh.logo.jpeg`, `hh.logotype.jpeg`).
- The app name appears on Inicio.

- Voice: clear and calm. Short sentences, second person, no technical jargon, no jokes. Copy says what happened and what to do next. It is written for non-technical people (decided 2026-11-04).
- The logo and logotype are final. The logo is the app icon and appears on Inicio. The logotype appears on the site and in the README. Neither appears anywhere else in the app (decided 2026-11-04).

Sources: `README.md`, `hh.logo.jpeg`, `hh.logotype.jpeg`, `docs/superpowers/specs/2026-11-02-style-guide-design.md`.

## Evidence on Hand

- A demo harness, `harnesses/demo`, which explains the architecture to developers. It is a complete example to read, not a starting point.
- A public site, `site/index.html`, deployed to GitHub Pages.
- The curated architecture docs in `docs/architecture/`.
- No customers, testimonials, benchmarks or pricing are in the repo. Future work must not invent them.

Sources: `README.md`, `site/index.html`.

## Product Principles

1. Your own subscription. People sign in to their provider's official tool. The harness author never holds a key.
2. Legal before technical. An engine is offered only when its terms allow it.
3. Your data, in your folder. A visible folder, a hidden history to undo, no telemetry.
4. Know your limits. Show plan usage before heavy work. Record tokens per task.
5. The person decides. The agent prepares the decision.

Sources: `site/index.html`, `README.md`.

## Accessibility & Inclusion

- Every form field has a real `<label>`. Errors are announced through `aria-describedby`. Submit is a `<button>`.
- Review highlights show their comment on focus or hover, and also list it below the text for screen readers.
- The loading icon is static under reduced motion.
- The app is made for non-technical people.

- The required standard is WCAG 2.2 AA. Every critique checks it (decided 2026-11-04).

Sources: `docs/superpowers/specs/2026-10-25-input-blocks-design.md`, `docs/superpowers/specs/2026-11-02-style-guide-design.md` (§4), `README.md`.
