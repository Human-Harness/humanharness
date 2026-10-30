// The UI/core contract lives in @humanharness/protocol (replaceable parts §5). The views import it from here,
// together with the helpers only views use.
import type { AnswerPart, ChatEntry, EngineStatus } from "@humanharness/protocol";

export * from "@humanharness/protocol";

/** The entry's answer in order; an entry saved before `parts` existed shows its text, then its blocks. */
export function partsOf(entry: Pick<ChatEntry, "text" | "blocks" | "parts">): AnswerPart[] {
  if (entry.parts) return entry.parts;
  return [...(entry.text ? [{ text: entry.text }] : []), ...entry.blocks.map((_, block) => ({ block }))];
}

export type EngineProblem = "notice" | "not-installed" | "outdated" | "logged-out" | "untested";

/** The first thing left to do before the engine can run turns, or null when it is ready. */
export function engineProblem(s: EngineStatus): EngineProblem | null {
  if (!s.noticeAccepted) return "notice";
  if (!s.installed) return "not-installed";
  if (s.outdated) return "outdated";
  if (s.loggedIn === false) return "logged-out";
  if (!s.verified) return "untested";
  return null;
}
