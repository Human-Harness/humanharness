// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CitationContext } from "../src/citations";
import { DocumentContext } from "../src/documents-context";
import { highlightCode } from "../src/highlight";
import { Markdown, markdownToPlain } from "../src/markdown";
import { Message } from "../src/Message";
import { renderIn } from "./render";

afterEach(cleanup);

const md = (text: string) => render(<div>{<Markdown source={text} />}</div>).container.firstElementChild as HTMLElement;
const actions = { respond: () => true, choose: () => true, open: async () => true, reveal: async () => true, active: false };

describe("Markdown", () => {
  it("splits paragraphs on blank lines and keeps single line breaks", () => {
    const el = md("First line\nsecond line\n\nNext paragraph");
    const ps = el.querySelectorAll("p");
    expect(ps).toHaveLength(2);
    expect(ps[0].innerHTML).toBe("First line<br>second line");
    expect(ps[1].textContent).toBe("Next paragraph");
  });

  it("renders inline code, bold and italics", () => {
    const el = md("Use `defineHarness` with **all *fields*** and _care_ or __this__, not snake_case_name nor 2 * 3 * 4.");
    expect(el.querySelector("code")?.textContent).toBe("defineHarness");
    expect(el.querySelector("strong")?.textContent).toBe("all fields");
    expect(el.querySelector("strong em")?.textContent).toBe("fields");
    expect([...el.querySelectorAll("em")].map((e) => e.textContent)).toEqual(["fields", "care"]);
    expect([...el.querySelectorAll("strong")].map((e) => e.textContent)).toEqual(["all fields", "this"]);
    expect(el.textContent).toContain("snake_case_name nor 2 * 3 * 4.");
  });

  it("keeps Markdown marks inside code as text", () => {
    const el = md("`**not bold**` and ``a ` b``");
    expect(el.querySelector("strong")).toBeNull();
    expect([...el.querySelectorAll("code")].map((c) => c.textContent)).toEqual(["**not bold**", "a ` b"]);
  });

  it("renders bulleted lists, also right after a paragraph line", () => {
    const el = md("**What it checks**\nIn the file:\n- one `a`\n* two\n+ three\n  continued");
    expect(el.querySelector("p strong")?.textContent).toBe("What it checks");
    const items = [...el.querySelectorAll("ul > li")];
    expect(items.map((li) => li.textContent)).toEqual(["one a", "two", "threecontinued"]);
    expect(items[0].querySelector("code")?.textContent).toBe("a");
    expect(items[2].innerHTML).toBe("three<br>continued");
  });

  it("renders numbered lists with their start", () => {
    const el = md("1. first\n2. second\n\n3) third");
    const lists = el.querySelectorAll("ol");
    expect(lists).toHaveLength(2);
    expect([...lists[0].querySelectorAll("li")].map((li) => li.textContent)).toEqual(["first", "second"]);
    expect(lists[0].getAttribute("start")).toBeNull();
    expect(lists[1].getAttribute("start")).toBe("3");
  });

  it("renders fenced code blocks verbatim, also unclosed while streaming", () => {
    const el = md("Before\n```ts\nconst a = **b**;\n\n<b>x</b>\n```\nAfter");
    expect(el.querySelector("pre > code")?.textContent).toBe("const a = **b**;\n\n<b>x</b>");
    expect(el.querySelector("pre strong, pre b")).toBeNull();
    expect([...el.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["Before", "After"]);
    expect(md("```\nhalf").querySelector("pre")?.textContent).toBe("half");
  });

  it("draws real headings # to #### with deduplicated anchor ids; ##### stays a bold line", () => {
    const el = render(<Markdown source={"# Top\n## The **manifest**\n## The manifest\n#### Four\n##### Five"} idPrefix="" />).container;
    expect([...el.querySelectorAll("h1,h2,h3,h4")].map((h) => [h.tagName, h.id, h.textContent])).toEqual([
      ["H1", "top", "Top"],
      ["H2", "the-manifest", "The manifest"],
      ["H2", "the-manifest-1", "The manifest"],
      ["H4", "four", "Four"],
    ]);
    expect(el.querySelector("p.hh-md-heading > strong")?.textContent).toBe("Five");
  });

  it("prefixes ids per message, so two answers never share one", () => {
    const { container } = render(
      <>
        <Markdown source="## Same" />
        <Markdown source="## Same" />
      </>,
    );
    const ids = [...container.querySelectorAll("h2")].map((h) => h.id);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids.every((id) => id.endsWith("same"))).toBe(true);
  });

  it("draws GFM tables in a scrolling box, right-aligned columns with tabular numbers", () => {
    const el = md("| Option | Cost |\n|:--|--:|\n| A | 10 |\n| B | 200 |");
    const box = el.querySelector(".hh-md-table");
    expect(box?.getAttribute("role")).toBe("region");
    expect(box?.getAttribute("tabindex")).toBe("0");
    expect([...el.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["Option", "Cost"]);
    expect([...el.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((c) => c.textContent))).toEqual([["A", "10"], ["B", "200"]]);
    expect(el.querySelectorAll("td.hh-num")).toHaveLength(2);
    expect(el.querySelector("th.hh-num")?.textContent).toBe("Cost");
  });

  it("task lists are read-only checkboxes", () => {
    const el = md("- [x] done\n- [ ] to do");
    const boxes = [...el.querySelectorAll<HTMLInputElement>("li input[type=checkbox]")];
    expect(boxes.map((b) => [b.checked, b.disabled])).toEqual([[true, true], [false, true]]);
    expect(screen.getByRole("checkbox", { name: "done" })).toBe(boxes[0]);
    expect(screen.getByRole("checkbox", { name: "to do" })).toBe(boxes[1]);
  });

  it("while an answer arrives, a trailing '- ' or '=' line never turns the paragraph into a heading", () => {
    const streaming = render(<Markdown source={"Options:\n- "} fade />).container;
    expect(streaming.querySelector("h1,h2")).toBeNull();
    expect(streaming.textContent).toBe("Options:");
    expect(render(<Markdown source={"Title\n==="} fade />).container.querySelector("h1")).toBeNull();
    // Finished text is CommonMark as written.
    expect(render(<Markdown source={"Title\n---"} />).container.querySelector("h2")?.textContent).toBe("Title");
    // Once more text follows, the list item is a list item.
    expect(render(<Markdown source={"Options:\n- a"} fade />).container.querySelector("ul > li")?.textContent).toBe("a");
  });

  it("strikethrough", () => {
    expect(md("~~gone~~").querySelector("del")?.textContent).toBe("gone");
  });

  it("a document hides its front-matter and keeps soft line breaks as spaces", () => {
    const el = render(<Markdown source={"---\ntitle: T\nkind: adr\n---\nOne\ntwo"} document />).container;
    expect(el.textContent).not.toContain("title:");
    expect(el.querySelector("p")?.innerHTML).toBe("One\ntwo");
  });

  it("parses long runs of spaces without stalling", () => {
    const start = Date.now();
    md(`# x${" ".repeat(50_000)}y\n\n- a${" ".repeat(50_000)}b\n\n| a${" ".repeat(50_000)}| b |\n|--|--|`);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("keeps raw HTML as text", () => {
    const el = md('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)"> **<b>bold</b>**\n- <a href="https://x">a</a>');
    expect(el.querySelector("script, img, b, a")).toBeNull();
    expect(el.querySelectorAll("[onerror]")).toHaveLength(0);
    expect(el.textContent).toContain("<script>alert(1)</script>");
    expect(el.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(el.querySelector("strong")?.textContent).toBe("<b>bold</b>");
    expect(el.querySelector("li")?.textContent).toBe('<a href="https://x">a</a>');
  });
});

describe("markdownToPlain", () => {
  it("drops the marks for screen readers", () => {
    expect(markdownToPlain("# Title\n\nUse `x` and **bold** _it_.\n- a\n- b\n\n2. c\n\n```\ncode\n```\n[docs](https://e.com)")).toBe(
      "Title\n\nUse x and bold it.\n\na\nb\n\n2. c\n\ncode\n\ndocs (https://e.com)",
    );
  });
});

describe("Message", () => {
  it("renders the agent's Markdown and keeps the user's text plain", async () => {
    const entry = (role: "user" | "assistant") => ({ role, text: "**hi** `x`", blocks: [], activities: [] });
    const agent = await renderIn("en", <Message entry={entry("assistant")} components={{}} actions={actions} />);
    expect(agent.container.querySelector("strong")?.textContent).toBe("hi");
    expect(agent.container.querySelector("code")?.textContent).toBe("x");
    cleanup();
    const user = await renderIn("en", <Message entry={entry("user")} components={{}} actions={actions} />);
    expect(user.container.querySelector("strong, code")).toBeNull();
    expect(user.container.querySelector("p")?.textContent).toBe("**hi** `x`");
  });
});

describe("citations (material spec §9)", () => {
  it("[[frag:id]] is a button with the source and the location; clicking opens it", async () => {
    const opened: string[] = [];
    const cite = { label: async (id: string) => (id === "ch2-007" ? "ch2.pdf, p.4–5" : null), open: (id: string) => void opened.push(id) };
    render(
      <CitationContext.Provider value={cite}>
        <Markdown source="Equivalent fractions name the same amount [[frag:ch2-007]]." />
      </CitationContext.Provider>,
    );
    const button = await screen.findByRole("button", { name: "ch2.pdf, p.4–5" });
    fireEvent.click(button);
    expect(opened).toEqual(["ch2-007"]);
  });

  it("without material the text stays as it is (D0)", () => {
    render(<Markdown source="Look [[frag:ch2-007]]." />);
    expect(screen.getByText("Look [[frag:ch2-007]].")).toBeTruthy();
  });

  it("an unknown fragment stays text", async () => {
    render(
      <CitationContext.Provider value={{ label: async () => null, open: () => {} }}>
        <Markdown source="See [[frag:zz-001]]." />
      </CitationContext.Provider>,
    );
    expect(await screen.findByText("[[frag:zz-001]]", { exact: false })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("plain text until the label arrives; the button says it opens the original", async () => {
    let arrive: (l: string) => void = () => {};
    const label = new Promise<string>((r) => {
      arrive = r;
    });
    await renderIn(
      "en",
      <CitationContext.Provider value={{ label: () => label, open: () => {} }}>
        <Markdown source="Same [[frag:ch2-001]]." />
      </CitationContext.Provider>,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("[[frag:ch2-001]]", { exact: false })).toBeTruthy();
    arrive("ch2.pdf, p.1");
    const button = await screen.findByRole("button", { name: "ch2.pdf, p.1" });
    expect(button.getAttribute("title")).toBe("Open the original");
    expect(button.getAttribute("aria-description")).toBe("Open the original");
  });

  it("read aloud: a citation is its label when known, else left out; code keeps it", () => {
    const text = "Same amount [[frag:ch2-001]]. Also [[frag:ch3-002]].\n\n```\n[[frag:ch2-001]]\n```";
    expect(markdownToPlain(text, (id) => (id === "ch2-001" ? "ch2.pdf, p.4" : undefined))).toBe("Same amount (ch2.pdf, p.4). Also.\n\n[[frag:ch2-001]]");
    expect(markdownToPlain("See [[frag:ch2-001]].")).toBe("See.");
  });

  it("a citation inside bold; a malformed one stays text", async () => {
    render(
      <CitationContext.Provider value={{ label: async () => "ch2.pdf, p.1", open: () => {} }}>
        <Markdown source="**See [[frag:ch2-001]]** and [[frag:Bad id]]." />
      </CitationContext.Provider>,
    );
    expect(await screen.findByRole("button", { name: "ch2.pdf, p.1" })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});

describe("callouts, captions, footnotes (§3.2)", () => {
  it("draws each of the six callouts as a labelled box; the marker is gone", async () => {
    const src = ["NOTE", "TIP", "WARNING", "SUMMARY", "DECISION", "QUESTION"].map((c) => `> [!${c}]\n> Body of ${c.toLowerCase()}.`).join("\n\n");
    const { container } = await renderIn("en", <Markdown source={src} />);
    const boxes = [...container.querySelectorAll(".hh-callout")];
    expect(boxes.map((b) => b.className)).toEqual([
      "hh-callout hh-callout-note",
      "hh-callout hh-callout-tip",
      "hh-callout hh-callout-warning",
      "hh-callout hh-callout-summary",
      "hh-callout hh-callout-decision",
      "hh-callout hh-callout-question",
    ]);
    expect(boxes.map((b) => b.querySelector(".hh-callout-label")?.textContent)).toEqual(["Note", "Tip", "Warning", "Summary", "Decision", "Question"]);
    expect(boxes[0].getAttribute("role")).toBe("note");
    expect(container.textContent).not.toContain("[!");
    expect(boxes[3].textContent).toContain("Body of summary.");
  });

  it("is case-insensitive; an unknown marker stays a plain quote", async () => {
    const { container } = await renderIn("en", <Markdown source={"> [!note] lower\n\n> [!CAUTION]\n> GitHub has it, we do not"} />);
    expect(container.querySelectorAll(".hh-callout")).toHaveLength(1);
    expect(container.querySelector(".hh-callout")?.textContent).toContain("lower");
    expect(container.querySelector("blockquote")?.textContent).toContain("[!CAUTION]");
    expect(container.querySelector("blockquote")?.className).toBe("hh-md-quote");
  });

  it("keeps inline content after the marker", async () => {
    const { container } = await renderIn("en", <Markdown source={"> [!TIP]\n> Use **bold** here."} />);
    const box = container.querySelector(".hh-callout-tip")!;
    expect(box.querySelector("strong")?.textContent).toBe("bold");
    expect(box.textContent).toContain("Use bold here.");
  });

  it("checks a long first line quickly (no backtracking)", async () => {
    const start = performance.now();
    await renderIn("en", <Markdown source={`> [!NOTE${" ".repeat(50000)}x`} />);
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it("an italic paragraph right after a table is its caption; elsewhere it is plain", () => {
    const el = md("| a |\n|---|\n| 1 |\n\n*Costs per month*\n\n*Not a caption*");
    const ps = [...el.querySelectorAll("p")];
    expect(ps[0].className).toBe("hh-md-caption");
    expect(ps[1].className).toBe("");
  });

  it("footnotes: numbered references, a list at the end, links there and back", async () => {
    const { container } = await renderIn("en", <Markdown source={"First[^b] and second[^a].\n\n[^a]: Alpha.\n[^b]: Beta."} idPrefix="" />);
    const refs = [...container.querySelectorAll("sup a")];
    expect(refs.map((a) => [a.textContent, a.getAttribute("href"), a.id])).toEqual([
      ["1", "#fn:b", "fnref:b"],
      ["2", "#fn:a", "fnref:a"],
    ]);
    const items = [...container.querySelectorAll(".hh-md-footnotes li")];
    expect(items.map((li) => [li.id, li.textContent?.replace("↩", "").trim()])).toEqual([
      ["fn:b", "Beta."],
      ["fn:a", "Alpha."],
    ]);
    expect(items[0].querySelector("a.hh-md-back")?.getAttribute("href")).toBe("#fnref:b");
    expect(items[0].querySelector("a.hh-md-back")?.getAttribute("aria-label")).toBe("Back to the text");
  });

  it("a second reference to the same note reuses its number; only the first gets the back-link id", async () => {
    const { container } = await renderIn("en", <Markdown source={"A[^a] B[^a].\n\n[^a]: Alpha."} idPrefix="" />);
    const refs = [...container.querySelectorAll("sup a")];
    expect(refs.map((a) => [a.textContent, a.id])).toEqual([
      ["1", "fnref:a"],
      ["1", ""],
    ]);
    expect(container.querySelectorAll(".hh-md-footnotes li")).toHaveLength(1);
  });

  it("a note referenced only from another note is listed too", async () => {
    const { container } = await renderIn("en", <Markdown source={"Text[^a].\n\n[^a]: See[^b].\n[^b]: Beta."} idPrefix="" />);
    expect([...container.querySelectorAll(".hh-md-footnotes li")].map((li) => li.id)).toEqual(["fn:a", "fn:b"]);
  });

  it("footnote ids never collide with a heading's id", async () => {
    const { container } = await renderIn("en", <Markdown source={"# Fn x\n\nText[^x].\n\n[^x]: Note."} idPrefix="" />);
    const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(ids).toEqual(["fn-x", "fnref:x", "fn:x"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names each reference by its number and each callout by its label", async () => {
    const { container } = await renderIn("en", <Markdown source={"Text[^a].\n\n[^a]: Note.\n\n> [!TIP]\n> Body."} />);
    expect(screen.getByRole("link", { name: "Footnote 1" })).toBeTruthy();
    expect(screen.getByRole("note", { name: "Tip" })).toBe(container.querySelector(".hh-callout"));
  });

  it("finds definitions nested in a quote or a list", async () => {
    const { container } = await renderIn("en", <Markdown source={"A[^q] B[^l].\n\n> [^q]: In a quote.\n\n- [^l]: In a list."} idPrefix="" />);
    expect([...container.querySelectorAll(".hh-md-footnotes li")].map((li) => li.textContent?.replace("↩", "").trim())).toEqual(["In a quote.", "In a list."]);
  });

  it("a note that references itself, and two notes that reference each other, end", async () => {
    const self = await renderIn("en", <Markdown source={"A[^a].\n\n[^a]: See[^a]."} idPrefix="" />);
    expect(self.container.querySelectorAll(".hh-md-footnotes li")).toHaveLength(1);
    expect([...self.container.querySelectorAll("sup a")].map((a) => [a.textContent, a.id])).toEqual([
      ["1", "fnref:a"],
      ["1", ""],
    ]);
    cleanup();
    const loop = await renderIn("en", <Markdown source={"A[^a].\n\n[^a]: See[^b].\n[^b]: See[^a]."} idPrefix="" />);
    expect([...loop.container.querySelectorAll(".hh-md-footnotes li")].map((li) => li.id)).toEqual(["fn:a", "fn:b"]);
    expect([...loop.container.querySelectorAll("sup a")].map((a) => a.textContent)).toEqual(["1", "2", "1"]);
  });

  it("an italic paragraph right after a Mermaid diagram is its caption", () => {
    const el = md("```mermaid\ngraph TD; A-->B\n```\n\n*The flow*");
    expect(el.querySelector("p")?.className).toBe("hh-md-caption");
    expect(el.querySelector(".hh-md-caption")?.textContent).toBe("The flow");
  });

  it("numbers footnotes afresh on every draw", async () => {
    const { container, rerender, i18n } = await renderIn("en", <Markdown source={"A[^a] B[^b].\n\n[^a]: x\n[^b]: y"} idPrefix="" />);
    expect([...container.querySelectorAll("sup a")].map((a) => a.textContent)).toEqual(["1", "2"]);
    rerender(
      <I18nextProvider i18n={i18n}>
        <Markdown source={"B[^b] A[^a].\n\n[^a]: x\n[^b]: y"} idPrefix="" />
      </I18nextProvider>,
    );
    expect([...container.querySelectorAll("sup a")].map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["1", "#fn:b"],
      ["2", "#fn:a"],
    ]);
  });

  it("a footnote never referenced is not listed", () => {
    expect(md("Text.\n\n[^x]: Lonely.").querySelector(".hh-md-footnotes")).toBeNull();
  });
});

describe("links and images (§3.4)", () => {
  const host = (over: Partial<{ open: (p: string, a?: string) => void; image: (p: string) => Promise<string | null> }> = {}) => ({
    open: vi.fn(),
    image: vi.fn(async () => null),
    ...over,
  });

  it("an external link opens in the browser (target _blank) and shows its domain", () => {
    const el = md("See [the docs](https://example.com/x).");
    const a = el.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://example.com/x");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noreferrer noopener");
    expect(el.textContent).toBe("See the docs (example.com).");
  });

  it("a bare URL is a link too, shown once", () => {
    const el = md("Go to https://example.com now");
    expect(el.querySelector("a")?.getAttribute("href")).toBe("https://example.com/");
    expect(el.textContent).toBe("Go to https://example.com now");
  });

  it("www and email autolinks show only their label", () => {
    const el = md("See www.example.com or <https://a.org/x> or write to a@b.co.");
    expect(el.querySelector("a")?.getAttribute("href")).toBe("http://www.example.com/");
    expect(el.textContent).toBe("See www.example.com or https://a.org/x or write to a@b.co.");
  });

  it("other schemes are plain text with their URL, as before", () => {
    const el = md("[js](javascript:alert(1)) and [f](file:///etc/passwd)");
    expect(el.querySelector("a")).toBeNull();
    expect(el.textContent).toBe("js (javascript:alert(1)) and f (file:///etc/passwd)");
  });

  it("a reference definition to javascript: is plain text too", () => {
    const el = md("Click [x] or [y][x].\n\n[x]: javascript:alert(1)");
    expect(el.querySelector("a")).toBeNull();
    expect(el.textContent).toBe("Click x (javascript:alert(1)) or y (javascript:alert(1)).");
  });

  it("a relative .md opens the reader through the context, resolved from the document", () => {
    const h = host();
    const { container } = render(
      <DocumentContext.Provider value={h}>
        <Markdown source="Read [ADR 7](../adr/007.md#context)." path="docs/notes/a.md" document />
      </DocumentContext.Provider>,
    );
    fireEvent.click(container.querySelector("a")!);
    expect(h.open).toHaveBeenCalledWith("docs/adr/007.md", "context");
  });

  it("without a context a .md link is plain text", () => {
    const el = md("[ADR](adr.md)");
    expect(el.querySelector("a")).toBeNull();
    expect(el.textContent).toBe("ADR (adr.md)");
  });

  it("#anchor scrolls to the heading with this text's prefix", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { container } = render(<Markdown source={"[Risks](#risks)\n\n## Risks"} idPrefix="p-" />);
    fireEvent.click(container.querySelector("a")!);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(container.querySelector("#p-risks")).not.toBeNull();
  });

  it("a local image is read through the context; a refusal shows its alt text", async () => {
    const h = host({ image: vi.fn(async (p: string) => (p === "docs/a.png" ? "data:image/png;base64,AAA" : null)) });
    render(
      <DocumentContext.Provider value={h}>
        <Markdown source={"![Chart](a.png) ![Gone](b.png)"} path="docs/x.md" document />
      </DocumentContext.Provider>,
    );
    expect((await screen.findByRole("img", { name: "Chart" })).getAttribute("src")).toBe("data:image/png;base64,AAA");
    expect(await screen.findByText("Gone")).toBeTruthy();
  });

  it("a remote image is a link with its domain, never loaded", () => {
    const el = md("![Logo](https://cdn.x.com/l.png)");
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("a")?.getAttribute("href")).toBe("https://cdn.x.com/l.png");
    expect(el.textContent).toBe("Logo (cdn.x.com)");
  });
});

describe("code blocks (§3.2)", () => {
  it("highlights a known language from a tree of spans, with its label and Copy", async () => {
    // happy-dom's navigator.clipboard is a getter, so its method is spied instead of replaced.
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const { container } = await renderIn("en", <Markdown source={"```ts\nconst a = 1;\n```"} />);
    expect(container.querySelector("pre > code")?.textContent).toBe("const a = 1;");
    expect(container.querySelector("pre span.hljs-keyword")?.textContent).toBe("const");
    expect(container.querySelector(".hh-md-codelabel")?.textContent).toBe("ts");
    const button = screen.getByRole("button", { name: "Copy ts" });
    expect(button.textContent).toBe("Copy");
    vi.useFakeTimers();
    try {
      fireEvent.click(button);
      await act(async () => {});
      expect(write).toHaveBeenCalledWith("const a = 1;");
      expect(button.textContent).toBe("Copied");
      expect(container.querySelector("[aria-live=polite]")?.textContent).toBe("Copied");
      act(() => void vi.advanceTimersByTime(2000));
      expect(button.textContent).toBe("Copy");
      expect(container.querySelector("[aria-live=polite]")?.textContent).toBe("");
    } finally {
      vi.useRealTimers();
      write.mockRestore();
    }
  });

  it("a block without a label is named Copy code; a refused copy says so", async () => {
    const write = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    const { container } = await renderIn("en", <Markdown source={"    indented"} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Copy code" }).textContent).toBe("Couldn't copy");
    expect(container.querySelector("[aria-live=polite]")?.textContent).toBe("Couldn't copy");
    write.mockRestore();
  });

  it("a block too large is plain text", async () => {
    const lines = Array.from({ length: 3001 }, () => "const a = 1;").join("\n");
    const { container } = await renderIn("en", <Markdown source={"```ts\n" + lines + "\n```"} />);
    expect(container.querySelector("pre span")).toBeNull();
    expect(highlightCode("ts", "x".repeat(100_001))).toBeNull();
    expect(highlightCode("ts", "const a = 1;")).not.toBeNull();
  });

  it("a block still arriving is highlighted only once its fence closes", async () => {
    const open = await renderIn("en", <Markdown fade source={"```ts\nconst a = 1;"} />);
    expect(open.container.querySelector("pre span")).toBeNull();
    expect(open.container.querySelector("pre")?.textContent).toBe("const a = 1;");
    cleanup();
    const closed = await renderIn("en", <Markdown fade source={"```ts\nconst a = 1;\n```"} />);
    expect(closed.container.querySelector("pre span.hljs-keyword")?.textContent).toBe("const");
  });

  it("a title in the info string is the label; an unknown language stays plain text", async () => {
    const { container } = await renderIn("en", <Markdown source={'```cobol title="src/pay.cbl"\nMOVE A TO B.\n```'} />);
    expect(container.querySelector(".hh-md-codelabel")?.textContent).toBe("src/pay.cbl");
    expect(container.querySelector("pre span")).toBeNull();
  });

  it("HTML inside highlighted code stays text", async () => {
    const { container } = await renderIn("en", <Markdown source={"```html\n<img src=x onerror=alert(1)>\n```"} />);
    expect(container.querySelector("pre img")).toBeNull();
    expect(container.querySelector("pre")?.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("a long unclosed title in the info string is read in linear time", async () => {
    const started = performance.now();
    await renderIn("en", <Markdown source={"```ts title=\"" + " ".repeat(50_000) + "\nx\n```"} />);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
