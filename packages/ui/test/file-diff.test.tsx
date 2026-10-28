// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { Profiler } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileDiffResult, LineChange } from "../src/client";
import { FileDiff, aroundChanges, sideRows } from "../src/FileDiff";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

type Report = (entries: { contentRect: { width: number } }[]) => void;
/** A ResizeObserver whose reports the test sends; `first` is the width it reports on observe (none: no report). */
function stubResize(first?: number): { report: (width: number) => void } {
  let cb: Report | null = null;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(c: Report) {
        cb = c;
      }
      observe() {
        if (first !== undefined) cb?.([{ contentRect: { width: first } }]);
      }
      disconnect() {}
    },
  );
  return { report: (width) => act(() => cb?.([{ contentRect: { width } }])) };
}
const lineDiff = (lines: LineChange[], lang: string | null = null): FileDiffResult => ({ ok: true, kind: "text", same: false, truncated: false, lang, lines });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const A = "a".repeat(40);
const B = "b".repeat(40);
const DOC = "specs/filter.md";
// Unchanged blocks carry `after` only, as main sends them.
const md: FileDiffResult = {
  ok: true,
  kind: "markdown",
  same: false,
  truncated: false,
  blocks: [
    { type: "heading", status: "same", after: "## Scope", depth: 2 },
    {
      type: "paragraph",
      status: "changed",
      before: "Filter by size.",
      after: "Filter by size and colour.",
      parts: [
        { kind: "same", text: "Filter by size" },
        { kind: "del", text: "." },
        { kind: "ins", text: " and colour." },
      ],
    },
    { type: "paragraph", status: "added", after: "The list loads in pages." },
    { type: "paragraph", status: "removed", before: "The list loads at once." },
    { type: "tableRow", status: "same", after: "| a |", cells: { after: ["a"] } },
    { type: "tableRow", status: "changed", before: "| 1 |", after: "| 2 |", cells: { before: ["1"], after: ["2"], parts: [[{ kind: "del", text: "1" }, { kind: "ins", text: "2" }]] } },
  ],
  source: [
    { kind: "same", text: "## Scope", old: 1, new: 1 },
    { kind: "del", text: "Filter by size.", old: 2 },
    { kind: "ins", text: "Filter by size and colour.", new: 2 },
  ],
};

describe("FileDiff (file-timeline spec §4)", () => {
  it("Markdown inline: whole blocks drawn, word marks in a changed block, bars on added and removed ones", async () => {
    const client = new FakeClient();
    client.diffs[`${DOC}|${A}|${B}`] = md;
    await renderIn("en", <FileDiff client={client} path={DOC} from={A} to={B} />);
    const region = await screen.findByRole("region", { name: "Changes" });
    expect(within(region).getByRole("heading", { name: "Scope" })).toBeTruthy();
    expect(region.querySelector("ins")?.textContent).toBe(" and colour.");
    expect(region.querySelector("del")?.textContent).toBe(".");
    expect(region.querySelector(".hh-filediff-added")?.textContent).toContain("The list loads in pages.");
    expect(region.querySelector(".hh-filediff-removed")?.textContent).toContain("The list loads at once.");
    expect(region.querySelectorAll("table tr")).toHaveLength(2);
    expect(region.querySelector("table")?.textContent).toContain("a");
  });

  it("side by side: two columns, before and after, block by block; an unchanged block shows on both sides", async () => {
    const client = new FakeClient();
    client.diffs[`${DOC}|${A}|${B}`] = md;
    await renderIn("en", <FileDiff client={client} path={DOC} from={A} to={B} />);
    fireEvent.click(await screen.findByRole("button", { name: "Side by side" }));
    const region = screen.getByRole("region", { name: "Changes" });
    const before = [...region.querySelectorAll(".hh-filediff-before")];
    const after = [...region.querySelectorAll(".hh-filediff-after")];
    expect(before.length).toBe(after.length);
    expect(before.map((b) => b.textContent).join("")).not.toContain("and colour");
    expect(after.map((b) => b.textContent).join("")).toContain("and colour");
    expect(before[0].textContent).toBe("Scope");
    expect(before[4].textContent).toBe("a");
    expect(after[4].textContent).toBe("a");
  });

  it("side by side falls back to inline when its box is narrower than 900 px", async () => {
    let report: ((entries: { contentRect: { width: number } }[]) => void) | null = null;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: (entries: { contentRect: { width: number } }[]) => void) {
          report = cb;
        }
        observe() {
          report?.([{ contentRect: { width: 600 } }]);
        }
        disconnect() {}
      },
    );
    const client = new FakeClient();
    client.diffs[`${DOC}|${A}|${B}`] = md;
    await renderIn("en", <FileDiff client={client} path={DOC} from={A} to={B} layout="side" />);
    const region = await screen.findByRole("region", { name: "Changes" });
    await screen.findByRole("button", { name: "Side by side" });
    expect(region.querySelector(".hh-filediff-before")).toBeNull();
    expect(screen.getByRole("button", { name: "Side by side" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("the Source toggle shows the raw line diff", async () => {
    const client = new FakeClient();
    client.diffs[`${DOC}|${A}|${B}`] = md;
    await renderIn("en", <FileDiff client={client} path={DOC} from={A} to={B} />);
    fireEvent.click(await screen.findByRole("button", { name: "Source" }));
    expect(screen.getByText("Filter by size and colour.").closest("tr")?.className).toContain("hh-filediff-ins");
  });

  it("a Markdown file main answered as text (the parser fallback) shows lines, with no Source toggle", async () => {
    const client = new FakeClient();
    client.diffs[`${DOC}|${A}|${B}`] = { ok: true, kind: "text", same: false, truncated: false, lang: "md", lines: [{ kind: "ins", text: "[[[[deep", new: 1 }] };
    await renderIn("en", <FileDiff client={client} path={DOC} from={A} to={B} />);
    expect((await screen.findByText("[[[[deep")).closest("tr")?.className).toContain("hh-filediff-ins");
    expect(screen.queryByRole("button", { name: "Source" })).toBeNull();
  });

  it("diff text is never HTML", async () => {
    const client = new FakeClient();
    client.diffs[`a.ts|${A}|${B}`] = { ok: true, kind: "text", same: false, truncated: false, lang: null, lines: [{ kind: "ins", text: "<img src=x onerror=alert(1)>", new: 1 }] };
    await renderIn("en", <FileDiff client={client} path="a.ts" from={A} to={B} />);
    const region = await screen.findByRole("region", { name: "Changes" });
    await screen.findByText("<img src=x onerror=alert(1)>");
    expect(region.querySelector("img")).toBeNull();
  });

  it("text: line numbers; binary: sizes; same: No changes; truncated: a notice; refused: a line", async () => {
    const client = new FakeClient();
    client.diffs[`a.ts|${A}|current`] = { ok: true, kind: "text", same: false, truncated: true, lang: "ts", lines: [{ kind: "del", text: "let a = 1;", old: 1 }, { kind: "ins", text: "let a = 2;", new: 1 }] };
    await renderIn("en", <FileDiff client={client} path="a.ts" from={A} to="current" />);
    expect(await screen.findByText("Only the first 200 KB of each version is compared.")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Changes" }).textContent).toContain("let a = 2;");
    cleanup();
    client.diffs[`a.png|${A}|${B}`] = { ok: true, kind: "binary", same: false, sizes: { before: 2048, after: null } };
    await renderIn("en", <FileDiff client={client} path="a.png" from={A} to={B} />);
    expect(await screen.findByText("Binary file, no preview (2 KB → none)")).toBeTruthy();
    cleanup();
    client.diffs[`b.md|${A}|current`] = { ok: true, kind: "markdown", same: true, truncated: false, blocks: [], source: [] };
    await renderIn("en", <FileDiff client={client} path="b.md" from={A} to="current" />);
    expect(await screen.findByText("No changes")).toBeTruthy();
    cleanup();
    await renderIn("en", <FileDiff client={client} path="c.md" from={A} to={B} />);
    expect(await screen.findByText("I couldn't compare these versions.")).toBeTruthy();
  });

  it("a resize redraws the diff only when it crosses the narrow line", async () => {
    const resize = stubResize();
    const client = new FakeClient();
    client.diffs[`${DOC}|${A}|${B}`] = md;
    let commits = 0;
    await renderIn(
      "en",
      <Profiler id="diff" onRender={() => commits++}>
        <FileDiff client={client} path={DOC} from={A} to={B} layout="side" />
      </Profiler>,
    );
    const region = await screen.findByRole("region", { name: "Changes" });
    await screen.findByRole("button", { name: "Source" });
    await act(async () => {});
    commits = 0;
    resize.report(1000);
    resize.report(1400);
    expect(commits).toBe(0);
    resize.report(600);
    expect(commits).toBe(1);
    expect(region.querySelector(".hh-filediff-before")).toBeNull();
    resize.report(500);
    expect(commits).toBe(1);
    resize.report(950);
    expect(region.querySelector(".hh-filediff-before")).not.toBeNull();
  });

  it("side by side names its columns and every added or removed line or block, not only by colour", async () => {
    const client = new FakeClient();
    client.diffs[`a.ts|${A}|${B}`] = lineDiff([{ kind: "same", text: "keep", old: 1, new: 1 }, { kind: "del", text: "old line", old: 2 }, { kind: "ins", text: "new line", new: 2 }]);
    client.diffs[`${DOC}|${A}|${B}`] = md;
    await renderIn("en", <FileDiff client={client} path="a.ts" from={A} to={B} layout="side" />);
    let region = await screen.findByRole("region", { name: "Changes" });
    await screen.findByText("new line");
    const names = [...region.querySelectorAll(".hh-sr-only")].map((e) => e.textContent);
    expect(names.slice(0, 2)).toEqual(["Before", "After"]);
    expect(screen.getByText("old line").closest(".hh-filediff-before")?.textContent).toBe("−Removedold line");
    expect(screen.getByText("new line").closest(".hh-filediff-after")?.textContent).toBe("+Addednew line");
    expect(screen.getAllByText("keep").map((e) => e.closest(".hh-filediff-before, .hh-filediff-after")?.textContent)).toEqual(["keep", "keep"]);
    cleanup();
    await renderIn("en", <FileDiff client={client} path={DOC} from={A} to={B} layout="side" />);
    region = await screen.findByRole("region", { name: "Changes" });
    expect(region.querySelector(".hh-filediff-before.hh-filediff-removed")?.textContent).toBe("RemovedThe list loads at once.");
    expect(region.querySelector(".hh-filediff-after.hh-filediff-added")?.textContent).toBe("AddedThe list loads in pages.");
  });

  it("inline, an added or removed table row is named for a screen reader", async () => {
    const client = new FakeClient();
    client.diffs[`${DOC}|${A}|${B}`] = { ...md, blocks: [{ type: "tableRow", status: "same", after: "| a |", cells: { after: ["a"] } }, { type: "tableRow", status: "added", after: "| b |", cells: { after: ["b"] } }], source: [] } as FileDiffResult;
    await renderIn("en", <FileDiff client={client} path={DOC} from={A} to={B} />);
    const region = await screen.findByRole("region", { name: "Changes" });
    await screen.findByText("b");
    expect([...region.querySelectorAll("tr")].map((r) => r.textContent)).toEqual(["a", "Addedb"]);
  });

  it("a gap between kept lines says so to a screen reader", async () => {
    const client = new FakeClient();
    client.diffs[`a.ts|${A}|${B}`] = lineDiff([...Array.from({ length: 10 }, (_, i) => ({ kind: "same" as const, text: `s${i}`, old: i + 1, new: i + 1 })), { kind: "ins", text: "y", new: 11 }]);
    await renderIn("en", <FileDiff client={client} path="a.ts" from={A} to={B} />);
    expect(await screen.findByText("Unchanged lines hidden")).toBeTruthy();
  });

  it("over the highlighter's line cap, lines show plain", async () => {
    const client = new FakeClient();
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: "ins" as const, text: "let a = 1;", new: i + 1 }));
    client.diffs[`a.ts|${A}|${B}`] = lineDiff(many(3), "ts");
    client.diffs[`b.ts|${A}|${B}`] = lineDiff(many(3001), "ts");
    await renderIn("en", <FileDiff client={client} path="a.ts" from={A} to={B} />);
    let region = await screen.findByRole("region", { name: "Changes" });
    await screen.findAllByText("1", { exact: false });
    expect(region.querySelector("code span")).not.toBeNull();
    cleanup();
    await renderIn("en", <FileDiff client={client} path="b.ts" from={A} to={B} />);
    region = await screen.findByRole("region", { name: "Changes" });
    await screen.findByText("3001");
    expect(region.querySelectorAll("code")).toHaveLength(3001);
    expect(region.querySelector("code span")).toBeNull();
  }, 30_000);

  it("side by side, a changed code block shows each side's own lines", async () => {
    const client = new FakeClient();
    client.diffs[`${DOC}|${A}|${B}`] = { ...md, blocks: [{ type: "code", status: "changed", before: "x", after: "y", lines: [{ kind: "del", text: "old()", old: 1 }, { kind: "ins", text: "new()", new: 1 }] }], source: [] } as FileDiffResult;
    await renderIn("en", <FileDiff client={client} path={DOC} from={A} to={B} layout="side" />);
    const region = await screen.findByRole("region", { name: "Changes" });
    await screen.findByText("new()");
    expect(region.querySelector(".hh-filediff-before")?.textContent).not.toContain("new()");
    expect(region.querySelector(".hh-filediff-after")?.textContent).not.toContain("old()");
  });

  it("the Source toggle starts off again for another pair of versions", async () => {
    const client = new FakeClient();
    client.diffs[`${DOC}|${A}|${B}`] = md;
    client.diffs[`${DOC}|${A}|current`] = md;
    const { i18n, rerender } = await renderIn("en", <FileDiff client={client} path={DOC} from={A} to={B} />);
    fireEvent.click(await screen.findByRole("button", { name: "Source" }));
    expect(screen.getByRole("button", { name: "Source" }).getAttribute("aria-pressed")).toBe("true");
    rerender(
      <I18nextProvider i18n={i18n}>
        <FileDiff client={client} path={DOC} from={A} to="current" />
      </I18nextProvider>,
    );
    await screen.findByRole("heading", { name: "Scope" });
    expect(screen.getByRole("button", { name: "Source" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("aroundChanges keeps context and marks gaps; sideRows pairs deleted and added lines", () => {
    const lines: LineChange[] = [
      ...Array.from({ length: 10 }, (_, i) => ({ kind: "same" as const, text: `s${i}`, old: i + 1, new: i + 1 })),
      { kind: "del", text: "x", old: 11 },
      { kind: "ins", text: "y", new: 11 },
      { kind: "ins", text: "z", new: 12 },
    ];
    const kept = aroundChanges(lines);
    expect(kept[0]).toBeNull();
    expect(kept.filter((l) => l !== null).map((l) => l!.text)).toEqual(["s7", "s8", "s9", "x", "y", "z"]);
    expect(sideRows(lines.slice(10)).map((r) => [r.left?.text, r.right?.text])).toEqual([
      ["x", "y"],
      [undefined, "z"],
    ]);
  });

  it("a gap main left in (unchanged lines it didn't send) draws as a gap, never as a line, in both layouts", () => {
    const lines: LineChange[] = [
      { kind: "gap", text: "", count: 40 },
      { kind: "same", text: "s41", old: 41, new: 41 },
      { kind: "del", text: "x", old: 42 },
      { kind: "ins", text: "y", new: 42 },
      { kind: "same", text: "s43", old: 43, new: 43 },
      { kind: "gap", text: "", count: 7 },
    ];
    expect(aroundChanges(lines).map((l) => l?.text ?? null)).toEqual([null, "s41", "x", "y", "s43"]);
    const rows = sideRows(lines);
    expect(rows.map((r) => [r.left?.kind, r.right?.kind])).toEqual([
      ["gap", "gap"],
      ["same", "same"],
      ["del", "ins"],
      ["same", "same"],
      ["gap", "gap"],
    ]);
  });
});
