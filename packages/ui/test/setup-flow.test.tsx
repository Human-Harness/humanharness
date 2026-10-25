// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../src/client";
import { systemLanguage } from "../src/language";
import { SetupFlow } from "../src/SetupFlow";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

/** The flow with its state kept, as HarnessApp keeps it. */
function Flow({ client, onCancel = () => {}, onStart = () => {} }: { client: FakeClient; onCancel?: () => void; onStart?: () => void }) {
  const [state, setState] = useState<AppState>(client.state);
  return <SetupFlow client={client} state={state} onChange={setState} onCancel={onCancel} onStart={onStart} />;
}

const next = () => screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;
const steps = () => within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");

describe("SetupFlow", () => {
  it("walks a fresh app from the folder to the engine to All set, then starts", async () => {
    const client = new FakeClient();
    const onStart = vi.fn();
    await renderIn("en", <Flow client={client} onStart={onStart} />);
    expect(screen.getByRole("banner").textContent).toContain("Set up Demo");
    const folderHeading = screen.getByRole("heading", { name: "Where should we keep your work?" });
    expect(document.activeElement).toBe(folderHeading);
    expect(steps()[0].getAttribute("aria-current")).toBe("step");
    expect(screen.queryByText(/works with an AI plan you already have, using your own account\. The app/)).toBeNull();
    // Next sits in the footer next to Cancel, as on the engine step; the folder step has no button of its own.
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("button", { name: "Next" })).toBe(next());
    expect(within(footer).getByRole("button", { name: "Cancel" })).toBeTruthy();

    fireEvent.click(next());
    const engineHeading = await screen.findByRole("heading", { name: "Which AI does Demo use?" });
    expect(client.state.config).toEqual({ language: systemLanguage(), folder: "/Users/me/Documents/Demo" });
    expect(document.activeElement).toBe(engineHeading);
    expect(steps()[0].querySelector("svg")).toBeTruthy();
    expect(steps()[1].getAttribute("aria-current")).toBe("step");
    // Settings' own "Use Claude" isn't shown: Next does that.
    expect(screen.queryByRole("button", { name: "Use Claude" })).toBeNull();

    await waitFor(() => expect(next().disabled).toBe(false));
    fireEvent.click(next());
    const done = await screen.findByRole("heading", { name: "All set" });
    expect(document.activeElement).toBe(done);
    expect(client.state.config.engineId).toBe("claude");
    expect(screen.queryByRole("list", { name: "Steps" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.getByText("/Users/me/Documents/Demo")).toBeTruthy();
    expect(screen.getByText("Claude")).toBeTruthy();
    expect(screen.getByText("You can change all of this whenever you like in Settings.")).toBeTruthy();
    const start = screen.getByRole("button", { name: "Start Demo" });
    expect(start.className).toBe("hh-primary hh-start");
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("skips the folder step when a folder is saved, and Cancel goes back", async () => {
    const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo" });
    const onCancel = vi.fn();
    await renderIn("en", <Flow client={client} onCancel={onCancel} />);
    expect(screen.getByRole("heading", { name: "Which AI does Demo use?" })).toBeTruthy();
    expect(steps()[0].querySelector("svg")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("Cancel on the folder step goes back without saving", async () => {
    const client = new FakeClient();
    const onCancel = vi.fn();
    await renderIn("en", <Flow client={client} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(client.state.config).toEqual({});
  });

  it("Back returns to the folder step when it was shown", async () => {
    const client = new FakeClient();
    await renderIn("en", <Flow client={client} />);
    fireEvent.click(next());
    await screen.findByRole("heading", { name: "Which AI does Demo use?" });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Where should we keep your work?" })).toBeTruthy();
    expect(screen.getByText("/Users/me/Documents/Demo")).toBeTruthy();
  });

  it("enables Next only once the selected engine is ready", async () => {
    const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo" });
    let release!: () => void;
    client.statusGates.claude = new Promise((r) => (release = r));
    client.status = { ...client.status, loggedIn: false };
    await renderIn("en", <Flow client={client} />);
    expect(next().disabled).toBe(true);
    await act(async () => release());
    await screen.findByRole("heading", { name: "Sign in to Claude" });
    expect(next().disabled).toBe(true);
    fireEvent.click(next());
    expect(screen.queryByRole("heading", { name: "All set" })).toBeNull();
  });

  it("says so when the engine can't be saved, and stays on the step", async () => {
    const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo" });
    await renderIn("en", <Flow client={client} />);
    await waitFor(() => expect(next().disabled).toBe(false));
    client.saveError = new Error("EACCES");
    fireEvent.click(next());
    expect((await screen.findByRole("alert")).textContent).toBe("I couldn't save the engine. Try again.");
    expect(screen.getByRole("heading", { name: "Which AI does Demo use?" })).toBeTruthy();
  });

  it("keeps Back off while the engine is being saved, so the flow can't jump from the folder step", async () => {
    const client = new FakeClient();
    await renderIn("en", <Flow client={client} />);
    fireEvent.click(next());
    await screen.findByRole("heading", { name: "Which AI does Demo use?" });
    await waitFor(() => expect(next().disabled).toBe(false));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const save = client.saveConfig.bind(client);
    client.saveConfig = async (patch) => {
      await gate;
      return save(patch);
    };
    fireEvent.click(next());
    const back = screen.getByRole("button", { name: "Back" }) as HTMLButtonElement;
    expect(back.disabled).toBe(true);
    expect(next().disabled).toBe(true);
    await act(async () => release());
    await screen.findByRole("heading", { name: "All set" });
  });

  it("does not save the engine again when it is already the saved one", async () => {
    const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" });
    client.saveError = new Error("should not save");
    await renderIn("en", <Flow client={client} />);
    await waitFor(() => expect(next().disabled).toBe(false));
    fireEvent.click(next());
    await screen.findByRole("heading", { name: "All set" });
  });

  it("in mock mode, explains the single test engine and names its model at the end", async () => {
    const client = new FakeClient({ language: "es", folder: "/Users/me/Documents/Demo" });
    client.state = {
      ...client.state,
      mock: true,
      engines: [{ ...client.state.engines[0], name: "Mock AI", provider: "Human Harness", logo: undefined, reportsLimits: false, mock: true }],
    };
    await renderIn("en", <Flow client={client} />);
    expect(screen.getByRole("banner").textContent).toContain("Test mode (no AI)");
    expect(screen.getByText(/In test mode there is only one engine/)).toBeTruthy();
    await waitFor(() => expect(next().disabled).toBe(false));
    fireEvent.click(next());
    await screen.findByRole("heading", { name: "All set" });
    expect(screen.getByText("Mock AI · Test model")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start Demo" })).toBeTruthy();
  });
});
