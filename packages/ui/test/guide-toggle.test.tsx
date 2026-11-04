// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InputSpec } from "../src/client";
import { GUIDE_CLASSES } from "../src/guide/classes";
import { Checkbox, StaticCheckbox } from "../src/guide/Checkbox";
import { Toggle } from "../src/guide/Toggle";
import { InputForm } from "../src/InputForm";
import { css, lengths, rule } from "./guide-css";
import { renderIn } from "./render";

afterEach(cleanup);

const token = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1].trim();
const px = (value: string | undefined) => {
  const m = /^var\((--[\w-]+)\)$/.exec(value ?? "");
  return m ? token(m[1]) : value;
};

describe("Toggle (style guide §5 Toggle, row 10)", () => {
  it("is a switch with aria-checked that flips on click and on the label text", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Toggle checked={false} onChange={onChange}>
        Notify me
      </Toggle>,
    );
    const sw = screen.getByRole("switch", { name: "Notify me" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByText("Notify me"));
    expect(onChange).toHaveBeenCalledTimes(2);
    rerender(
      <Toggle checked onChange={onChange}>
        Notify me
      </Toggle>,
    );
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("is named by aria-label or by an outside label, and stays a button that does not submit", () => {
    render(
      <form>
        <label htmlFor="t">Outside</label>
        <Toggle id="t" checked={false} onChange={() => {}} />
        <Toggle checked aria-label="Inner" onChange={() => {}} />
      </form>,
    );
    expect(screen.getByRole("switch", { name: "Outside" }).getAttribute("type")).toBe("button");
    expect(screen.getByRole("switch", { name: "Inner" })).toBeTruthy();
  });

  it("does not flip while disabled", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} disabled aria-label="x" onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is 34 wide and 20 high and round, and overrides the generic button", () => {
    const r = rule(".hh-toggle");
    expect(px(r.width)).toBe("34px");
    expect(px(r.height)).toBe("20px");
    expect(r["border-radius"]).toBe("999px");
    // The global `button` rule centers, pads and sets the control height: the toggle must not inherit them.
    expect(r.padding).toBe("0");
    expect(r.border).toBe("0");
    expect(r["min-width"]).toBe("34px");
    expect(r.display).toBe("inline-block");
    expect(px(rule(".hh-toggle::after").width)).toBe("14px");
  });

  it("its classes are the guide's", () => {
    for (const c of ["hh-toggle", "hh-toggle-row", "hh-checkbox"]) expect(GUIDE_CLASSES.has(c)).toBe(true);
  });
});

describe("Checkbox (style guide §5 Checkbox, row 56)", () => {
  it("is an 18 checkbox in the field style, for accepting", () => {
    const onChange = vi.fn();
    render(
      <label>
        <Checkbox purpose="accept" checked={false} onChange={onChange} /> I accept
      </label>,
    );
    const box = screen.getByRole("checkbox", { name: "I accept" });
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledTimes(1);
    const r = rule(".hh-checkbox");
    expect(px(r.width)).toBe("18px");
    expect(px(r.height)).toBe("18px");
    expect(r.border).toBe("1px solid var(--hh-line-strong)");
    expect(r.background).toBe("var(--hh-surface)");
  });

  it("is used only with purpose=accept: the type forbids any other use", () => {
    // @ts-expect-error a checkbox without a purpose is not allowed
    render(<Checkbox checked={false} onChange={() => {}} />);
    // @ts-expect-error only "accept" is a purpose
    render(<Checkbox purpose="choose" checked={false} onChange={() => {}} />);
    cleanup();
  });

  it("a task-list box in Markdown is static and tells its state", () => {
    render(<StaticCheckbox checked label="done" />);
    const box = screen.getByRole("checkbox", { name: "done" });
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(box.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("effective layout", () => {
  it("no broader rule turns a toggle row back into a block", () => {
    // `.hh-sk-scope label` used to set display:block on every label, including the toggle row.
    expect(css).not.toMatch(/\.hh-sk-scope label\s*\{/);
    expect(rule(".hh-sk-scope label:not(.hh-toggle-row)").display).toBe("block");
    expect(rule(".hh-toggle-row").display).toBe("flex");
    expect(rule(".hh-toggle-row")["align-items"]).toBe("center");
  });
  it("C9: the Markdown task box is 8 from its text, outdented 20 so the text stays put and the box stays in the gutter", () => {
    const m = lengths(rule(".hh-md-task > .hh-checkbox").margin);
    expect(m).toEqual([0, 8, 0, -20]);
    // The box is 18 wide: its left edge stays left of the list content, in the gutter.
    expect(m[3] + 18).toBeLessThanOrEqual(0);
    expect(css).not.toMatch(/\.hh-md-task > input/);
  });
});

describe("multiChoice in InputForm", () => {
  it("renders one Toggle per row and no checkbox", async () => {
    const spec: InputSpec = { fields: [{ name: "tags", kind: "multiChoice", label: "Tags", optional: false, options: ["a", "b", "c"] }] };
    const submit = vi.fn();
    await renderIn("en", <InputForm spec={spec} data={null} blockId="t1:0:1" disabled={false} sending={false} errors={[]} submit={submit} />);
    expect(screen.getAllByRole("switch").map((s) => s.textContent ?? "")).toEqual(["", "", ""]);
    expect(screen.getAllByRole("switch").length).toBe(3);
    expect(screen.queryAllByRole("checkbox")).toEqual([]);
    fireEvent.click(screen.getByRole("switch", { name: "c" }));
    fireEvent.click(screen.getByRole("switch", { name: "a" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(submit).toHaveBeenCalledWith({ tags: ["a", "c"] });
  });
});

describe("source scan", () => {
  const src = resolve(import.meta.dirname, "../src");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name)) files.push(p);
    }
  };
  walk(src);
  const outside = (needle: RegExp, home: string) => files.filter((f) => !f.endsWith(home) && needle.test(readFileSync(f, "utf8"))).map((f) => f.slice(src.length + 1));

  it('has no type="checkbox" outside guide/Checkbox.tsx', () => {
    expect(outside(/type=["{]+checkbox/, "guide/Checkbox.tsx")).toEqual([]);
  });
  it('has no role="switch" outside guide/Toggle.tsx', () => {
    expect(outside(/role=["{]+switch/, "guide/Toggle.tsx")).toEqual([]);
  });
  it('has no role="checkbox" outside guide/Checkbox.tsx (StaticCheckbox lives there)', () => {
    expect(outside(/role=["{]+checkbox/, "guide/Checkbox.tsx")).toEqual([]);
  });
  it("every Checkbox in use has purpose=accept (the type enforces it)", () => {
    expect(outside(/<Checkbox\b(?![^>]*purpose="accept")/, "guide/Checkbox.tsx")).toEqual([]);
  });
});

describe("answers C1, C3, C4, C5, C8", () => {
  it("C1: the switch is ink when on, line-strong when off, and the knob stays the surface", () => {
    expect(rule('.hh-toggle[aria-checked="true"]').background).toBe("var(--hh-ink)");
    expect(rule(".hh-toggle").background).toBe("var(--hh-line-strong)");
    expect(rule(".hh-toggle::after").background).toBe("var(--hh-surface)");
  });

  it("C3: a checked checkbox is an ink fill with the check icon at 14 in the surface color, radius 4", () => {
    const on = rule('.hh-checkbox[aria-checked="true"]');
    expect(on.background).toBe("var(--hh-ink)");
    expect(on["box-shadow"]).toBeUndefined();
    expect(rule(".hh-checkbox")["border-radius"]).toBe("var(--hh-s-1)");
    expect(token("--hh-s-1")).toBe("4px");
    expect(css).toMatch(/\.hh-checkbox:checked \+ \.hh-icon[^{]*\{[^}]*color:\s*var\(--hh-surface\)/);
    expect(css).toMatch(/\.hh-checkbox\[aria-checked="true"\][^{]*\{[^}]*color:\s*var\(--hh-surface\)/);
  });

  it("C3: the accept checkbox draws a check at 14 beside the input, shown only when checked", () => {
    const { container, rerender } = render(<Checkbox purpose="accept" checked={false} onChange={() => {}} aria-label="ok" />);
    const input = screen.getByRole("checkbox", { name: "ok" });
    const icon = container.querySelector("svg.hh-icon-check");
    expect(icon?.getAttribute("width")).toBe("14");
    expect(input.nextElementSibling).toBe(icon);
    rerender(<Checkbox purpose="accept" checked onChange={() => {}} aria-label="ok" />);
    expect((screen.getByRole("checkbox", { name: "ok" }) as HTMLInputElement).checked).toBe(true);
  });

  it("C3: the static checkbox holds the check at 14 only when it is checked", () => {
    const { container, rerender } = render(<StaticCheckbox checked label="done" />);
    expect(container.querySelector("svg.hh-icon-check")?.getAttribute("width")).toBe("14");
    rerender(<StaticCheckbox checked={false} label="done" />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("C4: the label comes first and the switch is at the end of a full-width row", () => {
    render(
      <Toggle checked={false} onChange={() => {}}>
        Notify me
      </Toggle>,
    );
    const row = document.querySelector(".hh-toggle-row");
    expect(row?.firstElementChild?.textContent).toBe("Notify me");
    expect(row?.lastElementChild?.getAttribute("role")).toBe("switch");
    expect(screen.getByRole("switch", { name: "Notify me" })).toBeTruthy();
    const r = rule(".hh-toggle-row");
    expect(r["justify-content"]).toBe("space-between");
    expect(r.width).toBe("100%");
    expect(r.display).toBe("flex");
  });

  it("C4: every place with a toggle row gets that layout, none overrides it", () => {
    expect(css).not.toMatch(/\.hh-toggle-row[^{]*\{[^}]*(?:justify-content:\s*flex-start|width:\s*auto)/);
    const src = (f: string) => readFileSync(join(import.meta.dirname, "../src", f), "utf8");
    // Settings › General moved to Radix (stage 2): its switch is a Radix Switch in a settings Row.
    for (const f of ["sidekick/ScopeSidekicks.tsx", "sidekick/SidekickEditor.tsx", "InputForm.tsx", "search/SearchPalette.tsx"]) {
      expect(src(f), f).toMatch(/<Toggle[^>]*>\s*[\s\S]*?<\/Toggle>/);
    }
    // C13: the jobs row lays out its own text, caption and switch, in the same toggle row.
    expect(src("parallel/JobsTab.tsx")).toMatch(/<label className="hh-toggle-row">/);
  });

  it("C5: the search filter toggle rows are 12 in the muted color", () => {
    const r = rule(".hh-search-filters .hh-toggle-row");
    expect(r["font-size"]).toBe("12px");
    expect(r.color).toBe("var(--hh-muted)");
  });

  it("C8: the sidekick editor toggle lists have 8 between rows", () => {
    const r = rule(".hh-sk-fieldset .hh-toggle-row + .hh-toggle-row");
    expect(r["margin-top"]).toBe("var(--hh-s-2)");
    expect(token("--hh-s-2")).toBe("8px");
  });
});
