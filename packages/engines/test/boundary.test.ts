import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packages = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const engineSrc = path.join(packages, "engines", "src");

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === "node_modules" ? [] : sources(p);
    return /\.tsx?$/.test(d.name) ? [p] : [];
  });
}

describe("engine boundary (replaceable parts D7)", () => {
  it("reads transport.kind only inside engines/src", () => {
    const offenders = fs
      .readdirSync(packages)
      .map((name) => path.join(packages, name, "src"))
      .filter((src) => fs.existsSync(src) && src !== engineSrc)
      .flatMap(sources)
      .filter((file) => fs.readFileSync(file, "utf8").includes("transport.kind"))
      .map((file) => path.relative(packages, file));
    expect(offenders).toEqual([]);
  });
});
