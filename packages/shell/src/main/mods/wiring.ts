import type { TurnEndInfo } from "@humanharness/mod-sdk";
import type { TurnEnd } from "../task-manager";

/** D0: the host exists only if some mod could run. Settings › Mods still shows (empty) without one. */
export const needsHost = (o: { declared: Record<string, unknown> | undefined; local: string[]; coreIds: string[] }) =>
  Object.keys(o.declared ?? {}).length > 0 || o.local.length > 0 || o.coreIds.length > 0;

/** A task-manager turn end as a mod's `turnEnd` payload: the same, without the kind. */
export function toTurnEnd(e: TurnEnd): TurnEndInfo {
  const { kind: _kind, ...rest } = e;
  return rest;
}
