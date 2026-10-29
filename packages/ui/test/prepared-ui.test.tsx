// @vitest-environment happy-dom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolCallView } from "../src/client";
import { ErrorCard } from "../src/ErrorCard";
import { ToolCallLines } from "../src/tools/ToolCallLine";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@humanharness/i18n";
import { renderIn } from "./render";

afterEach(cleanup);

const call = (tool: string, extra: Partial<ToolCallView> = {}): ToolCallView => ({
  tool,
  caller: "pre",
  ok: true,
  ms: 300,
  summary: "3 items",
  args: "{}",
  accesses: [],
  at: "2026-10-29T10:00:00.000Z",
  ...extra,
});
const agent = call("pr-ci", { caller: "agent", ms: 312, summary: "12 items" });

describe("the prepared group (tools spec §8.2)", () => {
  it("D0: an entry without pre calls renders as before", async () => {
    const { container } = await renderIn("en", <ToolCallLines calls={[agent, call("pr-list", { caller: "ui" })]} />);
    // Slice 2's markup for the same calls (taken from feat/tools' ToolCallLines), React's generated ids aside.
    const SLICE_2 =
      '<div class="hh-tool-calls">' +
      '<div class="hh-tool-call"><button type="button" class="hh-tool-line" aria-expanded="false" aria-controls="ID">pr-ci · 12 items · 0.3 s · 0 tokens</button>' +
      '<dl id="ID" class="hh-tool-details" hidden=""><dt>Arguments</dt><dd><pre dir="auto">{}</pre></dd></dl></div>' +
      '<div class="hh-tool-call"><button type="button" class="hh-tool-line" aria-expanded="false" aria-controls="ID">pr-list · 3 items · 0.3 s · 0 tokens</button>' +
      '<dl id="ID" class="hh-tool-details" hidden=""><dt>Arguments</dt><dd><pre dir="auto">{}</pre></dd></dl></div>' +
      "</div>";
    expect(container.innerHTML.replace(/_r_[0-9a-z]+_/g, "ID")).toBe(SLICE_2);
    expect(container.querySelector(".hh-tool-group")).toBeNull();
    expect(screen.queryByText(/^Prepared/)).toBeNull();
  });

  it("an entry's leading pre calls fold into one line: Prepared 2 items · 0.4 s · 0 tokens", async () => {
    const { container } = await renderIn("en", <ToolCallLines calls={[call("due-today", { ms: 300 }), call("warmup-cards", { ms: 100 }), agent]} />);
    const group = screen.getByRole("button", { name: "Prepared 2 items · 0.4 s · 0 tokens" });
    expect(group.getAttribute("aria-expanded")).toBe("false");
    // Folded: only the agent's own line is shown besides the group.
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Prepared 2 items · 0.4 s · 0 tokens", "pr-ci · 12 items · 0.3 s · 0 tokens"]);
    const list = container.firstElementChild!;
    expect([...list.children].map((c) => c.className)).toEqual(["hh-tool-group", "hh-tool-call"]);
  });

  it("one item reads Prepared 1 item", async () => {
    await renderIn("en", <ToolCallLines calls={[call("due-today", { ms: 1260 })]} />);
    expect(screen.getByRole("button", { name: "Prepared 1 item · 1.3 s · 0 tokens" })).toBeTruthy();
  });

  it("unfolding the group shows each call's line and each note", async () => {
    await renderIn(
      "en",
      <ToolCallLines calls={[call("due-today"), call("due-today", { ms: 0, summary: "", note: "today: cut: 12 of 40 items" }), call("warmup-cards", { ms: 100 })]} />,
    );
    // Folded: the lines are in the page (aria-controls names them) but hidden.
    expect(screen.getByText("today: cut: 12 of 40 items").closest("[hidden]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^due-today/ })).toBeNull();
    const group = screen.getByRole("button", { name: "Prepared 2 items · 0.4 s · 0 tokens" });
    fireEvent.click(group);
    expect(group.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("today: cut: 12 of 40 items").closest("[hidden]")).toBeNull();
    expect(screen.getByRole("button", { name: "due-today · 3 items · 0.3 s · 0 tokens" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "warmup-cards · 3 items · 0.1 s · 0 tokens" })).toBeTruthy();
    // A note is a line of its own, not a call's folded line.
    expect(screen.getByText("today: cut: 12 of 40 items").closest(".hh-tool-note")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^due-today · · 0\.0 s/ })).toBeNull();
  });

  it("the group is unfolded when a pre call failed", async () => {
    await renderIn("en", <ToolCallLines calls={[call("due-today"), call("warmup-cards", { ok: false, error: "the API is down" })]} />);
    const group = screen.getByRole("button", { name: "Prepared 2 items · 0.6 s · 0 tokens" });
    expect(group.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "warmup-cards failed · the API is down" })).toBeTruthy();
  });

  it("the group unfolds when a later pre call fails after it was drawn", async () => {
    const ok = call("due-today");
    const { rerender } = await renderIn("en", <ToolCallLines calls={[ok]} />);
    expect(screen.getByRole("button", { name: /^Prepared/ }).getAttribute("aria-expanded")).toBe("false");
    const i18n = await createI18n("en");
    rerender(
      <I18nextProvider i18n={i18n}>
        <ToolCallLines calls={[ok, call("warmup-cards", { ok: false, error: "the API is down" })]} />
      </I18nextProvider>,
    );
    expect(screen.getByRole("button", { name: /^Prepared/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("N counts distinct tools: forEach calls of one step count once, notes not at all", async () => {
    await renderIn(
      "en",
      <ToolCallLines calls={[call("pr-detail", { ms: 100 }), call("pr-detail", { ms: 100 }), call("pr-detail", { ms: 100 }), call("due-today", { ms: 0, note: "pr: cut: 1 of 3 items" })]} />,
    );
    expect(screen.getByRole("button", { name: "Prepared 1 item · 0.3 s · 0 tokens" })).toBeTruthy();
  });

  it("only the leading pre calls fold: a later pre call keeps its own line", async () => {
    const { container } = await renderIn("en", <ToolCallLines calls={[agent, call("due-today")]} />);
    expect(container.querySelector(".hh-tool-group")).toBeNull();
    expect(screen.getByRole("button", { name: "due-today · 3 items · 0.3 s · 0 tokens" })).toBeTruthy();
  });

  it("a leading run of notes only draws the notes without a group", async () => {
    const { container } = await renderIn(
      "en",
      <ToolCallLines calls={[call("due-today", { ms: 0, summary: "", note: "today: cut: 12 of 40 items" }), agent]} />,
    );
    expect(container.querySelector(".hh-tool-group")).toBeNull();
    expect(screen.queryByText(/^Prepared/)).toBeNull();
    const note = screen.getByText("today: cut: 12 of 40 items");
    expect(note.closest(".hh-tool-note")).not.toBeNull();
    expect(note.closest("[hidden]")).toBeNull();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["pr-ci · 12 items · 0.3 s · 0 tokens"]);
  });

  it("a note outside a group is drawn as a note line", async () => {
    await renderIn("en", <ToolCallLines calls={[agent, call("apply-evidence", { caller: "agent", ms: 0, summary: "", note: "Expected apply-evidence in Close: not called" })]} />);
    expect(screen.getByText("Expected apply-evidence in Close: not called").closest(".hh-tool-note")).not.toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});

describe("a refused start", () => {
  it("prepare-failed shows 'Couldn't prepare this task: <detail>' and Try again", async () => {
    const onRetry = vi.fn();
    await renderIn("en", <ErrorCard error={{ code: "prepare-failed", detail: "due-today failed: the API is down" }} engine="Claude" onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain("Couldn't prepare this task: due-today failed: the API is down");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
