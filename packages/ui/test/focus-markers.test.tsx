// @vitest-environment happy-dom
import { act, cleanup, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";
import type { ReviewComment } from "../src/client";
import { FocusMarkers } from "../src/FocusMarkers";
import { renderIn } from "./render";

afterEach(cleanup);
const c: ReviewComment = { id: "c1", author: "agent", kind: "comment", anchor: { quote: "Filter", heading: null, occurrence: 0 }, text: "Name it.", state: "open", replies: [], at: "2026-10-28T10:00:00.000Z" };

describe("focus markers (§6.2)", () => {
  it("place themselves again when the window resizes or the text's look changes", async () => {
    let top = 40;
    const range = { getBoundingClientRect: () => ({ top }) } as unknown as Range;
    const ranges = new Map([["c1", range]]);
    const host = document.createElement("div");
    document.body.append(host);
    const props = { comments: [c], ranges, host, open: null, onPick: () => {} };
    const { i18n, rerender } = await renderIn("en", <FocusMarkers {...props} look="sans normal" />);
    const marker = () => screen.getByRole("button", { name: "Comment: Name it." });
    expect(marker().style.top).toBe("40px");
    top = 90;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(marker().style.top).toBe("90px");
    top = 130;
    rerender(
      <I18nextProvider i18n={i18n}>
        <FocusMarkers {...props} look="sans large" />
      </I18nextProvider>,
    );
    expect(marker().style.top).toBe("130px");
    host.remove();
  });
});
