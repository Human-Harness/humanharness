import type { InvokeChannel } from "@humanharness/protocol/channels";
import type { ModHost } from "./host";

/**
 * The app channels a core mod answers: none since minimal-core 1b, when Sidekick's 26 became the mod's own
 * (`mods.sidekick.<name>`, through `hh:modCall`). app-ipc.ts still calls this at startup; both go together.
 */
export function registerModAppChannels(_handle: (channel: InvokeChannel, fn: (...args: unknown[]) => unknown) => void, _host: () => ModHost | null): void {}
