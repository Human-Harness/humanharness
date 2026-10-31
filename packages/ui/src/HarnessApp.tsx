import { type ComponentType, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { I18nextProvider } from "react-i18next";
import type { i18n } from "i18next";
import { type Locales, createI18n } from "@humanharness/i18n";
import { ProfileAvatar } from "./ProfileSwitcher";
import { ScopePicker } from "./ScopePicker";
import { ChatView, type SendFn, type ShellBridge } from "./ChatView";
import { Rail, TopBar } from "./chrome";
import { type AppState, type ChatSearchContext, type EngineStatus, type HarnessClient, type LimitWindow, type SetupStepProps, type SetupStepsState, engineProblem, isConfigured } from "./client";
import { useFolderMove } from "./BackupNotice";
import { BackendCard } from "./hatches/BackendCard";
import { Home } from "./Home";
import { AttentionInbox } from "./plugins/AttentionInbox";
import { useAttention } from "./plugins/usePlugins";
import { Inbox } from "./parallel/Inbox";
import { InboxBoard } from "./parallel/InboxBoard";
import { TaskStrip } from "./parallel/TaskStrip";
import { useFocusEpoch, useTasks } from "./parallel/useTasks";
import { shownLanguage, systemLanguage } from "./language";
import { type LanguageControl, useLanguage } from "./language-control";
import type { MaterialPanelProps } from "./MaterialPanel";
import type { BlockProps } from "./Message";
import { type SettingsTab, SettingsPage } from "./SettingsPage";
import { SetupFlow } from "./SetupFlow";
import { type RailEntry, railEntries } from "./shell-nav";
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

/** How long the line for an action search couldn't run stays. */
const SEARCH_NOTICE_MS = 4000;

export function HarnessApp({ client, blocks = {}, stateBlocks = [], renderSide, locales, startView, setupSteps = {}, materialPanel }: HarnessAppProps) {
  const [state, setState] = useState<AppState | null>(null);
  const [i18n, setI18n] = useState<i18n | null>(null);
  const [failed, setFailed] = useState(false);
  const [screen, setScreen] = useState<"home" | "setup" | "work">("home");
  /** On the work screen, the rail's place (UI refresh spec §4.2): the chat, or the Inbox screen (§5.4; the chat stays mounted under it). */
  const [view, setView] = useState<{ kind: "chat" } | { kind: "inbox"; column?: "jobs"; request?: number }>({ kind: "chat" });
  /** Each rail pick of Inbox or Jobs is a new number: picking Jobs again moves the focus to its column again. */
  const inboxPicks = useRef(0);
  /** The rail's Notes and Plugins ask the chat to open them: each pick is a new number the chat watches. */
  const [notesRequest, setNotesRequest] = useState(0);
  const [pluginsRequest, setPluginsRequest] = useState(0);
  /** The chat has a running plugin with a panel in its Plugins section: the rail shows Plugins (spec §4.2). */
  const [pluginPanels, setPluginPanels] = useState(false);
  /** The open task's label as the chat reports it: the breadcrumb's fallback without `parallel` (no task list). */
  const [chatTaskLabel, setChatTaskLabel] = useState<string | null>(null);
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
  /** The chat's state for the palette's actions (search spec §6); null while the chat isn't on screen. */
  const searchContextRef = useRef<(() => ChatSearchContext) | null>(null);
  /** The chat on screen, for the top bar (it lives outside the chat): the Inbox's refill and start, the bell's panels. */
  const shellRef = useRef<ShellBridge | null>(null);
  /**
   * A turn runs or a task closes in the chat: the profile switcher waits. Only the avatar follows it (the app doesn't
   * redraw on each turn: the search palette's rows stay the ones the person saw).
   */
  const chatBlocked = useRef<Blocked>({ now: false, listener: null });
  /** An action picked from search that couldn't run (it no longer applied, or main refused it): a short line says so. */
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!searchNotice) return;
    const timer = setTimeout(() => setSearchNotice(null), SEARCH_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [searchNotice]);
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
  /** Main moved the focus to another task (a notification click): that task's chat shows, even over the Inbox screen or Settings. */
  const shownEpoch = useRef(epoch);
  useEffect(() => {
    if (shownEpoch.current === epoch) return;
    shownEpoch.current = epoch;
    setView((v) => (v.kind === "inbox" ? { kind: "chat" } : v));
    setSettings(null);
    setSettingsFocus(null);
  }, [epoch]);
  /** Leaving the Inbox screen for the chat: a focus lost with the board goes to the rail's Tasks, not the page. */
  const wasInbox = useRef(false);
  useEffect(() => {
    const was = wasInbox.current;
    wasInbox.current = view.kind === "inbox";
    if (!was || view.kind === "inbox") return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    document.querySelector<HTMLElement>('.hh-rail [aria-current="page"]')?.focus();
  }, [view.kind]);
  /** The plugins' attention inbox, the top bar's bell (plugins spec §6): only with `state.plugins`, on the work screen (D0). */
  const attention = useAttention(client, state?.plugins !== undefined && screen === "work");
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
  /** A task tab: main moves the focus, and the chat follows main's tasks change (a refusal: the task has just ended). */
  const focusTask = (id: string) => {
    client.tasks.focus(id).catch(() => undefined);
  };
  /** A result or a ⌘Enter question: Settings closes, the work screen shows, the chat does the rest. */
  const searchIntent = (intent: SearchIntent) => {
    setSearchNotice(null);
    // A setting opens Settings at its field (§6), over whatever is on screen; Settings may already be open.
    if (intent.kind === "setting") {
      setSettingsFocus((f) => ({ id: intent.field, n: (f?.n ?? 0) + 1 }));
      setSettings(intent.tab);
      return;
    }
    // Settings' tabs and scopes are the app's, not the chat's: they run on any screen.
    if (intent.kind === "command" && intent.command === "open-settings" && intent.arg) {
      setSettingsFocus(null);
      setSettings(intent.arg as SettingsTab);
      return;
    }
    if (intent.kind === "command" && intent.command === "switch-scope" && intent.arg) {
      setSettings(null);
      setSettingsFocus(null);
      // The row was read before a turn started: the picker's own rule (no switch while a turn runs) still holds.
      if (screen === "work" && searchContextRef.current?.().turnRunning) {
        setSearchNotice(i18n.t("search.notNow"));
        return;
      }
      // Main may still refuse it (a turn held, a restore): said as the scope picker says it.
      client.scopes.open(intent.arg).catch(() => setSearchNotice(i18n.t("scopes.failed")));
      return;
    }
    setSettings(null);
    setSettingsFocus(null);
    if (screen === "work" && searchRef.current) {
      setView({ kind: "chat" });
      // An action that no longer applies says so; a result that opens nothing stays quiet (§3).
      if (!searchRef.current(intent) && intent.kind === "command") setSearchNotice(i18n.t("search.notNow"));
      return;
    }
    if (!configured) return;
    // Off the work screen the rail's place may still be the Inbox: the task the intent opens must show.
    setView({ kind: "chat" });
    pendingIntent.current = intent;
    setScreen("work");
  };
  // D0: without `parallel` the key is today's, and nothing else is kept.
  const chatKey = `${engineId}:${profile ?? ""}:${openScope ?? ""}`;
  /**
   * The rail (spec §4.2): an entry only for a feature the harness has (D0). Notes come from declared actions' topics.
   * Inbox and Jobs open the Inbox screen (§5.4): a harness whose manifest turns the core inbox off (`inbox: false`) has
   * neither, as it has no top-bar pill.
   */
  const entries = railEntries({
    parallel: Boolean(state.parallel?.inbox),
    jobs: Boolean(state.jobs?.jobs.length),
    notes: Object.keys(state.actions).length > 0,
    pluginPanels,
  });
  /** The breadcrumb's screen (spec §4.1): the focused task (the chat's open one without parallel), else the start view's title, else Tasks. */
  const focusedTask = tasksState?.tasks.find((s) => s.focused);
  const screenTitle = focusedTask?.label ?? (state.parallel ? null : chatTaskLabel) ?? (startView?.title ? i18n.t(startView.title, { ns: "harness" }) : i18n.t("rail.tasks"));
  const railCurrent: RailEntry = view.kind === "inbox" ? (view.column === "jobs" ? "jobs" : "inbox") : "tasks";
  const pick = (e: RailEntry) => {
    if (e === "home") return setScreen("home");
    if (e === "settings") return setSettings("general");
    if (e === "inbox" || e === "jobs") {
      const request = ++inboxPicks.current;
      return setView(e === "jobs" ? { kind: "inbox", column: "jobs", request } : { kind: "inbox", request });
    }
    // Notes, Plugins and Tasks are the chat's: the Inbox screen gives way to it.
    setView({ kind: "chat" });
    if (e === "notes") return setNotesRequest((n) => n + 1);
    if (e === "plugins") return setPluginsRequest((n) => n + 1);
  };

  return (
    <I18nextProvider i18n={i18n}>
      {/* Settings is a page in place of the screen (UI refresh spec §5.5): the screen stays mounted (the chat's draft,
          panels and start path), hidden and inert, top bar included. */}
      <div className="hh-screen" hidden={settings !== null} inert={settings !== null}>
        {screen === "work" && configured ? (
          <div className="hh-shell">
            <TopBar
              crumbs={[{ label: state.harness.name, onClick: () => setScreen("home") }, { label: view.kind === "inbox" ? i18n.t("inbox.title") : screenTitle }]}
              {...(state.harness.logo ? { logo: state.harness.logo } : {})}
              mock={state.mock}
              trailing={
                <>
                  {state.parallel?.inbox && view.kind !== "inbox" && (
                    <Inbox client={client} state={state} tasks={tasksState} onOpen={() => setView({ kind: "inbox" })} />
                  )}
                  {attention?.show && (
                    <AttentionInbox
                      client={client}
                      view={attention}
                      onOpenPanel={(plugin, panel, focus) => {
                        // The panel is the chat's: the Inbox screen gives way to it.
                        setView({ kind: "chat" });
                        shellRef.current?.openPanel(plugin, panel, focus);
                      }}
                      onPrepared={() => setView({ kind: "chat" })}
                    />
                  )}
                  {state.profiles && <TopBarAvatar client={client} state={state} onSwitched={switched} onAdd={addProfile} blocked={chatBlocked.current} />}
                </>
              }
            />
            <Rail entries={entries} current={railCurrent} onPick={pick} />
            <div className="hh-shell-main">
              {view.kind === "inbox" && (
                <InboxBoard
                  client={client}
                  state={state}
                  tasks={tasksState}
                  {...(view.column ? { column: view.column } : {})}
                  {...(view.request !== undefined ? { request: view.request } : {})}
                  {...(state.parallel
                    ? {
                        onNewTask: () => {
                          client.tasks.focus(null).then(() => {
                            toStart();
                            setView({ kind: "chat" });
                          }, () => undefined);
                        },
                      }
                    : {})}
                  onOpened={() => setView({ kind: "chat" })}
                  onClose={() => setView({ kind: "chat" })}
                  onStartAction={(action, scope) => shellRef.current?.start(action, scope) ?? false}
                  onRefill={(text) => {
                    shellRef.current?.refill(text);
                    // The text is back in the box: the chat shows it.
                    setView({ kind: "chat" });
                  }}
                  {...(state.jobs ? { onJobSettings: () => setSettings("jobs") } : {})}
                />
              )}
              {/* Under the Inbox screen the chat stays mounted (its draft, panels and start path): only hidden. */}
              <div className="hh-shell-chat" hidden={view.kind === "inbox"}>
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
                  shellRef={shellRef}
                  onBlocked={(b) => {
                    chatBlocked.current.now = b;
                    chatBlocked.current.listener?.(b);
                  }}
                  {...(state.jobs ? { startRef: chatStart } : {})}
                  searchRef={searchRef}
                  searchContextRef={searchContextRef}
                  {...(state.parallel ? { taskStrip: <TaskStrip state={state} tasks={tasksState} onFocus={focusTask} />, onNewTask: newTask, draftKeep } : {})}
                  title={screenTitle}
                  scopeBar={state.scopes ? (disabled) => <ScopePicker client={client} state={state} open={openScope} disabled={disabled} /> : undefined}
                  engineProblem={status ? engineProblem(status) : null}
                  notesRequest={notesRequest}
                  pluginsRequest={pluginsRequest}
                  onPluginPanels={setPluginPanels}
                  onTaskLabel={setChatTaskLabel}
                  onFixEngine={() => setSettings("engine")}
                  onSidekickSettings={() => setSettings("sidekick")}
                  onTurnOk={checkEngine}
                />
              </div>
            </div>
          </div>
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
            onOpen={searchIntent}
          />
        )}
        {/* Hatches §4.3: only a harness with a backend gets the card and its listener (D0). */}
        {state.hatches?.backend && <BackendCard client={client} />}
      </div>
      {settings && (
        <SettingsPage
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
                  if (started) {
                    setView({ kind: "chat" });
                    closeSettings();
                  }
                  return started;
                },
              }
            : {})}
          language={client.language ? language : undefined}
          {...(settingsFocus ? { focus: settingsFocus } : {})}
        />
      )}
      {searchNotice && (
        <p className="hh-search-notice" role="alert">
          {searchNotice}
        </p>
      )}
      {/* ⌘K (search spec §5.1): outside the screen, so it works over Settings too. */}
      <SearchHost client={client} state={state} openScope={openScope} onIntent={searchIntent} chatContext={() => (screen === "work" ? (searchContextRef.current?.() ?? null) : null)} />
    </I18nextProvider>
  );
}

/** Whether the chat on screen is busy, and who follows it. */
interface Blocked {
  now: boolean;
  listener: ((blocked: boolean) => void) | null;
}

/** The top bar's avatar, disabled while the chat is busy (it alone redraws when that changes). */
function TopBarAvatar({ blocked, ...props }: Omit<Parameters<typeof ProfileAvatar>[0], "disabled"> & { blocked: Blocked }) {
  const [disabled, setDisabled] = useState(blocked.now);
  useEffect(() => {
    blocked.listener = setDisabled;
    setDisabled(blocked.now);
    return () => {
      blocked.listener = null;
    };
  }, [blocked]);
  return <ProfileAvatar {...props} disabled={disabled} />;
}
