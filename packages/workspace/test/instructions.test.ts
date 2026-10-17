import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { CORE_BLOCKS, defineBlock } from "@humanharness/harness-sdk";
import { getEngine } from "@humanharness/engines";
import { MANAGED_END, MANAGED_START, managedSection, writeInstructions } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

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

const tmp = () => fs.mkdtempSync(path.join(root, "t-"));

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

  it("tells the agent its tools show up in call order, so it introduces each thing first", () => {
    expect(managedSection({ language: "es", blocks })).toContain("escribí primero la frase que presenta cada cosa y llamá la herramienta después");
    expect(managedSection({ language: "en", blocks })).toContain("write the sentence that introduces each thing first, then call the tool");
  });

  it("leads the tools section with a one-line intro", () => {
    expect(managedSection({ language: "es", blocks })).toContain(
      "Llamá estas herramientas para mostrarle cosas a la persona o actualizar su estado.",
    );
    expect(managedSection({ language: "en", blocks })).toContain(
      "Call these tools to show things to the person or update their state.",
    );
  });

  it("documents the core blocks with their own tool names", () => {
    const s = managedSection({ language: "en", blocks: { ...CORE_BLOCKS, ...blocks } });
    expect(s).toContain("`show_choices`");
    expect(s).toContain("`save_note`");
    expect(s).not.toContain("update_save_note");
  });

  it("lists the reference folders as read only, and only when there are some", () => {
    const s = managedSection({ language: "es", blocks, references: [{ label: "Código de Human Harness", path: "/Users/me/code/hh" }] });
    expect(s).toContain("### Carpetas de referencia (solo lectura)");
    expect(s).toContain("Podés leer estas carpetas con tus herramientas de lectura. Nunca cambies nada en ellas.");
    expect(s).toContain("- Código de Human Harness: `/Users/me/code/hh`");
    expect(s.indexOf("Carpetas de referencia")).toBeLessThan(s.indexOf(MANAGED_END));
    expect(managedSection({ language: "en", blocks })).not.toContain("Reference folders");
    expect(managedSection({ language: "en", blocks, references: [{ label: "Source", path: "/r" }] })).toContain("### Reference folders (read only)");
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

  it("writes the reference folders into AGENTS.md", async () => {
    const folder = tmp();
    await writeInstructions({ folder, base: "x", language: "en", blocks, references: [{ label: "Source", path: "/r" }], engine: getEngine("codex") });
    expect(fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8")).toContain("- Source: `/r`");
  });
});
