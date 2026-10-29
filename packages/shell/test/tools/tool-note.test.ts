import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ToolRegistry, type ToolRegistryDeps } from "../../src/main/tools/tool-registry";
import { ToolTrace, type TraceEntry } from "../../src/main/tools/tool-trace";
import { toolCallView } from "../../src/main/tools/tools-host";

const TASK = "0b9f3c1e-5a2d-4c6b-9e8f-1a2b3c4d5e6f";
const AT = "2026-10-29T10:00:00.000Z";

function registry(o: { append?: (e: TraceEntry) => Promise<void>; called?: (e: TraceEntry) => void } = {}) {
  const seen = { entries: [] as TraceEntry[], called: [] as TraceEntry[], logs: [] as string[] };
  const deps: ToolRegistryDeps = {
    json: async () => ({ on: true, tools: {} }),
    host: { call: async () => ({ ok: true, value: null }), off: () => null },
    broker: () => ({ startCall: () => ({ id: "run-1", signal: new AbortController().signal }), endCall: () => ({ accesses: [], logs: [] }) }),
    trace: { append: o.append ?? (async (e) => void seen.entries.push(e)) },
    secretValues: async () => [],
    called: o.called ?? ((e) => void seen.called.push(e)),
    now: () => new Date(AT),
    log: (m) => void seen.logs.push(m),
  };
  return { r: new ToolRegistry(deps), seen };
}

describe("trace notes (tools spec §6.3, §6.1; P6)", () => {
  it("note() appends an entry with note, caller and task, ok true, ms 0, no args", async () => {
    const { r, seen } = registry();
    await r.note({ tool: "due-today", caller: "pre", task: TASK, text: "today: cut: 12 of 40 items" });
    expect(seen.entries).toEqual([
      { at: AT, tool: "due-today", caller: "pre", task: TASK, args: null, resultSummary: "", ms: 0, ok: true, accesses: [], note: "today: cut: 12 of 40 items" },
    ]);
  });

  it("note() keeps the phase, job and run it is given", async () => {
    const { r, seen } = registry();
    await r.note({ tool: "apply-evidence", caller: "agent", task: TASK, phase: "close", text: "Expected apply-evidence in Close: not called" });
    expect(seen.entries[0]).toMatchObject({ task: TASK, phase: "close" });
    await r.note({ tool: "x", caller: "job", job: "digest", run: TASK, text: "n" });
    expect(seen.entries[1]).toMatchObject({ job: "digest", run: TASK });
    expect(seen.entries[1]).not.toHaveProperty("task");
  });

  it("a note is put on one line", async () => {
    const { r, seen } = registry();
    await r.note({ tool: "t", caller: "pre", task: TASK, text: "  a\nb\r\n\tc d\u0007e  " });
    expect(seen.entries[0]!.note).toBe("a b c d e");
  });

  it("hidden characters (bidi controls, zero-width) are removed", async () => {
    const { r, seen } = registry();
    await r.note({ tool: "t", caller: "pre", task: TASK, text: "a‮b​c﻿d⁦e" });
    expect(seen.entries[0]!.note).toBe("abcde");
  });

  it("every hidden character the SDK names is removed (U+061C, soft hyphen, variation selectors, tags), breaks still a space", async () => {
    const { r, seen } = registry();
    await r.note({ tool: "t", caller: "pre", task: TASK, text: "a؜b­c͏d᠋e️f￹g\u{e0041}h\u{e0100}i j k" });
    expect(seen.entries[0]!.note).toBe("abcdefghi j k");
  });

  it("a note is cut at 200 characters (code points)", async () => {
    const { r, seen } = registry();
    await r.note({ tool: "t", caller: "pre", task: TASK, text: "x".repeat(300) });
    expect(seen.entries[0]!.note).toBe("x".repeat(200));
    await r.note({ tool: "t", caller: "pre", task: TASK, text: "😀".repeat(300) });
    expect([...seen.entries[1]!.note!]).toHaveLength(200);
  });

  it("a tool id that isn't one writes nothing and is logged", async () => {
    const { r, seen } = registry();
    await r.note({ tool: "../evil", caller: "pre", task: TASK, text: "n" });
    expect(seen.entries).toEqual([]);
    expect(seen.called).toEqual([]);
    expect(seen.logs).toHaveLength(1);
  });

  it("called() gets the note entry, so it reaches the chat", async () => {
    const { r, seen } = registry();
    await r.note({ tool: "due-today", caller: "pre", task: TASK, text: "today: cut: 12 of 40 items" });
    expect(seen.called).toEqual(seen.entries);
  });

  it("a trace that fails or a called() that throws never makes note() throw", async () => {
    const { r, seen } = registry({
      append: async () => {
        throw new Error("disk");
      },
      called: () => {
        throw new Error("ui");
      },
    });
    await expect(r.note({ tool: "t", caller: "pre", task: TASK, text: "n" })).resolves.toBeUndefined();
    expect(seen.logs).toHaveLength(2);
  });

  it("the view of a note entry carries note", () => {
    const e: TraceEntry = { at: AT, tool: "due-today", caller: "pre", task: TASK, args: null, resultSummary: "", ms: 0, ok: true, accesses: [], note: "today: cut: 12 of 40 items" };
    expect(toolCallView(e).note).toBe("today: cut: 12 of 40 items");
  });

  it("the view of a call has no note key (slice 2's shape)", () => {
    const e: TraceEntry = { at: AT, tool: "due-today", caller: "agent", args: {}, resultSummary: "1 item", ms: 3, ok: true, accesses: [] };
    expect(toolCallView(e)).not.toHaveProperty("note");
  });

  it("the trace file keeps a note and reads it back; a note that isn't a string of at most 200 is dropped on read", async () => {
    const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "hh-tool-note-")));
    const trace = new ToolTrace({ base });
    const e: TraceEntry = { at: AT, tool: "t", caller: "pre", task: TASK, args: null, resultSummary: "", ms: 0, ok: true, accesses: [], note: "kept" };
    await trace.append(e);
    await trace.append({ ...e, note: 7 as never });
    await trace.append({ ...e, note: "y".repeat(201) });
    const read = await trace.read(TASK);
    expect(read[0]).toEqual(e);
    expect(read[1]).not.toHaveProperty("note");
    expect(read[2]).not.toHaveProperty("note");
  });
});

