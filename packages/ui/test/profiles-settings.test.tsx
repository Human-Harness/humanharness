// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { AppState } from "../src/client";
import { type SettingsTab, SettingsSheet } from "../src/SettingsSheet";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const configured = { language: "en" as const, folder: "/Users/me/Documents/Family", engineId: "claude" };

function family() {
  const client = new FakeClient({ ...configured, profile: "sofi" });
  client.state = {
    ...client.state,
    profiles: { label: "student", form: { fields: [{ name: "name", kind: "text", label: "Name", optional: false }] } },
  };
  client.profileList = [
    { id: "sofi", title: "Sofi", color: "coral", createdAt: "", archived: false },
    { id: "tomas", title: "Tomás", createdAt: "", archived: false },
  ];
  client.records.profile = [{ name: "Sofi", color: "coral" }];
  return client;
}

function Sheet({ client, tab: first }: { client: FakeClient; tab: SettingsTab }) {
  const [state, setState] = useState<AppState>(client.state);
  const [tab, setTab] = useState<SettingsTab>(first);
  return <SettingsSheet client={client} state={state} tab={tab} onTab={setTab} onChange={setState} onClose={() => {}} onSetup={() => {}} />;
}

describe("Settings › General › People (profiles spec §5)", () => {
  it("D0: no People section without profiles", async () => {
    await renderIn("en", <Sheet client={new FakeClient(configured)} tab="general" />);
    expect(screen.queryByRole("heading", { name: "People" })).toBeNull();
  });

  it("lists every profile; the active one says so and can be edited, never archived or deleted", async () => {
    const client = family();
    await renderIn("en", <Sheet client={client} tab="general" />);
    const sofi = await screen.findByRole("listitem", { name: "Sofi" });
    expect(within(sofi).getByText("In use now")).toBeTruthy();
    expect(within(sofi).queryByRole("button", { name: "Archive" })).toBeNull();
    fireEvent.click(within(sofi).getByRole("button", { name: "Edit" }));
    const name = await within(sofi).findByLabelText("Name");
    fireEvent.change(name, { target: { value: "Sofía" } });
    fireEvent.click(within(sofi).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(client.records.profile.at(-1)).toEqual({ name: "Sofía", color: "coral" }));
  });

  it("archives another profile and brings it back", async () => {
    const client = family();
    await renderIn("en", <Sheet client={client} tab="general" />);
    fireEvent.click(within(await screen.findByRole("listitem", { name: "Tomás" })).getByRole("button", { name: "Archive" }));
    fireEvent.click(await within(screen.getByRole("listitem", { name: "Tomás" })).findByRole("button", { name: "Bring back" }));
    await waitFor(() => expect(client.profileCalls).toEqual(["archive:tomas", "unarchive:tomas"]));
  });

  it("deletes only after asking twice", async () => {
    const client = family();
    await renderIn("en", <Sheet client={client} tab="general" />);
    const tomas = await screen.findByRole("listitem", { name: "Tomás" });
    fireEvent.click(within(tomas).getByRole("button", { name: "Delete…" }));
    expect(within(tomas).getByText("Delete Tomás? This can't be undone from the app.")).toBeTruthy();
    fireEvent.click(within(tomas).getByRole("button", { name: "Delete" }));
    expect(client.profileCalls).toEqual([]);
    expect(within(tomas).getByText("Tomás's folder and history go to the Trash. You can still get them back from there.")).toBeTruthy();
    fireEvent.click(within(tomas).getByRole("button", { name: "Move to the Trash" }));
    await waitFor(() => expect(client.profileCalls).toEqual(["delete:tomas"]));
  });
  it("a refusal says why in one line: busy waits for the AI", async () => {
    const client = family();
    client.profiles.archive = async () => ({ ok: false, reason: "busy" });
    await renderIn("en", <Sheet client={client} tab="general" />);
    fireEvent.click(within(await screen.findByRole("listitem", { name: "Tomás" })).getByRole("button", { name: "Archive" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Wait until the AI finishes, then try again.");
  });

  it("a long title with line breaks is drawn and asked about on one line", async () => {
    const client = family();
    client.profileList = [...client.profileList, { id: "max", title: "  Max\nthe   Second  ", createdAt: "", archived: false }];
    await renderIn("en", <Sheet client={client} tab="general" />);
    const max = await screen.findByRole("listitem", { name: "Max the Second" });
    fireEvent.click(within(max).getByRole("button", { name: "Delete…" }));
    expect(within(max).getByText("Delete Max the Second? This can't be undone from the app.")).toBeTruthy();
  });
});

describe("Settings › Usage by person (profiles spec §4 'Usage')", () => {
  it("lists tokens per profile, most first", async () => {
    const client = family();
    client.usage = { limits: null, estimates: {}, tokens: {}, profiles: { sofi: 1200, tomas: 3400 } };
    await renderIn("en", <Sheet client={client} tab="usage" />);
    const list = await screen.findByRole("list", { name: "Usage by person" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("Tomás"), expect.stringContaining("Sofi")]);
  });

  it("counts a profile with no usage as 0 and names an archived one; an id the registry lost shows as itself", async () => {
    const client = family();
    client.profileList = [...client.profileList, { id: "ana", title: "Ana", createdAt: "", archived: true }, { id: "leo", title: "Leo", createdAt: "", archived: false }];
    client.usage = { limits: null, estimates: {}, tokens: {}, profiles: { ana: 50, ghost: 10, sofi: 1200 } };
    await renderIn("en", <Sheet client={client} tab="usage" />);
    const list = await screen.findByRole("list", { name: "Usage by person" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(5));
    const names = within(list).getAllByRole("listitem").map((li) => li.firstElementChild?.textContent);
    expect(names.slice(0, 3)).toEqual(["Sofi", "Ana", "ghost"]);
    expect(names.slice(3).sort()).toEqual(["Leo", "Tomás"]);
  });

  it("D0: nothing per person without profiles", async () => {
    const client = new FakeClient(configured);
    await renderIn("en", <Sheet client={client} tab="usage" />);
    await screen.findByRole("tabpanel");
    expect(screen.queryByRole("list", { name: "Usage by person" })).toBeNull();
  });
});
