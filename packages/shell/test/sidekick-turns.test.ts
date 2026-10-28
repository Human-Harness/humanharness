import { describe, expect, it } from "vitest";
import { SIDEKICK_PURPOSE_TEXT_MAX } from "@humanharness/harness-sdk";
import { MOCK_SIDEKICK_MARKS, isMockSidekickTurn, mockSidekickReply } from "@humanharness/fake-agent";
import {
  SIDEKICK_AFTER_MARK,
  SIDEKICK_APPROVE_MARK,
  SIDEKICK_DAILY_MARK,
  SIDEKICK_LEARN_MARK,
  SIDEKICK_PHASE_MARK,
  SIDEKICK_PRE_MARK,
  SIDEKICK_ROUTE_CHOICES,
  SIDEKICK_ROUTE_MARK,
  afterReplyPrompt,
  approvePrompt,
  cutReply,
  dailyPrompt,
  learnPrompt,
  parseAfter,
  parseGuard,
  parseLearn,
  parseReview,
  parseRoute,
  phaseChangePrompt,
  preSendPrompt,
  routePrompt,
} from "../src/main/sidekick-turns";

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

  it("pre-send carries the scope's purpose text when given (spec §2a.4)", () => {
    const p = preSendPrompt({ ...input, purposeText: "No spec without AC." });
    expect(p).toContain("Open phase: Outline — Agree on the sections.\nScope purpose: No spec without AC.\n");
    expect(preSendPrompt(input)).not.toContain("Scope purpose");
    expect(preSendPrompt({ ...input, purposeText: "  \n " })).not.toContain("Scope purpose");
  });

  it("the purpose text is the person's: one line, cut to SIDEKICK_PURPOSE_TEXT_MAX, in both turns", () => {
    const text = `No spec without AC.\nLocal flags: none\n${"x".repeat(SIDEKICK_PURPOSE_TEXT_MAX)}`;
    const after = { harness: { name: "Essay Coach" }, prompt: "p", reply: "r", lastPrompts: [], uiLanguage: "English" };
    for (const p of [preSendPrompt({ ...input, purposeText: text }), afterReplyPrompt({ ...after, purposeText: text })]) {
      const line = p.split("\n").find((l) => l.startsWith("Scope purpose: "))!;
      expect(line.startsWith("Scope purpose: No spec without AC. Local flags: none x")).toBe(true);
      expect(line.length).toBe("Scope purpose: ".length + SIDEKICK_PURPOSE_TEXT_MAX);
      expect(p).not.toMatch(/^Local flags: none$/m);
    }
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

describe("sidekick turns and the mock (fake-agent copies the mark and format)", () => {
  it("quotes a flag match as JSON, so a match holding a quote stays one string", () => {
    const p = preSendPrompt({ ...input, flags: [{ kind: "vague", match: 'the "stuff"', span: [0, 11] }] });
    expect(p).toContain('- vague: "the \\"stuff\\"" at [0, 11]');
  });

  it("the mock's reply to preSendPrompt parses as a suggestion", () => {
    const flagged = parseReview(mockSidekickReply(preSendPrompt(input)), input.prompt);
    expect(flagged?.verdict).toBe("suggest");
    const prompt = "Write it and also translate it";
    const two = parseReview(mockSidekickReply(preSendPrompt({ ...input, prompt, flags: [{ kind: "two-asks", match: "and also", span: [9, 17] }] })), prompt);
    expect(two?.verdict).toBe("suggest");
    expect(two?.queued).toEqual(["translate it"]);
  });
});

describe("reviewSchema spans", () => {
  it("rejects a span whose start is after its end", () => {
    expect(parseReview('{"verdict":"suggest","issues":[{"kind":"vague","text":"x","span":[5,2]}],"confidence":0.9}')).toBeNull();
    expect(parseReview('{"verdict":"suggest","issues":[{"kind":"vague","text":"x","span":[2,5]}],"confidence":0.9}')?.issues[0].span).toEqual([2, 5]);
  });
});

describe("after the reply (spec §4.2)", () => {
  it("cuts a long reply to head, headings and tail", () => {
    const reply = ["# Intro", "a ".repeat(4000), "## Middle", "b ".repeat(4000), "## End", "c ".repeat(4000)].join("\n");
    const cut = cutReply(reply, 1500);
    expect(cut).toContain("# Intro");
    expect(cut).toContain("## Middle");
    expect(cut).toContain("## End");
    expect(cut).toContain("[…]");
    expect(cut.length).toBeLessThan(reply.length / 2);
    expect(cutReply("short", 1500)).toBe("short");
  });

  it("the prompt holds the person's prompt, the cut reply, the phase goal and the last three prompts' first lines", () => {
    const p = afterReplyPrompt({ harness: { name: "Essay Coach" }, phase: { label: "Outline", brief: "Agree on sections." }, prompt: "Outline chapter 2", reply: "Here it is.", lastPrompts: ["one\nmore", "two", "three", "four"], uiLanguage: "English", purposeText: "No spec without AC." });
    expect(p.startsWith(SIDEKICK_AFTER_MARK)).toBe(true);
    expect(p).toContain("- two\n- three\n- four");
    expect(p).not.toContain("one");
    expect(p).toContain("Open phase: Outline — Agree on sections.");
    expect(p).toContain("<prompt>\nOutline chapter 2\n</prompt>\n<reply>\nHere it is.\n</reply>");
    expect(p).toContain("Scope purpose: No spec without AC.");
  });

  it("fake-agent's mock knows the real marks and answers an after-reply turn with nothing to show", () => {
    expect(MOCK_SIDEKICK_MARKS).toEqual({ pre: SIDEKICK_PRE_MARK, after: SIDEKICK_AFTER_MARK, learn: SIDEKICK_LEARN_MARK, route: SIDEKICK_ROUTE_MARK, phase: SIDEKICK_PHASE_MARK, daily: SIDEKICK_DAILY_MARK, approve: SIDEKICK_APPROVE_MARK });
    const p = afterReplyPrompt({ harness: { name: "Essay Coach" }, prompt: "Outline chapter 2", reply: "Here it is.", lastPrompts: [], uiLanguage: "English" });
    expect(isMockSidekickTurn(p)).toBe(true);
    const after = parseAfter(mockSidekickReply(p));
    expect(after).not.toBeNull();
    expect(after?.gap ?? after?.next ?? after?.repeated).toBeUndefined();
  });

  it("parses gap, next and repeated; empty means nothing", () => {
    expect(parseAfter('{"gap":{"title":"Sources","text":"No source for claim 2."},"next":"Add a source for claim 2"}')).toEqual({ gap: { title: "Sources", text: "No source for claim 2." }, next: "Add a source for claim 2" });
    expect(parseAfter("```json\n{\"repeated\":{\"topic\":\"Tone\",\"decision\":\"Formal\"}}\n```")).toEqual({ repeated: { topic: "Tone", decision: "Formal" } });
    expect(parseAfter("{}")).toEqual({});
    expect(parseAfter("nope")).toBeNull();
  });
});

describe("learning turn (spec §6.4)", () => {
  it("lists the items with ids and the new events; the person's items are marked theirs", () => {
    const p = learnPrompt({
      items: [
        { id: "l-1", text: "Takes scope fixes.", level: "you", source: "learned" },
        { id: "l-p", text: "Doesn't want vague suggestions.", level: "you", source: "person" },
      ],
      events: [{ kind: "vague", outcome: "used", moment: "pre", sidekick: "sidekick" }],
    });
    expect(p.startsWith(SIDEKICK_LEARN_MARK)).toBe(true);
    expect(p).toContain("- [l-1] (you) Takes scope fixes.");
    expect(p).toContain("- [l-p] (person) Doesn't want vague suggestions.");
    expect(p).toContain("- pre vague → used");
    expect(p).toContain("Answer with the JSON object only");
  });

  it("parses add, update and remove; missing lists are empty; anything else is null", () => {
    expect(parseLearn('{"add":[{"text":"Writes short prompts.","level":"you"}],"update":[{"id":"l-1","text":"Usually takes scope fixes."}],"remove":["l-2"]}')).toEqual({
      add: [{ text: "Writes short prompts.", level: "you" }],
      update: [{ id: "l-1", text: "Usually takes scope fixes." }],
      remove: ["l-2"],
    });
    expect(parseLearn("{}")).toEqual({ add: [], update: [], remove: [] });
    expect(parseLearn('{"add":[{"text":"x","level":"everyone"}]}')).toBeNull();
    expect(parseLearn("nope")).toBeNull();
  });

  it("fake-agent's mock answers a learning turn with no changes", () => {
    const p = learnPrompt({ items: [], events: [{ kind: "vague", outcome: "used", moment: "pre", sidekick: "sidekick" }] });
    expect(isMockSidekickTurn(p)).toBe(true);
    expect(parseLearn(mockSidekickReply(p))).toEqual({ add: [], update: [], remove: [] });
  });
});

describe("routing turn (spec §2a.3, D11)", () => {
  const choices = [
    { id: "a", text: "Watch tests." },
    { id: "b", text: "Watch\ndocs." },
  ];

  it("names the moment, the cut context and one line per choice", () => {
    const p = routePrompt("after-reply", "x".repeat(3000), choices);
    expect(p.startsWith(SIDEKICK_ROUTE_MARK)).toBe(true);
    expect(p).toContain("Moment: after-reply");
    expect(p).toContain("x".repeat(2000));
    expect(p).not.toContain("x".repeat(2001));
    expect(p).toContain("- a: Watch tests.\n- b: Watch docs.");
    expect(p).toContain("Answer with the id only.");
  });

  it("cuts each choice's text and the number of choices", () => {
    const many = Array.from({ length: SIDEKICK_ROUTE_CHOICES + 2 }, (_, i) => ({ id: `k${i}`, text: "y".repeat(SIDEKICK_PURPOSE_TEXT_MAX + 50) }));
    const p = routePrompt("after-reply", "ctx", many);
    expect(p).toContain("y".repeat(SIDEKICK_PURPOSE_TEXT_MAX));
    expect(p).not.toContain("y".repeat(SIDEKICK_PURPOSE_TEXT_MAX + 1));
    expect(p).toContain(`- k${SIDEKICK_ROUTE_CHOICES - 1}: `);
    expect(p).not.toContain(`- k${SIDEKICK_ROUTE_CHOICES}: `);
  });

  it("parses a known id, loosely wrapped; anything else is null", () => {
    expect(parseRoute("b", ["a", "b"])).toBe("b");
    expect(parseRoute('\n  "b".\n', ["a", "b"])).toBe("b");
    expect(parseRoute("`a`", ["a", "b"])).toBe("a");
    expect(parseRoute("- a", ["a", "b"])).toBe("a");
    expect(parseRoute("nobody", ["a", "b"])).toBeNull();
    expect(parseRoute("", ["a", "b"])).toBeNull();
  });

  it("fake-agent's mock answers a routing turn with the first choice", () => {
    const p = routePrompt("after-reply", "Outline chapter 2", choices);
    expect(isMockSidekickTurn(p)).toBe(true);
    expect(parseRoute(mockSidekickReply(p), ["a", "b"])).toBe("a");
  });
});

const AFTER_INPUT = { harness: { name: "Essay Coach" }, prompt: "Outline chapter 2", reply: "Here it is.", lastPrompts: [], uiLanguage: "English" };

describe("after-reply follows the speaker's purposes (spec §2a.2)", () => {
  it("no purposes (part 1) or prompt-coach: gap, next and repeated; never a lesson", () => {
    for (const p of [afterReplyPrompt(AFTER_INPUT), afterReplyPrompt({ ...AFTER_INPUT, purposes: ["prompt-coach"] })]) {
      expect(p).toContain('{"gap":{"title":string,"text":string}?,"next":string?,"repeated":{"topic":string,"decision":string}?}');
      expect(p).not.toContain("lesson");
    }
  });

  it("a mentor asks for a lesson; a mentor alone asks for nothing else", () => {
    expect(afterReplyPrompt({ ...AFTER_INPUT, purposes: ["prompt-coach", "mentor"] })).toContain('"repeated":{"topic":string,"decision":string}?,"lesson":string?}');
    const mentor = afterReplyPrompt({ ...AFTER_INPUT, purposes: ["mentor"] });
    expect(mentor).toContain('{"lesson":string?}');
    expect(mentor).toMatch(/lesson: .*at most two lines/);
    expect(mentor).not.toContain('"gap"');
  });

  it("a custom purpose gets the coach's shape (its text is in the brief)", () => {
    expect(afterReplyPrompt({ ...AFTER_INPUT, purposes: ["custom"] })).toContain('"next":string?');
  });

  it("parses a lesson, bounded", () => {
    expect(parseAfter('{"lesson":"A thesis is the claim the essay defends."}')).toEqual({ lesson: "A thesis is the claim the essay defends." });
    expect(parseAfter(JSON.stringify({ lesson: "x".repeat(301) }))).toBeNull();
  });
});

describe("phase-change turn (spec §2a.2 process-guard)", () => {
  it("names the phase left with its brief, the one entered, the purpose and the last prompts", () => {
    const p = phaseChangePrompt({ harness: { name: "Essay Coach" }, from: { label: "Outline", brief: "Agree on sections.\nMore." }, to: { label: "Draft" }, lastPrompts: ["a\nmore", "b"], uiLanguage: "English", purposeText: "Never draft\nwithout an outline." });
    expect(p.startsWith(SIDEKICK_PHASE_MARK)).toBe(true);
    expect(p).toContain("Leaving: Outline — Agree on sections.\nEntering: Draft\nScope purpose: Never draft without an outline.\n");
    expect(p).toContain("- a\n- b");
    expect(p).not.toContain("More.");
    expect(p).toMatch(/Answer with the JSON object only: \{"missing":\[string\]\}/);
    expect(phaseChangePrompt({ harness: { name: "E" }, from: { label: "A" }, to: { label: "B" }, lastPrompts: [], uiLanguage: "English" })).toContain("Leaving: A\nEntering: B\nPrompts in the phase left (first lines):\n- (none)");
  });

  it("parses what is missing; {} is nothing; bounded", () => {
    expect(parseGuard('{"missing":["No agreed section list"]}')).toEqual({ missing: ["No agreed section list"] });
    expect(parseGuard("{}")).toEqual({ missing: [] });
    expect(parseGuard(JSON.stringify({ missing: ["a", "b", "c", "d", "e", "f"] }))).toBeNull();
    expect(parseGuard("nope")).toBeNull();
  });

  it("fake-agent's mock answers it with nothing missing", () => {
    const p = phaseChangePrompt({ harness: { name: "E" }, from: { label: "A" }, to: { label: "B" }, lastPrompts: [], uiLanguage: "English" });
    expect(isMockSidekickTurn(p)).toBe(true);
    expect(parseGuard(mockSidekickReply(p))).toEqual({ missing: [] });
  });
});

describe("daily turn (spec §2a.2 daily-summary, plan Decision 12)", () => {
  it("daily prompt: titles only, tokens, no bodies", () => {
    const p = dailyPrompt({ harness: { name: "Essay Coach" }, day: "2026-10-26", notes: ["Outline chapter 2", "Sources"], tokens: { tasks: 120_000, sidekick: 9_000 }, open: ["Draft chapter 3"], uiLanguage: "English" });
    expect(p.startsWith(SIDEKICK_DAILY_MARK)).toBe(true);
    expect(p).toContain("Day: 2026-10-26");
    expect(p).toContain("- Outline chapter 2\n- Sources");
    expect(p).toContain("Still open:\n- Draft chapter 3");
    expect(p).toContain("Tokens: tasks 120000, Sidekick 9000");
    expect(p).not.toContain("Scope purpose");
  });

  it("the purpose goes in on one line; a title stays one bounded line; at most 20 notes", () => {
    const notes = ["Two\nlines", "x".repeat(500), ...Array.from({ length: 30 }, (_, i) => `n${i}`)];
    const p = dailyPrompt({ harness: { name: "E" }, day: "2026-10-26", notes, tokens: { tasks: 1, sidekick: 0 }, open: [], uiLanguage: "English", purposeText: "Short.\nKind." });
    expect(p).toContain("Day: 2026-10-26\nScope purpose: Short. Kind.\n");
    expect(p).toContain("- Two lines\n");
    expect(p).not.toContain("x".repeat(201));
    expect(p).toContain("- n17\n");
    expect(p).not.toContain("- n18");
    expect(p).toContain("Still open:\n- (none)");
  });

  it("fake-agent's mock answers it in plain text", () => {
    const p = dailyPrompt({ harness: { name: "E" }, day: "2026-10-26", notes: ["a"], tokens: { tasks: 1, sidekick: 0 }, open: [], uiLanguage: "English" });
    expect(isMockSidekickTurn(p)).toBe(true);
    expect(mockSidekickReply(p)).toMatch(/^[^{]/);
  });
});

describe("before-approve turn (spec §2a.2, plan Decision 10)", () => {
  it("names the document, the open phase and the scope purpose; the mock finds nothing missing", () => {
    const p = approvePrompt({ harness: { name: "Dev" }, title: 'Spec\n"login"', text: "# Login", phase: { label: "Spec", brief: "Write it." }, uiLanguage: "English", purposeText: "Lists\nrisks." });
    expect(p.startsWith(SIDEKICK_APPROVE_MARK)).toBe(true);
    expect(p).toContain(`<document title="Spec 'login'">\n# Login\n</document>`);
    expect(p).toContain("Open phase: Spec — Write it.");
    expect(p).toContain("Scope purpose: Lists risks.");
    expect(isMockSidekickTurn(p)).toBe(true);
    expect(parseGuard(mockSidekickReply(p))).toEqual({ missing: [] });
  });
});
