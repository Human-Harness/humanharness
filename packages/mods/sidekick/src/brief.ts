import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { EngineDef } from "@humanharness/engines";
import type { SidekickPurposeDef } from "@humanharness/harness-sdk";

/** The core's Sidekick rules (spec §5, §11). English: Sidekick thinks in English like every core agent. */
export const SIDEKICK_RULES: readonly string[] = [
  "You review the person's prompt before it goes to the main assistant of this app. You never answer the prompt itself.",
  "Answer only with one JSON object, exactly as the turn asks. No prose before or after it, no code fences.",
  "Suggest; never act. You have no tools and you change nothing.",
  "Be brief: issues are one short sentence each.",
  "Say `send` when the prompt is clear enough; a good prompt needs no rewrite.",
  "Write the rewrite and the queued prompts in the same language as the person's prompt.",
  "Write the issues in the app's UI language that the turn names.",
  "Keep the person's intent. Add only what is missing; do not invent facts, files or sources.",
];

const ID = /^[a-z][a-z0-9-]{0,63}$/;

/** The person's multi-line text, every line quoted (`> `), so a line of it can't open a heading or a list of its own. */
const quoted = (text: string): string[] => text.trim().split(/\r?\n/).map((l) => (l.trim() ? `> ${l}` : ">"));

/** Each core purpose's tips in a sidekick's brief (spec §2a.2). */
const PURPOSE_TIPS: Record<Exclude<SidekickPurposeDef["id"], "custom">, { title: string; lines: string[] }> = {
  "prompt-coach": { title: "Prompt coach", lines: ["Before a send: one ask per prompt, scope named, done defined.", "After a reply: gaps and the next prompt."] },
  focus: { title: "Focus", lines: ["Say when the task drifts off its phase, repeats an ask, or nears its context limit."] },
  "process-guard": { title: "Process guard", lines: ["Before a phase change or an approval: what the phase promised and isn't there yet."] },
  mentor: { title: "Mentor", lines: ["After a reply: one thing worth learning from it, briefly, in the person's words."] },
  "daily-summary": { title: "Daily summary", lines: ["Once a day: what got done yesterday, what's open, what it cost."] },
};

/**
 * The Sidekick session's AGENTS.md: the core rules, then the harness tips, then what it learned. With `sidekick`
 * (part 2, one brief per sidekick): its name, its personality and only its purposes' tips; without, part 1's brief.
 */
export function sidekickBrief(o: {
  name: string;
  harness: string;
  tips?: string;
  learned?: readonly string[];
  sidekick?: { name: string; personality: string; purposes: readonly SidekickPurposeDef[] };
}): string {
  const k = o.sidekick;
  // A name is the person's text: one line, so it can't open a section of its own.
  const name = (k?.name ?? o.name).replace(/\s+/g, " ").trim();
  const lines = k
    ? [`# ${name}`, "", `You are ${name}, a sidekick inside the app "${o.harness}". You never act; you only suggest.`]
    : [`# ${name}`, "", `You are ${name}, the prompt coach inside the app "${o.harness}".`];
  if (k?.personality.trim()) lines.push("", "## Personality", "", ...quoted(k.personality));
  lines.push("", "## Rules", "", ...SIDEKICK_RULES.map((r) => `- ${r}`));
  for (const p of k?.purposes ?? []) {
    if (p.id === "custom") lines.push("", "## Your purpose", "", ...quoted(p.text));
    else lines.push("", `## ${PURPOSE_TIPS[p.id].title}`, "", ...PURPOSE_TIPS[p.id].lines.map((l) => `- ${l}`));
  }
  if (o.tips?.trim()) lines.push("", "## Harness tips", "", o.tips.trim());
  if (o.learned && o.learned.length > 0) lines.push("", "## About this person", "", ...o.learned.map((l) => `- ${l}`));
  return lines.join("\n") + "\n";
}

/**
 * The session's working folder (plan Decision 1): under the app's userData, one per base (so per profile) and
 * sidekick, never inside the base, so the task's CLAUDE.md / AGENTS.md never load into the Sidekick session.
 */
export function sidekickWorkDir(userData: string, base: string, id: string): string {
  if (!ID.test(id)) throw new Error(`Invalid sidekick id: "${id}"`);
  const key = createHash("sha256").update(path.resolve(base)).digest("hex").slice(0, 16);
  return path.join(userData, "sidekick", key, id);
}

/** Writes the brief as AGENTS.md (+ the engine's own file) when it changed, so the cached prefix survives. True when it wrote. */
export async function writeSidekickBrief(folder: string, text: string, engine: EngineDef): Promise<boolean> {
  await fs.mkdir(folder, { recursive: true });
  let wrote = false;
  const put = async (name: string, content: string) => {
    const file = path.join(folder, name);
    if ((await fs.readFile(file, "utf8").catch(() => null)) === content) return;
    const tmp = path.join(folder, `.${name}.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(tmp, content);
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
    wrote = true;
  };
  await put("AGENTS.md", text);
  const extra = engine.instructionsFile;
  if (extra) {
    if (path.basename(extra.path) !== extra.path) throw new Error(`Engine instructions file must be a plain file name, got "${extra.path}"`);
    await put(extra.path, extra.content);
  }
  return wrote;
}
