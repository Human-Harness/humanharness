import type { InvokeChannel } from "@humanharness/protocol/channels";
import type { ModHost } from "./host";

/** An app channel a core mod answers, without its `hh:` prefix (the core mod's own names, as the protocol lists them). */
type Bare = { [K in InvokeChannel]: K extends `hh:sidekick${infer N}` ? `sidekick${N}` : never }[InvokeChannel];

/**
 * The window's calls a core mod answers (Sidekick's 26, minimal-core 1a): the app registers each name and hands the
 * call to the mod that handles it. The type keeps the list whole. Plan 1b moves the UI to the mod's own channels and
 * deletes these.
 */
const ALL: Record<Bare, true> = {
  sidekickGet: true,
  sidekickSet: true,
  sidekickReview: true,
  sidekickCancel: true,
  sidekickResolve: true,
  sidekickMute: true,
  sidekickUnmute: true,
  sidekickSaveDecision: true,
  sidekickLearned: true,
  sidekickForget: true,
  sidekickForgetAll: true,
  sidekickEditLearned: true,
  sidekickBeforeApprove: true,
  sidekickApproveCancel: true,
  sidekickAsk: true,
  sidekickPresets: true,
  sidekickAdoptPreset: true,
  sidekickPickFiles: true,
  sidekickImportDraft: true,
  sidekickCheckOriginal: true,
  sidekickSave: true,
  sidekickList: true,
  sidekickRemove: true,
  sidekickReorder: true,
  sidekickScope: true,
  sidekickSetScope: true,
};

/** The app channels a core mod answers, with their `hh:` prefix. */
export const MOD_APP_CHANNELS = Object.keys(ALL).map((n) => `hh:${n}` as InvokeChannel);

/**
 * Registers each of `MOD_APP_CHANNELS` to the mod host: the call reaches the core mod that handles it, with its
 * arguments. With no host, or no mod on that handles it (a harness without Sidekick), the call is refused.
 */
export function registerModAppChannels(handle: (channel: InvokeChannel, fn: (...args: unknown[]) => unknown) => void, host: () => ModHost | null): void {
  for (const channel of MOD_APP_CHANNELS) {
    handle(channel, (...args) => {
      const h = host();
      if (!h) throw new Error(`No mod handles ${channel}`);
      return h.channel(channel, args);
    });
  }
}
