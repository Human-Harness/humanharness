import { describe, expect, it } from "vitest";
import { declarationStamp } from "../src";

describe("declarationStamp (search spec D4)", () => {
  const base = { key: "id", single: false, search: { title: "title", text: ["body"] } };

  it("is short, stable, and the same for the same declaration", () => {
    expect(declarationStamp(base)).toMatch(/^[0-9a-z]{1,8}$/);
    expect(declarationStamp({ ...base, search: { ...base.search } })).toBe(declarationStamp(base));
  });

  it("changes with the key, single, the title field or the text fields", () => {
    const s = declarationStamp(base);
    expect(declarationStamp({ ...base, key: "other" })).not.toBe(s);
    expect(declarationStamp({ single: true, search: base.search })).not.toBe(s);
    expect(declarationStamp({ ...base, search: { ...base.search, title: "name" } })).not.toBe(s);
    expect(declarationStamp({ ...base, search: { title: "title", text: ["body", "notes"] } })).not.toBe(s);
    expect(declarationStamp({ ...base, search: { title: "title" } })).not.toBe(s);
  });
});
