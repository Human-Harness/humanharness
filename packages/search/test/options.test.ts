import { describe, expect, it } from "vitest";
import { INDEX_VERSION, KINDS, fold, indexOptions } from "../src";

describe("search options", () => {
  it("folds accents and case, like material_search", () => {
    expect(fold("Fracción")).toBe("fraccion");
    expect(fold("ÉLAN")).toBe("elan");
  });

  it("indexes title, path and text; stores the routing fields but never the text (§4.1)", () => {
    const o = indexOptions();
    expect(o.fields).toEqual(["title", "path", "text"]);
    expect(o.storeFields).toContain("title");
    expect(o.storeFields).toContain("path");
    expect(o.storeFields).not.toContain("text");
  });

  it("plan 1 has three kinds and a version", () => {
    expect(KINDS).toEqual(["task", "note", "file"]);
    expect(INDEX_VERSION).toBe(1);
  });
});
