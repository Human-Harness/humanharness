import os from "node:os";
import { describe, expect, it } from "vitest";
import { ENGINES, type CommonOptions, type EngineDef, getEngine } from "../src";
import { ADAPTERS, AcpTransport, ClaudeCliTransport, type TransportOptions, commandLine, createRegistry, createTransport } from "../src/registry";

const options = (edit: "folder" | "none"): CommonOptions => ({
  folder: os.tmpdir(),
  session: { id: "s", started: false },
  mcp: [],
  permissions: { edit, exec: false, web: false },
  command: ["unused"],
  onSessionStarted: () => {},
});
/** The options an ACP transport was built with (its constructor keeps them). */
const acpOptions = (t: unknown) => (t as { o: TransportOptions }).o;

describe("the engine registry", () => {
  it("has an adapter for every engine, and none can fork or keep memory yet", () => {
    for (const e of ENGINES) {
      expect(ADAPTERS[e.id], e.id).toBeDefined();
      expect(ADAPTERS[e.id].capabilities).toEqual({ forkSession: false, nativeMemory: false });
    }
  });

  it("names each engine's CLI as before", () => {
    expect(commandLine(getEngine("claude"))).toEqual(["claude"]);
    expect(commandLine(getEngine("codex"))).toEqual(["npx", "-y", "@agentclientprotocol/codex-acp@2.2.2"]);
    expect(commandLine(getEngine("opencode"))).toEqual(["opencode", "acp"]);
    expect(commandLine(getEngine("kimi"))).toEqual(["kimi", "acp"]);
  });

  it("builds Claude's CLI transport and the ACP client for the others", () => {
    expect(createTransport(getEngine("claude"), options("folder"))).toBeInstanceOf(ClaudeCliTransport);
    for (const id of ["codex", "opencode", "kimi"]) expect(createTransport(getEngine(id), options("folder"))).toBeInstanceOf(AcpTransport);
  });

  it("derives the ACP fields from the definition it is given and the edit permission", () => {
    expect(acpOptions(createTransport(getEngine("codex"), options("folder")))).toMatchObject({ sessionMode: "workspace-write", minAdapterVersion: "2.2.2" });
    expect(acpOptions(createTransport(getEngine("codex"), options("none")))).toMatchObject({ sessionMode: "read-only" });
    expect(acpOptions(createTransport(getEngine("opencode"), options("none")))).toMatchObject({ sessionMode: "plan", profileMethod: "config-option" });
    // A copy of a definition (tests do this) is read as given, not swapped for the registry's own.
    const codex = getEngine("codex");
    if (codex.transport.kind !== "acp") throw new Error("codex must use ACP");
    const copy: EngineDef = { ...codex, transport: { ...codex.transport, minAdapterVersion: "9.0.0" } };
    expect(acpOptions(createTransport(copy, options("folder"))).minAdapterVersion).toBe("9.0.0");
  });

  it("keeps the caller's options", () => {
    const o = { ...options("folder"), command: ["/bin/fake"], env: { HH_FAKE_X: "1" }, mcpOnly: true };
    expect(acpOptions(createTransport(getEngine("codex"), o))).toMatchObject({ command: ["/bin/fake"], env: { HH_FAKE_X: "1" }, mcpOnly: true });
  });

  it("refuses an engine with no adapter", () => {
    const unknown: EngineDef = { ...getEngine("kimi"), id: "nobody" };
    expect(() => createTransport(unknown, options("none"))).toThrow(/No adapter for engine: nobody/);
    expect(() => commandLine(unknown)).toThrow(/No adapter for engine: nobody/);
  });

  it("takes a new engine with one more line", () => {
    const echo = { ...ADAPTERS.claude, command: () => ["echo-agent"] };
    const registry = createRegistry({ ...ADAPTERS, echo });
    expect(registry.commandLine({ ...getEngine("claude"), id: "echo" })).toEqual(["echo-agent"]);
  });
});
