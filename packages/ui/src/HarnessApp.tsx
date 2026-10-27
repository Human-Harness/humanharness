import { type ComponentType, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { I18nextProvider } from "react-i18next";
import type { i18n } from "i18next";
import { type Locales, createI18n } from "@humanharness/i18n";
import { ScopePicker } from "./ScopePicker";
import { ChatView, type SendFn } from "./ChatView";
import { TopBar } from "./chrome";
import { type AppState, type EngineStatus, type HarnessClient, type LimitWindow, type SetupStepProps, type SetupStepsState, engineProblem, isConfigured } from "./client";
import { useFolderMove } from "./BackupNotice";
import { Home } from "./Home";
import { shownLanguage, systemLanguage } from "./language";
import type { BlockProps } from "./Message";
import { type SettingsTab, SettingsSheet } from "./SettingsSheet";
import { SetupFlow } from "./SetupFlow";
import type { StartViewCopy } from "./StartView";

export interface HarnessAppProps {
  client: HarnessClient;
  blocks?: Record<string, ComponentType<BlockProps>>;
  stateBlocks?: string[];
  /** The side panel: gets the latest state blocks and `send` for buttons that start harness actions. */
  renderSide?: (blockState: Record<string, unknown>, send: SendFn) => ReactNode;
  locales?: Locales;
  /** Flow mode's start view: keys of `locales` for its title, intro, frequent questions and composer hint. */
  startView?: StartViewCopy;
  /** The harness's own setup step components (`component` steps, setup-steps spec §3), by the name the manifest gives. */
  setupSteps?: Record<string, ComponentType<SetupStepProps>>;
}

export function HarnessApp({ client, blocks = {}, stateBlocks = [], renderSide, locales, startView, setupSteps = {} }: HarnessAppProps) {
  const [state, setState] = useState<AppState | null>(null);
  const [i18n, setI18n] = useState<i18n | null>(null);
  const [failed, setFailed] = useState(false);
  const [screen, setScreen] = useState<"home" | "setup" | "work">("home");
  const [settings, setSettings] = useState<SettingsTab | null>(null);
  /** Background check of the configured engine (spec §9 "every start"). */
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const [limits, setLimits] = useState<LimitWindow[] | null>(null);
  /** The harness's setup steps' state (setup-steps spec §4): Home waits for it before it offers Start. */
  const [steps, setSteps] = useState<SetupStepsState | null>(null);
  /** Where the setup screen opens: a harness step (Home's missing one), alone with `only` (Settings' "Do it again"). */
  const [setupAt, setSetupAt] = useState<{ step?: string; only?: boolean }>({});
  const openSetup = (at: { step?: string; only?: boolean }) => {
    setSetupAt(at);
    setScreen("setup");
  };
  /** Harnesses with scopes: the open scope; the work screen's chat is that scope's. */
  const [openScope, setOpenScope] = useState<string | null>(null);
  const hasScopes = Boolean(state?.scopes);
  useEffect(() => {
    if (!hasScopes) return;
    let live = true;
    // A change that has arrived is newer than the first reply, which may have been in flight before it.
    let seen = false;
    client.scopes.current().then(
      (id) => {
        if (live && !seen) setOpenScope(id);
      },
      () => undefined,
    );
    const off = client.scopes.onChange((v) => {
      seen = true;
      setOpenScope(v.open);
    });
    return () => {
      live = false;
      off();
    };
  }, [client, hasScopes]);
  const hasSetupSteps = Boolean(state?.setup);
  const folder = state?.config.folder;
  // Another folder has its own setup.json: until it is read, Start waits rather than show the old folder's state.
  useEffect(() => {
    setSteps(null);
  }, [folder]);
  // Read again when the folder changes (its own setup.json) and on every screen change (the setup screen moved it on).
  useEffect(() => {
    if (!hasSetupSteps) return;
    let live = true;
    let seen = false;
    const off = client.setupSteps.onChange((s) => {
      seen = true;
      if (live) setSteps(s);
    });
    client.setupSteps.get().then(
      (s) => {
        if (live && !seen) setSteps(s);
      },
      // Unknown: nothing blocks (a failed read must never lock the person out).
      () => {
        if (live && !seen) setSteps({ steps: {}, blocking: [] });
      },
    );
    return () => {
      live = false;
      off();
    };
  }, [client, hasSetupSteps, folder, screen]);
  /** Moving the folder: kept here so a move outlives Settings closing or a tab change. */
  const move = useFolderMove(client, setState);
  // Read through a ref so inline `locales` objects don't re-run the load.
  const localesRef = useRef(locales);
  localesRef.current = locales;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await client.getState();
        const instance = await createI18n(s.config.language ?? systemLanguage(), localesRef.current);
        if (cancelled) return;
        setI18n(instance);
        setState(s);
      } catch {
        const instance = await createI18n(systemLanguage(), localesRef.current);
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
    // The language the text is shown in: English until plan 5b translates the app.
    const apply = () => {
      document.documentElement.lang = shownLanguage(i18n);
    };
    apply();
    i18n.on("languageChanged", apply);
    return () => {
      i18n.off("languageChanged", apply);
    };
  }, [i18n]);

  // ⌘+, ⌘− and ⌘0 change the text size in the main process: Settings shows the new one.
  useEffect(() => client.onTextSize((textSize) => setState((s) => s && { ...s, config: { ...s.config, textSize } })), [client]);

  const engineId = state?.config.engineId;
  const configured = state ? isConfigured(state.config) : false;

  // A reply for the engine used before (the check was slow and the engine changed) is ignored.
  const currentEngine = useRef(engineId);
  currentEngine.current = engineId;
  const checkEngine = useCallback(() => {
    if (!engineId) return setStatus(null);
    client.engineStatus(engineId).then(
      (s) => {
        if (currentEngine.current !== engineId) return;
        setCheckFailed(false);
        setStatus(s);
      },
      () => {
        if (currentEngine.current === engineId) setCheckFailed(true);
      },
    );
  }, [client, engineId]);

  useEffect(() => {
    setStatus(null);
    setCheckFailed(false);
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

  const closeSettings = () => {
    setSettings(null);
    checkEngine();
  };
  // Leaving the setup flow either way: whatever it saved gets checked again.
  const leaveSetup = (next: "home" | "work") => {
    setScreen(next);
    checkEngine();
  };

  return (
    <I18nextProvider i18n={i18n}>
      {/* Under the open Settings sheet, the whole screen (top bar included) can't be reached. */}
      <div className="hh-screen" inert={settings !== null}>
        {screen === "work" && configured ? (
          <ChatView
            key={`${engineId}:${openScope ?? ""}`}
            client={client}
            state={state}
            components={blocks}
            stateBlocks={stateBlocks}
            renderSide={renderSide}
            startView={startView}
            openScope={openScope}
            scopeBar={state.scopes ? (disabled) => <ScopePicker client={client} state={state} open={openScope} disabled={disabled} /> : undefined}
            engineProblem={status ? engineProblem(status) : null}
            onHome={() => setScreen("home")}
            onSettings={() => setSettings("general")}
            onFixEngine={() => setSettings("engine")}
            onTurnOk={checkEngine}
          />
        ) : screen === "setup" ? (
          <SetupFlow
            key={`${setupAt.step ?? ""}:${setupAt.only ? "only" : ""}`}
            client={client}
            state={state}
            onChange={setState}
            onCancel={() => leaveSetup("home")}
            onStart={() => leaveSetup("work")}
            {...(setupAt.step ? { startAt: setupAt.step } : {})}
            only={setupAt.only === true}
            components={setupSteps}
          />
        ) : (
          <Home
            state={state}
            client={client}
            onChange={setState}
            status={status}
            checkFailed={checkFailed}
            limits={limits}
            steps={steps}
            onStart={() => setScreen("work")}
            onSetup={(step) => openSetup(step ? { step } : {})}
            onSettings={() => setSettings("general")}
            onEngine={() => setSettings("engine")}
            move={move}
          />
        )}
      </div>
      {settings && (
        <SettingsSheet
          client={client}
          state={state}
          tab={settings}
          onTab={setSettings}
          onChange={setState}
          onClose={closeSettings}
          onSetup={(step?: string) => {
            setSettings(null);
            openSetup(step ? { step, only: true } : {});
          }}
          move={move}
        />
      )}
    </I18nextProvider>
  );
}
