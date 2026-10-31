import { describe, expect, it } from "vitest";
import { type SearchCommandState, searchCommands } from "../src/search-local";

const base: SearchCommandState = { chat: null, scopes: [], openScope: null, tabs: ["general", "engine"] };
const ids = (s: SearchCommandState) => searchCommands(s).map((c) => `${c.command}${c.arg ? `:${c.arg}` : ""}`);

describe("the commands available now (search spec §6, plan deviation 14)", () => {
  it("away from the chat: Settings' tabs and the scopes only", () => {
    expect(ids(base)).toEqual(["open-settings:general", "open-settings:engine"]);
  });

  it("in the chat with no task: a new question and the panels but the task's context; no stop, no next part", () => {
    expect(ids({ ...base, chat: { taskOpen: false, turnRunning: false, nextPart: null, panels: true } })).toEqual(["new-question", "open-history", "open-notes", "open-settings:general", "open-settings:engine"]);
  });

  it("what the AI takes into account: only with a task open, and never in the slim window", () => {
    expect(ids({ ...base, chat: { taskOpen: true, turnRunning: false, nextPart: null, panels: true } })).toContain("open-context");
    expect(ids({ ...base, chat: { taskOpen: true, turnRunning: false, nextPart: null, panels: false } })).not.toContain("open-context");
  });

  it("a task open and a turn running: Stop; the next part when the task waits; never New question", () => {
    const running = ids({ ...base, chat: { taskOpen: true, turnRunning: true, nextPart: null, panels: false } });
    expect(running).toContain("stop-turn");
    expect(running).not.toContain("new-question");
    const waiting = searchCommands({ ...base, chat: { taskOpen: true, turnRunning: false, nextPart: { id: "write", label: "Write" }, panels: false } });
    expect(waiting.find((c) => c.command === "next-part")).toMatchObject({ arg: "write", vars: { part: "Write" } });
  });

  it("switch scope: every scope that isn't archived and isn't open, unless a turn runs", () => {
    const scopes = [
      { id: "physics", title: "Physics", archived: false },
      { id: "maths", title: "Maths", archived: false },
      { id: "old-term", title: "Last term", archived: true },
    ];
    expect(ids({ ...base, scopes, openScope: "physics" }).filter((i) => i.startsWith("switch"))).toEqual(["switch-scope:maths"]);
    expect(ids({ ...base, scopes, openScope: null, chat: { taskOpen: true, turnRunning: true, nextPart: null, panels: false } }).filter((i) => i.startsWith("switch"))).toEqual([]);
  });

  it("the slim window offers no side panels; no next part while a turn runs is the chat's to say (null)", () => {
    const slim = ids({ ...base, chat: { taskOpen: true, turnRunning: false, nextPart: null, panels: false } });
    expect(slim.filter((i) => i.startsWith("open-") && !i.startsWith("open-settings"))).toEqual([]);
    expect(slim).not.toContain("next-part");
    expect(slim).not.toContain("stop-turn");
  });
});
