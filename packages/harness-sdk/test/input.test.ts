import { describe, expect, it } from "vitest";
import { defineBlock, defineHarness, inputBlocks, z } from "../src";

const commit = () =>
  defineBlock({
    description: "Asks for an answer and why.",
    visible: true,
    schema: z.object({ question: z.string(), options: z.array(z.string()).max(4).optional() }),
    input: z.object({ choice: z.string().optional(), why: z.string().min(1).max(1000) }),
    inputUi: { why: { kind: "longText", label: { es: "¿Por qué? Con tus palabras", en: "Why? In your own words" } } },
    submitLabel: { es: "Me comprometo", en: "I commit" },
    skippable: true,
    display: (value, language) => (language === "es" ? `Elegí: ${"choice" in value ? String(value.choice) : ""}` : "Picked"),
    example: { question: "¿Quién comió más?", options: ["Yo", "Las dos igual"] },
  });

describe("defineBlock with input", () => {
  it("keeps input, inputUi, submitLabel, skippable and display", () => {
    const b = commit();
    expect(b.input).toBeInstanceOf(z.ZodObject);
    expect(b.inputUi?.why?.kind).toBe("longText");
    expect(b.submitLabel).toEqual({ es: "Me comprometo", en: "I commit" });
    expect(b.skippable).toBe(true);
    expect(b.display?.({ why: "x", choice: "Yo" }, "es")).toBe("Elegí: Yo");
  });

  it("refuses an input that is not a z.object", () => {
    expect(() =>
      defineBlock({ description: "x", visible: true, schema: z.object({}), input: z.string() as unknown as z.ZodObject, example: {} }),
    ).toThrow(/input must be a z.object/);
  });

  it("refuses inputUi for a field the input doesn't have", () => {
    expect(() =>
      defineBlock({
        description: "x",
        visible: true,
        schema: z.object({}),
        input: z.object({ why: z.string() }),
        inputUi: { nope: { label: { es: "a", en: "a" } } } as never,
        example: {},
      }),
    ).toThrow(/inputUi.nope/);
  });

  it("refuses answer settings on a block with no input", () => {
    expect(() => defineBlock({ description: "x", visible: true, schema: z.object({}), skippable: true, example: {} })).toThrow(/need an input/);
  });

  it("a harness keeps its input blocks, and inputBlocks finds them", () => {
    const card = defineBlock({ description: "c", visible: true, schema: z.object({ t: z.string() }), example: { t: "a" } });
    const h = defineHarness({
      id: "quiz",
      name: { es: "Q", en: "Q" },
      core: "^0.1.0",
      languages: ["es", "en"],
      engines: ["claude"],
      folder: { suggested: "Documents/Q" },
      instructions: "./AGENTS.md",
      permissions: { edit: "none", exec: false, web: false },
      blocks: { card, commit_answer: commit() },
      author: "t",
    });
    expect(Object.keys(inputBlocks(h.blocks))).toEqual(["commit_answer"]);
    expect(inputBlocks({ card })).toEqual({});
  });
});
