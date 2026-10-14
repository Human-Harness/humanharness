// packages/fake-agent/test/mock-replay.test.ts
import { describe, expect, it } from "vitest";
import { recordingSchema } from "../src/mock";
import { DEFAULT_FALLBACK, promptKind, replay } from "../src/mock-replay";

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
