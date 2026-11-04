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
import { css, rule } from "./guide-css";
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
  it("every Checkbox in use has purpose=accept (the type enforces it)", () => {
    expect(outside(/<Checkbox\b(?![^>]*purpose="accept")/, "guide/Checkbox.tsx")).toEqual([]);
  });
});
