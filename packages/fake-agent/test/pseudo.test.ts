import { describe, expect, it } from "vitest";
import { pseudoTranslate } from "../src/pseudo";

const prompt = (batch: unknown) => `Translate.\n<batch>\n${JSON.stringify(batch)}\n</batch>\n`;

describe("pseudoTranslate (spec §9)", () => {
  it("prefixes every text, keeps placeholders and tags, writes each requested plural form", () => {
    const out = pseudoTranslate(prompt({ forms: ["few", "one", "other"], strings: { "core:a": "Start {{name}}", "core:b": "In <b>{{x}}</b>", "core:p": { one: "{{count}} item", other: "{{count}} items" } } }), "[xx]");
    expect(out).toEqual({ "core:a": "[xx] Start {{name}}", "core:b": "[xx] In <b>{{x}}</b>", "core:p": { few: "[xx] {{count}} items", one: "[xx] {{count}} item", other: "[xx] {{count}} items" } });
  });

  it("breaks the keys it is told to (drops their placeholders)", () => {
    expect(pseudoTranslate(prompt({ forms: ["other"], strings: { "core:a": "Start {{name}}" } }), "[xx]", ["core:a"])).toEqual({ "core:a": "[xx] Start" });
  });

  it("no batch: nothing", () => expect(pseudoTranslate("hello", "[xx]")).toEqual({}));

  it("a batch that is not JSON: nothing", () => expect(pseudoTranslate("<batch>{nope</batch>", "[xx]")).toEqual({}));
});
