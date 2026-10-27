// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentReader } from "../src/DocumentReader";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const ANALYSIS = [
  "---",
  "title: Search cache",
  "kind: analysis",
  "status: draft",
  "---",
  "> [!SUMMARY]",
  "> Cache for ten minutes.",
  "",
  "## Context",
  "",
  "Slow calls.",
  "",
  "### Numbers",
  "",
  "## Options",
  "",
  "See [the ADR](adr/007.md).",
].join("\n");
const kinds = { analysis: { when: "x", sections: ["Context", "Options", "Risks"], status: ["proposed", "accepted"] } };

function setup(over: Partial<Parameters<typeof DocumentReader>[0]> = {}, docs: Record<string, string> = { "docs/cache.md": ANALYSIS }) {
  const client = new FakeClient();
  Object.assign(client.documents, docs);
  const props = {
    client,
    target: { path: "docs/cache.md", agent: "Claude" },
    kinds,
    prefs: {},
    onPrefs: vi.fn(),
    full: false,
    onFull: vi.fn(),
    onClose: vi.fn(),
    onOpen: vi.fn(),
    ...over,
  };
  return { client, props, view: renderIn("en", <DocumentReader {...props} />) };
}

describe("DocumentReader (§5.2)", () => {
  it("shows the path as breadcrumbs, the title, the chips, when it changed, the reading time and the agent", async () => {
    setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Search cache" })).toBeTruthy();
    const crumbs = screen.getByRole("navigation", { name: "Path" });
    expect([...crumbs.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["docs", "cache.md"]);
    expect(screen.getByText("analysis")).toBeTruthy();
    expect(screen.getByText("draft")).toBeTruthy();
    expect(screen.getByText("Not one of: proposed, accepted")).toBeTruthy();
    expect(screen.getByText("1 min read")).toBeTruthy();
    expect(screen.getByText("Written by Claude")).toBeTruthy();
    expect(screen.getByText(/^Changed /)).toBeTruthy();
  });

  it("the contents list ## and ###, jump on click, and hold the template note", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    setup();
    const toc = await screen.findByRole("navigation", { name: "Contents" });
    const links = [...toc.querySelectorAll("a")];
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Context", "#context"],
      ["Numbers", "#numbers"],
      ["Options", "#options"],
    ]);
    fireEvent.click(links[2]);
    expect(scroll).toHaveBeenCalled();
    expect(toc.querySelector(".hh-reader-template")?.textContent).toBe("Template analysis: missing section Risks.");
  });

  it("an unknown kind is a grey chip; no kinds declared means no check at all (D0)", async () => {
    setup({ kinds: { adr: { when: "x", sections: ["Status"] } } });
    expect(await screen.findByText("unknown kind")).toBeTruthy();
    cleanup();
    setup({ kinds: undefined });
    await screen.findByRole("heading", { level: 1, name: "Search cache" });
    expect(screen.queryByText("unknown kind")).toBeNull();
    expect(document.querySelector(".hh-reader-template")).toBeNull();
    expect(screen.queryByText(/Not one of/)).toBeNull();
  });

  it("broken front-matter: no chip, and the block never shows as text (§6)", async () => {
    setup({}, { "docs/cache.md": "---\nkind: analysis\nnot yaml here\n---\n# Plain" });
    expect(await screen.findByRole("heading", { name: "Plain" })).toBeTruthy();
    expect(screen.queryByText("analysis")).toBeNull();
    expect(document.body.textContent).not.toContain("not yaml here");
  });

  it("Source shows the raw text, read-only", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Source" }));
    const src = document.querySelector("pre.hh-reader-source");
    expect(src?.textContent).toBe(ANALYSIS);
  });

  it("full screen and close", async () => {
    const { props } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Full screen" }));
    expect(props.onFull).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onClose).toHaveBeenCalled();
    cleanup();
    const again = setup({ full: true });
    fireEvent.click(await screen.findByRole("button", { name: "Show chat" }));
    expect(again.props.onFull).toHaveBeenCalledWith(false);
  });

  it("reading preferences: serif and large, always both fields", async () => {
    const { props } = setup({ prefs: { size: "large" } });
    fireEvent.click(await screen.findByRole("button", { name: "Reading preferences" }));
    fireEvent.click(screen.getByRole("button", { name: "Serif" }));
    expect(props.onPrefs).toHaveBeenCalledWith({ font: "serif", size: "large" });
    expect(document.querySelector(".hh-reader-doc.hh-reader-large")).not.toBeNull();
  });

  it("a .md link opens the linked document, resolved from this one", async () => {
    const { props } = setup();
    fireEvent.click(await screen.findByRole("link", { name: "the ADR" }));
    expect(props.onOpen).toHaveBeenCalledWith("docs/adr/007.md", undefined);
  });

  it("moved or deleted, outside the folder (§6)", async () => {
    setup({ target: { path: "docs/gone.md" } });
    expect(await screen.findByText("This document was moved or deleted.")).toBeTruthy();
    cleanup();
    setup({ target: { path: "../secret.md" } });
    expect(await screen.findByText("This file is outside your folder.")).toBeTruthy();
  });

  it("over 1 MB: the first 200 KB, then the notice", async () => {
    const big = `# Big\n\n${"word ".repeat(300_000)}`;
    setup({ target: { path: "big.md" } }, { "big.md": big });
    expect(await screen.findByText("Showing the first 200 KB of 1.4 MB. Open Source to see all of it.")).toBeTruthy();
  });

  it("live reload: draws the new text and keeps the place at the nearest heading", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = function (this: Element) {
      scroll(this.id);
    };
    const { client } = setup();
    await screen.findByRole("heading", { name: "Options" });
    scroll.mockClear();
    await act(async () => client.changeDocument("docs/cache.md", `${ANALYSIS}\n\n## Risks\n\nNew.`));
    expect(await screen.findByRole("heading", { name: "Risks" })).toBeTruthy();
    await waitFor(() => expect(scroll).toHaveBeenCalledWith("options"));
    expect(document.querySelector(".hh-reader-template")).toBeNull();
  });

  it("live reload of a deleted file says so", async () => {
    const { client } = setup();
    await screen.findByRole("heading", { level: 1, name: "Search cache" });
    await act(async () => client.changeDocument("docs/cache.md", null));
    expect(await screen.findByText("This document was moved or deleted.")).toBeTruthy();
  });
});

describe("DocumentReader: untrusted targets and big documents", () => {
  it("a path that is not a plain relative string is refused without asking main", async () => {
    const { client } = setup({ target: { path: 42 as unknown as string } });
    const read = vi.spyOn(client, "readDocument");
    expect(await screen.findByText("This file is outside your folder.")).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
    expect(screen.getByRole("navigation", { name: "Path" }).querySelectorAll("li").length).toBe(0);
  });

  it("the reading time counts the whole document, not only the part drawn", async () => {
    const big = `# Big\n\n${"word ".repeat(300_000)}`;
    setup({ target: { path: "big.md" } }, { "big.md": big });
    expect(await screen.findByText(`${Math.ceil(300_001 / 230)} min read`)).toBeTruthy();
  });

  it("Escape closes the preferences first, then the reader", async () => {
    const { props } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Reading preferences" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Serif" }), { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Serif" })).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("button", { name: "Source" }), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("applies a changed preference at once, even before the parent passes it back", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Reading preferences" }));
    fireEvent.click(screen.getByRole("button", { name: "Large" }));
    expect(document.querySelector(".hh-reader-doc.hh-reader-large")).not.toBeNull();
  });
});
