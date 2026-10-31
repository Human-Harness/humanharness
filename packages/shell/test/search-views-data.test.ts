import { describe, expect, it, vi } from "vitest";
import type { SearchHit } from "@humanharness/search";
import { searchHandlers } from "../src/main/search/ipc";
import type { SearchService } from "../src/main/search/service";
import { hintOf, hitView, targetOf } from "../src/main/search/views";

const record = (data: Partial<NonNullable<SearchHit["data"]>> = {}): SearchHit => ({
  id: "data:harness:_app/people#ana-secret-key",
  kind: "data",
  scope: "_app",
  title: "Ana's private notes",
  path: "",
  at: 0,
  score: 1,
  terms: ["ana"],
  data: { source: "harness:_app/people", owner: "harness", collection: "people", folder: "_app", key: "ana-secret-key", ...data },
});

describe("data rows in main's views (search spec D4, plan deviation 10)", () => {
  it("a record's key or title never reaches the ⌘Enter hints", () => {
    expect(hintOf(record(), false)).toBeNull();
    expect(hintOf(record({ owner: "plugin", plugin: "jira", panel: "main" }), true)).toBeNull();
    const view = hitView(record(), { refLabels: new Map(), scopeTitle: () => undefined, snippet: { marked: [{ text: "Ana", mark: true }] } });
    expect(view.hint).toBeNull();
    expect(view.context).toEqual([{ text: "Ana", mark: true }]);
  });

  it("a harness record opens the record; a plugin's opens its panel, or nothing without one", () => {
    expect(targetOf(record())).toEqual({ kind: "record", collection: "people", key: "ana-secret-key", scope: "_app" });
    expect(targetOf(record({ folder: "physics", key: null }))).toEqual({ kind: "record", collection: "people", key: null, scope: "physics" });
    expect(targetOf(record({ owner: "plugin", plugin: "jira", pluginName: "Jira", panel: "main", collection: "issues", key: 7 }))).toEqual({
      kind: "panel",
      plugin: "jira",
      panel: "main",
      focus: "7",
    });
    expect(targetOf(record({ owner: "plugin", plugin: "jira", pluginName: "Jira", collection: "issues" }))).toEqual({ kind: "none" });
  });

  it("the Data filter passes the handlers; an unknown kind is still dropped", async () => {
    const s = { query: vi.fn(async () => ({ ok: true })), opened: vi.fn(async () => ({ ok: true })) } as unknown as SearchService;
    const h = searchHandlers(s);
    await h["hh:search"]("ana", { kind: "data" });
    expect(s.query).toHaveBeenLastCalledWith("ana", { kind: "data" });
    await h["hh:search"]("ana", { kind: "setting" });
    expect(s.query).toHaveBeenLastCalledWith("ana", {});
    await h["hh:search"]("ana", { kind: "Data" });
    expect(s.query).toHaveBeenLastCalledWith("ana", {});
  });
});
