import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { type EngineAdapter, type EngineDef, type Event, type Transport, getEngine } from "@humanharness/engines";
import { ADAPTERS, createRegistry } from "@humanharness/engines/registry";
import { loadHarness } from "@humanharness/harness-sdk";
import { createRuntime } from "../src/runtime";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-echo-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/notes-harness/harness.config.ts");

// ---- the new engine's folder: a transport and its adapter ----
class EchoTransport implements Transport {
  async turn(message: string, emit: (event: Event) => void): Promise<void> {
    emit({ type: "text", delta: `echo: ${message}` });
    emit({ type: "done", ok: true });
  }
  async endSession(): Promise<void> {}
  async close(): Promise<void> {}
}
const echoAdapter: EngineAdapter = {
  capabilities: { forkSession: false, nativeMemory: false, noBuiltins: false },
  command: () => ["echo-agent"],
  createTransport: () => new EchoTransport(),
};
const echo: EngineDef = { ...getEngine("claude"), id: "echo", name: "Echo" };
// ---- the registry line ----
const registry = createRegistry({ ...ADAPTERS, echo: echoAdapter });

describe("a new engine", () => {
  it("runs a turn through the runtime with one adapter and one registry line", async () => {
    const folder = path.join(fs.mkdtempSync(path.join(root, "t-")), "Work");
    const runtime = await createRuntime({
      harness: await loadHarness(FIXTURE),
      engine: echo,
      folder,
      gitdir: path.join(path.dirname(folder), "history.git"),
      language: "en",
      registry,
    });
    try {
      const events: Event[] = [];
      await runtime.send("hi", (e) => events.push(e)).done;
      expect(events).toContainEqual({ type: "text", delta: "echo: hi" });
      expect(events.at(-1)).toEqual({ type: "done", ok: true });
    } finally {
      await runtime.close();
    }
  });
});
