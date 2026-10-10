import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineBlock } from "@humanharness/harness-sdk";
import { getEngine } from "@humanharness/engines";
import { MANAGED_END, MANAGED_START, managedSection, writeInstructions } from "../src";

const blocks = {
  note: defineBlock({
    description: "Shows a note.",
    visible: true,
    schema: z.object({ title: z.string() }),
    example: { title: "Hi" },
  }),
  progress: defineBlock({
    description: "Updates progress.",
    visible: false,
    schema: z.object({ percent: z.number() }),
    example: { percent: 10 },
  }),
};

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));

describe("managedSection", () => {
  it("is delimited and states the answer language", () => {
    const es = managedSection({ language: "es", blocks });
    expect(es.startsWith(MANAGED_START)).toBe(true);
    expect(es.trimEnd().endsWith(MANAGED_END)).toBe(true);
    expect(es).toContain("Respondé siempre en español.");
    expect(managedSection({ language: "en", blocks })).toContain("Always answer in English.");
  });

  it("documents every block tool with its example and schema", () => {
    const s = managedSection({ language: "en", blocks });
    expect(s).toContain("`show_note`");
    expect(s).toContain("`update_progress`");
    expect(s).toContain('{"title":"Hi"}');
    expect(s).toContain('"percent"');
    expect(s).not.toContain("$schema");
  });

  it("leads the tools section with a one-line intro", () => {
    expect(managedSection({ language: "es", blocks })).toContain(
      "Llamá estas herramientas para mostrarle cosas a la persona o actualizar su estado.",
    );
    expect(managedSection({ language: "en", blocks })).toContain(
      "Call these tools to show things to the person or update their state.",
    );
  });
});

describe("writeInstructions", () => {
  it("writes AGENTS.md plus the engine's own file", async () => {
    const folder = tmp();
    const written = await writeInstructions({
      folder,
      base: "# Flow\n\nDo things.\n",
      language: "es",
      blocks,
      engine: getEngine("claude"),
    });
    expect(written.sort()).toEqual(["AGENTS.md", "CLAUDE.md"]);
    const agents = fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8");
    expect(agents.startsWith("# Flow\n\nDo things.\n\n" + MANAGED_START)).toBe(true);
    expect(fs.readFileSync(path.join(folder, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
  });

  it("writes only AGENTS.md for engines that read it directly", async () => {
    const folder = tmp();
    const written = await writeInstructions({ folder, base: "x", language: "en", blocks, engine: getEngine("codex") });
    expect(written).toEqual(["AGENTS.md"]);
    expect(fs.existsSync(path.join(folder, "CLAUDE.md"))).toBe(false);
  });

  it("rejects an engine file path that is not a plain file name", async () => {
    const engine = { ...getEngine("codex"), instructionsFile: { path: "../evil.md", content: "x" } };
    await expect(
      writeInstructions({ folder: tmp(), base: "x", language: "en", blocks, engine }),
    ).rejects.toThrow();
  });

  it("is idempotent", async () => {
    const folder = tmp();
    const opts = { folder, base: "x", language: "en" as const, blocks, engine: getEngine("codex") };
    await writeInstructions(opts);
    const first = fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8");
    await writeInstructions(opts);
    expect(fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8")).toBe(first);
  });
});
