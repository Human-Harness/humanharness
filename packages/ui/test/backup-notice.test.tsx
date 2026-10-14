// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackupNotice, needsBackupNotice } from "../src/BackupNotice";
import { HarnessApp } from "../src/HarnessApp";
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

  it("says not to close the app while the move runs, with the buttons there but disabled", async () => {
    const client = localClient();
    let finish!: () => void;
    const gate = new Promise<void>((r) => (finish = r));
    const move = client.moveFolder.bind(client);
    client.moveFolder = async (to: string) => {
      await gate;
      return move(to);
    };
    await renderIn("en", <Notice client={client} />);
    // One status region, there from the start: its text changes.
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Move to Google Drive" }));
    await waitFor(() => expect(status.textContent).toBe("Moving your folder… Don't close the app."));
    const button = screen.getByRole("button", { name: "Move to Google Drive" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "I already have a copy" }) as HTMLButtonElement).disabled).toBe(true);
    expect(button.parentElement?.getAttribute("aria-busy")).toBe("true");
    finish();
    await waitFor(() => expect(status.textContent).toBe(`Your folder is now in ${folder}.`));
    expect(screen.getByRole("status")).toBe(status);
    expect(button.disabled).toBe(false);
  });

  it("after a move to a place that is still only on this computer, says where it is now and what stayed behind", async () => {
    const client = localClient();
    client.moveResult = {
      ok: true,
      leftBehind: folder,
      historyLeftBehind: true,
      state: { ...client.state, config: { ...ready, folder: "/Volumes/Disk/Demo" } },
    };
    await renderIn("en", <Notice client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose another place…" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Your folder is now in /Volumes/Disk/Demo. " +
          `The old one is still at ${folder}: check it and delete it yourself when you no longer need it. ` +
          "Your history of changes stayed with the old place for now; it follows your folder the next time you open the app.",
      ),
    );
    // Still only on this computer: the notice stays.
    expect(screen.getByRole("region", { name: "Backup" })).toBeTruthy();
  });

  it("gives focus back to the button that started a failed move", async () => {
    const client = localClient();
    client.moveResult = { ok: false, error: "no-space" };
    await renderIn("en", <Notice client={client} />);
    const button = screen.getByRole("button", { name: "Move to Google Drive" });
    button.focus();
    fireEvent.click(button);
    await screen.findByRole("alert");
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("moves focus to the alert when the button that started a failed move is gone", async () => {
    const client = localClient();
    client.moveResult = { ok: false, error: "failed", state: { ...client.state, backup: { status: { kind: "local" }, locations: [] } } };
    await renderIn("en", <Notice client={client} />);
    const button = screen.getByRole("button", { name: "Move to Google Drive" });
    button.focus();
    fireEvent.click(button);
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });

  it("says so when the place picker can't open", async () => {
    const client = localClient();
    client.pickFolder = async () => Promise.reject(new Error("ipc"));
    await renderIn("es", <Notice client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Elegir otro lugar…" }));
    expect((await screen.findByRole("alert")).textContent).toBe("No pude abrir la ventana para elegir un lugar. Probá de nuevo.");
    expect(client.moved).toEqual([]);
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

  it("a busy app's message names more than the AI", async () => {
    const client = localClient();
    client.moveResult = { ok: false, error: "busy" };
    await renderIn("en", <Notice client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to Google Drive" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Something else is running (an answer, going back to an earlier point, or moving the folder). Try again when it finishes.",
    );
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
      expect(screen.getByRole("status").textContent).toBe(
        `Tu carpeta ahora está en ${folder}. La vieja sigue en ${folder}: revisala y borrala vos cuando ya no la necesites.`,
      ),
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
        `Your folder is now in ${folder}. The old one is still at ${folder}: check it and delete it yourself when you no longer need it. ` +
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
    // Focus doesn't drop to the page: it goes to the line saying what happened.
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Got it: I won't remind you again. You can change that in Settings › General.");
    await waitFor(() => expect(document.activeElement).toBe(status));
  });

  it("says so when saving 'I already have a copy' fails, and keeps the notice", async () => {
    const client = localClient();
    client.saveConfig = async () => Promise.reject(new Error("disk"));
    await renderIn("en", <Notice client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "I already have a copy" }));
    expect((await screen.findByRole("alert")).textContent).toBe("I couldn't save that. Try again.");
    expect(screen.getByRole("region", { name: "Backup" })).toBeTruthy();
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

describe("A move in progress, across views", () => {
  it("still shows on Home after Settings closes, and how it ended", async () => {
    const client = localClient();
    let finish!: () => void;
    const gate = new Promise<void>((r) => (finish = r));
    const move = client.moveFolder.bind(client);
    client.moveFolder = async (to: string) => {
      await gate;
      return move(to);
    };
    render(<HarnessApp client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const sheet = screen.getByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Move to Google Drive" }));
    await waitFor(() => expect(within(sheet).getByRole("status").textContent).toBe("Moving your folder… Don't close the app."));
    // Another tab and back: the move is still shown.
    fireEvent.click(within(sheet).getByRole("tab", { name: "Usage" }));
    fireEvent.click(within(sheet).getByRole("tab", { name: "General" }));
    expect(within(sheet).getByRole("status").textContent).toBe("Moving your folder… Don't close the app.");
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("status").textContent).toBe("Moving your folder… Don't close the app.");
    expect((screen.getByRole("button", { name: "Move to Google Drive" }) as HTMLButtonElement).disabled).toBe(true);
    finish();
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(`Your folder is now in ${folder}.`));
  });
});

describe("Settings › General backup row", () => {
  function Sheet({ client }: { client: FakeClient }) {
    const [state, setState] = useState<AppState>(client.state);
    const [tab, setTab] = useState<SettingsTab>("general");
    return <SettingsSheet client={client} state={state} tab={tab} onTab={setTab} onChange={setState} onClose={vi.fn()} onSetup={vi.fn()} />;
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

  it("always offers to move the folder, also when it is already synced", async () => {
    const client = new FakeClient(ready);
    client.state.backup = { status: { kind: "synced", provider: "icloud" }, locations: [{ provider: "google-drive", path: drive, suggested: `${drive}/Demo` }] };
    await renderIn("en", <Sheet client={client} />);
    const toggle = screen.getByRole("button", { name: "Move folder…" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Move to Google Drive" })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Choose another place…" }));
    await waitFor(() => expect(client.moved).toEqual(["/Users/me/Elsewhere/Demo"]));
    expect((await screen.findByRole("status")).textContent).toBe(`Your folder is now in ${folder}.`);
  });

  it("doesn't offer the place the folder is already in", async () => {
    const client = new FakeClient({ ...ready, folder: `${drive}/Demo` });
    client.state.backup = { status: { kind: "synced", provider: "google-drive" }, locations: [{ provider: "google-drive", path: drive, suggested: `${drive}/Demo` }] };
    await renderIn("en", <Sheet client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Move folder…" }));
    expect(screen.queryByRole("button", { name: "Move to Google Drive" })).toBeNull();
    expect(screen.getByRole("button", { name: "Choose another place…" })).toBeTruthy();
  });

  it("doesn't offer a place the folder is anywhere inside", async () => {
    const client = new FakeClient({ ...ready, folder: `${drive}/Projects/Demo` });
    client.state.backup = {
      status: { kind: "synced", provider: "google-drive" },
      locations: [
        { provider: "google-drive", path: `${drive}/`, suggested: `${drive}/Demo` },
        { provider: "dropbox", path: "/Users/me/Dropbox", suggested: "/Users/me/Dropbox/Demo" },
        // Only a name that starts the same: not the place the folder is in.
        { provider: "onedrive", path: drive.slice(0, -1), suggested: `${drive.slice(0, -1)}/Demo` },
      ],
    };
    await renderIn("en", <Sheet client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Move folder…" }));
    expect(screen.queryByRole("button", { name: "Move to Google Drive" })).toBeNull();
    expect(screen.getByRole("button", { name: "Move to Dropbox" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move to OneDrive" })).toBeTruthy();
  });

  it("shows a failed move from Settings even when the notice is hidden", async () => {
    const client = new FakeClient(ready);
    client.state.backup = { status: { kind: "git-remote" }, locations: [] };
    client.moveResult = { ok: false, error: "exists" };
    await renderIn("en", <Sheet client={client} />);
    expect(screen.getByText("Kept in a git repository that's copied online")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Move folder…" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose another place…" }));
    expect((await screen.findByRole("alert")).textContent).toBe("There's already a folder with that name there. Choose another place.");
  });

  it("shows a local folder's status in Spanish", async () => {
    await renderIn("es", <Sheet client={localClient()} />);
    expect(screen.getByText("Solo en esta compu")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mover a Google Drive" })).toBeTruthy();
  });
});
