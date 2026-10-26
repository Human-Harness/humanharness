import { useEffect, useState } from "react";
import type { AnswerPart } from "./client";

/**
 * How fast an answer appears: one word every `wordMs` (the engine may send it much faster; the window keeps
 * a steady, readable pace). 0 shows everything at once (unit tests set it so).
 */
export const answerPace = { wordMs: 110 };

/** Further behind than this many words (or blocks), each tick shows more than one so the answer catches up. */
const CATCH_UP = 40;

/** How much of an answer is on screen: every part before `part`, and the first `words` words of `part` when it is text. */
export interface Reveal {
  part: number;
  words: number;
}

export const NOTHING: Reveal = { part: 0, words: 0 };

/** A text run's words, each with the whitespace after it: joining a prefix gives a prefix of the text. */
export function wordsOf(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

/** Whether all of the answer is on screen. More may still come while the turn runs (`final` false). */
export function revealed(parts: AnswerPart[], r: Reveal, final: boolean): boolean {
  if (r.part >= parts.length) return true;
  if (final || r.part < parts.length - 1) return false;
  const last = parts[r.part];
  return "text" in last && r.words >= wordsOf(last.text).length;
}

/** Words and blocks not on screen yet. */
function behind(parts: AnswerPart[], r: Reveal): number {
  let n = 0;
  for (let i = r.part; i < parts.length; i++) {
    const p = parts[i];
    n += "text" in p ? wordsOf(p.text).length - (i === r.part ? r.words : 0) : 1;
  }
  return n;
}

/**
 * One tick: the next word (more when far behind), or the next block on its own. A text run is left only once
 * something follows it, or the turn is over (`final`): until then more words may arrive for it.
 */
export function step(parts: AnswerPart[], r: Reveal, final: boolean): Reveal {
  let { part, words } = r;
  let budget = Math.max(1, Math.ceil(behind(parts, r) / CATCH_UP));
  while (budget > 0 && part < parts.length) {
    const p = parts[part];
    if ("block" in p) {
      // A block takes a tick of its own, so it fades in alone.
      if (part !== r.part || words !== r.words) break;
      return { part: part + 1, words: 0 };
    }
    const total = wordsOf(p.text).length;
    const take = Math.min(budget, total - words);
    words += take;
    budget -= take;
    if (words < total) break;
    if (part === parts.length - 1 && !final) break;
    part += 1;
    words = 0;
  }
  return { part, words };
}

/**
 * Paces the answer of turn `turn` (its id, new for each turn): returns how much of `parts` to show, or null
 * once nothing is pacing (no parts, pacing off, or the turn is over and all of it is on screen).
 */
export function usePacedAnswer(turn: string, parts: AnswerPart[] | null, final: boolean): Reveal | null {
  const [progress, setProgress] = useState<{ turn: string; reveal: Reveal }>({ turn: "", reveal: NOTHING });
  const reveal = progress.turn === turn ? progress.reveal : NOTHING;
  const pacing = answerPace.wordMs > 0 && parts !== null;
  const done = !pacing || revealed(parts, reveal, final);

  useEffect(() => {
    if (done || !parts) return;
    const timer = setTimeout(() => setProgress({ turn, reveal: step(parts, reveal, final) }), answerPace.wordMs);
    return () => clearTimeout(timer);
  }, [done, parts, reveal, final, turn]);

  if (!pacing) return null;
  return done && final ? null : reveal;
}
