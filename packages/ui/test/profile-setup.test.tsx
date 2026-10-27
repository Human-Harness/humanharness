// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessApp } from "../src";
import type { InputSpec, ProfileResult, SetupStepView } from "../src/client";
import { Home } from "../src/Home";
import { ProfileSwitcher } from "../src/ProfileSwitcher";
import { SetupFlow } from "../src/SetupFlow";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const configured = { language: "en" as const, folder: "/Users/me/Documents/Family", engineId: "claude" };
const FORM: InputSpec = {
  fields: [
    { name: "name", kind: "text", label: "Name", optional: false, min: 1, max: 40 },
    { name: "color", kind: "choice", label: "Color", optional: true, options: ["coral", "teal"] },
  ],
};
const GOAL: SetupStepView = { id: "goal", kind: "form", label: "Your goal", required: true, form: { fields: [{ name: "text", kind: "text", label: "Text", optional: false }] } };
const PRIVACY = "Profiles keep each person's work apart, but they don't protect it: anyone who uses this computer can open any profile.";
const SOFI = { id: "sofi", title: "Sofi", createdAt: "", archived: false };

function family(profile?: string, form: InputSpec = FORM) {
  const client = new FakeClient({ ...configured, ...(profile ? { profile } : {}) });
  client.state = { ...client.state, profiles: { label: "student", form }, setup: [GOAL] };
  return client;
}

async function flow(client: FakeClient, props: { newProfile?: boolean } = {}) {
  const onChange = vi.fn((s) => (client.state = s));
  const onCancel = vi.fn();
  await renderIn("en", <SetupFlow client={client} state={client.state} onChange={onChange} onCancel={onCancel} onStart={() => {}} {...props} />);
  return { onChange, onCancel };
}

describe("Home in a profiles app with no active profile", () => {
  it("says a profile is missing, and Set up opens the profile step", async () => {
    const client = family();
    const onAddProfile = vi.fn();
    const onStart = vi.fn();
    await renderIn(
      "en",
      <Home
        state={client.state}
        client={client}
        onChange={() => {}}
        status={client.status}
        limits={null}
        steps={{ steps: { goal: "missing" }, blocking: ["goal"] }}
        onStart={onStart}
        onSetup={() => {}}
        onSettings={() => {}}
        onEngine={() => {}}
        onAddProfile={onAddProfile}
      />,
    );
    expect(screen.getByText("One step left: add a student")).toBeTruthy();
    expect(screen.queryByText(/Your goal/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Set up Demo" }));
    expect(onAddProfile).toHaveBeenCalledOnce();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("the app: Set up opens the profile step, its Next makes the profile, then its harness steps", async () => {
    const client = family();
    client.setupState = { steps: { goal: "missing" }, blocking: ["goal"] };
    await renderIn("en", <HarnessApp client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up Demo" }));
    expect(await screen.findByRole("heading", { name: "Who's using Demo?" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sofi" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Your goal" })).toBeTruthy();
    expect(client.profileCalls).toEqual(["create:Sofi"]);
    expect(screen.getByRole("heading", { level: 1, name: "Set up Demo for Sofi" })).toBeTruthy();
  });

  it("the switcher offers a profile that exists but isn't open", async () => {
    const client = family();
    client.profileList = [SOFI];
    await renderIn("en", <ProfileSwitcher client={client} state={client.state} onSwitched={() => {}} onAdd={() => {}} />);
    const select = (await screen.findByRole("combobox", { name: "Choose student" })) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "sofi" } });
    await waitFor(() => expect(client.profileCalls).toEqual(["open:sofi"]));
  });
});

describe("the profile step (profiles spec §5 'Creating a profile')", () => {
  it("D0: without profiles the engine's Next goes to the harness steps, with no profile step", async () => {
    const client = new FakeClient(configured);
    client.state = { ...client.state, setup: [GOAL] };
    await flow(client);
    expect(screen.queryByText("Who's using it")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Set up Demo" })).toBeTruthy();
  });

  it("from Add: asks the fields, creates the profile, then runs its harness steps; no privacy note for the first", async () => {
    const client = family();
    client.setupState = { steps: { goal: "missing" }, blocking: ["goal"] };
    const { onChange } = await flow(client, { newProfile: true });
    expect(await screen.findByRole("heading", { name: "Who's using Demo?" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Steps" }).textContent).toContain("Who's using it");
    expect(screen.queryByText(PRIVACY)).toBeNull();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sofi" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(client.profileCalls).toEqual(["create:Sofi"]));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ profile: "sofi" }) }));
    expect(await screen.findByRole("heading", { name: "Your goal" })).toBeTruthy();
  });

  it("a name the form draws as long text works the same", async () => {
    const client = family(undefined, { fields: [{ name: "name", kind: "longText", label: "Name", optional: false }] });
    await flow(client, { newProfile: true });
    const name = await screen.findByLabelText("Name");
    expect(name.tagName).toBe("TEXTAREA");
    fireEvent.change(name, { target: { value: "Sofi" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(client.profileCalls).toEqual(["create:Sofi"]));
  });

  it("the second profile: the privacy note, once", async () => {
    const client = family("sofi");
    client.profileList = [SOFI];
    await flow(client, { newProfile: true });
    expect(await screen.findByText(PRIVACY)).toBeTruthy();
  });

  it("a refusal stays on the step and says why; Cancel goes back", async () => {
    const client = family("sofi");
    client.profileRefusal = { ok: false, reason: "invalid", errors: [{ path: "name", message: "Too long" }] };
    const { onCancel } = await flow(client, { newProfile: true });
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Too long")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("a failure that made nothing: try again", async () => {
    const client = family("sofi");
    client.profileRefusal = { ok: false, reason: "failed" };
    await flow(client, { newProfile: true });
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Tomás" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("That didn't work. Try again.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("made but not opened: says so, points at the switcher, and Next can't make it twice", async () => {
    const client = family("sofi");
    client.profileList = [SOFI];
    client.profiles.create = async (values: Record<string, unknown>): Promise<ProfileResult> => {
      client.profileCalls.push(`create:${String(values.name)}`);
      client.profileList = [...client.profileList, { id: "tomas", title: "Tomás", createdAt: "", archived: false }];
      return { ok: false, reason: "failed" };
    };
    await flow(client, { newProfile: true });
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Tomás" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Tomás was added, but couldn't be opened. Choose Tomás from the switcher on Home.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
    expect(client.profileCalls).toEqual(["create:Tomás"]);
  });

  it("names the person in the title once a profile is active", async () => {
    const client = family("sofi");
    client.profileList = [SOFI];
    client.setupState = { steps: { goal: "missing" }, blocking: ["goal"] };
    await renderIn("en", <SetupFlow client={client} state={client.state} onChange={() => {}} onCancel={() => {}} onStart={() => {}} startAt="goal" />);
    expect(await screen.findByRole("heading", { level: 1, name: "Set up Demo for Sofi" })).toBeTruthy();
  });
});
