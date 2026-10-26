import { type ComponentType, type FormEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChoicesBlock } from "./ChoicesBlock";
import { GearIcon, TopBar } from "./chrome";
import {
  type AppState,
  type ChatEntry,
  type ChoiceOption,
  type EngineProblem,
  type HarnessClient,
  type NoteView,
  type SendOptions,
  type TaskView,
  nextInPath,
  partsOf,
} from "./client";
import { ErrorCard, isFixable, problemError } from "./ErrorCard";
import { FlowSide } from "./FlowSide";
import { HistoryPanel } from "./HistoryPanel";
import { type BlockActions, type BlockProps, Message } from "./Message";
import { markdownToPlain } from "./markdown";
import { NotesPanel } from "./NotesPanel";
import { usePacedAnswer } from "./pace";
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
  | { kind: "choose"; option: ChoiceOption; task: string }
);

/** A pick the app couldn't take, and the task its block belongs to. */
interface Pick {
  option: ChoiceOption;
  task: string;
}

/** The `choices` block of an answer outside the waiting task: shown, but it can't act. */
const StaleChoices = (props: BlockProps) => <ChoicesBlock data={props.data} choose={props.choose} active={false} />;

export function ChatView({
  client,
  state,
  components,
  stateBlocks,
  renderSide,
  startView,
  engineProblem,
  scopeBar,
  openScope = null,
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
  /** Harnesses with scopes: the picker shown first in the top bar (disabled while a turn runs or a task closes). */
  scopeBar?: (disabled: boolean) => ReactNode;
  /** Harnesses with scopes: the open scope (its chat is the one on screen). */
  openScope?: string | null;
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
  /** End of the path: the pick that closes the task was refused (shown until the next pick or message). */
  const [pickFailed, setPickFailed] = useState(false);
  /** Bumped when a pick fails: the blocks are drawn afresh, so their options can be picked again. */
  const [pickResets, setPickResets] = useState(0);
  /** The last message sent came from a pick (Try again picks it again). */
  const lastPick = useRef<Pick | null>(null);
  /** The task open now, read when a turn ends to tag its entry. */
  const openTask = useRef<string | undefined>(undefined);
  openTask.current = tasks.current?.id;
  /** `since` was set (by the user or from the open task): loading must not move it. */
  const placed = useRef(false);
  const preflightRef = useRef<HTMLDivElement>(null);
  const notNowRef = useRef<HTMLButtonElement>(null);
  /** What had focus when the pre-flight question opened (the action's button): it gets focus back on "Not now". */
  const preflightOpener = useRef<HTMLElement | null>(null);
  const chatRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Away from a turn just sent (loading, a notice): new content keeps the chat at the bottom while the user is there. */
  const stick = useRef(true);
  /** Set on send: the question that goes on screen next is pinned to the top of the chat. */
  const pinNext = useRef(false);
  /** The question pinned at the top while its answer grows below it; the spacer gives it room to get there. */
  const pinned = useRef<string | null>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  /** The turn whose answer is pacing in, until all of it is on screen (it goes on after the turn ends). */
  const pacedTurn = useRef<string | null>(null);
  // Set synchronously on send so two quick clicks can't both pass before the live turn renders.
  const busy = useRef(false);
  const wasLive = useRef(false);
  const engineOption = state.engines.find((e) => e.id === state.config.engineId);
  const engine = engineOption?.name ?? state.config.engineId ?? "";
  /** Any harness with actions runs as tasks: topics, a guided path, one task on screen at a time. */
  const flow = Object.keys(state.actions).length > 0;
  const path = state.path ?? [];
  const closing = tasks.current?.status === "closing";
  const checkpoint = tasks.current?.status === "checkpoint";
  const fallback = tasks.current?.fallback;
  const all = useMemo(() => ({ ...components, choices: ChoicesBlock as ComponentType<BlockProps> }), [components]);
  const stale = useMemo(() => ({ ...all, choices: StaleChoices }), [all]);
  const labelOf = (id: string) => state.actions[id]?.label ?? id;

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
    // A turn's entry belongs to the task open when it ends (the app tells the window about a task before its turn).
    const offEvents = client.onEvent((e) => dispatch(e.type === "done" ? { ...e, task: openTask.current } : e));
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

  // The answer appears at a steady pace, word by word and block by block: the turn running now, then its entry
  // once it ends, until all of it is on screen.
  if (chat.live) pacedTurn.current = chat.live.id;
  const pacedEntry = chat.live ? null : chat.entries.findLast((e) => e.role === "assistant" && e.id === pacedTurn.current);
  const pacedParts = chat.live ? chat.live.parts : pacedEntry ? partsOf(pacedEntry) : null;
  const reveal = usePacedAnswer(pacedTurn.current ?? "", pacedParts, !chat.live);

  useLayoutEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    const spacer = spacerRef.current;
    const wrappers = [...el.querySelectorAll<HTMLElement>("[data-entry]")];
    // A question just sent goes to the top of the chat, and stays there: its answer grows into the room below.
    const justSent = pinNext.current && chat.live !== null;
    if (justSent) {
      pinNext.current = false;
      pinned.current = wrappers.findLast((w) => w.dataset.role === "user")?.dataset.entry ?? null;
    }
    const question = pinned.current ? wrappers.find((w) => w.dataset.entry === pinned.current) : undefined;
    if (!question || !spacer) {
      pinned.current = null;
      if (spacer) spacer.style.display = "none";
      if (stick.current) el.scrollTop = el.scrollHeight;
      return;
    }
    const style = getComputedStyle(el);
    const gap = parseFloat(style.rowGap) || 0;
    const top = question.offsetTop - (parseFloat(style.paddingTop) || 0);
    // Enough room below the question to scroll it to the top; it shrinks as the answer fills it.
    const current = spacer.style.display === "none" ? 0 : (parseFloat(spacer.style.height) || 0) + gap;
    const room = Math.max(0, top + el.clientHeight - (el.scrollHeight - current));
    spacer.style.display = room > gap ? "" : "none";
    spacer.style.height = `${Math.max(0, room - gap)}px`;
    if (justSent) el.scrollTop = top;
  }, [chat.entries, chat.live, reveal]);

  useEffect(() => {
    // "Working…" is announced by the status row itself; clearing lets the final answer be announced afresh.
    if (chat.live && !wasLive.current) setAnnouncement("");
    if (!chat.live && wasLive.current) {
      setAnnouncement(markdownToPlain(chat.entries.findLast((e) => e.role === "assistant")?.text ?? ""));
      inputRef.current?.focus();
      client.getUsage().then((u) => setEstimates(u.estimates), () => {});
      if (!chat.entries.at(-1)?.error) onTurnOk?.();
    }
    wasLive.current = Boolean(chat.live);
  }, [chat.live, chat.entries, t, client, onTurnOk]);

  /** A turn runs, is about to, or the task is saving its note (closing, or a checkpoint). */
  const blocked = (): boolean => Boolean(chat.live) || busy.current || closing || checkpoint;
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
    // A `required` action needs an open scope (spec §3.3); the main process would refuse it.
    if (options.action && state.scopes && state.actions[options.action]?.scope !== "none" && !openScope) {
      const text = t("scopes.pickFirst", { label: state.scopes.label });
      dispatch({ type: "notice", text, at: new Date().toISOString() });
      setNotice(text);
      return false;
    }
    if (!confirmed && options.action) {
      const check = preflight(state.actions[options.action]?.cost, chat.limits, estimates[options.action]);
      if (check) {
        openPreflight({ kind: "send", action: options.action, check, text: message, options });
        return true;
      }
    }
    busy.current = true;
    stick.current = true;
    pinNext.current = true;
    lastPick.current = null;
    setPickFailed(false);
    if (flow && (options.action || !tasks.current)) showNewTask();
    dispatch({ type: "user", text: message, at: new Date().toISOString(), ...(options.action ? { action: options.action } : {}) });
    client.send(message, options).catch(failTurn);
    inputRef.current?.focus();
    return true;
  };

  /**
   * A pick in a `choices` block of task `task`: a follow-up stays on screen; another topic replaces it; the end
   * of the path just closes. True only when the pick was sent (not while the pre-flight question waits).
   */
  const choose = (option: ChoiceOption, task: string | undefined, confirmed = false): boolean => {
    if (blocked() || (pending && !confirmed)) return false;
    // Only the waiting task's own blocks act: a pick never lands in another task.
    if (!task || task !== tasks.current?.id || tasks.current.status !== "waiting") return false;
    const action = option.action && state.actions[option.action] ? option.action : undefined;
    const moves = Boolean(option.next || action);
    const target = option.next ? nextInPath(path, tasks.current?.action, tasks.actions) : (action ?? null);
    if (!confirmed && target) {
      const check = preflight(state.actions[target]?.cost, chat.limits, estimates[target]);
      if (check) {
        openPreflight({ kind: "choose", action: target, check, option, task });
        return false;
      }
    }
    stick.current = true;
    lastPick.current = { option, task };
    setPickFailed(false);
    const at = new Date().toISOString();
    pinNext.current = !moves || target !== null;
    if (!moves) {
      busy.current = true;
      dispatch({ type: "user", text: option.label, at });
    } else if (target) {
      busy.current = true;
      showNewTask();
      dispatch({ type: "user", text: labelOf(target), at, action: target });
    }
    client.choose(option, task).catch((err: unknown) => {
      if (!moves || target) failTurn(err);
      else {
        // Nothing ran on screen: say so, and let the block be picked again.
        setPickFailed(true);
        setPickResets((n) => n + 1);
      }
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
  const revealFile = (file: string) => client.revealPath(file).catch(() => false);
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
  const blockActions = (active: boolean, task?: string): BlockActions => ({ respond: sendFromHarness, choose: (o) => choose(o, task), open: openFile, reveal: revealFile, active });
  /** The entry's answer belongs to the task waiting now: its `choices` block may act. */
  const ofWaitingTask = (task: string | undefined) => task !== undefined && task === tasks.current?.id && tasks.current.status === "waiting";
  /** Try again: a failed pick of the still-open task is picked again; anything else resends the last message. */
  const retry = (): (() => void) | undefined => {
    const pick = lastPick.current;
    if (pick && pick.task === tasks.current?.id) return () => void choose(pick.option, pick.task);
    if (lastUser) return () => void send(lastUser.text, lastUser.action ? { action: lastUser.action } : {});
    return undefined;
  };
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
  const liveEntry: ChatEntry | null = chat.live
    ? { id: chat.live.id, role: "assistant", text: chat.live.text, blocks: chat.live.blocks, parts: chat.live.parts, activities: [], at: "" }
    : null;
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
      <TopBar title={state.harness.name} mock={state.mock}>
        {scopeBar?.(blocked())}
        <UsageMeter engine={engineOption} limits={chat.limits} lastTokens={lastTurnTokens(chat.entries)} />
        {onHome && <button onClick={onHome}>{t("chat.home")}</button>}
        <button
          onClick={() => {
            // One panel at a time: Escape closes the one on screen.
            setNotesPanel(null);
            setShowHistory(true);
          }}
        >
          {t("history.title")}
        </button>
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
            tasks={tasks}
            disabled={blocked() || !loaded}
            onStart={startTopic}
            onOpenNote={(slug) => {
              setShowHistory(false);
              setNotesPanel({ expanded: slug });
            }}
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
            {/* The running turn is the list's last item, under the id its entry gets: it stays the same element when it ends. */}
            {(liveEntry ? [...shown, liveEntry] : shown).map((entry) => (
              <div key={entry.id} data-entry={entry.id} data-role={entry.role}>
                <Message
                  key={pickResets}
                  entry={entry}
                  components={entry === liveEntry || ofWaitingTask(entry.task) ? all : stale}
                  actions={blockActions(entry === lastAssistant && !chat.live && !closing, entry.task)}
                  live={entry === liveEntry ? { activities: chat.live!.activities, label: checkpoint ? t("flow.checkpoint") : undefined } : undefined}
                  reveal={entry.id === pacedTurn.current ? (reveal ?? undefined) : undefined}
                />
                {entry.error && entry === last && (
                  <ErrorCard
                    error={entry.error}
                    engine={engine}
                    limits={chat.limits}
                    onFix={onFixEngine}
                    onRetry={retry()}
                  />
                )}
              </div>
            ))}
            {pickFailed && (
              <p className="hh-error" role="alert">
                {t("choices.failed")}
              </p>
            )}
            {fallback && (
              <p className="hh-caption hh-fallback" role="status">
                {fallback.tier
                  ? t("models.fallbackNotice", { model: fallback.model, tier: t(`models.tier.${fallback.tier}`) })
                  : t("models.fallbackDefault", { model: fallback.model })}
              </p>
            )}
            {closing && !chat.live && (
              <p className="hh-working" role="status">
                {t("flow.closing")}
              </p>
            )}
            {checkpoint && !chat.live && (
              <p className="hh-working" role="status">
                {t("flow.checkpoint")}
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
                    else choose(p.option, p.task, true);
                  }}
                >
                  {t("preflight.continue")}
                </button>
                <button ref={notNowRef} onClick={closePreflight}>
                  {t("preflight.notNow")}
                </button>
              </div>
            )}
            <div ref={spacerRef} className="hh-chat-spacer" style={{ display: "none" }} aria-hidden="true" />
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
            {/* A closing or checkpoint turn is quiet (nothing live on screen) but still stoppable. */}
            {chat.live || closing || checkpoint ? (
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
          actions={state.actions}
          disabled={Boolean(chat.live) || closing || checkpoint}
          onClose={() => setShowHistory(false)}
          onRestored={(kind) => {
            const text = t(kind === "task" ? "history.restoredTask" : "history.restored");
            dispatch({ type: "notice", text, at: new Date().toISOString() });
            setNotice(text);
          }}
        />
      )}
      {notesPanel && (
        <NotesPanel
          notes={tasks.notes}
          expanded={notesPanel.expanded}
          disabled={blocked()}
          onResume={resume}
          onOpen={openFile}
          onClose={() => setNotesPanel(null)}
        />
      )}
    </div>
  );
}
