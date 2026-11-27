import type { CoreSender } from "@humanharness/mod-sdk/core";
import type { InvokeChannel } from "@humanharness/protocol/channels";
import type { ModHost } from "./host";

/**
 * The app channels a core mod answers (`ctx.handle`): the reader's five and the nine of reviews, the documents mod's.
 * Sidekick's 26 left for the mod's own channels in 1b, the context panel's seven in context-cleanup, search's two in
 * search-cleanup.
 */
export const MOD_APP_CHANNELS = [
  "hh:readDocument",
  "hh:readImage",
  "hh:documentsExist",
  "hh:watchDocument",
  "hh:unwatchDocument",
  "hh:reviewView",
  "hh:reviewSummaries",
  "hh:reviewAnswer",
  "hh:reviewComment",
  "hh:reviewEditDraft",
  "hh:reviewReopen",
  "hh:reviewSend",
  "hh:reviewApprove",
  "hh:reviewApprovedText",
] as const satisfies readonly InvokeChannel[];

const notReady = () => ({ ok: false, reason: "not-ready" });

/** What each call answers while the mod that handles it is off: what the window already handles. */
const OFF: Record<(typeof MOD_APP_CHANNELS)[number], (args: unknown[]) => unknown> = {
  "hh:readDocument": () => ({ ok: false, reason: "not-ready" }),
  "hh:readImage": () => null,
  // One answer per path, as the window expects.
  "hh:documentsExist": ([paths]) => (Array.isArray(paths) ? paths.map(() => false) : []),
  "hh:watchDocument": () => null,
  "hh:unwatchDocument": () => undefined,
  "hh:reviewView": notReady,
  // One entry per path, as the window expects.
  "hh:reviewSummaries": ([paths]) => (Array.isArray(paths) ? paths.map(() => null) : []),
  "hh:reviewAnswer": notReady,
  "hh:reviewComment": notReady,
  "hh:reviewEditDraft": notReady,
  "hh:reviewReopen": notReady,
  "hh:reviewSend": notReady,
  "hh:reviewApprove": notReady,
  "hh:reviewApprovedText": notReady,
};

/**
 * Registers each of `MOD_APP_CHANNELS` to the mod host: the call reaches the core mod that handles it, with the window
 * that asked and its arguments. With no host, or no mod on that handles it (the mod is off), the call is answered as
 * data (`OFF`), not thrown.
 */
export function registerModAppChannels(
  handleFrom: (channel: InvokeChannel, fn: (sender: CoreSender, ...args: unknown[]) => unknown) => void,
  host: () => ModHost | null,
): void {
  for (const channel of MOD_APP_CHANNELS) {
    handleFrom(channel, (sender, ...args) => {
      const h = host();
      return h?.handles(channel) ? h.channel(channel, args, sender) : OFF[channel](args);
    });
  }
}
