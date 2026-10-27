// @vitest-environment happy-dom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Markdown, parseMarkdown } from "../src/markdown";
import { fenceClosed, mermaidWhy } from "../src/mermaid-loader";
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
    expect(m.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: "strict", startOnLoad: false, theme: "base" }));
    expect(m.initialize.mock.calls[0][0].flowchart).toEqual({ htmlLabels: false });
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(screen.getByText(/A --> B/)).toBeTruthy();
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
