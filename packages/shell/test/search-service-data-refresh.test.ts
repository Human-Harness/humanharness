import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer } from "@humanharness/protocol";
import type { DataRow, DataSource } from "@humanharness/search";
import { inProcessBuild } from "../src/main/search/runner";
import { SearchService, type SearchServiceDeps } from "../src/main/search/service";

let tmp: string;
let base: string;
let userData: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-data-refresh-"));
  base = path.join(tmp, "Work");
  userData = path.join(tmp, "userData");
  fs.mkdirSync(base, { recursive: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const PEOPLE: DataSource = { id: "harness:_app/people", owner: "harness", collection: "people", folder: "_app", stamp: "1" };
const ISSUES: DataSource = { id: "plugin:jira/issues", owner: "plugin", plugin: "jira", pluginName: "Jira", panel: "main", collection: "issues", folder: "_app", stamp: "1:main" };
const row = (key: string, title: string): DataRow => ({ key, title, text: "", at: 0 });

function dataDeps() {
  const state = {
    sources: [PEOPLE] as DataSource[],
    rows: { [PEOPLE.id]: [row("a", "Ana")], [ISSUES.id]: [row("J-1", "Login one"), row("J-2", "Login two"), row("J-3", "Login three")] } as Record<string, DataRow[]>,
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
/** Refresh reads only: a snippet reads its collection again with no stamp. */
const readsOf = (rows: ReturnType<typeof dataDeps>["data"]["rows"], id: string) => rows.mock.calls.filter(([s]) => s.id === id && s.stamp !== "").length;

describe("SearchService data refresh (search spec D4, the cap and the passes)", () => {
  it("a source cut short by the cap is not read again while its stamp and its room stay the same", async () => {
    const { state, data } = dataDeps();
    state.sources = [ISSUES];
    const svc = service({ data, maxDataDocs: 2 });
    await svc.query("", {});
    expect(ok(await svc.query("login", {})).counts.data).toBe(2);
    await svc.query("", {});
    await svc.query("", {});
    expect(readsOf(data.rows, ISSUES.id)).toBe(1);
    await svc.flush();
  });

  it("a cut source is read again once it has more room, and once its stamp changes", async () => {
    const { state, data } = dataDeps();
    state.sources = [PEOPLE, ISSUES];
    const svc = service({ data, maxDataDocs: 3 });
    await svc.query("", {});
    expect(ok(await svc.query("login", {})).counts.data).toBe(2);
    await svc.query("", {});
    expect(readsOf(data.rows, ISSUES.id)).toBe(1);
    state.sources = [ISSUES];
    await svc.query("", {});
    expect(readsOf(data.rows, ISSUES.id)).toBe(2);
    expect(ok(await svc.query("login", {})).counts.data).toBe(3);
    state.sources = [PEOPLE, { ...ISSUES, stamp: "2:main" }];
    await svc.query("", {});
    expect(readsOf(data.rows, ISSUES.id)).toBe(3);
    expect(ok(await svc.query("login", {})).counts.data).toBe(2);
    await svc.flush();
  });

  it("no room left: a source is not read at all, and its documents leave", async () => {
    const { state, data } = dataDeps();
    state.sources = [ISSUES];
    const svc = service({ data, maxDataDocs: 3 });
    await svc.query("", {});
    expect(ok(await svc.query("login", {})).counts.data).toBe(3);
    state.rows[PEOPLE.id] = [row("a", "Ana"), row("b", "Bea"), row("c", "Cris")];
    state.sources = [PEOPLE, { ...ISSUES, stamp: "2:main" }];
    await svc.query("", {});
    expect(readsOf(data.rows, ISSUES.id)).toBe(1);
    expect(ok(await svc.query("login", {})).counts.data).toBe(0);
    await svc.flush();
  });

  it("a read that fails keeps what the index had only while it still fits", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { state, data } = dataDeps();
    state.sources = [ISSUES];
    const svc = service({ data, maxDataDocs: 3 });
    await svc.query("", {});
    state.rows[PEOPLE.id] = [row("a", "Ana"), row("b", "Bea")];
    state.sources = [PEOPLE, { ...ISSUES, stamp: "2:main" }];
    data.rows.mockImplementation(async (s) => {
      if (s.id === ISSUES.id) throw new Error("disk");
      return state.rows[s.id] ?? [];
    });
    await svc.query("", {});
    expect(ok(await svc.query("login", {})).counts.data).toBe(0);
    expect(ok(await svc.query("ana", {})).counts.data).toBe(1);
    await svc.flush();
  });

  it("a change asked for just as a refresh ends is not lost", async () => {
    for (let k = 0; k < 16; k++) {
      const { state, data } = dataDeps();
      const svc = service({ data });
      await svc.query("", {});
      let asked!: () => void;
      const done = new Promise<void>((r) => (asked = r));
      data.sources.mockImplementationOnce(async () => {
        let p = Promise.resolve();
        for (let i = 0; i < k; i++) p = p.then(() => {});
        void p.then(() => {
          state.sources = [{ ...PEOPLE, stamp: "2" }];
          svc.dataChanged();
          asked();
        });
        return [PEOPLE];
      });
      svc.dataChanged();
      await done;
      await svc.whenIdle();
      expect({ k, reads: data.rows.mock.calls.length }).toEqual({ k, reads: 2 });
      await svc.flush();
    }
  });

  it("an answer waits for the refresh in progress, not for every one asked for after it", async () => {
    const { data } = dataDeps();
    const svc = service({ data });
    await svc.query("", {});
    let release1!: (s: DataSource[]) => void;
    let release2!: (s: DataSource[]) => void;
    data.sources.mockImplementationOnce(() => new Promise<DataSource[]>((r) => (release1 = r))).mockImplementationOnce(() => new Promise<DataSource[]>((r) => (release2 = r)));
    svc.dataChanged();
    await vi.waitFor(() => expect(data.sources).toHaveBeenCalledTimes(2));
    let answered = false;
    const answer = svc.query("", {}).then((a) => {
      answered = true;
      return a;
    });
    await new Promise((r) => setTimeout(r, 20));
    release1([PEOPLE]);
    await vi.waitFor(() => expect(data.sources).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(answered).toBe(true));
    release2([PEOPLE]);
    ok(await answer);
    await svc.whenIdle();
    await svc.flush();
  });

  it("a source that keeps failing is tried again later and later, and logged once per stamp", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let t = 1_000_000;
    const { state, data } = dataDeps();
    data.rows.mockRejectedValue(new Error("disk"));
    const svc = service({ data, now: () => t });
    for (let i = 0; i <= 6; i++) {
      await svc.query("", {});
      t += 5_000;
    }
    // t = 0, 10 s and 30 s (waits of 10 s, then 20 s).
    expect(data.rows).toHaveBeenCalledTimes(3);
    const logged = () => errors.mock.calls.filter(([m]) => m === "Could not read a searchable collection").length;
    expect(logged()).toBe(1);
    state.sources = [{ ...PEOPLE, stamp: "2" }];
    await svc.query("", {});
    expect(data.rows).toHaveBeenCalledTimes(4);
    expect(logged()).toBe(2);
    data.rows.mockImplementation(async (s) => state.rows[s.id] ?? []);
    t += 10_000;
    await svc.query("", {});
    expect(ok(await svc.query("ana", {})).counts.data).toBe(1);
    await svc.flush();
  });
});
