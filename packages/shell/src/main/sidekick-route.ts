import { purposeMoments, speaksAt, type SidekickDef, type SidekickMoment } from "@humanharness/harness-sdk";

/**
 * Sidekicks on in `scope` that have a purpose for `moment` (spec §2a.3), in the person's order. Muted kinds don't
 * remove a candidate: they only filter its cards. `scopeFor` is the store's (scope record ids may be hashed); a failed
 * read counts as on, like a scope without a record.
 */
export async function candidates(
  all: readonly SidekickDef[],
  moment: SidekickMoment,
  scope: string,
  scopeFor: (scope: string, sidekick: string) => Promise<{ on: boolean }>,
): Promise<SidekickDef[]> {
  const out: SidekickDef[] = [];
  for (const s of [...all].sort((a, b) => a.order - b.order)) {
    if (!speaksAt(s, moment)) continue;
    const { on } = await scopeFor(scope, s.id).catch(() => ({ on: true }));
    if (on) out.push(s);
  }
  return out;
}

/** The texts of `s`'s custom purposes for `moment`; empty when a core purpose of `s` speaks there too. */
function customTexts(s: SidekickDef, moment: SidekickMoment): string[] {
  const at = s.purposes.filter((p) => purposeMoments(p).includes(moment));
  return at.every((p) => p.id === "custom") ? at.map((p) => (p.id === "custom" ? p.text : "")) : [];
}

/**
 * One speaker per moment (D11). A local-check flag goes to a `prompt-coach` candidate and a free heads-up to a `focus`
 * one, whatever the order (`prefer`: the first such candidate in the person's order). Then free routing: when every
 * candidate speaks at this moment only through custom purposes, one light turn (`route`, given their texts) picks;
 * otherwise (core purposes route by their rule, which on a tie is the person's order), and on any failure or unknown
 * answer, the first in the person's order. `list` comes sorted, as `candidates` returns it, and is not empty.
 */
export async function pickSpeaker(
  list: readonly SidekickDef[],
  moment: SidekickMoment,
  route: (choices: { id: string; text: string }[]) => Promise<string>,
  prefer?: "prompt-coach" | "focus",
): Promise<SidekickDef> {
  const preferred = prefer && list.find((s) => s.purposes.some((p) => p.id === prefer));
  if (preferred) return preferred;
  if (list.length <= 1) return list[0]!;
  const choices = list.map((s) => ({ id: s.id, text: customTexts(s, moment).join(" ") }));
  if (choices.every((c) => c.text)) {
    let id = "";
    try {
      id = (await route(choices)).trim();
    } catch {
      // The person's order below.
    }
    const hit = list.find((s) => s.id === id);
    if (hit) return hit;
  }
  return list[0]!;
}
