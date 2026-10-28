import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { getEngine } from "@humanharness/engines";
import { type AcpScript, type ClaudeScript, claudeResultLine, fakeAcpCommand, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { type HarnessJob, jobSchema, loadHarness } from "@humanharness/harness-sdk";
import { type Event, type HarnessWorkspace, type SessionSlot, type SlotOptions, type SlotSendOptions, createWorkspace } from "@humanharness/runtime";
import { APP_SCOPE, MAIN_SCOPE, type Note } from "@humanharness/workspace";
import { JobLog, type JobRunRecord } from "../../src/main/jobs/job-log";
import { type JobRunDeps, jobMessageFor, runJob } from "../../src/main/jobs/job-runner";
import { TurnGate } from "../../src/main/turn-gate";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-jobrun-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

const job = (o: Partial<HarnessJob> = {}): HarnessJob => jobSchema.parse({ label: "Sync", prompt: "jobs/sync.md", on: { manual: true }, ...o });

type Play = (emit: (e: Event) => void, cancelled: Promise<void>) => Promise<void>;

/** A workspace double: each slot's turn plays `play`; records the slot options, the send options and the closes. */
function fakeWorkspace(play: Play) {
  const opened: SlotOptions[] = [];
  const sent: { message: string; options?: SlotSendOptions }[] = [];
  const closed: string[] = [];
  const open = new Set<string>();
  let sendThrows = false;
  const ws = {
    async openSlot(o: SlotOptions): Promise<SessionSlot> {
      opened.push(o);
      open.add(o.key);
      let cancel: () => void = () => {};
      let busy = false;
      let current: Promise<void> | null = null;
      const slot = {
        key: o.key,
        isBusy: () => busy,
        send(message: string, emit: (e: Event) => void, options?: SlotSendOptions) {
          if (sendThrows) throw new Error("A turn is already running");
          sent.push({ message, options });
          busy = true;
          const cancelled = new Promise<void>((resolve) => {
            cancel = resolve;
          });
          let isCancelled = false;
          void cancelled.then(() => (isCancelled = true));
          const done = (async () => {
            await play(emit, cancelled);
            if (isCancelled) emit({ type: "done", ok: false, error: { code: "cancelled" } });
            busy = false;
          })();
          current = done;
          return { cancel: () => cancel(), done };
        },
        endSession: async () => {},
        sleep: async () => {},
        async close() {
          cancel();
          await current;
          closed.push(o.key);
          open.delete(o.key);
        },
      };
      return slot as SessionSlot;
    },
  } as unknown as HarnessWorkspace;
  return {
    ws,
    opened,
    sent,
    closed,
    open,
    failSend: () => {
      sendThrows = true;
    },
  };
}

const usage = (input: number, output: number): Extract<Event, { type: "usage" }> => ({
  type: "usage",
  inputTokens: input,
  outputTokens: output,
  cacheReadTokens: 1000,
  cacheWriteTokens: 5,
});
const result = (data: unknown): Event => ({ type: "block", name: "job_result", data });
const ok: Event = { type: "done", ok: true };

/** Plays these events, then ends. */
const events =
  (...es: Event[]): Play =>
  async (emit) => {
    for (const e of es) emit(e);
  };

function setup(play: Play, o: Partial<JobRunDeps> = {}) {
  const f = fakeWorkspace(play);
  const records: JobRunRecord[] = [];
  const usageCalls: { e: Event; meta: unknown }[] = [];
  const times = [new Date(2026, 9, 28, 10, 0, 0), new Date(2026, 9, 28, 10, 5, 0)];
  let t = 0;
  const gate = new TurnGate({ tasks: 1, jobs: 1 });
  const d: JobRunDeps = {
    workspace: async () => f.ws,
    gate,
    log: { append: async (r) => void records.push(r) },
    firstMessage: async (id, scope) => `brief of ${id} in ${scope ?? "-"}`,
    profileFor: async () => ({ tier: "light", model: "m" }) as never,
    recordUsage: async (e, meta) => void usageCalls.push({ e, meta }),
    actions: { implement: {} },
    now: () => times[Math.min(t++, times.length - 1)],
    newId: () => "r1",
    ...o,
  };
  return { ...f, d, gate, records, usageCalls, times };
}

describe("JobRunner (parallel spec §8)", () => {
  it("opens a job slot with narrowed permissions and the job trailer; logs ok with tokens", async () => {
    const s = setup(events(usage(100, 20), result({ status: "ok", summary: "3 tickets synced" }), ok));
    const r = await runJob(s.d, "sync", job({ permissions: { edit: "none", exec: false } }), "acme", "manual");
    expect(s.opened).toEqual([{ key: "job:r1", kind: "job", permissions: { edit: "none", exec: false } }]);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0].message).toBe("brief of sync in acme");
    expect(s.sent[0].options?.trailer).toEqual({ task: "r1", job: "sync", scope: "acme" });
    expect(s.sent[0].options?.profile).toEqual({ tier: "light", model: "m" });
    // Tokens toward the daily cap: input + output + cache writes (the cap's measure, usage-log capTokens).
    const expected: JobRunRecord = {
      run: "r1",
      job: "sync",
      scope: "acme",
      trigger: "manual",
      status: "ok",
      summary: "3 tickets synced",
      tokens: 125,
      startedAt: s.times[0].toISOString(),
      endedAt: s.times[1].toISOString(),
    };
    expect(r).toEqual(expected);
    expect(s.records).toEqual([expected]);
    expect(s.usageCalls).toEqual([{ e: usage(100, 20), meta: { job: "sync", task: "r1", scope: "acme" } }]);
    expect(s.closed).toEqual(["job:r1"]);
    expect(s.gate.running("jobs")).toBe(0);
  });

  it("an app-wide run has no scope in its trailer or usage; a job without permissions passes none", async () => {
    const s = setup(events(usage(1, 1), result({ status: "ok", summary: "done" }), ok));
    const r = await runJob(s.d, "sync", job(), null, "start");
    expect(s.opened).toEqual([{ key: "job:r1", kind: "job" }]);
    expect(s.sent[0].options?.trailer).toEqual({ task: "r1", job: "sync" });
    expect(s.usageCalls[0].meta).toEqual({ job: "sync", task: "r1" });
    expect(r).toMatchObject({ scope: null, trigger: "start", status: "ok" });
  });

  it("startedAt is the run's start, though the line is written at its end (Decision 9)", async () => {
    const s = setup(events(result({ status: "ok", summary: "x" }), ok));
    const log = new JobLog(fs.mkdtempSync(path.join(root, "log-")));
    await runJob({ ...s.d, log }, "sync", job(), null, "manual");
    const [line] = await log.all();
    expect(line.startedAt).toBe(s.times[0].toISOString());
    expect(line.endedAt).toBe(s.times[1].toISOString());
  });

  it("no job_result: failed, 'No result'", async () => {
    const s = setup(events(usage(10, 2), ok));
    const r = await runJob(s.d, "sync", job(), null, "manual");
    expect(r).toMatchObject({ status: "failed", summary: "No result", tokens: 17 });
    expect(r).not.toHaveProperty("action");
  });

  it("a malformed job_result counts as none", async () => {
    const s = setup(events(result({ status: "great", summary: "" }), ok));
    expect(await runJob(s.d, "sync", job(), null, "manual")).toMatchObject({ status: "failed", summary: "No result" });
  });

  it("the first job_result wins; a later one is ignored and logged", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = setup(events(result({ status: "needs-you", summary: "first", action: "implement" }), result({ status: "ok", summary: "second" }), ok));
    const r = await runJob(s.d, "sync", job(), null, "manual");
    expect(r).toMatchObject({ status: "needs-you", summary: "first", action: "implement" });
    expect(err).toHaveBeenCalledWith(expect.stringContaining("more than one result"));
  });

  it("the summary is one plain line: controls, separators and hidden characters go", async () => {
    const s = setup(events(result({ status: "ok", summary: "two\nlines\u0007 and\u200b\u202e hidden\u2028end   " }), ok));
    const r = await runJob(s.d, "sync", job(), null, "manual");
    expect(r?.summary).toBe("two lines and hidden end");
  });

  it("a summary with nothing left after cleaning reads 'No summary'", async () => {
    const s = setup(events(result({ status: "ok", summary: "\u200b\n" }), ok));
    expect((await runJob(s.d, "sync", job(), null, "manual"))?.summary).toBe("No summary");
  });

  it("needs-you keeps a real action only (J3)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = async (action: string, status = "needs-you") => {
      const s = setup(events(result({ status, summary: "2 tickets without AC", action }), ok));
      return runJob(s.d, "sync", job(), null, "manual");
    };
    expect(await run("implement")).toMatchObject({ status: "needs-you", action: "implement" });
    for (const bad of ["nope", "toString", "__proto__", "constructor"]) {
      const r = await run(bad);
      expect(r?.status).toBe("needs-you");
      expect(r, bad).not.toHaveProperty("action");
    }
    expect(err).toHaveBeenCalledWith(expect.stringContaining('"nope"'));
    // An action only goes with needs-you.
    expect(await run("implement", "ok")).not.toHaveProperty("action");
  });

  it("a run past its time limit is cancelled: failed, 'Timed out' (J6, Decision 8)", async () => {
    // The slot never finishes until cancelled: an engine that hangs (J1: a run never waits for anyone forever).
    const s = setup(async (emit, cancelled) => {
      emit(usage(5, 5));
      await cancelled;
    });
    const r = await runJob({ ...s.d, maxMs: 50 }, "sync", job(), null, "every");
    expect(r).toMatchObject({ status: "failed", summary: "Timed out", tokens: 15, trigger: "every" });
    expect(s.closed).toEqual(["job:r1"]);
    expect(s.gate.running("jobs")).toBe(0);
  });

  it("a job_result before the time limit doesn't save a run that times out", async () => {
    const s = setup(async (emit, cancelled) => {
      emit(result({ status: "ok", summary: "early" }));
      await cancelled;
    });
    expect(await runJob({ ...s.d, maxMs: 30 }, "sync", job(), null, "manual")).toMatchObject({ status: "failed", summary: "Timed out" });
  });

  it("a run aborted by its signal is cancelled: failed, 'Cancelled' (Decision 11)", async () => {
    const s = setup(async (_emit, cancelled) => {
      await cancelled;
    });
    const ac = new AbortController();
    const p = runJob(s.d, "sync", job(), null, "manual", ac.signal);
    await vi.waitFor(() => expect(s.sent).toHaveLength(1));
    ac.abort();
    expect(await p).toMatchObject({ status: "failed", summary: "Cancelled" });
    expect(s.closed).toEqual(["job:r1"]);
  });

  it("an abort while the run gets ready (its first message pending) cancels it before anything is sent", async () => {
    let gave: (m: string) => void = () => {};
    const s = setup(events(result({ status: "ok", summary: "x" }), ok), {
      firstMessage: () =>
        new Promise<string>((resolve) => {
          gave = resolve;
        }),
    });
    const ac = new AbortController();
    const p = runJob(s.d, "sync", job(), null, "manual", ac.signal);
    await vi.waitFor(() => expect(s.opened).toHaveLength(1));
    ac.abort();
    expect(await p).toMatchObject({ status: "failed", summary: "Cancelled" });
    expect(s.sent).toHaveLength(0);
    expect(s.closed).toEqual(["job:r1"]);
    expect(s.gate.running("jobs")).toBe(0);
    // The message that comes late is never sent.
    gave("late");
    await new Promise((r) => setTimeout(r, 10));
    expect(s.sent).toHaveLength(0);
  });

  it("the time limit covers getting ready: a first message that never comes, a slot that opens late", async () => {
    const a = setup(events(ok), { firstMessage: () => new Promise<string>(() => {}), maxMs: 30 });
    expect(await runJob(a.d, "sync", job(), null, "manual")).toMatchObject({ status: "failed", summary: "Timed out" });
    expect(a.sent).toHaveLength(0);
    expect(a.closed).toEqual(["job:r1"]);
    expect(a.gate.running("jobs")).toBe(0);

    let openNow: () => void = () => {};
    const late = new Promise<void>((resolve) => {
      openNow = resolve;
    });
    const b = setup(events(ok), { maxMs: 30 });
    const inner = b.ws;
    const ws = { openSlot: async (o: SlotOptions) => late.then(() => inner.openSlot(o)) } as unknown as HarnessWorkspace;
    expect(await runJob({ ...b.d, workspace: async () => ws }, "sync", job(), null, "manual")).toMatchObject({
      status: "failed",
      summary: "Timed out",
    });
    expect(b.gate.running("jobs")).toBe(0);
    // The slot that opens after the run gave up is closed at once: its key is not left behind.
    openNow();
    await vi.waitFor(() => expect(b.closed).toEqual(["job:r1"]));
    expect(b.sent).toHaveLength(0);
    expect(b.open.size).toBe(0);
  });

  it("an engine's own cancelled end reads 'Cancelled'", async () => {
    const s = setup(events({ type: "done", ok: false, error: { code: "cancelled" } }));
    expect(await runJob(s.d, "sync", job(), null, "manual")).toMatchObject({ status: "failed", summary: "Cancelled" });
  });

  it("waits for a jobs slot in the gate; a dropped run logs nothing and resolves null", async () => {
    const s = setup(events(result({ status: "ok", summary: "x" }), ok));
    const hold = s.gate.tryAcquire("jobs", { id: "other" });
    expect(hold).not.toBeNull();
    const p = runJob(s.d, "sync", job(), null, "manual");
    await vi.waitFor(() => expect(s.gate.isQueued("job:r1")).toBe(true));
    expect(s.opened).toHaveLength(0);
    hold!();
    expect(await p).toMatchObject({ status: "ok" });

    const s2 = setup(events(result({ status: "ok", summary: "x" }), ok));
    const hold2 = s2.gate.tryAcquire("jobs", { id: "other" })!;
    const dropped = runJob(s2.d, "sync", job(), null, "manual");
    await vi.waitFor(() => expect(s2.gate.isQueued("job:r1")).toBe(true));
    expect(s2.gate.drop("job:r1")).not.toBeNull();
    expect(await dropped).toBeNull();
    expect(s2.records).toEqual([]);
    expect(s2.opened).toHaveLength(0);
    hold2();
  });

  it("an abort while queued takes the run out of the queue: null, nothing logged", async () => {
    const s = setup(events(ok));
    const hold = s.gate.tryAcquire("jobs", { id: "other" })!;
    const ac = new AbortController();
    const p = runJob(s.d, "sync", job(), null, "manual", ac.signal);
    await vi.waitFor(() => expect(s.gate.isQueued("job:r1")).toBe(true));
    ac.abort();
    expect(await p).toBeNull();
    expect(s.gate.isQueued("job:r1")).toBe(false);
    expect(s.records).toEqual([]);
    hold();
    // Already aborted: never queued.
    expect(await runJob(s.d, "sync", job(), null, "manual", ac.signal)).toBeNull();
    expect(s.opened).toHaveLength(0);
  });

  it("an out-of-quota end pauses the queues (same rule as tasks)", async () => {
    const resetsAt = new Date(Date.now() + 3_600_000).toISOString();
    const s = setup(
      events(
        { type: "limits", status: "rejected", windows: [{ kind: "five_hour", utilization: 1, resetsAt }] },
        { type: "done", ok: false, error: { code: "out-of-quota" } },
      ),
    );
    const r = await runJob(s.d, "sync", job(), null, "every");
    expect(r).toMatchObject({ status: "failed", summary: "No result" });
    expect(s.gate.paused()).toEqual({ reason: "out-of-quota", resetsAt });
    s.gate.dispose();
  });

  it("never leaks the slot or the gate: a first message that fails, a send that throws, a slot that can't open", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = setup(events(ok), {
      firstMessage: async () => {
        throw new Error("no brief");
      },
    });
    expect(await runJob(a.d, "sync", job(), null, "manual")).toMatchObject({ status: "failed", summary: "Could not run" });
    expect(a.closed).toEqual(["job:r1"]);
    expect(a.gate.running("jobs")).toBe(0);

    const b = setup(events(ok));
    b.failSend();
    expect(await runJob(b.d, "sync", job(), null, "manual")).toMatchObject({ status: "failed", summary: "Could not run" });
    expect(b.closed).toEqual(["job:r1"]);
    expect(b.gate.running("jobs")).toBe(0);

    const c = setup(events(ok), {
      workspace: async () => {
        throw new Error("no folder");
      },
    });
    expect(await runJob(c.d, "sync", job(), null, "manual")).toMatchObject({ status: "failed", summary: "Could not run" });
    expect(c.gate.running("jobs")).toBe(0);
    expect(err).toHaveBeenCalled();
  });

  it("a usage line that can't be recorded is logged; the run still counts its tokens", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = setup(events(usage(3, 4), result({ status: "ok", summary: "x" }), ok), {
      recordUsage: async () => {
        throw new Error("disk full");
      },
    });
    expect(await runJob(s.d, "sync", job(), null, "manual")).toMatchObject({ status: "ok", tokens: 12 });
    expect(err).toHaveBeenCalledWith("Could not record a job's usage", expect.any(Error));
  });
});

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fake-agent/fixtures/notes-harness/harness.config.ts");

describe("JobRunner on a real workspace (Decision 5 addendum)", () => {
  let ws: HarnessWorkspace | undefined;
  afterEach(async () => {
    await ws?.close();
    ws = undefined;
  });

  it("a job with exec: false runs with Bash in Claude's --disallowedTools, its ui server marked; the slot closes after", async () => {
    const base = fs.mkdtempSync(path.join(root, "ws-"));
    const args = path.join(base, "args.json");
    ws = await createWorkspace({
      harness: { ...(await loadHarness(FIXTURE)), permissions: { edit: "folder", exec: true, web: true } },
      engine: getEngine("claude"),
      folder: path.join(base, "Work"),
      gitdir: path.join(base, "h.git"),
      language: "en",
      command: fakeClaudeCommand(),
      env: { HH_FAKE_SCRIPT: writeScript(base, { steps: [claudeResultLine(true)] } as ClaudeScript), HH_FAKE_ARGS: args },
    });
    const w = ws;
    const s = setup(events(), { workspace: async () => w, profileFor: undefined });
    const r = await runJob(s.d, "sync", job({ permissions: { exec: false } }), null, "manual");
    const argv = JSON.parse(fs.readFileSync(args, "utf8")) as string[];
    expect(argv[argv.indexOf("--disallowedTools") + 1].split(",")).toContain("Bash");
    expect(argv[argv.indexOf("--allowedTools") + 1].split(",")).not.toContain("Bash");
    const servers = JSON.parse(argv[argv.indexOf("--mcp-config") + 1]).mcpServers as Record<string, { env: Record<string, string> }>;
    expect(servers.ui.env.HH_JOB).toBe("1");
    // The fake engine called no job_result.
    expect(r).toMatchObject({ status: "failed", summary: "No result" });
    // The slot's key is free again: it was closed.
    const again = await w.openSlot({ key: "job:r1", kind: "job" });
    await again.close();
  }, 30_000);
});

describe("JobRunner on a Codex workspace (spec §8: a job cannot ask for permission)", () => {
  let ws: HarnessWorkspace | undefined;
  afterEach(async () => {
    await ws?.close();
    ws = undefined;
  });

  it("an exec: false job's command permission request is rejected by the slot's policy, never asked; its job_result still ends the run", async () => {
    const base = fs.mkdtempSync(path.join(root, "acp-"));
    const log = path.join(base, "acp.jsonl");
    const script: AcpScript = {
      turns: [
        [
          { permission: { toolCall: { toolCallId: "x1", title: "Run command", kind: "execute", rawInput: { command: "ls" } } } },
          { mcp: { server: "ui", tool: "job_result", args: { status: "ok", summary: "Synced" } } },
          { stop: "end_turn" },
        ],
      ],
    };
    ws = await createWorkspace({
      // The harness allows commands; the job turns them off.
      harness: { ...(await loadHarness(FIXTURE)), permissions: { edit: "folder", exec: true, web: false } },
      engine: getEngine("codex"),
      folder: path.join(base, "Work"),
      gitdir: path.join(base, "h.git"),
      language: "en",
      command: fakeAcpCommand(),
      env: { HH_FAKE_SCRIPT: writeScript(base, script), HH_FAKE_LOG: log },
    });
    const w = ws;
    const s = setup(events(), { workspace: async () => w, profileFor: undefined });
    const r = await runJob(s.d, "sync", job({ permissions: { exec: false } }), null, "manual");
    const lines = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { method?: string; params?: unknown });
    expect(lines.filter((l) => l.method === "permission-outcome").map((l) => l.params)).toEqual([{ outcome: "selected", optionId: "reject" }]);
    expect(r).toMatchObject({ status: "ok", summary: "Synced" });
  }, 30_000);
});

describe("jobMessageFor (the job prompt's wiring)", () => {
  const notes = (scopes: (string | undefined)[]) => async (scope?: string): Promise<Note[]> => {
    scopes.push(scope);
    return [];
  };

  it("an app-wide run reads the app scope with scopes, main without; data is asked with no action", async () => {
    const asked: (string | undefined)[] = [];
    const dataContext = vi.fn(async () => "## Data");
    const materialContext = vi.fn(async () => "");
    const readBrief = vi.fn(async (j: HarnessJob) => `Brief from ${j.prompt}.`);
    const jobs = { sync: job() };
    const scoped = jobMessageFor({ jobs, readBrief, notes: notes(asked), scoped: true, dataContext, materialContext, actions: { implement: { label: "Implement" } } });
    const m = await scoped("sync", null);
    expect(m).toContain("Brief from jobs/sync.md.");
    expect(m).toContain("## Data");
    expect(m).toContain("implement (Implement)");
    expect(dataContext).toHaveBeenCalledWith(APP_SCOPE, undefined);
    expect(materialContext).toHaveBeenCalledWith(APP_SCOPE);
    expect(asked).toEqual([APP_SCOPE]);

    await scoped("sync", "acme");
    expect(dataContext).toHaveBeenLastCalledWith("acme", undefined);

    const plainAsked: (string | undefined)[] = [];
    const plainData = vi.fn(async () => "");
    const plain = jobMessageFor({ jobs, readBrief, notes: notes(plainAsked), scoped: false, dataContext: plainData, actions: {} });
    await plain("sync", null);
    expect(plainAsked).toEqual([undefined]);
    expect(plainData).toHaveBeenCalledWith(MAIN_SCOPE, undefined);
  });

  it("an unknown job id is refused", async () => {
    const m = jobMessageFor({ jobs: {}, readBrief: async () => "", notes: async () => [], scoped: false, actions: {} });
    await expect(m("toString", null)).rejects.toThrow(/No job/);
  });
});
