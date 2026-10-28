// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScopeSidekicks } from "../src/sidekick/ScopeSidekicks";
import { SidekickTab } from "../src/sidekick/SidekickTab";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";
import { SK_ON } from "./sidekick-fixtures";

afterEach(cleanup);

const LOGIN = { id: "login", label: "Login project" };

describe("Sidekicks in this scope (spec §2a.4, Decision 8)", () => {
  it("one row per sidekick: on/off and the purpose text for this scope", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickScope = [{ id: "sidekick", name: "Sidekick", mark: "spark", on: true }, { id: "rulo", name: "Rulo", mark: "🦊", on: false, purposeText: "No spec without AC." }];
    await renderIn("en", <ScopeSidekicks client={c} scope={LOGIN} scopeNoun="project" />);
    expect(await screen.findByRole("region", { name: "Sidekicks in this project" })).toBeTruthy();
    expect(screen.getByText("Login project")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Rulo" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["setScope", "login", "rulo", { on: true, purposeText: "No spec without AC." }]));
    fireEvent.change(screen.getByRole("textbox", { name: "Sidekick's purpose here" }), { target: { value: "Keep PRs small." } });
    fireEvent.blur(screen.getByRole("textbox", { name: "Sidekick's purpose here" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["setScope", "login", "sidekick", { on: true, purposeText: "Keep PRs small." }]));
  });

  it("a blur without a change writes nothing; a cleared text drops it; the record's places are kept", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickScope = [{ id: "rulo", name: "Rulo", mark: "🦊", on: true, purposeText: "No spec without AC.", places: ["terminal"] }];
    await renderIn("en", <ScopeSidekicks client={c} scope={LOGIN} scopeNoun="project" />);
    const box = await screen.findByRole("textbox", { name: "Rulo's purpose here" });
    fireEvent.blur(box);
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.blur(box);
    await waitFor(() => expect(c.sidekickCalls).toEqual([["setScope", "login", "rulo", { on: true, places: ["terminal"] }]]));
  });

  it("a quick second change waits for the first and writes once more (no double write, nothing lost)", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickScope = [{ id: "rulo", name: "Rulo", mark: "🦊", on: false }];
    let release!: () => void;
    c.sidekickScopeGate = new Promise<void>((r) => (release = r));
    await renderIn("en", <ScopeSidekicks client={c} scope={LOGIN} scopeNoun="project" />);
    const box = await screen.findByRole("checkbox", { name: "Rulo" });
    fireEvent.click(box);
    await waitFor(() => expect(c.sidekickCalls).toHaveLength(1));
    expect(box.closest("li")?.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(box);
    fireEvent.click(box);
    fireEvent.click(box);
    expect(c.sidekickCalls).toHaveLength(1);
    release();
    await waitFor(() => expect(c.sidekickCalls).toEqual([["setScope", "login", "rulo", { on: true }], ["setScope", "login", "rulo", { on: false }]]));
    await waitFor(() => expect(box.closest("li")?.getAttribute("aria-busy")).toBe("false"));
  });

  it("a refusal (the sidekick was removed) shows why and puts the switch back", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickScope = [{ id: "rulo", name: "Rulo", mark: "🦊", on: false }];
    c.sidekickScopeFails = 'No sidekick "rulo"';
    await renderIn("en", <ScopeSidekicks client={c} scope={LOGIN} scopeNoun="project" />);
    const box = (await screen.findByRole("checkbox", { name: "Rulo" })) as HTMLInputElement;
    fireEvent.click(box);
    expect((await screen.findByRole("alert")).textContent).toContain('No sidekick "rulo"');
    expect(box.checked).toBe(false);
  });

  it("reads the list again when the sidekicks change", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickState = SK_ON;
    c.sidekickScope = [{ id: "sidekick", name: "Sidekick", mark: "spark", on: true }];
    await renderIn("en", <ScopeSidekicks client={c} scope={LOGIN} scopeNoun="project" />);
    await screen.findByRole("checkbox", { name: "Sidekick" });
    c.sidekickScope = [...c.sidekickScope, { id: "rulo", name: "Rulo", mark: "🦊", on: true }];
    c.emitSidekick(SK_ON);
    expect(await screen.findByRole("checkbox", { name: "Rulo" })).toBeTruthy();
  });
});

describe("the section in Settings › Sidekicks", () => {
  it("shows for the open scope of a harness with scopes, and follows the open scope", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickState = SK_ON;
    c.scopeList = [
      { id: "login", title: "Login project", createdAt: "2026-10-25T10:00:00.000Z", archived: false },
      { id: "billing", title: "Billing", createdAt: "2026-10-25T10:00:00.000Z", archived: false },
    ];
    c.openScope = "login";
    c.sidekickScope = [{ id: "sidekick", name: "Sidekick", mark: "spark", on: true }];
    await renderIn("en", <SidekickTab client={c} onModels={() => undefined} scopes={{ label: "project" }} />);
    expect(await screen.findByRole("region", { name: "Sidekicks in this project" })).toBeTruthy();
    expect(screen.getByText("Login project")).toBeTruthy();
    await c.scopes.open("billing");
    expect(await screen.findByText("Billing")).toBeTruthy();
    await c.scopes.open(null);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Sidekicks in this project" })).toBeNull());
  });

  it("D0: no section without scopes, nor with no scope open; nothing is read or written", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickState = SK_ON;
    await renderIn("en", <SidekickTab client={c} onModels={() => undefined} />);
    await screen.findByRole("checkbox", { name: "Before you send" });
    expect(screen.queryByText(/Sidekicks in this/)).toBeNull();
    cleanup();
    await renderIn("en", <SidekickTab client={c} onModels={() => undefined} scopes={{ label: "project" }} />);
    await screen.findByRole("checkbox", { name: "Before you send" });
    expect(screen.queryByText(/Sidekicks in this/)).toBeNull();
    expect(c.sidekickCalls.filter((x) => x[0] === "setScope" || x[0] === "scope")).toEqual([]);
  });
});
