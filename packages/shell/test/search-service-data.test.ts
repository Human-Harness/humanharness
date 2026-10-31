import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer } from "@humanharness/protocol";
import type { DataRow, DataSource } from "@humanharness/search";
import { inProcessBuild } from "../src/main/search/runner";
import { SearchService, type SearchServiceDeps } from "../src/main/search/service";
import { searchDir } from "../src/main/search/store";

let tmp: string;
let base: string;
let userData: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-data-"));
  base = path.join(tmp, "Work");
  userData = path.join(tmp, "userData");
  fs.mkdirSync(base, { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const PEOPLE: DataSource = { id: "harness:_app/people", owner: "harness", collection: "people", folder: "_app", stamp: "1" };
const ISSUES: DataSource = { id: "plugin:jira/issues", owner: "plugin", plugin: "jira", pluginName: "Jira", panel: "main", collection: "issues", folder: "_app", stamp: "1:main" };

function dataDeps() {
  const state = {
    sources: [PEOPLE] as DataSource[],
    rows: { [PEOPLE.id]: [{ key: "a", title: "Ana", text: "Physics teacher", at: 0 }], [ISSUES.id]: [{ key: "J-1", title: "Login fails", text: "", at: 0 }] } as Record<string, DataRow[]>,
  };
  const sources = vi.fn(async () => state.sources);
  const rows = vi.fn(async (s: DataSource) => state.rows[s.id] ?? []);
  return { state, data: { sources, rows } };
}

function service(o: Partial<SearchServiceDeps> = {}) {
  return new SearchService({
    userData: () => userData,
    base: async () => base,
    scoped: () => false,
    openScope: async () => null,
    scopeTitles: async () => new Map(),
    references: async () => [],
    memory: async () => [],
    extraDenied: async () => [],
    status: () => {},
    runner: inProcessBuild(),
    reveal: vi.fn(async () => true),
    storeDelayMs: 10,
    ...o,
  });
}
const ok = (a: SearchAnswer) => {
  if (!a.ok) throw new Error(`not ok: ${a.reason}`);
  return a;
};

describe("SearchService data records (search spec D4)", () => {
  it("D0: a data change before the first search reads nothing", async () => {
    const { data } = dataDeps();
    const svc = service({ data });
    svc.dataChanged();
    svc.committed([".harness/data/_app/people.json"]);
    await svc.flush();
    expect(data.sources).not.toHaveBeenCalled();
  });

  it("finds a record by its text: a Data group, the record's target, a snippet, a count", async () => {
    const { data } = dataDeps();
    const svc = service({ data });
    const a = ok(await svc.query("physics", {}));
    const group = a.groups.find((g) => g.kind === "data")!;
    expect(group.hits[0]).toMatchObject({ id: "data:harness:_app/people#a", kind: "data", hint: null, target: { kind: "record", collection: "people", key: "a", scope: "_app" } });
    expect(group.hits[0].context.some((p) => p.mark && p.text === "Physics")).toBe(true);
    expect(a.counts.data).toBe(1);
    expect(ok(await svc.query("physics", { kind: "data" })).groups.map((g) => g.kind)).toEqual(["data"]);
    await svc.flush();
  });

  it("a plugin record opens its panel and names its plugin; no panel opens nothing", async () => {
    const { state, data } = dataDeps();
    state.sources = [ISSUES];
    const svc = service({ data });
    const hit = ok(await svc.query("login", {})).groups.find((g) => g.kind === "data")!.hits[0];
    expect(hit).toMatchObject({ plugin: "Jira", target: { kind: "panel", plugin: "jira", panel: "main", focus: "J-1" } });
    state.sources = [{ ...ISSUES, panel: undefined, stamp: "1:" }];
    await svc.query("", {});
    expect(ok(await svc.query("login", {})).groups.find((g) => g.kind === "data")!.hits[0].target).toEqual({ kind: "none" });
    await svc.flush();
  });

  it("an unchanged stamp is not read again; a new stamp is; a source gone takes its records out", async () => {
    const { state, data } = dataDeps();
    const svc = service({ data });
    await svc.query("", {});
    await svc.query("", {});
    expect(data.rows).toHaveBeenCalledTimes(1);
    state.rows[PEOPLE.id] = [{ key: "b", title: "Bruno", text: "Chemistry", at: 0 }];
    state.sources = [{ ...PEOPLE, stamp: "2" }];
    await svc.query("", {});
    expect(data.rows).toHaveBeenCalledTimes(2);
    expect(ok(await svc.query("physics", {})).groups.some((g) => g.kind === "data")).toBe(false);
    expect(ok(await svc.query("chemistry", {})).counts.data).toBe(1);
    state.sources = [];
    await svc.query("", {});
    expect(ok(await svc.query("chemistry", {})).counts.data).toBe(0);
    await svc.flush();
  });

  it("a commit under .harness/data/ (or a restore) reads the collections again", async () => {
    const { state, data } = dataDeps();
    const svc = service({ data });
    await svc.query("", {});
    state.sources = [{ ...PEOPLE, stamp: "2" }];
    svc.committed(["docs/a.md"]);
    await svc.whenIdle();
    expect(data.rows).toHaveBeenCalledTimes(1);
    svc.committed([".harness/data/_app/people.json"]);
    await svc.whenIdle();
    expect(data.rows).toHaveBeenCalledTimes(2);
    state.sources = [{ ...PEOPLE, stamp: "3" }];
    svc.dataChanged();
    await svc.whenIdle();
    expect(data.rows).toHaveBeenCalledTimes(3);
    await svc.flush();
  });

  it("the snapshot keeps the records: a restart with the same stamp reads nothing and still finds them", async () => {
    const first = dataDeps();
    const svc = service({ data: first.data });
    await svc.query("", {});
    await svc.whenIdle();
    await svc.flush();
    const second = dataDeps();
    const again = service({ data: second.data });
    await again.query("", {});
    expect(second.data.rows).not.toHaveBeenCalled();
    expect(ok(await again.query("ana", {})).counts.data).toBe(1);
    await again.flush();
  });

  it("a source that fails to read keeps what the index had", async () => {
    const { state, data } = dataDeps();
    const svc = service({ data });
    await svc.query("", {});
    state.sources = [{ ...PEOPLE, stamp: "2" }];
    data.rows.mockRejectedValueOnce(new Error("disk"));
    await svc.query("", {});
    expect(ok(await svc.query("ana", {})).counts.data).toBe(1);
    await svc.flush();
  });

  it("the Data filter returns data rows; with no filter the All count is the groups' totals", async () => {
    fs.writeFileSync(path.join(base, "physics.txt"), "physics lab notes");
    const { data } = dataDeps();
    const svc = service({ data });
    await svc.query("", {});
    await svc.whenIdle();
    const all = ok(await svc.query("physics", {}));
    expect(all.groups.map((g) => g.kind)).toEqual(["file", "data"]);
    const sum = (o: Record<string, number | undefined>) => Object.values(o).reduce<number>((n, v) => n + (v ?? 0), 0);
    expect(sum(all.counts)).toBe(all.groups.reduce((n, g) => n + g.total, 0));
    const only = ok(await svc.query("physics", { kind: "data" }));
    expect(only.groups).toHaveLength(1);
    expect(only.groups[0].hits.map((h) => h.id)).toEqual(["data:harness:_app/people#a"]);
    await svc.flush();
  });

  it("while typing the collections are listed again at most every 5 s", async () => {
    let t = 1_000_000;
    const { state, data } = dataDeps();
    const svc = service({ data, now: () => t });
    await svc.query("", {});
    state.sources = [{ ...PEOPLE, stamp: "2" }];
    t += 1_000;
    await svc.query("x", {});
    expect(data.sources).toHaveBeenCalledTimes(1);
    t += 5_000;
    await svc.query("x", {});
    expect(data.sources).toHaveBeenCalledTimes(2);
    expect(data.rows).toHaveBeenCalledTimes(2);
    await svc.flush();
  });

  it("one answer reads a collection once for all its snippets", async () => {
    const { state, data } = dataDeps();
    state.rows[PEOPLE.id] = [
      { key: "a", title: "Ana", text: "Physics teacher", at: 0 },
      { key: 2, title: "Bruno", text: "Chemistry teacher", at: 0 },
    ];
    const svc = service({ data });
    await svc.query("", {});
    expect(data.rows).toHaveBeenCalledTimes(1);
    const group = ok(await svc.query("teacher", {})).groups.find((g) => g.kind === "data")!;
    expect(group.hits).toHaveLength(2);
    expect(group.hits.every((h) => h.context.some((p) => p.mark && p.text === "teacher"))).toBe(true);
    expect(data.rows).toHaveBeenCalledTimes(2);
    await svc.flush();
  });

  it("a discarded index starts no read and applies nothing it was waiting for", async () => {
    const { data } = dataDeps();
    let release!: (s: DataSource[]) => void;
    data.sources.mockImplementationOnce(() => new Promise<DataSource[]>((r) => (release = r)));
    const svc = service({ data });
    const answer = svc.query("", {});
    await vi.waitFor(() => expect(data.sources).toHaveBeenCalledTimes(1));
    await svc.discard(base);
    release([PEOPLE]);
    await answer;
    expect(data.rows).not.toHaveBeenCalled();
    svc.dataChanged();
    svc.committed([".harness/data/_app/people.json"]);
    await svc.whenIdle();
    expect(data.sources).toHaveBeenCalledTimes(1);
  });

  it("a read that ends after a discard is not applied, and no further source is read", async () => {
    const { state, data } = dataDeps();
    state.sources = [PEOPLE, ISSUES];
    let release!: (r: DataRow[]) => void;
    data.rows.mockImplementationOnce(() => new Promise<DataRow[]>((r) => (release = r)));
    const svc = service({ data });
    const answer = svc.query("", {});
    await vi.waitFor(() => expect(data.rows).toHaveBeenCalledTimes(1));
    await svc.discard(base);
    release(state.rows[PEOPLE.id]);
    await answer;
    expect(data.rows).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(searchDir(userData, base))).toBe(false);
  });
});
