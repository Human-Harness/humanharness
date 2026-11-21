import type { PhaseMovedInfo, TurnEndInfo } from "@humanharness/mod-sdk";

/**
 * A turn that ended, as the controller reads it: the mod's `turnEnd` payload and the turn's kind (`run` for the
 * person's own turns; `close`, `checkpoint`, `wrap-up`… otherwise). Only a `run` turn gets an after-reply.
 */
export type TurnEnd = TurnEndInfo & { kind: string };
/** A task's phase moved: the mod's `phaseMoved` payload. */
export type PhaseMoved = PhaseMovedInfo;
