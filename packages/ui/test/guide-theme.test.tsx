// @vitest-environment happy-dom
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HhTheme } from "../src/guide/Theme";

/** A matchMedia stand-in whose dark flag the test can flip, firing "change" like the real one. */
function fakeSystem(dark: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const media = {
    matches: dark,
    addEventListener: (_: string, f: (e: { matches: boolean }) => void) => listeners.add(f),
    removeEventListener: (_: string, f: (e: { matches: boolean }) => void) => listeners.delete(f),
  };
  vi.spyOn(window, "matchMedia").mockImplementation(() => media as unknown as MediaQueryList);
  return (next: boolean) => {
    media.matches = next;
    for (const f of listeners) f({ matches: next });
  };
}

describe("HhTheme (Radix + Impeccable spec §3)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is one Radix root with our accent, gray and radius, and no background of its own", () => {
    fakeSystem(false);
    const { container, getByText } = render(<HhTheme><p>hola</p></HhTheme>);
    const root = container.querySelector(".radix-themes.hh-theme");
    expect(root).not.toBeNull();
    expect(root!.getAttribute("data-accent-color")).toBe("amber");
    expect(root!.getAttribute("data-gray-color")).toBe("sand");
    expect(root!.getAttribute("data-radius")).toBe("large");
    expect(root!.getAttribute("data-has-background")).toBe("false");
    expect(root!.contains(getByText("hola"))).toBe(true);
  });

  it("follows prefers-color-scheme, like the --hh-* tokens, and switches when the system does", () => {
    const flip = fakeSystem(true);
    const { container } = render(<HhTheme><p>x</p></HhTheme>);
    const root = () => container.querySelector(".radix-themes.hh-theme")!;
    expect(root().classList.contains("dark")).toBe(true);
    act(() => flip(false));
    expect(root().classList.contains("light")).toBe(true);
    expect(root().classList.contains("dark")).toBe(false);
  });
});
