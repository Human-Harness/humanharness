# Driving modes (eco / hybrid / sport) — design

Status: Draft, awaiting Marco's review. Written 2026-11-03 from the queue item and the specs below. Nothing here is decided except what §2 quotes from earlier approved decisions: every product and UI choice is an open question in §8, with options and a recommendation.

It builds on resources: models and context (`2026-10-12-resources-models-context-design.md`), task modes (`2026-10-25-task-modes-design.md`), parallel tasks and jobs (`2026-10-27-parallel-tasks-and-jobs-design.md`), tools and recipes (`2026-10-28-tools-and-recipes-design.md`, whose §16 and D8 point here), replaceable parts (`2026-10-29-replaceable-parts-design.md`, whose D4 and §11 point here) and the subagent policy plan (`docs/superpowers/plans/2026-11-02-subagent-policy.md`, whose D5 points here).

## 1. Why

Pillar 3 says a harness brings the person close to the best result with close to the best use of their resources. Today that balance is set in many separate places, each with its own owner:

| Knob | Who sets it today | Where |
|---|---|---|
| Model tier per task | Manifest `tier`, then the person per action in Settings › Modelos | `packages/policies/src/model.ts` (`resolveProfile`), `config.json` → `models` |
| Deterministic work vs AI | The harness author: `pre` steps on actions, `steps` (recipe) or `prompt` on jobs, `when` and `maxAi` on the AI step | `packages/shell/src/main/tools/pre-steps.ts`, `packages/shell/src/main/jobs/recipe-runner.ts`, `packages/harness-sdk/src/jobs.ts` |
| Tools the agent may call | The tool author, per tool: `agent: "call" \| "none"` | `packages/harness-sdk/src/tool.ts`, `packages/shell/src/main/tools/tools-host.ts` |
| Job frequency and spend | Manifest `on.every` and `dailyTokens`; the person may turn a job off or change its cap in Settings › Jobs | `packages/shell/src/main/jobs/job-scheduler.ts`, `config.json` → `jobs` |
| Subagents | Manifest `permissions.subagents`, or a scope preset's `agentsFile` | `packages/engines/src/claude/transport.ts` (`disallowedTools`, `subagentAgents`) |

A person who wants "spend less this week" or "give me the strongest answer, I don't care what it costs" has to understand and change each of these. Driving modes are one setting that moves all of them together, with a car/fuel metaphor: **eco** saves fuel, **sport** spends it for power, **hybrid** sits between.

The measured weight of the knobs, from earlier work:

- A turn reads 96k–257k tokens and writes 1.3k–2.8k (`usage.jsonl` on the demo, tools spec §1). Most spend is reading, so tier and how much the agent explores dominate.
- In Marco's own Claude Code baseline, subagents were 79% of the cost, 96% of them on Opus (subagent plan, "Why now").
- A light AI job every 30 minutes for 8 hours is 2.5M–3.5M tokens a day (tools spec §1, Claude's estimate).
- The warm-prefix spike (`docs/spikes/2026-11-02-warm-prefix.md`) found the shared prompt prefix already cache-hit across sessions; a fork would save only ~4–6k tokens a task. So driving modes should not count on session reuse as a saving lever.

## 2. Already decided elsewhere

These are quoted, not decided here.

- **Subagents (subagent plan D5, Marco, 2026-11-02):** eco → subagents denied, sport → subagents allowed. The flag `permissions.subagents` exists now (`packages/harness-sdk/src/index.ts:232`). Hybrid is not decided (Q6).
- **Tiers are fixed per task (resources spec D2).** A task's tier, model, effort and cap never change mid-task, so the prompt cache holds. Settings changes apply to the next task.
- **Policies are picked in `config.json`, no UI yet (replaceable-parts D4).** "The visible selector comes with the driving modes spec." Replaceable-parts §11 describes driving modes as "a user setting that picks a combination of policies, with the selector UI".
- **Tools spec D8:** tools with effects outside the folder should be `agent: "none"`; "a future driving modes setting may override this default".
- **A recipe run has at most 3 AI steps** (`MAX_AI_CAP`, tools spec D6), and code, never the AI, decides when more AI runs.

## 3. What a mode is, mechanically

Whatever the answers to §8, a mode is a named bundle of values for the knobs in §4. The bundle is read when a task or job run starts and stays fixed for it, like the policy ids today (`packages/shell/src/main/task-manager.ts`, around line 1860: "The policy ids are read once here and kept to the task's end").

Two ways to wire the bundle exist in the current code. Which one is Q2:

- **(a) A mode names policy ids.** `config.json` already has `policies: { model?, context? }` (`packages/protocol/src/views.ts`, `PolicyIds`), cleaned by `cleanPolicies` (`packages/shell/src/main/config.ts`), and each id is looked up in the registry (`packages/policies/src/registry.ts`). An `eco` `ModelPolicy` would be registered with `registerModelPolicy` and selected by id. This covers tiers and the subagent model, and nothing else: there is no policy seam for tools, recipes, jobs or subagent permission.
- **(b) A mode is its own input.** A new `mode` value is passed to the places that decide each knob (the model pick, the tools catalogue, the recipe runner, the job scheduler, the transport's permissions). This needs new fields in `PickInput` and in each of those callers.

## 4. The knobs and their seams

For each knob: the seam in today's code, and what is missing. What each mode does to the knob is in §8.

### 4.1 Model tiers

- **Seam:** `ModelPolicy.pick` (`packages/policies/src/model.ts`). It takes `engine`, `action`, `manifestTier`, a fixed `tier`, the person's `models` table and a `floor` (a task mode's `minTier`). `DefaultModelPolicy` applies: the person's custom setting, else the person's tier for the action, else the manifest's, else `standard`; then the floor raises it.
- **Wiring:** the shell calls the policy through `profileFor` (`packages/shell/src/main/index.ts`, around line 1522), with the task's policy ids. Job runs reach the same `profileFor` (`index.ts`, around line 1946); a recipe's AI step asks for its tier through `profileFor` in `packages/shell/src/main/jobs/ai-step.ts`. The Sidekick passes a fixed `tier` (comment on `PickInput.tier`).
- **What exists for a mode:** an eco policy could move a tier down and a sport policy up inside `pick`, since it sees every input. `fallback` already walks deep → standard → light → the engine's default.
- **Missing:** `PickInput` has a floor but no ceiling and no mode. A mode that must stay under a tier (eco "never deep") needs either its own policy or a new input. Nothing records the mode on the task profile today.
- **Collision:** a task mode's `minTier` floor (task-modes spec §5.3) and a driving mode's tier change can disagree (Q8).

### 4.2 Recipes (deterministic) vs free AI

- **Seams that exist:**
  - Pre-steps run before the session opens and their results go into the first message (`packages/shell/src/main/tools/pre-steps.ts`, `prepared-section.ts`). The `ContextPolicy` start plan decides whether the `"prepared"` part is in the first message and its budget (`packages/policies/src/context.ts`, `StartPart`).
  - A recipe's AI step runs only when its `when` holds (`packages/shell/src/main/jobs/recipe-runner.ts`, `whenHolds`, around line 160), and at most `maxAi` times (`packages/harness-sdk/src/jobs.ts`, `maxAi`, capped by `MAX_AI_CAP`).
  - A job is either an AI job (`prompt`) or a recipe (`steps`); `jobUsesAi` tells them apart (`packages/harness-sdk/src/jobs.ts`).
- **Missing:** there is no place where the same work has both a recipe path and a free-AI path to choose between. An action has one prompt plus optional pre-steps; a job has a prompt or steps, never both (tools spec §3.3). So today a mode can only narrow what the author declared (fewer AI rounds, skip an AI step, pause AI jobs, drop the prepared data), not pick a different path. A real "recipe vs free AI" switch needs a manifest addition (Q4, Q12).

### 4.3 Tools the agent may call

- **Seam:** two checks key on a tool's `agent` field. The catalogue the `tools` MCP server serves keeps only `agent === "call"` tools (`packages/shell/src/main/tools/tools-host.ts`, `writeCatalogue`, around line 390), and the registry refuses an agent call to an `agent: "none"` tool (`packages/shell/src/main/tools/tool-registry.ts`, around line 214).
- **Granularity:** the catalogue is one file per workspace (`<userData>/tools-catalogue/<harness-id>.json`), not per task, and the server reads it when it launches (`packages/blocks/src/tools-server.ts`). A mode change would rewrite that file; a running session keeps the server it started with.
- **Missing:** nothing marks which `"none"` tools have effects outside the folder and which were hidden for other reasons; tools spec D8 only says the former "should be" `"none"`. Opening `"none"` tools to the agent in a mode also touches the out-of-scope item "the agent calling tools with effects outside the folder after asking the person" (tools spec §16).

### 4.4 Job frequency

- **Seam:** the scheduler arms each `every` job with `parseEvery(job.on.every)` and pauses it for the day at its cap (`packages/shell/src/main/jobs/job-scheduler.ts`, around lines 75 and 106–167). Settings › Jobs stores `{ off?, dailyTokens? }` per job (`JobSettings`, `packages/protocol/src/views.ts`; `cleanJobSettings`, `packages/shell/src/main/config.ts`). The shortest interval is 15 minutes (`EVERY_MIN_MS`, `packages/harness-sdk/src/jobs.ts:5`).
- **What exists for a mode:** turning a job off, and a lower daily cap, already have storage and scheduler support.
- **Missing:** no per-person interval override exists; `every` comes only from the manifest. A mode that stretches intervals needs a new field the scheduler reads. A recipe job with no AI step costs 0 tokens (tools spec §7.4), so slowing it saves nothing; whether a mode should touch it is Q5.

### 4.5 Subagents

- **Seam:** the Claude transport denies `Task` and `Agent` unless subagents are allowed (`disallowedTools`, `packages/engines/src/claude/transport.ts:45`, used around line 246), and when allowed passes `--agents` with a `general-purpose` definition on one tier below the task (`subagentAgents`, around line 208; `subagentModelFor`, `packages/policies/src/model.ts`). A preset's `agentsFile` replaces that.
- **Narrowing exists, widening does not:** `narrowPermissions` (`packages/harness-sdk/src/parallel.ts`) turns a permission off but never on; `subagents: true` needs the harness's opt-in. So eco → deny maps onto an override with `subagents: false`. Sport → allow, for a harness whose manifest does not opt in, would need a new widening path, against subagent plan D1 (Q6).
- **Gap:** Codex and OpenCode run over ACP with no subagent gating (`packages/engines/src/acp`, no subagent handling; subagent plan slice 5). A mode's subagent rule applies on Claude only until that slice lands.

### 4.6 Measuring

`usage.jsonl` lines already carry `tier`, `model`, `effort`, `cap`, the task mode (`mode`), the job id, the turn kind (`subagent` included) and non-default `modelPolicy` / `contextPolicy` (`packages/shell/src/main/usage-log.ts`, `UsageMeta`, `policyMeta`). The tools spec adds `pre`, `recipe` and `expects-miss` rows (§8.4). Settings › Usage shows real money only for engines that report it (`packages/ui/src/UsageTab.tsx`, `spentUsd`, OpenCode spec §4). Nothing records a driving mode; the field name `mode` is already taken by task modes (Q10, Q11).

## 5. Flow (common to every answer)

1. The person picks a mode (where: Q1, Q3).
2. The next task or job run reads the mode once at its start and keeps it (resources spec D2; Q7 for running tasks).
3. Each knob's seam (§4) applies the mode's value.
4. The turn's usage lines record the mode (Q11), so savings can be measured before any claim is made, as the tools spec requires.

## 6. Out of scope

- Plan quota management (Claude's five-hour window) and automatic mode switching when quota runs low.
- Warm base sessions (fork per task): the spike recommends not building them for Claude now.
- Subagent gating on Codex and OpenCode (subagent plan slice 5).
- Tools learned from use (JIT), and the agent calling `"none"` tools after asking the person (tools spec §16), beyond what Q12 decides.
- A new `ContextPolicy` behaviour (different checkpoint share, smaller notes index) unless Q9 asks for one.
- Translation of labels: language-on-demand covers it once copy is decided.

## 7. Depends on

- **On master:** the policy registry (`packages/policies`), `permissions.subagents` and `narrowPermissions`, tools and recipes (registry, catalogue, pre-steps, recipe runner), the job scheduler and Settings › Jobs, `usage.jsonl` with subagent lines.
- **Not yet:** the UI refresh (`2026-10-30-ui-refresh-design.md`) if the selector lives in its top bar or settings layout (Q1); the closed-world style guide for any new control; subagent plan slice 5 for Codex/OpenCode parity; a first `expects-miss` / `pre` / `recipe` measurement on the demo, so a mode's savings can be shown with numbers.

## 8. Open questions

Each question lists options, trade-offs and a recommendation. None is decided. UI questions also offer "Leave for later".

**Q1 (UI). Where does the selector live?**
- A. Settings › General, one segmented control. Quiet, rarely changed; the person may forget it is on eco.
- B. The top bar, always visible, like a car's mode indicator. Constant reminder of the trade-off; uses scarce top-bar space the UI refresh already plans.
- C. Settings › Modelos, as a header above the per-task tiers. Near the knob it changes most; hides that it also moves jobs, tools and subagents.
- D. Leave for later.
- Recommendation: A for the setting plus a small read-only indicator wherever the UI refresh shows status, decided with the refresh. Each option needs a mockup as an Artifact before deciding.

**Q2. How is a mode wired: policy ids, or its own input?** (§3)
- A. A mode is a preset of policy ids (`policies.model`, `policies.context`) plus new fields for tools, jobs and subagents. Reuses the registry; the bundle is split across two mechanisms.
- B. A mode is one new `config.json` value passed to every seam, and policies read it as an input. One concept; touches `PickInput` and every caller.
- C. A mode is a new kind of registered part (a "driving policy") that returns values for all knobs. Most uniform and replaceable; most new code.
- Recommendation: B. The knobs outside model choice have no policy seam, and "fixed at task start" already exists for one value.

**Q3. Scope of the setting.**
- A. One value per app (each harness is its own app, so per harness), in `config.json`.
- B. Per app, plus a one-task override at Start ("this one in sport").
- C. Per action, like tiers today.
- Recommendation: B. A single switch matches the metaphor; a one-off override covers "this one matters". C repeats Settings › Modelos.

**Q4. What does each mode do to model tiers?**
- A. Hybrid = today's resolution unchanged; eco = one tier down (deep → standard, standard → light), never below light; sport = one tier up, never above deep.
- B. Eco caps at standard (no deep), sport floors at standard (no light); the middle stays.
- C. Eco forces light, sport forces deep, ignoring the action's tier.
- Recommendation: A. It keeps the author's relative ordering between actions, and hybrid changes nothing on upgrade.

**Q5. What does each mode do to jobs?**
- A. Eco pauses AI `every` jobs (recipe jobs with no AI step keep running, they cost 0); hybrid unchanged; sport unchanged.
- B. Eco doubles every interval and halves `dailyTokens`; sport halves intervals down to the 15-minute floor.
- C. Eco lowers only `dailyTokens`; intervals stay.
- D. Modes don't touch jobs; Settings › Jobs stays the only control.
- Recommendation: A. It needs no new interval field, reuses `off`, and the cheap deterministic part keeps panels fresh. B needs a per-person interval override that does not exist (§4.4).

**Q6. Subagents in hybrid, and sport on a harness that did not opt in.**
- A. Hybrid = today's rule (manifest or preset decides); sport allows only where the harness opted in; eco denies everywhere, presets included.
- B. Same as A, but eco leaves presets with `agentsFile` alone (they expect `Task`).
- C. Sport allows on every harness, widening past the manifest. Against plan D1, needs a new widening path.
- Recommendation: B. A preset that ships agents breaks without them; D1's opt-in stays the author's.

**Q7. A mode change while tasks run.**
- A. Applies to the next task and job run only; running tasks keep their mode.
- B. Also ends running AI jobs' `every` timers at once (no task is touched).
- C. Asks whether to restart running tasks.
- Recommendation: A, plus B for jobs, since a timer reads the mode at each run anyway.

**Q8. A task mode's `minTier` versus eco.**
- A. The task mode's floor wins: eco never lowers below `minTier`.
- B. Eco wins; the task-mode switch shows its existing "this mode needs a higher tier" notice.
- C. The person's explicit per-action tier or custom model in Settings › Modelos wins over both.
- Recommendation: A for the floor, and C for an explicit custom model: a person who set a model by hand meant it.

**Q9. Does a mode change the context policy?**
- A. No; context stays the default in every mode.
- B. Eco lowers budgets (smaller prepared data, notes index), sport raises them.
- C. Eco checkpoints earlier, to keep sessions smaller.
- Recommendation: A for the first version. No measurement yet says which budget moves spend.

**Q10 (UI). Name and labels.** "Mode" is already the task modes' word, and `mode` is a `usage.jsonl` field.
- A. "Driving mode" / "Modo de manejo" with Eco / Híbrido / Sport.
- B. "Power" / "Potencia" with Ahorro / Equilibrado / Máximo.
- C. "Fuel" / "Consumo" with the car labels.
- D. Leave for later.
- Recommendation: A in code and docs (`drivingMode`), with copy decided against the closed-world style guide; the car labels need a one-line explanation each.

**Q11 (UI). How the cost of a mode is shown.**
- A. Nothing beyond today's Settings › Usage; usage lines gain `drivingMode` for later analysis.
- B. Each mode shows a measured estimate ("about N tokens a day last week in this mode") once data exists.
- C. Each mode shows a static description of what it changes, no numbers.
- D. Leave for later.
- Recommendation: C now, B once there is a week of data per mode; the `drivingMode` field in A in any case, since nothing can be claimed without it.

**Q12. Does sport open `agent: "none"` tools to the agent, and does eco hide `agent: "call"` tools?**
- A. Neither: tools stay as the author declared. The tools knob is dropped.
- B. Eco hides nothing (hiding tools makes the agent explore by hand, which costs more); sport opens `"none"` tools only when they declare no outside effect, which needs a new manifest marker.
- C. Sport opens all `"none"` tools, each call asking the person first.
- Recommendation: A for the first version. Hiding tools in eco works against saving, and opening outside-effect tools is a permission question the tools spec put out of scope.

**Q13. Default mode, and upgrade.**
- A. Hybrid, defined as exactly today's behaviour, so an upgrade changes nothing.
- B. Eco, to protect new users who don't know the costs.
- C. The harness author picks a default in the manifest.
- Recommendation: A.

**Q14. Can a harness author constrain modes?**
- A. No; it is the person's setting only.
- B. An action may declare a minimum mode or a fixed tier that eco cannot lower (beyond `tier`).
- C. A harness may hide the selector.
- Recommendation: A. `tier`, `minTier` and `permissions.subagents` already let the author state needs; add B only when a harness shows a case.

**Q15. Which processes follow the mode?** Tasks and jobs, surely; the others are open.
- A. Tasks and jobs only. Sidekick, material processing, translation and setup keep their own tiers.
- B. Everything that runs a model.
- C. Tasks, jobs and the Sidekick.
- Recommendation: A. Those processes have their own tier rules in their specs (not checked one by one for this draft), and the person thinks of the mode as "how my work runs".
