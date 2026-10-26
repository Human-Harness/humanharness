// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SettingsView } from "../src/client";
import { HarnessSettingsTab } from "../src/HarnessSettingsTab";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const view: SettingsView = {
  tab: "How I learn",
  sections: [
    { id: "voice", label: "How the AI talks" },
    { id: "help", label: "Help" },
  ],
  fields: [
    { name: "nickname", control: "text", label: "What the app calls you", help: "Only the app's screens use it.", default: "", max: 40 },
    {
      name: "tone",
      control: "segmented",
      label: "Tone",
      section: "voice",
      default: "patient",
      options: [
        { value: "patient", label: "Patient" },
        { value: "demanding", label: "Demanding" },
      ],
      agent: true,
    },
    { name: "level", control: "select", label: "Level", section: "voice", default: "6", options: [{ value: "5", label: "5th grade" }, { value: "6", label: "6th grade" }], agent: true },
    { name: "examples", control: "toggle", label: "Show worked examples", section: "help", default: true, agent: true },
    { name: "hintAfter", control: "number", label: "Hint after", unit: "tries", section: "help", advanced: true, default: 2, min: 1, max: 5, agent: true },
  ],
};
const defaults = { nickname: "", tone: "patient", level: "6", examples: true, hintAfter: 2 };

async function draw(client = new FakeClient()) {
  client.state.settings = view;
  client.settingsState = { values: { ...defaults }, pending: [] };
  await renderIn("en", <HarnessSettingsTab client={client} view={view} />);
  await screen.findByRole("group", { name: "Tone" });
  return client;
}

/** The texts an element's aria-describedby points at. */
const descriptions = (el: HTMLElement) =>
  (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent);

describe("HarnessSettingsTab", () => {
  it("draws the unsectioned fields first, then each section with its controls", async () => {
    await draw();
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["How the AI talks", "Help"]);
    expect(within(screen.getByRole("group", { name: "Tone" })).getByRole("button", { name: "Patient" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("Level") as HTMLSelectElement).value).toBe("6");
    expect((screen.getByRole("switch", { name: "Show worked examples" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Only the app's screens use it.")).toBeTruthy();
    expect(descriptions(screen.getByLabelText("What the app calls you"))).toEqual(["Only the app's screens use it."]);
  });

  it("saves segmented, select and switch changes at once", async () => {
    const client = await draw();
    fireEvent.click(screen.getByRole("button", { name: "Demanding" }));
    fireEvent.change(screen.getByLabelText("Level"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("switch", { name: "Show worked examples" }));
    await screen.findByRole("button", { name: "Back to the app's defaults" });
    expect(client.settingsSets).toEqual([
      { field: "tone", value: "demanding" },
      { field: "level", value: "5" },
      { field: "examples", value: false },
    ]);
    expect(screen.getByRole("button", { name: "Demanding" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps advanced fields under More options; a number saves on blur, as a number", async () => {
    const client = await draw();
    expect(screen.queryByLabelText("Hint after")).toBeNull();
    const more = screen.getByRole("button", { name: "More options" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const input = screen.getByLabelText("Hint after") as HTMLInputElement;
    expect(document.getElementById(more.getAttribute("aria-controls") ?? "")?.contains(input)).toBe(true);
    expect([input.min, input.max]).toEqual(["1", "5"]);
    fireEvent.change(input, { target: { value: "4" } });
    expect(client.settingsSets).toEqual([]);
    fireEvent.blur(input);
    await screen.findByRole("button", { name: "Back to the app's defaults" });
    expect(client.settingsSets).toEqual([{ field: "hintAfter", value: 4 }]);
  });

  it("an empty number goes back to the saved value; text saves on Enter; Escape drops a draft", async () => {
    const client = await draw();
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    const input = screen.getByLabelText("Hint after") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input.value).toBe("2");
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("2");
    fireEvent.blur(input);
    const name = screen.getByLabelText("What the app calls you") as HTMLInputElement;
    expect(name.maxLength).toBe(40);
    fireEvent.change(name, { target: { value: "Ana" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await screen.findByRole("button", { name: "Back to the app's defaults" });
    expect(client.settingsSets).toEqual([{ field: "nickname", value: "Ana" }]);
  });

  it("shows a refusal under its field, and a generic line when there is no message", async () => {
    const client = new FakeClient();
    client.settingsFailure = { ok: false, message: "Too big: expected number to be <=5" };
    await draw(client);
    fireEvent.click(screen.getByRole("button", { name: "Demanding" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Too big: expected number to be <=5");
    expect(descriptions(screen.getByRole("group", { name: "Tone" }))).toEqual(["Too big: expected number to be <=5"]);
    client.settingsFailure = { ok: false };
    const examples = screen.getByRole("switch", { name: "Show worked examples" });
    fireEvent.click(examples);
    expect((await screen.findByText("That didn't save. Try again.")).getAttribute("role")).toBe("alert");
    expect(examples.getAttribute("aria-invalid")).toBe("true");
    expect(descriptions(examples)).toEqual(["That didn't save. Try again."]);
  });

  it("a refusal goes when its field's saved value changes, and when Escape drops the draft", async () => {
    const client = new FakeClient();
    client.settingsFailure = { ok: false, message: "No" };
    await draw(client);
    fireEvent.click(screen.getByRole("button", { name: "Demanding" }));
    await screen.findByRole("alert");
    // Another field's change leaves it; this field's change (another window, a restore) clears it.
    act(() => client.emitSettings({ values: { ...defaults, level: "5" }, pending: [] }));
    expect(screen.getByRole("alert").textContent).toBe("No");
    act(() => client.emitSettings({ values: { ...defaults, level: "5", tone: "demanding" }, pending: [] }));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    const input = screen.getByLabelText("Hint after") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.blur(input);
    await screen.findByRole("alert");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("2");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Enter then blur saves a draft once", async () => {
    const client = new FakeClient();
    client.settingsFailure = { ok: false, message: "No" };
    await draw(client);
    const name = screen.getByLabelText("What the app calls you") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Ana" } });
    fireEvent.keyDown(name, { key: "Enter" });
    fireEvent.blur(name);
    await screen.findByRole("alert");
    expect(client.settingsSets).toEqual([{ field: "nickname", value: "Ana" }]);
    // A new draft is sent again.
    fireEvent.change(name, { target: { value: "Ann" } });
    fireEvent.blur(name);
    expect(client.settingsSets).toHaveLength(2);
  });

  it("while a task is open: the next-task line, and Pending on waiting fields", async () => {
    const client = new FakeClient();
    client.tasks = { current: { id: "t1", status: "waiting" }, actions: {}, notes: [] };
    await draw(client);
    expect(screen.getByRole("status").textContent).toBe("Changes apply from the next task.");
    act(() => client.emitSettings({ values: { ...defaults, tone: "demanding" }, pending: ["tone"] }));
    expect(screen.getByText("Pending")).toBeTruthy();
    expect(descriptions(screen.getByRole("group", { name: "Tone" }))).toEqual(["Pending"]);
    act(() => client.emitTasks({ current: null, actions: {}, notes: [] }));
    act(() => client.emitSettings({ values: { ...defaults, tone: "demanding" }, pending: [] }));
    // The live region stays mounted, so a screen reader hears the line when it comes back.
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.queryByText("Pending")).toBeNull();
    act(() => client.emitTasks({ current: { id: "t2", status: "waiting" }, actions: {}, notes: [] }));
    expect(screen.getByRole("status").textContent).toBe("Changes apply from the next task.");
  });

  it("offers the reset only when something differs from its default", async () => {
    const client = await draw();
    expect(screen.queryByRole("button", { name: "Back to the app's defaults" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Demanding" }));
    fireEvent.click(await screen.findByRole("button", { name: "Back to the app's defaults" }));
    await screen.findByRole("group", { name: "Tone" });
    expect(client.settingsResets).toBe(1);
    expect(screen.getByRole("button", { name: "Patient" }).getAttribute("aria-pressed")).toBe("true");
  });
});
