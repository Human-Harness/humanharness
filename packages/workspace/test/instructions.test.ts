import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { CORE_BLOCKS, INPUT_CORE_BLOCKS, defineBlock } from "@humanharness/harness-sdk";
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

describe("managedSection: input blocks", () => {
  const schemaOf = (s: z.ZodObject) => {
    const { $schema: _omit, ...rest } = z.toJSONSchema(s) as Record<string, unknown>;
    return JSON.stringify(rest);
  };
  const ask = defineBlock({
    description: "Asks why.",
    visible: true,
    schema: z.object({ question: z.string() }),
    input: z.object({ why: z.string().min(1) }),
    example: { question: "q" },
  });

  it("D0: without input blocks the section is exactly today's", () => {
    expect(managedSection({ language: "en", blocks })).toBe(
      [
        MANAGED_START,
        "## Environment (generated by Human Harness; do not edit)",
        "",
        "- Always answer in English.",
        "- You are running inside a desktop app: the person talks to you from an interface, not a terminal. Don't show commands or file paths unless asked.",
        "- Don't use your CLI's own interactive questions: ask in plain text or with the interface tools below.",
        "- Work only inside this folder. Keep messages short and clear.",
        "",
        "### Interface tools",
        "",
        "Call these tools to show things to the person or update their state.",
        "",
        "- `show_note`: Shows a note.",
        '  Example: `{"title":"Hi"}`',
        `  Schema: \`${schemaOf(blocks.note.schema)}\``,
        "- `update_progress`: Updates progress.",
        '  Example: `{"percent":10}`',
        `  Schema: \`${schemaOf(blocks.progress.schema)}\``,
        MANAGED_END,
        "",
      ].join("\n"),
    );
  });

  it("documents each input block's answer and how answers come back", () => {
    const en = managedSection({ language: "en", blocks: { ...blocks, ask } });
    expect(en).toContain(`- \`show_ask\`: Asks why.\n  Example: \`{"question":"q"}\`\n  Schema: \`${schemaOf(ask.schema)}\`\n  Answer: \`${schemaOf(ask.input!)}\``);
    expect(en).toContain(
      [
        "### Answers from input blocks",
        "",
        "- A tool with an `Answer` schema asks the person for something. After calling it, end your turn and wait: the answer comes as the next message.",
        "- That message starts with `[answer to <block>]` (the tool's name without `show_`: `[answer to ask]` for `show_ask`), then what the person sees, then a ```json block with `block`, `blockId` and `value`. Trust the JSON: `value` already matches the block's `Answer` schema.",
        '- When `value` is `{"skipped":true}`, the person skipped the question: go on without insisting.',
      ].join("\n"),
    );
    expect(en.match(/Answer: /g)).toHaveLength(1);
    const es = managedSection({ language: "es", blocks: { ask } });
    expect(es).toContain(`  Respuesta: \`${schemaOf(ask.input!)}\``);
    expect(es).toContain("### Respuestas de bloques de entrada");
    expect(es).toContain("- Si `value` es `{\"skipped\":true}`, la persona salteó la pregunta: seguí sin insistir.");
  });

  it("explains annotate only when the harness has it", () => {
    const line = '- To mark parts of an answer, call `show_annotate` with `ref` (the answer\'s `blockId`, or "last") and quote the person\'s exact words in each mark.';
    expect(managedSection({ language: "en", blocks: { ask } })).not.toContain("show_annotate");
    expect(managedSection({ language: "en", blocks: { ...INPUT_CORE_BLOCKS, ask } })).toContain(line);
  });
});
