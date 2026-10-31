// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { focusSetting } from "../src/search/focus-setting";

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const root = (html: string) => {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.append(el);
  return el;
};

describe("focusSetting's flash and focus (search spec §6)", () => {
  it("a second flash on the same row lasts its full 2 s", () => {
    vi.useFakeTimers();
    const r = root('<div data-setting="a"><input></div>');
    const row = r.querySelector<HTMLElement>("[data-setting]")!;
    focusSetting(r, "a");
    vi.advanceTimersByTime(1500);
    focusSetting(r, "a");
    vi.advanceTimersByTime(1000);
    expect(row.classList.contains("hh-search-flash")).toBe(true);
    vi.advanceTimersByTime(1100);
    expect(row.classList.contains("hh-search-flash")).toBe(false);
  });

  it("a row with no control is focusable only until focus leaves it; a row's own tabindex stays", () => {
    const r = root('<div data-setting="a"><p>Usage</p></div><div data-setting="b" tabindex="0"></div><button>Done</button>');
    const a = r.querySelector<HTMLElement>('[data-setting="a"]')!;
    focusSetting(r, "a");
    expect(document.activeElement).toBe(a);
    r.querySelector("button")!.focus();
    expect(a.hasAttribute("tabindex")).toBe(false);
    const b = r.querySelector<HTMLElement>('[data-setting="b"]')!;
    focusSetting(r, "b");
    expect(document.activeElement).toBe(b);
    r.querySelector("button")!.focus();
    expect(b.getAttribute("tabindex")).toBe("0");
  });
});
