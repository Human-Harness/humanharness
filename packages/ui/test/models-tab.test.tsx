// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { MATERIAL_STAGE_KEYS } from "@humanharness/harness-sdk";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig, AppState } from "../src/client";
import { MATERIAL_ROWS, ModelsTab, taskRows } from "../src/ModelsTab";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

function modelsClient(models?: AppConfig["models"]) {
  const c = new FakeClient({ ...ready, ...(models ? { models } : {}) });
  c.state.actions = {
    manifest: { label: "The manifest", cost: "medium", tier: "standard" },
    turn: { label: "A turn", cost: "medium", tier: "deep" },
  };
  c.state.path = ["manifest", "turn"];
  c.state.engines.push({ ...c.state.engines[0], id: "codex", name: "Codex", reportsLimits: false });
  c.state.models = {
    recommended: { manifest: "standard", turn: "deep", questions: "light" },
    defaults: {
      claude: { light: { model: "haiku", effort: "low", cap: 100_000 }, standard: { model: "sonnet", effort: "medium", cap: 200_000 }, deep: { model: "opus", effort: "high", cap: 400_000 } },
      codex: { light: { effort: "low", cap: 100_000 }, standard: { effort: "medium", cap: 200_000 }, deep: { effort: "high", cap: 400_000 } },
    },
    offered: {
      claude: { models: [{ id: "haiku" }, { id: "sonnet" }, { id: "opus" }], efforts: ["low", "medium", "high", "xhigh", "max"] },
      codex: { models: [], efforts: ["low", "medium", "high"] },
    },
    pinnedTokens: 3000,
  };
  return c;
}

/** Records every patch sent to saveConfig. */
function recordPatches(c: FakeClient): AppConfig[] {
  const patches: AppConfig[] = [];
  const save = c.saveConfig.bind(c);
  c.saveConfig = (patch: AppConfig) => {
    patches.push(patch);
    return save(patch);
  };
  return patches;
}

function Tab({ client }: { client: FakeClient }) {
  const [state, setState] = useState<AppState>(client.state);
  return <ModelsTab client={client} state={state} onChange={setState} />;
}

const tasksRegion = () => screen.getByRole("region", { name: "Tasks" });
const row = (name: string) => within(tasksRegion()).getByRole("group", { name });
const saved = (c: FakeClient) => c.state.config.models;
/** A level in a task's control (a Radix segmented control: radios). */
const level = (scope: HTMLElement, name: string) => within(scope).getByRole("radio", { name });
const on = (el: HTMLElement) => el.getAttribute("aria-checked");
/** Picks `name` in a Radix select: open it, then choose the option (both by keyboard, as happy-dom has no pointer). */
async function pick(combo: HTMLElement, name: string) {
  fireEvent.keyDown(combo, { key: "Enter" });
  fireEvent.keyDown(await screen.findByRole("option", { name }), { key: "Enter" });
}
/** A Radix select's options, read with the list open, then closed again. */
async function optionsOf(combo: HTMLElement) {
  fireEvent.keyDown(combo, { key: "Enter" });
  const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  return names;
}

describe("ModelsTab › Tasks", () => {
  it("lists every action in path order, then free questions, each on its recommended level", async () => {
    await renderIn("en", <Tab client={modelsClient()} />, { theme: true });
    expect(within(tasksRegion()).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["The manifest", "A turn", "Free question"]);
    expect(on(level(row("A turn"), "Deep"))).toBe("true");
    expect(on(level(row("Free question"), "Light"))).toBe("true");
    expect(screen.queryByText(/Changed/)).toBeNull();
  });

  it("with material, lists each material stage after free questions and saves it by its reserved id", async () => {
    const c = modelsClient();
    c.state.material = { accepts: ["text"], items: false, grounding: { default: "mixed", personCanChange: true }, maxPages: 300 };
    c.state.models = { ...c.state.models!, recommended: { ...c.state.models!.recommended, "material-review": "standard", "material-repair": "light", "material-label": "light", "material-sheet": "light" } };
    await renderIn("en", <Tab client={c} />, { theme: true });
    expect(within(tasksRegion()).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual([
      "The manifest",
      "A turn",
      "Free question",
      "Material: checking the conversion",
      "Material: fixing structure",
      "Material: labelling",
      "Material: the summary sheet",
    ]);
    fireEvent.click(level(row("Material: labelling"), "Standard"));
    await waitFor(() => expect(saved(c)).toEqual({ tasks: { "material-label": "standard" } }));
  });

  it("saves a changed level, marks it changed with the recommendation, and restores it", async () => {
    const c = modelsClient();
    await renderIn("en", <Tab client={c} />, { theme: true });
    fireEvent.click(level(row("The manifest"), "Deep"));
    await screen.findByText("Changed · recommended: Standard");
    expect(saved(c)).toEqual({ tasks: { manifest: "deep" } });
    fireEvent.click(within(tasksRegion()).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(screen.queryByText(/Changed/)).toBeNull());
    expect(saved(c)).toEqual({});
  });

  it("shows Changed · recommended with Restore under a changed task", async () => {
    await renderIn("en", <Tab client={modelsClient({ tasks: { manifest: "deep" } })} />, { theme: true });
    expect(within(row("The manifest")).getByText("Changed · recommended: Standard")).toBeTruthy();
    expect(within(row("The manifest")).getByRole("button", { name: "Restore" })).toBeTruthy();
  });

  it("makes a task custom from its level's settings, edits it and goes back to the recommendation", async () => {
    const c = modelsClient();
    await renderIn("en", <Tab client={c} />, { theme: true });
    fireEvent.click(level(row("A turn"), "Custom"));
    await waitFor(() => expect(saved(c)).toEqual({ tasks: { turn: { custom: { engine: "claude", model: "opus", effort: "high", cap: 400_000 } } } }));
    expect(await screen.findByText(/opus · high effort · 400k cap/)).toBeTruthy();
    const tasks = within(tasksRegion());
    await pick(tasks.getByRole("combobox", { name: "Effort" }), "Max");
    await waitFor(() => expect(saved(c)).toMatchObject({ tasks: { turn: { custom: { effort: "max" } } } }));
    await pick(tasks.getByRole("combobox", { name: "Context cap" }), "1M");
    await waitFor(() => expect(saved(c)).toEqual({ tasks: { turn: { custom: { engine: "claude", model: "opus", effort: "max", cap: 1_000_000 } } } }));
    await pick(tasks.getByRole("combobox", { name: "Model" }), "Engine default");
    await waitFor(() => expect(saved(c)).toEqual({ tasks: { turn: { custom: { engine: "claude", effort: "max", cap: 1_000_000 } } } }));
    fireEvent.click(tasks.getByRole("button", { name: "Back to recommended (Deep)" }));
    await waitFor(() => expect(saved(c)).toEqual({}));
    expect(on(level(row("A turn"), "Deep"))).toBe("true");
  });

  it("shows a saved custom task folded, with a toggle for its fields", async () => {
    await renderIn("en", <Tab client={modelsClient({ tasks: { manifest: { custom: { engine: "claude", model: "haiku", effort: "low", cap: 100_000 } } } })} />, { theme: true });
    expect(screen.getByText(/haiku · low effort · 100k cap/)).toBeTruthy();
    expect(within(tasksRegion()).queryByRole("combobox", { name: "Model" })).toBeNull();
    const adjust = screen.getByRole("button", { name: "Edit" });
    expect(adjust.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(adjust);
    expect(within(tasksRegion()).getByRole("combobox", { name: "Model" }).textContent).toBe("haiku");
  });

  it("names the efforts and caps in its selects as the mockups do", async () => {
    await renderIn("en", <Tab client={modelsClient({ tasks: { turn: { custom: { engine: "claude", model: "opus", effort: "high", cap: 400_000 } } } })} />, { theme: true });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const tasks = within(tasksRegion());
    expect(await optionsOf(tasks.getByRole("combobox", { name: "Effort" }))).toEqual(["Low", "Medium", "High", "Very high", "Max"]);
    expect(await optionsOf(tasks.getByRole("combobox", { name: "Context cap" }))).toEqual(["100k", "200k", "400k", "1M"]);
  });

  it("says so when a change couldn't be saved, and shows what config.json holds", async () => {
    const c = modelsClient();
    c.saveConfig = () => Promise.reject(new Error("disk full"));
    await renderIn("en", <Tab client={c} />, { theme: true });
    fireEvent.click(level(row("The manifest"), "Deep"));
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't save. Try again.");
    expect(on(level(row("The manifest"), "Standard"))).toBe("true");
  });

  it("an edited custom task runs on the current engine, even when it was saved for another", async () => {
    const c = modelsClient({ tasks: { turn: { custom: { engine: "codex", effort: "high", cap: 400_000 } } } });
    await renderIn("en", <Tab client={c} />, { theme: true });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await pick(within(tasksRegion()).getByRole("combobox", { name: "Model" }), "sonnet");
    await waitFor(() => expect(saved(c)).toEqual({ tasks: { turn: { custom: { engine: "claude", model: "sonnet", effort: "high", cap: 400_000 } } } }));
  });

  it("always sends the whole models object, even for changes made before the last save came back", async () => {
    // config.json merges a save shallowly: a partial `models` would drop the other settings.
    const c = modelsClient({ tiers: { claude: { light: { model: "sonnet", effort: "low", cap: 100_000 } } } });
    const patches = recordPatches(c);
    await renderIn("en", <Tab client={c} />, { theme: true });
    fireEvent.click(level(row("The manifest"), "Deep"));
    fireEvent.click(level(row("A turn"), "Light"));
    const whole = { tasks: { manifest: "deep", turn: "light" }, tiers: { claude: { light: { model: "sonnet", effort: "low", cap: 100_000 } } } };
    await waitFor(() => expect(saved(c)).toEqual(whole));
    expect(patches.every((p) => Object.keys(p).join() === "models")).toBe(true);
    expect(patches[patches.length - 1]).toEqual({ models: whole });
  });

  it("a second field edited before the first save came back keeps the first edit", async () => {
    const c = modelsClient({ tasks: { turn: { custom: { engine: "claude", model: "opus", effort: "high", cap: 400_000 } } } });
    const save = c.saveConfig.bind(c);
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    c.saveConfig = async (patch: AppConfig) => {
      await gate;
      return save(patch);
    };
    await renderIn("en", <Tab client={c} />, { theme: true });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const tasks = within(tasksRegion());
    await pick(tasks.getByRole("combobox", { name: "Effort" }), "Max");
    expect(tasks.getByRole("combobox", { name: "Effort" }).textContent).toBe("Max");
    await pick(tasks.getByRole("combobox", { name: "Context cap" }), "1M");
    release();
    await waitFor(() => expect(saved(c)).toEqual({ tasks: { turn: { custom: { engine: "claude", model: "opus", effort: "max", cap: 1_000_000 } } } }));
  });

  it("sets the pinned files budget; the harness's suggestion drops the key (context-panel spec §4.2)", async () => {
    const c = modelsClient({ tasks: { manifest: "deep" } });
    await renderIn("en", <Tab client={c} />, { theme: true });
    const select = screen.getByRole("combobox", { name: "Pinned files budget", description: /every new task gets whole/ });
    expect(select.textContent).toBe("3,000 tokens (suggested)");
    expect(await optionsOf(select)).toEqual(["1,000 tokens", "3,000 tokens (suggested)", "6,000 tokens", "12,000 tokens"]);
    await pick(select, "6,000 tokens");
    await waitFor(() => expect(saved(c)).toEqual({ tasks: { manifest: "deep" }, pinnedTokens: 6000 }));
    await pick(select, "3,000 tokens (suggested)");
    await waitFor(() => expect(saved(c)).toEqual({ tasks: { manifest: "deep" } }));
  });

  it("offers the harness's suggested budget and a saved one even when they are not in the list", async () => {
    const c = modelsClient({ pinnedTokens: 2000 });
    c.state.models = { ...c.state.models!, pinnedTokens: 4500 };
    await renderIn("en", <Tab client={c} />, { theme: true });
    const select = screen.getByRole("combobox", { name: "Pinned files budget" });
    expect(select.textContent).toBe("2,000 tokens");
    expect(await optionsOf(select)).toEqual(["1,000 tokens", "2,000 tokens", "3,000 tokens", "4,500 tokens (suggested)", "6,000 tokens", "12,000 tokens"]);
  });
});

describe("taskRows", () => {
  it("the material rows are the SDK's stage keys, in order", () => {
    expect([...MATERIAL_ROWS]).toEqual([...MATERIAL_STAGE_KEYS]);
  });

  it("material stages are rows only when the harness takes material (D0)", () => {
    const base = { actions: { study: { label: "Study" } } } as unknown as AppState;
    const q = { key: "questions", label: "Questions" };
    expect(taskRows(base, q).map((r) => r.key)).toEqual(["study", "questions"]);
    const withMaterial = { ...base, material: { accepts: [], items: true, grounding: { default: "mixed", personCanChange: true }, maxPages: 300 } } as AppState;
    const labels = { "material-review": "Material: checking", "material-repair": "Material: fixing", "material-label": "Material: labelling", "material-sheet": "Material: summary sheet", "material-link": "Material: linking" };
    // Without labels (Settings › Usage) the stages are no rows: material usage is one total there.
    expect(taskRows(withMaterial, q).map((r) => r.key)).toEqual(["study", "questions"]);
    const rows = taskRows(withMaterial, q, labels);
    expect(rows.map((r) => r.key)).toEqual(["study", "questions", "material-review", "material-repair", "material-label", "material-sheet", "material-link"]);
    expect(rows[2].label).toBe("Material: checking");
    const noItems = { ...withMaterial, material: { ...withMaterial.material!, items: false } } as AppState;
    expect(taskRows(noItems, q, labels).map((r) => r.key)).not.toContain("material-link");
  });
});

describe("ModelsTab › Levels", () => {
  const levels = () => screen.getByRole("region", { name: "Levels" });
  const card = (tier: string) => within(levels()).getByRole("group", { name: tier });
  const showLevels = () => fireEvent.click(within(screen.getByRole("radiogroup", { name: "Models" })).getByRole("radio", { name: "Levels" }));

  it("switches between Tasks and Levels", async () => {
    await renderIn("en", <Tab client={modelsClient()} />, { theme: true });
    expect(screen.queryByRole("region", { name: "Levels" })).toBeNull();
    showLevels();
    expect(screen.queryByRole("region", { name: "Tasks" })).toBeNull();
    expect(on(within(screen.getByRole("radiogroup", { name: "Models" })).getByRole("radio", { name: "Levels" }))).toBe("true");
  });

  it("shows the current engine's three levels with the tasks that use each", async () => {
    await renderIn("en", <Tab client={modelsClient({ tasks: { manifest: "light" } })} />, { theme: true });
    showLevels();
    expect(on(within(levels()).getByRole("radio", { name: "Claude" }))).toBe("true");
    expect(within(card("Deep")).getByRole("combobox", { name: "Model" }).textContent).toBe("opus");
    expect(within(card("Deep")).getByRole("list", { name: "Used by" }).textContent).toBe("A turn");
    expect(within(card("Light")).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["The manifest", "Free question"]);
    expect(within(card("Standard")).getByText("No task")).toBeTruthy();
  });

  it("saves a level's settings for the engine shown and restores the recommended tables", async () => {
    const c = modelsClient();
    await renderIn("en", <Tab client={c} />, { theme: true });
    showLevels();
    fireEvent.click(within(levels()).getByRole("radio", { name: "Codex" }));
    expect(within(card("Deep")).getByRole("combobox", { name: "Model" }).textContent).toBe("Engine default");
    expect(await optionsOf(within(card("Deep")).getByRole("combobox", { name: "Model" }))).toEqual(["Engine default"]);
    await pick(within(card("Deep")).getByRole("combobox", { name: "Context cap" }), "1M");
    await waitFor(() => expect(saved(c)).toEqual({ tiers: { codex: { deep: { effort: "high", cap: 1_000_000 } } } }));
    expect(within(levels()).getByText("If your plan doesn't include a model, the task uses the level below and tells you.")).toBeTruthy();
    fireEvent.click(within(levels()).getByRole("button", { name: "Restore recommended" }));
    await waitFor(() => expect(saved(c)).toEqual({}));
  });

  it("keeps the tasks' settings and the other engines' levels when it saves a level", async () => {
    const c = modelsClient({ tasks: { manifest: "deep" }, tiers: { codex: { light: { effort: "medium", cap: 100_000 } } } });
    const patches = recordPatches(c);
    await renderIn("en", <Tab client={c} />, { theme: true });
    showLevels();
    await pick(within(card("Light")).getByRole("combobox", { name: "Model" }), "sonnet");
    const whole = { tasks: { manifest: "deep" }, tiers: { codex: { light: { effort: "medium", cap: 100_000 } }, claude: { light: { model: "sonnet", effort: "low", cap: 100_000 } } } };
    await waitFor(() => expect(saved(c)).toEqual(whole));
    expect(patches).toEqual([{ models: whole }]);
  });
});

describe("Sidekick row (sidekick spec §5)", () => {
  it("comes last, only when given", () => {
    const state = { actions: { a: { label: "A" } }, path: [] } as never;
    const q = { key: "questions", label: "Questions" };
    expect(taskRows(state, q).map((r) => r.key)).toEqual(["a", "questions"]);
    expect(taskRows(state, q, undefined, { key: "sidekick", label: "Sidekick" }).map((r) => r.key)).toEqual(["a", "questions", "sidekick"]);
  });

  it("is listed in Tasks only while main sends Sidekick (D0)", async () => {
    const c = modelsClient();
    const first = await renderIn("en", <Tab client={c} />, { theme: true });
    expect(within(tasksRegion()).queryByRole("group", { name: "Sidekick" })).toBeNull();
    first.unmount();
    c.state.sidekick = { id: "sidekick", name: "Sidekick", mark: "coach" };
    await renderIn("en", <Tab client={c} />, { theme: true });
    expect(within(tasksRegion()).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["The manifest", "A turn", "Free question", "Sidekick"]);
    expect(screen.getByText("Reviews your prompts before they go out")).toBeTruthy();
  });
});
