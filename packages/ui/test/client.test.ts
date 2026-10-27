import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type DataChangeView, type EngineStatus, canOpenFile, engineProblem, hearsDataChange, isTextSize, nextInPath, stepTextSize } from "../src/client";
import { FakeClient } from "./fake-client";

const ready: EngineStatus = {
  engineId: "claude",
  installed: true,
  version: "2.1.296",
  minVersion: "2.1.296",
  outdated: false,
  loggedIn: true,
  noticeAccepted: true,
  verified: true,
};

describe("engineProblem", () => {
  it("is null when the engine is ready", () => {
    expect(engineProblem(ready)).toBeNull();
    expect(engineProblem({ ...ready, loggedIn: null })).toBeNull();
  });

  it("asks for the notice first, then install, update, sign-in and the test prompt", () => {
    expect(engineProblem({ ...ready, noticeAccepted: false, installed: false })).toBe("notice");
    expect(engineProblem({ ...ready, installed: false, loggedIn: false })).toBe("not-installed");
    expect(engineProblem({ ...ready, outdated: true, loggedIn: false })).toBe("outdated");
    expect(engineProblem({ ...ready, loggedIn: false, verified: false })).toBe("logged-out");
    expect(engineProblem({ ...ready, verified: false })).toBe("untested");
  });
});

describe("@humanharness/ui/client", () => {
  it("is exported on its own and imports no runtime code (no React)", () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
    expect(pkg.exports["./client"]).toBe("./src/client.ts");
    const src = readFileSync(fileURLToPath(new URL("../src/client.ts", import.meta.url)), "utf8");
    expect(src.match(/^import .*$/gm)?.every((line) => line.startsWith("import type "))).toBe(true);
  });
});

describe("nextInPath", () => {
  const path = ["manifest", "engines", "turn"];
  it("follows the path from the current action", () => {
    expect(nextInPath(path, "manifest", {})).toBe("engines");
    expect(nextInPath(path, "engines", { manifest: "done" })).toBe("turn");
  });

  it("from the end, outside the path or idle, suggests the first action not done yet", () => {
    expect(nextInPath(path, "turn", { manifest: "done" })).toBe("engines");
    expect(nextInPath(path, "other", { manifest: "done", engines: "unfinished" })).toBe("engines");
    expect(nextInPath(path, undefined, { manifest: "done" })).toBe("engines");
    expect(nextInPath(path, "turn", { manifest: "done", engines: "done" })).toBeNull();
    expect(nextInPath([], undefined, {})).toBeNull();
  });
});

describe("canOpenFile", () => {
  it("is true for text, data and images, and false for sources, pages and programs", () => {
    for (const f of ["a.md", "notes/b.JSON", "c.csv", "d.png", "e.pdf", "f.css"]) expect(canOpenFile(f)).toBe(true);
    for (const f of ["a.ts", "b.tsx", "c.js", "d.html", "e.svg", "run.command", "Makefile", "x.sh"]) expect(canOpenFile(f)).toBe(false);
  });
});

describe("text size", () => {
  it("steps one size at a time and stays put at either end", () => {
    expect(stepTextSize(undefined, "in")).toBe("large");
    expect(stepTextSize("large", "in")).toBe("larger");
    expect(stepTextSize("larger", "in")).toBe("largest");
    expect(stepTextSize("largest", "in")).toBe("largest");
    expect(stepTextSize("larger", "out")).toBe("large");
    expect(stepTextSize(undefined, "out")).toBe("normal");
  });

  it("goes back to normal from any size", () => {
    expect(stepTextSize("largest", "reset")).toBe("normal");
    expect(stepTextSize(undefined, "reset")).toBe("normal");
  });

  it("knows only its four sizes", () => {
    expect(["normal", "large", "larger", "largest"].every(isTextSize)).toBe(true);
    expect(isTextSize("huge")).toBe(false);
    expect(isTextSize(1.5)).toBe(false);
    expect(isTextSize("toString")).toBe(false);
  });
});

describe("the scopes contract", () => {
  it("lists, creates, opens and archives scopes, and tells listeners", async () => {
    const client = new FakeClient();
    const seen: (string | null)[] = [];
    const off = client.scopes.onChange((v) => seen.push(v.open));
    const s = await client.scopes.create("Fractions");
    expect(await client.scopes.open(s.id)).toBe(true);
    expect(await client.scopes.current()).toBe(s.id);
    await client.scopes.archive(s.id);
    expect(await client.scopes.current()).toBeNull();
    expect((await client.scopes.list())[0]).toMatchObject({ id: s.id, archived: true });
    off();
    expect(seen).toEqual([null, s.id, null]);
  });
});

describe("hearsDataChange (data.subscribe's filter)", () => {
  const change = (collection: string, scope: string): DataChangeView => ({ collection, scope, who: "agent", op: "put", key: 1 });

  it("hears its collection in its scope, or in any scope when the scope is null", () => {
    expect(hearsDataChange(change("cards", "algebra"), "cards", "algebra")).toBe(true);
    expect(hearsDataChange(change("cards", "algebra"), "cards", null)).toBe(true);
    expect(hearsDataChange(change("cards", "geometry"), "cards", "algebra")).toBe(false);
    expect(hearsDataChange(change("decks", "algebra"), "cards", "algebra")).toBe(false);
  });

  it("hears an app-wide collection whatever scope it was given", () => {
    expect(hearsDataChange(change("profile", "_app"), "profile", "algebra")).toBe(true);
    expect(hearsDataChange(change("profile", "_app"), "other", "algebra")).toBe(false);
  });

  it("the fake client's subscribe filters the same way", () => {
    const client = new FakeClient();
    const seen: string[] = [];
    const off = client.data.subscribe("profile", "algebra", (c) => seen.push(c.scope));
    client.emitDataChange(change("profile", "_app"));
    client.emitDataChange(change("profile", "geometry"));
    off();
    expect(seen).toEqual(["_app"]);
  });
});

describe("FakeClient settings", () => {
  it("answers values, saves, resets to the view's defaults and tells listeners", async () => {
    const client = new FakeClient();
    client.state.settings = {
      tab: "Mine",
      sections: [],
      fields: [{ name: "tone", control: "segmented", label: "Tone", default: "patient", options: [{ value: "patient", label: "Patient" }, { value: "demanding", label: "Demanding" }], agent: true }],
    };
    client.settingsState = { values: { tone: "patient" }, pending: [] };
    const heard: unknown[] = [];
    const off = client.settings.onChange((s) => heard.push(s.values.tone));
    expect(await client.settings.set("tone", "demanding")).toEqual({ ok: true, state: { values: { tone: "demanding" }, pending: [] } });
    expect(await client.settings.reset()).toEqual({ ok: true, state: { values: { tone: "patient" }, pending: [] } });
    off();
    expect(heard).toEqual(["demanding", "patient"]);
    expect(client.settingsSets).toEqual([{ field: "tone", value: "demanding" }]);
    expect(client.settingsResets).toBe(1);
  });
});

describe("client.profiles (profiles spec §5)", () => {
  it("D0: a fake client without profiles has none and refuses changes", async () => {
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    expect(client.state.profiles).toBeUndefined();
    expect(await client.profiles.get()).toEqual({ active: null, list: [] });
    expect(await client.profiles.create({ name: "Sofi" })).toEqual({ ok: false, reason: "not-ready" });
  });

  it("creates and opens profiles, telling every listener", async () => {
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    client.state = { ...client.state, profiles: { label: "student", form: { fields: [] } } };
    const seen: (string | null)[] = [];
    client.profiles.onChange((s) => seen.push(s.active));
    const made = await client.profiles.create({ name: "Sofi" });
    expect(made.ok && made.state.config.profile).toBe("sofi");
    await client.profiles.create({ name: "Tomás" });
    expect((await client.profiles.open("sofi")).ok).toBe(true);
    expect(seen).toEqual(["sofi", "tomas", "sofi"]);
    expect(await client.profiles.archive("sofi")).toEqual({ ok: false, reason: "active" });
  });
});

describe("FakeClient documents (document-reader spec §5)", () => {
  it("reads, refuses, watches and opens like main and the preload", async () => {
    const c = new FakeClient();
    c.documents["docs/a.md"] = "# A";
    expect(await c.readDocument("docs/a.md")).toEqual({ ok: true, text: "# A", mtime: c.documentMtime, size: 3 });
    expect(await c.readDocument("docs/b.md")).toEqual({ ok: false, reason: "missing" });
    expect(await c.readDocument("../x.md")).toEqual({ ok: false, reason: "outside" });
    expect(await c.documentsExist(["docs/a.md", "docs/b.md"])).toEqual([true, false]);
    let heard = 0;
    const off = c.watchDocument("docs/a.md", () => heard++);
    c.changeDocument("docs/a.md", "# A2");
    off();
    c.changeDocument("docs/a.md", "# A3");
    expect(heard).toBe(1);
    const opened: string[] = [];
    const offOpen = c.onOpenDocument((p) => opened.push(p));
    c.openDocument("docs/a.md");
    offOpen();
    c.openDocument("docs/b.md");
    expect(opened).toEqual(["docs/a.md"]);
  });
});
