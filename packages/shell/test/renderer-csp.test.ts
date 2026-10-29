import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

// P8: the app's own page is loosened by exactly one directive, for plugin panels; with no panel handler registered
// (D0) an hh-plugin: frame still loads nothing.
it("the app's CSP is the old one plus frame-src hh-plugin: and nothing else", () => {
  const html = readFileSync(path.join(__dirname, "../src/renderer/index.html"), "utf8");
  const metas = [...html.matchAll(/http-equiv="Content-Security-Policy" content="([^"]+)"/g)].map((m) => m[1]);
  expect(metas).toEqual(["default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src hh-plugin:"]);
});
