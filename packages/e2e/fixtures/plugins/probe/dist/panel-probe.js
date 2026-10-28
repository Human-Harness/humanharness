// A hostile test panel (e2e, plugins threat model P1–P7): every way out of its frame it can think of. Hand-written, no
// build step, a classic script (module scripts are refused in the opaque-origin frame, spike P-S2). Each attempt writes
// its outcome into its own DOM, `<li data-probe="<name>" data-outcome="blocked|reached">`, which the e2e reads through
// the frame; `data-control` items are the controls that must get through. The panel has no API for tests: it talks to
// the app only through the panel bridge's messages, like any panel. The e2e also counts the hits on a local server.
(function () {
  "use strict";

  const WAIT_MS = 1000;
  const NESTED_WAIT_MS = 1500;

  // Nested inside another frame (the "nested-panel" attempt got through): tell the frame above, and nothing else.
  if (window.parent !== window.top) {
    try {
      window.parent.postMessage({ probe: "nested-alive" }, "*");
    } catch {}
    return;
  }

  const out = document.getElementById("out");
  /** One outcome as a list item. */
  function show(name, outcome, kind) {
    const li = document.createElement("li");
    li.setAttribute(kind === "control" ? "data-control" : kind === "attempt" ? "data-attempt" : "data-probe", name);
    li.setAttribute("data-outcome", outcome);
    li.textContent = `${name}: ${outcome}`;
    out.append(li);
  }

  // The panel bridge (Decision 7): a call goes to the app window, the answer comes back with `re`.
  let nextId = 1;
  const pending = new Map();
  const nestedAlive = new Set();
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (e.source === window.parent && d && d.hh === 1 && typeof d.re === "number") {
      const p = pending.get(d.re);
      if (!p) return;
      pending.delete(d.re);
      if (d.ok) p.resolve(d.value);
      else p.reject(new Error(String(d.error)));
      return;
    }
    if (d && d.probe === "nested-alive") nestedAlive.add(e.source);
  });
  function call(name, args) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      window.parent.postMessage({ hh: 1, id, call: name, args }, "*");
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error("timeout"));
      }, 15_000);
    });
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** "reached" when `attempt` resolves truthy, "blocked" when it throws, resolves falsy or takes too long (1 s by default). */
  async function outcome(attempt, waitMs) {
    let timer;
    const late = new Promise((resolve) => {
      timer = setTimeout(() => resolve("blocked"), waitMs || WAIT_MS);
    });
    const tried = (async () => {
      try {
        return (await attempt()) ? "reached" : "blocked";
      } catch {
        return "blocked";
      }
    })();
    const result = await Promise.race([tried, late]);
    clearTimeout(timer);
    return result;
  }

  /** Resolves on `ok`, rejects on `bad`. */
  const when = (target, ok, bad) =>
    new Promise((resolve, reject) => {
      target.addEventListener(ok, () => resolve(true));
      target.addEventListener(bad, () => reject(new Error(bad)));
    });

  const added = (tag, attrs, doc) => {
    const d = doc || document;
    const el = d.createElement(tag);
    const loaded = when(el, "load", "error");
    Object.assign(el, attrs);
    (d.body || d.documentElement).append(el);
    return loaded;
  };

  const widthOf = (id) => getComputedStyle(document.getElementById(id)).width;

  /**
   * A frame inside the panel, set up by `setup`: "reached" when a script runs in it and says so to the panel. Its own
   * opaque origin (the sandbox gives every nested document a new one), so the panel can't act through it; it would have
   * to run code of its own.
   */
  async function nestedRuns(setup) {
    const f = document.createElement("iframe");
    setup(f);
    document.body.append(f);
    await sleep(NESTED_WAIT_MS);
    return nestedAlive.has(f.contentWindow);
  }

  /** A page whose script tells its parent it ran, and asks the server for an image. */
  const nestedPage = (base, name) =>
    `<script>parent.postMessage({ probe: "nested-alive" }, "*")</script><img src="${base}/nested-${name}">`;

  function attempts(base, port) {
    return [
      // No app API, no Node, no reach into the app window (P1, P4).
      ["window.hh", () => typeof window.hh !== "undefined"],
      ["require", () => typeof require !== "undefined"],
      ["process", () => typeof process !== "undefined"],
      ["parent.document", () => window.parent.document !== undefined],
      ["parent.hh", () => window.parent.hh !== undefined],
      // The network, every way (P2: the panel CSP, then the session's request filter).
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
      ["websocket", () => when(new WebSocket(`ws://127.0.0.1:${port}/ws`), "open", "error")],
      ["eventsource", () => when(new EventSource(`${base}/sse`), "open", "error")],
      ["img", () => added("img", { src: `${base}/img` })],
      ["script", () => added("script", { src: `${base}/s.js` })],
      ["import", () => import(`${base}/m.js`).then(() => true)],
      ["worker", () => when(new Worker(`${base}/w.js`), "message", "error")],
      ["prefetch", () => added("link", { rel: "prefetch", href: `${base}/prefetch` })],
      ["window.open", () => window.open(`${base}/open`) !== null],
      [
        "form",
        async () => {
          const form = document.createElement("form");
          form.method = "get";
          form.action = `${base}/form`;
          document.body.append(form);
          form.submit();
          // Still here: the submit went nowhere.
          await sleep(500);
          return false;
        },
      ],
      // The plugin's other files and another plugin's (P7: the panel handler serves only declared panel files).
      ["backend-fetch", () => fetch("hh-plugin://probe/backend.js").then((r) => r.ok)],
      ["other-fetch", () => fetch("hh-plugin://other/panel-x.js").then((r) => r.ok)],
      ["backend-script", () => added("script", { src: "hh-plugin://probe/backend.js" })],
      ["other-script", () => added("script", { src: "hh-plugin://other/backend.js" })],
      // Frames inside the panel (P2 checks every ancestor; P3 allows a first load only under the app's main frame).
      ["nested-panel", () => nestedRuns((f) => (f.src = location.href.split(/[?#]/)[0])), NESTED_WAIT_MS + 500],
      // The same script inline, as a data: or blob: page (frame-src 'none'), or srcdoc (no 'unsafe-inline'). Each also
      // asks the server for an image: the hit count tells.
      ["nested-srcdoc", () => nestedRuns((f) => (f.srcdoc = nestedPage(base, "srcdoc"))), NESTED_WAIT_MS + 500],
      ["nested-data", () => nestedRuns((f) => (f.src = `data:text/html,${encodeURIComponent(nestedPage(base, "data"))}`)), NESTED_WAIT_MS + 500],
      [
        "nested-blob",
        () => nestedRuns((f) => (f.src = URL.createObjectURL(new Blob([nestedPage(base, "blob")], { type: "text/html" })))),
        NESTED_WAIT_MS + 500,
      ],
      [
        "nested-access",
        () => {
          const f = document.createElement("iframe");
          document.body.append(f);
          return f.contentWindow.document !== undefined;
        },
      ],
      // Inline styles (P2, spike P-S7: no 'unsafe-inline'); the stylesheet control below shows styles do apply.
      [
        "style-element",
        () => {
          const st = document.createElement("style");
          st.textContent = "#style-element { width: 66px; }";
          document.head.append(st);
          return widthOf("style-element") === "66px";
        },
      ],
      [
        "style-attribute",
        () => {
          document.getElementById("style-attribute").setAttribute("style", "width: 55px");
          return widthOf("style-attribute") === "55px";
        },
      ],
      // Another plugin's panel page (P3: will-frame-navigate refuses it; the panel stays).
      [
        "other-navigation",
        async () => {
          location.href = "hh-plugin://other/panel-x.html";
          await sleep(1500);
          return false;
        },
      ],
    ];
  }

  async function run() {
    let settings;
    try {
      settings = await call("settings.get", {});
    } catch (e) {
      show("settings", `failed: ${e.message}`, "control");
      return;
    }
    const port = settings && settings.panelPort;
    if (!port) {
      show("idle", "reached", "control");
      return;
    }
    show("settings", "reached", "control");
    const base = `http://127.0.0.1:${port}`;
    // Already navigated once (the backend's mark): this frame is the one the app remounted. Run again, never leave.
    const marks = await call("data.query", { collection: "marks" }).catch(() => []);
    const again = Array.isArray(marks) && marks.some((r) => r.name === "navigated");
    document.body.setAttribute("data-round", again ? "2" : "1");

    for (const [name, attempt, waitMs] of attempts(base, port)) show(name, await outcome(attempt, waitMs));
    let queued;
    try {
      queued = navigator.sendBeacon(`${base}/beacon`, "x");
    } catch {
      queued = false;
    }
    // sendBeacon only says whether it queued the beacon; the server's count is what proves it never left.
    show("beacon", queued ? "queued" : "blocked");
    show("frame-server", "tried", "attempt");
    const f = document.createElement("iframe");
    f.src = `${base}/frame`;
    document.body.append(f);
    // The control: the panel's own stylesheet applies (so the inline styles above were refused, not broken).
    show("stylesheet", widthOf("css-control") === "77px" ? "reached" : "blocked", "control");

    if (again) {
      // The app remounted the panel on its own page after the navigation (P3).
      show("navigate", "blocked");
      document.body.setAttribute("data-done", "yes");
      return;
    }
    document.body.setAttribute("data-done", "yes");
    // Long enough for the e2e to read this round; then the mark, then the last step: leaving the page.
    await sleep(3000);
    const marked = await call("refresh", { source: "mark" }).catch((e) => `failed: ${e.message}`);
    show("mark", String(marked), "control");
    if (marked !== "refreshed") return;
    location.href = `${base}/nav`;
  }

  void run();
})();
