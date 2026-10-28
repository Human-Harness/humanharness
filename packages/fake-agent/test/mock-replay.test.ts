import { answerMessage } from "@humanharness/harness-sdk";
import { describe, expect, it } from "vitest";
import { recordingSchema } from "../src/mock";
import { DEFAULT_FALLBACK, MOCK_JOB_MARK, MOCK_JOB_RESULT, isMockJobTurn, promptKind, replay } from "../src/mock-replay";

const choices = {
  tool: "show_choices",
  input: { options: [{ label: "Profundizar", followUp: "Contame más." }, { label: "Sin texto" }, { label: "Seguir →", next: true }] },
};
const rec = recordingSchema.parse({
  version: 1,
  action: "manifest",
  match: "# Topic: the manifest",
  turns: [
    { id: "t1", text: "Primero.", blocks: [choices], next: { Profundizar: "t2", "Sin texto": "t3" } },
    { id: "t2", text: "Más.", next: { "*": "t3" } },
    { id: "t3", text: "Fin." },
    { id: "close", note: { title: "El manifiesto", summary: ["uno"] } },
  ],
});
const other = recordingSchema.parse({ version: 1, action: "engines", match: "# Topic: engines", fallback: { text: "No grabado." }, turns: [{ id: "e1", text: "Motores." }] });
const all = [rec, other];

describe("promptKind", () => {
  it("tells the closing turn, the checkpoint and the rest apart", () => {
    expect(promptKind("We are closing this topic. Call the `save_note` tool…")).toBe("close");
    expect(promptKind("Checkpoint: this conversation is getting long.")).toBe("checkpoint");
    expect(promptKind("Contame más.")).toBe("reply");
    expect(promptKind('Next part of this task: "Main block" (`main`).\n\nTeach.')).toBe("phase");
    expect(promptKind("Time is almost up: finish the current point briefly, in en.")).toBe("wrap-up");
  });
});

describe("replay", () => {
  it("a new session picks the recording whose match is in the brief and plays its first turn", () => {
    const r = replay(all, undefined, "# Topic: the manifest\n\nExplain…", true);
    expect(r.play.text).toBe("Primero.");
    expect(r.play.blocks).toEqual([choices]);
    expect(r.session).toEqual({ action: "manifest", turn: "t1" });
  });

  it("a choice's followUp, or its label, leads along next", () => {
    const s = { action: "manifest", turn: "t1" };
    expect(replay(all, s, "Contame más.", false).session.turn).toBe("t2");
    expect(replay(all, s, "Sin texto", false).session.turn).toBe("t3");
  });

  it("free text follows *", () => {
    expect(replay(all, { action: "manifest", turn: "t2" }, "lo que sea", false).play.text).toBe("Fin.");
  });

  it("an unrecorded reply plays the fallback, offers the turn's choices again and stays put", () => {
    const r = replay(all, { action: "manifest", turn: "t1" }, "otra cosa", false);
    expect(r.play.text).toBe(DEFAULT_FALLBACK);
    expect(r.play.blocks).toEqual([choices]);
    expect(r.session).toEqual({ action: "manifest", turn: "t1" });
    expect(replay(all, { action: "engines", turn: "e1" }, "x", false).play.text).toBe("No grabado.");
  });

  it("a session no recording matches gets the default fallback with no blocks", () => {
    const r = replay(all, undefined, "The person asked a question…", true);
    expect(r.play).toMatchObject({ text: DEFAULT_FALLBACK, blocks: [] });
    expect(r.session).toEqual({ action: null, turn: null });
  });

  it("the closing turn plays close; without one it saves a default note", () => {
    expect(replay(all, { action: "manifest", turn: "t3" }, "We are closing this topic.", false).play.note).toEqual({ title: "El manifiesto", summary: ["uno"] });
    expect(replay(all, { action: "engines", turn: "e1" }, "We are closing this topic.", false).play.note).toEqual({
      title: "engines",
      summary: ["Recorded test run"],
      decisions: [],
      files: [],
      open: [],
    });
  });

  it("a checkpoint saves the closing note and keeps the position", () => {
    const r = replay(all, { action: "manifest", turn: "t2" }, "Checkpoint: …", false);
    expect(r.play.note).toEqual({ title: "El manifiesto", summary: ["uno"] });
    expect(r.play.blocks).toEqual([]);
    expect(r.session.turn).toBe("t2");
  });

  it("a resumed session (new id, brief inside) starts the recording over", () => {
    const r = replay(all, undefined, "# Topic: the manifest\n…\n\n## The person's message\nhola", true);
    expect(r.session.turn).toBe("t1");
  });

  it("the longest match wins", () => {
    const longer = recordingSchema.parse({ version: 1, action: "long", match: "# Topic: the manifest and more", turns: [{ id: "l1", text: "Larga." }] });
    expect(replay([rec, longer], undefined, "# Topic: the manifest and more", true).session.action).toBe("long");
  });

  it("the close turn keeps no blocks and, without a note, saves a default one", () => {
    const r = recordingSchema.parse({ version: 1, action: "a", match: "# a", turns: [{ id: "a1", text: "x" }, { id: "close", text: "Chau.", blocks: [choices] }] });
    const p = replay([r], { action: "a", turn: "a1" }, "We are closing this topic.", false).play;
    expect(p.blocks).toEqual([]);
    expect(p.note).toMatchObject({ title: "a", summary: ["Recorded test run"] });
  });

  it("a reply with no current turn, or a turn without next, plays the fallback", () => {
    expect(replay(all, { action: "manifest", turn: null }, "x", false).play.text).toBe(DEFAULT_FALLBACK);
    expect(replay(all, { action: "manifest", turn: "t3" }, "x", false).play.text).toBe(DEFAULT_FALLBACK);
  });

  it("a reply that matches no label goes to *, and an empty followUp counts as the label", () => {
    const r = recordingSchema.parse({
      version: 1,
      action: "b",
      match: "# b",
      turns: [
        { id: "b1", blocks: [{ tool: "show_choices", input: { options: [{ label: "Uno", followUp: "" }] } }], next: { Uno: "b2", "*": "b3" } },
        { id: "b2", text: "dos" },
        { id: "b3", text: "tres" },
      ],
    });
    expect(replay([r], { action: "b", turn: "b1" }, "Uno", false).play.text).toBe("dos");
    expect(replay([r], { action: "b", turn: "b1" }, "otra", false).play.text).toBe("tres");
  });

  it("a recording with only a close turn uses its fallback for a new session", () => {
    const r = recordingSchema.parse({ version: 1, action: "c", match: "# c", fallback: { text: "Nada." }, turns: [{ id: "close", note: { title: "c" } }] });
    expect(replay([r], undefined, "# c", true).play.text).toBe("Nada.");
  });
});

describe("replay: answers to input blocks", () => {
  const quiz = recordingSchema.parse({
    version: 1,
    action: "practice",
    match: "# Task: practice",
    turns: [
      {
        id: "t1",
        text: "Commit first.",
        blocks: [{ tool: "show_commit_answer", input: { question: "Who ate more?" } }],
        respond: [{ block: "commit_answer", value: { choice: "Me", why: "two halves" }, next: "t2" }],
        next: { "*": "t3" },
      },
      { id: "t2", text: "Right." },
      { id: "t3", text: "Let's see." },
    ],
  });
  const at = { action: "practice", turn: "t1" };
  const answering = (value: Record<string, unknown>) => answerMessage({ name: "commit_answer", blockId: "t1:0:0", value, display: "x" });

  it("an answer equal to a recorded one, key order aside, plays its turn", () => {
    const r = replay([quiz], at, answering({ why: "two halves", choice: "Me" }), false);
    expect(r.play.text).toBe("Right.");
    expect(r.session).toEqual({ action: "practice", turn: "t2" });
  });

  it("any other answer follows *, and without * the fallback", () => {
    expect(replay([quiz], at, answering({ why: "no idea" }), false).play.text).toBe("Let's see.");
    const strict = recordingSchema.parse({ ...quiz, turns: [{ ...quiz.turns[0], next: undefined }, quiz.turns[1], quiz.turns[2]] });
    expect(replay([strict], at, answering({ why: "no idea" }), false).play.text).toBe(DEFAULT_FALLBACK);
  });
});

describe("replay: phases (task-phases spec §6)", () => {
  const tutor = recordingSchema.parse({
    version: 1,
    action: "session",
    match: "# Task: session",
    turns: [
      { id: "t1", text: "What do you remember?", blocks: [{ tool: "set_phase", input: { to: "main", reason: "Recall done" } }], next: { "*": "t2" } },
      { id: "t2", text: "Let's start.", setPhase: "main" },
      { id: "t3", text: "Last point, quickly.", timeUp: true },
      { id: "t4", text: "Sum it up.", setPhase: "close" },
    ],
  });
  const at = { action: "session", turn: "t1" };

  it("a phase change plays the turn recorded for that part, wherever the session is", () => {
    const r = replay([tutor], at, 'Next part of this task: "Main block" (`main`).\n\nTeach.', false);
    expect(r.play.text).toBe("Let's start.");
    expect(r.session).toEqual({ action: "session", turn: "t2" });
    expect(replay([tutor], r.session, 'Next part of this task: "Close" (`close`).', false).play.text).toBe("Sum it up.");
  });

  it("the wrap-up plays the timeUp turn; a part or wrap-up not recorded plays the fallback and stays put", () => {
    expect(replay([tutor], at, "Time is almost up: finish the current point briefly, in en.", false).play.text).toBe("Last point, quickly.");
    const none = replay([tutor], at, 'Next part of this task: "Extra" (`extra`).', false);
    expect(none.play.text).toBe(DEFAULT_FALLBACK);
    expect(none.session).toEqual(at);
  });

  it("a setPhase or timeUp turn is never reached by a reply", () => {
    const r = replay([tutor], { action: "session", turn: "t2" }, "Tell me more", false);
    expect(r.play.text).toBe(DEFAULT_FALLBACK);
  });
});

describe("replay: background jobs (parallel spec §8, part 3 Decision 10)", () => {
  /** A job run's first message as the shell builds it: the brief, the context, then how to end. */
  const jobPrompt = (brief: string) =>
    [brief, "## Notes\n- intro", `${MOCK_JOB_MARK} Don't ask anything.\nDo the work, then call job_result once with status ok, needs-you or failed and a one-line summary.`].join("\n\n");

  it("a job's turn calls job_result ok \"Mock run\" and ends: no text, no note, no writes, no recording", () => {
    // The brief names a recording's match: the job mark still wins, and the recording is never played.
    const r = replay(all, undefined, jobPrompt("# Topic: the manifest\n\nSync."), true, true);
    expect(MOCK_JOB_RESULT).toEqual({ status: "ok", summary: "Mock run" });
    expect(r.play.blocks).toEqual([{ tool: "job_result", input: { status: "ok", summary: "Mock run" } }]);
    expect(r.play).toMatchObject({ text: "", writes: [] });
    expect(r.play.note).toBeUndefined();
    expect(r.session).toEqual({ action: null, turn: null });
  });

  it("D0: a task's turn is unchanged; only a line that starts with the mark is a job's", () => {
    expect(isMockJobTurn(jobPrompt("Sync."))).toBe(true);
    expect(isMockJobTurn("# Topic: the manifest\n\nExplain…")).toBe(false);
    expect(isMockJobTurn(`Quote: "${MOCK_JOB_MARK}"`)).toBe(false);
    expect(replay(all, undefined, "# Topic: the manifest\n\nExplain…", true).play.text).toBe("Primero.");
    expect(replay(all, { action: "manifest", turn: "t1" }, "Contame más.", false).session.turn).toBe("t2");
  });

  it("only a job slot's turn is a job's: a task prompt with the mark at a line start plays its recording", () => {
    // The person pasted a job's first message into a task: the slot's ui server has no HH_JOB=1, so it is a task turn.
    const r = replay(all, undefined, jobPrompt("# Topic: the manifest\n\nSync."), true, false);
    expect(r.play.text).toBe("Primero.");
    expect(r.play.blocks).not.toContainEqual(expect.objectContaining({ tool: "job_result" }));
    expect(r.session.action).toBe("manifest");
    // A job slot whose prompt lacks the mark is not treated as a job's canned turn either.
    expect(replay(all, undefined, "# Topic: the manifest\n\nExplain…", true, true).play.text).toBe("Primero.");
  });
});
