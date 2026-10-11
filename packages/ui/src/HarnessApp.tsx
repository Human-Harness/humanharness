import { type ComponentType, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { I18nextProvider } from "react-i18next";
import type { i18n } from "i18next";
import { type Locales, createI18n } from "@humanharness/i18n";
import { ChatView, type SendFn } from "./ChatView";
import { TopBar } from "./chrome";
import { type AppState, type EngineStatus, type HarnessClient, type LimitWindow, engineProblem, isConfigured } from "./client";
import { Home } from "./Home";
import type { BlockProps } from "./Message";
import { type SettingsTab, SettingsSheet } from "./SettingsSheet";

export interface HarnessAppProps {
  client: HarnessClient;
  blocks?: Record<string, ComponentType<BlockProps>>;
  stateBlocks?: string[];
  /** The side panel: gets the latest state blocks and `send` for buttons that start harness actions. */
  renderSide?: (blockState: Record<string, unknown>, send: SendFn) => ReactNode;
  locales?: Locales;
}

export function HarnessApp({ client, blocks = {}, stateBlocks = [], renderSide, locales }: HarnessAppProps) {
  const [state, setState] = useState<AppState | null>(null);
  const [i18n, setI18n] = useState<i18n | null>(null);
  const [failed, setFailed] = useState(false);
  const [screen, setScreen] = useState<"home" | "work">("home");
  const [settings, setSettings] = useState<SettingsTab | null>(null);
  /** Background check of the configured engine (spec §9 "every start"). */
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [limits, setLimits] = useState<LimitWindow[] | null>(null);
  /** Start was pressed before setup was complete: open the work screen as soon as it is. */
  const startWhenReady = useRef(false);
  // Read through a ref so inline `locales` objects don't re-run the load.
  const localesRef = useRef(locales);
  localesRef.current = locales;

  useEffect(() => {
    let cancelled = false;
    const systemLanguage = navigator.language.startsWith("es") ? "es" : "en";
    void (async () => {
      try {
        const s = await client.getState();
        const preferred = s.config.language ?? systemLanguage;
        const language = s.harness.languages.includes(preferred) ? preferred : s.harness.languages[0];
        const instance = await createI18n(language, localesRef.current);
        if (cancelled) return;
        setI18n(instance);
        setState(s);
      } catch {
        const instance = await createI18n(systemLanguage, localesRef.current);
        if (cancelled) return;
        setI18n(instance);
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    if (!i18n) return;
    const apply = (language: string) => {
      document.documentElement.lang = language;
    };
    apply(i18n.language);
    i18n.on("languageChanged", apply);
    return () => {
      i18n.off("languageChanged", apply);
    };
  }, [i18n]);

  const engineId = state?.config.engineId;
  const configured = state ? isConfigured(state.config) : false;

  const checkEngine = useCallback(() => {
    if (!engineId) return setStatus(null);
    client.engineStatus(engineId).then(setStatus, () => {});
  }, [client, engineId]);

  useEffect(() => {
    setStatus(null);
    checkEngine();
  }, [checkEngine]);

  // Usage for the engine pill, refreshed whenever Home shows again.
  useEffect(() => {
    if (!configured || screen !== "home") return;
    let cancelled = false;
    client.getUsage().then(
      (u) => {
        if (!cancelled) setLimits(u.limits);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [client, configured, engineId, screen]);

  // First launch: once Settings has finished the setup, start.
  useEffect(() => {
    if (configured && startWhenReady.current) {
      startWhenReady.current = false;
      setSettings(null);
      setScreen("work");
      checkEngine();
    }
  }, [configured, checkEngine]);

  if (failed && i18n) {
    return (
      <>
        <TopBar />
        <p className="hh-load-error" role="alert">
          {i18n.t("app.loadError")}
        </p>
      </>
    );
  }
  // Even before anything loads, the window keeps its drag strip.
  if (!state || !i18n)
    return (
      <>
        <TopBar />
        <div className="hh-loading" role="status" aria-busy="true" />
      </>
    );

  const start = () => {
    if (isConfigured(state.config)) return setScreen("work");
    startWhenReady.current = true;
    setSettings("engine");
  };
  const closeSettings = () => {
    startWhenReady.current = false;
    setSettings(null);
    checkEngine();
  };

  return (
    <I18nextProvider i18n={i18n}>
      {screen === "work" && configured ? (
        <ChatView
          key={engineId}
          client={client}
          state={state}
          components={blocks}
          stateBlocks={stateBlocks}
          renderSide={renderSide}
          engineProblem={status ? engineProblem(status) : null}
          onHome={() => setScreen("home")}
          onSettings={() => setSettings("general")}
          onFixEngine={() => setSettings("engine")}
        />
      ) : (
        <Home
          state={state}
          status={status}
          limits={limits}
          onStart={start}
          onSettings={() => setSettings("general")}
          onEngine={() => setSettings("engine")}
        />
      )}
      {settings && <SettingsSheet client={client} state={state} tab={settings} onTab={setSettings} onChange={setState} onClose={closeSettings} />}
    </I18nextProvider>
  );
}
