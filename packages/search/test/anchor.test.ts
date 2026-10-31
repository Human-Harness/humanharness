import { describe, expect, it } from "vitest";
import { headingAnchorAt } from "../src";

const DOC = ["---", "title: Guide", "---", "# Guide", "intro", "## Setup", "```", "# not a heading", "```", "setup text", "## Setup", "the context window", "### `Code` and *more*"].join("\n");

describe("headingAnchorAt (§10 reader anchor)", () => {
  it("is the slug of the heading above the offset, deduplicated like the reader", () => {
    expect(headingAnchorAt(DOC, DOC.indexOf("intro"))).toBe("guide");
    expect(headingAnchorAt(DOC, DOC.indexOf("setup text"))).toBe("setup");
    expect(headingAnchorAt(DOC, DOC.indexOf("context window"))).toBe("setup-1");
  });

  it("skips fenced code, and drops inline marks from the heading's text", () => {
    expect(headingAnchorAt(DOC, DOC.indexOf("not a heading"))).toBe("setup");
    expect(headingAnchorAt(DOC, DOC.length - 1)).toBe("code-and-more");
  });

  it("has none before the first heading", () => {
    expect(headingAnchorAt("plain\ntext", 3)).toBeUndefined();
  });
});
