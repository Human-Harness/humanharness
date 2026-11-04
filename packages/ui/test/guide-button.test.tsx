// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { type ComponentType, createElement } from "react";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "../src/guide/Button";
import { IconButton } from "../src/guide/IconButton";
import { GUIDE_CLASSES } from "../src/guide/classes";
import { css, rule } from "./guide-css";

afterEach(cleanup);

/** The value of a token declared in the first `:root` block. */
const token = (name: string) => rule(":root")[name];
/** A declaration value with its `var(--hh-x)` resolved to the token's value. */
const px = (value: string | undefined) => {
  const m = /^var\((--[\w-]+)\)$/.exec(value ?? "");
  return m ? token(m[1]) : value;
};

describe("Button (style guide §3)", () => {
  it.each(["primary", "secondary", "quiet", "danger", "link", "large"] as const)("kind %s renders a button with data-kind", (kind) => {
    // The union is typed per kind (see the @ts-expect-error cases below); here the kind is data.
    render(createElement(Button as ComponentType<Record<string, unknown>>, { kind, onConfirm: () => {} }, "Go"));
    const b = screen.getByRole("button", { name: "Go" });
    expect(b.tagName).toBe("BUTTON");
    expect(b.getAttribute("data-kind")).toBe(kind);
    expect(b.classList.contains("hh-btn")).toBe(true);
  });

  it("is a secondary of normal size by default and compact on request", () => {
    render(
      <>
        <Button>Normal</Button>
        <Button size="compact">Compact</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Normal" }).getAttribute("data-kind")).toBe("secondary");
    expect(screen.getByRole("button", { name: "Normal" }).getAttribute("data-size")).toBe("normal");
    expect(screen.getByRole("button", { name: "Compact" }).getAttribute("data-size")).toBe("compact");
  });

  it("with href it is an anchor, a secondary that opens outside", () => {
    render(
      <Button href="https://example.com" target="_blank" rel="noopener noreferrer">
        Support
      </Button>,
    );
    const a = screen.getByRole("link", { name: "Support" });
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toBe("https://example.com");
    expect(a.getAttribute("data-kind")).toBe("secondary");
    expect(a.getAttribute("data-size")).toBe("normal");
  });

  it("draws the icon left of the text", () => {
    render(<Button icon="add">New task</Button>);
    const b = screen.getByRole("button", { name: "New task" });
    expect(b.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(b.firstElementChild?.classList.contains("hh-icon-add")).toBe(true);
    expect(b.firstElementChild?.getAttribute("width")).toBe("18");
    expect(b.textContent).toBe("New task");
  });

  it("busy sets aria-busy, shows the loading icon and the busy text, and disables it", () => {
    const onClick = vi.fn();
    render(
      <Button busy busyText="Saving…" onClick={onClick}>
        Save
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Saving…" });
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(b.querySelector(".hh-icon-loading")).not.toBeNull();
    expect(b.textContent).toBe("Saving…");
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("is not busy by default and disabled disables it", () => {
    render(
      <>
        <Button>Idle</Button>
        <Button disabled>Off</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Idle" }).hasAttribute("aria-busy")).toBe(false);
    expect((screen.getByRole("button", { name: "Off" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("passes type, ref and extra classes through and runs onClick", () => {
    const onClick = vi.fn();
    const ref = { current: null as HTMLButtonElement | null };
    render(
      <Button ref={ref} type="submit" className="extra" onClick={onClick}>
        Send
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Send" });
    expect(ref.current).toBe(b);
    expect(b.getAttribute("type")).toBe("submit");
    expect(b.className).toBe("hh-btn extra");
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("large has no compact size and draws next after the text when arrow is set (rows 20, 83)", () => {
    render(
      <>
        {/* @ts-expect-error large has one size */}
        <Button kind="large" size="compact" arrow>
          Start
        </Button>
        <Button kind="large">Plain</Button>
      </>,
    );
    const b = screen.getByRole("button", { name: "Start" });
    expect(b.getAttribute("data-size")).toBe("normal");
    expect(b.lastElementChild?.classList.contains("hh-icon-next")).toBe(true);
    expect(b.lastElementChild?.getAttribute("width")).toBe("18");
    expect(screen.getByRole("button", { name: "Plain" }).querySelector("svg")).toBeNull();
  });

  it("danger takes onConfirm and the first click never calls it (§3 Danger)", () => {
    const onConfirm = vi.fn();
    render(
      <>
        <Button kind="danger" onConfirm={onConfirm}>
          Delete
        </Button>
        {/* @ts-expect-error a danger button takes onConfirm, not onClick */}
        <Button kind="danger" onClick={() => {}}>
          Broken
        </Button>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete" }).getAttribute("data-kind")).toBe("danger");
  });
});

describe("IconButton (style guide §3 Icon)", () => {
  it("has aria-label and title equal to the label, and the icon at 18", () => {
    render(<IconButton icon="search" label="Search (⌘K)" />);
    const b = screen.getByRole("button", { name: "Search (⌘K)" });
    expect(b.getAttribute("aria-label")).toBe("Search (⌘K)");
    expect(b.getAttribute("title")).toBe("Search (⌘K)");
    expect(b.getAttribute("type")).toBe("button");
    expect(b.textContent).toBe("");
    const svg = b.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("18");
    expect(svg.classList.contains("hh-icon-search")).toBe(true);
    expect(b.getAttribute("data-size")).toBe("normal");
  });
  it("takes a compact size, a ref and what is drawn over it", () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(
      <IconButton ref={ref} icon="bell" label="Notices" size="compact" aria-expanded={false}>
        <span data-testid="count">3</span>
      </IconButton>,
    );
    const b = screen.getByRole("button", { name: "Notices" });
    expect(ref.current).toBe(b);
    expect(b.getAttribute("data-size")).toBe("compact");
    expect(b.querySelector('[data-testid="count"]')).not.toBeNull();
  });
});

describe("Button and IconButton CSS (style guide §2, §3)", () => {
  it("normal is 40 high with radius 12", () => {
    const r = rule('.hh-btn[data-size="normal"]');
    expect(px(r.height)).toBe("40px");
    expect(px(r["border-radius"])).toBe("12px");
  });
  it("compact is 30 high, radius 8, 13 px at weight 500", () => {
    const r = rule('.hh-btn[data-size="compact"]');
    expect(px(r.height)).toBe("30px");
    expect(px(r["border-radius"])).toBe("8px");
    expect(r["font-size"]).toBe("13px");
    expect(r["font-weight"]).toBe("500");
  });
  it("large is 52 high with radius 14", () => {
    const r = rule('.hh-btn[data-kind="large"]');
    expect(px(r.height)).toBe("52px");
    expect(px(r["border-radius"])).toBe("14px");
  });
  it("primary is the amber: cta fill, cta ink, cta hover, a focus ring in its ink (§2 Primary button)", () => {
    const r = rule('.hh-btn[data-kind="primary"]');
    expect(r.background).toBe("var(--hh-cta)");
    expect(r.color).toBe("var(--hh-cta-ink)");
    expect(rule('.hh-btn[data-kind="primary"]:hover:not(:disabled)').background).toBe("var(--hh-cta-hover)");
    expect(css).toMatch(/\.hh-btn\[data-kind="primary"\]:focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--hh-cta-ink\)[^}]*outline-offset:\s*-\d/);
  });
  it("quiet has no border and no fill (§3 one-line bars)", () => {
    const r = rule('.hh-btn[data-kind="quiet"]');
    expect(r.border).toBe("0");
    expect(r.background).toBe("transparent");
  });
  it("the link is underlined text in the current ink (decided OQ-14)", () => {
    const r = rule('.hh-btn[data-kind="link"]');
    expect(r["text-decoration"]).toBe("underline");
    expect(r.height).toBe("auto");
    expect(r.background).toBe("none");
  });
  it("has a focus ring, a disabled look and a busy look", () => {
    expect(css).toMatch(/\.hh-btn:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--hh-ink\)/);
    expect(rule(".hh-btn:disabled, .hh-btn[aria-busy=\"true\"]").opacity).toBe("0.5");
  });
  it("the icon button is square: width = height, 40 or 30", () => {
    const n = rule('.hh-icon-btn[data-size="normal"]');
    const c = rule('.hh-icon-btn[data-size="compact"]');
    expect(px(n.width)).toBe("40px");
    expect(n.width).toBe(n.height);
    expect(px(c.width)).toBe("30px");
    expect(c.width).toBe(c.height);
    expect(rule(".hh-icon-btn").background).toBe("transparent");
  });
  it("no context rule beats the Button: the composer's selectors leave .hh-btn alone (Send stays the amber primary)", () => {
    const composer = [...css.matchAll(/^(\.hh-composer button[^{]*)\{([^}]*)\}/gm)];
    expect(composer.length).toBeGreaterThan(0);
    for (const [, sel] of composer) expect(sel, sel).toContain(":not(.hh-btn)");
    expect(rule('.hh-btn[data-kind="primary"]').background).toBe("var(--hh-cta)");
    expect(rule('.hh-btn[data-size="normal"]').height).toBe("var(--hh-h-normal)");
  });
  it("the current rail item keeps its active fill on hover", () => {
    const hover = rule('.hh-rail > .hh-icon-btn[aria-current="page"]:hover:not(:disabled)');
    expect(hover.background).toBe("var(--hh-active)");
    expect(hover.color).toBe("var(--hh-active-ink)");
    expect(css.indexOf('.hh-rail > .hh-icon-btn[aria-current="page"]:hover')).toBeGreaterThan(css.indexOf(".hh-icon-btn:hover:not(:disabled)"));
  });
  it("its classes belong to the guide", () => {
    expect(GUIDE_CLASSES.has("hh-btn")).toBe(true);
    expect(GUIDE_CLASSES.has("hh-icon-btn")).toBe(true);
  });
});

/** The names of the elements still open at `index` in `text` (JSX or HTML), innermost last. */
export function openTagsAt(text: string, index: number): string[] {
  const stack: string[] = [];
  for (const m of text.slice(0, index).matchAll(/<(\/?)([A-Za-z][\w.]*)[^<]*?(\/?)>/g)) {
    if (m[3] === "/") continue;
    if (m[1] === "/") {
      const at = stack.lastIndexOf(m[2]);
      if (at >= 0) stack.length = at;
    } else stack.push(m[2]);
  }
  return stack;
}

describe("Link placement (style guide §3: only inside running text)", () => {
  const TEXT = new Set(["p", "li", "Trans"]);
  it("the scanner tells running text from a bar", () => {
    const inText = `<p>Read the <Button kind="link">terms</Button></p>`;
    expect(openTagsAt(inText, inText.indexOf("<Button")).at(-1)).toBe("p");
    const inTrans = `<div><Trans i18nKey="x" components={{ a: <Button kind="link" /> }} />`;
    expect(openTagsAt(inTrans, inTrans.indexOf("<Button")).at(-1)).not.toBeUndefined();
    const inBar = `<p>Done</p><div className="hh-bar"><Button kind="link">Edit</Button></div>`;
    expect(openTagsAt(inBar, inBar.indexOf("<Button")).at(-1)).toBe("div");
  });
  it("every kind=\"link\" use in packages/ui/src is a child of a text element", () => {
    const src = join(import.meta.dirname, "../src");
    const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : [join(d, f)]));
    const bad: string[] = [];
    for (const f of files(src).filter((x) => x.endsWith(".tsx"))) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/<Button\b[^>]*\bkind="link"/g)) {
        const parent = openTagsAt(text, m.index).at(-1);
        if (!parent || !TEXT.has(parent)) bad.push(`${f.slice(src.length + 1)}: inside <${parent}>`);
      }
    }
    expect(bad).toEqual([]);
  });
});
