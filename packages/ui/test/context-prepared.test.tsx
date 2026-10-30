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

async function show(ctx: TaskContext = CTX) {
  const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
  client.contexts.t1 = ctx;
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

// tasks.json is read unchecked beyond cleanItem: a hand-edited prepared item must still draw as a plain, bounded label.
const withStart = (...items: TaskContext["start"]): TaskContext => ({ ...CTX, start: [CTX.start[0]!, ...items] });

describe("a hand-edited prepared item", () => {
  it("an id whose name is empty, too long or not a tool id falls back to the stored label", async () => {
    const start = await show(
      withStart(
        { id: "prepared:", kind: "prepared", label: "empty", tokens: 1 },
        { id: `prepared:${"a".repeat(65)}`, kind: "prepared", label: "too long", tokens: 1 },
        { id: "prepared:Not An Id", kind: "prepared", label: "not an id", tokens: 1 },
        { id: "prepared:x#", kind: "prepared", label: "bare hash", tokens: 1 },
      ),
    );
    for (const label of ["empty", "too long", "not an id", "bare hash"]) expect(within(start).getByText(`Prepared · ${label}`)).toBeTruthy();
    expect(within(start).queryByText(/aaaa/)).toBeNull();
  });

  it("a name of 64 characters is shown", async () => {
    const name = "a".repeat(64);
    const start = await show(withStart({ id: `prepared:${name}`, kind: "prepared", label: "stored", tokens: 1 }));
    expect(within(start).getByText(`Prepared · ${name}`)).toBeTruthy();
  });

  it("a repeated id `prepared:<as>#<n>` reads 'Prepared · <as> #<n>'", async () => {
    const start = await show(withStart({ id: "prepared:today#2", kind: "prepared", label: "stored", tokens: 1 }));
    expect(within(start).getByText("Prepared · today #2")).toBeTruthy();
  });

  it("a path and notes on a prepared item show no open link and no Exclude button", async () => {
    const start = await show(
      withStart({ id: "prepared:today", kind: "prepared", label: "stored", path: "notes/today.md", tokens: 1, notes: [{ path: "notes/a.md", title: "Note A" }] }),
    );
    const row = within(start).getByText("Prepared · today").closest("li")!;
    expect(within(start).getByText("Prepared · today").tagName).toBe("SPAN");
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
    expect(within(row).queryByText("Note A")).toBeNull();
  });
});
