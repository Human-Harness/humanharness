import { afterEach, describe, expect, it, vi } from "vitest";
import { systemLanguage } from "../src/language";

afterEach(() => vi.unstubAllGlobals());

describe("systemLanguage", () => {
  it("is the system's language tag in canonical form", () => {
    vi.stubGlobal("navigator", { language: "pt-br" });
    expect(systemLanguage()).toBe("pt-BR");
  });

  it("falls back to English when the system gives no usable tag", () => {
    vi.stubGlobal("navigator", { language: "" });
    expect(systemLanguage()).toBe("en");
  });
});
