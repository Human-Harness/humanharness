// @vitest-environment happy-dom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Drawer } from "../src/Drawer";
import { renderIn } from "./render";

afterEach(cleanup);

describe("Drawer", () => {
  it("is a right-side dialog with a title, one subtitle line and Close; Escape and the scrim close it (spec §5.7)", async () => {
    const onClose = vi.fn();
    await renderIn(
      "en",
      <Drawer title="History" subtitle="Go back to any point: your files return to how they were then." onClose={onClose}>
        <p>body</p>
      </Drawer>,
    );
    const dlg = screen.getByRole("dialog", { name: "History" });
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("Go back to any point: your files return to how they were then.")).toBeTruthy();
    fireEvent.keyDown(dlg, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(document.querySelector(".hh-drawer-scrim")!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("moves focus into the dialog on open and gives it back to the opener when it goes away", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open history";
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = await renderIn(
      "en",
      <Drawer title="History" onClose={() => {}}>
        <p>body</p>
      </Drawer>,
    );
    expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "History" }));
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("keeps Tab and Shift+Tab inside the drawer, wrapping at both ends", async () => {
    await renderIn(
      "en",
      <Drawer title="History" onClose={() => {}}>
        <button type="button">Last</button>
      </Drawer>,
    );
    const dlg = screen.getByRole("dialog", { name: "History" });
    const close = screen.getByRole("button", { name: "Close" });
    const last = screen.getByRole("button", { name: "Last" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    expect(dlg.contains(document.activeElement)).toBe(true);
  });
});
