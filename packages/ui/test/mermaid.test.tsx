// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Markdown, parseMarkdown } from "../src/markdown";
import { DRAW_TIMEOUT_MS, drawMermaid, fenceClosed, mermaidAccessible, mermaidWhy } from "../src/mermaid-loader";
import { renderIn } from "./render";

const m = vi.hoisted(() => ({
  loads: 0,
  initialize: vi.fn(),
  parse: vi.fn(async (code: string) => {
    if (code.includes("broken")) throw new Error("Parse error on line 3:\n...A --> \n-------^\nExpecting 'NODE', got 'EOF'");
    return true;
  }),
  render: vi.fn(async (_id: string, code: string) => ({ svg: `<svg xmlns="http://www.w3.org/2000/svg"><text>${code.length}</text></svg>` })),
}));
vi.mock("mermaid", () => {
  m.loads++;
  return { default: { initialize: m.initialize, parse: m.parse, render: m.render } };
});

afterEach(cleanup);

describe("Mermaid (§3.3)", () => {
  it("a chat without diagrams never loads Mermaid", async () => {
    await renderIn("en", <Markdown source={"# Hi\n\n```ts\nx\n```"} />);
    expect(m.loads).toBe(0);
  });

  it("draws a closed diagram as an image, strict, with the app's colours; Source shows the code", async () => {
    await renderIn("en", <Markdown source={"```mermaid\nflowchart LR\n  A --> B\n```\n\n*The flow*"} />);
    const img = await screen.findByRole("img", { name: "The flow" });
    expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(m.loads).toBe(1);
    expect(m.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: "strict", startOnLoad: false, theme: "base", htmlLabels: false, suppressErrorRendering: true }),
    );
    expect(m.initialize.mock.calls[0][0].flowchart).toBeUndefined();
    expect(m.initialize.mock.calls[0][0].secure).toContain("htmlLabels");
    const button = screen.getByRole("button", { name: "Source" });
    expect(button.getAttribute("aria-controls")).toBe(img.id);
    fireEvent.click(button);
    expect(screen.getByText(/A --> B/)).toBeTruthy();
  });

  it("the alt text is the caption, else the diagram's accTitle and accDescr, else Diagram", async () => {
    await renderIn("en", <Markdown source={"```mermaid\nflowchart LR\n  accTitle: Signup\n  accDescr: From form to inbox\n  A --> B\n```"} />);
    expect(await screen.findByRole("img", { name: "Signup: From form to inbox" })).toBeTruthy();
    cleanup();
    await renderIn("en", <Markdown source={"```mermaid\nflowchart LR\n  C --> D\n```"} />);
    expect(await screen.findByRole("img", { name: "Diagram" })).toBeTruthy();
  });

  it("draws at most 20 diagrams per text; the rest stay code", async () => {
    const many = Array.from({ length: 21 }, (_, i) => `\`\`\`mermaid\nflowchart LR\n  N${i} --> M${i}\n\`\`\``).join("\n\n");
    const { container } = await renderIn("en", <Markdown source={many} />);
    expect(container.querySelectorAll("figure.hh-md-diagram")).toHaveLength(20);
    expect(container.querySelector(".hh-md-codeblock")?.textContent).toContain("N20 --> M20");
  });

  it("keeps the drawing on a colour change until the new one arrives", async () => {
    const listeners = new Set<() => void>();
    let dark = false;
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: dark && q.includes("dark"),
      media: q,
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    })) as unknown as typeof window.matchMedia;
    try {
      await renderIn("en", <Markdown source={"```mermaid\nflowchart LR\n  P --> Q\n```"} />);
      const first = (await screen.findByRole("img", { name: "Diagram" })).getAttribute("src");
      let release!: () => void;
      m.render.mockImplementationOnce(async () => {
        await new Promise<void>((r) => {
          release = r;
        });
        return { svg: "<svg xmlns='http://www.w3.org/2000/svg'><text>dark</text></svg>" };
      });
      dark = true;
      // The dark tokens (the stylesheet isn't loaded here): new colours, so not the cached drawing.
      document.documentElement.style.setProperty("--hh-ink", "#eeeeee");
      act(() => listeners.forEach((l) => l()));
      await vi.waitFor(() => expect(release).toBeDefined());
      expect(screen.getByRole("img", { name: "Diagram" }).getAttribute("src")).toBe(first);
      release();
      await vi.waitFor(() => expect(screen.getByRole("img", { name: "Diagram" }).getAttribute("src")).toContain("dark"));
    } finally {
      window.matchMedia = original;
      document.documentElement.style.removeProperty("--hh-ink");
    }
  });

  it("while streaming, an unclosed fence shows its source and is not drawn", async () => {
    m.render.mockClear();
    const { container } = await renderIn("en", <Markdown source={"```mermaid\nflowchart LR\n  A --> B"} fade />);
    expect(container.querySelector("pre")?.textContent).toContain("A --> B");
    expect(m.render).not.toHaveBeenCalled();
  });

  it("a diagram that fails to parse shows its source with one line above it", async () => {
    await renderIn("en", <Markdown source={"```mermaid\nflowchart LR\n  broken\n```"} />);
    expect(await screen.findByText("This diagram could not be drawn (line 3: Expecting 'NODE', got 'EOF'). Showing its source.")).toBeTruthy();
    expect(screen.getByText(/broken/)).toBeTruthy();
  });
});

describe("fenceClosed", () => {
  const code = (src: string) => {
    const tree = parseMarkdown(src);
    const find = (n: { type: string; children?: unknown[] }): unknown =>
      n.type === "code" ? n : (n.children ?? []).map((c) => find(c as never)).find(Boolean);
    return fenceClosed(src, find(tree) as never);
  };
  it("closed, unclosed, longer close, inside a quote", () => {
    expect(code("```mermaid\na\n```")).toBe(true);
    expect(code("```mermaid\na")).toBe(false);
    expect(code("```mermaid\n")).toBe(false);
    expect(code("````mermaid\na\n```")).toBe(false);
    expect(code("~~~mermaid\na\n~~~~")).toBe(true);
    expect(code("> ```mermaid\n> a\n> ```")).toBe(true);
  });
  it("is linear on long blank lines", () => {
    const start = performance.now();
    expect(code(`\`\`\`mermaid\na\n${" ".repeat(50_000)}x`)).toBe(false);
    expect(code(`\`\`\`mermaid\na\n\`\`\`${" ".repeat(50_000)}x`)).toBe(false);
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe("mermaidWhy", () => {
  it("the line and the last line of the message", () => {
    expect(mermaidWhy(new Error("Parse error on line 3:\nx\nExpecting 'A'"))).toBe("line 3: Expecting 'A'");
    expect(mermaidWhy("Lexical error")).toBe("Lexical error");
  });
});

describe("drawMermaid", () => {
  it("draws the same code with the same colours once (cache)", async () => {
    m.render.mockClear();
    const a = await drawMermaid("flowchart LR\n  cache --> hit", { textColor: "#111" });
    const b = await drawMermaid("flowchart LR\n  cache --> hit", { textColor: "#111" });
    expect(b).toEqual(a);
    expect(m.render).toHaveBeenCalledTimes(1);
    await drawMermaid("flowchart LR\n  cache --> hit", { textColor: "#eee" });
    expect(m.render).toHaveBeenCalledTimes(2);
  });

  it("skips a draw nobody wants any more when its turn comes", async () => {
    m.render.mockClear();
    expect(await drawMermaid("flowchart LR\n  gone --> away", {}, () => false)).toEqual({ ok: false, skipped: true });
    expect(m.render).not.toHaveBeenCalled();
  });

  it("gives up a draw that takes too long, and the next one still runs", async () => {
    vi.useFakeTimers();
    try {
      m.render.mockImplementationOnce(() => new Promise(() => undefined));
      const stuck = drawMermaid("flowchart LR\n  stuck --> forever", {});
      await vi.advanceTimersByTimeAsync(DRAW_TIMEOUT_MS);
      expect(await stuck).toEqual({ ok: false, slow: true });
      expect(await drawMermaid("flowchart LR\n  after --> it", {})).toMatchObject({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("mermaidAccessible", () => {
  it("reads accTitle and accDescr; linear on long lines", () => {
    expect(mermaidAccessible("flowchart LR\n  accTitle : A title \n  accDescr: Words\n  A --> B")).toEqual({ title: "A title", description: "Words" });
    expect(mermaidAccessible("flowchart LR\n  A --> B")).toEqual({});
    const start = performance.now();
    mermaidAccessible(`accTitle${" ".repeat(50_000)}x`);
    expect(performance.now() - start).toBeLessThan(500);
  });
});
