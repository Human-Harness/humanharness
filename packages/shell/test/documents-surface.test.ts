import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("documents surface", () => {
  it("AppState.documents is the kinds of mods.documents, and absent without them (D0)", async () => {
    const appState = await fs.readFile(path.resolve(__dirname, "../src/main/app-state.ts"), "utf8");
    expect(appState).toContain("const documents = documentsConfig(harness);");
    expect(appState).toContain("...(documents ? { documents: { kinds: documents.kinds } } : {}),");
  });
});
