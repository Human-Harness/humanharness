// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LearnedList } from "../src/sidekick/LearnedList";
import { SidekickTab } from "../src/sidekick/SidekickTab";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";
import { SK_ON } from "./sidekick-fixtures";

afterEach(cleanup);
const ITEMS = [
  { id: "l-1", text: "Takes scope fixes.", level: "you" as const, source: "learned" as const },
  { id: "l-2", text: "Sections stay under 400 words.", level: "harness" as const, source: "learned" as const },
  { id: "l-3", text: "Doesn't want vague suggestions.", level: "you" as const, source: "person" as const, kind: "vague" },
];

describe("What Sidekick learned (spec §6.4)", () => {
  it("two columns, the person's items marked; Forget this", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickLearned = ITEMS;
    await renderIn("en", <LearnedList client={c} />);
    const you = await screen.findByRole("region", { name: "About you" });
    const here = screen.getByRole("region", { name: "In this app" });
    expect(you.textContent).toContain("Takes scope fixes.");
    expect(you.textContent).toContain("Doesn't want vague suggestions. · Yours");
    expect(here.textContent).toContain("Sections stay under 400 words.");
    expect(here.textContent).not.toContain("Yours");
    fireEvent.click(screen.getAllByRole("button", { name: "Forget this" })[0]);
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["forget", "l-1"]));
    await waitFor(() => expect(screen.queryByText("Takes scope fixes.")).toBeNull());
  });

  it("Edit opens an editable list; Save sends only the changes", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickLearned = ITEMS;
    await renderIn("en", <LearnedList client={c} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByDisplayValue("Takes scope fixes."), { target: { value: "Usually takes scope fixes. " } });
    fireEvent.change(screen.getByDisplayValue("Sections stay under 400 words."), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["editLearned", [{ id: "l-1", text: "Usually takes scope fixes." }]]));
    expect(await screen.findByText("Usually takes scope fixes.")).toBeTruthy();
  });

  it("Cancel leaves the items as they were", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickLearned = ITEMS;
    await renderIn("en", <LearnedList client={c} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByDisplayValue("Takes scope fixes."), { target: { value: "Something else." } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Takes scope fixes.")).toBeTruthy();
    expect(c.sidekickCalls).toEqual([]);
  });

  it("Forget everything asks once", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickLearned = ITEMS;
    await renderIn("en", <LearnedList client={c} />);
    fireEvent.click(await screen.findByRole("button", { name: "Forget everything" }));
    expect(c.sidekickCalls).not.toContainEqual(["forgetAll"]);
    expect(screen.getByText(/forgets everything it learned/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yes, forget everything" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["forgetAll"]));
    expect(await screen.findAllByText("Nothing yet.")).toHaveLength(2);
  });

  it("nothing learned: both columns say so, and Edit and Forget everything are off", async () => {
    const c = new FakeClient({ language: "en" });
    await renderIn("en", <LearnedList client={c} />);
    expect(await screen.findAllByText("Nothing yet.")).toHaveLength(2);
    expect((screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Forget everything" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a failed change says why", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickLearned = ITEMS;
    c.sidekickLearnedFails = "Turns are running";
    await renderIn("en", <LearnedList client={c} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Forget this" }))[0]);
    expect((await screen.findByRole("alert")).textContent).toBe("Could not save: Turns are running");
  });

  it("Forget everything moves focus to Yes, described by the question; Cancel brings it back", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickLearned = ITEMS;
    await renderIn("en", <LearnedList client={c} />);
    fireEvent.click(await screen.findByRole("button", { name: "Forget everything" }));
    const yes = screen.getByRole("button", { name: "Yes, forget everything" });
    expect(document.activeElement).toBe(yes);
    expect(document.getElementById(yes.getAttribute("aria-describedby") ?? "")?.textContent).toMatch(/forgets everything it learned/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Forget everything" }));
  });

  it("Edit moves focus to the first input; Save and Cancel bring it back to Edit", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickLearned = ITEMS;
    await renderIn("en", <LearnedList client={c} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(document.activeElement).toBe(screen.getByDisplayValue("Takes scope fixes."));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit" }));
  });

  it("each Forget this is described by its item", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickLearned = ITEMS;
    await renderIn("en", <LearnedList client={c} />);
    const buttons = await screen.findAllByRole("button", { name: "Forget this" });
    const described = buttons.map((b) => document.getElementById(b.getAttribute("aria-describedby") ?? "")?.textContent);
    expect(described).toEqual(["Takes scope fixes.", "Doesn't want vague suggestions.", "Sections stay under 400 words."]);
  });

  it("Settings › Sidekick shows the list", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickState = SK_ON;
    c.sidekickLearned = ITEMS;
    await renderIn("en", <SidekickTab client={c} onModels={() => {}} />);
    expect(await screen.findByRole("heading", { name: "What Sidekick learned" })).toBeTruthy();
    expect(await screen.findByText("Takes scope fixes.")).toBeTruthy();
  });
});
