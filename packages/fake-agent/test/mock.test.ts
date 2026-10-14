// packages/fake-agent/test/mock.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadRecordings, recordingSchema } from "../src/mock";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-mock-schema-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const minimal = { version: 1, action: "manifest", match: "# Topic: the manifest", turns: [{ id: "t1", text: "Hola." }] };

describe("recordingSchema", () => {
  it("fills defaults on a minimal recording", () => {
    const r = recordingSchema.parse(minimal);
    expect(r.turns[0]).toEqual({ id: "t1", text: "Hola.", blocks: [], writes: [] });
  });

  it("rejects a write that leaves the folder", () => {
    for (const p of ["../x", "/etc/x", "a/../../x"]) {
      const bad = { ...minimal, turns: [{ id: "t1", writes: [{ path: p, content: "x" }] }] };
      expect(recordingSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("rejects other escapes: Windows, UNC and paths that are the folder itself", () => {
    for (const p of ["C:\\x", "C:x", "\\\\host\\share", "\\x", ".", "./", "a/.."]) {
      const bad = { ...minimal, turns: [{ id: "t1", writes: [{ path: p, content: "x" }] }] };
      expect(recordingSchema.safeParse(bad).success, p).toBe(false);
    }
    const ok = { ...minimal, turns: [{ id: "t1", writes: [{ path: "a/b.md", content: "x" }] }] };
    expect(recordingSchema.safeParse(ok).success).toBe(true);
  });

  it("rejects a __proto__ reply label and a blank match", () => {
    const proto = JSON.parse('{"id":"t1","next":{"__proto__":"t1"}}');
    expect(recordingSchema.safeParse({ ...minimal, turns: [proto] }).success).toBe(false);
    expect(recordingSchema.safeParse({ ...minimal, match: "  \n" }).success).toBe(false);
  });

  it("rejects an unknown version and unknown keys", () => {
    expect(recordingSchema.safeParse({ ...minimal, version: 2 }).success).toBe(false);
    expect(recordingSchema.safeParse({ ...minimal, extra: true }).success).toBe(false);
  });
});

describe("loadRecordings", () => {
  it("loads the valid .json files and reports the others", () => {
    fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify(minimal));
    fs.writeFileSync(path.join(root, "broken.json"), "{");
    fs.writeFileSync(path.join(root, "notes.txt"), "ignored");
    const { recordings, problems } = loadRecordings(root);
    expect(recordings.map((r) => r.action)).toEqual(["manifest"]);
    expect(problems).toEqual([expect.stringContaining("broken.json")]);
  });

  it("reports a file that parses as JSON but not as a recording", () => {
    fs.writeFileSync(path.join(root, "bad-schema.json"), JSON.stringify({ ...minimal, version: 9 }));
    const { problems } = loadRecordings(root);
    expect(problems).toEqual(expect.arrayContaining([expect.stringContaining("bad-schema.json: version")]));
  });

  it("returns nothing for a missing folder", () => {
    expect(loadRecordings(path.join(root, "nope"))).toEqual({ recordings: [], problems: [] });
  });
});
