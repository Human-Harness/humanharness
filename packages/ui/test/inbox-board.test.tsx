// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { boardColumns } from "../src/parallel/board";

describe("boardColumns", () => {
  it("splits tasks into Waiting for you, Working, Queued and adds Jobs (spec §5.4)", () => {
    const cols = boardColumns({
      tasks: [{ id: "a", state: "waiting" }, { id: "b", state: "running" }, { id: "c", state: "queued" }, { id: "d", state: "waiting" }],
      jobs: [{ id: "j1" }, { id: "j2" }],
    });
    expect(cols.map((c) => [c.id, c.tone, c.items.length])).toEqual([["waiting", "orange", 2], ["working", "blue", 1], ["queued", "gray", 1], ["jobs", "violet", 2]]);
  });
  it("has no Jobs column for a harness without jobs", () => {
    expect(boardColumns({ tasks: [], jobs: null }).map((c) => c.id)).toEqual(["waiting", "working", "queued"]);
  });
});
