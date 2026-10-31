// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer, SearchHitView } from "../src/client";
import { type LocalRows, chipsOf, sectionsOf } from "../src/search/model";
import { SearchPalette } from "../src/search/SearchPalette";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const answer = (query: string, o: Partial<Extract<SearchAnswer, { ok: true }>> = {}): SearchAnswer => ({ ok: true, query, groups: [], counts: { task: 0, note: 0, file: 0 }, recent: [], partial: false, status: { state: "ready", done: 0, total: 0 }, allScopes: false, ...o });
const SETTING: SearchHitView = { id: "setting:general.appearance", kind: "setting", title: [{ text: "Appearance" }], context: [{ text: "General" }], hint: null, target: { kind: "setting", tab: "general", field: "general.appearance" } };
const COMMAND: SearchHitView = { id: "command:open-history", kind: "command", title: [{ text: "Open History" }], context: [], hint: null, target: { kind: "command", command: "open-history" } };
const file = (id: string): SearchHitView => ({ id, kind: "file", title: [{ text: id }], context: [], hint: { kind: "path", text: id }, target: { kind: "timeline", path: id } });

async function palette(local: (q: string) => LocalRows) {
  const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
  const query = vi.spyOn(client.search, "query").mockImplementation(async (q) => answer(q));
  const onPick = vi.fn();
  await renderIn("en", <SearchPalette client={client} where="Searching in Demo" references={false} onClose={() => {}} onPick={onPick} onAsk={() => {}} local={local} />);
  return { query, onPick };
}

describe("settings and actions in the palette (search spec §3, §6)", () => {
  it("nothing typed: the available actions after the recents", async () => {
    await palette((q) => ({ query: q, setting: [], command: q.trim() ? [] : [COMMAND] }));
    const list = await screen.findByRole("listbox", { name: "Results" });
    expect(await within(list).findByRole("group", { name: "Actions" })).toBeTruthy();
    expect(within(list).getByRole("option").textContent).toContain("Open History");
  });

  it("typed: a Settings group and its chip; the chip filters locally and asks main without a kind", async () => {
    const { query, onPick } = await palette((q) => ({ query: q, setting: q.trim() ? [SETTING] : [], command: [] }));
    fireEvent.change(screen.getByRole("combobox", { name: "Search tasks, notes and files" }), { target: { value: "app" } });
    const list = await screen.findByRole("listbox", { name: "Results" });
    await within(list).findByRole("group", { name: "Settings" });
    fireEvent.click(screen.getByRole("button", { name: /Settings 1/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Settings 1/ }).getAttribute("aria-pressed")).toBe("true"));
    expect(query.mock.calls.at(-1)?.[1]).not.toHaveProperty("kind");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(SETTING);
  });

  it("main is only ever asked the typed query: no local row's text, no local kind", async () => {
    const { query } = await palette((q) => ({ query: q, setting: q.trim() ? [SETTING] : [], command: q.trim() ? [COMMAND] : [] }));
    fireEvent.change(screen.getByRole("combobox", { name: "Search tasks, notes and files" }), { target: { value: "op" } });
    await screen.findByRole("button", { name: /Actions 1/ });
    fireEvent.click(screen.getByRole("button", { name: /Actions 1/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Actions 1/ }).getAttribute("aria-pressed")).toBe("true"));
    for (const [q, filters] of query.mock.calls) {
      expect(["", "op"]).toContain(q);
      expect(filters?.kind).toBeUndefined();
    }
  });
});

describe("the model merges main's answer with the window's rows", () => {
  const typed = answer("app", { groups: [{ kind: "file", total: 7, hits: [file("a.md"), file("b.md")] }], counts: { task: 2, note: 0, file: 7, data: 1 } });
  const settings = Array.from({ length: 8 }, (_, i) => ({ ...SETTING, id: `setting:s${i}` }));
  const local: LocalRows = { query: "app", setting: settings, command: [COMMAND] };

  it("groups in §3's order; five local rows per group, fifty with the chip", () => {
    expect(sectionsOf(typed, local).map((s) => [s.key, s.hits.length])).toEqual([
      ["file", 2],
      ["setting", 5],
      ["command", 1],
    ]);
    expect(sectionsOf(typed, local, "setting").map((s) => [s.key, s.hits.length])).toEqual([["setting", 8]]);
    expect(sectionsOf(typed, local, "file").map((s) => s.key)).toEqual(["file"]);
  });

  it("chips: All sums main's totals and every local match, like main counts beyond the rows shown", () => {
    expect(chipsOf(typed, local)).toEqual([
      { kind: null, count: 2 + 7 + 1 + 8 + 1 },
      { kind: "task", count: 2 },
      { kind: "file", count: 7 },
      { kind: "setting", count: 8 },
      { kind: "command", count: 1 },
      { kind: "data", count: 1 },
    ]);
    expect(chipsOf(answer("zz"), { query: "zz", setting: [], command: [COMMAND] })).toEqual([
      { kind: null, count: 1 },
      { kind: "command", count: 1 },
    ]);
    expect(chipsOf(answer(""), { query: "", setting: [], command: [COMMAND] })).toEqual([]);
  });

  it("without local rows: plan 1's answer as main sends it", () => {
    expect(sectionsOf(typed).map((s) => s.key)).toEqual(["file"]);
    expect(chipsOf(typed).map((c) => c.kind)).toEqual([null, "task", "file", "data"]);
  });
});
