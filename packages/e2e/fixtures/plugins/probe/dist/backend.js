// A hostile test plugin (e2e, plugins threat model B1–B5): every way out of its sandbox it can think of. Each attempt
// records "blocked" (it threw, was refused, or took over a second) or "reached" (it got through) in its own `results`
// collection; the test also counts the hits on a local server. Hand-written, no build step.

const WAIT_MS = 1000;

/** "reached" when `attempt` resolves truthy, "blocked" when it throws, resolves falsy or takes over a second. */
async function outcome(attempt) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve("blocked"), WAIT_MS);
  });
  const tried = (async () => {
    try {
      return (await attempt()) ? "reached" : "blocked";
    } catch {
      return "blocked";
    }
  })();
  const out = await Promise.race([tried, late]);
  clearTimeout(timer);
  return out;
}

/** For the broker's surface: only a PluginRefused error counts as blocked; any other failure is named. */
async function refused(attempt) {
  try {
    await attempt();
    return "reached";
  } catch (e) {
    return e && e.name === "PluginRefused" ? "blocked" : `failed: ${e && e.name}`;
  }
}

/** Resolves on `ok`, rejects on `bad`. */
const when = (target, ok, bad) =>
  new Promise((resolve, reject) => {
    target.addEventListener(ok, () => resolve(true));
    target.addEventListener(bad, () => reject(new Error(bad)));
  });

const added = (tag, attrs) => {
  const el = document.createElement(tag);
  const loaded = when(el, "load", "error");
  Object.assign(el, attrs);
  document.body.append(el);
  return loaded;
};

function attempts(ctx, base) {
  return [
    ["fetch", () => fetch(`${base}/fetch`).then(() => true)],
    [
      "xhr",
      () => {
        const x = new XMLHttpRequest();
        const done = when(x, "load", "error");
        x.open("GET", `${base}/xhr`);
        x.send();
        return done;
      },
    ],
    ["websocket", () => when(new WebSocket(`ws://127.0.0.1:${base.split(":").pop()}/ws`), "open", "error")],
    ["eventsource", () => when(new EventSource(`${base}/sse`), "open", "error")],
    ["img", () => added("img", { src: `${base}/img` })],
    ["script", () => added("script", { src: `${base}/s.js` })],
    ["import", () => import(`${base}/m.js`).then(() => true)],
    ["worker", () => when(new Worker("data:text/javascript,postMessage(1)"), "message", "error")],
    ["window.open", () => window.open(`${base}/open`) !== null],
    ["file", () => fetch("file:///etc/hosts").then(() => true)],
    ["other-fetch", () => fetch("hh-plugin://other/secret.json").then((r) => r.ok)],
    ["traversal-fetch", () => fetch("hh-plugin://probe/..%2f..%2fother%2fdist%2fsecret.json").then((r) => r.ok)],
    ["other-import", () => import("hh-plugin://other/backend.js").then(() => true)],
    // The control: its own file loads, so the refusals around it are the sandbox's, not a broken probe.
    ["own-import", () => import("hh-plugin://probe/own.js").then((m) => m.own === true)],
    ["traversal-import", () => import("hh-plugin://probe/..%2f..%2fother%2fdist%2fbackend.js").then(() => true)],
    ["require", () => typeof require !== "undefined"],
    ["process", () => typeof process !== "undefined"],
    ["module", () => typeof module !== "undefined"],
    ["Buffer", () => typeof Buffer !== "undefined"],
    ["ipcRenderer", () => typeof globalThis.ipcRenderer !== "undefined" || typeof globalThis.electron !== "undefined"],
  ];
}

export default {
  sources: {
    async escape(ctx) {
      const { port } = await ctx.settings.get();
      if (!port) return;
      const base = `http://127.0.0.1:${port}`;
      const record = (name, outcome) => ctx.data.put("results", { name, outcome });
      for (const [name, attempt] of attempts(ctx, base)) await record(name, await outcome(attempt));
      // sendBeacon answers only whether the browser queued it, never whether it was sent: the server's count tells.
      let queued;
      try {
        queued = navigator.sendBeacon(`${base}/beacon`, "x");
      } catch {
        queued = false;
      }
      await record("beacon", queued ? "queued" : "blocked");
      await record("hh", Object.keys(globalThis.hh).join());
      // The broker's own refusals: each must throw PluginRefused.
      await record("ctx.fetch-http", await refused(() => ctx.fetch(`${base}/ctx`)));
      await record("ctx.fetch-undeclared", await refused(() => ctx.fetch("https://undeclared.example/")));
      await record("ctx.exec", await refused(() => ctx.exec("sh", ["-c", "id"])));
      await record("ctx.data-other", await refused(() => ctx.data.put("other.results", { name: "x", outcome: "x" })));
      const forged = await globalThis.hh.rpc("ctx", { runId: "forged", name: "settings.get", args: [] }).catch(() => null);
      await record("forged-run", forged && forged.ok === true ? "reached" : "blocked");
      // Last: leaving the page. Still here a second later: blocked.
      try {
        location.assign(`${base}/nav`);
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
      await record("navigate", "blocked");
      await record("done", "yes");
    },
    // Hangs the page once (the run limit reloads it), only while the `hang` setting is on.
    async hang(ctx) {
      const { hang } = await ctx.settings.get();
      if (!hang || (await ctx.data.get("results", "hang"))) return;
      await ctx.data.put("results", { name: "hang", outcome: "started" });
      for (;;) {}
    },
  },
};
