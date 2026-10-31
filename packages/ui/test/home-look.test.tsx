// @vitest-environment happy-dom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LimitWindow } from "../src/client";
import { Home } from "../src/Home";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const configured = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const fiveHour: LimitWindow = { kind: "five_hour", utilization: 0.18, resetsAt: new Date(Date.now() + 3600_000).toISOString() };

async function renderHome(client: FakeClient, { limits = null as LimitWindow[] | null, onEngine = () => {}, onOpen = undefined as ((i: unknown) => void) | undefined } = {}) {
  await renderIn(
    "en",
    <Home
      state={client.state}
      client={client}
      onChange={() => {}}
      status={client.status}
      limits={limits}
      onStart={() => {}}
      onSetup={() => {}}
      onSettings={() => {}}
      onEngine={onEngine}
      {...(onOpen ? { onOpen } : {})}
    />,
  );
}

describe("Home look (UI refresh spec §5.2)", () => {
  it("shows Pick up on a ready Home and hides it when setup is missing", async () => {
    await renderHome(new FakeClient(configured));
    expect(await screen.findByRole("heading", { name: "Pick up where you left" })).toBeTruthy();
    cleanup();
    await renderHome(new FakeClient({}));
    expect(screen.queryByRole("heading", { name: "Pick up where you left" })).toBeNull();
  });

  it("opens a history task in History through onOpen", async () => {
    const onOpen = vi.fn();
    await renderHome(new FakeClient(configured), { onOpen });
    await screen.findByRole("heading", { name: "Pick up where you left" });
    fireEvent.click(document.querySelector<HTMLButtonElement>(".hh-pickup-card")!);
    expect(onOpen).toHaveBeenCalledWith({ kind: "history", task: "t1" });
  });

  it("the engine pill says who is connected and the 5-hour use, and opens Settings › Engine", async () => {
    const onEngine = vi.fn();
    await renderHome(new FakeClient(configured), { limits: [fiveHour], onEngine });
    fireEvent.click(await screen.findByRole("button", { name: /Claude.*Connected.*5 h · 18%/ }));
    expect(onEngine).toHaveBeenCalled();
  });

  it("Start is the amber CTA", async () => {
    await renderHome(new FakeClient(configured));
    expect(screen.getByRole("button", { name: /Start Demo/ }).className).toContain("hh-start");
  });
});
