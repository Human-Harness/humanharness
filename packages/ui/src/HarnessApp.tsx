import { type ComponentType, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { I18nextProvider } from "react-i18next";
import type { i18n } from "i18next";
import { type Locales, createI18n } from "@humanharness/i18n";
import { ProfileSwitcher } from "./ProfileSwitcher";
import { ScopePicker } from "./ScopePicker";
import { ChatView, type SendFn } from "./ChatView";
import { TopBar } from "./chrome";
import { type AppState, type EngineStatus, type HarnessClient, type LimitWindow, type SetupStepProps, type SetupStepsState, engineProblem, isConfigured } from "./client";
import { useFolderMove } from "./BackupNotice";
import { BackendCard } from "./hatches/BackendCard";
import { Home } from "./Home";
import { Inbox } from "./parallel/Inbox";
import { TaskStrip } from "./parallel/TaskStrip";
import { useFocusEpoch, useTasks } from "./parallel/useTasks";
import { shownLanguage, systemLanguage } from "./language";
import { type LanguageControl, useLanguage } from "./language-control";
import type { MaterialPanelProps } from "./MaterialPanel";
import type { BlockProps } from "./Message";
import { type SettingsTab, SettingsSheet } from "./SettingsSheet";
import { SetupFlow } from "./SetupFlow";
import type { SearchIntent } from "./search/intent";
import { SearchHost } from "./search/SearchHost";
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
  /** A harness's own material panel (material spec §11); absent: the core's. Only drawn when the harness takes material. */
  materialPanel?: ComponentType<MaterialPanelProps>;
}

export function HarnessApp({ client, blocks = {}, stateBlocks = [], renderSide, locales, startView, setupSteps = {}, materialPanel }: HarnessAppProps) {
  const [state, setState] = useState<AppState | null>(null);
  const [i18n, setI18n] = useState<i18n | null>(null);
  const [failed, setFailed] = useState(false);
  const [screen, setScreen] = useState<"home" | "setup" | "work">("home");
  const [settings, setSettings] = useState<SettingsTab | null>(null);
  /** Search opened Settings at a field (§6); `n` makes each search a new focus. */
  const [settingsFocus, setSettingsFocus] = useState<{ id: string; n: number } | null>(null);
  /** Background check of the configured engine (spec §9 "every start"). */
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const [limits, setLimits] = useState<LimitWindow[] | null>(null);
  /** The harness's setup steps' state (setup-steps spec §4): Home waits for it before it offers Start. */
  const [steps, setSteps] = useState<SetupStepsState | null>(null);
  /**
   * Where the setup screen opens: a harness step (Home's missing one), alone with `only` (Settings' "Do it again"),
   * the Settings tab its end reopens (`back`), and the profile step for "Add <label>" (`newProfile`).
   */
  const [setupAt, setSetupAt] = useState<{ step?: string; only?: boolean; back?: SettingsTab; newProfile?: boolean }>({});
  const openSetup = (at: { step?: string; only?: boolean; back?: SettingsTab; newProfile?: boolean }) => {
    setSetupAt(at);
    setScreen("setup");
  };
  /** Harnesses with jobs: the chat's start of a declared action, for Settings › Jobs' Start (null off the work screen). */
  const chatStart = useRef<((action: string, scope: string | null) => boolean) | null>(null);
  /** The chat's handler for a search result or question (search spec §3); null while the chat isn't on screen. */
  const searchRef = useRef<((intent: SearchIntent) => boolean) | null>(null);
  /** A result picked away from the work screen: it runs once the chat is there. */
  const pendingIntent = useRef<SearchIntent | null>(null);
  useEffect(() => {
    if (screen !== "work" || !pendingIntent.current || !searchRef.current) return;
    const intent = pendingIntent.current;
    pendingIntent.current = null;
    searchRef.current(intent);
  });
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
  const profile = state?.config.profile;
  // Another folder (or profile) has its own setup.json: until it is read, Start waits rather than show the old one's state.
  useEffect(() => {
    setSteps(null);
  }, [folder, profile]);
  // Read again when the folder or the profile changes (its own setup.json) and on every screen change (the setup screen moved it on).
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
  }, [client, hasSetupSteps, folder, profile, screen]);
  /** A harness that declares `parallel`: its open tasks (spec §9.1). Plain mode asks nothing (D0). */
  const tasksState = useTasks(client, Boolean(state?.parallel));
  /** Board mode: the chat remounts on each change of the task shown (`epoch`); only a message put back outlives it. */
  const { epoch, toStart } = useFocusEpoch(tasksState);
  const draftKeep = useRef<string | null>(null);
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
        const lang = s.config.language ?? systemLanguage();
        // Plan 5b: the saved language's cached translation; English and its variants ask for nothing (D0).
        const english = lang === "en" || lang.startsWith("en-");
        const strings = !english && client.language ? await client.language.strings(lang, localesRef.current?.en ?? {}).catch(() => ({})) : {};
        const instance = await createI18n(lang, localesRef.current, strings);
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
    // The language the text is shown in: the saved one once its translation is loaded.
    const apply = () => {
      document.documentElement.lang = shownLanguage(i18n);
    };
    apply();
    i18n.on("languageChanged", apply);
    return () => {
      i18n.off("languageChanged", apply);
    };
  }, [i18n]);

  /** Language on demand (plan 5b): asks main for nothing until the Language row, the picker or the offer card loads it. */
  // Main also saves `languageOffered` when a non-English language is chosen or its run starts; the window's copy follows,
  // so Home's offer card stays answered (and stops asking for the state) without a reload.
  const english = (tag: string) => tag === "en" || tag.startsWith("en-");
  const control = useLanguage(client, i18n, locales?.en ?? {}, (tag) =>
    setState((s) => s && { ...s, config: { ...s.config, language: tag, ...(english(tag) ? {} : { languageOffered: true }) } }),
  );
  const language: LanguageControl = {
    ...control,
    translate: async (tag) => {
      const ok = await control.translate(tag);
      if (ok) setState((s) => s && { ...s, config: { ...s.config, languageOffered: true } });
      return ok;
    },
  };

  // ⌘+, ⌘− and ⌘0 change the text size in the main process: Settings shows the new one.
  useEffect(() => client.onTextSize((textSize) => setState((s) => s && { ...s, config: { ...s.config, textSize } })), [client]);
  // Tools that went off while the app runs (tools spec Decision 7): only a harness with tools listens (D0).
  const hasTools = state?.tools !== undefined;
  useEffect(() => (hasTools ? client.tools.onChange((tools) => setState((s) => s && { ...s, tools })) : undefined), [client, hasTools]);

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
    setSettingsFocus(null);
    checkEngine();
  };
  // Leaving the setup flow either way: whatever it saved gets checked again.
  const leaveSetup = (next: "home" | "work") => {
    setScreen(next);
    checkEngine();
  };
  /** "Add <label>": the setup screen at its profile step. */
  const addProfile = () => openSetup({ newProfile: true });
  /** A switch from the work screen goes Home (spec §5): the new profile's required setup steps are checked there. */
  const switched = (next: AppState) => {
    setState(next);
    setScreen("home");
  };
  /** "New task" in the strip: main shows the start view, then the chat does. */
  const newTask = () => {
    client.tasks.focus(null).then(toStart, () => undefined);
  };
  /** A result or a ⌘Enter question: Settings closes, the work screen shows, the chat does the rest. */
  const searchIntent = (intent: SearchIntent) => {
    // A setting opens Settings at its field (§6), over whatever is on screen; Settings may already be open.
    if (intent.kind === "setting") {
      setSettingsFocus((f) => ({ id: intent.field, n: (f?.n ?? 0) + 1 }));
      setSettings(intent.tab);
      return;
    }
    setSettings(null);
    setSettingsFocus(null);
    if (screen === "work" && searchRef.current) {
      searchRef.current(intent);
      return;
    }
    if (!configured) return;
    pendingIntent.current = intent;
    setScreen("work");
  };
  // D0: without `parallel` the key is today's, and nothing else is kept.
  const chatKey = `${engineId}:${profile ?? ""}:${openScope ?? ""}`;

  return (
    <I18nextProvider i18n={i18n}>
      {/* Under the open Settings sheet, the whole screen (top bar included) can't be reached. */}
      <div className="hh-screen" inert={settings !== null}>
        {screen === "work" && configured ? (
          <ChatView
            key={state.parallel ? `${chatKey}:${epoch}` : chatKey}
            client={client}
            state={state}
            components={blocks}
            stateBlocks={stateBlocks}
            renderSide={renderSide}
            startView={startView}
            openScope={openScope}
            materialPanel={materialPanel}
            profileBar={
              state.profiles ? (disabled) => <ProfileSwitcher client={client} state={state} onSwitched={switched} onAdd={addProfile} disabled={disabled} /> : undefined
            }
            inboxBar={
              state.parallel?.inbox
                ? (refill, start) => <Inbox client={client} state={state} tasks={tasksState} onRefill={refill} onStartView={toStart} onStartAction={start} />
                : undefined
            }
            {...(state.jobs ? { startRef: chatStart } : {})}
            searchRef={searchRef}
            {...(state.parallel ? { taskStrip: <TaskStrip state={state} tasks={tasksState} onNewTask={newTask} />, draftKeep } : {})}
            scopeBar={state.scopes ? (disabled) => <ScopePicker client={client} state={state} open={openScope} disabled={disabled} /> : undefined}
            engineProblem={status ? engineProblem(status) : null}
            onHome={() => setScreen("home")}
            onSettings={() => setSettings("general")}
            onFixEngine={() => setSettings("engine")}
            onSidekickSettings={() => setSettings("sidekick")}
            onTurnOk={checkEngine}
          />
        ) : screen === "setup" ? (
          <SetupFlow
            key={`${setupAt.step ?? ""}:${setupAt.only ? "only" : ""}:${setupAt.newProfile ? "new" : ""}`}
            client={client}
            state={state}
            onChange={setState}
            onCancel={() => {
              leaveSetup("home");
              // Opened from Settings: its end (or Cancel) goes back to the tab it came from.
              if (setupAt.back) setSettings(setupAt.back);
            }}
            onStart={() => leaveSetup("work")}
            {...(setupAt.step ? { startAt: setupAt.step } : {})}
            only={setupAt.only === true}
            newProfile={setupAt.newProfile === true}
            components={setupSteps}
            blocks={blocks}
            stateBlocks={stateBlocks}
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
            onAddProfile={addProfile}
            language={client.language ? language : undefined}
          />
        )}
        {/* Hatches §4.3: only a harness with a backend gets the card and its listener (D0). */}
        {state.hatches?.backend && <BackendCard client={client} />}
      </div>
      {settings && (
        <SettingsSheet
          client={client}
          state={state}
          tab={settings}
          onTab={(tab) => {
            setSettingsFocus(null);
            setSettings(tab);
          }}
          onChange={setState}
          onClose={closeSettings}
          onSetup={(step?: string) => {
            const back = settings;
            setSettings(null);
            setSettingsFocus(null);
            openSetup(step ? { step, only: true, back } : {});
          }}
          move={move}
          {...(state.jobs && screen === "work"
            ? {
                onStartAction: (action: string, scope: string | null) => {
                  const started = chatStart.current?.(action, scope) ?? false;
                  if (started) closeSettings();
                  return started;
                },
              }
            : {})}
          language={client.language ? language : undefined}
          {...(settingsFocus ? { focus: settingsFocus } : {})}
        />
      )}
      {/* ⌘K (search spec §5.1): outside the screen, so it works over Settings too. */}
      <SearchHost client={client} state={state} openScope={openScope} onIntent={searchIntent} />
    </I18nextProvider>
  );
}
