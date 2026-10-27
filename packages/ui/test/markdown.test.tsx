// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CitationContext } from "../src/citations";
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
