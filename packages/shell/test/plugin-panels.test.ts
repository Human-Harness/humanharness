import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PANEL_CSP, allowFrameNavigation, allowPanelRequest, frameChain, readPanelFile, resolvePanelFile } from "../src/main/plugin-panels";

let dist: string;
beforeAll(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hh-panels-"));
  for (const f of ["panel-queue.html", "panel-queue.js", "panel-queue.css", "panel-other.html", "backend.js", "plugin.json", "assets/logo.svg", "assets/x.js", "_hh/host.js"]) {
    await fs.mkdir(path.dirname(path.join(root, f)), { recursive: true });
    await fs.writeFile(path.join(root, f), f);
  }
  dist = await fs.realpath(root);
});
const running = (id: string) => (id === "oncall" ? { dist, panels: ["queue"] } : null);

describe("resolvePanelFile (P7)", () => {
  it.each([
    ["hh-plugin://oncall/panel-queue.html", "panel-queue.html"],
    ["hh-plugin://oncall/panel-queue.html?theme=dark", "panel-queue.html"],
    ["hh-plugin://oncall/panel-queue.js", "panel-queue.js"],
    ["hh-plugin://oncall/panel-queue.css", "panel-queue.css"],
    ["hh-plugin://oncall/assets/logo.svg", "assets/logo.svg"],
  ])("serves %s", async (url, file) => expect((await resolvePanelFile(url, running))?.file).toBe(path.join(dist, file)));

  it.each([
    "hh-plugin://oncall/backend.js",
    "hh-plugin://oncall/plugin.json",
    "hh-plugin://oncall/_hh/host.js",
    "hh-plugin://oncall/_hh/host.html",
    "hh-plugin://oncall/panel-other.html",
    "hh-plugin://oncall/panel-queue.html/..",
    "hh-plugin://oncall/x/../panel-queue.html",
    "hh-plugin://oncall/..%2fpanel-queue.html",
    "hh-plugin://oncall/assets/..%2fbackend.js",
    "hh-plugin://oncall/assets/x.js",
    "hh-plugin://oncall/assets/sub/logo.svg",
    "hh-plugin://oncall/",
    "hh-plugin://stopped/panel-queue.html",
    "hh-plugin://__proto__/panel-queue.html",
    "hh-plugin://oncall:1/panel-queue.html",
    "hh-plugin://a:b@oncall/panel-queue.html",
    "file:///etc/hosts",
    "not a url",
  ])("refuses %s", async (url) => expect(await resolvePanelFile(url, running)).toBeNull());

  it("asks about a plugin only by a valid id", async () => {
    const asked: string[] = [];
    await resolvePanelFile("hh-plugin://__proto__/panel-queue.html", (id) => (asked.push(id), null));
    await resolvePanelFile("hh-plugin://oncall/panel-queue.html", (id) => (asked.push(id), null));
    expect(asked).toEqual(["oncall"]);
  });

  it("reads the bytes of a panel file and nothing else", async () => {
    expect((await readPanelFile("hh-plugin://oncall/panel-queue.js", running))?.body.toString()).toBe("panel-queue.js");
    expect((await readPanelFile("hh-plugin://oncall/panel-queue.html", running))?.type).toBe("text/html");
    expect(await readPanelFile("hh-plugin://oncall/backend.js", running)).toBeNull();
    expect(await readPanelFile("hh-plugin://stopped/panel-queue.js", running)).toBeNull();
  });
});

describe("allowPanelRequest (P2)", () => {
  const app = "file:///app/out/renderer/index.html";
  const panel = "hh-plugin://oncall/panel-queue.html?theme=dark";
  it.each([
    [[app], "script", "file:///app/out/renderer/assets/x.js", true],
    [[panel, app], "script", "hh-plugin://oncall/panel-queue.js", true],
    [[panel, app], "image", "hh-plugin://oncall/backend.js", true], // the resolver refuses it; the filter only checks origin
    [[panel, app], "script", "hh-plugin://other/panel-x.js", false],
    [[panel, app], "xhr", "http://127.0.0.1:9/x", false],
    [[panel, app], "xhr", "https://api.example.com/", false],
    [[panel, app], "webSocket", "ws://127.0.0.1:9/ws", false],
    [[panel, app], "other", "data:text/html,x", false],
    [[panel, app], "image", "file:///etc/hosts", false],
    [[panel, app], "subFrame", "hh-plugin://oncall/panel-queue.html", true], // its own panel page
    [[panel, app], "subFrame", "hh-plugin://oncall/assets/logo.svg", false],
    [[panel, app], "subFrame", "http://127.0.0.1:9/nav", false],
    // A frame being navigated reads "" on its first load: only its parent says who embeds it (spike P-S3).
    [["", panel, app], "subFrame", "http://127.0.0.1:9/iframe", false],
    [["", panel, app], "subFrame", "hh-plugin://other/panel-x.html", false],
    [["", panel, app], "script", "hh-plugin://other/panel-x.js", false],
    [["about:blank", panel, app], "xhr", "http://127.0.0.1:9/x", false],
    [["http://127.0.0.1:9/err", panel, app], "xhr", "http://127.0.0.1:9/x", false],
    [["", app], "subFrame", "hh-plugin://oncall/panel-queue.html", true], // the panel's own first load, framed by the app
    // Two plugins in one chain: neither may speak for the other.
    [["hh-plugin://oncall/panel-queue.html", "hh-plugin://other/panel-x.html", app], "script", "hh-plugin://oncall/panel-queue.js", false],
  ] as const)("from %j, %s to %s → %s", (frames, resourceType, url, ok) => expect(allowPanelRequest({ frames: [...frames], resourceType, url })).toBe(ok));

  it("a request with no frame passes only if it isn't for a plugin file (main-process fetches go through other sessions)", () => {
    expect(allowPanelRequest({ frames: [], resourceType: "xhr", url: "https://x/" })).toBe(true);
  });

  it("a frame that couldn't be read cancels a request for a plugin file, and only that", () => {
    expect(allowPanelRequest({ frames: null, resourceType: "script", url: "hh-plugin://oncall/panel-queue.js" })).toBe(false);
    expect(allowPanelRequest({ frames: null, resourceType: "script", url: "file:///app/out/renderer/assets/x.js" })).toBe(true);
  });
});

describe("frameChain", () => {
  type F = { url: string; parent: F | null };
  const app: F = { url: "file:///app/index.html", parent: null };
  const panel: F = { url: "hh-plugin://oncall/panel-queue.html", parent: app };
  it("lists the frame's URL, then each ancestor's", () => {
    expect(frameChain({ url: "", parent: panel })).toEqual(["", "hh-plugin://oncall/panel-queue.html", "file:///app/index.html"]);
    expect(frameChain(null)).toEqual([]);
    expect(frameChain(undefined)).toEqual([]);
  });
  it("is null when a frame throws (disposed) or the chain doesn't end", () => {
    const disposed = {
      get url(): string {
        throw new Error("Render frame was disposed");
      },
      parent: null,
    };
    expect(frameChain(disposed)).toBeNull();
    const loop: F = { url: "x", parent: null };
    loop.parent = loop;
    expect(frameChain(loop)).toBeNull();
  });
});

describe("allowFrameNavigation (P3)", () => {
  const app = "file:///app/index.html";
  it.each([
    [true, false, app, app, true], // main frame: the app's own will-navigate rule applies, not this one
    [false, true, "", "hh-plugin://oncall/panel-queue.html", true],
    [false, true, "about:blank", "hh-plugin://oncall/panel-queue.html", true],
    [false, true, "", "hh-plugin://oncall/panel-queue.html?theme=dark", true],
    [false, false, "", "hh-plugin://oncall/panel-queue.html", false], // a first load framed by a panel, not the app
    [false, false, "", "hh-plugin://other/panel-x.html", false],
    [false, true, "hh-plugin://oncall/panel-queue.html", "hh-plugin://oncall/panel-queue.html", true],
    [false, true, "hh-plugin://oncall/panel-queue.html?a=1", "hh-plugin://oncall/panel-queue.html?a=2", true],
    [false, true, "hh-plugin://oncall/panel-queue.html", "hh-plugin://oncall/panel-other.html", false],
    [false, true, "hh-plugin://oncall/panel-queue.html", "hh-plugin://other/panel-queue.html", false],
    [false, true, "hh-plugin://oncall/panel-queue.html", "http://127.0.0.1:9/nav", false],
    [false, true, "hh-plugin://oncall/panel-queue.html", "hh-plugin://oncall/backend.js", false],
    [false, true, "hh-plugin://oncall/panel-queue.html", "hh-plugin://oncall/assets/logo.svg", false],
    [false, true, "hh-plugin://oncall/panel-queue.html", "hh-plugin://oncall:1/panel-queue.html", false],
    [false, true, "hh-plugin://oncall/panel-queue.html", "hh-plugin://oncall/x/../panel-queue.html", false],
    [false, true, "http://127.0.0.1:9/nav", "hh-plugin://oncall/panel-queue.html", false], // an error page: remount, never reset src
    [false, true, "", "https://example.com/", false],
    [false, true, "", "javascript:alert(1)", false],
    [false, true, "", "about:blank", false],
  ])("main=%s parentIsMain=%s from %s to %s → %s", (isMainFrame, parentIsMain, frameUrl, url, ok) =>
    expect(allowFrameNavigation({ isMainFrame, parentIsMain, frameUrl, url })).toBe(ok),
  );
});

it("the panel CSP is exactly P2's", () => {
  expect(PANEL_CSP).toBe("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'");
});
