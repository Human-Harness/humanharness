import type { Event } from "@humanharness/runtime";
import { forWindow } from "./turn-controller";

/** A lane's turn as focusing it replays it (`ChatLoad.live`, Decision 6). */
export interface LiveTurn {
  user: { text: string; at: string };
  events: Event[];
}

/** Text a buffered turn keeps, about: past it, the oldest events go (a long background turn never grows without end). */
const MAX_CHARS = 2_000_000;

/**
 * Each lane's events since its last user line, until its `done` (Decision 6): what focusing that lane replays. Only
 * what the window may see is kept (`forWindow`: no `edits`). At most `max` events and about `maxChars` characters per
 * lane, oldest dropped; consecutive text deltas are kept as one event, so a long answer costs one.
 */
export class LiveBuffer {
  private readonly turns = new Map<string, { user: LiveTurn["user"]; events: Event[]; sizes: number[]; chars: number }>();

  constructor(
    private readonly max = 2000,
    private readonly maxChars = MAX_CHARS,
  ) {}

  /** Lane `lane` starts a turn with the person's line: its earlier turn's events go. */
  user(lane: string, user: { text: string; at: string }): void {
    this.turns.set(lane, { user: { text: user.text, at: user.at }, events: [], sizes: [], chars: 0 });
  }

  event(lane: string, raw: Event): void {
    const t = this.turns.get(lane);
    if (!t) return;
    if (raw.type === "done") {
      this.turns.delete(lane);
      return;
    }
    const e = forWindow(raw);
    const last = t.events.length - 1;
    const prev = t.events[last];
    if (e.type === "text" && prev?.type === "text") {
      t.events[last] = { ...prev, delta: prev.delta + e.delta };
      t.sizes[last] = (t.sizes[last] ?? 0) + e.delta.length;
      t.chars += e.delta.length;
    } else {
      const size = e.type === "text" ? e.delta.length : JSON.stringify(e).length;
      t.events.push(e);
      t.sizes.push(size);
      t.chars += size;
    }
    while (t.events.length > this.max || (t.chars > this.maxChars && t.events.length > 1)) {
      t.events.shift();
      t.chars -= t.sizes.shift() ?? 0;
    }
    // One text run longer than the budget keeps its end.
    const only = t.events[0];
    if (t.chars > this.maxChars && only?.type === "text") {
      t.events[0] = { ...only, delta: only.delta.slice(-this.maxChars) };
      t.sizes[0] = this.maxChars;
      t.chars = this.maxChars;
    }
  }

  live(lane: string): LiveTurn | undefined {
    const t = this.turns.get(lane);
    return t ? { user: { ...t.user }, events: [...t.events] } : undefined;
  }

  /** The lane left the board. */
  drop(lane: string): void {
    this.turns.delete(lane);
  }
}

/**
 * Lane `lane`'s `TurnController.emit` in board mode: every event goes to the buffer; only the focused lane's reach the
 * window (Decision 6), and never with an activity's `edits` (parallel spec §5.2).
 */
export function laneEmit(
  lane: string,
  buffer: LiveBuffer,
  d: { isFocused(id: string): boolean; toWindow(e: Event): void },
): (e: Event) => void {
  return (e) => {
    buffer.event(lane, e);
    if (d.isFocused(lane)) d.toWindow(forWindow(e));
  };
}
