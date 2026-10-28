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

const withUsage = <T extends object>(r: T) => (script.usage ? { ...r, usage: script.usage } : r);

type StdioMcp = { name: string; command: string; args: string[]; env: { name: string; value: string }[] };
let mcpServers: StdioMcp[] = [];
let cwd = process.cwd();
let turn = 0;
let sessions = 0;
let cancelled = false;
let wake: (() => void) | undefined;

// The session's config options, as `session/set_config_option` changes them.
type Select = { id: string; type?: string; currentValue?: unknown; options?: ({ value?: unknown } | { options?: { value?: unknown }[] })[] };
let configOptions: Select[] = [];
const values = (o: Select) => (o.options ?? []).flatMap((x) => ("options" in x && Array.isArray(x.options) ? x.options : [x])).map((x) => (x as { value?: unknown }).value);

/** Like OpenCode: an `effort` select only for a model with variants, keeping the effort when the model offers it. */
function withEffort(options: Select[]): Select[] {
  if (!script.variants) return options;
  const model = options.find((o) => o.id === "model")?.currentValue;
  const variants = typeof model === "string" ? (script.variants[model] ?? []) : [];
  const rest = options.filter((o) => o.id !== "effort");
  if (variants.length === 0) return rest;
  const offered = [...variants, "default"];
  const current = options.find((o) => o.id === "effort")?.currentValue;
  const effort = {
    id: "effort",
    name: "Variant",
    category: "thought_level",
    type: "select",
    currentValue: typeof current === "string" && offered.includes(current) ? current : "default",
    options: offered.map((v) => ({ value: v, name: v })),
  };
  return [...rest, effort];
}

const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
);

acp
  .agent({ name: "fake-acp" })
  .onRequest("initialize", (ctx) => {
    log("env", {
      CODEX_CONFIG: process.env.CODEX_CONFIG ?? null,
      OPENCODE_CONFIG_CONTENT: process.env.OPENCODE_CONFIG_CONTENT ?? null,
      OPENCODE_PERMISSION: process.env.OPENCODE_PERMISSION ?? null,
      OPENCODE_DISABLE_CLAUDE_CODE: process.env.OPENCODE_DISABLE_CLAUDE_CODE ?? null,
    });
    log("initialize", ctx.params);
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: Boolean(script.loadSession),
        ...(script.closeSession || script.additionalDirectories
          ? {
              sessionCapabilities: {
                ...(script.closeSession ? { close: {} } : {}),
                ...(script.additionalDirectories ? { additionalDirectories: {} } : {}),
              },
            }
          : {}),
      },
      ...(script.agentVersion ? { agentInfo: { name: "fake-acp", version: script.agentVersion } } : {}),
    };
  })
  .onRequest("session/new", (ctx) => {
    log("session/new", ctx.params);
    mcpServers = (ctx.params.mcpServers ?? []) as StdioMcp[];
    cwd = ctx.params.cwd;
    const base = script.sessionId ?? "fake-acp-session";
    sessions++;
    configOptions = withEffort((script.configOptions ?? []) as Select[]);
    return {
      sessionId: sessions === 1 ? base : `${base}-${sessions}`,
      ...(script.configOptions ? { configOptions } : {}),
      ...(script.currentModelId ? { models: { currentModelId: script.currentModelId, availableModels: [] } } : {}),
    } as never;
  })
  .onRequest("session/load", async (ctx) => {
    log("session/load", ctx.params);
    if (script.failLoad) throw new acp.RequestError(-32603, "Session not found");
    for (const update of script.loadReplay ?? []) {
      await ctx.client.notify("session/update", { sessionId: ctx.params.sessionId, update: update as never });
    }
    mcpServers = (ctx.params.mcpServers ?? []) as StdioMcp[];
    cwd = ctx.params.cwd;
    // Like OpenCode: a loaded session answers with its config options too.
    configOptions = withEffort((script.configOptions ?? []) as Select[]);
    return {
      ...(script.configOptions ? { configOptions } : {}),
      ...(script.currentModelId ? { models: { currentModelId: script.currentModelId, availableModels: [] } } : {}),
    } as never;
  })
  .onRequest("session/set_mode", (ctx) => {
    log("session/set_mode", ctx.params);
    return {};
  })
  .onRequest("session/set_config_option", async (ctx) => {
    log("session/set_config_option", ctx.params);
    const { configId, value } = ctx.params;
    const option = configOptions.find((o) => o.id === configId);
    // OpenCode answers an unknown option, model, effort or mode with invalid params.
    // Its error data names what it refused (modelId, effort or configId).
    if (!option) throw new acp.RequestError(-32602, `Unknown config option: ${configId}`, { configId });
    if (!values(option).includes(value) || (typeof value === "string" && script.rejectConfigValues?.includes(value))) {
      const data = configId === "model" ? { modelId: value } : configId === "effort" ? { effort: value } : { configId };
      throw new acp.RequestError(-32602, `Unknown value: ${String(value)}`, data);
    }
    configOptions = withEffort(configOptions.map((o) => (o.id === configId ? { ...o, currentValue: value } : o)));
    // Setting the model also sends a config_option_update, like OpenCode.
    if (configId === "model") {
      await ctx.client.notify("session/update", {
        sessionId: ctx.params.sessionId,
        update: { sessionUpdate: "config_option_update", configOptions } as never,
      });
    }
    return { configOptions } as never;
  })
  .onRequest("session/close", async (ctx) => {
    log("session/close", ctx.params);
    if (script.hangClose) await new Promise(() => {});
    return {};
  })
  .onNotification("session/cancel", (ctx) => {
    log("session/cancel", ctx.params);
    cancelled = true;
    wake?.();
  })
  .onRequest("session/prompt", async (ctx) => {
    log("session/prompt", ctx.params);
    cancelled = false;
    const sessionId = ctx.params.sessionId;
    const cost = script.costs?.[turn];
    // Like OpenCode: the running cost arrives once, at the prompt's end.
    const end = async (stopReason: "end_turn" | "cancelled" | "refusal") => {
      if (cost !== undefined) {
        const update = { sessionUpdate: "usage_update", used: 1000, size: 200_000, cost: { amount: cost, currency: "USD" } };
        await ctx.client.notify("session/update", { sessionId, update: update as never });
      }
      return withUsage({ stopReason }) as never;
    };
    for (const step of script.turns[turn++] ?? [{ stop: "end_turn" }]) {
      if (cancelled) return end("cancelled");
      if ("update" in step) {
        await ctx.client.notify("session/update", { sessionId: step.sessionId ?? sessionId, update: step.update as never });
      } else if ("permission" in step) {
        const res = await ctx.client.request("session/request_permission", {
          sessionId,
          toolCall: step.permission.toolCall as never,
          ...(step.permission._meta ? { _meta: step.permission._meta } : {}),
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
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, step.sleep);
          wake = step.ignoreCancel ? undefined : () => (clearTimeout(timer), resolve());
        });
        wake = undefined;
      } else if ("crash" in step) {
        process.stderr.write(step.crash.stderr, () => process.exit(step.crash.code ?? 1));
        await new Promise(() => {});
      } else if ("error" in step) {
        throw new acp.RequestError(step.error.code, step.error.message);
      } else if ("stop" in step) {
        return end(step.stop);
      }
    }
    return end(cancelled ? "cancelled" : "end_turn");
  })
  .connect(stream);
