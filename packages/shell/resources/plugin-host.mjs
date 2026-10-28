// The core's host script, served to every plugin backend window at hh-plugin://<id>/_hh/host.js (plugins spec §4.1,
// Decision 10). It loads the plugin's backend.js, says which sources it defines, then pulls commands from main and runs
// them; every `ctx` call goes over `rpc` to the broker. It runs in the plugin's own page, beside code assumed hostile:
// it is a convenience for backend authors, not a boundary. Main checks every call it sends (parsePluginRpc, broker).

const ERROR_CHARS = 500;

const errorText = (e) => String(e instanceof Error ? e.message : e).slice(0, ERROR_CHARS);

function pluginRefused(answer) {
  const err = new Error(typeof answer?.refused === "string" ? answer.refused : "Refused");
  err.name = "PluginRefused";
  return err;
}

/** `rpc` with main's refusals (`{ ok: false, refused }`, answered rather than thrown) thrown as "PluginRefused". */
function refusing(rpc) {
  return async (method, args) => {
    const answer = await rpc(method, args);
    if (answer !== null && typeof answer === "object" && answer.ok === false && typeof answer.refused === "string") throw pluginRefused(answer);
    return answer;
  };
}

/** The `ctx` of one run: each call carries the run's id, and a refusal throws an Error named "PluginRefused". */
function contextOf(rpc, runId) {
  const call = async (name, ...args) => {
    // JSON turns a trailing undefined into null; the broker counts arguments.
    while (args.length > 0 && args[args.length - 1] === undefined) args.pop();
    const answer = await rpc("ctx", { runId, name, args });
    if (!answer || answer.ok !== true) throw pluginRefused(answer);
    return answer.value;
  };
  return {
    async fetch(url, init) {
      const r = await call("fetch", url, init);
      const text = typeof r?.text === "string" ? r.text : "";
      return { url: r?.url, status: r?.status, ok: r?.ok, headers: r?.headers ?? {}, text: () => text, json: () => JSON.parse(text) };
    },
    exec: (cmd, args) => call("exec", cmd, args),
    data: {
      get: (collection, key) => call("data.get", collection, key),
      query: (collection, q) => call("data.query", collection, q),
      put: (collection, record) => call("data.put", collection, record),
      patch: (collection, key, patch) => call("data.patch", collection, key, patch),
      delete: (collection, key) => call("data.delete", collection, key),
      replaceAll: (collection, records) => call("data.replaceAll", collection, records),
    },
    settings: { get: () => call("settings.get") },
    attention: { raise: (item) => call("attention.raise", item), resolve: (key) => call("attention.resolve", key) },
    chip: { set: (id, chip) => call("chip.set", id, chip), clear: (id) => call("chip.clear", id) },
    log: (level, message) => call("log", level, message),
  };
}

async function runOne(rpc, sources, cmd) {
  const { runId, source } = cmd;
  let result;
  try {
    const fn = typeof source === "string" && Object.hasOwn(sources, source) ? sources[source] : undefined;
    if (typeof fn !== "function") throw new Error(`No source "${String(source).slice(0, 64)}"`);
    await fn(contextOf(rpc, runId));
    result = { runId, ok: true };
  } catch (e) {
    result = { runId, ok: false, error: errorText(e) };
  }
  await rpc("done", result).catch(() => undefined);
}

/**
 * Loads the backend and serves main's commands until main stops answering or refuses. `rpc(method, args)` is the
 * preload's `hh.rpc`; `importBackend()` imports ../backend.js.
 */
export async function runHost(rawRpc, importBackend) {
  const rpc = refusing(rawRpc);
  let sources;
  try {
    const backend = await importBackend();
    const found = backend?.default?.sources;
    sources = found !== null && typeof found === "object" ? found : {};
  } catch (e) {
    const name = e instanceof Error ? e.name : "Error";
    await rpc("ready", { error: `${name}: ${errorText(e)}` }).catch(() => undefined);
    return;
  }
  try {
    await rpc("ready", { sources: Object.keys(sources) });
  } catch {
    return;
  }
  for (;;) {
    let cmd;
    try {
      cmd = await rpc("next");
    } catch {
      // The channel closed or refused (the plugin stopped, or this page was replaced): nothing more will come.
      return;
    }
    if (cmd?.kind !== "run") continue;
    void runOne(rpc, sources, cmd);
  }
}

if (globalThis.hh?.rpc) runHost(globalThis.hh.rpc, () => import("../backend.js"));
