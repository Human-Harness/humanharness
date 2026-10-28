// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SidekickView } from "../src/client";
import { SettingsSheet } from "../src/SettingsSheet";
import { SidekickList } from "../src/sidekick/SidekickList";
import { SidekickTab } from "../src/sidekick/SidekickTab";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";
import { SK_ON } from "./sidekick-fixtures";

afterEach(cleanup);
const LIST: SidekickView[] = [
  { id: "sidekick", name: "Sidekick", mark: "spark", personality: "", purposes: [{ id: "prompt-coach" }, { id: "focus" }], order: 0 },
  { id: "rulo", name: "Rulo", mark: "🦊", personality: "Direct.", purposes: [{ id: "mentor" }], order: 1, tier: "deep", defaultOn: false, source: { kind: "files", paths: ["/n/rulo.md"], hash: "a".repeat(64) } },
];

describe("Settings › Sidekicks (spec §8)", () => {
  it("lists them in order with their purposes; Move up reorders and focus stays on the moved row", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickList = structuredClone(LIST);
    await renderIn("en", <SidekickList client={c} />);
    const rows = await screen.findAllByRole("listitem");
    expect(rows.map((r) => r.querySelector("strong")?.textContent)).toEqual(["Sidekick", "Rulo"]);
    expect(rows[0]!.textContent).toContain("Prompt coach · Focus");
    expect(screen.queryByRole("button", { name: "Move Sidekick up" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Move Rulo up" }));
    // Generous waits (and test timeout): under the full suite's load the reorder, the reload and the focus can each take over a second.
    const slow = { timeout: 5_000 };
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["reorder", ["rulo", "sidekick"]]), slow);
    await waitFor(() => expect(screen.getAllByRole("listitem").map((r) => r.querySelector("strong")?.textContent)).toEqual(["Rulo", "Sidekick"]), slow);
    // Rulo is at the top now: its Move up is gone, so focus goes to its Move down.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Rulo down" })), slow);
  }, 20_000);

  it("New opens the editor; a custom purpose needs text and a moment", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickList = structuredClone(LIST);
    await renderIn("en", <SidekickList client={c} />);
    fireEvent.click(await screen.findByRole("button", { name: "New sidekick" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Name" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Docs" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Custom" }));
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "What it watches for" }), { target: { value: "Docs stay in sync." } });
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "After the reply" }));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() =>
      expect(c.sidekickCalls).toContainEqual(["saveSidekick", { name: "Docs", mark: "spark", personality: "", purposes: [{ id: "custom", text: "Docs stay in sync.", moments: ["after-reply"] }] }, undefined]),
    );
    // Saved: the editor closes, the list shows it, focus is back on New sidekick.
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "New sidekick" }));
  });

  it("the harness's places are moments of a custom purpose", async () => {
    const c = new FakeClient({ language: "en" });
    await renderIn("en", <SidekickList client={c} places={[{ id: "terminal", label: "Terminal" }]} />);
    fireEvent.click(await screen.findByRole("button", { name: "New sidekick" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Watch" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Custom" }));
    fireEvent.change(screen.getByRole("textbox", { name: "What it watches for" }), { target: { value: "Errors." } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Terminal" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["saveSidekick", expect.objectContaining({ purposes: [{ id: "custom", text: "Errors.", moments: ["place:terminal"] }] }), undefined]));
  });

  it("Edit sends the full definition: source, tier and defaultOn are kept", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickList = structuredClone(LIST);
    await renderIn("en", <SidekickList client={c} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Rulo" }));
    const name = screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement;
    expect(name.value).toBe("Rulo");
    fireEvent.click(screen.getByRole("checkbox", { name: "Focus" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(c.sidekickCalls).toContainEqual([
        "saveSidekick",
        { id: "rulo", name: "Rulo", mark: "🦊", personality: "Direct.", purposes: [{ id: "focus" }, { id: "mentor" }], tier: "deep", defaultOn: false, source: LIST[1]!.source },
        undefined,
      ]),
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Rulo" })));
  });

  it("Cancel closes the editor and gives focus back to Edit", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickList = structuredClone(LIST);
    await renderIn("en", <SidekickList client={c} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Sidekick" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Sidekick" }));
    expect(c.sidekickCalls.filter((x) => x[0] === "saveSidekick")).toEqual([]);
  });

  it("a failed save says why and keeps the editor open", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickSaveFails = "At most 20 sidekicks";
    await renderIn("en", <SidekickList client={c} />);
    fireEvent.click(await screen.findByRole("button", { name: "New sidekick" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Docs" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Mentor" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toContain("At most 20 sidekicks");
    expect(screen.getByRole("textbox", { name: "Name" })).toBeTruthy();
  });

  it("an imported one whose original changed shows the banner", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickList = structuredClone(LIST);
    c.sidekickOriginal = "changed";
    await renderIn("en", <SidekickList client={c} />);
    expect(await screen.findByText("The original changed")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Bring the changes" })).toHaveLength(1);
    // Only the file-imported one is checked.
    expect(c.sidekickCalls.filter((x) => x[0] === "checkOriginal")).toEqual([["checkOriginal", "rulo"]]);
  });

  it("Remove asks first, focus on the answer; the list reads again", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickList = structuredClone(LIST);
    await renderIn("en", <SidekickList client={c} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Rulo" }));
    expect(screen.getByText("Remove Rulo? What it learned stays until you forget it.")).toBeTruthy();
    const yes = screen.getByRole("button", { name: "Yes, remove it" });
    expect(document.activeElement).toBe(yes);
    expect(c.sidekickCalls).not.toContainEqual(["remove", "rulo"]);
    fireEvent.click(yes);
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["remove", "rulo"]));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });

  it("a refused remove shows the store's message", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickList = structuredClone(LIST);
    await renderIn("en", <SidekickList client={c} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Rulo" }));
    // Another window removed the default meanwhile: Rulo is the last one, and the store keeps it.
    c.sidekickList = c.sidekickList.filter((k) => k.id === "rulo");
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove it" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Keep at least one sidekick");
  });

  it("Remove asks; the last one has no Remove", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickList = [LIST[0]!];
    await renderIn("en", <SidekickList client={c} />);
    await screen.findByText("Sidekick");
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });

  it("a daily-summary sidekick off by default says it never gives the daily summary", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickList = [LIST[0]!, { id: "day", name: "Day", mark: "☀️", personality: "", purposes: [{ id: "daily-summary" }], order: 1, defaultOn: false }];
    await renderIn("en", <SidekickList client={c} />);
    expect(await screen.findByText("Off by default, so it never gives the daily summary.")).toBeTruthy();
  });

  it("Import opens the import; an adopted preset shows up in the list", async () => {
    const c = new FakeClient({ language: "en" });
    await renderIn("en", <SidekickList client={c} />);
    fireEvent.click(await screen.findByRole("button", { name: "Import", expanded: false }));
    expect(screen.getByRole("textbox", { name: "Paste instructions" })).toBeTruthy();
    c.sidekickList = [...c.sidekickList, { id: "guard", name: "Guard", mark: "🛡️", personality: "", purposes: [{ id: "process-guard" }], order: 1, preset: "Guard" }];
    c.emitSidekick(SK_ON);
    expect(await screen.findByText("Guard")).toBeTruthy();
  });
});

describe("Settings › Sidekicks: guards", () => {
  it("a double click on Save, Move or Yes writes once", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickList = structuredClone(LIST);
    await renderIn("en", <SidekickList client={c} />);
    const up = await screen.findByRole("button", { name: "Move Rulo up" });
    fireEvent.click(up);
    fireEvent.click(up);
    await waitFor(() => expect(screen.getAllByRole("listitem").map((r) => r.querySelector("strong")?.textContent)).toEqual(["Rulo", "Sidekick"]));
    expect(c.sidekickCalls.filter((x) => x[0] === "reorder")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove Rulo" }));
    const yes = screen.getByRole("button", { name: "Yes, remove it" });
    fireEvent.click(yes);
    fireEvent.click(yes);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(c.sidekickCalls.filter((x) => x[0] === "remove")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "New sidekick" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Docs" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Mentor" }));
    const save = screen.getByRole("button", { name: "Save" });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(c.sidekickCalls.filter((x) => x[0] === "saveSidekick")).toHaveLength(1);
  });

  it("a failed read of the list says so instead of an empty list", async () => {
    const c = new FakeClient({ language: "en" });
    vi.spyOn(c.sidekick, "list").mockRejectedValue(new Error("down"));
    await renderIn("en", <SidekickList client={c} />);
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't read your sidekicks. Close Settings and open it again.");
    cleanup();
    // Main answers an empty list when its read failed: there is always at least the default.
    const d = new FakeClient({ language: "en" });
    d.sidekickList = [];
    await renderIn("en", <SidekickList client={d} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("Save counts what it sends: a gone place isn't a moment, more than 6 purposes says why", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickList = [{ id: "docs", name: "Docs", mark: "spark", personality: "", purposes: [{ id: "custom", text: "Docs in sync.", moments: ["place:gone"] }], order: 0 }];
    await renderIn("en", <SidekickList client={c} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Docs" }));
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Daily" }));
    expect(save.disabled).toBe(false);
    cleanup();
    const d = new FakeClient({ language: "en" });
    const all = [{ id: "prompt-coach" }, { id: "focus" }, { id: "process-guard" }, { id: "mentor" }, { id: "daily-summary" }];
    d.sidekickList = [
      { id: "big", name: "Big", mark: "spark", personality: "", order: 0, purposes: [...all, { id: "custom", text: "A", moments: ["daily"] }, { id: "custom", text: "B", moments: ["daily"] }] },
    ];
    await renderIn("en", <SidekickList client={d} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Big" }));
    const big = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(big.disabled).toBe(true);
    expect(screen.getByText("Choose at most 6 purposes to save.")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Focus" }));
    expect(big.disabled).toBe(false);
    expect(screen.queryByText("Choose at most 6 purposes to save.")).toBeNull();
  });
});

describe("Settings › Sidekicks in the tab", () => {
  it("the presets stay offered while one is not adopted, even after they were offered once", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickState = { ...SK_ON, settings: { ...SK_ON.settings, presetsOffered: true } };
    c.sidekickPresets = [{ name: "Guard", mark: "🛡️", personality: "Calm.", purposes: [{ id: "process-guard" }], adopted: false }];
    await renderIn("en", <SidekickTab client={c} onModels={() => undefined} />);
    expect(await screen.findByRole("button", { name: "Add Guard" })).toBeTruthy();
    expect(await screen.findByRole("region", { name: "Sidekicks" })).toBeTruthy();
  });

  it("the Settings tab reads Sidekicks with two or more; its id is unchanged", async () => {
    const c = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" });
    c.sidekickState = { ...SK_ON, sidekicks: [{ id: "sidekick", name: "Sidekick", mark: "spark" }] };
    const state = { ...c.state, sidekick: SK_ON.info };
    await renderIn("en", <SettingsSheet client={c} state={state} tab="sidekick" onTab={() => undefined} onChange={() => undefined} onClose={() => undefined} onSetup={() => undefined} />);
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByRole("tab", { name: "Sidekick" })).toBeTruthy();
    c.emitSidekick({ ...SK_ON, sidekicks: [{ id: "sidekick", name: "Sidekick", mark: "spark" }, { id: "rulo", name: "Rulo", mark: "🦊" }] });
    expect(await within(dialog).findByRole("tab", { name: "Sidekicks" })).toBeTruthy();
  });
});
