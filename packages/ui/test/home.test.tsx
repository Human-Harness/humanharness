// @vitest-environment happy-dom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineProblem, EngineStatus } from "../src/client";
import { Home } from "../src/Home";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const configured = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

async function renderHome(client: FakeClient, { status = null as EngineStatus | null, checkFailed = false } = {}) {
  const onStart = vi.fn();
  const onSetup = vi.fn();
  await renderIn(
    "en",
    <Home
      state={client.state}
      client={client}
      onChange={() => {}}
      status={status}
      checkFailed={checkFailed}
      limits={null}
      onStart={onStart}
      onSetup={onSetup}
      onSettings={() => {}}
      onEngine={() => {}}
    />,
  );
  return { onStart, onSetup };
}

describe("Home", () => {
  it("ready: Start opens the work screen, with no missing card", async () => {
    const client = new FakeClient(configured);
    const { onStart, onSetup } = await renderHome(client, { status: client.status });
    fireEvent.click(screen.getByRole("button", { name: "Start Demo" }));
    expect(onStart).toHaveBeenCalledOnce();
    expect(onSetup).not.toHaveBeenCalled();
    expect(document.querySelector(".hh-missing")).toBeNull();
  });

  it("checking: Start is shown but disabled, and the pill says Checking", async () => {
    const client = new FakeClient(configured);
    await renderHome(client);
    expect((screen.getByRole("button", { name: "Start Demo" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: /Claude.*Checking…/ })).toBeTruthy();
    expect(document.querySelector(".hh-missing")).toBeNull();
  });

  it("first launch: lists both steps and Set up opens the setup flow", async () => {
    const client = new FakeClient();
    const { onStart, onSetup } = await renderHome(client);
    const items = screen.getByRole("region", { name: "Two steps before you start" }).querySelectorAll("li");
    expect([...items].map((li) => li.textContent)).toEqual(["1Choose where your work is kept", "2Connect the AI engine"]);
    expect(items[0].querySelector("svg")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start Demo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Set up Demo" }));
    expect(onSetup).toHaveBeenCalledOnce();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("first launch with the folder saved: the folder step shows a check", async () => {
    const client = new FakeClient({ folder: "/Users/me/Documents/Demo" });
    await renderHome(client);
    const items = screen.getByRole("region", { name: "Two steps before you start" }).querySelectorAll("li");
    expect(items[0].textContent).toBe("Choose where your work is kept");
    expect(items[0].querySelector("svg")).toBeTruthy();
    expect(items[1].textContent).toBe("2Connect the AI engine");
    expect(screen.getByRole("button", { name: "Set up Demo" })).toBeTruthy();
  });

  const problems: [Partial<EngineStatus>, EngineProblem, string][] = [
    [{ noticeAccepted: false }, "notice", "accept Claude's notice"],
    [{ installed: false }, "not-installed", "install Claude"],
    [{ outdated: true }, "outdated", "update Claude"],
    [{ loggedIn: false }, "logged-out", "sign in to Claude again"],
    [{ verified: false }, "untested", "test Claude"],
  ];
  for (const [change, problem, step] of problems) {
    it(`configured with the engine ${problem}: one step left, and Set up`, async () => {
      const client = new FakeClient({ ...configured });
      const { onSetup } = await renderHome(client, { status: { ...client.status, ...change } });
      expect(screen.getByText(`One step left: ${step}`)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Set up Demo" }));
      expect(onSetup).toHaveBeenCalledOnce();
    });
  }

  it("a failed engine check asks to check the engine", async () => {
    const client = new FakeClient(configured);
    await renderHome(client, { checkFailed: true });
    expect(screen.getByText("One step left: check Claude")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set up Demo" })).toBeTruthy();
  });

  it("draws a generic screen on the pill for an engine without a logo", async () => {
    const client = new FakeClient(configured);
    client.state.engines = [{ ...client.state.engines[0], name: "Simulated AI (mock)", logo: undefined, mock: true }];
    await renderHome(client, { status: client.status });
    const pill = screen.getByRole("button", { name: /Simulated AI \(mock\)/ });
    expect(pill.querySelector("img")).toBeNull();
    expect(pill.querySelector("svg")).toBeTruthy();
  });
});
