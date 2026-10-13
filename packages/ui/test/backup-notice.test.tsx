// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackupNotice, needsBackupNotice } from "../src/BackupNotice";
import type { AppState, MoveError } from "../src/client";
import { Home } from "../src/Home";
import { type SettingsTab, SettingsSheet } from "../src/SettingsSheet";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const folder = "/Users/me/Documents/Demo";
const drive = "/Users/me/Library/CloudStorage/GoogleDrive-me@example.com/My Drive";
const ready = { language: "en" as const, folder, engineId: "claude" };

function localClient() {
  const client = new FakeClient(ready);
  client.state.backup = { status: { kind: "local" }, locations: [{ provider: "google-drive", path: drive, suggested: `${drive}/Demo` }] };
  return client;
}

/** The notice with its state kept, as Home and Settings keep it. */
function Notice({ client }: { client: FakeClient }) {
  const [state, setState] = useState<AppState>(client.state);
  return <BackupNotice client={client} state={state} onChange={setState} />;
}

describe("BackupNotice", () => {
  it("shows for a local folder: move to each synced place, choose another place, or say there is a copy", async () => {
    await renderIn("en", <Notice client={localClient()} />);
    expect(screen.getByRole("region", { name: "Backup" }).textContent).toContain("Your folder is only on this computer.");
    expect(screen.getByRole("button", { name: "Move to Google Drive" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose another place…" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "I already have a copy" })).toBeTruthy();
  });

  it("tells two accounts of one provider apart", async () => {
    const client = localClient();
    const work = "/Users/me/Library/CloudStorage/GoogleDrive-ana@work.com/My Drive";
    client.state.backup = {
      status: { kind: "local" },
      locations: [
        { provider: "google-drive", path: drive, account: "me@example.com", suggested: `${drive}/Demo` },
        { provider: "google-drive", path: work, account: "ana@work.com", suggested: `${work}/Demo` },
      ],
    };
    await renderIn("en", <Notice client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to Google Drive (ana@work.com)" }));
    await waitFor(() => expect(client.moved).toEqual([`${work}/Demo`]));
    expect(screen.getByRole("button", { name: "Move to Google Drive (me@example.com)" })).toBeTruthy();
  });

  it("moves the folder, keeping its name, and goes away once it is synced", async () => {
    const client = localClient();
    client.moveResult = { ok: true, state: { ...client.state, config: { ...ready, folder: `${drive}/Demo` }, backup: { status: { kind: "synced", provider: "google-drive" }, locations: [] } } };
    await renderIn("en", <Notice client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to Google Drive" }));
    await waitFor(() => expect(client.moved).toEqual([`${drive}/Demo`]));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Backup" })).toBeNull());
  });

  it("says not to close the app while the move runs", async () => {
    const client = localClient();
    let finish!: () => void;
    const gate = new Promise<void>((r) => (finish = r));
    const move = client.moveFolder.bind(client);
    client.moveFolder = async (to: string) => {
      await gate;
      return move(to);
    };
    await renderIn("en", <Notice client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to Google Drive" }));
    expect((await screen.findByRole("status")).textContent).toBe("Moving your folder… Don't close the app.");
    expect(screen.queryByRole("button", { name: "Move to Google Drive" })).toBeNull();
    finish();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("moves into another place the person picks", async () => {
    const client = localClient();
    client.pickResult = { folder: "/Volumes/Disk", problem: "too-broad" };
    await renderIn("en", <Notice client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose another place…" }));
    await waitFor(() => expect(client.moved).toEqual(["/Volumes/Disk/Demo"]));
  });

  it("does nothing when the person closes the picker", async () => {
    const client = localClient();
    client.pickResult = null;
    await renderIn("en", <Notice client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose another place…" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(client.moved).toEqual([]);
  });

  it("shows each failure in plain language and keeps the buttons", async () => {
    const client = localClient();
    client.moveResult = { ok: false, error: "no-space" };
    await renderIn("en", <Notice client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to Google Drive" }));
    expect((await screen.findByRole("alert")).textContent).toBe("There isn't enough space there. Free some space or choose another place.");
    expect(screen.getByRole("button", { name: "Move to Google Drive" })).toBeTruthy();
  });

  it("has its own card for every failure, in Spanish too", async () => {
    const errors: MoveError[] = ["busy", "exists", "inside", "unsuitable", "no-space", "no-permission", "mismatch", "failed"];
    const seen = new Set<string>();
    for (const error of errors) {
      const client = localClient();
      client.moveResult = { ok: false, error };
      await renderIn("es", <Notice client={client} />);
      fireEvent.click(screen.getByRole("button", { name: "Mover a Google Drive" }));
      const text = (await screen.findByRole("alert")).textContent ?? "";
      expect(text).not.toContain("backup.");
      seen.add(text);
      cleanup();
    }
    expect(seen.size).toBe(errors.length);
  });

  it("a move that throws reads as a failed move", async () => {
    const client = localClient();
    client.moveFolder = async () => Promise.reject(new Error("ipc"));
    await renderIn("en", <Notice client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to Google Drive" }));
    expect((await screen.findByRole("alert")).textContent).toBe("I couldn't move your folder. It's still where it was.");
  });

  it("says where the old folder stayed when it was kept", async () => {
    const client = localClient();
    client.moveResult = { ok: true, leftBehind: folder, state: { ...client.state, backup: { status: { kind: "synced", provider: "google-drive" }, locations: [] } } };
    await renderIn("es", <Notice client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Mover a Google Drive" }));
    // "Moviendo tu carpeta…" is a status too while the move runs.
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(`Tu carpeta se movió. La vieja sigue en ${folder}: revisala y borrala vos cuando ya no la necesites.`),
    );
  });

  it("says the history follows at the next start when it stayed behind", async () => {
    const client = localClient();
    client.moveResult = {
      ok: true,
      leftBehind: folder,
      historyLeftBehind: true,
      state: { ...client.state, backup: { status: { kind: "synced", provider: "google-drive" }, locations: [] } },
    };
    await renderIn("en", <Notice client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to Google Drive" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        `Your folder moved. The old one is still at ${folder}: check it and delete it yourself when you no longer need it. ` +
          "Your history of changes stayed with the old place for now; it follows your folder the next time you open the app.",
      ),
    );
  });

  it("takes the state a failed move sends back, and still shows why it failed", async () => {
    const client = localClient();
    client.moveResult = { ok: false, error: "failed", state: { ...client.state, backup: { status: { kind: "local" }, locations: [] } } };
    await renderIn("en", <Notice client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to Google Drive" }));
    expect((await screen.findByRole("alert")).textContent).toBe("I couldn't move your folder. It's still where it was.");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Move to Google Drive" })).toBeNull());
  });

  it("hides when the person already has a copy", async () => {
    const client = localClient();
    await renderIn("en", <Notice client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "I already have a copy" }));
    await waitFor(() => expect(client.state.config.backupDismissed).toBe(true));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Backup" })).toBeNull());
  });

  it("shows only for a local folder that wasn't dismissed", () => {
    const state = localClient().state;
    expect(needsBackupNotice(state)).toBe(true);
    expect(needsBackupNotice({ ...state, config: { ...state.config, backupDismissed: true } })).toBe(false);
    expect(needsBackupNotice({ ...state, backup: { status: { kind: "git-remote" }, locations: [] } })).toBe(false);
    expect(needsBackupNotice({ ...state, backup: { status: { kind: "synced", provider: "icloud" }, locations: [] } })).toBe(false);
    expect(needsBackupNotice({ ...state, backup: undefined })).toBe(false);
  });

  it("appears on Home", async () => {
    const client = localClient();
    await renderIn(
      "en",
      <Home state={client.state} client={client} onChange={() => {}} status={null} limits={null} onStart={() => {}} onSettings={() => {}} onEngine={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Move to Google Drive" })).toBeTruthy();
  });
});

describe("Settings › General backup row", () => {
  function Sheet({ client }: { client: FakeClient }) {
    const [state, setState] = useState<AppState>(client.state);
    const [tab, setTab] = useState<SettingsTab>("general");
    return <SettingsSheet client={client} state={state} tab={tab} onTab={setTab} onChange={setState} onClose={vi.fn()} />;
  }

  it("shows the status and the notice, and brings a dismissed notice back", async () => {
    const client = localClient();
    client.state.config = { ...client.state.config, backupDismissed: true };
    await renderIn("en", <Sheet client={client} />);
    expect(screen.getByText("You keep your own copy")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Move to Google Drive" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remind me again" }));
    await waitFor(() => expect(client.state.config.backupDismissed).toBe(false));
    expect(await screen.findByRole("button", { name: "Move to Google Drive" })).toBeTruthy();
  });

  it("names the provider of a synced folder", async () => {
    const client = new FakeClient(ready);
    client.state.backup = { status: { kind: "synced", provider: "icloud" }, locations: [] };
    await renderIn("en", <Sheet client={client} />);
    expect(screen.getByText("Kept in iCloud Drive")).toBeTruthy();
  });

  it("shows a local folder's status in Spanish", async () => {
    await renderIn("es", <Sheet client={localClient()} />);
    expect(screen.getByText("Solo en esta compu")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mover a Google Drive" })).toBeTruthy();
  });
});
