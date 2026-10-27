import { describe, expect, it } from "vitest";
import { imageTarget, joinPath, linkTarget } from "../src/doc-links";

describe("joinPath", () => {
  it("resolves against the document's folder", () => {
    expect(joinPath("docs/adr/a.md", "b.md")).toBe("docs/adr/b.md");
    expect(joinPath("docs/adr/a.md", "../notes/./x.md")).toBe("docs/notes/x.md");
    expect(joinPath("", "x.md")).toBe("x.md");
    expect(joinPath("a.md", "../../up.md")).toBe("../../up.md");
  });
});

describe("linkTarget (§3.4)", () => {
  it("a relative .md opens in the reader, at its anchor", () => {
    expect(linkTarget("adr-007.md", "docs/a.md")).toEqual({ kind: "doc", path: "docs/adr-007.md" });
    expect(linkTarget("../notes/x.MD#context", "docs/a.md")).toEqual({ kind: "doc", path: "notes/x.MD", anchor: "context" });
    expect(linkTarget("my%20doc.md", "")).toEqual({ kind: "doc", path: "my doc.md" });
  });
  it("#anchor scrolls within the document", () => {
    expect(linkTarget("#risks", "a.md")).toEqual({ kind: "anchor", id: "risks" });
    expect(linkTarget("#", "a.md")).toEqual({ kind: "text" });
  });
  it("http(s) goes to the browser, with its domain", () => {
    expect(linkTarget("https://Example.com/x?y=1", "")).toEqual({ kind: "external", url: "https://example.com/x?y=1", domain: "example.com" });
    expect(linkTarget("HTTP://a.org", "")).toMatchObject({ kind: "external", domain: "a.org" });
  });
  it("any other scheme, protocol-relative, a non-.md path or junk is text", () => {
    for (const href of ["javascript:alert(1)", "file:///etc/passwd", "mailto:a@b.c", "//evil.com/x.md", "src/a.ts", "data:text/html,x", "", "   ", "https://"]) {
      expect(linkTarget(href, "")).toEqual({ kind: "text" });
    }
  });
});

describe("imageTarget", () => {
  it("local, remote or nothing", () => {
    expect(imageTarget("img/a.png", "docs/x.md")).toEqual({ kind: "local", path: "docs/img/a.png" });
    expect(imageTarget("https://cdn.x.com/a.png", "")).toEqual({ kind: "remote", url: "https://cdn.x.com/a.png", domain: "cdn.x.com" });
    expect(imageTarget("data:image/png;base64,AAA", "")).toEqual({ kind: "none" });
    expect(imageTarget("file:///a.png", "")).toEqual({ kind: "none" });
  });
});
