import type { CoreSender } from "@humanharness/mod-sdk/core";
import type { InvokeChannel } from "@humanharness/protocol/channels";
import type { ModHost } from "./host";

/**
 * The app channels a core mod answers (`ctx.handle`). Sidekick's 26 left for the mod's own channels in 1b and the
 * context panel's seven in context-cleanup, search's two in search-cleanup: none now. The mechanism stays for a core mod
 * that must answer an app channel again.
 */
export const MOD_APP_CHANNELS = [] as const satisfies readonly InvokeChannel[];

/** What a call answers while the mod that handles it is off: a refusal the window already knows ("not-ready"). */
const OFF = { ok: false, reason: "not-ready" } as const;

/**
 * Registers each of `MOD_APP_CHANNELS` to the mod host: the call reaches the core mod that handles it, with the window
 * that asked and its arguments. With no host, or no mod on that handles it (the mod is off), the call is refused as
 * data, not thrown.
 */
export function registerModAppChannels(
  handleFrom: (channel: InvokeChannel, fn: (sender: CoreSender, ...args: unknown[]) => unknown) => void,
  host: () => ModHost | null,
): void {
  for (const channel of MOD_APP_CHANNELS) {
    handleFrom(channel, (sender, ...args) => {
      const h = host();
      return h?.handles(channel) ? h.channel(channel, args, sender) : OFF;
    });
  }
}
