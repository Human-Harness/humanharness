// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FolderStep } from "../src/FolderStep";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const drive = "/Users/me/Library/CloudStorage/GoogleDrive-me@example.com/My Drive";
const icloud = "/Users/me/Library/Mobile Documents/com~apple~CloudDocs";

function withPlaces() {
  const client = new FakeClient();
  client.state.backup = {
    status: null,
    locations: [
      { provider: "google-drive", path: drive, suggested: `${drive}/Demo` },
      { provider: "icloud", path: icloud, suggested: `${icloud}/Demo` },
    ],
  };
  return client;
}

describe("FolderStep", () => {
  it("offers the synced places first and starts on the first one", async () => {
    const client = withPlaces();
    const onSaved = vi.fn();
    await renderIn("en", <FolderStep client={client} state={client.state} onSaved={onSaved} />);
    const places = screen.getByRole("group", { name: "Where to keep your work" });
    expect(places.textContent).toContain("Save it in Google Drive so you don't lose it");
    expect(screen.getByRole("button", { name: "Save it in Google Drive so you don't lose it" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(`${drive}/Demo`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    await waitFor(() => expect(client.state.config.folder).toBe(`${drive}/Demo`));
  });

  it("lets the person pick iCloud, this computer only, or any other folder", async () => {
    const client = withPlaces();
    await renderIn("en", <FolderStep client={client} state={client.state} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Save it in iCloud Drive so you don't lose it" }));
    expect(screen.getByText(`${icloud}/Demo`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Only on this computer" }));
    expect(screen.getByText("/Users/me/Documents/Demo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Choose another folder" }));
    expect(await screen.findByText("/Users/me/Elsewhere")).toBeTruthy();
  });

  it("shows no places when nothing syncs on this computer", async () => {
    const client = new FakeClient();
    await renderIn("es", <FolderStep client={client} state={client.state} onSaved={() => {}} />);
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getByText("/Users/me/Documents/Demo")).toBeTruthy();
  });
});
