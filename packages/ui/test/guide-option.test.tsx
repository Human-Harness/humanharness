// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GUIDE_CLASSES } from "../src/guide/classes";
import { Option, OptionGroup } from "../src/guide/Option";
import { Tile, TileGrid } from "../src/guide/Tile";
import { css, rule } from "./guide-css";

afterEach(cleanup);

// The first token after the scale's comment shares its key with that comment in `rule`, so the scale is read from the text.
const token = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1].trim();
const px = (value: string | undefined) => {
  const m = /^var\((--[\w-]+)\)$/.exec(value ?? "");
  return m ? token(m[1]) : value;
};

describe("Option (style guide §3, row 'Option')", () => {
  it("is a radio in a radiogroup with a title and a description", () => {
    const onClick = vi.fn();
    render(
      <OptionGroup label="Mode">
        <Option checked title="Socratic" description="Questions that lead you." onClick={onClick} />
        <Option checked={false} title="Feynman" />
      </OptionGroup>,
    );
    const group = screen.getByRole("radiogroup", { name: "Mode" });
    const radios = screen.getAllByRole("radio");
    expect(group.contains(radios[0])).toBe(true);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(radios[0].textContent).toBe("SocraticQuestions that lead you.");
    fireEvent.click(radios[0]);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is 52 high with a radius of 12, and draws a visible 18 radio", () => {
    expect(px(rule(".hh-option-item")["min-height"])).toBe("52px");
    expect(px(rule(".hh-option-item")["border-radius"])).toBe("12px");
    expect(px(rule(".hh-option-mark")["width"])).toBe("18px");
    expect(px(rule(".hh-option-mark")["height"])).toBe("18px");
    render(<Option checked title="A" />);
    expect(document.querySelector(".hh-option-mark")).not.toBeNull();
  });

  it("recommended is the amber border, and the tag slot sits by the title", () => {
    render(<Option checked={false} recommended title="Socratic" tag={<span>Recommended</span>} />);
    const radio = screen.getByRole("radio");
    expect(radio.getAttribute("data-recommended")).toBe("true");
    expect(css).toMatch(/\.hh-option-item\[data-recommended="true"\][^{]*{[^}]*border-color:\s*var\(--hh-cta\)/);
    expect(radio.querySelector(".hh-option-head")?.textContent).toBe("SocraticRecommended");
  });

  it("has one tab stop, moves the focus with the arrows and picks only when it follows the focus", () => {
    const picks = vi.fn();
    const { unmount } = render(
      <OptionGroup label="Plain">
        <Option checked={false} title="A" onClick={() => picks("A")} />
        <Option checked title="B" onClick={() => picks("B")} />
        <Option checked={false} disabled title="C" />
      </OptionGroup>,
    );
    let radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    radios[1].focus();
    fireEvent.keyDown(radios[1], { key: "ArrowDown" });
    expect(document.activeElement).toBe(radios[0]);
    expect(picks).not.toHaveBeenCalled();
    unmount();
    render(
      <OptionGroup label="Following" followFocus>
        <Option checked={false} title="A" onClick={() => picks("A")} />
        <Option checked title="B" onClick={() => picks("B")} />
      </OptionGroup>,
    );
    radios = screen.getAllByRole("radio");
    radios[1].focus();
    fireEvent.keyDown(radios[1], { key: "ArrowUp" });
    expect(document.activeElement).toBe(radios[0]);
    expect(picks).toHaveBeenCalledWith("A");
  });

  it("names the radio by its title alone when asked, and the description describes it", () => {
    render(<Option nameOnly checked={false} title="Save it in Drive" description="me@example.com" />);
    const radio = screen.getByRole("radio", { name: "Save it in Drive" });
    expect(document.getElementById(radio.getAttribute("aria-describedby")!)?.textContent).toBe("me@example.com");
  });

  it("has no loose radio class: the radio is the Option's mark", () => {
    expect([...GUIDE_CLASSES].filter((c) => /radio/.test(c))).toEqual([]);
    expect(GUIDE_CLASSES.has("hh-option-mark")).toBe(true);
  });
});

describe("Tile (style guide §3, row 'Tile')", () => {
  it("is 104 high with a radius of 14", () => {
    expect(px(rule(".hh-tile")["min-height"])).toBe("104px");
    expect(px(rule(".hh-tile")["border-radius"])).toBe("14px");
  });

  it("shows a logo or a description under its title, and acts on click", () => {
    const onClick = vi.fn();
    render(
      <TileGrid label="Topics">
        <li>
          <Tile logo={<img src="x.png" alt="" />} title="Claude" onClick={onClick} />
        </li>
        <li>
          <Tile lead="01" title="The manifest" tags={<span>Done</span>} description="What a harness declares." />
        </li>
      </TileGrid>,
    );
    expect(screen.getByRole("list", { name: "Topics" })).toBeTruthy();
    const [logo, described] = screen.getAllByRole("button");
    expect(logo.querySelector("img")).not.toBeNull();
    expect(described.querySelector(".hh-tile-text")?.textContent).toBe("What a harness declares.");
    fireEvent.click(logo);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("selected is a 2 px dark border and a check at 14", () => {
    render(<Tile selected title="Picked" />);
    const tile = screen.getByRole("button", { name: "Picked" });
    expect(tile.getAttribute("aria-pressed")).toBe("true");
    expect(tile.querySelector(".hh-tile-check svg")?.getAttribute("width")).toBe("14");
    expect(css).toMatch(/\.hh-tile\[aria-pressed="true"\][^{]*{[^}]*border:\s*2px solid var\(--hh-ink\)/);
  });

  it("a tile that only acts says nothing of being pressed", () => {
    render(<Tile title="Start" />);
    expect(screen.getByRole("button", { name: "Start" }).hasAttribute("aria-pressed")).toBe(false);
  });
});
