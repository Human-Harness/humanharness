import { describe, expect, it } from "vitest";
import { answerRecords, choiceOptions, defineBlock, defineHarness, inputBlocks, inputFields, inputSpec, inputSpecs, z } from "../src";

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

describe("inputFields", () => {
  const block = (input: z.ZodObject, schema: z.ZodObject = z.object({}), inputUi?: object) =>
    defineBlock({ description: "x", visible: true, schema, input, ...(inputUi ? { inputUi: inputUi as never } : {}), example: {} as never });

  it("reads the spec's example: a choice from the shown options, and a long text with its label", () => {
    expect(inputFields(commit())).toEqual([
      { name: "choice", kind: "choice", label: { es: "Choice", en: "Choice" }, optional: true, optionsFrom: "options" },
      { name: "why", kind: "longText", label: { es: "¿Por qué? Con tus palabras", en: "Why? In your own words" }, optional: false, min: 1, max: 1000 },
    ]);
  });

  it("guesses each kind from the zod type", () => {
    const b = block(
      z.object({
        title: z.string().max(80),
        notes: z.string(),
        count: z.number().int().min(1).max(5),
        level: z.enum(["low", "high"]),
        tags: z.array(z.enum(["a", "b"])),
        cards: z.array(z.object({ front: z.string(), back: z.string() })),
        sure: z.boolean().default(false),
        deep: z.object({ x: z.string() }),
      }),
    );
    expect(inputFields(b).map((f) => [f.name, f.kind, f.optional])).toEqual([
      ["title", "text", false],
      ["notes", "longText", false],
      ["count", "number", false],
      ["level", "choice", false],
      ["tags", "multiChoice", false],
      ["cards", "pairs", false],
      ["sure", "boolean", true],
      ["deep", null, false],
    ]);
    const [title, , count, level, tags, cards] = inputFields(b);
    expect(title).toMatchObject({ max: 80 });
    expect(count).toMatchObject({ min: 1, max: 5 });
    expect(level.options).toEqual(["low", "high"]);
    expect(tags.options).toEqual(["a", "b"]);
    expect(cards.columns).toEqual([
      { name: "front", label: { es: "Front", en: "Front" } },
      { name: "back", label: { es: "Back", en: "Back" } },
    ]);
  });

  it("takes inputUi: a kind for strings, labels, options from the shown data, column labels", () => {
    const b = block(
      z.object({ short: z.string(), pick: z.string(), cards: z.array(z.object({ q: z.string(), a: z.string() })) }),
      z.object({ answers: z.array(z.string()).optional() }),
      {
        short: { kind: "text" },
        pick: { optionsFrom: "answers", label: { es: "Elegí", en: "Pick" } },
        cards: { columns: { q: { es: "Pregunta", en: "Question" }, a: { es: "Respuesta", en: "Answer" } } },
      },
    );
    const [short, pick, cards] = inputFields(b);
    expect(short.kind).toBe("text");
    expect(pick).toMatchObject({ kind: "choice", optionsFrom: "answers", label: { es: "Elegí", en: "Pick" } });
    expect(cards.columns?.map((c) => c.label.en)).toEqual(["Question", "Answer"]);
  });

  it("a field named choice with no shown options is plain text", () => {
    expect(inputFields(block(z.object({ choice: z.string().max(40) })))[0]).toMatchObject({ kind: "text" });
  });

  it("inputSpec is plain data for the window; inputSpecs covers only input blocks", () => {
    const spec = inputSpec(commit());
    expect(spec.submitLabel).toEqual({ es: "Me comprometo", en: "I commit" });
    expect(spec.skippable).toBe(true);
    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
    const card = defineBlock({ description: "c", visible: true, schema: z.object({}), example: {} });
    expect(Object.keys(inputSpecs({ card, commit_answer: commit() }))).toEqual(["commit_answer"]);
  });

  it("choiceOptions: an enum's options, or the shown data's strings", () => {
    const [choice] = inputFields(commit());
    expect(choiceOptions(choice, { question: "q", options: ["Yo", 3, "Mi amiga"] })).toEqual(["Yo", "Mi amiga"]);
    expect(choiceOptions(choice, { question: "q" })).toEqual([]);
    expect(choiceOptions({ name: "l", kind: "choice", label: { es: "l", en: "l" }, optional: false, options: ["a"] }, null)).toEqual(["a"]);
  });
});

describe("saveTo", () => {
  const flashcards = defineBlock({
    description: "Cards.",
    visible: true,
    schema: z.object({}),
    input: z.object({ summary: z.string(), cards: z.array(z.object({ front: z.string(), back: z.string() })) }),
    skippable: true,
    saveTo: { collection: "flashcards", records: (v) => v.cards.map((c) => ({ id: c.front, ...c })) },
    example: {},
  });
  const plain = defineBlock({ description: "Plain.", visible: true, schema: z.object({}), input: z.object({ id: z.string() }), saveTo: { collection: "cards" }, example: {} });
  const harnessWith = (data: Record<string, unknown>) =>
    defineHarness({
      id: "quiz",
      name: { es: "Q", en: "Q" },
      core: "^0.1.0",
      languages: ["es", "en"],
      engines: ["claude"],
      folder: { suggested: "Documents/Q" },
      instructions: "./AGENTS.md",
      permissions: { edit: "none", exec: false, web: false },
      blocks: { plain },
      data: data as never,
      author: "t",
    });

  it("needs an input; the manifest checks its collection exists", () => {
    expect(() => defineBlock({ description: "x", visible: true, schema: z.object({}), saveTo: { collection: "c" }, example: {} })).toThrow(/need an input/);
    expect(() => harnessWith({})).toThrow(/Collection \\"cards\\" is not declared in data/);
    expect(harnessWith({ cards: { scoped: false, key: "id", schema: z.object({ id: z.string() }), agent: "read" } }).blocks.plain.saveTo?.collection).toBe("cards");
  });

  it("checks the shape of saveTo", () => {
    const base = { description: "x", visible: true, schema: z.object({}), input: z.object({ id: z.string() }), example: {} };
    expect(() => defineBlock({ ...base, saveTo: { collection: 3 as never } })).toThrow(/saveTo needs a collection name/);
    expect(() => defineBlock({ ...base, saveTo: { collection: "" } })).toThrow(/saveTo needs a collection name/);
    expect(() => defineBlock({ ...base, saveTo: { collection: "cards", records: "nope" as never } })).toThrow(/saveTo.records must be a function/);
  });

  it("answerRecords: the value itself, or the block's mapping on a copy; nothing for a skip", () => {
    expect(answerRecords("plain", plain, { id: "a" })).toEqual([{ id: "a" }]);
    const value = { summary: "s", cards: [{ front: "2+2", back: "4" }] };
    expect(answerRecords("flashcards", flashcards, value)).toEqual([{ id: "2+2", front: "2+2", back: "4" }]);
    expect(answerRecords("flashcards", flashcards, { skipped: true })).toEqual([]);
    const bad = defineBlock({ ...plain, saveTo: { collection: "cards", records: () => "nope" as never } });
    expect(() => answerRecords("bad", bad, { id: "a" })).toThrow(/must return a list of records/);
  });
});
