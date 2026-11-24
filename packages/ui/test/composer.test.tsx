// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { createRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer, type ComposerProps } from "../src/task-view/Composer";
import { renderIn } from "./render";

afterEach(cleanup);

/** The composer with its draft held as ChatView holds it. */
function Held(props: Omit<ComposerProps, "draft" | "onDraft" | "inputRef">) {
  const [draft, setDraft] = useState("");
  return <Composer {...props} draft={draft} onDraft={setDraft} inputRef={createRef()} />;
}

const base = () => ({ placeholder: "Write a message…", onEnter: vi.fn(), onSendNow: vi.fn(), onReview: vi.fn() });

describe("Composer", () => {
  it("has no Send button, and the hint sits inside the field", async () => {
    await renderIn("en", <Held {...base()} />);
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    const field = screen.getByRole("textbox", { name: "Write a message…" }).closest(".hh-composer-field") as HTMLElement;
    expect(within(field).getByText("↵ send · ⇧↵ new line")).toBeTruthy();
  });

  it("Enter sends the draft", async () => {
    const p = base();
    await renderIn("en", <Held {...p} />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "Hello" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(p.onEnter).toHaveBeenCalledWith("Hello", false);
  });

  it("Shift+Enter adds a line and does not send", async () => {
    const p = base();
    await renderIn("en", <Held {...p} />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "Hello" } });
    const ev = fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    // Not prevented: the browser inserts the newline.
    expect(ev).toBe(true);
    expect(p.onEnter).not.toHaveBeenCalled();
  });

  it("⌘⏎ sends at once with Sidekick, ⌥⏎ asks for a review", async () => {
    const p = base();
    await renderIn("en", <Held {...p} marks={[]} />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "Hi" } });
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(p.onSendNow).toHaveBeenCalledWith("Hi");
    fireEvent.keyDown(box, { key: "Enter", altKey: true });
    expect(p.onEnter).toHaveBeenCalledWith("Hi", true);
  });

  it("Review keeps working when the harness has it", async () => {
    const p = base();
    await renderIn("en", <Held {...p} review="idle" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Check this" } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(p.onReview).toHaveBeenCalledWith("Check this");
  });

  it("while a review runs the field is read-only and the button waits", async () => {
    await renderIn("en", <Held {...base()} review="reviewing" />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).readOnly).toBe(true);
    expect(screen.getByRole("button", { name: /Reviewing/ }).hasAttribute("disabled")).toBe(true);
  });

  it("has no Stop: the working line carries it", async () => {
    await renderIn("en", <Held {...base()} />);
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });
});
