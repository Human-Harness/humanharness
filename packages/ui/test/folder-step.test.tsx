// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../src/client";
import { FolderStep } from "../src/FolderStep";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const drive = "/Users/me/Library/CloudStorage/GoogleDrive-me@example.com/My Drive";
const work = "/Users/me/Library/CloudStorage/GoogleDrive-work@example.com/My Drive";
const icloud = "/Users/me/Library/Mobile Documents/com~apple~CloudDocs";
const radio = (name: string) => screen.getByRole("radio", { name }) as HTMLInputElement;

/** The step with a footer button that submits it, as the setup flow renders it. */
function renderStep(language: "en" | "es", client: FakeClient, onSaved: (s: AppState) => void = () => {}) {
  return renderIn(
    language,
    <>
      <FolderStep client={client} state={client.state} onSaved={onSaved} formId="folder-form" />
      <button type="submit" form="folder-form">
        Next
      </button>
    </>,
  );
}
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Next" }));

function withPlaces() {
  const client = new FakeClient();
  client.state.backup = {
    status: null,
    locations: [
      { provider: "google-drive", path: drive, account: "me@example.com", suggested: `${drive}/Demo` },
      { provider: "icloud", path: icloud, suggested: `${icloud}/Demo` },
    ],
  };
  return client;
}

describe("FolderStep", () => {
  it("offers the synced places first and starts on the first one", async () => {
    const client = withPlaces();
    const onSaved = vi.fn();
    await renderStep("en", client, onSaved);
    const places = screen.getByRole("radiogroup", { name: "Where to keep your work" });
    expect(places.textContent).toContain("Save it in Google Drive so you don't lose it");
    expect(radio("Save it in Google Drive so you don't lose it").checked).toBe(true);
    expect(radio("Only on this computer").checked).toBe(false);
    expect(screen.getByText(`${drive}/Demo`)).toBeTruthy();
    submit();
    await waitFor(() => expect(client.state.config.folder).toBe(`${drive}/Demo`));
  });

  it("lets the person pick iCloud, this computer only, or any other folder", async () => {
    const client = withPlaces();
    await renderStep("en", client);
    fireEvent.click(radio("Save it in iCloud Drive so you don't lose it"));
    expect(screen.getByText(`${icloud}/Demo`)).toBeTruthy();
    expect(radio("Save it in iCloud Drive so you don't lose it").checked).toBe(true);
    fireEvent.click(radio("Only on this computer"));
    expect(screen.getByText("/Users/me/Documents/Demo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Choose another folder" }));
    expect(await screen.findByText("/Users/me/Elsewhere")).toBeTruthy();
  });

  it("tells two accounts of one provider apart", async () => {
    const client = new FakeClient();
    client.state.backup = {
      status: null,
      locations: [
        { provider: "google-drive", path: drive, account: "me@example.com", suggested: `${drive}/Demo` },
        { provider: "google-drive", path: work, account: "work@example.com", suggested: `${work}/Demo` },
      ],
    };
    await renderStep("en", client);
    const [mine, theirs] = screen.getAllByRole("radio", { name: "Save it in Google Drive so you don't lose it" });
    const described = (el: HTMLElement) => document.getElementById(el.getAttribute("aria-describedby")!)?.textContent;
    expect(described(mine)).toBe("me@example.com");
    expect(described(theirs)).toBe("work@example.com");
    fireEvent.click(theirs);
    expect(screen.getByText(`${work}/Demo`)).toBeTruthy();
  });

  it("explains a folder that can't be used, then saves it with the language", async () => {
    const client = new FakeClient({});
    client.pickResult = { folder: "/Users/me/Documents", problem: "too-broad" };
    const onSaved = vi.fn();
    await renderStep("en", client, onSaved);
    expect(screen.getByText("/Users/me/Documents/Demo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Choose another folder" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That folder is too general. Pick or create a folder inside it.");
    client.pickResult = { folder: "/Users/me/Documents/Mine", problem: null };
    fireEvent.click(screen.getByRole("button", { name: "Choose another folder" }));
    await screen.findByText("/Users/me/Documents/Mine");
    submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(client.state.config).toEqual({ language: "en", folder: "/Users/me/Documents/Mine" });
  });

  it("says when the folder can't be saved", async () => {
    const client = new FakeClient({});
    client.saveError = new Error("protected");
    await renderStep("en", client);
    submit();
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't save/i);
  });

  it("has no button of its own, and choosing another folder doesn't submit it", async () => {
    const client = new FakeClient({});
    const onSaved = vi.fn();
    await renderStep("en", client, onSaved);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Choose another folder", "Next"]);
    fireEvent.click(screen.getByRole("button", { name: "Choose another folder" }));
    await screen.findByText("/Users/me/Elsewhere");
    expect(onSaved).not.toHaveBeenCalled();
    submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(client.state.config).toEqual({ language: "en", folder: "/Users/me/Elsewhere" });
  });

  it("shows no places when nothing syncs on this computer", async () => {
    const client = new FakeClient();
    await renderStep("es", client);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByText("/Users/me/Documents/Demo")).toBeTruthy();
  });
});
