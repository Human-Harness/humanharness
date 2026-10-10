import { promises as fs } from "node:fs";
import { type Bridge, type Launcher, type McpServerSpec, devLauncher, openBridge, uiServerSpec } from "@humanharness/blocks";
import type { EngineDef } from "@humanharness/engines";
import { type Language, type LoadedHarness, resolveInHarness } from "@humanharness/harness-sdk";
import { History, prepareFolder, writeInstructions } from "@humanharness/workspace";
import { AcpTransport } from "./acp";
import { ClaudeCliTransport } from "./claude-cli";
import type { Event } from "./events";
import { readSession, writeSession } from "./session-store";
import type { Transport, TransportOptions } from "./transport";

export interface RuntimeOptions {
  harness: LoadedHarness;
  engine: EngineDef;
  /** The user's visible folder. */
  folder: string;
  /** Where the hidden history lives (outside `folder`). */
  gitdir: string;
  language: Language;
  /** How to run Node for MCP servers. Defaults to tsx (development). */
  launcher?: Launcher;
  /** Override the engine's CLI command (tests, dev). */
  command?: string[];
  /** Extra CLI environment (tests, dev). Never credentials. */
  env?: Record<string, string>;
}

export interface RunningTurn {
  cancel(): void;
  done: Promise<void>;
}

export interface HarnessRuntime {
  send(message: string, emit: (e: Event) => void): RunningTurn;
  history: History;
  close(): Promise<void>;
}

function harnessMcpServers(harness: LoadedHarness, launcher: Launcher): McpServerSpec[] {
  return harness.mcp.map((rel, i) => ({
    name: i === 0 ? harness.id : `${harness.id}-${i + 1}`,
    command: launcher.command,
    args: [...launcher.args, resolveInHarness(harness, rel)],
    env: { ...launcher.env },
  }));
}

export async function createRuntime(opts: RuntimeOptions): Promise<HarnessRuntime> {
  const { harness, engine, folder } = opts;
  const launcher = opts.launcher ?? devLauncher();

  await prepareFolder(folder, harness.folder.seed ? resolveInHarness(harness, harness.folder.seed) : undefined);
  const base = await fs.readFile(resolveInHarness(harness, harness.instructions), "utf8");
  const generated = await writeInstructions({ folder, base, language: opts.language, blocks: harness.blocks, engine });

  const history = new History(folder, opts.gitdir, [".harness/", ...generated]);
  await history.init();
  await history.save("Start");

  let emitCurrent: ((e: Event) => void) | null = null;
  const bridge: Bridge = await openBridge((m) => emitCurrent?.({ type: "block", name: m.name, data: m.data }));

  let sessionWrite: Promise<void> = Promise.resolve();
  const transportOptions: TransportOptions = {
    folder,
    session: await readSession(folder, engine.id),
    mcp: [uiServerSpec({ harnessConfig: harness.configPath, bridge, launcher }), ...harnessMcpServers(harness, launcher)],
    permissions: harness.permissions,
    sessionMode:
      engine.transport.kind === "acp"
        ? engine.transport.modes?.[harness.permissions.edit === "folder" ? "edit" : "readOnly"]
        : undefined,
    command: opts.command ?? (engine.transport.kind === "claude-cli" ? [engine.transport.binary] : engine.transport.command),
    env: opts.env,
    onSessionStarted: (s) => {
      sessionWrite = writeSession(folder, engine.id, s);
    },
  };
  const transport: Transport =
    engine.transport.kind === "claude-cli" ? new ClaudeCliTransport(transportOptions) : new AcpTransport(transportOptions);

  let busy = false;

  return {
    history,
    send(message, emit) {
      if (busy) throw new Error("A turn is already running");
      busy = true;
      const controller = new AbortController();
      const done = (async () => {
        try {
          const before = (await history.save("Before message")) ?? (await history.last())!;
          let final: Event | undefined;
          emitCurrent = emit;
          await transport.turn(message, (e) => (e.type === "done" ? (final = e) : emit(e)), controller.signal);
          emitCurrent = null;
          await sessionWrite;
          if (final?.type === "done" && final.ok) await history.save(`Turn: ${message.slice(0, 60)}`);
          else if (final?.type === "done" && final.error.code === "agent-crashed") await history.restore(before, "Undo: the turn did not finish");
          else await history.save(`Stopped: ${message.slice(0, 60)}`);
          emit(final ?? { type: "done", ok: false, error: { code: "agent-crashed" } });
        } finally {
          emitCurrent = null;
          busy = false;
        }
      })();
      return { cancel: () => controller.abort(), done };
    },
    async close() {
      await transport.close();
      await bridge.close();
    },
  };
}
