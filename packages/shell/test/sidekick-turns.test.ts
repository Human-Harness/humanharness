import { describe, expect, it } from "vitest";
import { SIDEKICK_PRE_MARK, parseReview, preSendPrompt } from "../src/main/sidekick-turns";

const input = {
  harness: { name: "Essay Coach", tagline: "Write better essays" },
  phase: { label: "Outline", brief: "Agree on the sections." },
  notes: ["Chapter 2 outline"],
  data: ["sources"],
  flags: [{ kind: "vague" as const, match: "better", span: [8, 14] as [number, number] }],
  uiLanguage: "English",
  prompt: "make it better",
};

describe("preSendPrompt", () => {
  it("starts with the marker and holds the compact context, never the task's history", () => {
    const p = preSendPrompt(input);
    expect(p.startsWith(SIDEKICK_PRE_MARK)).toBe(true);
    expect(p).toContain("Essay Coach — Write better essays");
    expect(p).toContain("Open phase: Outline — Agree on the sections.");
    expect(p).toContain("- Chapter 2 outline");
    expect(p).toContain("- sources");
    expect(p).toContain('- vague: "better" at [8, 14]');
    expect(p).toContain("UI language: English");
    expect(p).toContain("<prompt>\nmake it better\n</prompt>");
    expect(p).toMatch(/Answer with the JSON object only/);
  });

  it("tells the model to leave rewrite out on a send", () => {
    expect(preSendPrompt(input)).toMatch(/omit "rewrite" when the verdict is "send"/i);
  });

  it("says when there are no flags and no phase", () => {
    const p = preSendPrompt({ ...input, flags: [], phase: undefined, notes: [], data: [] });
    expect(p).toContain("Local flags: none (the person asked for a review)");
    expect(p).not.toContain("Open phase");
    expect(p).toContain("Notes in this scope:\n- (none)");
  });

  it("keeps only the first line of the phase brief and at most 20 notes", () => {
    const notes = Array.from({ length: 25 }, (_, n) => `note ${n}`);
    const p = preSendPrompt({ ...input, phase: { label: "Draft", brief: "First line.\nSecond line." }, notes });
    expect(p).toContain("Open phase: Draft — First line.");
    expect(p).not.toContain("Second line.");
    expect(p).toContain("- note 19");
    expect(p).not.toContain("- note 20");
  });
});

describe("parseReview", () => {
  it("parses the contract", () => {
    const r = parseReview(
      '{"verdict":"suggest","issues":[{"kind":"vague","text":"Say what better means.","span":[8,14]}],"rewrite":"Make the intro shorter.","queued":["Translate it"],"confidence":0.8}',
    );
    expect(r?.verdict).toBe("suggest");
    expect(r?.issues[0].span).toEqual([8, 14]);
    expect(r?.rewrite).toBe("Make the intro shorter.");
    expect(r?.queued).toEqual(["Translate it"]);
  });

  it("tolerates code fences and prose around one object", () => {
    expect(parseReview('Sure:\n```json\n{"verdict":"send","issues":[],"confidence":0.9}\n```')?.verdict).toBe("send");
  });

  it("defaults missing issues; refuses bad confidence, bad verdicts and non-JSON", () => {
    expect(parseReview('{"verdict":"send","confidence":1}')?.issues).toEqual([]);
    expect(parseReview('{"verdict":"send","issues":[],"confidence":2}')).toBeNull();
    expect(parseReview('{"verdict":"maybe","issues":[],"confidence":0.5}')).toBeNull();
    expect(parseReview('{"verdict":"send",')).toBeNull();
    expect(parseReview("no")).toBeNull();
  });

  it("a suggest without a rewrite or issues is a send", () => {
    expect(parseReview('{"verdict":"suggest","issues":[],"confidence":0.9}')?.verdict).toBe("send");
  });

  it("ignores a rewrite equal to the prompt (the model echoing it)", () => {
    const echo = parseReview('{"verdict":"send","issues":[],"rewrite":"make it better","confidence":0.9}', " make it better\n");
    expect(echo?.rewrite).toBeUndefined();
    const onlyEcho = parseReview('{"verdict":"suggest","issues":[],"rewrite":"make it better","confidence":0.9}', "make it better");
    expect(onlyEcho?.verdict).toBe("send");
    expect(onlyEcho?.rewrite).toBeUndefined();
    const real = parseReview('{"verdict":"suggest","issues":[],"rewrite":"Shorten the intro.","confidence":0.9}', "make it better");
    expect(real?.rewrite).toBe("Shorten the intro.");
  });
});
