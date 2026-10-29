// @vitest-environment happy-dom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskContext } from "../src/client";
import { ContextPanel } from "../src/ContextPanel";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

// A pre-step result (tools spec slice 3) as a start item: its label comes from the `as` in its id, not the stored label.
const CTX: TaskContext = {
  task: "t1",
  scope: "main",
  scoped: false,
  start: [
    { id: "instructions", kind: "instructions", label: "Harness instructions", path: "AGENTS.md", tokens: 1200 },
    { id: "prepared:today", kind: "prepared", label: "stored label", tokens: 300 },
  ],
  reads: [],
  compacted: false,
  pins: [],
  excluded: [],
  budget: 3000,
};

async function show() {
  const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
  client.contexts.t1 = CTX;
  const onOpen = vi.fn();
  await renderIn("en", <ContextPanel client={client} taskId="t1" usage={{ used: 40_000, cap: 200_000 }} onOpen={onOpen} onClose={() => {}} />);
  const panel = await screen.findByRole("region", { name: "What the AI takes into account" });
  await within(panel).findByRole("heading", { name: "At the start" });
  return within(panel).getByRole("region", { name: "At the start" });
}

describe("the prepared start item in the context panel", () => {
  it("a prepared item reads 'Prepared · today' with its estimate in At the start, with no Exclude, Pin or open", async () => {
    const start = await show();
    const label = within(start).getByText("Prepared · today");
    expect(within(start).queryByText("stored label")).toBeNull();
    const row = label.closest("li")!;
    expect(row.textContent).toContain("approx. 300 tokens");
    // Plain text: no link to open, and no Exclude, Pin or any other action on the row.
    expect(label.tagName).toBe("SPAN");
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
    expect(within(row).queryAllByRole("link")).toHaveLength(0);
  });

  it("it counts in the total", async () => {
    const start = await show();
    expect(within(start).getByText("Total: approx. 1,500 tokens")).toBeTruthy();
  });
});
