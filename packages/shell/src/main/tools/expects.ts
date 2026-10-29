import type { TraceEntry } from "./tool-trace";

/**
 * The expected tools this task didn't call in this part (tools spec §6.1), each once, in the order declared. A call
 * counts whatever its caller, and a failed call counts; a note (a cut, an earlier miss) isn't a call.
 */
export function expectsMisses(entries: readonly TraceEntry[], o: { task: string; phase: string; expects: readonly string[] }): string[] {
  const called = new Set(entries.filter((e) => e.task === o.task && e.phase === o.phase && e.note === undefined).map((e) => e.tool));
  return [...new Set(o.expects)].filter((t) => !called.has(t));
}
