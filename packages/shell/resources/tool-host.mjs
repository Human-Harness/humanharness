// The core's host script, served to the tool host window at hh-tools://<harness-id>/_hh/host.js (tools spec §4.1). It
// imports each built tool the page's query names (../tools/<id>.js), says which loaded, then pulls calls from main and
// runs each without waiting for the one before; every `ctx` call goes over `rpc` to the tool's broker under the call's
// id. It runs beside the tools' own code: a convenience, not a boundary. Main checks every call it sends
// (parseToolRpc, the call id it made, the tool broker), and the window's sandbox and CSP keep the page off Node and
// the network.

// Main's TOOL_RPC_LIMITS: errors and summaries are cut at 16,000 characters (main hides secret values first, then cuts
// again: 4096 for an error, 200 for a summary), so a key across main's cut never leaves its start behind (T4).
const ERROR_CHARS = 16000;
const SUMMARY_CHARS = 16000;
const TOOL_ID = /^[a-z][a-z0-9_-]{0,63}$/;

const errorText = (e) => String(e instanceof Error ? e.message : e).slice(0, ERROR_CHARS);

function toolRefused(answer) {
  const err = new Error(typeof answer?.refused === "string" ? answer.refused : "Refused");
  err.name = "ToolRefused";
  return err;
}

/** `rpc` with main's refusals (`{ ok: false, refused }`, answered rather than thrown) thrown as "ToolRefused". */
function refusing(rpc) {
  return async (method, args) => {
    const answer = await rpc(method, args);
    if (answer !== null && typeof answer === "object" && answer.ok === false && typeof answer.refused === "string") throw toolRefused(answer);
    return answer;
  };
}

/** The `ctx` of one call (ToolContext): each call carries the call's id; a refusal throws an Error named "ToolRefused". */
function contextOf(rpc, callId, scope) {
  const call = async (name, ...args) => {
    // JSON turns a trailing undefined into null; the broker counts arguments.
    while (args.length > 0 && args[args.length - 1] === undefined) args.pop();
    const answer = await rpc("ctx", { callId, name, args });
    if (!answer || answer.ok !== true) throw toolRefused(answer);
    return answer.value;
  };
  return Object.freeze({
    async fetch(url, init) {
      const r = await call("fetch", url, init);
      const text = typeof r?.text === "string" ? r.text : "";
      return { url: r?.url, status: r?.status, ok: r?.ok, headers: r?.headers ?? {}, text: () => text, json: () => JSON.parse(text) };
    },
    exec: (cmd, args) => call("exec", cmd, args),
    data: Object.freeze({
      get: (collection, key) => call("data.get", collection, key),
      query: (collection, q) => call("data.query", collection, q),
      put: (collection, record) => call("data.put", collection, record),
      patch: (collection, key, patch) => call("data.patch", collection, key, patch),
      delete: (collection, key) => call("data.delete", collection, key),
    }),
    files: Object.freeze({
      read: (path) => call("files.read", path),
      list: (dir, glob) => call("files.list", dir, glob),
    }),
    scope: typeof scope === "string" ? scope : null,
    // Fire-and-forget (ToolContext.log returns nothing): a refused or failed log line never fails the tool.
    log(level, message) {
      call("log", level, message).catch(() => undefined);
    },
  });
}

async function runOne(rpc, tools, cmd) {
  const { callId, tool, args, scope } = cmd;
  let result;
  try {
    const def = typeof tool === "string" && Object.hasOwn(tools, tool) ? tools[tool] : undefined;
    if (!def) throw new Error(`No tool "${String(tool).slice(0, 64)}"`);
    const value = await def.run(args, contextOf(rpc, callId, scope));
    result = { callId, ok: true, value: value === undefined ? null : value };
    if (typeof def.summary === "function") {
      try {
        const s = def.summary(value);
        if (typeof s === "string") result.summary = s.slice(0, SUMMARY_CHARS);
      } catch {
        // No summary: main writes a generic one.
      }
    }
  } catch (e) {
    result = { callId, ok: false, error: errorText(e) };
  }
  try {
    await rpc("done", result);
  } catch (e) {
    // The result can't cross (not JSON, over the cap) or main refused it: say so rather than leave the call hanging.
    if (result.ok) {
      const name = e instanceof Error ? e.name : "Error";
      await rpc("done", { callId, ok: false, error: `The result can't be sent: ${name}: ${errorText(e)}` }).catch(() => undefined);
    }
  }
}

/** Each tool's default export, or its load error. */
async function load(ids, importTool) {
  const tools = Object.create(null);
  const errors = [];
  const loaded = await Promise.allSettled(ids.map((id) => importTool(id)));
  ids.forEach((id, i) => {
    const r = loaded[i];
    const def = r.status === "fulfilled" ? r.value?.default : undefined;
    if (r.status === "rejected") {
      const name = r.reason instanceof Error ? r.reason.name : "Error";
      errors.push({ tool: id, error: `${name}: ${errorText(r.reason)}` });
    } else if (def === null || typeof def !== "object" || typeof def.run !== "function") {
      errors.push({ tool: id, error: "Error: its default export has no run function" });
    } else tools[id] = def;
  });
  return { tools, errors };
}

/**
 * Loads the tools and serves main's calls until main stops answering or refuses. `rpc(method, args)` is the preload's
 * `hh.rpc`; `importTool(id)` imports ../tools/<id>.js.
 */
export async function runHost(rawRpc, ids, importTool) {
  const rpc = refusing(rawRpc);
  const { tools, errors } = await load(ids, importTool);
  try {
    await rpc("ready", { tools: Object.keys(tools), errors });
  } catch {
    return;
  }
  for (;;) {
    let cmd;
    try {
      cmd = await rpc("next");
    } catch {
      // The channel closed or refused (tools stopped, or this page was replaced): nothing more will come.
      return;
    }
    if (cmd?.kind !== "call") continue;
    void runOne(rpc, tools, cmd);
  }
}

if (globalThis.hh?.rpc) {
  const ids = (new URLSearchParams(location.search).get("tools") ?? "").split(",").filter((id) => TOOL_ID.test(id));
  runHost(globalThis.hh.rpc, ids, (id) => import(`../tools/${id}.js`));
}
