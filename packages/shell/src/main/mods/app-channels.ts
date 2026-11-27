import type { InvokeChannel } from "@humanharness/protocol/channels";
import type { ModHost } from "./host";

/**
 * The app channels a core mod answers (`ctx.handle`). Sidekick's 26 left for the mod's own channels in 1b and the
 * context panel's seven in context-cleanup: none now. Search's two come here under their existing names (search-main)
 * and leave again for mod ipc (search-cleanup).
 */
export const MOD_APP_CHANNELS = ["hh:search", "hh:searchOpen"] as const satisfies readonly InvokeChannel[];

/** What a call answers while the mod that handles it is off: a refusal the window already knows ("not-ready"). */
const OFF = { ok: false, reason: "not-ready" } as const;

/**
 * Registers each of `MOD_APP_CHANNELS` to the mod host: the call reaches the core mod that handles it, with its
 * arguments. With no host, or no mod on that handles it (the mod is off), the call is refused as data, not thrown.
 */
export function registerModAppChannels(handle: (channel: InvokeChannel, fn: (...args: unknown[]) => unknown) => void, host: () => ModHost | null): void {
  for (const channel of MOD_APP_CHANNELS) {
    handle(channel, (...args) => {
      const h = host();
      return h?.handles(channel) ? h.channel(channel, args) : OFF;
    });
  }
}
