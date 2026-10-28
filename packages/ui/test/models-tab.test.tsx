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

describe("ModelsTab › Tasks", () => {
  it("lists every action in path order, then free questions, each on its recommended level", async () => {
    await renderIn("en", <Tab client={modelsClient()} />);
    expect(within(tasksRegion()).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["The manifest", "A turn", "Free question"]);
    expect(within(row("A turn")).getByRole("button", { name: "Deep" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(row("Free question")).getByRole("button", { name: "Light" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText(/Changed/)).toBeNull();
  });

  it("with material, lists each material stage after free questions and saves it by its reserved id", async () => {
    const c = modelsClient();
    c.state.material = { accepts: ["text"], items: false, grounding: { default: "mixed", personCanChange: true }, maxPages: 300 };
    c.state.models = { ...c.state.models!, recommended: { ...c.state.models!.recommended, "material-review": "standard", "material-repair": "light", "material-label": "light", "material-sheet": "light" } };
    await renderIn("en", <Tab client={c} />);
    expect(within(tasksRegion()).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual([
      "The manifest",
      "A turn",
      "Free question",
      "Material: checking the conversion",
      "Material: fixing structure",
      "Material: labelling",
      "Material: the summary sheet",
    ]);
    fireEvent.click(within(row("Material: labelling")).getByRole("button", { name: "Standard" }));
    await waitFor(() => expect(saved(c)).toEqual({ tasks: { "material-label": "standard" } }));
  });

  it("saves a changed level, marks it changed with the recommendation, and restores it", async () => {
    const c = modelsClient();
    await renderIn("en", <Tab client={c} />);
    fireEvent.click(within(row("The manifest")).getByRole("button", { name: "Deep" }));
    await screen.findByText("Changed · recommended: Standard");
    expect(saved(c)).toEqual({ tasks: { manifest: "deep" } });
    fireEvent.click(within(tasksRegion()).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(screen.queryByText(/Changed/)).toBeNull());
    expect(saved(c)).toEqual({});
  });

  it("makes a task custom from its level's settings, edits it and goes back to the recommendation", async () => {
    const c = modelsClient();
    await renderIn("en", <Tab client={c} />);
    fireEvent.click(within(row("A turn")).getByRole("button", { name: "Custom" }));
    await waitFor(() => expect(saved(c)).toEqual({ tasks: { turn: { custom: { engine: "claude", model: "opus", effort: "high", cap: 400_000 } } } }));
    expect(await screen.findByText(/opus · high effort · 400k cap/)).toBeTruthy();
    const tasks = within(tasksRegion());
    fireEvent.change(tasks.getByRole("combobox", { name: "Effort" }), { target: { value: "max" } });
    await waitFor(() => expect(saved(c)).toMatchObject({ tasks: { turn: { custom: { effort: "max" } } } }));
    fireEvent.change(tasks.getByRole("combobox", { name: "Context cap" }), { target: { value: "1000000" } });
    await waitFor(() => expect(saved(c)).toEqual({ tasks: { turn: { custom: { engine: "claude", model: "opus", effort: "max", cap: 1_000_000 } } } }));
    fireEvent.change(tasks.getByRole("combobox", { name: "Model" }), { target: { value: "" } });
    await waitFor(() => expect(saved(c)).toEqual({ tasks: { turn: { custom: { engine: "claude", effort: "max", cap: 1_000_000 } } } }));
    fireEvent.click(tasks.getByRole("button", { name: "Back to recommended (Deep)" }));
    await waitFor(() => expect(saved(c)).toEqual({}));
    expect(within(row("A turn")).getByRole("button", { name: "Deep" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows a saved custom task folded, with a toggle for its fields", async () => {
    await renderIn("en", <Tab client={modelsClient({ tasks: { manifest: { custom: { engine: "claude", model: "haiku", effort: "low", cap: 100_000 } } } })} />);
    expect(screen.getByText(/haiku · low effort · 100k cap/)).toBeTruthy();
    expect(within(tasksRegion()).queryByRole("combobox", { name: "Model" })).toBeNull();
    const adjust = screen.getByRole("button", { name: "Edit" });
    expect(adjust.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(adjust);
    expect((within(tasksRegion()).getByRole("combobox", { name: "Model" }) as HTMLSelectElement).value).toBe("haiku");
  });

  it("names the efforts and caps in its selects as the mockups do", async () => {
    await renderIn("en", <Tab client={modelsClient({ tasks: { turn: { custom: { engine: "claude", model: "opus", effort: "high", cap: 400_000 } } } })} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const tasks = within(tasksRegion());
    expect(within(tasks.getByRole("combobox", { name: "Effort" })).getAllByRole("option").map((o) => o.textContent)).toEqual(["Low", "Medium", "High", "Very high", "Max"]);
    expect(within(tasks.getByRole("combobox", { name: "Context cap" })).getAllByRole("option").map((o) => o.textContent)).toEqual(["100k", "200k", "400k", "1M"]);
  });

  it("says so when a change couldn't be saved, and shows what config.json holds", async () => {
    const c = modelsClient();
    c.saveConfig = () => Promise.reject(new Error("disk full"));
    await renderIn("en", <Tab client={c} />);
    fireEvent.click(within(row("The manifest")).getByRole("button", { name: "Deep" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't save. Try again.");
    expect(within(row("The manifest")).getByRole("button", { name: "Standard" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("an edited custom task runs on the current engine, even when it was saved for another", async () => {
    const c = modelsClient({ tasks: { turn: { custom: { engine: "codex", effort: "high", cap: 400_000 } } } });
    await renderIn("en", <Tab client={c} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(within(tasksRegion()).getByRole("combobox", { name: "Model" }), { target: { value: "sonnet" } });
    await waitFor(() => expect(saved(c)).toEqual({ tasks: { turn: { custom: { engine: "claude", model: "sonnet", effort: "high", cap: 400_000 } } } }));
  });

  it("always sends the whole models object, even for changes made before the last save came back", async () => {
    // config.json merges a save shallowly: a partial `models` would drop the other settings.
    const c = modelsClient({ tiers: { claude: { light: { model: "sonnet", effort: "low", cap: 100_000 } } } });
    const patches = recordPatches(c);
    await renderIn("en", <Tab client={c} />);
    fireEvent.click(within(row("The manifest")).getByRole("button", { name: "Deep" }));
    fireEvent.click(within(row("A turn")).getByRole("button", { name: "Light" }));
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
    await renderIn("en", <Tab client={c} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const tasks = within(tasksRegion());
    fireEvent.change(tasks.getByRole("combobox", { name: "Effort" }), { target: { value: "max" } });
    expect((tasks.getByRole("combobox", { name: "Effort" }) as HTMLSelectElement).value).toBe("max");
    fireEvent.change(tasks.getByRole("combobox", { name: "Context cap" }), { target: { value: "1000000" } });
    release();
    await waitFor(() => expect(saved(c)).toEqual({ tasks: { turn: { custom: { engine: "claude", model: "opus", effort: "max", cap: 1_000_000 } } } }));
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
  const card = (tier: string) => within(levels()).getByRole("region", { name: tier });
  const showLevels = () => fireEvent.click(within(screen.getByRole("group", { name: "Models" })).getByRole("button", { name: "Levels" }));

  it("switches between Tasks and Levels", async () => {
    await renderIn("en", <Tab client={modelsClient()} />);
    expect(screen.queryByRole("region", { name: "Levels" })).toBeNull();
    showLevels();
    expect(screen.queryByRole("region", { name: "Tasks" })).toBeNull();
    expect(within(screen.getByRole("group", { name: "Models" })).getByRole("button", { name: "Levels" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the current engine's three levels with the tasks that use each", async () => {
    await renderIn("en", <Tab client={modelsClient({ tasks: { manifest: "light" } })} />);
    showLevels();
    expect(within(levels()).getByRole("button", { name: "Claude" }).getAttribute("aria-pressed")).toBe("true");
    expect((within(card("Deep")).getByRole("combobox", { name: "Model" }) as HTMLSelectElement).value).toBe("opus");
    expect(within(card("Deep")).getByRole("list", { name: "Used by" }).textContent).toBe("A turn");
    expect(within(card("Light")).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["The manifest", "Free question"]);
    expect(within(card("Standard")).getByText("No task")).toBeTruthy();
  });

  it("saves a level's settings for the engine shown and restores the recommended tables", async () => {
    const c = modelsClient();
    await renderIn("en", <Tab client={c} />);
    showLevels();
    fireEvent.click(within(levels()).getByRole("button", { name: "Codex" }));
    expect((within(card("Deep")).getByRole("combobox", { name: "Model" }) as HTMLSelectElement).value).toBe("");
    expect(within(card("Deep")).getAllByRole("option").map((o) => o.textContent).slice(0, 1)).toEqual(["Engine default"]);
    fireEvent.change(within(card("Deep")).getByRole("combobox", { name: "Context cap" }), { target: { value: "1000000" } });
    await waitFor(() => expect(saved(c)).toEqual({ tiers: { codex: { deep: { effort: "high", cap: 1_000_000 } } } }));
    expect(within(levels()).getByText("If your plan doesn't include a model, the task uses the level below and tells you.")).toBeTruthy();
    fireEvent.click(within(levels()).getByRole("button", { name: "Restore recommended" }));
    await waitFor(() => expect(saved(c)).toEqual({}));
  });

  it("keeps the tasks' settings and the other engines' levels when it saves a level", async () => {
    const c = modelsClient({ tasks: { manifest: "deep" }, tiers: { codex: { light: { effort: "medium", cap: 100_000 } } } });
    const patches = recordPatches(c);
    await renderIn("en", <Tab client={c} />);
    showLevels();
    fireEvent.change(within(card("Light")).getByRole("combobox", { name: "Model" }), { target: { value: "sonnet" } });
    const whole = { tasks: { manifest: "deep" }, tiers: { codex: { light: { effort: "medium", cap: 100_000 } }, claude: { light: { model: "sonnet", effort: "low", cap: 100_000 } } } };
    await waitFor(() => expect(saved(c)).toEqual(whole));
    expect(patches).toEqual([{ models: whole }]);
  });
});
