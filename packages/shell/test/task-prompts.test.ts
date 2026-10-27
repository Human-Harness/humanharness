import { promptKind } from "@humanharness/fake-agent";
import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_PROMPT,
  CLOSE_PROMPT,
  PHASES_HOW,
  QUESTION_PROMPT,
  RESUME_PROMPT,
  WRAP_UP_PROMPT,
  closePrompt,
  fillPrompt,
  modePrompt,
  modeSection,
  phasePrompt,
  phaseSection,
  phasesSection,
  recommendSection,
  resumeMessage,
  wrapUpPrompt,
} from "../src/main/task-prompts";

const index = "## What we already covered\n- Engines → .harness/notes/engines.md";

describe("fillPrompt", () => {
  it("fills the language and the notes index", () => {
    expect(fillPrompt("Answer in {{language}}.\n\n{{ notesIndex }}", { language: "es", notesIndex: index })).toBe(`Answer in Spanish.\n\n${index}`);
    expect(fillPrompt("Answer in {{language}}.", { language: "en", notesIndex: "" })).toBe("Answer in English.");
  });

  it("appends the index when the brief has no place for it", () => {
    expect(fillPrompt("# Topic: blocks", { language: "en", notesIndex: index })).toBe(`# Topic: blocks\n\n${index}`);
  });

  it("leaves no run of blank lines when the index is empty", () => {
    expect(fillPrompt("Intro.\n\n{{notesIndex}}\n\nEnd.", { language: "en", notesIndex: "" })).toBe("Intro.\n\nEnd.");
  });

  it("keeps unknown placeholders and never fills values into inserted text", () => {
    expect(fillPrompt("{{other}} {{constructor}}", { language: "en", notesIndex: "" })).toBe("{{other}} {{constructor}}");
    expect(fillPrompt(QUESTION_PROMPT, { language: "en", notesIndex: "", question: "What is {{notesIndex}}?" })).toContain(
      "## Question\nWhat is {{notesIndex}}?",
    );
  });

  it("never rewrites the blank lines or edges of inserted text", () => {
    const question = "First part.\n\n\n\nSecond part after blank lines.\n";
    const notes = "## Notes\n\n\n- one\n";
    const text = fillPrompt(QUESTION_PROMPT, { language: "en", notesIndex: notes, question });
    expect(text).toContain(notes);
    expect(text.endsWith(`## Question\n${question}`)).toBe(true);
  });

  it("names any language tag in English", () => {
    expect(fillPrompt("Answer in {{language}}.", { language: "pt-BR", notesIndex: "" })).toBe("Answer in Brazilian Portuguese.");
    expect(fillPrompt("Answer in {{language}}.", { language: "fr", notesIndex: "" })).toBe("Answer in French.");
  });

  it("asks for the closing note in English", () => {
    expect(CLOSE_PROMPT).toContain("Write the note in English.");
  });

  it("builds a free question's first message with the index", () => {
    const text = fillPrompt(QUESTION_PROMPT, { language: "es", notesIndex: index, question: "¿Dónde se guarda la conversación?" });
    expect(text).toContain("Answer it in Spanish");
    expect(text).toContain(index);
    expect(text.endsWith("## Question\n¿Dónde se guarda la conversación?")).toBe(true);
  });

  it("asks the closing turn for save_note only", () => {
    expect(CLOSE_PROMPT).toContain("`save_note`");
    expect(CLOSE_PROMPT).toContain("do not call `show_choices`");
  });
});

describe("CHECKPOINT_PROMPT", () => {
  it("asks for the note in English", () => {
    expect(CHECKPOINT_PROMPT).toContain("Write the note in English.");
  });

  it("asks for save_note mid-task, without ending the conversation or showing choices", () => {
    expect(CHECKPOINT_PROMPT).toMatch(/^Checkpoint:/);
    expect(CHECKPOINT_PROMPT).toContain("`save_note`");
    expect(CHECKPOINT_PROMPT).toContain("do not call `show_choices`");
  });
});

describe("resumeMessage", () => {
  it("never claims the folder moved: it also runs after a move that failed", () => {
    expect(RESUME_PROMPT).not.toMatch(/moved/);
    expect(RESUME_PROMPT).toContain("not available");
  });

  it("an action's task: its brief filled as at its start, the resume line, then the person's message", () => {
    const text = resumeMessage({ language: "es", notesIndex: index, brief: "# Topic: blocks\nAnswer in {{language}}.", message: "¿Y {{notesIndex}}?" });
    expect(text.startsWith(`# Topic: blocks\nAnswer in Spanish.\n\n${index}\n\nThe earlier conversation`)).toBe(true);
    expect(text).toContain("Answer in Spanish, then end with `show_choices`.");
    expect(text.endsWith("## The person's message\n¿Y {{notesIndex}}?")).toBe(true);
  });

  it("a free question's task: the question that opened it, after the notes index", () => {
    const text = resumeMessage({ language: "en", notesIndex: index, question: "Where is the chat kept?", message: "And the notes?" });
    expect(text).toBe(
      [
        "The earlier conversation of this topic is not available; continue from the notes and the files in the folder. Answer in English, then end with `show_choices`.",
        index,
        "## The question that opened this topic\nWhere is the chat kept?",
        "## The person's message\nAnd the notes?",
      ].join("\n\n"),
    );
  });
});

describe("mock mode markers", () => {
  it("fake-claude tells the closing turn and the checkpoint by their first words", () => {
    expect(promptKind(CLOSE_PROMPT)).toBe("close");
    expect(promptKind(CHECKPOINT_PROMPT)).toBe("checkpoint");
  });
});

describe("mode prompts (task-modes spec §4, §5.4, §6)", () => {
  const feynman = { label: "Feynman", brief: "Explain it back in {{language}}.\n\n{{notesIndex}}", settings: ["Use 3 steps."] };

  it("the switch: the mode's name, its filled brief, its settings, then go on", () => {
    expect(modePrompt(feynman, { language: "es" })).toBe(
      [
        'From now on work in the mode "Feynman". Keep everything decided so far in this conversation.',
        "Explain it back in Spanish.",
        "- Use 3 steps.",
        "Then continue with the person in this mode.",
      ].join("\n\n"),
    );
  });

  it("the switch carries the last checkpoint's summary when there is one (spec §10.1), each point on one line; a label is never filled again", () => {
    const text = modePrompt({ label: "A $& {{language}}", brief: "Go.", settings: [] }, { language: "en", soFar: ["Halves make a whole.", "Thirds\n  too."] });
    expect(text).toBe(
      [
        'From now on work in the mode "A $& {{language}}". Keep everything decided so far in this conversation.',
        "What is clear so far (the last checkpoint): Halves make a whole.; Thirds too.",
        "Go.",
        "Then continue with the person in this mode.",
      ].join("\n\n"),
    );
  });

  it("a task that starts or resumes in a mode gets its section", () => {
    expect(modeSection(feynman, "en")).toBe(["## Mode: Feynman", "Work in this mode.", "Explain it back in English.", "- Use 3 steps."].join("\n\n"));
    expect(modeSection({ ...feynman, settings: [] }, "en")).toBe(["## Mode: Feynman", "Work in this mode.", "Explain it back in English."].join("\n\n"));
  });

  it("the first message asks for a recommendation with the modes' hints", () => {
    expect(recommendSection([{ id: "socratic", label: "Socratic", recommend: "One key idea to discover." }, { id: "worked", label: "Worked examples" }])).toBe(
      [
        "## How to work",
        "Before you start the work, recommend how to work in this task: call `show_recommend_mode` with the mode that fits best, up to 3 short reasons and up to 2 alternatives, then end your answer and wait for the person's pick. Do not call `show_choices` in this answer.",
        "- `socratic` (Socratic): One key idea to discover.\n- `worked` (Worked examples)",
      ].join("\n\n"),
    );
  });

  it("the closing turn lists the modes used; without any, it is CLOSE_PROMPT exactly (D0)", () => {
    expect(closePrompt([])).toBe(CLOSE_PROMPT);
    expect(closePrompt(["Socratic", "Feynman"])).toBe(`${CLOSE_PROMPT} Also list the modes used (Socratic, Feynman) and what each was good for, as summary points.`);
  });

  it("a resumed session gets the mode's section after the action's brief; without one, as before (D0)", () => {
    const vars = { language: "en" as const, notesIndex: "", brief: "# Task: study", message: "Hi" };
    const section = modeSection(feynman, "en");
    const line = fillPrompt(RESUME_PROMPT, { language: "en", notesIndex: "" });
    expect(resumeMessage({ ...vars, mode: section })).toBe(["# Task: study", section, line, "## The person's message\nHi"].join("\n\n"));
    expect(resumeMessage(vars)).toBe(["# Task: study", line, "## The person's message\nHi"].join("\n\n"));
  });
});

describe("phase prompts (task-phases spec §4.4, §5, §6)", () => {
  const parts = [{ id: "warmup", label: "Warm-up" }, { id: "main", label: "Main block" }, { id: "close", label: "Close" }];
  const main = { id: "main", label: "Main block", brief: "Teach in {{language}}. We came from {{previousPhase}} to {{phase}}. Time left: {{timeLeft}}" };

  it("fillPrompt fills the phase variables only when given; an empty one's own line goes", () => {
    expect(fillPrompt("{{phase}}/{{previousPhase}}/{{timeLeft}}", { language: "en", notesIndex: "" })).toBe("{{phase}}/{{previousPhase}}/{{timeLeft}}");
    expect(fillPrompt("A\n{{timeLeft}}\nB", { language: "en", notesIndex: "", phase: "Main", previousPhase: "", timeLeft: "" })).toBe("A\nB");
  });

  it("lists the parts, marks the current one and says how to move", () => {
    expect(phasesSection(parts, "warmup")).toBe(
      ["## Parts of this task", PHASES_HOW, "- `warmup` (Warm-up) ← now\n- `main` (Main block)\n- `close` (Close)"].join("\n\n"),
    );
  });

  it("a part's section: its heading and its brief filled; no brief, the heading alone", () => {
    expect(phaseSection(main, { language: "es", previous: "Warm-up", timeLeft: "about 12 minutes" })).toBe(
      "## Part: Main block\n\nTeach in Spanish. We came from Warm-up to Main block. Time left: about 12 minutes",
    );
    expect(phaseSection({ id: "close", label: "Close", brief: "" }, { language: "en" })).toBe("## Part: Close");
  });

  it("a change: the new part, the way back, the time left, the brief, extra sections, the closing line", () => {
    expect(phasePrompt(main, { language: "en", previous: "Close", back: true, timeLeft: "about 5 minutes", extra: ["## Mode: Socratic"] })).toBe(
      [
        'Next part of this task: "Main block" (`main`).',
        "The person went back to this part.",
        "Time left: about 5 minutes.",
        "Teach in English. We came from Close to Main block. Time left: about 5 minutes",
        "## Mode: Socratic",
        "Then continue with the person in this part.",
      ].join("\n\n"),
    );
    // A label is inserted once: "{{phase}}" inside it is never filled again.
    expect(phasePrompt({ id: "x", label: "{{phase}}", brief: "" }, { language: "en" }).split("\n\n")[0]).toBe('Next part of this task: "{{phase}}" (`x`).');
  });

  it("the wrap-up and its fixed start", () => {
    expect(wrapUpPrompt("es")).toBe(WRAP_UP_PROMPT.replace("{{language}}", "Spanish"));
    expect(WRAP_UP_PROMPT.startsWith("Time is almost up:")).toBe(true);
  });

  it("a resumed session carries the parts after the mode; D0 without them", () => {
    const withPart = resumeMessage({ language: "en", notesIndex: "", brief: "# Task: session", mode: "## Mode: Socratic", phase: "## Parts of this task", message: "Hi" });
    expect(withPart.indexOf("## Mode: Socratic")).toBeLessThan(withPart.indexOf("## Parts of this task"));
    expect(resumeMessage({ language: "en", notesIndex: "", brief: "# Task: session", message: "Hi" })).not.toContain("Parts of this task");
  });
});
