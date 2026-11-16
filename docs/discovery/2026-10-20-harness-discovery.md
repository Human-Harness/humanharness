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
| dev | parked (rounds 1–3 done) | v2 canvas + clickable prototype | draft |
| student | rounds 1–3 done | layout v3 ("study IDE") on the canvas, review pending | draft |
| teacher | round 1 done (2026-11-12) | – | – |
| thinker | – | – | – |
| writer | – | – | – |

**Dev vs core (2026-10-26):** `docs/discovery/2026-10-26-dev-vs-core.md`. Filter (Marco): only dev features useful to other harnesses go into the core; the rest gets a minimal hatch. Marco answered §5 the same day: C1–C7 into the core except C8 (⌘K); hatches H1–H3 yes, H4 dropped. Specs A–F, all in `docs/superpowers/specs/`, written 2026-10-27 and **approved by Marco the same day**, file by file, with review fixes; merged to master in PR #43:
- A `2026-10-27-parallel-tasks-and-jobs-design.md`;
- B `2026-10-27-document-review-and-focus-design.md` (on top of the document reader spec);
- C `2026-10-27-file-timeline-design.md`;
- D `2026-10-27-context-panel-design.md`;
- E an update of `2026-10-25-sidekick-design.md` (D9–D14, §2a);
- F `2026-10-27-harness-hatches-design.md`.

They are in the core-spec queue (sidekick as plan 11, then plugins, parallel tasks, B, C, D; hatches last). The dev gap analysis is closed. Next: the next harness interview (teacher).

**Next step (student):** Marco reviews layout v3, the "study IDE" (2026-10-27): page "Layout v3 (study IDE)" in `mockups/student/canvas.json`, boards `InicioCamino.dc.html` and `SesionTresPaneles.dc.html`, references and open questions in `docs/discovery/2026-10-27-student-ui-references.md`. Earlier: mockup v1 (https://claude.ai/artifact/WASSbMqoJYVBsAo41fx6nK, 15 screens). Student prototype (2026-10-20): https://claude.ai/artifact/5wNPm3RGiNXrdzEP4st9Qp, source `docs/discovery/prototypes/student/index.html`. Next: Marco tests it and gives feedback.

- **Works:**
  - all 10 flows;
  - profiles with separate data and copy that adapts to age;
  - an editable map with strict/mixed;
  - the diagnosis;
  - computed method recommendation;
  - a real method switch mid-session;
  - warm-up from the student's own cards;
  - close with scripted correction;
  - mastery only with evidence on 2 different days;
  - flashcards with 4 ratings;
  - "Avanzar un día" for spaced repetition;
  - profile tone changes a sample line.
- **Faked:**
  - All AI is scripted. Only "Fracciones equivalentes" has rich scripts.
  - Four methods are placeholders.
  - Uploads are fake.
  - The App tab is static.
- **Deviations:**
  - Marco and Sofi exist at first run, so first run creates a third profile.
  - Navigation lives in memory instead of hash routing.
  - Cierre has a "Rellenar con un ejemplo (demo)" link.

**Dev is parked (Marco, 2026-10-20: "por ahora dejamos este harness así").** Still open there, to revisit later: Marco's test of the prototype (https://claude.ai/artifact/M3j64DEJFiekVj98fbdVn3, source `docs/discovery/prototypes/dev/index.html`), the Claude proposals listed under dev, and Q7 (which cockpit parts carry over).

**Lesson for every harness (from dev round 3):** mockups must cover the whole app — first run, home, creating/importing the main object, daily work, settings — not only the core use case. Ask about those early. A clickable prototype (`prototyper` agent, this branch is `modo: discovery`) is the expected last step.

Dev prototype (2026-10-20, built by the `prototyper` agent; this branch declares `modo: discovery` in `CLAUDE.md`):
- **Works:** every flow (first run, import, create, Hoy/Project live updates, Jira sync spinner + new ticket, take ticket, the full ticket cycle up to merge, mode toggle, code drawer with a typable console + fake diff, settings, "Reiniciar demo").
- **Faked:** all data, 2–3 s timers, the selects in Agents/project settings, filters, editor and GitHub links (toasts only).
- **Additions over the mockups:** plan C from a comment, an inline "Cambiar" field, a "Mergear PR" button, Tickets and Pull requests screens, a "Nuevo ticket" modal.

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

Mockup v3, IDE layout (2026-10-26, waiting for Marco's review). Same canvas, row 6; source `docs/discovery/mockups/dev/IDE*.dc.html`. Marco wants the app to look like an IDE without showing code. Decisions (Marco, 2026-10-26):
- **Left sidebar = projects explorer.** Several projects open; each expands into its tickets grouped by who has the ball: Waiting for you · In flight (unattended) · Planning · In PR. Status dot per ticket (waiting, agent running, red CI, not started).
- **Right sidebar = two tabs:** "Pendiente" (cross-project summary: waiting for you, PR & CI, Jira changed, ready to take; agents in flight, plan usage, Jira sync) and "Este ticket" (agent state, the ticket's decision log, what the AI takes into account, branch/repos/PR). Replaces the Hoy screen.
- **Theme:** dark and light, with a toggle.
- Claude's layout choices, not yet confirmed: center tabs are open tickets (not engines); the bottom panel is "go down to the code" (console, diff, agent log, CI), closed by default; a status bar (branch, engine, agents, usage, Jira, gh, theme); ⌘K search; a welcome tab when nothing is open; the Decisions/Console toggle per ticket.

Round 2 of v3 (Marco, 2026-10-26): "vamos enteramente con el IDE layout". Canvas rows 6 (start) and 7 (ticket), all from one interactive `IDE.dc.html` with a `scene` prop.
- **Skeleton (confirmed):** the CLI lives only in the bottom panel (one terminal tab per agent session + shell, plus Diff/Log/CI; maximizable). The center never shows a terminal; the Decisions/Console toggle is gone.
- **Spec-oriented.** Every ticket is a folder of generated `.md` files (spec, plan, decisions, review, qa) shown in the explorer with git-like marks (A new, M changed, ● waiting for you); each project has `proyecto/` (project.md, conventions.md, adr/, agents/). Stages: Spec › Plan › Implement › Code review › QA › PR.
- **Start flow inside the IDE** (to review in the mockup): Welcome tab walkthrough whose checks run in the bottom terminal → Empezar (import / create / open a repo without Jira) → import writes project.md + conventions.md for review → create writes one ADR per decision, live in the explorer.
- **Spec review, code review agent, QA agent** (to review in the mockup): spec with margin comments, blocking questions and AC → spec coverage; review findings against the spec (send to dev / "the spec is wrong" / discard); QA per AC with evidence.
- **Agents (decision):** the IDE ships a standard team for the dev process (spec writer, planner, dev, reviewer, QA, PR writer), each an `.md` with its model and context; users add their own agents at any stage.
- **QA (decision):** both modes: guided (manual checks for what it cannot test) and 100% autonomous (untestable = "no coverage" noted in the PR).
- **Autonomy (decision):** where the flow stops is the user's choice (spec approval, review↔dev loop count, QA mode, opening the PR).
- Right panel "Este ticket" shows the agent chain for the ticket (OK'd by Marco).

Round 3 of v3 (Marco, 2026-10-26), canvas row 8: process, preset and the IDE's MCP.
- **Use a process already on the machine** (e.g. `~/.claude/skills/ticket2` + `~/.claude/agents`, a repo's `AGENTS.md`, Codex prompts). A Configurador agent maps it to stages and agents; loose agents (em, devops) become new stages, out-of-flow agents, or are ignored.
- **Import copies (decision).** The process is copied into the project, and the user is told so explicitly: changes to the original do not reach the project; the IDE shows "the source changed" with "bring changes". The user must tick "I understand it is a copy" before copying.
- **One flow per project (decision):** `proyecto/flow.md`, shown as a pipeline or as markdown. Stages carry agents, gate, inputs/outputs and conditions.
- **A preset per project (decision):** when the IDE launches Claude Code, Codex or another CLI for a session, it loads the project's skills, plugins, MCP servers, hooks and instructions from `.devharness/preset/`, never writing to `~/.claude` or `~/.codex`. Base can be "your global config + preset" or "only the preset (isolated)". Per-agent additions (QA adds Playwright).
- **The IDE has an MCP (`devharness`), open to external agents (decision):** read flow/agents/tickets/preset, propose changes, import a process; `run_stage` blocked for external agents by default. Every change arrives as a proposal the user approves in the IDE.
- An agent configures the process in conversation (the Configurador in the bottom terminal); its proposal is reviewed in `flow.md` like a spec.

Round 4 of v3 (Marco, 2026-10-26), canvas rows 9 and 10: Sidekicks and focus mode.
- **Several sidekicks, each with its own personality and purpose (decision, core).** The user writes each sidekick's personality as a prompt and picks its purposes (prompt coach, focus, process guard, technical mentor, daily summary, plus a purpose of their own). This extends core spec #9 (Sidekick), which today has one sidekick with a fixed role: the spec must be updated.
- **The project picks which sidekicks it needs (decision).** Sidekicks live in the user's profile; `proyecto/sidekicks.md` turns them on per project and adds project-specific purpose and places. Personality stays the user's.
- **Import a sidekick (decision):** e.g. Marco's `~/.claude/coach` becomes a sidekick (rules → personality and purposes, profile → what it learned; the queue is not copied). Same copy notice and checkbox as the process import.
- Kept from spec #9: suggest only, no tools, never drives the flow, visible and capped spend. A custom purpose cannot grant permissions. Claude's proposal, not confirmed: one card per moment when several sidekicks want to speak (the most relevant one), and a shared cap per ticket.
- **Focus mode for every `.md` (decision):** full-screen reading with one centered column, comments hidden behind a toggle with markers in the text, terminal/sidekicks/heads-ups paused, and the approve action at the end of the doc.

Round 5 of v3 (Marco, 2026-10-26), after trying the clickable prototype https://claude.ai/artifact/KuZC5N2MUq1zeMYsJWmCiA (source `docs/discovery/prototypes/dev/ide-v3.html`, built from `IDE.dc.html` by `build-ide-v3.cjs`):
- **Answers can change until approval (decision).** A comment's answer (spec questions, import notes) stays selectable: the chosen option is marked and the doc text follows it. Approving the doc locks the answers.
- **Focus mode is always sans serif (decision).** The serif/sans toggle is gone.
- **Command palette ⌘K (decision):** tickets, md files and actions in one fuzzy list; `>` shows only actions.
- **Timeline per md (decision):** in the explorer, versions and edits of the open file, each with who made it (you or which agent); a version opens its diff.
- **Diff of md (decision):** a frozen version against the current text, inline or side by side; your unapproved answers show as changes.
- **Problems panel (decision):** a bottom-panel tab plus a status-bar count, with errors and warnings anchored to a file (blockers, red CI, open questions, missing AC, manual checks, a changed process origin); a click opens the file.

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

Questions asked, round 1 (2026-10-20): who the student is; what tasks; input material and where it comes from; the AI's role (explain / ask / test) and limits (doing homework for them?); how study is organized (subjects, topics, exam dates); what stays after a session; relation to the teacher harness and to Marco's socrates-app; first run and home.

Answers, round 1 (2026-10-20):

- **Who.** All ages. Depending on the topic, the user states their age so the level adapts. A minor should use it with an adult (suggested, not enforced).
- **Purpose.** Studying only: learn a topic, prepare an exam. It does **not** produce documents or do the student's work.
- **Material.** Either an initial ingestion of the student's material to work on, or straight from the AI's own knowledge.
- **AI role.** Depends on the method. Socratic or other methods; several methods, switchable.
- **Organization.** No dates or calendars; it is about learning things.
- **What stays.** A map, exercises, flashcards, summaries.
- **Relations.** Connects to nothing (not to the teacher harness). It is the evolution of Marco's socrates-app.
- **First run.** Ask the user about themselves to understand what kind of student they are.
- **Process.** Finish the questions, then mockups. No implementation (Marco: "nada de implementar").

Answers, round 2 (partial, 2026-10-20):

- **From Socrates.** Its method carries over, but as **one** of several methods. The app must offer several **proven, well-known** methods.
- **Methods (all 7 chosen).**
  - Socratic, from Socrates: pre-exercise, then questions.
  - Feynman technique: the student explains; the AI flags gaps.
  - Retrieval practice: active recall + flashcards with spaced repetition.
  - Worked examples with fading.
  - Elaboration: why / how does it connect.
  - Interleaved practice.
  - Problem-based learning.
- **Who picks the method.** The AI recommends one from topic + profile and explains why; the student decides and can switch at any time.
- **Summaries and flashcards.** The student writes them and the AI corrects them (writing is part of studying).

Answers, round 3 (2026-10-20):

- **Profiles.** Several profiles per install. Each profile has its own style and settings.
- **Main object.** The topic. Several topics can be open at once.
- **Ingestion.** The user decides whether the AI sticks strictly to the material or mixes it with its own knowledge.
- **Adult.** Only accompanies; there is no adult feature.
- **Map and session.** Marco asked Claude to propose an approach. On session goals: "sometimes a goal is good, sometimes not".

Claude's proposal (2026-10-20, waiting for Marco's OK):

- **Map.**
  - The AI builds a concept map when the topic is created, from the material or from its own knowledge. Concepts are linked by prerequisites.
  - Each concept has one of 5 states: not seen / seen / practising / mastered / review due.
  - A state moves up **only with evidence**:
    - recall answers correct in different sessions;
    - an explanation (Feynman) without gaps;
    - an exercise solved without hints.
  - The student cannot mark a concept as mastered alone, but can flag "this is hard for me".
  - Mastered concepts drop to "review due" over time (spaced repetition).
  - Clicking a concept shows its evidence, its flashcards and the student's summary.
- **Session.**
  - Start in one of two ways:
    - **with a goal**: concepts from the map, or "prepare an exam" over a set;
    - **free**: explore or ask.
  - The app suggests a "for today": due reviews + the next concept whose prerequisites are done.
  - Optional time box (15/30/45 min); the app wraps up when it ends.
  - Shape:
    1. warm-up recall over due items (2–3 quick questions);
    2. main block with the chosen method;
    3. close: the student writes a short summary (the AI corrects it) and flashcards for what was new;
    4. the map updates and open questions are saved.
  - The student ends the session, or the AI suggests ending when the goal is met.
- Marco: "probemos así" — build mockup v1 with this; after he verifies it, build a testable (clickable) mockup.

Mockup v1 (2026-10-20, waiting for Marco's review): https://claude.ai/artifact/WASSbMqoJYVBsAo41fx6nK. Source backup: `docs/discovery/mockups/student/`. 15 screens, example profile "Sofi, under 12" with the topic "Fracciones":

1. **First run.** Welcome (engine step = core) → Who will study (profiles: name, age band, colour; under-18 shows "study with an adult") → Get to know you (6 questions one at a time, with a live "what the app understands about you" panel).
2. **Home and new topic.** Home ("for today" suggestion, topic cards with a mastery bar and legend, flashcards due) → New topic (what, why, level for this topic, what you already know, material upload, strict/mixed) → Proposed map (concepts in prerequisite columns, each tagged from your material / added by the AI; a 5-question diagnosis or start from zero).
3. **Topic.** Topic (map with 5 states, concept detail: evidence, what's missing to master it, your summary, flashcards; tabs: summaries, flashcards, material, sessions, open questions) → Start session (with goal / exam prep / free; time box; recommended method with reasons; the other 6 methods).
4. **Session.**
   - Socratic: Sócrates sub-steps, pre-exercise, "Me comprometo", hint.
   - Feynman: the student's explanation highlighted ok/gap, with the AI's notes.
   - Worked examples: 3 example cards with fading.
   - Shared session frame: session parts (warm-up / main / close), method switcher, timer, today's goal and evidence panel.
   - Close: the student's summary and flashcards with AI corrections.
   - End: what changed in the map, with the evidence, an open question, and what's next.
5. **Review and profile.** Flashcard review (answer from memory, the AI checks, 4 spaced-repetition ratings, interleaved across topics) → Profile (how I learn, how the AI talks: tone, explanation length, hint/explanation thresholds, questions per message; a methods tab).

Visual style (2026-10-25). Marco rejected three minimal themes (Salvia, Bruma, Lino), then chose from three "paper sheet" themes based on a reference he shared. **Chosen: A · Mañana.**
- A paper sheet (#F7F6F1) floats over a soft green / light-blue / yellow blurred backdrop.
- Soft yellow accent (#F3D54E). Borderless fields and buttons, separated by tone.
- Geist sans for titles, buttons, labels and controls. Newsreader serif only for paragraphs: the AI's text, the learner's messages, summaries and flashcard text.
- Light and dark modes.

All 15 mockup screens were redrawn in this style on the same canvas (page "Mockup v2"; the themes are on page "Themes"). Each screen has a `dark` toggle. The source backup in `docs/discovery/mockups/student/` is updated.

Claude's proposal, material processing (2026-10-25). Marco asked what the app does with uploaded material so that it is used correctly and efficiently. **Decision (Marco, 2026-10-25): this is a core feature that every harness uses, not a student feature.** Split:
- **Core:** steps 1–3, 5, 6 and 8 below.
- **Harness:** declares what the material sheet extracts (student: terms, notation, examples, exercises) and what "items" fragments link to (student: map concepts; dev: tickets or acceptance criteria). It also decides how its flows reuse the material (step 7).
- **Marco (2026-10-25):** at core level no screens are needed; define the process so the material is stored and used optimally. Process definition: `docs/discovery/2026-10-25-core-material-processing.md`. The list below is superseded by it. Marco then decided:
- No photos or scans: only material with text.
- A program does the work; the AI validates and decides.
- Any file type with text is accepted, not only PDF: Word, spreadsheets, presentations, md, txt and others. Spec draft: `docs/superpowers/specs/2026-10-25-material-processing-design.md`. Gap analysis of the student harness against the core: `docs/discovery/2026-10-25-student-vs-core.md`. On 2026-10-25 every gap got a spec draft in `docs/superpowers/specs/2026-10-25-*-design.md`, waiting for Marco's review:
- scopes and data;
- material processing;
- harness settings;
- task modes;
- input blocks;
- task phases and time box;
- profiles;
- harness setup steps.

1. **Read.** Turn each file into text and keep its location (file, page, section):
   - PDF: text extraction; a scanned PDF falls back to vision.
   - Photo: vision/OCR.
   - Link: fetch and clean.
   Done once with a light model. A file hash avoids redoing unchanged files.
2. **Confirm.** For photos and handwriting, the learner checks the read text ("¿leí bien tu cuaderno?") and fixes errors before anything is built on it. Problems are flagged: illegible, cut off, no text.
3. **Material sheet.** One short structured note per topic: what the material covers, its terms and notation, and the examples and exercises it contains. Harness-owned; loaded every session instead of the whole material.
4. **Concept ↔ fragment links.** Each concept in the map points to its fragments. This drives the "from your material / added by the AI" tags. It also shows coverage: concepts the level needs that the material lacks.
5. **Per-session loading.** A session loads the sheet plus only the fragments of today's concepts, never the whole material each turn.
6. **Grounding.** Strict mode: the AI cites the fragment ("tu cuaderno, p. 2") and says when something is not in the material. Mixed mode: what comes from the material and what comes from the AI are marked apart. When the material and the AI disagree (notation, a teacher's method), the AI follows the material and flags the difference; it never corrects silently.
7. **Reuse.** The material's own examples and exercises feed the methods (worked examples, pre-exercises, flashcard ideas).
8. **Add more later.** New material is processed the same way. Map changes are proposed for the learner to confirm.

Reference: socrates-app inventory (read from `workspace/socrates-app`, 2026-10-20):

- Local Next.js app (rioplatense Spanish). One `claude -p` per message (stream-json, `--resume`), streamed to the page over SSE. Tools limited to Read/Glob/Grep/Edit/Write/Web*/TodoWrite.
- Screens:
  - **Temas**: topics grouped by subject (materia).
  - **+ Nuevo**: subject + question + starting belief + optional goal. This is the only onboarding; there is no profile.
  - **Sesión**:
    - chat;
    - a 6-step tracker: Repaso → Ejercicio previo → Preguntas → Concepto → Verificación → Cierre;
    - discovered terms;
    - an exercise block with "Me comprometo" and "Necesito una pista";
    - a stop button.
  - **Glosario**: 4 abstraction levels, with search.
  - **Método**: a settings page.
- Blocks:
  - `socrates-ejercicio`;
  - `socrates-opciones`;
  - `socrates-estado`, which is hidden and carries the step + terms.
- Method:
  - One method: pre-exercise, then Socratic questions. One question per message, no answer before the learner commits, a hint after 2 failed tries and an explanation after 3. Enforced only by prompts.
  - The Método page tunes it but cannot switch methods. It sets:
    - which steps are on;
    - questions per message;
    - when hints and explanations kick in;
    - tone (patient / neutral / demanding);
    - explanation length;
    - exercise types;
    - free-form custom rules.
  - The settings are written into METODO.md between markers.
- Learner model: none. The learner is hardcoded as "Marco", with no age and no mastery tracking. "Level" means the topic's abstraction level 1–4, not the learner's. Progress is a prose table the tutor updates.
- Persistence (all markdown) under `<materia>/`:
  - `temas/NN-*.md`, which keeps the learner's real answers;
  - `glosario.md`;
  - `preguntas-abiertas.md`;
  - `sesiones/*.jsonl`.
- Missing compared with the student harness:
  - material ingestion;
  - profile and age;
  - several switchable methods;
  - concept map / mastery;
  - flashcards;
  - separate summaries;
  - spaced repetition;
  - multiple users.

### teacher

Started 2026-11-12. Mockups will use the current HH style (Radix + Impeccable, `DESIGN.md`), not the 2026-10 canvas style.

Questions asked, round 1 (2026-11-12): who the teacher is; which jobs (plan, prepare, build a course, adapt, assess, track students, communicate, reuse, admin); students inside the app; input material; AI role and limits; organization; what stays; output formats; usage rhythm; first run and home.

Answers, round 1 (2026-11-12):

- **Who / purpose.** Someone who prepares classes and plans their teaching. No student management at all: no students, grades, tracking or communication. Only planning, preparing classes, and exams.
- **Sources.** Documents the teacher uploads; documents the app finds on the internet at the teacher's request; scans that need OCR, stored as text. These sources feed everything else.
- **Outputs.** Classes in several formats: PPT, PDF, DOCX, Markdown, HTML.
- **Planning.** From the sources: a group of classes, a whole year, etc. Also helps the teacher organize their work.
- **Exams.** Built from the uploaded material.
- Related: `2026-10-25-core-material-processing.md` (student material ingestion) likely covers part of the sources step. **Conflict:** that doc rules out OCR and scans ("no OCR, no photos, no scans"); teacher needs OCR. Asked in round 2.

Questions asked, round 2 (2026-11-12): OCR how and where; web search approval and citation; source organization; what "a class" is; formats; editing; style/template; what "plan the year" means; plan-first or any order; "organize work"; exam contents; several subjects.

Answers, round 2 (2026-11-12):

- **OCR.** Not in the core: a plugin (now a mod). Done by a free local program, not by the AI. The core rule "no OCR" stays.
- **Web search.** Only citable material with an author, never Wikipedia-style sources. Everything is stored locally; online items also keep URL + author.
- **Sources.** A library where material can be organized; each item can carry several categories. Exact storage decided later.
- **A class.** Any of: projectable material, a teacher's script (maybe with activities), material for students.
- **Formats.** Decided later. Marco asked for research on libraries that produce good-quality output with little effort on our side. Style/template decided after that research.
- **Editing.** Inside the app, by hand or by asking the AI.
- **Year plan.** Not clear yet. Something flexible without being too complex.
- **Order.** Any order: some plan a single class, others the whole year.
- **Organize work.** Yes: see which classes are ready and which are missing, pending items.
- **Exams.** Per exam the teacher picks the topics or material it draws from, plus format, question types, number of topics.
- **Subjects.** Several subjects at once.
- **Prior art.** Much of this was designed in Ariadna (`~/Documents/workspace/ariadna`). Where Ariadna contradicts these answers, these answers win.

Ariadna survey (2026-11-12, `~/Documents/workspace/ariadna`, docs `docs/flujo.md` v0.2, `docs/examenes.md` v0.3): chat-only Claude Code project + Python CLI `./ari`; builds **one class** for a university humanities teacher.
- **Contradicts Marco's answers (Marco wins):** the class is the top unit (no subject/unit/year; materia is a label); sources live per class, no shared library, no reuse of earlier classes; no OCR; web search only for an optional "guía inicial"; exports are one-way (pptx edits never come back); exams belong to one class; no multi-subject handling.
- **Candidates to carry over (not confirmed):** source metadata (`tipo` libro/capítulo/artículo/web/apunte/programa, authors, year, URL + capture date, missing data asked, never invented); citation markers `[F01, p. 34]` with literal quotes checked by a script against the source text; citation style applied only at export; step states pendiente → borrador → aprobado → desactualizado; `decisiones.md` log; time budget per class in minutes with a meter; class pieces sent to clase / alumnos / descartada; exam engine (MC / MCJ / desarrollo, difficulty by demand, 1–6 versions distintas or mezcladas, correct letter assigned by script with a seed, anti-pattern checker, answer key with distractor errors + rubrics); principle "what a script can check, a script checks, not the AI"; talk-to-teacher rules (one question at a time, no paths/JSON).

Export research (2026-11-12, subagent, web-verified versions: Pandoc 3.10.1, Typst 0.15, marp-cli 4.5.1, pptxgenjs 4.0.1, docx 9.15.3). Recommendation, pending Marco's call:
- **Source of truth:** Markdown + YAML frontmatter (slides split by `---`, notes in `::: notes`); exams as a YAML question bank (type, points, answer, rubric).
- **PPTX / DOCX / MD / HTML:** Pandoc (GPL-2, one ~40 MB binary). Styles via the school's `reference.pptx` / `reference.docx` + CSS. PPTX is native and editable but plain (only the reference deck's layouts).
- **PDF:** Pandoc → HTML → Electron `printToPDF` with CSS (no LaTeX, Chromium already shipped).
- **Exams:** ~100 lines of our own TS: YAML → student version + answer key, seeded shuffle for versions.
- **Rejected:** Marp/Slidev PPTX (images, not editable); Presenton/Gamma (generate their own decks, not our content; Gamma sends content to the cloud); Quarto (adds only weight over Pandoc). Fallback if Pandoc PPTX is too plain: pptxgenjs + slide JSON (own layout mapper).
- **Risks:** plain PPTX; Pandoc GPL-2 distribution terms (check with legal); small rendering differences across formats. Suggested next step: 1-day spike with one sample class (10 slides + handout + exam).

Answers, round 3 (2026-11-12):

- **Export.** Marco does not like Pandoc. He is interested in **Presenton** (presenton.ai), run locally. Gamma is paid (API on Pro and above, per third-party sources), so out. Checked: Presenton is open source (Apache-2 per most sources; one listing says MIT), runs locally via Docker (or an Electron build), API with file upload + `files` + `template`, custom templates from an uploaded PPTX, exports PPTX and PDF, LLM via Ollama/OpenAI/Anthropic/Gemini etc. (its own LLM call, separate from the HH engine). Covers slides only: scripts, handouts and exams still need a DOCX/PDF path.
- **Ariadna.** All candidates listed above carry over: source sheet, verified citations, step states, time budget, exam engine, the script-checks principle.
- **Audience.** Any level, any subject.
- **Organization.** Subject → units → classes, and the teacher can also create standalone classes, inside or outside a subject.

Answers, round 4 (2026-11-12):

- **Presenton rejected** (own LLM key + cost, Docker, slides only). Gamma rejected (paid). Pandoc rejected (round 3).
- **Requirement:** free, and presentations must be **visually attractive**.
- **Who writes the slides:** option A — our AI writes each slide's content (grounded, verified citations); the tool only designs/renders. (Marco answered "4. A"; read as the "who builds the slides" question, the only one with an A option.)
- New research launched for a free, local, attractive slide renderer that takes our content.

Slide renderer research (2026-11-12, subagent; nothing was run, look ratings from docs/reputation). No tool is both designer-quality out of the box and natively editable in PPTX.
- **Option 1 (recommended):** own HTML/CSS layout kit (~10 layouts: title, section, two-column, image+text, quote, timeline, comparison, big number…), themed by a few CSS tokens + logo; the AI fills named layouts as JSON. Rendered in a hidden Electron window: HTML to project, PDF via `printToPDF`, editable PPTX via **dom-to-pptx** 2.0.3 (MIT, on PptxGenJS; computed styles → native shapes, embeds fonts; fidelity on complex layouts untested), image PPTX as fallback. Zero extra footprint. ~1–1.5 weeks.
- **Option 2:** Slidev 53.1.0 (MIT) with a custom theme; Markdown authoring; ~3–5 days; adds Vite + playwright-chromium (~150 MB); `pptx` is image-only, `pptx-editable` is CLI-only and partly rasterized; developer feel.
- **Fallback for max editability:** pptxgenjs with own layout functions (native, plainer; PDF needs LibreOffice).
- **Ruled out:** Marp (plain themes, editable mode needs LibreOffice), reveal.js (basic themes, no PPTX), Quarto (Pandoc), Typst+Touying (PDF only, academic look), Spectacle; free template packs (SlidesCarnival CC-BY forbids unchanged redistribution, Slidesgo forbids bundling); Anthropic's pptx skill no longer ships html2pptx; no open-source Gamma alternative renders without its own LLM.
- **Spike (1 day):** 8-slide HTML deck, 5 layouts → dom-to-pptx + printToPDF; open in PowerPoint/Keynote; compare with Slidev pptx-editable; gate: acceptable → option 1, else image PPTX only or pptxgenjs.
- **Slidev editable PPTX, checked in official docs (sli.dev/guide/exporting, 2026-11-12):** `--format pptx-editable` rebuilds slides as native shapes: text selectable/editable, boxes movable/recolorable, presenter notes kept. Stay pictures (that element only): SVG (Mermaid, icons), canvas, iframe, video, KaTeX, CSS gradients, filters, blend modes, clip-path. A slide that cannot be rebuilt safely falls back to an image for that slide. Fonts are named, not embedded; long paragraphs may wrap differently; theme `::before/::after` decorations are dropped. Third-party blogs saying "images only" describe plain `--format pptx`. Marco likes Slidev's look.
- **Decision (Marco, 2026-11-12), provisional:** Slidev + own theme for slides. Revisited when the export module is implemented. Implications listed for that moment: Vite server process managed by the app; ~150 MB playwright-chromium unless Electron's Chromium can be reused (unverified); slide Markdown may carry Vue/JS, so content must be restricted to our layouts; theme must avoid gradients and `::before/::after` so editable PPTX matches; the teacher never sees Markdown/Vue, so in-app hand editing needs a visual per-slide editor; PPTX edits never come back; handouts, script and exams still need their own DOCX/PDF path (open).

Answers, round 6 (2026-11-12):

- **No Word.** Slidev's PDF is enough; DOCX is not needed. (Still open: handouts, script and exams are page documents, not slides; their PDF path is decided at export time.)
- **First run.** The app's job is to help the teacher work by creating their classes (no questionnaire stated).
- **Home.** Decided through the mockups.
- **Source view.** Shows the information stored about the source; the teacher can download the original if they uploaded it (the app keeps it in a folder), or open the URL for web sources.

Mockup plan (approved by Marco 2026-11-12): screens only, no code, to understand the whole flow. Screens: 1 first run (straight into "create your first class"), 2 home (options), 3 library, 4 one source, 5 subject (units + classes + states, standalone classes), 6 plan (a group of classes or the year), 7 create/edit a class (AI work, time budget, slides, script, student material; hand or AI edits), 8 exam (pick topics/sources, types, count, versions; review + key), 9 export (PDF/PPTX/HTML), 10 settings (school style, citation style, OCR mod). Style: current HH (Radix + Impeccable, `PRODUCT.md`, `DESIGN.md`), light + dark, as Artifacts. Start with home options.

Home (round 1 of mockups, 2026-11-12): Marco chose **B, subject board**. The rail is there from the start (Home, Library, Exams, Plan). Each subject is a card with its progress, its state counts and the next class, standalone classes get their own card, and "To review" sits below. This needs a teacher home template, because the core Inicio template has no rail. Also drawn: first run (one card that leads straight to "Create my first class", with 3 steps and "Create a subject" / "Start with the Library") and heavy use (8 subjects from 2 schools grouped by school, standalone classes apart, "To review" moved to the top, a "This year / Previous years" switch). Canvas: artifact L6ecCUaJuku6Cq5xnME2kL.

Years (Marco, 2026-11-12): the year lives inside each subject, not on the home. Home shows only the present, plus a quiet "Subjects you no longer teach" link. A subject has year tabs (2026 · 2025 · 2024); a past year is read-only, and each class has "Copy to 2026" and each unit "Copy the unit to 2026". A copy arrives as a draft and its sources get re-checked; copied items show "Already in 2026", and the copy in 2026 shows "Brought from 2025". Open: how a subject continues into a new year (who creates 2027 and with what).

Subject view (drawn 2026-11-12): units are collapsible cards with progress; the current unit is open with each class, its sources and its state. A subject without units shows one flat list of classes in order (classes have no dates yet), and "New unit" stays available. Exams live in an "Exams" section below the classes of each subject (states Taken, Draft, Approved; "Copy to 2026" in past years). The rail's "Exams" entry gathers the exams of every subject. The home shows no exam summary, because "To review" already surfaces pending ones.

First pass of the remaining screens (2026-11-12, one proposal each, light + dark, same canvas), waiting for Marco's comments: Library, One source, New class (request + AI-proposed sources to approve), Class editor (slides / script / student material + AI change panel), Export dialog (PDF or HTML, school style, bibliography), Exam setup and review (traceable questions, answer key, versions), Year plan (AI proposal, suggested weeks only), Settings (schools with export style, citation style, export defaults, mods incl. OCR, AI). Open: free vs suggested categories; source↔subject link;

Exams have two generation paths (Marco, 2026-11-12). Each exam starts with one choice of origin:
- **From classes.** Pick units and classes; the exam draws on what was taught plus the sources those classes used.
- **From chosen material.** Pick sources straight from the Library, with search and a category filter. No class is needed.

Both paths share the rest of the setup (question types, topics, versions, notes for the AI), and the AI cites where each question comes from. Open: whether a material-only exam must belong to a subject (the mockup saves it in one).

**Rule (Marco, 2026-11-12): everything the app can create can also be created by asking the AI.** A chat is reachable from any screen to create, edit, or ask how to do something in the app. It knows which screen the teacher is on, and what it creates arrives as a draft with an "Open" action. This is a core candidate: every harness object needs an AI path, not only a form. Options drawn: A side panel, B floating sheet, C own page.

**Decision (Marco, 2026-11-12): A.**
- On every screen the chat opens as a right-hand panel. It is opened from "Assistant ⌘J" in the top bar.
- **Every screen must be responsive:** content reflows when the chat opens or closes. With the chat closed, content uses the full width.

Decisions (Marco, 2026-11-12):
- **Narrow windows.** When the window is narrow, the chat lies on top of the screen instead of pushing it.
- **One chat for every AI interaction.** Every AI interaction goes through the same app chat, to keep the app simple to use.
  - The class editor has no AI panel of its own: changes are asked in the app chat, scoped to the open class (slide or whole class).
  - The plan's inline "ask the AI for changes" box became a button that opens the chat.

**Decision (Marco, 2026-11-12): create by form or by AI, and the AI can open the form prefilled.**
- Every object can be created two ways: by filling its form, or by asking the app chat.
- When the teacher asks the chat, the AI can open the creation form with the data it understood already filled in.
  - Fields the AI filled carry a "Filled by the AI" tag; fields it could not infer are marked "Missing".
  - The teacher completes the missing fields in the form or tells the chat; either way the form updates.
  - The main action stays disabled until required fields are complete.
- So generation forms stay forms. The AI is one more way to fill them, through the same single chat. Mockup: "The AI opens the form" in the chat row.
- Core candidate: forms must accept prefilled values with a source mark per field (AI / user / missing).

Flow review (2026-11-13): every teacher operation was traced step by step against the canvas screens (artifact ULXM45E1PZtWgUDxCj798u). 32 operations: 8 complete, 23 missing at least one screen, 1 blocked by an open question; 26 screens to draw before the demo.

Answers, round 7 (Marco, 2026-11-13):
1. **A new school year.** The subject offers "Start 2027"; the teacher picks what to bring from 2026 (units, classes, exams) and everything arrives as a draft. The same must work by asking the chat, with the AI running the operations.
2. **Approving web sources** happens where they were asked for: the source list in "New class" (Use / Discard), or cards in the chat when asked there.
3. **Library categories** are free; the AI suggests some when a source is added, and the teacher accepts or changes them.
4. **Class dates.** Classes always have an order; a date is an optional field.
5. **AI at work.** Live, but the teacher can leave and it continues in the background. Marco leans to blocking the app for inexperienced users so it is clear the request is being worked on. Mockups asked: A blocking dialog, B live editor with the rest of the app dimmed, C progress card in the chat; plus the background state (top-bar chip, progress on the class row, done notice). **Chosen: A** (2026-11-13), because a blocking dialog is the clearest for inexperienced users. It lists the steps with a progress bar; "Keep working in the background" closes it and the background state takes over. The same dialog serves exam generation and plan building.
6. **A material-only exam** may belong to a subject or stay standalone, like a standalone class.
7. **Export style** is per school, and a subject can override it.
8. **Bibliography placement** is chosen at export time.
9. **PPTX** can be downloaded, but edits made outside the app never come back.

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
| Profiles: several users per install, each with own settings, data and AI style | student | proposed | Core today: one user; dev may not need it |
| Onboarding interview (questions one at a time → a profile the AI reads every session) | student | proposed | Generic "get to know the user" setup step |
| Methods as pluggable strategies (selectable, recommendable, switchable mid-task, with their own settings) | student | proposed | Like manifest actions but chosen per session; dev "modes" are similar |
| Material processing: ingestion (PDF, photos, links) → user-confirmed text → material sheet → item ↔ fragment links → per-session loading → strict / mixed grounding with citations | student (all harnesses) | **core (Marco, 2026-10-25)** | Core does read/confirm/sheet/fragments/loading/grounding. The harness only declares what the sheet extracts and what its "items" are (student: map concepts). Spec draft: `docs/superpowers/specs/2026-10-25-material-processing-design.md` |
| Scopes: a core unit of work (topic, project) grouping tasks, notes, a per-scope notes index, material and data | student, dev | proposed (gap analysis 2026-10-25) | Core today: everything is app-wide. Material processing depends on it |
| Harness data store: typed collections in `.harness/data/<scope>/`, a schema in the manifest, MCP read/update tools, history-tracked | student, dev | proposed (gap analysis 2026-10-25) | State-only blocks keep nothing today. Map, flashcards, tickets cache |
| Harness settings: a schema in the manifest, a Settings tab, and values added to the managed `AGENTS.md` | student, dev | proposed (gap analysis 2026-10-25) | Profile tone and thresholds, per-method settings |
| Person-context file added to every session's first message | student | proposed (gap analysis 2026-10-25) | The output of the onboarding interview |
| Input blocks: a block that sends structured input back (generalizes `choices`) | student, dev | proposed (gap analysis 2026-10-25) | The learner's summary and flashcards; dev wizard |
| Task time box with a quiet wrap-up turn | student | proposed (gap analysis 2026-10-25) | Like the 80% checkpoint |
| Knowledge/progress map with evidence-based states | student (dev's AC coverage is similar) | proposed | Generic "items with state + evidence" model and view |
| Spaced-repetition scheduler (flashcards, review-due states) | student | proposed | Could be a core utility |
| User-authored content with AI correction (summaries, cards) | student | proposed | A block: user text + inline AI notes |
| Session frame: parts (warm-up/main/close), time box, goal, live evidence panel | student | proposed | Overlaps dev's stage stepper |
| Requirement coverage view (criteria ↔ evidence) | dev | proposed | Possibly generic: teacher/student goals? check later |

## Open questions across harnesses

_none yet_
