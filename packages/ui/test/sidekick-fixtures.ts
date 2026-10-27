import type { SidekickState } from "../src/client";

/** Sidekick on, watching, with some tokens spent: the base state the Sidekick UI tests start from. */
export const SK_ON: SidekickState = {
  info: { id: "sidekick", name: "Sidekick", mark: "spark" },
  settings: { on: true, preSend: true, wait: 6, cap: 20_000, introSeen: true, afterReply: true, headsUps: true, presetsOffered: false, muted: {} },
  status: "watching",
  spent: 1200,
  cap: 20_000,
  tier: "light",
  card: null,
  week: 3400,
  past: [],
  used: { used: 0, of: 0 },
};
