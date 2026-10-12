import { type ComponentType, type FormEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityList } from "./ActivityList";
import { ChoicesBlock } from "./ChoicesBlock";
import { GearIcon, TopBar } from "./chrome";
import { type AppState, type ChoiceOption, type EngineProblem, type HarnessClient, type NoteView, type SendOptions, type TaskView, nextInPath } from "./client";
import { ErrorCard, isFixable, problemError } from "./ErrorCard";
import { FlowSide } from "./FlowSide";
import { uiLanguage } from "./FolderStep";
import { HistoryPanel } from "./HistoryPanel";
import { type BlockActions, type BlockProps, Blocks, Message } from "./Message";
import { NotesPanel } from "./NotesPanel";
import { type StartViewCopy, StartView } from "./StartView";
import { initialChat, reduceChat } from "./state";
import { UsageMeter } from "./UsageMeter";
import { type Preflight, lastTurnTokens, percent, preflight } from "./usage";

/** How close to the bottom (px) the user must be for new content to keep the chat pinned. */
const STICK_THRESHOLD = 80;
const NO_TASKS: TaskView = { current: null, actions: {}, notes: [] };

export type SendFn = (text: string, options?: SendOptions) => boolean;

/** A heavy action waiting for the user's go-ahead: a message to send, or a picked option. */
type Pending = { action: string; check: Preflight } & (
  | { kind: "send"; text: string; options: SendOptions }
  | { kind: "choose"; option: ChoiceOption }
);

export function ChatView({
  client,
  state,
  components,
  stateBlocks,
  renderSide,
  startView,
  engineProblem,
  onHome,
  onSettings,
  onFixEngine,
  onTurnOk,
}: {
  client: HarnessClient;
  state: AppState;
  components: Record<string, ComponentType<BlockProps>>;
  stateBlocks: string[];
  renderSide?: (blockState: Record<string, unknown>, send: SendFn) => ReactNode;
  /** Flow mode's start view (keys of the harness's strings). */
  startView?: StartViewCopy;
  /** What the background check found wrong with the engine, if anything. */
  engineProblem?: EngineProblem | null;
  onHome?: () => void;
  onSettings?: () => void;
  onFixEngine?: () => void;
  /** A turn has just ended without an error (the engine works: its background check can be redone). */
  onTurnOk?: () => void;
}) {
  const { t, i18n } = useTranslation();
  // save_note never shows: a note reaches the side panel as a file, through the tasks.
  const [chat, dispatch] = useReducer(reduceChat, undefined, () => initialChat([], [...stateBlocks, "save_note"]));
  const [draft, setDraft] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [notesPanel, setNotesPanel] = useState<{ expanded?: string } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [estimates, setEstimates] = useState<Record<string, number>>({});
  /** The saved conversation couldn't be read. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [tasks, setTasks] = useState<TaskView>(NO_TASKS);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  /** Flow mode: where the task on screen starts in the conversation; null shows the start view. */
  const [since, setSince] = useState<number | null>(null);
  /** A notice for the start view (the engine changed, the folder went back). */
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  /** `since` was set (by the user or from the open task): loading must not move it. */
  const placed = useRef(false);
  const preflightRef = useRef<HTMLDivElement>(null);
  const notNowRef = useRef<HTMLButtonElement>(null);
  /** What had focus when the pre-flight question opened (the action's button): it gets focus back on "Not now". */
  const preflightOpener = useRef<HTMLElement | null>(null);
  const chatRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  // Set synchronously on send so two quick clicks can't both pass before the live turn renders.
  const busy = useRef(false);
  const wasLive = useRef(false);
  const lang = uiLanguage(state, i18n.language);
  const engineOption = state.engines.find((e) => e.id === state.config.engineId);
  const engine = engineOption?.name ?? state.config.engineId ?? "";
  /** Any harness with actions runs as tasks: topics, a guided path, one task on screen at a time. */
  const flow = Object.keys(state.actions).length > 0;
  const path = state.path ?? [];
  const closing = tasks.current?.status === "closing";
  const all = useMemo(() => ({ ...components, choices: ChoicesBlock as ComponentType<BlockProps> }), [components]);
  const labelOf = (id: string) => state.actions[id]?.label[lang] ?? id;

  useEffect(() => {
    client.loadChat().then(
      ({ entries, switchedFrom }) => {
        dispatch({ type: "loaded", entries });
        setLoaded(true);
        if (switchedFrom) {
          const text = t("chat.switched", { engine });
          dispatch({ type: "notice", text, at: new Date().toISOString() });
          setNotice(text);
        }
      },
      () => {
        setLoadFailed(true);
        setLoaded(true);
      },
    );
    client.getUsage().then(
      (u) => {
        setEstimates(u.estimates);
        if (u.limits) dispatch({ type: "limits", status: "allowed", windows: u.limits });
      },
      () => {},
    );
    client.getTasks().then(
      (v) => {
        setTasks(v);
        setTasksLoaded(true);
      },
      () => setTasksLoaded(true),
    );
    const offTasks = client.onTasks(setTasks);
    const offEvents = client.onEvent((e) => dispatch(e));
    return () => {
      offTasks();
      offEvents();
    };
  }, [client]);

  // Flow mode, once the conversation and the tasks are known: a task still open shows its own entries.
  useEffect(() => {
    if (!flow || placed.current || !loaded || !tasksLoaded) return;
    placed.current = true;
    const id = tasks.current?.id;
    if (!id) return;
    const first = chat.entries.findIndex((e) => e.task === id);
    setSince(first >= 0 ? first : chat.entries.length);
  }, [flow, loaded, tasksLoaded, tasks, chat.entries]);

  useEffect(() => {
    if (!chat.live) busy.current = false;
  }, [chat.live]);

  // The pre-flight question gets focus on its safe answer ("Not now") and comes into view.
  const asking = pending !== null;
  useEffect(() => {
    if (!asking) return;
    preflightRef.current?.scrollIntoView?.({ block: "nearest" });
    notNowRef.current?.focus();
  }, [asking]);

  useLayoutEffect(() => {
    const el = chatRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.entries, chat.live]);

  useEffect(() => {
    if (chat.live && !wasLive.current) setAnnouncement(t("chat.working"));
    if (!chat.live && wasLive.current) {
      setAnnouncement(chat.entries.findLast((e) => e.role === "assistant")?.text ?? "");
      inputRef.current?.focus();
      client.getUsage().then((u) => setEstimates(u.estimates), () => {});
      if (!chat.entries.at(-1)?.error) onTurnOk?.();
    }
    wasLive.current = Boolean(chat.live);
  }, [chat.live, chat.entries, t, client, onTurnOk]);

  /** A turn runs, is about to, or the task is saving its note. */
  const blocked = (): boolean => Boolean(chat.live) || busy.current || closing;
  /** A new task goes on screen: its entries start after everything there now. */
  const showNewTask = () => {
    placed.current = true;
    setSince(chat.entries.length);
    setNotice(null);
  };
  const failTurn = (err: unknown) =>
    dispatch({ type: "done", ok: false, error: { code: "agent-crashed", detail: err instanceof Error ? err.message : String(err) } });
  const openPreflight = (p: Pending) => {
    preflightOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPending(p);
  };

  /** True when the message was sent, or is waiting for the user to confirm a heavy action. */
  const send = (text: string, options: SendOptions = {}, confirmed = false): boolean => {
    const message = text.trim();
    if (!message || blocked() || (pending && !confirmed)) return false;
    if (!confirmed && options.action) {
      const check = preflight(state.actions[options.action]?.cost, chat.limits, estimates[options.action]);
      if (check) {
        openPreflight({ kind: "send", action: options.action, check, text: message, options });
        return true;
      }
    }
    busy.current = true;
    stick.current = true;
    if (flow && (options.action || !tasks.current)) showNewTask();
    dispatch({ type: "user", text: message, at: new Date().toISOString(), ...(options.action ? { action: options.action } : {}) });
    client.send(message, options).catch(failTurn);
    inputRef.current?.focus();
    return true;
  };

  /** A pick in a `choices` block: a follow-up stays on screen; another topic replaces it; the end of the path just closes. */
  const choose = (option: ChoiceOption, confirmed = false): boolean => {
    if (blocked() || (pending && !confirmed)) return false;
    const action = option.action && state.actions[option.action] ? option.action : undefined;
    const moves = Boolean(option.next || action);
    const target = option.next ? nextInPath(path, tasks.current?.action, tasks.actions) : (action ?? null);
    if (!confirmed && target) {
      const check = preflight(state.actions[target]?.cost, chat.limits, estimates[target]);
      if (check) {
        openPreflight({ kind: "choose", action: target, check, option });
        return true;
      }
    }
    stick.current = true;
    const at = new Date().toISOString();
    if (!moves) {
      busy.current = true;
      dispatch({ type: "user", text: option.label, at });
    } else if (target) {
      busy.current = true;
      showNewTask();
      dispatch({ type: "user", text: labelOf(target), at, action: target });
    }
    client.choose(option).catch((err: unknown) => {
      if (!moves || target) failTurn(err);
    });
    return true;
  };

  const startTopic = (id: string) => void send(labelOf(id), { action: id });
  const resume = (note: NoteView) => {
    setNotesPanel(null);
    if (note.action && state.actions[note.action]) startTopic(note.action);
    else send(t("notes.resumeQuestion", { title: note.title }));
  };
  const openFile = (file: string) => client.openPath(file).catch(() => false);
  /** "Not now" (or Escape): nothing is sent, and focus goes back to whatever asked. */
  const closePreflight = () => {
    setPending(null);
    const opener = preflightOpener.current;
    preflightOpener.current = null;
    if (opener?.isConnected) opener.focus();
    else inputRef.current?.focus();
  };
  /** What harness UI gets: it can't skip the pre-flight check. */
  const sendFromHarness: SendFn = (text, options) => send(text, options);
  const lastAssistant = chat.entries.findLast((e) => e.role === "assistant");
  const blockActions = (active: boolean): BlockActions => ({ respond: sendFromHarness, choose: (o) => choose(o), open: openFile, active });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (send(draft)) setDraft("");
  };
  const onScroll = () => {
    const el = chatRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD;
  };
  const last = chat.entries.at(-1);
  const lastUser = chat.entries.findLast((e) => e.role === "user");
  const backgroundError = engineProblem ? problemError(engineProblem) : null;
  const shown = !flow ? chat.entries : since === null ? [] : chat.entries.slice(since);
  const showStart = flow && since === null && !chat.live;
  const placeholder = !flow ? t("chat.placeholder") : tasks.current ? t("flow.placeholderTask") : t("flow.placeholderStart");

  let preflightText = "";
  if (pending) {
    const label = labelOf(pending.action);
    const left = percent(pending.check.left);
    preflightText =
      pending.check.estimate !== null
        ? t("preflight.estimate", { action: label, estimate: Math.max(1, percent(pending.check.estimate)), left })
        : t("preflight.hint", { action: label, left });
  }

  return (
    <div className="hh-app">
      <TopBar title={state.harness.name[lang]}>
        <UsageMeter engine={engineOption} limits={chat.limits} lastTokens={lastTurnTokens(chat.entries)} />
        {onHome && <button onClick={onHome}>{t("chat.home")}</button>}
        <button onClick={() => setShowHistory(true)}>{t("history.title")}</button>
        {onSettings && (
          <button className="hh-icon-button" aria-label={t("home.settings")} onClick={onSettings}>
            <GearIcon />
          </button>
        )}
      </TopBar>
      <div className="hh-body">
        {flow && (
          <FlowSide
            state={state}
            lang={lang}
            tasks={tasks}
            disabled={blocked() || !loaded}
            onStart={startTopic}
            onOpenNote={(slug) => setNotesPanel({ expanded: slug })}
          />
        )}
        <main className="hh-main">
          <section className="hh-chat" ref={chatRef} onScroll={onScroll}>
            {loadFailed && (
              <p className="hh-error" role="alert">
                {t("chat.loadError")}
              </p>
            )}
            {/* The last turn's card already offers the fix for this same problem: one fix button is enough. */}
            {backgroundError && !(isFixable(last?.error) && last?.error?.code === backgroundError.code) && (
              <ErrorCard error={backgroundError} engine={engine} onFix={onFixEngine} />
            )}
            {showStart && (
              <StartView
                state={state}
                lang={lang}
                tasks={tasks}
                copy={startView}
                notice={notice}
                disabled={blocked() || !loaded}
                onStart={startTopic}
                onAsk={(q) => void send(q)}
              />
            )}
            {flow && since !== null && !tasks.current && !chat.live && (
              <button type="button" className="hh-back-topics" onClick={() => setSince(null)}>
                {t("flow.backToTopics")}
              </button>
            )}
            {shown.map((entry) => (
              <div key={entry.id}>
                <Message entry={entry} components={all} actions={blockActions(entry === lastAssistant && !chat.live && !closing)} />
                {entry.error && entry === last && (
                  <ErrorCard
                    error={entry.error}
                    engine={engine}
                    limits={chat.limits}
                    onFix={onFixEngine}
                    onRetry={lastUser ? () => send(lastUser.text, lastUser.action ? { action: lastUser.action } : {}) : undefined}
                  />
                )}
              </div>
            ))}
            {chat.live && (
              <article className="hh-message assistant live">
                <ActivityList items={chat.live.activities} />
                {chat.live.text ? chat.live.text.split("\n\n").map((p, i) => <p key={i}>{p}</p>) : <p className="hh-working">{t("chat.working")}</p>}
                <Blocks blocks={chat.live.blocks} components={all} actions={blockActions(false)} />
              </article>
            )}
            {closing && !chat.live && (
              <p className="hh-working" role="status">
                {t("flow.closing")}
              </p>
            )}
            {pending && (
              <div
                ref={preflightRef}
                className="hh-confirm"
                role="alertdialog"
                aria-labelledby="hh-preflight-title"
                aria-describedby="hh-preflight-text"
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  e.preventDefault();
                  closePreflight();
                }}
              >
                <p id="hh-preflight-title">
                  <strong className="hh-warn">{t("preflight.title")}</strong>
                </p>
                <p id="hh-preflight-text">{preflightText}</p>
                <button
                  className="hh-primary"
                  onClick={() => {
                    const p = pending;
                    setPending(null);
                    if (p.kind === "send") send(p.text, p.options, true);
                    else choose(p.option, true);
                  }}
                >
                  {t("preflight.continue")}
                </button>
                <button ref={notNowRef} onClick={closePreflight}>
                  {t("preflight.notNow")}
                </button>
              </div>
            )}
          </section>
          <form className="hh-composer" onSubmit={onSubmit}>
            <textarea
              ref={inputRef}
              aria-label={placeholder}
              placeholder={placeholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey) return;
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                e.preventDefault();
                if (send(draft)) setDraft("");
              }}
            />
            {chat.live ? (
              <button type="button" onClick={() => void client.cancel()}>
                {t("chat.stop")}
              </button>
            ) : (
              <button type="submit">{t("chat.send")}</button>
            )}
          </form>
          {startView?.hint && <p className="hh-composer-hint">{t(startView.hint, { ns: "harness" })}</p>}
        </main>
        {renderSide && <aside className="hh-side">{renderSide(chat.blockState, sendFromHarness)}</aside>}
      </div>
      <div className="hh-sr-only" aria-live="polite">
        {announcement}
      </div>
      {showHistory && (
        <HistoryPanel
          client={client}
          disabled={Boolean(chat.live)}
          onClose={() => setShowHistory(false)}
          onRestored={() => {
            const text = t("history.restored");
            dispatch({ type: "notice", text, at: new Date().toISOString() });
            setNotice(text);
          }}
        />
      )}
      {notesPanel && (
        <NotesPanel
          notes={tasks.notes}
          expanded={notesPanel.expanded}
          lang={lang}
          disabled={blocked()}
          onResume={resume}
          onOpen={openFile}
          onClose={() => setNotesPanel(null)}
        />
      )}
    </div>
  );
}
