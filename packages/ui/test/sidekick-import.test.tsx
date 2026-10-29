// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SidekickImportFailure } from "../src/client";
import { ImportSidekick } from "../src/sidekick/ImportSidekick";
import { FAKE_PICK_TOKEN, FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);
const DRAFT = {
  ok: true as const,
  draft: { name: "Rulo", mark: "🦊", personality: "Direct.", purposes: [{ id: "mentor" }], source: { kind: "paste" as const } },
  learned: [{ text: "Prefers short answers.", level: "you" as const }],
  skipped: ["Tool permissions"],
};
const FILES = { kind: "files" as const, paths: ["/n/rulo.md"], hash: "a".repeat(64) };
const ENGINE = "These files belong to an engine's settings. Copy or paste their content instead.";

describe("Import (spec §2a.6)", () => {
  it("paste → preview with what was skipped; Save needs the copy acknowledgement and passes the source", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickImport = DRAFT;
    const onSaved = vi.fn();
    await renderIn("en", <ImportSidekick client={c} onSaved={onSaved} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Paste instructions" }), { target: { value: "You are Rulo." } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Rulo")).toBeTruthy();
    expect(c.sidekickCalls).toContainEqual(["importDraft", { kind: "paste", text: "You are Rulo." }]);
    expect(screen.getByText("Mentor")).toBeTruthy();
    expect(screen.getByText("Not imported: Tool permissions")).toBeTruthy();
    expect(screen.getByText("What they learned about you")).toBeTruthy();
    expect(screen.getByText("It's a copy: changes to the original won't reach it.")).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "I understand it's a copy" }));
    fireEvent.click(save);
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["saveSidekick", expect.objectContaining({ name: "Rulo", source: { kind: "paste" } }), [{ text: "Prefers short answers.", level: "you" }]]));
    expect(onSaved).toHaveBeenCalled();
  });

  it("an engine-settings file is refused with the message to copy or paste instead", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickPicked = ["CLAUDE.md"];
    c.sidekickImport = { ok: false, reason: "engine-settings" };
    await renderIn("en", <ImportSidekick client={c} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose files" }));
    expect((await screen.findByRole("alert")).textContent).toBe(ENGINE);
    // Only the pick's token goes back to main, never a path.
    expect(c.sidekickCalls).toContainEqual(["importDraft", { kind: "files", token: FAKE_PICK_TOKEN }]);
  });

  it("a cancelled picker imports nothing", async () => {
    const c = new FakeClient({ language: "en" });
    await renderIn("en", <ImportSidekick client={c} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose files" }));
    await waitFor(() => expect(c.sidekickCalls).toEqual([["pickFiles"]]));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("every failure reason has its own message in an alert", async () => {
    const reasons: SidekickImportFailure[] = ["engine-settings", "too-many", "too-big", "type", "unreadable", "empty", "unavailable", "failed", "cancelled", "expired"];
    const seen = new Set<string>();
    for (const reason of reasons) {
      const c = new FakeClient({ language: "en" });
      c.sidekickImport = { ok: false, reason, ...(reason === "type" || reason === "unreadable" || reason === "too-big" ? { file: "notes.pdf" } : {}) };
      await renderIn("en", <ImportSidekick client={c} onSaved={() => {}} />);
      fireEvent.change(screen.getByRole("textbox", { name: "Paste instructions" }), { target: { value: "x" } });
      fireEvent.click(screen.getByRole("button", { name: "Import" }));
      const text = (await screen.findByRole("alert")).textContent ?? "";
      expect(text).not.toContain("sidekick.");
      expect(text).not.toContain("{{");
      seen.add(text);
      cleanup();
    }
    expect(seen.size).toBe(reasons.length);
  });

  it("too big: names the file, or the pasted text when there is no file", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickImport = { ok: false, reason: "too-big", file: "big.md" };
    await renderIn("en", <ImportSidekick client={c} onSaved={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Paste instructions" }), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect((await screen.findByRole("alert")).textContent).toBe("big.md is larger than 64 KB.");
    c.sidekickImport = { ok: false, reason: "too-big" };
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The pasted text is larger than 64 KB."));
  });

  it("the draft is shown as plain text, never as markup", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickImport = { ...DRAFT, draft: { ...DRAFT.draft, name: "<b>Bold</b>", personality: "<img src=x onerror=alert(1)>", purposes: [{ id: "custom", text: "<i>Watch</i>", moments: ["after-reply"] }] } };
    const { container } = await renderIn("en", <ImportSidekick client={c} onSaved={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Paste instructions" }), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("<b>Bold</b>")).toBeTruthy();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(screen.getByText("Custom: <i>Watch</i>")).toBeTruthy();
    expect(container.querySelector("b, img, i")).toBeNull();
  });

  it("focus moves into the preview, and back to the button that opened it on Cancel", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickImport = DRAFT;
    const onCancel = vi.fn();
    await renderIn("en", <ImportSidekick client={c} onSaved={() => {}} onCancel={onCancel} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Paste instructions" }), { target: { value: "x" } });
    const run = screen.getByRole("button", { name: "Import" });
    run.focus();
    fireEvent.click(run);
    const head = await screen.findByRole("heading", { name: "Rulo" });
    await waitFor(() => expect(document.activeElement).toBe(head));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Import" })));
    expect(screen.queryByText("Rulo")).toBeNull();
    expect(onCancel).toHaveBeenCalled();
  });

  it("a double click on Save saves once (a second save would make a second sidekick)", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickImport = DRAFT;
    let finish = () => {};
    const saveSidekick = c.sidekick.saveSidekick;
    c.sidekick.saveSidekick = async (...args) => {
      await new Promise<void>((r) => (finish = r));
      return saveSidekick(...args);
    };
    const onSaved = vi.fn();
    await renderIn("en", <ImportSidekick client={c} onSaved={onSaved} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Paste instructions" }), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "I understand it's a copy" }));
    const save = screen.getByRole("button", { name: "Save" });
    save.focus();
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(save.getAttribute("aria-disabled")).toBe("true"));
    fireEvent.click(save);
    expect(document.activeElement).toBe(save);
    finish();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(c.sidekickCalls.filter((call) => call[0] === "saveSidekick")).toHaveLength(1);
  });

  it("a new run clears the old preview: its draft can't be saved while the next one works", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickImport = DRAFT;
    await renderIn("en", <ImportSidekick client={c} onSaved={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Paste instructions" }), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("button", { name: "Save" })).toBeTruthy();
    c.sidekick.importDraft = () => new Promise(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByText("Rulo")).toBeNull();
  });

  it("a failed save shows an alert and keeps the preview", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickImport = DRAFT;
    c.sidekickSaveFails = "disk full";
    const onSaved = vi.fn();
    await renderIn("en", <ImportSidekick client={c} onSaved={onSaved} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Paste instructions" }), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "I understand it's a copy" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not save Rulo. Try again.");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByText("Rulo")).toBeTruthy();
  });
});

describe("The original changed (spec §2a.6)", () => {
  const original = { id: "rulo", tier: "light" as const, defaultOn: false };

  it("changed → 'The original changed · Bring the changes' re-imports the files; Save keeps the id and the rest of the def", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickOriginal = "changed";
    const NEW_SOURCE = { ...FILES, hash: "b".repeat(64) };
    c.sidekickImport = { ...DRAFT, draft: { ...DRAFT.draft, personality: "Blunt.", source: NEW_SOURCE } };
    const onSaved = vi.fn();
    await renderIn("en", <ImportSidekick client={c} onSaved={onSaved} original={original} />);
    expect(await screen.findByText("The original changed")).toBeTruthy();
    expect(c.sidekickCalls).toContainEqual(["checkOriginal", "rulo"]);
    // Re-import mode: no paste box or picker.
    expect(screen.queryByRole("textbox", { name: "Paste instructions" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bring the changes" }));
    expect(await screen.findByText("Blunt.")).toBeTruthy();
    expect(c.sidekickCalls).toContainEqual(["importDraft", { kind: "original", sidekickId: "rulo" }]);
    fireEvent.click(screen.getByRole("checkbox", { name: "I understand it's a copy" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(c.sidekickCalls).toContainEqual([
      "saveSidekick",
      { id: "rulo", tier: "light", defaultOn: false, name: "Rulo", mark: "🦊", personality: "Blunt.", purposes: [{ id: "mentor" }], source: NEW_SOURCE },
      [{ text: "Prefers short answers.", level: "you" }],
    ]);
  });

  it("unchanged, gone or not from files → nothing shown", async () => {
    for (const answer of ["unchanged", "gone", "none"] as const) {
      const c = new FakeClient({ language: "en" });
      c.sidekickOriginal = answer;
      const { container } = await renderIn("en", <ImportSidekick client={c} onSaved={() => {}} original={original} />);
      await waitFor(() => expect(c.sidekickCalls).toContainEqual(["checkOriginal", "rulo"]));
      expect(container.textContent).toBe("");
      cleanup();
    }
  });
});
