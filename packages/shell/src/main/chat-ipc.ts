import { type LoadedHarness, choiceOptionSchema } from "@humanharness/harness-sdk";
import type { ChatLoad, ConfiguredApp, SendOptions } from "@humanharness/protocol";
import { isScopeId } from "@humanharness/workspace";
import { ChatLog } from "./chat-log";
import { archiveStaleChat } from "./engine-switch";
import type { ModHost } from "./mods/host";
import { timeBoxOffered } from "./phase-ipc";
import type { TaskManager } from "./task-manager";

export interface ChatIpcDeps {
  harness(): LoadedHarness;
  quitting(): boolean;
  /** Why a new turn can't start now, or null. */
  turnBlocked(): string | null;
  /** The open task(s): a TaskManager, or board mode's TaskBoard. */
  tasks(): Pick<
    TaskManager,
    "chatScope" | "runningTask" | "start" | "ask" | "choose" | "finish" | "pauseTimeBox" | "resumeTimeBox" | "extendTimeBox"
  >;
  /** Board mode's host, or null. */
  host(): { loadChat(base: string): Promise<Pick<ChatLoad, "entries" | "live">> } | null;
  /** The mods' host, or null. */
  modHost(): Pick<ModHost, "beforeSend"> | null;
  guards: { takeSwitchedFrom(): string | null; turnBlocked(): string | null };
  engineBusy(): boolean;
  scopesSettled(): Promise<void>;
  scopesChanged(): Promise<void>;
  validConfig(): Promise<ConfiguredApp | null>;
  baseOf(c: { folder: string; profile?: string }): string;
  dropRuntime(): Promise<void>;
}

/** The chat: loading it, sending, a choice, and the open task's stepper and time box. */
export function chatIpc(d: ChatIpcDeps) {
  const { turnBlocked, guards, scopesSettled, scopesChanged, validConfig, baseOf, dropRuntime } = d;
  return {
    "hh:loadChat": async (): Promise<ChatLoad> => {
      // After the migration: it opens `main`, whose chat is the one to show.
      await scopesSettled();
      const c = await validConfig();
      if (!c) return { entries: [] };
      // The engine change archives the chat; the check here only catches a change made while the app was closed.
      const switchedFrom =
        guards.takeSwitchedFrom() ?? (d.engineBusy() || guards.turnBlocked() ? null : await archiveStaleChat(baseOf(c), c.engineId, dropRuntime));
      // Board mode: the focused task's own chat, and its turn still running to replay (read last).
      const host = d.host();
      if (host) return { ...(switchedFrom ? { switchedFrom } : {}), ...(await host.loadChat(baseOf(c))) };
      return { entries: await new ChatLog(baseOf(c), undefined, await d.tasks().chatScope()).load(), ...(switchedFrom ? { switchedFrom } : {}) };
    },
    "hh:send": async (message: string, options?: SendOptions) => {
      if (d.quitting()) throw new Error("The app is closing");
      const blocked = turnBlocked();
      if (blocked) throw new Error(blocked);
      if (typeof message !== "string" || !message.trim() || message.length > 20_000) throw new Error("Invalid message");
      const harness = d.harness();
      const action = typeof options?.action === "string" && Object.hasOwn(harness.actions, options.action) ? options.action : undefined;
      // The mode the person picked for a new task ("ask"); one the action doesn't list is refused before anything closes.
      const mode = action && typeof options?.mode === "string" && (harness.actions[action].modes ?? []).includes(options.mode) ? options.mode : undefined;
      if (options?.mode !== undefined && mode === undefined) throw new Error("Unknown mode");
      const scope = options?.scope;
      if (scope !== undefined && !isScopeId(scope)) throw new Error("Unknown scope");
      // The time box the person picked (task-phases spec §5): one the action doesn't offer is refused before anything closes.
      const offered = action ? harness.actions[action].timeBox?.options : undefined;
      const timeBox = options?.timeBox;
      if (timeBox !== undefined && !timeBoxOffered(timeBox, offered)) throw new Error("Unknown time box");
      // The mods' beforeSend (minimal-core spec §4.2): each may rewrite the text (the host refuses a blank or oversized
      // one) or hold it; a held send that was cancelled (its task closed, the mod turned off, quitting) doesn't go.
      const modHost = d.modHost();
      if (modHost) {
        const running = await d.tasks().runningTask().catch(() => null);
        const text = await modHost.beforeSend({ text: message, ...(action ? { action } : {}), ...(scope ? { scope } : {}), task: running });
        if (text === null) return;
        // A hold may have lasted: the app may be closing, or another turn may have started, by now.
        if (d.quitting()) throw new Error("The app is closing");
        const late = turnBlocked();
        if (late) throw new Error(late);
        message = text;
      }
      // A message with an action starts that task (the message is what the chat shows); any other follows up or asks.
      const tasks = d.tasks();
      const sent = action ? tasks.start(action, message, scope, mode, timeBox !== undefined ? { timeBox } : {}) : tasks.ask(message, undefined, scope);
      return scope === undefined ? sent : sent.finally(() => void scopesChanged());
    },
    "hh:choose": (option: unknown, task: unknown) => {
      if (d.quitting()) throw new Error("The app is closing");
      const blocked = turnBlocked();
      if (blocked) throw new Error(blocked);
      const parsed = choiceOptionSchema.safeParse(option);
      if (!parsed.success) throw new Error("Invalid choice");
      // The task the block was shown for: a block of an earlier task is refused (TaskManager.choose).
      if (typeof task !== "string" || !task || task.length > 100) throw new Error("Invalid choice");
      return d.tasks().choose(parsed.data, task);
    },
    // The stepper's Finish and the time box's controls.
    "hh:finishTask": () => {
      if (d.quitting()) throw new Error("The app is closing");
      const blocked = turnBlocked();
      if (blocked) throw new Error(blocked);
      return d.tasks().finish();
    },
    // Quitting already paused the box (TaskManager.close): nothing may run it again.
    "hh:pauseTask": () => {
      if (d.quitting()) return false;
      return d.tasks().pauseTimeBox();
    },
    "hh:resumeTask": () => {
      if (d.quitting()) return false;
      return d.tasks().resumeTimeBox();
    },
    "hh:extendTimeBox": () => {
      if (d.quitting()) return false;
      return d.tasks().extendTimeBox();
    },
  };
}
