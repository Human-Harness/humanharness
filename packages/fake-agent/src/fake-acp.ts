// Stand-in ACP agent. Reads its script from HH_FAKE_SCRIPT; appends every request it receives,
// and every permission outcome, as JSON lines to HH_FAKE_LOG.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { callMcpTool } from "./mcp-call";
import type { AcpScript } from "./script";

const script = JSON.parse(readFileSync(process.env.HH_FAKE_SCRIPT!, "utf8")) as AcpScript;
const log = (method: string, params: unknown) => {
  if (process.env.HH_FAKE_LOG) appendFileSync(process.env.HH_FAKE_LOG, JSON.stringify({ method, params }) + "\n");
};

type StdioMcp = { name: string; command: string; args: string[]; env: { name: string; value: string }[] };
let mcpServers: StdioMcp[] = [];
let cwd = process.cwd();
let turn = 0;
let cancelled = false;

const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
);

acp
  .agent({ name: "fake-acp" })
  .onRequest("initialize", (ctx) => {
    log("initialize", ctx.params);
    return { protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: { loadSession: Boolean(script.loadSession) } };
  })
  .onRequest("session/new", (ctx) => {
    log("session/new", ctx.params);
    mcpServers = (ctx.params.mcpServers ?? []) as StdioMcp[];
    cwd = ctx.params.cwd;
    return { sessionId: script.sessionId ?? "fake-acp-session" };
  })
  .onRequest("session/load", (ctx) => {
    log("session/load", ctx.params);
    mcpServers = (ctx.params.mcpServers ?? []) as StdioMcp[];
    cwd = ctx.params.cwd;
    return {};
  })
  .onNotification("session/cancel", (ctx) => {
    log("session/cancel", ctx.params);
    cancelled = true;
  })
  .onRequest("session/prompt", async (ctx) => {
    log("session/prompt", ctx.params);
    cancelled = false;
    const sessionId = ctx.params.sessionId;
    for (const step of script.turns[turn++] ?? [{ stop: "end_turn" }]) {
      if (cancelled) return { stopReason: "cancelled" as const };
      if ("update" in step) {
        await ctx.client.notify("session/update", { sessionId, update: step.update as never });
      } else if ("permission" in step) {
        const res = await ctx.client.request("session/request_permission", {
          sessionId,
          toolCall: step.permission.toolCall as never,
          options: [
            { optionId: "allow", name: "Allow", kind: "allow_once" },
            { optionId: "reject", name: "Reject", kind: "reject_once" },
          ],
        });
        log("permission-outcome", res.outcome);
      } else if ("mcp" in step) {
        const s = mcpServers.find((m) => m.name === step.mcp.server)!;
        const env = Object.fromEntries(s.env.map((e) => [e.name, e.value]));
        await callMcpTool({ command: s.command, args: s.args, env }, step.mcp.tool, step.mcp.args);
      } else if ("write" in step) {
        const file = path.resolve(cwd, step.write.path);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, step.write.content);
      } else if ("sleep" in step) {
        await new Promise((r) => setTimeout(r, step.sleep));
      } else if ("error" in step) {
        throw new acp.RequestError(step.error.code, step.error.message);
      } else if ("stop" in step) {
        return { stopReason: step.stop };
      }
    }
    return { stopReason: cancelled ? ("cancelled" as const) : ("end_turn" as const) };
  })
  .connect(stream);
