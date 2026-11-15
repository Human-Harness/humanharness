import { BrowserWindow, type WebContents, dialog } from "electron";
import { type EngineDef, getEngine } from "@humanharness/engines";
import { DEFAULT_LANGUAGE } from "@humanharness/harness-sdk";
import { createI18n } from "@humanharness/i18n";
import { type AppConfig, isConfigured } from "@humanharness/protocol";
import { profileDir } from "@humanharness/workspace";
import { detectEngine } from "./engine-status";
import { archiveChatsOnEngineChange, startNewChatIfEngineChanged } from "./engine-switch";
import { type GoBackAsk, askNatively, goBackText } from "./go-back";
import type { LifecycleDeps } from "./index";

/** How long an engine check is reused: the language state is read on every turn's state update, and a run updates it every turn. */
const ENGINE_CHECK_MS = 30_000;

/** What asks before a go-back, picks the translation's engine and saves a config that changes the engine. */
export interface EngineChange {
  confirmGoBack(sender: WebContents, ask: GoBackAsk): Promise<boolean>;
  translateEngine(fresh?: boolean): Promise<EngineDef | null>;
  saveConfigPatch(patch: AppConfig, before: AppConfig): Promise<void>;
}

/** Built once in the main entry; `d` reads its state (the start-up blocks' getters) when a call needs it. */
export function createEngineChange(d: () => LifecycleDeps): EngineChange {
  let engineCheck: { id: string; at: number; ready: Promise<boolean> } | null = null;

  /**
   * Asks before a go-back, with a native dialog on the window that asked (go-back.ts). The words are the core's, in the
   * person's language: the cached translation when there is one, else English. Any failure to ask is a no.
   */
  async function confirmGoBack(sender: WebContents, ask: GoBackAsk): Promise<boolean> {
    try {
      const language = (await d().config.load()).language ?? DEFAULT_LANGUAGE;
      const translation = d().translation;
      const generated = translation ? await translation.strings(language, {}).catch(() => ({})) : {};
      const i18n = await createI18n(language, {}, generated);
      const t = (key: string, values?: Record<string, unknown>) => String(i18n.t(key, values ?? {}));
      const text = goBackText(t, ask, d().harness.actions, i18n.resolvedLanguage ?? "en");
      return await askNatively(dialog, BrowserWindow.fromWebContents(sender), text);
    } catch (err) {
      console.error("Could not ask before going back", err);
      return false;
    }
  }

  /**
   * Whether the engine could run a translation now: installed, not outdated, not signed out (the runtime's own start
   * checks). A fake engine (tests, mock mode) always can. Reused for ENGINE_CHECK_MS unless `fresh`.
   */
  function engineReady(engine: EngineDef, fresh = false): Promise<boolean> {
    if (d().hooks.engines?.[engine.id]) return Promise.resolve(true);
    const now = Date.now();
    if (!fresh && engineCheck?.id === engine.id && now - engineCheck.at < ENGINE_CHECK_MS) return engineCheck.ready;
    const ready = detectEngine(engine, d().commandDeps, d().shared).then(
      (s) => s.installed && !s.outdated && s.loggedIn !== false,
      () => false,
    );
    engineCheck = { id: engine.id, at: now, ready };
    return ready;
  }

  /**
   * The set-up engine when a run could use it (the app is set up, its notice accepted), else null. It reads the
   * saved config, not validConfig(): with profiles and no active profile there is no base, but the engine is ready.
   */
  async function translateEngine(fresh = false): Promise<EngineDef | null> {
    const c = await d().config.load();
    if (!isConfigured(c) || !(await d().hasNotice(c.engineId))) return null;
    const engine = getEngine(c.engineId);
    return (await engineReady(engine, fresh)) ? engine : null;
  }

  /** Saves a config patch; an engine change ends the task, drops the runtime and archives the chat (see EngineGuards). */
  async function saveConfigPatch(patch: AppConfig, before: AppConfig): Promise<void> {
    if (patch.engineId && before.engineId && patch.engineId !== before.engineId) {
      const engineId = patch.engineId;
      // A translation run belongs to the old engine: it stops, what it saved stays (plan Decision 12).
      await d().translation?.stop().catch((err: unknown) => console.error("Could not stop the translation", err));
      await d().guards.switchEngine(
        {
          // A profile switch counts too: once its task has closed nothing runs, yet its runtime and profile are pending.
          isBusy: d().hold.engineBusy,
          idle: async () => {
            await d().tasks.idle();
            await d().flushTurns();
          },
          save: () => d().config.save(patch).then(() => undefined),
          dropRuntime: d().dropRuntime,
          archiveChat: async () => {
            const c = await d().validConfig();
            if (!c || c.engineId !== engineId) return null;
            // D0: one folder, as before. With profiles, every profile's chat (spec §5).
            const profilesCtl = d().profilesCtl;
            if (!profilesCtl) return startNewChatIfEngineChanged(d().baseOf(c), engineId);
            // With no active profile baseOf throws and nothing is archived here: each profile's chat is archived lazily
            // when it is next loaded (archiveStaleChat in hh:loadChat).
            const active = d().baseOf(c);
            // An unreadable registry still starts the active chat over; the others are archived lazily the same way.
            const list = await profilesCtl.state().then((s) => s.list, () => []);
            const others = list.map((p) => profileDir(c.folder, p.id)).filter((f) => f !== active);
            return archiveChatsOnEngineChange(active, others, engineId);
          },
        },
        // The new engine is saved: the window gets the new state; the next chat load archives the old chat.
        (err) => console.error("Could not finish changing the engine", err),
      );
    } else {
      await d().config.save(patch);
    }
  }

  return { confirmGoBack, translateEngine, saveConfigPatch };
}
