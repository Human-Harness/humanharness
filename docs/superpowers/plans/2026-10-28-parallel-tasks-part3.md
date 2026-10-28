# Parallel tasks and jobs, part 3 (background jobs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship slices 5 and 6 of the parallel-tasks spec (§13): background jobs declared in the manifest. They run with no chat and no person in the loop, on four triggers (`start`, `manual`, `afterTask`, `every`), within their own cap, deduped, with a daily token cap for periodic runs. Each run ends with a `job_result` block and is logged in `.harness/jobs.jsonl`. They show in the inbox's Jobs section and in Settings › Jobs. A harness without `jobs` is byte for byte today's app.

**Architecture.**

*Manifest and the job tool.*
- `packages/harness-sdk/src/jobs.ts` adds the `jobs` schema and its checks (spec §3), plus `jobResultSchema`.
- The `ui` MCP server, started with `HH_JOB=1` (part 1 gives job slots that variable), adds a `job_result` tool. It refuses `choices`, input blocks, `set_phase` and `save_note` with the spec's message.
- `job_result` is **not** in `allBlocks`. `allBlocks` feeds AGENTS.md, which must stay the same (D0). It reaches the agent only on a job slot, and the job's first message explains it.

*Running jobs.* `packages/shell/src/main/jobs/`:
- **`job-log.ts`**: `.harness/jobs.jsonl`, plus today's tokens per job, for the daily cap.
- **`job-prompt.ts`**: a run's first message. It is the job's brief, then the same notes index and data tables an action's first message carries, built with the `TaskManager` deps `index.ts` already has (`notes`, `dataContext`, `materialContext`), then the `job_result` instructions.
- **`job-runner.ts`**: runs one job run on a `job:<run id>` slot of the workspace, through the `TurnGate`'s `jobs` cap:
  - it records usage (`phase: "job"`, `job: <id>`) and the run in `jobs.jsonl`;
  - commits carry `Task: <run id>`, `Job: <job id>`, `Scope:` (part 1's turn commit does this through the trailer);
  - a run without `job_result` is `failed`, "No result".
- **`job-scheduler.ts`**: the triggers. `start` runs after setup once per app start; `manual` comes from `client.jobs.run`; `afterTask` comes from a new optional `TaskManager` dep `taskClosed`, called when a task's note is saved; `every` is a main-process timer. The scheduler also dedupes per job and scope, and enforces the daily cap.

*Host modes.* The shell gains a third mode:
- `plain` (D0);
- `single`: `jobs` without `parallel`. Today's single-task UI, but the runtime is a workspace with a `"main"` slot for the task plus job slots;
- `board` (part 2).

In `single` mode the existing `TaskManager` and `TurnController` stay as they are. Only `runtime` becomes `createWorkspace` + `openSlot("main")`, wrapped in the same `HarnessRuntime` shape that `createRuntime` returns. A gate with `tasks: 1` keeps one task turn at a time and runs jobs beside it.

*Results.* A `needs-you` result raises an attention item `{ kind: "job", id: <job>:<scope> }` whose target is `{ action, scope }`. The inbox's Jobs section lists each job × scope: last run, status, summary, next run, and why it is paused, with "Run now" for manual jobs. Settings › Jobs lets the person turn a job off and change its daily cap.

**Tech Stack:** TypeScript, zod 4, MCP SDK (`ui` server), Electron main timers, React 19, Vitest, fake-claude, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-27-parallel-tasks-and-jobs-design.md`: §3 (`jobs`), §8, §9 (Jobs section, `client.jobs`), §10 (usage, quit, engine switch for jobs), §11, §13 slices 5–6. Builds on parts 1–2. **Branch:** `feat/parallel-tasks` (continues).

---

## Conventions

As in parts 1 and 2 (worktree, commands, no install, git rules, trailer, en.json only in `"parallel"`, hot files additive). Trailer:

```
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv
```

## D0 is a hard rule

A harness without `jobs` runs no part-3 code:
- no scheduler, no timers, no `jobs.jsonl`;
- no `job_result` tool, and the `ui` server registers exactly today's tools;
- no `Job:` trailers;
- no usage `job` field, and usage lines byte-identical;
- no Settings › Jobs tab, no Jobs section content.

A harness without `parallel` and without `jobs` stays on the `plain` path.

| D0 item | Test |
|---|---|
| `allBlocks` and AGENTS.md unchanged by `jobs` | `jobs.test.ts`: `allBlocks(h)` equal with and without `jobs`; `instructions` golden test stays green (Task 2) |
| `ui` server tools unchanged without `HH_JOB` | `ui-server.test.ts`: the tool list for a task slot equals today's (Task 2) |
| No scheduler without jobs | `job-scheduler.test.ts`: `createScheduler` with no jobs sets no timer (Task 6) |
| Host mode | `board-host.test.ts`: `hostMode` stays `"plain"` without `parallel`/`jobs`; `"single"` with jobs only (Task 7) |
| Usage lines | `usage-log.test.ts`: a task line without `job` serialises exactly as before (Task 11) |
| `TaskManager` without `taskClosed` | `task-manager.test.ts` stays green; a new test calls nothing when the dep is absent (Task 6) |
| UI | `jobs-ui.test.tsx`: no Jobs tab and an empty "No jobs" section without `state.jobs` (Tasks 8, 10) |

## Threat model (part 3)

| # | Boundary | What enforces it | Test |
|---|---|---|---|
| J1 | A job can never ask the person or wait for them | job-mode `ui` server refuses `choices`, input blocks, `set_phase`, `save_note`; the engine's permission requests are answered by the slot's permission policy (never forwarded), so a run never hangs | `ui-server-job.test.ts` (Task 2); `job-runner.test.ts` time-out test (Task 5) |
| J2 | A job only narrows permissions | `jobsSchema` refuses a widening at load (`check`); the slot uses `narrowPermissions` (part 1) | `jobs.test.ts` (Task 1) |
| J3 | `job_result.action` names a real action | `JobRunner` keeps `action` only when `Object.hasOwn(harness.actions, action)`; else drops it and logs | `job-runner.test.ts` (Task 5) |
| J4 | `client.jobs.run(id, scope)` from the window only starts a declared manual job in an existing scope | `Object.hasOwn(harness.jobs, id)`, `job.on.manual`, `scopeExists(scope)`; ids ≤ 200 chars | `jobs-ipc` test (Task 9) |
| J5 | A periodic job can't spend without bound | daily cap from `jobs.jsonl`; `every` ≥ 15 min (schema) | `job-log.test.ts`, `job-scheduler.test.ts` (Tasks 3, 6) |
| J6 | A job run can't run forever | a run time limit (Decision 8) cancels it, logged `failed` "Timed out" | `job-runner.test.ts` (Task 5) |

## Decisions this plan takes where the spec leaves room

1. **`job_result` is not a core block in `allBlocks`.** It is registered only by the job-mode `ui` server. Its instructions go in the job's first message, so AGENTS.md is unchanged.
2. **Usage lines say `phase: "job"`, `job: <id>`.** The spec's `kind: "task" | "job"` clashes with `UsageRecord.kind` (`"checkpoint" | "compaction"`, already used). `TurnKind` gains `"job"` and the record gains `job?: string`. Task lines stay byte-identical. Settings › Uso splits jobs out by `phase === "job"`.
3. **Run ids** are `randomUUID()`. A run commits with `Task: <run id>`, `Job: <job id>` and `Scope: <scope>` when scoped. In "Undo this task" a run's commits group under its run id, labelled with the job's label (`historyView` labels it from `Job:`).
4. **`save_note` is refused in a job** (spec: "a job saves no note"). The refusal text: "A background job saves no note; end with job_result."
5. **Permission requests in a job.** The ACP transport already answers every permission request from the slot's policy, without asking the person (`decidePermission`). For Claude, `-p` denies a tool outside `--allowedTools` without asking (spike PT-S2). So a job never hangs on permission. The spec's exact denial text ("A background job cannot ask for permission") is used where the core writes one: ACP denials in a job slot get it as the `reject` reason, if the ACP response carries a message field. Otherwise they are denied as today.
6. **`afterTask`** fires on a task whose note was saved (`TaskManager.endTask(id, "done")`), through a new optional dep `taskClosed(task)`. A task cancelled or ended unfinished doesn't trigger it.
7. **`start` runs once per app start, after setup.** That is: the first time the app is configured (folder, engine, profile when there are profiles) in this process. Jobs with `scope: "each"` run once per active scope.
8. **A run's time limit** is 15 minutes, not in the spec. A run that exceeds it is cancelled and logged `failed`, "Timed out". A constant (`JOB_RUN_MAX_MS`); tests pass a short one.
9. **Daily cap day** is the local calendar day of the run's start (same as Settings › Uso's day). A run's tokens are counted when it ends.
10. **Mock mode:** a job's turn is answered by a canned `job_result` (`{ status: "ok", summary: "Mock run" }`) via the fake-agent marks, as Sidekick turns are. Tests that need other results use fake-claude scripts.
11. **Engine switch and quit** (spec §10): running job runs are cancelled (logged `failed`, "Cancelled"); the jobs queue is dropped; `start` jobs run again at the next start.
12. **`single` mode** (jobs without `parallel`): one person task at a time as today, with the plain task UI. The runtime is a workspace with slot `"main"` + job slots. The `TurnGate` has `tasks: 1`. A task turn and a job turn may overlap, so attribution (part 1) applies. Job commits carry `Job:` trailers. The task's commits stay today's whenever no job ran in between.

## File structure

| File | Change | Responsibility |
|---|---|---|
| `packages/harness-sdk/src/jobs.ts` | Create | `jobsSchema`, checks, `jobResultSchema`, `JOB_RESULT_TOOL`, `parseEvery` |
| `packages/harness-sdk/src/index.ts` | Modify | `jobs` key, re-export, refinements |
| `packages/blocks/src/ui-server.ts`, `ui-server-bin.ts` | Modify | job mode |
| `packages/cli/src/check.ts` | Modify | findings for jobs |
| `packages/shell/src/main/jobs/job-log.ts` | Create | `jobs.jsonl`, tokens today |
| `packages/shell/src/main/jobs/job-prompt.ts` | Create | first message |
| `packages/shell/src/main/jobs/job-runner.ts` | Create | one run |
| `packages/shell/src/main/jobs/job-scheduler.ts` | Create | triggers, dedupe, caps |
| `packages/shell/src/main/jobs/jobs-host.ts` | Create | wiring: workspace slots, gate, attention, IPC answers |
| `packages/shell/src/main/task-manager.ts` | Modify | optional `taskClosed` dep (one call) |
| `packages/shell/src/main/board-host.ts`, `index.ts` | Modify | `single` mode, jobs host, IPC |
| `packages/shell/src/main/usage-log.ts` | Modify | `"job"` kind, `job` field |
| `packages/workspace/src/layout.ts` | Modify | `jobsFile` |
| `packages/ui/src/client.ts`, preload, fake client | Modify | `JobSummary`, `client.jobs`, `AppState.jobs` |
| `packages/ui/src/parallel/Inbox.tsx`, `JobsTab.tsx`, `SettingsSheet.tsx`, `UsageTab.tsx` | Modify/Create | Jobs section, Settings › Jobs, usage split |
| `packages/fake-agent/src/mock-replay.ts` (or the mock's mark table) | Modify | canned job reply |
| `packages/fake-agent/fixtures/parallel-harness/` | Modify | jobs |
| `packages/e2e/tests/jobs.spec.ts` | Create | e2e |
| docs | Modify | architecture (jobs), guide, template |

## Overlaps with other in-flight plans

- **Plan 17** adds TurnKind `"context-add"`, and this part adds `"job"`. Both are one-word additions to the same union, and a merge keeps both. Plan 17's context panel doesn't apply to job runs (no chat).
- **Plan 16**'s file timeline shows job commits; `Job:` is parsed by part 1's `parseCommitMessage`.

## Open questions (each with the default this plan takes)

1. `ui: { inbox: false }` → top-level `inbox` (part 2 Decision 1).
2. Usage `kind` clash → `phase: "job"` + `job` (Decision 2).
3. `save_note` refused in jobs (Decision 4).
4. A job run's time limit, 15 min (Decision 8): not in the spec.
5. Mock jobs answer canned `ok` (Decision 10).
6. A `needs-you` item's "start the named action" uses the action's normal start (a new task, in board mode a new lane). In `single` mode, starting it closes the open task as any start does today.

## Standing rules
As in part 1. English UI strings (plan 5a): "Run now", "Paused until tomorrow", "Last run", "Next run", "Needs you", "Failed", "OK", "No result", "Timed out", "Cancelled".

---

### Task 0: This plan

- [ ] **Step 1:** Copy `/private/tmp/claude-501/-Users-marcozanger-Documents-workspace-humanharness--claude-worktrees-plan-scopes-data/e2d9762b-c53e-4c2d-9cc2-c4e0683ef9d2/scratchpad/pt/2026-10-28-parallel-tasks-part3.md` to `docs/superpowers/plans/2026-10-28-parallel-tasks-part3.md`.

- [ ] **Step 2: Commit**

```bash
git -C <worktree> add docs/superpowers/plans/2026-10-28-parallel-tasks-part3.md
git -C <worktree> commit -m "docs(plans): parallel tasks and jobs, part 3

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 1: `jobs` in the manifest, with its checks

**Files:**
- Create: `packages/harness-sdk/src/jobs.ts`
- Modify: `packages/harness-sdk/src/index.ts`, `packages/harness-sdk/src/parallel.ts` (`isConcurrent` counts jobs), `packages/cli/src/check.ts`
- Test: `packages/harness-sdk/test/jobs.test.ts`, `packages/cli/test/check.test.ts` (append)

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/harness-sdk/test/jobs.test.ts
import { describe, expect, it } from "vitest";
import { allBlocks, defineHarness, hasJobs, isConcurrent, jobResultSchema, parseEvery } from "../src";

const base = {
  id: "t", name: "T", core: "^0.1.0", engines: ["claude"], folder: { suggested: "Documents/T" }, instructions: "./AGENTS.md",
  permissions: { edit: "folder" as const, exec: true, web: false }, blocks: {}, author: "x",
  actions: { implement: { label: "Implement", prompt: "./prompts/implement.md" } },
};
const job = (extra: object = {}) => ({ label: "Sync", prompt: "./jobs/sync.md", on: { manual: true }, ...extra });

describe("jobs schema (parallel spec §3)", () => {
  it("D0: absent; allBlocks unchanged by jobs (Decision 1)", () => {
    const h = defineHarness(base);
    expect("jobs" in h).toBe(false);
    expect(hasJobs(h)).toBe(false);
    expect(Object.keys(allBlocks(defineHarness({ ...base, jobs: { sync: job() } })))).toEqual(Object.keys(allBlocks(h)));
  });
  it("defaults: tier light, scope none", () => {
    expect(defineHarness({ ...base, jobs: { sync: job() } }).jobs?.sync).toMatchObject({ tier: "light", scope: "none" });
  });
  it.each([
    ["an id clashing with an action", { implement: job() }, "clashes"],
    ["a bad id", { "Bad Id": job() }, undefined],
    ["every under 15m", { s: job({ on: { every: "10m" }, dailyTokens: 1000 }) }, "15m"],
    ["every without dailyTokens", { s: job({ on: { every: "30m" } }) }, "dailyTokens"],
    ["afterTask naming no action", { s: job({ on: { afterTask: ["nope"] } }) }, "nope"],
    ["scope each without scopes", { s: job({ scope: "each" }) }, "scopes"],
    ["no trigger at all", { s: job({ on: {} }) }, "trigger"],
    ["a widening permission", { s: job({ permissions: { exec: true, web: true } }) }, "narrow"],
  ])("refuses %s", (_n, jobs, message) => {
    const run = () => defineHarness({ ...base, jobs: jobs as never });
    if (message) expect(run).toThrow(message);
    else expect(run).toThrow();
  });
  it("scope trigger needs afterTask or manual and nothing else (with scopes)", () => {
    const scoped = { ...base, scopes: { label: "Project", plural: "Projects" } };
    expect(() => defineHarness({ ...scoped, jobs: { s: job({ scope: "trigger", on: { manual: true, start: true } }) } } as never)).toThrow("trigger");
    expect(defineHarness({ ...scoped, jobs: { s: job({ scope: "trigger", on: { afterTask: true } }) } } as never).jobs?.s.scope).toBe("trigger");
  });
  it("a job makes the harness concurrent", () => {
    expect(isConcurrent(defineHarness({ ...base, jobs: { sync: job() } }))).toBe(true);
  });
});

describe("parseEvery", () => {
  it("minutes and hours", () => {
    expect(parseEvery("15m")).toBe(15 * 60_000);
    expect(parseEvery("2h")).toBe(2 * 3_600_000);
    expect(parseEvery("90")).toBeNull();
  });
});

describe("jobResultSchema (spec §8)", () => {
  it("status, summary up to 300 characters, optional action", () => {
    expect(jobResultSchema.parse({ status: "needs-you", summary: "2 tickets without AC", action: "implement" })).toBeTruthy();
    expect(() => jobResultSchema.parse({ status: "maybe", summary: "x" })).toThrow();
    expect(() => jobResultSchema.parse({ status: "ok", summary: "x".repeat(301) })).toThrow();
  });
});
```

(The spec writes `label: { es, en }`. Labels in this codebase are English strings (plan 5a), so `label` is a string, as actions' are. Adjust if `actions[].label` accepts a record.)

In `check.test.ts`, add a case where `humanharness check` on a fixture with a widening job reports the finding, and a case where it reports a job prompt that doesn't exist, mirroring an existing prompt-missing finding.

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: Implement** `packages/harness-sdk/src/jobs.ts`:

```ts
import { z } from "zod";

/** The shortest `every` interval (parallel spec §3). */
export const EVERY_MIN_MS = 15 * 60_000;
export const JOB_RESULT_TOOL = "job_result";
/** What the agent reads when a job tries to ask the person (spec §8). */
export const JOB_CANNOT_ASK = "A background job cannot ask the person; end with job_result.";
export const JOB_NO_NOTE = "A background job saves no note; end with job_result.";

/** "15m", "2h" → milliseconds; null for anything else. */
export function parseEvery(s: string): number | null {
  const m = /^(\d{1,4})(m|h)$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * (m[2] === "h" ? 3_600_000 : 60_000);
}

const permissionsOverride = z.object({ edit: z.enum(["folder", "none"]).optional(), exec: z.boolean().optional(), web: z.boolean().optional() }).strict();

export const jobSchema = z.object({
  label: z.string().min(1).max(80),
  prompt: z.string().min(1),
  tier: z.enum(["light", "standard", "deep"]).default("light"),
  on: z
    .object({
      start: z.boolean().optional(),
      manual: z.boolean().optional(),
      afterTask: z.union([z.literal(true), z.array(z.string()).min(1)]).optional(),
      every: z.string().optional(),
    })
    .strict(),
  scope: z.enum(["none", "each", "trigger"]).default("none"),
  dailyTokens: z.int().min(1).optional(),
  permissions: permissionsOverride.optional(),
});
export type HarnessJob = z.output<typeof jobSchema>;

export const jobsSchema = z.record(z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/), jobSchema);

/** The `job_result` block (spec §8): ends a run. */
export const jobResultSchema = z.object({
  status: z.enum(["ok", "needs-you", "failed"]),
  summary: z.string().min(1).max(300),
  action: z.string().max(64).optional(),
});
export type JobResult = z.output<typeof jobResultSchema>;

export const hasJobs = (h: { jobs?: Record<string, unknown> }): boolean => !!h.jobs && Object.keys(h.jobs).length > 0;

/** Each problem of the manifest's jobs (spec §3 checks), for `superRefine` and `humanharness check`. */
export function jobProblems(h: {
  jobs?: Record<string, HarnessJob>;
  actions?: Record<string, unknown>;
  scopes?: unknown;
  permissions: { edit: "folder" | "none"; exec: boolean; web: boolean };
}): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  for (const [id, j] of Object.entries(h.jobs ?? {})) {
    const at = (...p: (string | number)[]) => ["jobs", id, ...p];
    if (h.actions && Object.hasOwn(h.actions, id)) out.push({ path: at(), message: `Job id ${id} clashes with an action id` });
    const triggers = (["start", "manual", "afterTask", "every"] as const).filter((k) => j.on[k] !== undefined && j.on[k] !== false);
    if (triggers.length === 0) out.push({ path: at("on"), message: "A job needs at least one trigger" });
    if (j.on.every !== undefined) {
      const ms = parseEvery(j.on.every);
      if (ms === null || ms < EVERY_MIN_MS) out.push({ path: at("on", "every"), message: "every must be a duration of 15m or more" });
      if (j.dailyTokens === undefined) out.push({ path: at("dailyTokens"), message: "dailyTokens is required with every" });
    }
    if (Array.isArray(j.on.afterTask)) for (const a of j.on.afterTask) if (!h.actions || !Object.hasOwn(h.actions, a)) out.push({ path: at("on", "afterTask"), message: `afterTask names no action ${a}` });
    if (j.scope !== "none" && !h.scopes) out.push({ path: at("scope"), message: `scope ${j.scope} needs the harness to declare scopes` });
    if (j.scope === "trigger" && (triggers.some((t) => t === "start" || t === "every") || !triggers.some((t) => t === "afterTask" || t === "manual")))
      out.push({ path: at("scope"), message: "scope trigger needs afterTask or manual and no other trigger" });
    const p = j.permissions;
    if (p && ((p.edit === "folder" && h.permissions.edit === "none") || (p.exec === true && !h.permissions.exec) || (p.web === true && !h.permissions.web)))
      out.push({ path: at("permissions"), message: "A job's permissions can only narrow the harness's" });
  }
  return out;
}
```

`index.ts`:
- `jobs: jobsSchema.optional()` in `manifestSchema`;
- in its `superRefine`, `for (const p of jobProblems(h)) ctx.addIssue({ code: "custom", path: p.path, message: p.message });`;
- `export * from "./jobs";`.

`loadHarness`: resolve each job's `prompt` with `resolveInHarness` the way action prompts are checked. Read how actions' prompts are validated and do the same.

`parallel.ts`: `isConcurrent` becomes `harness.parallel !== undefined || hasJobs(harness)`. Update its doc comment.

`check.ts`: surface `jobProblems` as findings (they already throw at load, so check's existing load-error path may show them; add explicit findings only if check reports manifest refinements separately) and the missing job prompt file.

- [ ] **Step 4: Run.** `corepack pnpm vitest run packages/harness-sdk/test packages/cli/test`. Expected: PASS. Part 1's `parallel.test.ts` stays green.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/harness-sdk/src/jobs.ts packages/harness-sdk/src/index.ts packages/harness-sdk/src/parallel.ts packages/harness-sdk/test/jobs.test.ts packages/cli/src/check.ts packages/cli/test/check.test.ts
git -C <worktree> commit -m "feat(sdk): background jobs in the manifest, with their checks

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 2: `job_result` and the `ui` server's job mode

**Files:**
- Modify: `packages/blocks/src/ui-server.ts`, `packages/blocks/src/ui-server-bin.ts`
- Test: `packages/blocks/test/ui-server-job.test.ts`; `packages/blocks/test/ui-server.test.ts` stays green

- [ ] **Step 1: Write the failing tests.** Use the in-memory MCP client pattern the existing `ui-server.test.ts` uses (`InMemoryTransport` + `Client`, and a fake bridge that records messages).

```ts
// packages/blocks/test/ui-server-job.test.ts (structure; copy the setup from ui-server.test.ts)
describe("ui server in job mode (parallel spec §8, J1)", () => {
  it("D0: without job mode, the tool list is exactly today's", async () => {
    const tools = await listTools(await createUiServer(FIXTURE_WITH_INPUTS_AND_PHASES, bridge));
    expect(tools).not.toContain("job_result");
    expect(tools).toEqual(TODAYS_TOOLS); // pin the literal list the existing test sees
  });
  it("job mode adds job_result; it reaches the bridge as a block named job_result", async () => {
    const server = await createUiServer(FIXTURE, bridge, { job: true });
    const r = await call(server, "job_result", { status: "ok", summary: "Synced 3 tickets" });
    expect(r.isError).toBeFalsy();
    expect(bridge.messages).toEqual([{ name: "job_result", data: { status: "ok", summary: "Synced 3 tickets" } }]);
  });
  it.each(["choices", "save_note", "set_phase", "<an input block of the fixture>"])("refuses %s with the spec's message", async (tool) => {
    const server = await createUiServer(FIXTURE_WITH_INPUTS_AND_PHASES, bridge, { job: true });
    const r = await call(server, tool, validArgsFor(tool));
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe(tool === "save_note" ? JOB_NO_NOTE : JOB_CANNOT_ASK);
    expect(bridge.messages).toEqual([]);
  });
});
```

Fill `FIXTURE_WITH_INPUTS_AND_PHASES` with the fixture used by the existing input-block and phase tests (phases-harness has `set_phase`; pick one with an input block or use two fixtures). `validArgsFor` returns minimal valid arguments per tool, so the refusal comes from job mode, not validation.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** `createUiServer(harnessConfig, bridge, opts: { job?: boolean } = {})`. In the loop, when `opts.job` and the block is `choices`, `save_note`, `set_phase` or has `block.input`, register the tool so the agent can see it fails clearly, with a handler that returns:

```ts
{ isError: true, content: [{ type: "text" as const, text: name === "save_note" ? JOB_NO_NOTE : JOB_CANNOT_ASK }] }
```

without calling the bridge. After the loop, when `opts.job`:

```ts
    server.registerTool(
      JOB_RESULT_TOOL,
      { description: "End this background job with its result: ok, needs-you (name an action the person should start) or failed, and a one-line summary.", inputSchema: jobResultSchema.shape },
      async (args) => {
        try {
          await sendToBridge(bridge, { name: JOB_RESULT_TOOL, data: args });
        } catch (e) {
          return { isError: true, content: [{ type: "text" as const, text: `Could not reach the app (${e instanceof Error ? e.message : String(e)}).` }] };
        }
        return { content: [{ type: "text" as const, text: "Done: the result is recorded. End your turn now." }] };
      },
    );
```

`ui-server-bin.ts`: `createUiServer(harnessConfig, { path, token }, { job: process.env.HH_JOB === "1" })`.

- [ ] **Step 4: Run.** `corepack pnpm vitest run packages/blocks/test`. Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/blocks/src/ui-server.ts packages/blocks/src/ui-server-bin.ts packages/blocks/test/ui-server-job.test.ts
git -C <worktree> commit -m "feat(blocks): job mode for the ui server, with job_result and no asking

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 3: `jobs.jsonl`, today's tokens, dedupe keys

**Files:**
- Modify: `packages/workspace/src/layout.ts`
- Create: `packages/shell/src/main/jobs/job-log.ts`
- Test: `packages/shell/test/jobs/job-log.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/shell/test/jobs/job-log.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { JobLog, dedupeKey } from "../../src/main/jobs/job-log";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-joblog-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const rec = (extra: object) => ({ job: "sync", scope: "main", trigger: "every", status: "ok", summary: "x", tokens: 100, startedAt: "2026-10-28T09:00:00", endedAt: "2026-10-28T09:01:00", run: "r", ...extra });

describe("JobLog (parallel spec §8, J5)", () => {
  it("appends runs and reads the last per job and scope", async () => {
    const log = new JobLog(fs.mkdtempSync(path.join(root, "b-")));
    await log.append(rec({ run: "1", summary: "first" }) as never);
    await log.append(rec({ run: "2", summary: "second" }) as never);
    await log.append(rec({ run: "3", scope: "s2" }) as never);
    const last = await log.lastRuns();
    expect(last.get("sync:main")?.summary).toBe("second");
    expect(last.get("sync:s2")?.run).toBe("3");
  });
  it("tokens today count only that job's runs that started today (local day, Decision 9)", async () => {
    const log = new JobLog(fs.mkdtempSync(path.join(root, "b-")));
    await log.append(rec({ tokens: 100 }) as never);
    await log.append(rec({ tokens: 50, startedAt: "2026-10-27T23:00:00" }) as never);
    await log.append(rec({ job: "other", tokens: 999 }) as never);
    expect(await log.tokensToday("sync", new Date("2026-10-28T12:00:00"))).toBe(100);
  });
  it("a corrupt line is skipped", async () => {
    const base = fs.mkdtempSync(path.join(root, "b-"));
    const log = new JobLog(base);
    await log.append(rec({}) as never);
    fs.appendFileSync(path.join(base, ".harness", "jobs.jsonl"), "{nope\n");
    expect((await log.lastRuns()).size).toBe(1);
  });
  it("dedupeKey is job:scope", () => {
    expect(dedupeKey("sync", "main")).toBe("sync:main");
    expect(dedupeKey("sync", null)).toBe("sync:-");
  });
});
```

(Store `startedAt` as ISO with offset in real records: `new Date().toISOString()`. The test's local-time strings parse as local time, which is what "today" uses. Keep the comparison on `new Date(startedAt)` in local time.)

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** `layout.ts`: `export const jobsFile = (base: string): string => path.join(base, ".harness", "jobs.jsonl");`.

```ts
// packages/shell/src/main/jobs/job-log.ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { jobsFile } from "@humanharness/workspace";

export type JobTrigger = "start" | "manual" | "afterTask" | "every";
export type JobStatus = "ok" | "needs-you" | "failed";

/** One run in `.harness/jobs.jsonl` (parallel spec §8). */
export interface JobRunRecord {
  run: string;
  job: string;
  /** null: an app-wide run (`scope: "none"`). */
  scope: string | null;
  trigger: JobTrigger;
  status: JobStatus;
  summary: string;
  /** For needs-you: the action the person may start. */
  action?: string;
  tokens: number;
  startedAt: string;
  endedAt: string;
}

export const dedupeKey = (job: string, scope: string | null): string => `${job}:${scope ?? "-"}`;

/** The log of job runs; appends only. */
export class JobLog {
  private readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(base: string) {
    this.file = jobsFile(base);
  }

  append(r: JobRunRecord): Promise<void> {
    const run = this.queue.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.appendFile(this.file, JSON.stringify(r) + "\n");
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async all(): Promise<JobRunRecord[]> {
    const raw = await fs.readFile(this.file, "utf8").catch(() => "");
    const out: JobRunRecord[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as JobRunRecord;
        if (typeof r.job === "string" && typeof r.tokens === "number" && typeof r.startedAt === "string") out.push(r);
      } catch {
        // A corrupt line is skipped.
      }
    }
    return out;
  }

  /** The last run of each job and scope, by `dedupeKey`. */
  async lastRuns(): Promise<Map<string, JobRunRecord>> {
    const out = new Map<string, JobRunRecord>();
    for (const r of await this.all()) out.set(dedupeKey(r.job, r.scope), r);
    return out;
  }

  /** The tokens `job`'s runs that started on `now`'s local day used (spec §8 daily cap). */
  async tokensToday(job: string, now: Date): Promise<number> {
    const day = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    return (await this.all()).filter((r) => r.job === job && day(new Date(r.startedAt)) === day(now)).reduce((s, r) => s + r.tokens, 0);
  }
}
```

- [ ] **Step 4: Run.** Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/workspace/src/layout.ts packages/shell/src/main/jobs/job-log.ts packages/shell/test/jobs/job-log.test.ts
git -C <worktree> commit -m "feat(shell): the log of job runs and each job's tokens today

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 4: A job run's first message

**Files:**
- Create: `packages/shell/src/main/jobs/job-prompt.ts`
- Test: `packages/shell/test/jobs/job-prompt.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// packages/shell/test/jobs/job-prompt.test.ts
import { describe, expect, it } from "vitest";
import { jobFirstMessage } from "../../src/main/jobs/job-prompt";

describe("jobFirstMessage (parallel spec §8)", () => {
  it("brief, then the notes index, the data and the material of its scope, then how to end", async () => {
    const m = await jobFirstMessage({
      brief: "Sync the tickets.",
      scope: "main",
      notesIndex: async () => "## Notes\n- intro",
      dataContext: async () => "## Data\n| a |",
      materialContext: async () => "",
      actions: { implement: "Implement" },
    });
    expect(m.indexOf("Sync the tickets.")).toBeLessThan(m.indexOf("## Notes"));
    expect(m.indexOf("## Notes")).toBeLessThan(m.indexOf("## Data"));
    expect(m).toContain("job_result");
    expect(m).toContain("implement");
    expect(m).not.toContain("save_note");
  });
});
```

- [ ] **Step 2: Run to see it fail.**

- [ ] **Step 3: Implement.** Read `TaskManager.contextFor` (task-manager.ts) and reuse **the same exported helpers** it uses to build the notes index (it formats `d.notes(scope)` into a section; if that formatting is private, export it from task-manager.ts as `notesIndexSection(notes)` without changing its output, so tasks stay byte-identical).

```ts
// packages/shell/src/main/jobs/job-prompt.ts
/**
 * A job run's first message (spec §8): its brief, the same context an action's first message carries (notes index,
 * data, material of its scope), and how to end. No question to the person, no note.
 */
export async function jobFirstMessage(o: {
  brief: string;
  scope: string;
  notesIndex(scope: string): Promise<string>;
  dataContext?(scope: string): Promise<string>;
  materialContext?(scope: string): Promise<string>;
  /** The actions a needs-you result may name: id → label. */
  actions: Record<string, string>;
}): Promise<string> {
  const parts = [
    o.brief.trim(),
    await o.notesIndex(o.scope),
    o.dataContext ? await o.dataContext(o.scope) : "",
    o.materialContext ? await o.materialContext(o.scope) : "",
    [
      "This is a background job: nobody reads this conversation and nobody can answer.",
      "Do the work, then call job_result once with status ok, needs-you or failed and a one-line summary.",
      `With needs-you, name the action the person should start: ${Object.entries(o.actions).map(([id, label]) => `${id} (${label})`).join(", ")}.`,
    ].join("\n"),
  ];
  return parts.filter((p) => p.trim()).join("\n\n");
}
```

- [ ] **Step 4: Run.** Expected: PASS. `task-manager.test.ts` stays green if a helper was exported.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/shell/src/main/jobs/job-prompt.ts packages/shell/src/main/task-manager.ts packages/shell/test/jobs/job-prompt.test.ts
git -C <worktree> commit -m "feat(shell): a job run's first message

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 5: `JobRunner` — one run on a job slot

**Files:**
- Create: `packages/shell/src/main/jobs/job-runner.ts`
- Test: `packages/shell/test/jobs/job-runner.test.ts`

- [ ] **Step 1: Write the failing tests.** A fake workspace whose `openSlot` returns a slot double. Its `send(message, emit, options)` plays scripted events: `block` events named `job_result`, `usage`, `done`. It records the options (trailer) and the slot options (kind, permissions).

```ts
// packages/shell/test/jobs/job-runner.test.ts (write in full)
describe("JobRunner (parallel spec §8)", () => {
  it("opens a job slot with narrowed permissions and the job trailer; logs ok with tokens", async () => {
    // expect openSlot({ key: "job:<run>", kind: "job", permissions: job.permissions })
    // expect send options.trailer = { task: <run>, job: "sync", scope: "main" }
    // expect jobs.jsonl record { status: "ok", summary, tokens: input+output, trigger, scope }
    // expect usage recorded with phase "job", job "sync"
    // expect the slot closed afterwards
  });
  it("no job_result: failed, 'No result'", async () => {});
  it("needs-you keeps a real action only (J3)", async () => {
    // action "implement" kept; action "nope" dropped and logged
  });
  it("a run past its time limit is cancelled: failed, 'Timed out' (J6, Decision 8)", async () => {
    // maxMs: 50, slot never finishes until cancelled
  });
  it("waits for a jobs slot in the gate; a dropped run logs nothing and resolves null", async () => {});
  it("an out-of-quota end pauses the queues (same rule as tasks)", async () => {});
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

```ts
// packages/shell/src/main/jobs/job-runner.ts
import { randomUUID } from "node:crypto";
import { type HarnessJob, type JobResult, jobResultSchema } from "@humanharness/harness-sdk";
import type { Event, HarnessWorkspace } from "@humanharness/runtime";
import { Dropped, type TurnGate } from "../turn-gate";
import type { JobLog, JobRunRecord, JobTrigger } from "./job-log";

export const JOB_RUN_MAX_MS = 15 * 60_000;

export interface JobRunDeps {
  workspace(): Promise<HarnessWorkspace>;
  gate: TurnGate;
  log: JobLog;
  firstMessage(job: string, scope: string | null): Promise<string>;
  profileFor(job: HarnessJob): Promise<import("@humanharness/engines").ModelProfile>;
  recordUsage(e: Extract<Event, { type: "usage" }>, meta: { job: string; task: string; scope?: string }): Promise<void>;
  /** The harness's actions: a needs-you result may name only these (J3). */
  actions: Record<string, unknown>;
  now?: () => Date;
  newId?: () => string;
  maxMs?: number;
}

/** Runs one job run (spec §8) and returns its record; null when it was dropped from the queue before it started. */
export async function runJob(d: JobRunDeps, id: string, job: HarnessJob, scope: string | null, trigger: JobTrigger, signal?: AbortSignal): Promise<JobRunRecord | null> {
  const run = (d.newId ?? randomUUID)();
  let release: () => void;
  try {
    release = await d.gate.acquire("jobs", { id: `job:${run}` });
  } catch (err) {
    if (err instanceof Dropped) return null;
    throw err;
  }
  const now = d.now ?? (() => new Date());
  const startedAt = now().toISOString();
  let result: JobResult | null = null;
  let tokens = 0;
  let outcome: "done" | "timeout" | "cancelled" | "error" = "done";
  try {
    const ws = await d.workspace();
    const slot = await ws.openSlot({ key: `job:${run}`, kind: "job", ...(job.permissions ? { permissions: job.permissions } : {}) });
    try {
      const message = await d.firstMessage(id, scope);
      const turn = slot.send(
        message,
        (e) => {
          if (e.type === "block" && e.name === "job_result") {
            const parsed = jobResultSchema.safeParse(e.data);
            if (parsed.success) result = parsed.data;
          }
          if (e.type === "usage") {
            tokens += (e.input ?? 0) + (e.output ?? 0);
            void d.recordUsage(e, { job: id, task: run, ...(scope ? { scope } : {}) }).catch((err: unknown) => console.error("Could not record a job's usage", err));
          }
          if (e.type === "done" && !e.ok && e.error.code === "out-of-quota") d.gate.pause({ reason: "out-of-quota" });
          if (e.type === "done" && !e.ok && e.error.code === "cancelled" && outcome === "done") outcome = "cancelled";
        },
        { profile: await d.profileFor(job), trailer: { task: run, job: id, ...(scope ? { scope } : {}) } },
      );
      const timer = setTimeout(() => {
        outcome = "timeout";
        turn.cancel();
      }, d.maxMs ?? JOB_RUN_MAX_MS);
      const onAbort = () => turn.cancel();
      signal?.addEventListener("abort", onAbort);
      try {
        await turn.done;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    } finally {
      await slot.close().catch((err: unknown) => console.error("Could not close a job's slot", err));
    }
  } catch (err) {
    outcome = "error";
    console.error(`Job ${id} failed to run`, err);
  } finally {
    release();
  }
  const r = result as JobResult | null;
  const action = r?.action && Object.hasOwn(d.actions, r.action) ? r.action : undefined;
  if (r?.action && !action) console.error(`Job ${id} named no action ${r.action}`);
  const record: JobRunRecord = {
    run,
    job: id,
    scope,
    trigger,
    status: outcome === "done" && r ? r.status : "failed",
    summary: outcome === "timeout" ? "Timed out" : outcome === "cancelled" ? "Cancelled" : (r?.summary ?? "No result"),
    ...(action && r?.status === "needs-you" ? { action } : {}),
    tokens,
    startedAt,
    endedAt: now().toISOString(),
  };
  await d.log.append(record);
  return record;
}
```

(Match the real `usage` event's token fields and the `ModelProfile` import path. `tier` → profile goes through the shell's existing `profileFor(action, floor, tier)` resolution: pass the job's tier as the `tier` argument it already accepts for prepared tasks.)

- [ ] **Step 4: Run.** Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/shell/src/main/jobs/job-runner.ts packages/shell/test/jobs/job-runner.test.ts
git -C <worktree> commit -m "feat(shell): run one background job on its own slot

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 6: `JobScheduler` — triggers, dedupe, daily cap; `taskClosed`

**Files:**
- Create: `packages/shell/src/main/jobs/job-scheduler.ts`
- Modify: `packages/shell/src/main/task-manager.ts` (one optional dep, one call)
- Test: `packages/shell/test/jobs/job-scheduler.test.ts`, `packages/shell/test/task-manager.test.ts` (append)

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/shell/test/jobs/job-scheduler.test.ts (write in full; a fake `run` records calls and resolves when told)
describe("JobScheduler (parallel spec §8)", () => {
  it("D0: no jobs, no timers", () => {/* timer.set never called */});
  it("start: once per app start, one run per active scope for scope each (Decision 7)", async () => {});
  it("manual: run(id, scope) only for a manual job and an existing scope (J4)", async () => {});
  it("afterTask: a closed task of a listed action triggers; true means any action; scope trigger uses the task's scope", async () => {});
  it("every: first run one interval after start, then every interval", async () => {});
  it("dedupe: a job and scope already queued or running is skipped and logged", async () => {});
  it("daily cap: every-runs stop once tokens today reach dailyTokens; manual still runs; summary says paused until tomorrow", async () => {});
  it("stopAll cancels running runs and clears timers (engine switch, quit; Decision 11)", async () => {});
});
```

Append to `task-manager.test.ts`:

```ts
it("taskClosed is called once when a task's note is saved, never for a cancelled one (parallel spec §8, Decision 6)", async () => {
  // build the manager with the file's helpers, `taskClosed: vi.fn()`
  // finish a task normally → called with { id, action, scope }
  // cancel another → not called
});
it("D0: without taskClosed nothing changes", async () => { /* existing flow passes with the dep absent */ });
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

`task-manager.ts`: `TaskDeps` gains

```ts
  /** A task ended with its note saved (parallel spec §8 `afterTask`). Never awaited. Absent: nothing (D0). */
  taskClosed?(task: { id: string; action?: string; scope: string }): void;
```

In `endTask(id, outcome)`, when `outcome === "done"` (read how `endTask` names a normal end), after the state is written:

```ts
    if (outcome === "done" && this.d.taskClosed) {
      try {
        this.d.taskClosed({ id: c.id, ...(c.action ? { action: c.action } : {}), scope: c.scope ?? MAIN_SCOPE });
      } catch (err) {
        console.error("A task-closed listener failed", err);
      }
    }
```

```ts
// packages/shell/src/main/jobs/job-scheduler.ts (core)
import { type HarnessJob, parseEvery } from "@humanharness/harness-sdk";
import { type JobLog, type JobRunRecord, type JobTrigger, dedupeKey } from "./job-log";

export interface SchedulerDeps {
  jobs: Record<string, HarnessJob>;
  log: JobLog;
  /** Runs one job run (runJob bound to its deps). */
  run(id: string, job: HarnessJob, scope: string | null, trigger: JobTrigger, signal: AbortSignal): Promise<JobRunRecord | null>;
  /** The active scopes now (scope "each"); ["main"] without scopes. */
  scopes(): Promise<string[]>;
  scopeExists(scope: string): Promise<boolean>;
  /** Off in Settings › Jobs, and the person's daily cap. */
  settings(id: string): { off?: boolean; dailyTokens?: number };
  timer?: { set(fn: () => void, ms: number): unknown; clear(h: unknown): void };
  now?: () => Date;
  log_?: (m: string) => void;
  changed(): void;
}

/** The four triggers (spec §8), dedupe by job and scope, the daily cap of `every` runs. */
export class JobScheduler {
  private readonly active = new Map<string, AbortController>();
  private readonly timers: unknown[] = [];
  private started = false;

  constructor(private readonly d: SchedulerDeps) {}

  /** After setup, once per app start: `start` jobs now, `every` timers armed. */
  async appReady(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const timer = this.d.timer ?? { set: (fn: () => void, ms: number) => setInterval(fn, ms), clear: (h: unknown) => clearInterval(h as never) };
    for (const [id, job] of Object.entries(this.d.jobs)) {
      if (job.on.start) await this.fire(id, job, "start");
      const ms = job.on.every ? parseEvery(job.on.every) : null;
      if (ms) this.timers.push(timer.set(() => void this.fire(id, job, "every"), ms));
    }
  }

  /** `client.jobs.run` and the inbox's "Run now" (J4). */
  async manual(id: string, scope?: string): Promise<boolean> {
    if (!Object.hasOwn(this.d.jobs, id)) return false;
    const job = this.d.jobs[id];
    if (!job.on.manual) return false;
    if (scope !== undefined && !(await this.d.scopeExists(scope))) return false;
    await this.fire(id, job, "manual", scope);
    return true;
  }

  /** A task's note was saved (Decision 6). */
  taskClosed(t: { action?: string; scope: string }): void {
    for (const [id, job] of Object.entries(this.d.jobs)) {
      const after = job.on.afterTask;
      if (after === undefined) continue;
      if (after === true || (t.action !== undefined && after.includes(t.action))) void this.fire(id, job, "afterTask", t.scope);
    }
  }

  /** Engine switch, quit (Decision 11). */
  stopAll(): void {
    for (const h of this.timers.splice(0)) (this.d.timer ?? { clear: (x: unknown) => clearInterval(x as never) }).clear(h);
    for (const c of this.active.values()) c.abort();
  }

  isActive(id: string, scope: string | null): boolean {
    return this.active.has(dedupeKey(id, scope));
  }

  private async fire(id: string, job: HarnessJob, trigger: JobTrigger, triggerScope?: string): Promise<void> {
    if (this.d.settings(id).off) return;
    const scopes = job.scope === "none" ? [null] : job.scope === "trigger" ? (triggerScope ? [triggerScope] : []) : trigger === "manual" && triggerScope ? [triggerScope] : await this.d.scopes();
    if (trigger === "every") {
      const cap = this.d.settings(id).dailyTokens ?? job.dailyTokens ?? 0;
      if ((await this.d.log.tokensToday(id, (this.d.now ?? (() => new Date()))())) >= cap) {
        (this.d.log_ ?? console.log)(`Job ${id}: daily cap reached, skipped`);
        this.d.changed();
        return;
      }
    }
    await Promise.all(
      scopes.map(async (scope) => {
        const key = dedupeKey(id, scope);
        if (this.active.has(key)) {
          (this.d.log_ ?? console.log)(`Job ${key}: already queued or running, ${trigger} skipped`);
          return;
        }
        const c = new AbortController();
        this.active.set(key, c);
        this.d.changed();
        try {
          await this.d.run(id, job, scope, trigger, c.signal);
        } finally {
          this.active.delete(key);
          this.d.changed();
        }
      }),
    );
  }
}
```

(`every` runs with `scope: "each"` run per scope. `JobRunner` takes the `signal` (Task 5 already accepts one). Expose `pausedToday(id)` for the summary, computed as `tokensToday >= cap` for jobs with `every`.)

- [ ] **Step 4: Run.** Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/shell/src/main/jobs/job-scheduler.ts packages/shell/src/main/task-manager.ts packages/shell/test/jobs/job-scheduler.test.ts packages/shell/test/task-manager.test.ts
git -C <worktree> commit -m "feat(shell): job triggers with dedupe and a daily cap; tasks say when they close

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 7: `single` mode and the jobs host wiring

**Files:**
- Create: `packages/shell/src/main/jobs/jobs-host.ts`
- Modify: `packages/shell/src/main/board-host.ts` (`hostMode`), `packages/shell/src/main/index.ts`
- Test: `packages/shell/test/board-host.test.ts` (append), `packages/shell/test/jobs/jobs-host.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
it("hostMode: single with jobs only; board with parallel (with or without jobs) (Decision 12)", () => {
  expect(hostMode({ jobs: { s: {} } } as never)).toBe("single");
  expect(hostMode({ parallel: { tasks: 2, jobs: 1 }, jobs: { s: {} } } as never)).toBe("board");
  expect(hostMode({})).toBe("plain");
});
```

`jobs-host.test.ts`:
1. `createJobsHost` wires the scheduler to `runJob` with the workspace and gate;
2. `appReady()` after setup runs `start` jobs;
3. `stopAll` on engine switch;
4. in `single` mode, the runtime returned for the task is `{ history, send, endSession, refreshInstructions, close }` built from the workspace's `"main"` slot, and a job run can overlap a task turn.

Use fake workspaces as in part 2 Task 9.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

`hostMode`: `parallel` → `"board"`; else `hasJobs` → `"single"`; else `"plain"`.

`jobs-host.ts`: `createJobsHost({ harness, workspace, gate, base, deps })` → `{ scheduler, summaries(), runManual(id, scope), appReady(), stopAll() }`.
- Its `firstMessage` uses `jobFirstMessage` with the brief read from `resolveInHarness(harness, job.prompt)`, the notes index helper, and the `dataContext` / `materialContext` getters from `index.ts`'s task deps.
- `profileFor(job)` is `taskDeps.profileFor(undefined, undefined, job.tier)`.
- `recordUsage` appends a usage line `{ ..., phase: "job", job, task }` (Task 11 adds the field).

`index.ts`:
- **`single` mode:**
  - `runtime` memo: `createWorkspace(runtimeOptions(...))` → `ws.openSlot({ key: "main", session, onSession })`, wrapped as a `HarnessRuntime` (the same wrapper as part 1's `createRuntime`: export that wrapper from `runtime.ts` as `runtimeOnSlot(ws, slot)` and use it in both places);
  - the jobs host gets that workspace;
  - the gate is `new TurnGate({ tasks: 1, jobs: caps.jobs })`;
  - the single task's `turns` are wrapped with `gatedTurns("main", gate, turns, { cap: "tasks" })` so a task turn and job turns are counted apart.
- **`board` mode with jobs:** the board host's workspace and gate feed the jobs host.
- **Both modes:**
  - `taskClosed: (t) => jobsHost.scheduler.taskClosed(t)` is passed to every `TaskManager` (both modes, only when `hasJobs`);
  - `appReady()` is called where the app first becomes configured in this process. Find the place where setup completion is detected (setup flow `finish`, or the first successful `validConfig()` after start) and call it once;
  - `dropRuntime` and the quit handler call `jobsHost.stopAll()` and `gate.dropAll()`.

- [ ] **Step 4: Run.** `corepack pnpm vitest run packages/shell/test packages/runtime/test`. Expected: PASS.

- [ ] **Step 5: Typecheck, test, build, commit.**

```bash
git -C <worktree> add packages/shell/src/main/jobs/jobs-host.ts packages/shell/src/main/board-host.ts packages/shell/src/main/index.ts packages/runtime/src/runtime.ts packages/shell/test/board-host.test.ts packages/shell/test/jobs/jobs-host.test.ts
git -C <worktree> commit -m "feat(shell): jobs beside the single task or the board

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 8: `needs-you` in the attention store; the inbox's Jobs section

**Files:**
- Modify: `packages/shell/src/main/jobs/jobs-host.ts`, `packages/shell/src/main/attention-stores.ts` (register `job` origins), `packages/ui/src/parallel/Inbox.tsx`, en.json `"parallel"`
- Test: `packages/shell/test/jobs/jobs-host.test.ts` (append), `packages/ui/test/inbox.test.tsx` (append)

- [ ] **Step 1: Write the failing tests.**
- **Main.** A run that ends `needs-you` with action `implement` raises `{ kind: "job", id: "sync:main" }`, key `"result"`, severity `"action"`, title = the summary, target `{ action: "implement", vars: { scope: "main" } }`. The next `ok` run of that job and scope resolves it. `known` accepts job origins of declared jobs.
- **UI.** With `state.jobs` set and `client.jobs.list()` answering two summaries, the Jobs section shows each job × scope's label, last status and summary, "Run now" for manual ones (calls `client.jobs.run(id, scope)`), "Paused until tomorrow" for a paused one, and "Start" on a needs-you row, which starts its action through the existing start path (`client.send` with the action, as the start view does).

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** The jobs host, after each `runJob`:

```ts
if (record.status === "needs-you") await store?.raise({ kind: "job", id: dedupeKey(record.job, record.scope) }, { key: "result", severity: "action", title: record.summary, ...(record.action ? { target: { action: record.action, vars: record.scope ? { scope: record.scope } : {} } } : {}) } as never);
else await store?.resolve({ kind: "job", id: dedupeKey(record.job, record.scope) }, "result");
```

(Use `AttentionOrigin`'s real kinds. If it only allows `"plugin" | "task"`, add `"job"` there, with a workspace attention test. The plugins inbox's view filter keeps showing plugin origins only.)

The Jobs section rows come from `client.jobs.list()` (Task 9 provides it; in this task, read it via `useJobs` with the fake client). en.json additions: `"runNow": "Run now"`, `"pausedTomorrow": "Paused until tomorrow"`, `"lastRun": "Last run {{time}}"`, `"nextRun": "Next run {{time}}"`, `"statusOk": "OK"`, `"statusNeedsYou": "Needs you"`, `"statusFailed": "Failed"`, `"start": "Start"`.

The inbox button's count = waiting tasks + needs-you job rows.

- [ ] **Step 4: Run.** Expected: PASS.

- [ ] **Step 5: Typecheck, test, build, commit.**

```bash
git -C <worktree> add packages/shell/src/main/jobs/jobs-host.ts packages/shell/src/main/attention-stores.ts packages/workspace/src/attention.ts packages/workspace/test packages/ui/src/parallel/Inbox.tsx packages/i18n/src/locales/en.json packages/shell/test/jobs/jobs-host.test.ts packages/ui/test/inbox.test.tsx
git -C <worktree> commit -m "feat: job results in the inbox; needs-you raises an attention item

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 9: Client `jobs` API, IPC and `AppState.jobs`

**Files:**
- Modify: `packages/ui/src/client.ts`, `packages/shell/src/preload/index.ts`, `packages/ui/test/fake-client.ts`, `packages/shell/src/main/index.ts`
- Test: `packages/shell/test/jobs/jobs-ipc.test.ts`, `packages/ui/test/client.test.ts` (append)

- [ ] **Step 1: Write the failing tests.**
- `jobs-ipc.test.ts`: the handler functions (exported from `jobs-host.ts` as `jobsIpc(host)`) refuse:
  - an unknown id;
  - a non-manual job;
  - a scope that doesn't exist;
  - an id longer than 200 characters (J4).

  `list()` answers each job × scope, with `{ id, label, scope, last?: { status, summary, at, action? }, next?: string, paused?: "daily-cap" | "off", manual: boolean, running: boolean }`.
- Fake-client test: `jobs` namespace present.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** `client.ts`:

```ts
/** One job × scope (parallel spec §9.1 `JobSummary`). */
export interface JobSummary {
  id: string;
  label: string;
  /** null: an app-wide job. */
  scope: string | null;
  last?: { status: "ok" | "needs-you" | "failed"; summary: string; at: string; action?: string };
  /** The next `every` run, when one is armed. */
  next?: string;
  paused?: "daily-cap" | "off";
  manual: boolean;
  running: boolean;
}

/** The harness declares jobs (spec §3). Absent: no Jobs tab, an empty Jobs section (D0). */
export interface JobsInfo {
  jobs: { id: string; label: string; every?: string; dailyTokens?: number; manual: boolean }[];
}
```

- `AppState.jobs?: JobsInfo`;
- `AppConfig.jobs?: Record<string, { off?: boolean; dailyTokens?: number }>` (Settings › Jobs), cleaned in `config.ts` like `parallel`;
- `HarnessClient.jobs: { list(): Promise<JobSummary[]>; run(id: string, scope?: string): Promise<boolean>; onChange(listener: (jobs: JobSummary[]) => void): () => void }`;
- preload: `hh:jobsList`, `hh:jobsRun`, `hh:jobsChange`;
- `index.ts`: register both through `handle()`, refusing with `"No jobs"` when the harness has none;
- the scheduler's `changed` sends `hh:jobsChange`;
- `appState()` adds `jobs` only with `hasJobs(harness)`.

- [ ] **Step 4: Run.** Expected: PASS.

- [ ] **Step 5: Typecheck, test, build, commit.**

```bash
git -C <worktree> add packages/ui/src/client.ts packages/shell/src/preload/index.ts packages/ui/test/fake-client.ts packages/shell/src/main/index.ts packages/shell/src/main/config.ts packages/shell/src/main/jobs/jobs-host.ts packages/shell/test/jobs/jobs-ipc.test.ts packages/ui/test/client.test.ts
git -C <worktree> commit -m "feat: the client's jobs namespace

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 10: Settings › Jobs

**Files:**
- Create: `packages/ui/src/parallel/JobsTab.tsx`
- Modify: `packages/ui/src/SettingsSheet.tsx` (one tab entry), en.json `"parallel"`
- Test: `packages/ui/test/jobs-ui.test.tsx`

- [ ] **Step 1: Write the failing tests.**
- D0: no "Jobs" tab without `state.jobs`.
- With jobs, the tab lists each job with:
  - an "On" switch (saves `config.jobs[id].off`);
  - for `every` jobs, "Daily token cap" (a number input, at least 1,000, saves `config.jobs[id].dailyTokens`) and its interval;
  - "Run now" for manual jobs.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** Add the tab to `TABS` only when `state.jobs`, following how the Plugins tab is added conditionally. Strings: `"jobsTab": "Jobs"`, `"jobOn": "On"`, `"dailyCap": "Daily token cap"`, `"every": "Every {{interval}}"`. Main reads `config.jobs` in the scheduler's `settings(id)`.

- [ ] **Step 4: Run, typecheck, build.**

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/ui/src/parallel/JobsTab.tsx packages/ui/src/SettingsSheet.tsx packages/i18n/src/locales/en.json packages/ui/test/jobs-ui.test.tsx
git -C <worktree> commit -m "feat(ui): Settings > Jobs

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 11: Usage lines for jobs; Settings › Uso shows them apart

**Files:**
- Modify: `packages/shell/src/main/usage-log.ts`, `packages/ui/src/UsageTab.tsx` (and `packages/ui/src/usage.ts` if it groups lines), en.json `"parallel"`
- Test: `packages/shell/test/usage-log.test.ts` (append), `packages/ui/test/usage.test.tsx` (append; use the file that tests UsageTab)

- [ ] **Step 1: Write the failing tests.**
- D0: a task's usage record serialises exactly as before (pin today's JSON string for one record).
- A job record has `phase: "job"` and `job: "sync"`.
- The usage view's per-day totals put job lines under "Jobs", apart from tasks, in the same way `sidekick` lines are split today (index.ts `tokens: { tasks, sidekick }` at the day summary: add `jobs`).

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**
- `TurnKind` gains `"job"`.
- `UsageMeta` and `UsageRecord` gain `/** A job run's job id (parallel spec §10, Decision 2). */ job?: string;`.
- `usageRecord` copies `job` when present.
- The day summary in `index.ts` adds `jobs: sum(ofDay.filter((u) => u.phase === "job"))` and excludes those lines from `tasks`.
- `UsageTab` shows a "Jobs" line with the caption `"jobsUsage": "Background jobs"`.

- [ ] **Step 4: Run, typecheck, build.**

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/shell/src/main/usage-log.ts packages/shell/src/main/index.ts packages/ui/src/UsageTab.tsx packages/ui/src/usage.ts packages/i18n/src/locales/en.json packages/shell/test/usage-log.test.ts packages/ui/test
git -C <worktree> commit -m "feat: job usage lines, shown apart in Settings > Usage

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 12: Mock mode and fake-agent job scenarios

**Files:**
- Modify: the mock replay's mark handling (`packages/fake-agent/src/mock-replay.ts`, where Sidekick's canned replies are keyed)
- Modify: `packages/fake-agent/fixtures/parallel-harness/` (add `jobs`, `jobs/*.md`, scenario scripts)
- Test: `packages/fake-agent/test/mock-replay.test.ts` (append)

- [ ] **Step 1: Write the failing test.** In mock mode, a turn whose first message carries the job marker (the job prompt's fixed sentence "This is a background job") replies with an MCP call to `job_result` `{ status: "ok", summary: "Mock run" }` and ends (Decision 10). A task turn is unchanged (D0 for mock mode).

- [ ] **Step 2: Implement** the canned reply, the same way Sidekick's are matched.

- [ ] **Step 3: Fixture jobs** (spec §11 "Fake agent"). Add to `parallel-harness`:
  - `jobs: { "sync": { label: "Sync", prompt: "./jobs/sync.md", on: { start: true, manual: true } }, "check": { label: "Check", prompt: "./jobs/check.md", on: { manual: true } }, "asker": { label: "Asker", prompt: "./jobs/asker.md", on: { manual: true } }, "silent": { label: "Silent", prompt: "./jobs/silent.md", on: { manual: true } } }`;
  - fake-claude turns matched by each brief's first words:
    - `sync` → `job_result` ok "Synced";
    - `check` → `job_result` needs-you "2 tickets without AC", action `write-a`;
    - `asker` → calls `choices` (gets the refusal), then `job_result` failed "Could not ask";
    - `silent` → text only, no `job_result`.

- [ ] **Step 4: Run, typecheck, commit.**

```bash
git -C <worktree> add packages/fake-agent/src packages/fake-agent/fixtures/parallel-harness packages/fake-agent/test
git -C <worktree> commit -m "test(fake-agent): job scenarios and canned job replies in mock mode

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 13: End to end — a `start` job, needs-you, asking refused, no result

**Files:**
- Create: `packages/e2e/tests/jobs.spec.ts`

- [ ] **Step 1: Write the e2e** (build as in part 2 Task 16):
  1. **`start` job** (spec §11):
     - after setup, `sync` runs once on its own;
     - the inbox's Jobs section shows "Sync · OK · Synced";
     - `.harness/jobs.jsonl` has one `start` record;
     - its commit (if it wrote anything) carries `Job: sync`;
     - `usage.jsonl` has a line with `phase: "job"`.
  2. **needs-you:**
     - "Run now" on `check`;
     - the row shows "Needs you" and the summary, and the inbox count includes it;
     - "Start" opens a `write-a` task.
  3. **A job that tries to ask:** `asker` ends `failed`, "Could not ask"; no choices card appears anywhere.
  4. **No result:** `silent` ends `failed`, "No result".
  5. **Dedupe:** two quick "Run now" on `sync` → one run in `jobs.jsonl`.
  6. **D0:** the demo-harness suite stays green (whole `corepack pnpm e2e`).

- [ ] **Step 2: Run.** `corepack pnpm app:build && corepack pnpm e2e`. Expected: green.

- [ ] **Step 3: Commit.**

```bash
git -C <worktree> add packages/e2e/tests/jobs.spec.ts
git -C <worktree> commit -m "test(e2e): start jobs, needs-you, asking refused and no result

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 14: Docs, guide and template

**Files:**
- Create: `docs/architecture/jobs.md`
- Modify: `docs/architecture/manifest.md` (`parallel`, `inbox`, `jobs`), `docs/architecture/history.md` (`Job:` trailers), `packages/cli/guide/new-harness.md`, `packages/cli/template/HARNESS.md`

- [ ] **Step 1: Write.**
- **`jobs.md`:**
  - the run's life: gate, slot, first message, `job_result`, log, usage, attention;
  - the triggers, dedupe and the daily cap;
  - `single` mode;
  - what a job can't do (ask, save notes, widen permissions);
  - mock mode;
  - the D0 table.
- **Guide and template:** when a job fits (a sync, a check after a task, a periodic digest), `tier: "light"` by default, `dailyTokens` for `every`, narrowing permissions (`{ edit: "none" }` for a data-only sync), and ending with `job_result`.

- [ ] **Step 2: Commit.**

```bash
git -C <worktree> add docs/architecture packages/cli/guide/new-harness.md packages/cli/template/HARNESS.md
git -C <worktree> commit -m "docs: background jobs

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

## Self-review (done while writing)

- Spec coverage:
  - §3 jobs + checks: Task 1.
  - §8:
    - kind job, no chat: Task 5;
    - can't ask: Task 2;
    - permissions: Tasks 1, 5 (Decision 5);
    - `job_result`: Tasks 2, 5;
    - no closing turn: Tasks 2, 5;
    - triggers, dedupe, daily cap: Task 6;
    - data writes: the store's existing queue (part 1 Decision 9).
  - §9 Jobs section and `client.jobs`: Tasks 8, 9.
  - §10:
    - usage: Task 11;
    - quit and engine switch for jobs: Tasks 6, 7.
  - §11:
    - unit tests: Tasks 1–6, 11;
    - fake agent: Task 12;
    - e2e `start` job: Task 13.
  - §13 slice 6 (guide, template): Task 14.
- Placeholders: Tasks 5–9 give test skeletons with exact assertions in comments; the implementer writes them in full with the named fakes. The reviewer checks they exist and fail without the change.
- Types:
  - `JobRunRecord`, `dedupeKey` in Task 3;
  - `runJob` in Task 5;
  - `JobScheduler` in Task 6;
  - `JobSummary` and `JobsInfo` in Task 9;
  - `hasJobs`, `jobResultSchema`, `JOB_CANNOT_ASK`, `JOB_NO_NOTE`, `JOB_RESULT_TOOL` in Task 1.
