import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { imageDataUrl } from "../src/main/assets";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("imageDataUrl", () => {
  it("turns an image file into a data: URL the renderer's CSP allows", async () => {
    const file = path.join(root, "logo.svg");
    fs.writeFileSync(file, "<svg/>");
    expect(await imageDataUrl(file)).toBe(`data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`);
  });

  it("returns null for other file types and missing files", async () => {
    const file = path.join(root, "notes.txt");
    fs.writeFileSync(file, "x");
    expect(await imageDataUrl(file)).toBeNull();
    expect(await imageDataUrl(path.join(root, "missing.png"))).toBeNull();
  });
});
