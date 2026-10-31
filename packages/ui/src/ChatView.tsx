import { type ComponentType, type FormEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Tier } from "@humanharness/harness-sdk";
import { isMarkdownPath } from "@humanharness/harness-sdk/documents";
import { AnnotateBlock } from "./AnnotateBlock";
import { findAnswer } from "./annotate";
import { cleanDocumentCards } from "./card-shape";
import { ChoicesBlock } from "./ChoicesBlock";
import { CitationContext, type CitationResolver } from "./citations";
import { SidekickToggle } from "./chrome";
import {
  type AppState,
  type ChatEntry,
  type ChatSearchContext,
  type ChoiceOption,
  type DocumentCard,
  type EngineProblem,
  type HarnessClient,
  type ModeChoice,
  type ModeSwitch,
  type NoteView,
  type ReaderPrefs,
  type RespondResult,
  type ReviewSummary,
  type SearchCommandId,
  type SendOptions,
  type SidekickCard,
  type SidekickReview,
  type TaskTurnNotice,
  type TaskView,
  TOOLS_OFF_CRASHES,
  isTurnEntry,
  nextInPath,
  partsOf,
} from "./client";
import { ContextPanel } from "./ContextPanel";
import { DocumentContext, type DocumentHost } from "./documents-context";
import { DocumentReader, type ReaderTarget } from "./DocumentReader";
import { ErrorCard, isFixable, problemError } from "./ErrorCard";
import { ToolCallLines } from "./tools/ToolCallLine";
import { FileTimelinePanel } from "./FileTimelinePanel";
import { ContextMeter, FlowSide } from "./FlowSide";
import { type Paused, NO_PAUSED, countPaused, pausedSummary } from "./focus-notices";
import { HistoryPanel } from "./HistoryPanel";
import { type AnswerHold, pruneDrafts } from "./InputForm";
import { type BlockActions, type BlockProps, type InputContext, Message } from "./Message";
import { markdownToPlain } from "./markdown";
import { MaterialPanel, type MaterialPanelProps } from "./MaterialPanel";
import { ModeBar, ModeList } from "./ModeList";
import { actionModes, tierBelow } from "./modes";
import { NotesPanel } from "./NotesPanel";
import { usePacedAnswer } from "./pace";
import { PhaseStepper } from "./PhaseStepper";
import { actionPhases, phaseModesOf } from "./phases";
import { PluginChips } from "./plugins/PluginChips";
import { PluginsSection } from "./plugins/PluginsSection";
import { PreparedTask } from "./plugins/PreparedTask";
import { CHIPS_SLOT, type PanelTarget, PLUGINS_SLOT, PluginSurfaceContext, type PluginSurfaceContextValue, reloadOf, usePluginSurface } from "./plugins/surface";
import { RecommendModeBlock } from "./RecommendModeBlock";
import { FlaggedText } from "./sidekick/FlaggedText";
import { FirstOpenOffer } from "./sidekick/PresetOffer";
import { ReviewHint } from "./sidekick/ReviewHint";
import { SidekickPanel, SidekickRail, waitingCards } from "./sidekick/SidekickPanel";
import { useNarrow } from "./sidekick/useNarrow";
import { EngineNotice } from "./hatches/EngineNotice";
import { useSidekick } from "./sidekick/useSidekick";
import type { SearchIntent } from "./search/intent";
import { type StartViewCopy, StartView } from "./StartView";
import { initialChat, isToolLine, reduceChat } from "./state";
import { TaskHeader } from "./TaskHeader";
import { UsageMeter } from "./UsageMeter";
import { type Preflight, lastTurnTokens, percent, preflight } from "./usage";

/** How close to the bottom (px) the user must be for new content to keep the chat pinned. */
const STICK_THRESHOLD = 80;
/** A turn's own entry: never an app notice or a tool call's line that came with no turn (tools spec §8.2). */
const isReply = (e: ChatEntry): boolean => isTurnEntry(e) && !isToolLine(e);
const NO_TASKS: TaskView = { current: null, actions: {}, notes: [] };

export type SendFn = (text: string, options?: SendOptions) => boolean;

/** What the shell's top bar asks of the chat on screen (see `shellRef`). */
export interface ShellBridge {
  refill: (text: string) => void;
  start: (action: string, scope: string | null) => boolean;
  openPanel: (plugin: string, panel: string, focus?: string) => void;
}

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

/** A `recommend_mode` block of an earlier task, or once the conversation moved on: drawn, never usable. */
const StaleRecommend = (props: BlockProps) => <RecommendModeBlock {...props} active={false} chooseMode={undefined} />;

export function ChatView({
  client,
  state,
  components,
  stateBlocks,
  renderSide,
  startView,
  engineProblem,
  scopeBar,
  shellRef,
  onBlocked,
  startRef,
  searchRef,
  searchContextRef,
  taskStrip,
  onNewTask,
  title,
  draftKeep,
  openScope = null,
  notesRequest,
  pluginsRequest,
  onPluginPanels,
  onTaskLabel,
  onSidekickSettings,
  onFixEngine,
  onTurnOk,
  slim,
  materialPanel,
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
  /** Harnesses with scopes: the picker shown first above the chat (disabled while a turn runs or a task closes). */
  scopeBar?: (disabled: boolean) => ReactNode;
  /**
   * Set by the chat for the shell's top bar (UI refresh spec §4.1), which lives outside it: the Inbox's `refill` puts
   * text back in the box and `start` starts a declared action as the start view does (parallel spec §9.2, part 3); the
   * bell's `openPanel` opens a plugin panel. Null once this view is gone.
   */
  shellRef?: { current: ShellBridge | null };
  /** Told whether a turn runs or a task closes (the top bar's profile switcher is disabled meanwhile). */
  onBlocked?: (blocked: boolean) => void;
  /** A harness with jobs: gets the same `start`, for Settings › Jobs' Start (part 3); null once this view is gone. */
  startRef?: { current: ((action: string, scope: string | null) => boolean) | null };
  /** Set by the chat: runs a search result or question (search spec §3); false when it can't here. */
  searchRef?: { current: ((intent: SearchIntent) => boolean) | null };
  /** Set by the chat: what it says about itself for the palette's actions (search spec §6); null once this view is gone. */
  searchContextRef?: { current: (() => ChatSearchContext) | null };
  /** Board mode: the bar naming the task on screen, over the chat (parallel spec §9.1). */
  taskStrip?: ReactNode;
  /** Board mode: the task header's New task (parallel spec §9.1); absent, the header has none (D0). */
  onNewTask?: () => void;
  /** The task header's title (the breadcrumb's screen); absent, the open task's label, else the start view's title. */
  title?: string;
  /**
   * Board mode: this view remounts on every change of task shown, and the box starts empty as always, except for a
   * message the inbox put back (Decision 7): that text, and what is typed after it, goes to the next view once. Absent:
   * nothing is carried.
   */
  draftKeep?: { current: string | null };
  /** Harnesses with scopes: the open scope (its chat is the one on screen). */
  openScope?: string | null;
  /** The rail's Notes (UI refresh spec §4.2): each new number opens the Notes drawer. */
  notesRequest?: number;
  /** The rail's Plugins: each new number brings the Plugins section's first panel into view. */
  pluginsRequest?: number;
  /** Told whether a running plugin has a panel in the Plugins section (the rail's Plugins entry), and false when gone. */
  onPluginPanels?: (has: boolean) => void;
  /** The open task's label, null with none (and on unmount): the top bar's breadcrumb names it. */
  onTaskLabel?: (label: string | null) => void;
  onFixEngine?: () => void;
  /** A turn has just ended without an error (the engine works: its background check can be redone). */
  onTurnOk?: () => void;
  /**
   * An interview on the setup screen (setup-steps spec §3): only this action's task, with no top bar, side panel,
   * history or topics. A button starts it (or continues it) when it isn't on screen.
   */
  slim?: { action: string };
  /** Replaces the default material panel; only with `state.material`. */
  materialPanel?: ComponentType<MaterialPanelProps>;
  /** Opens Settings › Sidekick. */
  onSidekickSettings?: () => void;
}) {
  const { t, i18n } = useTranslation();
  // save_note never shows: a note reaches the side panel as a file, through the tasks. Nor set_phase: the stepper
  // shows its proposal, through the tasks.
  const [chat, dispatch] = useReducer(reduceChat, undefined, () => initialChat([], [...stateBlocks, "save_note", "set_phase"]));
  const [draft, setDraft] = useState(() => draftKeep?.current ?? "");
  /** The inbox put a message back in this box: from then on its text is kept for the next view. */
  const keepDraft = useRef(false);
  // Taken once: a later remount (another task) starts empty unless a refill armed the keep again.
  useEffect(() => {
    if (draftKeep) draftKeep.current = null;
  }, [draftKeep]);
  useEffect(() => {
    if (draftKeep && keepDraft.current) draftKeep.current = draft || null;
  }, [draftKeep, draft]);
  /** A cancelled queued message (parallel Decision 7): back in the box, after whatever is typed there. */
  const refillDraft = useCallback((text: string) => {
    keepDraft.current = true;
    setDraft((d) => (d.trim() ? `${d}\n${text}` : text));
  }, []);
  const [showHistory, setShowHistory] = useState(false);
  /** The past task search asked the History panel to open at (search spec §3). */
  const [historyTask, setHistoryTask] = useState<string | undefined>(undefined);
  /** A file's timeline outside the reader: a non-`.md` file or a deleted `.md`, from the History panel (file-timeline spec §6.2, Q10). */
  const [timelineFile, setTimelineFile] = useState<string | null>(null);
  const [notesPanel, setNotesPanel] = useState<{ expanded?: string } | null>(null);
  /** The context panel is open (context-panel spec §5.1); it shares the reader's slot. */
  const [contextOpen, setContextOpen] = useState(false);
  /** The meter that opened the context panel: it gets focus back when the panel closes. */
  const contextOpener = useRef<HTMLElement | null>(null);
  /** The document reader beside the chat (document-reader spec §5); null: closed. Kept in state: a stable target. */
  const [reader, setReader] = useState<ReaderTarget | null>(null);
  /** Every open gets a new nonce: the same document at the same anchor opened again goes there again. */
  const readerOpens = useRef(0);
  /** What had focus when the reader opened from the chat (a card, a link): it gets focus back when the reader closes. */
  const readerOpener = useRef<HTMLElement | null>(null);
  /** Slim (the setup screen) shows no reader: nothing opens one there. */
  const slimRef = useRef(slim);
  slimRef.current = slim;
  const showReader = useCallback((target: Omit<ReaderTarget, "nonce">) => {
    if (slimRef.current) return;
    const active = document.activeElement;
    // A link inside the reader keeps the first opener.
    if (active instanceof HTMLElement && active !== document.body && !active.closest(".hh-reader")) readerOpener.current = active;
    // A file's timeline panel would cover the reader; the context panel holds its slot.
    setTimelineFile(null);
    setContextOpen(false);
    setReader({ ...target, nonce: ++readerOpens.current });
  }, []);
  const [readerFull, setReaderFull] = useState(false);
  /** Focus mode (review spec §6.2): the reader alone, in one quiet column; the turn's end and its notices wait. */
  const [focus, setFocus] = useState(false);
  const focusRef = useRef(false);
  /** What focus mode held back, told in one line on leaving. */
  const paused = useRef<Paused>(NO_PAUSED);
  const [readerPrefs, setReaderPrefs] = useState<ReaderPrefs>(state.config.reader ?? {});
  /** Card paths that are no longer there (struck through). */
  const [missingDocs, setMissingDocs] = useState<ReadonlySet<string>>(() => new Set());
  /** Bumped to check the cards' documents again (the window got focus, the reader found one missing). */
  const [docsCheck, setDocsCheck] = useState(0);
  const recheckDocs = useCallback(() => setDocsCheck((n) => n + 1), []);
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
  /** The tier question (task-modes spec §5.3): the mode asks for more than the task's tier. */
  const [tierAsk, setTierAsk] = useState<{ mode: string; task: string; required: Tier; current: Tier } | null>(null);
  /** `defaultMode: "ask"`: the start waits for the person's mode (no model call before it). */
  const [askPick, setAskPick] = useState<{ text: string; options: SendOptions } | null>(null);
  /** The last mode pick was refused or failed (shown until the next pick or message). */
  const [modeFailed, setModeFailed] = useState(false);
  /** The last thing sent was a mode switch: Try again picks it again. */
  const lastMode = useRef<{ mode: string; task: string; belowTier?: ModeChoice["belowTier"] } | null>(null);
  const tierRef = useRef<HTMLDivElement>(null);
  const tierNotNowRef = useRef<HTMLButtonElement>(null);
  const askRef = useRef<HTMLDivElement>(null);
  /** What had focus when the tier or "ask" question opened: it gets focus back when the question closes unanswered. */
  const questionOpener = useRef<HTMLElement | null>(null);
  /** A switch was taken (from this window or the harness's own UI): draws its line and its turn. Set each render. */
  const tookSwitch = useRef<(s: ModeSwitch) => void>(() => {});
  /** The last message sent came from a pick (Try again picks it again). */
  const lastPick = useRef<Pick | null>(null);
  /** The last message sent and its options: Try again sends it with the answers already given (the time box, a mode). */
  const lastSend = useRef<{ text: string; options: SendOptions } | null>(null);
  /** The last message sent was an answer to an input block: its failed turn reopens the form, never a plain resend. */
  const lastAnswer = useRef(false);
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
  // Sidekick (sidekick spec §4.1, §7): only when main sends `state.sidekick`, never in slim mode (D0).
  /** Bumped after a restore: a fresh read, beside the state main pushes then. */
  const [skRefresh, setSkRefresh] = useState(0);
  const skEnabled = state.sidekick !== undefined && !slim;
  const sidekick = useSidekick(client, skEnabled, skRefresh);
  // What the running plugins draw (plugins part 2): only with `state.plugins`, never in slim mode (D0).
  const pluginsOn = state.plugins !== undefined && !slim;
  const surface = usePluginSurface(client, pluginsOn);
  /** The panel last opened, and its plugin's dev reload count then: a reloaded frame doesn't get the old focus again. */
  const [panelTarget, setPanelTarget] = useState<(PanelTarget & { reloadAt: number }) | null>(null);
  const surfaceNow = useRef(surface);
  surfaceNow.current = surface;
  const openPanel = useCallback((plugin: string, panel: string, focus?: string) => {
    const reloadAt = surfaceNow.current ? reloadOf(surfaceNow.current, plugin) : 0;
    setPanelTarget((prev) => ({ plugin, panel, ...(focus !== undefined ? { focus } : {}), n: (prev?.n ?? 0) + 1, reloadAt }));
  }, []);
  // Once its plugin reloaded, the open is spent: no target (so no old focus, no tab pulled back). Kept as one object
  // per open otherwise, so a surface push doesn't count as a new open.
  const targetLive = panelTarget !== null && surface !== null && reloadOf(surface, panelTarget.plugin) === panelTarget.reloadAt;
  const target = useMemo<PanelTarget | null>(() => {
    if (!panelTarget || !targetLive) return null;
    const { reloadAt: _, ...rest } = panelTarget;
    return rest;
  }, [panelTarget, targetLive]);
  const surfaceCtx = useMemo<PluginSurfaceContextValue | null>(
    () => surface && { surface, client, target, open: openPanel },
    [surface, client, target, openPanel],
  );
  /** Under 720 px the panel can't show: no paid review the person can't see (styles.css). */
  const narrow = useNarrow();
  const reviewOn = sidekick !== null && sidekick.settings.on && sidekick.settings.preSend && !narrow;
  /** A review in flight: until when the countdown runs (null: "always wait"). */
  const [reviewing, setReviewing] = useState<{ until: number | null } | null>(null);
  const reviewSeq = useRef(0);
  /** A block answer's review (spec §4.1): its number, the composer review's number when it started, the form a card holds. */
  const answerSeq = useRef(0);
  const answerRun = useRef<{ seq: number; composerSeq: number } | null>(null);
  const answerHold = useRef<{ cardId: string; hold: AnswerHold } | null>(null);
  /** The panel opened or collapsed by the person; null: expanded when Sidekick is on. */
  const [skOpen, setSkOpen] = useState<boolean | null>(null);
  const [skView, setSkView] = useState<"sidekick" | "harness">("sidekick");
  const skExpanded = sidekick !== null && (skOpen ?? sidekick.settings.on);
  const skCard = sidekick?.card?.id;
  /** Queued asks "For later" (spec §4.1): the live card's, then those of cards that were sent, which outlive them. */
  const [later, setLater] = useState<{ key: string; text: string }[]>([]);
  /** The live card's asks the person dropped, by key (`<card id>:<position>`): equal texts are told apart. */
  const [droppedLive, setDroppedLive] = useState<string[]>([]);
  const liveQueued = (sidekick?.card?.queued ?? [])
    .map((text, at) => ({ key: `${skCard}:${at}`, text }))
    .filter((q) => !droppedLive.includes(q.key));
  // They belong to the task: another task (or none) starts with none. The first send opening a task keeps them.
  const laterTask = useRef(tasks.current?.id);
  useEffect(() => {
    const was = laterTask.current;
    laterTask.current = tasks.current?.id;
    if (was !== undefined && was !== tasks.current?.id) setLater([]);
  }, [tasks.current?.id]);
  // The live card's dropped asks belong to it: another card starts with none dropped.
  useEffect(() => setDroppedLive((d) => (d.length ? [] : d)), [skCard]);
  const skAnnounced = useRef(new Set<string>());
  const skFrame = useRef(0);
  const skWaiting = sidekick ? waitingCards(sidekick) : [];
  const skWaitingIds = skWaiting.map((c) => c.id).join(" ");
  const skWaitingRef = useRef(skWaiting);
  skWaitingRef.current = skWaiting;
  // Each new card is announced once (spec §7 accessibility), heads-ups and other moments too; the panel never takes focus.
  // Cleared, then set on the next frame: two cards in a row put the same words, which a screen reader would skip.
  useEffect(() => {
    const fresh = skWaitingRef.current.filter((c) => !skAnnounced.current.has(c.id));
    for (const c of fresh) skAnnounced.current.add(c.id);
    // The live pre-send card says the most; else the newest other card, by who speaks.
    const card = fresh.find((c) => c.id === skCard) ?? fresh.at(-1);
    if (!card) return;
    const text = card.id === skCard ? t("sidekick.card.announce") : t("sidekick.card.announceFrom", { name: card.speaker.name });
    setAnnouncement("");
    // Only a newer announcement cancels a pending one: a card leaving in between must not swallow it.
    cancelAnimationFrame(skFrame.current);
    skFrame.current = requestAnimationFrame(() => setAnnouncement(text));
  }, [skWaitingIds, skCard, t]);
  useEffect(() => () => cancelAnimationFrame(skFrame.current), []);
  /** Collapse ↔ open unmounts the focused button: focus moves to its counterpart (rail ↔ collapse). */
  const skFocus = useRef(false);
  const railRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!skFocus.current) return;
    skFocus.current = false;
    (skExpanded ? document.querySelector<HTMLButtonElement>(".hh-sk-collapse") : railRef.current)?.focus();
  }, [skExpanded]);
  const toggleSk = (open: boolean) => {
    skFocus.current = true;
    setSkOpen(open);
  };
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
  /** The chat's citation labels (set further down), so the read-aloud answer can name its sources. */
  const citationsRef = useRef<CitationResolver | null>(null);
  const engineOption = state.engines.find((e) => e.id === state.config.engineId);
  const engine = engineOption?.name ?? state.config.engineId ?? "";
  /** Any harness with actions runs as tasks: topics, a guided path, one task on screen at a time. */
  const flow = Object.keys(state.actions).length > 0;
  const path = state.path ?? [];
  const closing = tasks.current?.status === "closing";
  const checkpoint = tasks.current?.status === "checkpoint";
  const fallback = tasks.current?.fallback;
  // `annotate` is drawn only for a harness with input blocks, the only ones that offer it (spec D0).
  // `recommend_mode` likewise, only for a harness with modes (task-modes D0).
  const all = useMemo(
    () => ({
      ...components,
      choices: ChoicesBlock as ComponentType<BlockProps>,
      ...(state.inputs ? { annotate: AnnotateBlock } : {}),
      ...(state.modes ? { recommend_mode: RecommendModeBlock } : {}),
    }),
    [components, state.inputs, state.modes],
  );
  const stale = useMemo(() => ({ ...all, choices: StaleChoices, ...(state.modes ? { recommend_mode: StaleRecommend } : {}) }), [all, state.modes]);
  /** Opens a document in the reader (a `.md` link, a card, the harness's own UI). */
  const openDoc = useCallback((path: string, anchor?: string) => showReader({ path, ...(anchor ? { anchor } : {}) }), []);
  const documentKinds = state.documents?.kinds;
  // Memoised: a new host on every streaming redraw would reload the chat's local images.
  const documentHost = useMemo<DocumentHost>(
    () => ({ open: openDoc, image: (p) => client.readImage(p).catch(() => null), ...(documentKinds ? { kinds: documentKinds } : {}) }),
    [client, openDoc, documentKinds],
  );
  const labelOf = (id: string) => state.actions[id]?.label ?? id;
  /** The open task's modes (its action's, in its order); none without modes (D0). */
  const taskModes = actionModes(state, tasks.current?.action);
  /** The open task's parts (task-phases spec §6); none without phases (D0). */
  const taskPhases = actionPhases(state, tasks.current?.action);
  const currentPhase = taskPhases.find((p) => p.id === tasks.current?.phase);
  // A part may allow fewer modes, or none (modes spec §7): the bar lists only those, and hides with none.
  const barModes =
    taskPhases.length > 0 ? taskModes.filter((m) => phaseModesOf(taskModes.map((x) => x.id), currentPhase).includes(m.id)) : taskModes;
  /** An action with a time box: the start waits for "How long?" (no model call before it). */
  const [timePick, setTimePick] = useState<{ text: string; options: SendOptions } | null>(null);
  /** The last phase move, Finish or time box control was refused or failed (shown until the next one or a message). */
  const [phaseFailed, setPhaseFailed] = useState(false);
  /** A phase move or Finish is on its way: the stepper waits for its answer. */
  const [phasing, setPhasing] = useState(false);
  const timeRef = useRef<HTMLDivElement>(null);
  /** A turn the app starts on its own (a phase change, the wrap-up): draws its line and its turn. Set each render. */
  const tookTurn = useRef<(n: TaskTurnNotice) => void>(() => {});
  const modeLabel = (id: string) => (state.modes && Object.hasOwn(state.modes, id) ? state.modes[id].label : id);

  useEffect(() => {
    client.loadChat().then(
      ({ entries, switchedFrom, live }) => {
        dispatch({ type: "loaded", entries });
        // Board mode: the task's turn already runs; its user line is in `entries`, its events so far come again.
        if (live) {
          dispatch({ type: "resume", at: live.user.at });
          for (const e of live.events) dispatch(e.type === "done" ? { ...e, task: openTask.current } : e);
        }
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
    const offModes = client.onModeSwitch((s) => tookSwitch.current(s));
    const offTurns = client.onTaskTurn((n) => tookTurn.current(n));
    // The harness's own UI may open a document (`client.openDocument`): listened to from the start. Its path is
    // untrusted input, so only a string opens the reader (which checks it again), and only a string anchor is kept.
    const offDocs = client.onOpenDocument((p, anchor) => {
      if (typeof p === "string" && p) showReader({ path: p, ...(typeof anchor === "string" && anchor ? { anchor } : {}) });
    });
    return () => {
      offTasks();
      offEvents();
      offModes();
      offTurns();
      offDocs();
    };
  }, [client]);

  const setFocusMode = useCallback(
    (on: boolean, path?: string) => {
      const was = focusRef.current;
      focusRef.current = on;
      setFocus(on);
      client.focus.set(on && path ? { on: true, path } : { on: false });
      if (!on && was) {
        const line = pausedSummary(t, paused.current);
        paused.current = NO_PAUSED;
        if (line) {
          dispatch({ type: "notice", text: line, at: new Date().toISOString() });
          setNotice(line);
          setAnnouncement(line);
        }
      }
    },
    [client, t],
  );
  // `client.documents.focus(path)` from a harness view: only where the review exists (D0), never on the setup screen.
  useEffect(
    () =>
      client.documents.onFocus((p) => {
        if (!state.review || slimRef.current || typeof p !== "string" || !p) return;
        showReader({ path: p });
        setFocusMode(true, p);
      }),
    [client, state.review, showReader, setFocusMode],
  );

  // Flow mode, once the conversation and the tasks are known: a task still open shows its own entries.
  useEffect(() => {
    if (!flow || placed.current || !loaded || !tasksLoaded) return;
    placed.current = true;
    const id = tasks.current?.id;
    // Slim: only the interview's own task is shown.
    if (!id || (slim && tasks.current?.action !== slim.action)) return;
    const first = chat.entries.findIndex((e) => e.task === id);
    setSince(first >= 0 ? first : chat.entries.length);
  }, [flow, loaded, tasksLoaded, tasks, chat.entries]);

  useEffect(() => {
    if (!chat.live) busy.current = false;
  }, [chat.live]);

  // Drafts of questions that can't come back go. Only once the tasks are known: before that `tasks` is empty, and
  // the chat drawn again (Home, Settings) would lose every draft.
  const taskId = tasks.current?.id;
  const pendingInput = tasks.current?.pendingInput;
  useEffect(() => {
    if (tasksLoaded && state.inputs) pruneDrafts(taskId, pendingInput);
  }, [tasksLoaded, state.inputs, taskId, pendingInput]);

  // The pre-flight question gets focus on its safe answer ("Not now") and comes into view.
  const asking = pending !== null;
  useEffect(() => {
    if (!asking) return;
    preflightRef.current?.scrollIntoView?.({ block: "nearest" });
    notNowRef.current?.focus();
  }, [asking]);

  // The tier question takes focus on its safe answer ("Not now"), like the pre-flight one; the "ask" picker on its
  // first mode.
  const askingTier = tierAsk !== null;
  useEffect(() => {
    if (!askingTier) return;
    tierRef.current?.scrollIntoView?.({ block: "nearest" });
    tierNotNowRef.current?.focus();
  }, [askingTier]);
  const askingMode = askPick !== null;
  useEffect(() => {
    if (!askingMode) return;
    askRef.current?.scrollIntoView?.({ block: "nearest" });
    askRef.current?.querySelector<HTMLButtonElement>(".hh-mode-list button")?.focus();
  }, [askingMode]);
  const askingTime = timePick !== null;
  useEffect(() => {
    if (!askingTime) return;
    timeRef.current?.scrollIntoView?.({ block: "nearest" });
    timeRef.current?.querySelector<HTMLButtonElement>(".hh-mode-list button")?.focus();
  }, [askingTime]);

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
      if (focusRef.current) {
        // Focus mode holds the turn's end: no composer focus, nothing read out; it is counted for the summary.
        // The task's "waiting" comes after `done` (the note is saved first): it is counted below, on its own.
        paused.current = countPaused(paused.current, { quota: chat.entries.at(-1)?.error?.code === "out-of-quota" });
      } else {
        setAnnouncement(markdownToPlain(chat.entries.findLast((e) => e.role === "assistant" && isReply(e))?.text ?? "", (id) => citationsRef.current?.known?.(id)));
        inputRef.current?.focus();
      }
      client.getUsage().then((u) => setEstimates(u.estimates), () => {});
      if (!chat.entries.findLast(isReply)?.error) onTurnOk?.();
    }
    wasLive.current = Boolean(chat.live);
  }, [chat.live, chat.entries, t, client, onTurnOk]);

  // The task waiting for the person while in focus mode waits for the summary too.
  const taskStatus = tasks.current?.status;
  useEffect(() => {
    if (focusRef.current && taskStatus === "waiting") paused.current = countPaused(paused.current, { waiting: true });
  }, [taskStatus]);
  // A phase proposal while in focus mode waits for the summary.
  const proposal = tasks.current?.phaseProposal;
  useEffect(() => {
    if (focusRef.current && proposal) paused.current = countPaused(paused.current, { proposal: true });
  }, [proposal?.to, proposal?.reason]);

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

  /** The latest `send`, for code that resumes after an await. */
  const sendRef = useRef<typeof send>(() => false);
  /** True when the message was sent, or is waiting for the user to confirm a heavy action. */
  /** Nothing in the way of a send: no turn, no pre-flight, no open "how to work" or "how long" question. */
  const canSend = (options: SendOptions = {}, confirmed = false): boolean =>
    !blocked() && !(pending && !confirmed) && !(askPick && !options.mode) && !(timePick && options.timeBox === undefined);
  const send = (text: string, options: SendOptions = {}, confirmed = false): boolean => {
    const message = text.trim();
    if (!message || !canSend(options, confirmed)) return false;
    // Slim: only the interview runs here, never a free question or another action's task.
    if (slim && (options.action ? options.action !== slim.action : tasks.current?.action !== slim.action)) return false;
    // A `required` action needs an open scope (spec §3.3); the main process would refuse it. One that names its scope (a
    // job's needs-you Start) has one.
    if (options.action && state.scopes && state.actions[options.action]?.scope !== "none" && !openScope && options.scope === undefined) {
      const text = t("scopes.pickFirst", { label: state.scopes.label });
      dispatch({ type: "notice", text, at: new Date().toISOString() });
      setNotice(text);
      return false;
    }
    // An action with a time box (task-phases spec §5): the person picks how long before anything is sent. It comes
    // before the mode question; each answer goes along with the next.
    if (
      options.action &&
      options.timeBox === undefined &&
      Object.hasOwn(state.actions, options.action) &&
      state.actions[options.action].timeBox
    ) {
      questionOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setTimePick({ text: message, options });
      return true;
    }
    // `defaultMode: "ask"` (task-modes spec §3): the person picks how to work before anything is sent.
    if (
      options.action &&
      !options.mode &&
      Object.hasOwn(state.actions, options.action) &&
      state.actions[options.action].defaultMode === "ask" &&
      actionModes(state, options.action).length > 0
    ) {
      questionOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setAskPick({ text: message, options });
      return true;
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
    lastAnswer.current = false;
    lastMode.current = null;
    setPickFailed(false);
    setModeFailed(false);
    setPhaseFailed(false);
    if (flow && (options.action || !tasks.current)) showNewTask();
    dispatch({ type: "user", text: message, at: new Date().toISOString(), ...(options.action ? { action: options.action } : {}) });
    lastSend.current = { text: message, options };
    client.send(message, options).catch(failTurn);
    inputRef.current?.focus();
    return true;
  };
  sendRef.current = send;

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
    // Slim: a pick never moves the interview to another action (its task would show on the setup screen).
    if (slim && target && target !== slim.action) return false;
    if (!confirmed && target) {
      const check = preflight(state.actions[target]?.cost, chat.limits, estimates[target]);
      if (check) {
        openPreflight({ kind: "choose", action: target, check, option, task });
        return false;
      }
    }
    stick.current = true;
    lastPick.current = { option, task };
    lastAnswer.current = false;
    lastMode.current = null;
    setPickFailed(false);
    setModeFailed(false);
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

  /**
   * The person picks a mode for task `task` (task-modes spec §5). Above the task's tier, the question comes first;
   * `belowTier` is its answer. True only when the switch was sent. A taken switch is drawn by `tookSwitch`.
   */
  const chooseMode = (mode: string, task: string | undefined, belowTier?: ModeChoice["belowTier"]): boolean => {
    if (blocked() || pending) return false;
    const current = tasks.current;
    if (!task || task !== current?.id || current.status !== "waiting" || mode === current.mode) return false;
    const view = actionModes(state, current.action).find((m) => m.id === mode);
    if (!view) return false;
    if (!belowTier && view.minTier && current.tier && tierBelow(current.tier, view.minTier)) {
      openTier({ mode, task, required: view.minTier, current: current.tier });
      return false;
    }
    busy.current = true;
    lastPick.current = null;
    lastAnswer.current = false;
    lastMode.current = { mode, task, ...(belowTier ? { belowTier } : {}) };
    setPickFailed(false);
    setModeFailed(false);
    const failed = () => {
      busy.current = false;
      setModeFailed(true);
      // The blocks are drawn afresh, so the mode can be picked again.
      setPickResets((n) => n + 1);
    };
    client.chooseMode(mode, belowTier ? { belowTier } : {}).then((r) => {
      if (r.ok) {
        // "turn" and "new-task" run on (see `tookSwitch`); "quiet" and "same" run nothing: the tasks view brings the mode.
        if (r.switched === "same") busy.current = false;
        return;
      }
      if (r.reason === "tier" && r.required && r.current) {
        busy.current = false;
        openTier({ mode, task, required: r.required, current: r.current });
      } else failed();
    }, failed);
    return true;
  };
  /**
   * A switch was taken, whoever asked (this window or the harness's own UI): a turn in the same task shows its
   * "Switched to" line and the agent's answer; a new task goes on screen under its action's label (its own chat).
   */
  tookSwitch.current = (s: ModeSwitch) => {
    const current = tasks.current;
    // A question still open is about the task as it was: answering it now would switch again.
    closeQuestions();
    if (s.switched === "quiet") {
      busy.current = false;
      return;
    }
    busy.current = true;
    stick.current = true;
    pinNext.current = true;
    lastPick.current = null;
    lastAnswer.current = false;
    // A switch the harness's UI started: Try again picks it again too.
    if (current && lastMode.current?.mode !== s.mode) lastMode.current = { mode: s.mode, task: current.id };
    const at = new Date().toISOString();
    if (s.switched === "turn") {
      dispatch({ type: "user", text: t("modes.switched", { mode: modeLabel(s.mode) }), at, mode: s.mode });
    } else {
      showNewTask();
      if (current?.action) dispatch({ type: "user", text: labelOf(current.action), at, action: current.action });
    }
  };
  /** A question still open (the tier, "ask", "How long?") is about the task as it was: it closes unanswered. */
  const closeQuestions = () => {
    if (!tierAsk && !askPick && !timePick) return;
    setTierAsk(null);
    setAskPick(null);
    setTimePick(null);
    questionOpener.current = null;
    inputRef.current?.focus();
  };
  /**
   * A turn the app starts on its own is coming (task-phases spec §4.4, §5): a phase change (the agent's, the time
   * box's, or one asked from the harness's own UI) or the wrap-up. Its line goes first, then its events.
   */
  tookTurn.current = (n: TaskTurnNotice) => {
    if (n.task !== tasks.current?.id) return;
    closeQuestions();
    busy.current = true;
    stick.current = true;
    pinNext.current = true;
    lastPick.current = null;
    lastAnswer.current = false;
    lastMode.current = null;
    setPhaseFailed(false);
    const at = new Date().toISOString();
    // "Add now" (context-panel spec §4.1): the person's line names the file, as the chat log keeps it.
    if (n.kind === "context") {
      dispatch({ type: "user", text: t("context.addLine", { path: n.path ?? "" }), at });
      return;
    }
    if (n.kind === "wrap-up") {
      dispatch({ type: "user", text: t("phases.wrapUpLine"), at, timeUp: true });
      return;
    }
    const label = taskPhases.find((p) => p.id === n.phase)?.label ?? n.phase ?? "";
    dispatch({ type: "user", text: `— ${label} —`, at, ...(n.phase ? { phase: n.phase } : {}) });
  };
  /** The tasks as they are now: a Finish may have been stopped, a move may have changed nothing on screen. */
  const rereadTasks = () => client.getTasks().then(setTasks, () => {});
  /** Runs one of the stepper's calls: the stepper waits for it, and a refusal or a failure shows a short error. */
  const taskCall = (call: () => Promise<boolean>) => {
    setPhaseFailed(false);
    setPhasing(true);
    call().then(
      (ok) => {
        setPhasing(false);
        if (!ok) setPhaseFailed(true);
        void rereadTasks();
      },
      () => {
        setPhasing(false);
        setPhaseFailed(true);
      },
    );
  };
  /** The person moves the task (the stepper, or the proposal's button); only while it waits and nothing runs. */
  const pickPhase = (id: string) => {
    const task = tasks.current;
    if (!task || blocked() || pending || task.status !== "waiting") return;
    taskCall(() => client.setPhase(task.id, id).then((r) => r.ok));
  };
  /** Finish: the core closing turn. False back means it was stopped and the task stays open. Says whether it started.
   *  The same guards as the stepper's Finish: a second click or one during a phase move does nothing. */
  const finishTask = (): boolean => {
    if (!tasks.current || blocked() || phasing || pending || tasks.current.status !== "waiting") return false;
    // A stopped closing turn is not a failure: the task simply stays open, as the tasks read again show.
    taskCall(() => client.finishTask().then(() => true));
    return true;
  };
  const openTier = (ask: { mode: string; task: string; required: Tier; current: Tier }) => {
    questionOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTierAsk(ask);
  };
  /** Focus goes back to whatever opened the question, else to the composer. */
  const refocus = () => {
    const opener = questionOpener.current;
    questionOpener.current = null;
    if (opener?.isConnected) opener.focus();
    else inputRef.current?.focus();
  };
  /** The tier question's answer, or "Not now" (Escape): the question closes first. */
  const answerTier = (belowTier?: ModeChoice["belowTier"]) => {
    const ask = tierAsk;
    setTierAsk(null);
    refocus();
    if (ask && belowTier) chooseMode(ask.mode, ask.task, belowTier);
  };
  /** "Not now" (Escape) on "How long?": nothing is sent. */
  const closeTime = () => {
    setTimePick(null);
    refocus();
  };
  /** "How long?"'s answers for `action`: its options and "No limit" (null), the action's default first. */
  const timeChoices = (action: string | undefined): (number | null)[] => {
    const box = action !== undefined && Object.hasOwn(state.actions, action) ? state.actions[action].timeBox : undefined;
    if (!box) return [];
    const all = [...box.options, null];
    const first = box.default ?? null;
    return [first, ...all.filter((m) => m !== first)];
  };
  /** "Not now" (Escape) on the "ask" picker: nothing is sent. */
  const closeAsk = () => {
    setAskPick(null);
    refocus();
  };

  /**
   * An answer to an input block (input-blocks spec §4). A refusal comes back with its errors for the form; a taken
   * answer marks its block, shows the person's line and the turn it starts.
   */
  const respondTo = async (blockId: string, value: Record<string, unknown>): Promise<RespondResult> => {
    if (blocked() || pending) return { ok: false, reason: "busy", errors: [{ path: "", message: t("input.wait") }] };
    busy.current = true;
    let r: RespondResult;
    try {
      r = await client.respond(blockId, value);
    } catch {
      busy.current = false;
      return { ok: false, reason: "failed", errors: [{ path: "", message: t("input.failed") }] };
    }
    if (!r.ok) {
      busy.current = false;
      if (r.reason === "stale") return { ...r, errors: [{ path: "", message: t("input.closed") }] };
      if (r.reason === "stopped") return { ...r, errors: [{ path: "", message: t("input.stopped") }] };
      return r;
    }
    stick.current = true;
    lastPick.current = null;
    lastAnswer.current = true;
    lastMode.current = null;
    setPickFailed(false);
    setModeFailed(false);
    dispatch({ type: "answered", answer: { blockId, value: r.value, answeredAt: r.answeredAt } });
    dispatch({ type: "user", text: r.display, at: r.answeredAt });
    return r;
  };

  const startTopic = (id: string) => void send(labelOf(id), { action: id });
  /** A needs-you job's action (part 3): only a declared one, in the job's scope when it has one. */
  const startFromInbox = (id: string, scope: string | null): boolean =>
    Object.hasOwn(state.actions, id) ? send(labelOf(id), { action: id, ...(scope !== null ? { scope } : {}) }) : false;
  // Every commit: the latest start, set after an old view's cleanup (a key change) so it is never left null.
  useLayoutEffect(() => {
    if (!startRef) return;
    startRef.current = startFromInbox;
    return () => {
      startRef.current = null;
    };
  });
  useLayoutEffect(() => {
    if (!shellRef) return;
    shellRef.current = { refill: refillDraft, start: startFromInbox, openPanel };
    return () => {
      shellRef.current = null;
    };
  });
  /** The task's next part, while it waits and nothing runs (the stepper's own guards). */
  const nextPartOf = (): { id: string; label: string } | null => {
    const task = tasks.current;
    if (!task || task.status !== "waiting" || blocked() || pending || phasing) return null;
    const i = taskPhases.findIndex((p) => p.id === task.phase);
    const next = i >= 0 ? taskPhases[i + 1] : undefined;
    return next ? { id: next.id, label: next.label } : null;
  };
  /**
   * An action from search (§6); false when it no longer applies (the palette's row was read earlier). One side panel at
   * a time (the History button's own steps). Nothing the person typed is sent; the next part starts its own turn, as the
   * stepper's button does.
   */
  const runCommand = (command: SearchCommandId, arg?: string): boolean => {
    switch (command) {
      case "new-question":
        // Focus on the composer, with whatever the person had typed still there (an unsent draft is kept, never
        // cleared): the question is theirs to write and send.
        if (tasks.current) return false;
        closeReader();
        setTimelineFile(null);
        setShowHistory(false);
        setNotesPanel(null);
        setContextOpen(false);
        requestAnimationFrame(() => inputRef.current?.focus());
        return true;
      case "open-history":
        if (slim) return false;
        closeReader();
        setContextOpen(false);
        setNotesPanel(null);
        setTimelineFile(null);
        setHistoryTask(undefined);
        setShowHistory(true);
        return true;
      case "open-notes":
        if (slim) return false;
        closeReader();
        setContextOpen(false);
        setTimelineFile(null);
        setShowHistory(false);
        setNotesPanel({});
        return true;
      case "open-context":
        // The open task's context: with no task the panel has nothing to show (and would stay open for the next one).
        if (slim || !tasks.current) return false;
        openContext();
        return true;
      case "next-part": {
        // Only the part the row named: once the task moved on, the next part is another one.
        const next = nextPartOf();
        if (!next || next.id !== arg) return false;
        pickPhase(next.id);
        return true;
      }
      case "stop-turn":
        if (!chat.live && !closing && !checkpoint) return false;
        void client.cancel();
        return true;
      case "open-settings":
      case "switch-scope":
        // HarnessApp's.
        return false;
    }
  };
  /** A search result or question (search spec §3, §5.4); false when it can't run here. */
  const runSearchIntent = (intent: SearchIntent): boolean => {
    switch (intent.kind) {
      case "action":
        if (!Object.hasOwn(state.actions, intent.action)) return false;
        startTopic(intent.action);
        return true;
      case "open-task":
        if (state.parallel) void client.tasks.focus(intent.task).catch(() => undefined);
        inputRef.current?.focus();
        return true;
      case "history":
        if (slim) return false;
        closeReader();
        setContextOpen(false);
        setNotesPanel(null);
        setTimelineFile(null);
        setHistoryTask(intent.task);
        setShowHistory(true);
        return true;
      case "chat": {
        // On screen: scroll there and highlight it for 2 s. Otherwise its task's row in History (plan deviation 11).
        const el = [...document.querySelectorAll<HTMLElement>("[data-entry]")].find((e) => e.dataset.entry === intent.entry);
        if (el) {
          el.scrollIntoView?.({ block: "center" });
          el.classList.add("hh-search-flash");
          setTimeout(() => el.classList.remove("hh-search-flash"), 2000);
          return true;
        }
        return intent.task ? runSearchIntent({ kind: "history", task: intent.task }) : false;
      }
      case "document":
        if (slim) return false;
        showReader({ path: intent.path, ...(intent.anchor ? { anchor: intent.anchor } : {}) });
        return true;
      case "timeline":
        if (slim) return false;
        closeReader();
        setTimelineFile(intent.path);
        return true;
      case "draft":
        // D3: the text waits in the composer; nothing is sent until the person sends it.
        setDraft(intent.text);
        requestAnimationFrame(() => inputRef.current?.focus());
        return true;
      case "record":
        // The harness view's own handler (client.search.onOpenRecord); none listening: nothing opens (§3).
        return client.search.openRecord(intent.collection, intent.key, intent.scope);
      case "panel":
        // Picked before the first surface read came back (from Home): it waits for that read, then opens or drops.
        if (surface === null && pluginsOn) {
          pendingPanel.current = intent;
          return true;
        }
        // A row read before its plugin stopped (or dropped the panel) opens nothing, now or when the panel comes back.
        if (!surfaceCtx || !surfaceCtx.surface.panels.some((p) => p.plugin === intent.plugin && p.id === intent.panel)) return false;
        openPanel(intent.plugin, intent.panel, intent.focus);
        return true;
      case "setting":
        // HarnessApp opens Settings itself; never reaches here.
        return false;
      case "command":
        return runCommand(intent.command, intent.arg);
    }
  };
  /** A plugin record's panel picked while the surface was still loading; checked once, when it has loaded. */
  const pendingPanel = useRef<Extract<SearchIntent, { kind: "panel" }> | null>(null);
  useEffect(() => {
    const intent = pendingPanel.current;
    if (!intent || surface === null) return;
    pendingPanel.current = null;
    if (surface.panels.some((p) => p.plugin === intent.plugin && p.id === intent.panel)) openPanel(intent.plugin, intent.panel, intent.focus);
  }, [surface, openPanel]);
  useLayoutEffect(() => {
    if (searchContextRef) {
      searchContextRef.current = () => ({ taskOpen: Boolean(tasks.current), turnRunning: Boolean(chat.live) || closing || checkpoint, nextPart: nextPartOf(), panels: !slim });
    }
    if (searchRef) searchRef.current = runSearchIntent;
    return () => {
      if (searchRef) searchRef.current = null;
      if (searchContextRef) searchContextRef.current = null;
    };
  });
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
  // A notice the app added after a reply (a conflict) never takes the reply's place: its blocks stay answerable.
  const lastAssistant = chat.entries.findLast((e) => e.role === "assistant" && isReply(e));
  /**
   * A block answer's free text before it goes (spec §4.1): `card` holds the form, anything else sends it. The same
   * text sent again while its card waits goes as is (the card leaves as sent anyway); a composer review in flight
   * goes first, so the answer is never held behind it.
   */
  const reviewAnswer = async (text: string, hold: AnswerHold): Promise<{ kind: "send" } | { kind: "card"; drop: () => void }> => {
    const held = answerHold.current;
    const card = sidekick?.card;
    if (held && card?.id === held.cardId && card.prompt === text) {
      answerHold.current = null;
      resolveCard(card, "sent-anyway");
      return { kind: "send" };
    }
    if (reviewing) return { kind: "send" };
    const seq = ++answerSeq.current;
    const composerSeq = reviewSeq.current;
    answerRun.current = { seq, composerSeq };
    const r: SidekickReview = await client.sidekick.review({ text, block: true }).catch(() => ({ kind: "error" }) as const);
    if (answerRun.current?.seq === seq) answerRun.current = null;
    // Stopped by Send now (the form already sent), or replaced by a composer review in main: a card that came anyway
    // is about an answer that went, and leaves as sent anyway.
    if (seq !== answerSeq.current || composerSeq !== reviewSeq.current || r.kind !== "card") {
      if (r.kind === "card") void client.sidekick.resolve(r.card.id, "sent-anyway").catch(() => undefined);
      return { kind: "send" };
    }
    const cardId = r.card.id;
    answerHold.current = { cardId, hold };
    setSkOpen(true);
    setSkView("sidekick");
    // Skip on the held answer: the card leaves with it.
    const drop = () => {
      if (answerHold.current?.cardId !== cardId) return;
      answerHold.current = null;
      void client.sidekick.resolve(cardId, "dismissed").catch(() => undefined);
    };
    return { kind: "card", drop };
  };
  /** Send now on the answer form: stops its review in main, never a composer review that started since. */
  const cancelAnswerReview = () => {
    const run = answerRun.current;
    answerRun.current = null;
    answerSeq.current++;
    if (run && run.composerSeq === reviewSeq.current) void client.sidekick.cancelReview().catch(() => undefined);
  };
  /** The form a block card holds, while that card is the live one. */
  const heldBy = (card: SidekickCard): AnswerHold | null => {
    const held = answerHold.current;
    if (!held || held.cardId !== card.id) return null;
    answerHold.current = null;
    return held.hold;
  };
  const inputs: InputContext | undefined = state.inputs
    ? {
        specs: state.inputs,
        ...(tasks.current?.pendingInput ? { pending: tasks.current.pendingInput } : {}),
        waiting: tasks.current?.status === "waiting",
        ready: tasks.current?.status === "waiting" && !blocked() && !pending,
        respond: respondTo,
        // D0: without Sidekick (or with the review off) the form sends as before.
        ...(reviewOn && sidekick ? { review: reviewAnswer, cancelReview: cancelAnswerReview, reviewWait: sidekick.settings.wait } : {}),
      }
    : undefined;
  const blockActions = (active: boolean, task?: string, entryId: string | null = null): BlockActions => ({
    respond: sendFromHarness,
    choose: (o) => choose(o, task),
    open: openFile,
    reveal: revealFile,
    active,
    ...(inputs ? { inputs, answerOf: (ref: string) => findAnswer(chat.entries, entryId, ref) } : {}),
    ...(state.modes ? modeActions(task) : {}),
  });
  /**
   * Task modes for a block of task `task`: the open task's blocks may switch it, among its action's modes (none: no
   * modes at all, D0); a block of another task only draws, disabled, among every mode the harness declares.
   */
  const modeActions = (task: string | undefined): { chooseMode?: BlockActions["chooseMode"]; modes?: BlockActions["modes"] } => {
    const views = state.modes ?? {};
    if (task === undefined || task !== tasks.current?.id) return { modes: { views, allowed: Object.keys(views) } };
    // Only the modes the current part allows (modes spec §7): a block from an earlier part can't pick another.
    const allowed = barModes.map((m) => m.id);
    if (allowed.length === 0) return {};
    return {
      chooseMode: (mode: string) => chooseMode(mode, task),
      modes: { views, allowed, ...(tasks.current.mode ? { current: tasks.current.mode } : {}) },
    };
  };
  /** The entry's answer belongs to the task waiting now: its `choices` block may act. */
  const ofWaitingTask = (task: string | undefined) => task !== undefined && task === tasks.current?.id && tasks.current.status === "waiting";
  /**
   * Try again: a failed pick of the still-open task is picked again; a failed answer has none (its question opens
   * again, to be sent through `respond` with its JSON); anything else resends the last message.
   */
  const retry = (): (() => void) | undefined => {
    if (lastAnswer.current) return undefined;
    const mode = lastMode.current;
    if (mode && mode.task === tasks.current?.id) return () => void chooseMode(mode.mode, mode.task, mode.belowTier);
    // A phase change's or the wrap-up's line is the app's, not the person's: nothing to resend (task-phases spec §4.4).
    if (lastUser?.phase || lastUser?.timeUp) return undefined;
    // A switch's line is never resent as a message: the same mode is picked again.
    if (lastUser?.mode) {
      const id = tasks.current?.id;
      const again = lastUser.mode;
      return id ? () => void chooseMode(again, id) : undefined;
    }
    const pick = lastPick.current;
    if (pick && pick.task === tasks.current?.id) return () => void choose(pick.option, pick.task);
    if (lastUser) {
      // The same message keeps what was answered before it went (a time box picked in "How long?", a mode): never asked twice.
      const sent = lastSend.current;
      const options = sent && sent.text === lastUser.text && sent.options.action === lastUser.action ? sent.options : lastUser.action ? { action: lastUser.action } : {};
      return () => void send(lastUser.text, options);
    }
    return undefined;
  };
  /** Enter: a review first when Sidekick is on (spec §4.1); `force` is ⌥⏎ or Review. Enter while reviewing waits. */
  const submit = async (text: string, force = false) => {
    // A send that would be refused runs no paid review first.
    if (reviewing || !canSend()) return;
    if (!reviewOn || !text.trim()) {
      sendTyped(text);
      return;
    }
    const seq = ++reviewSeq.current;
    const wait = sidekick.settings.wait;
    setReviewing({ until: wait === "always" ? null : Date.now() + wait * 1000 });
    // Material in the open scope goes with the prompt: the missing-context flag stays quiet.
    const scope = state.material ? materialScope : null;
    const attached = scope ? await client.material.list(scope).then((v) => (v?.sources.length ?? 0) > 0, () => false) : false;
    const r: SidekickReview =
      seq !== reviewSeq.current
        ? { kind: "cancelled" }
        : await client.sidekick
            .review({ text, ...(force ? { force: true } : {}), ...(attached ? { attached: true } : {}) })
            .catch(() => ({ kind: "error" }) as const);
    // Superseded: the person sent at once, or a newer review replaced this one.
    if (seq !== reviewSeq.current) return;
    setReviewing(null);
    if (r.kind === "card") {
      setSkOpen(true);
      setSkView("sidekick");
      return;
    }
    // Anything else, a `cancelled` from main included (Sidekick turned off mid-review), sends as typed. The latest
    // `send`: a pre-flight or a turn that opened during the review is seen.
    if (sendRef.current(text)) setDraft("");
  };
  /** ⌘⏎ / Ctrl⏎: send now, cancelling a running review. */
  const sendNow = (text: string) => {
    if (reviewing) {
      reviewSeq.current++;
      setReviewing(null);
      void client.sidekick.cancelReview().catch(() => undefined);
    }
    sendTyped(text);
  };
  /** Sends the draft as typed; a card still waiting leaves as sent anyway (spec §4.1: never about a prompt already sent). */
  const sendTyped = (text: string) => {
    if (!send(text)) return;
    setDraft("");
    if (sidekick?.card) resolveCard(sidekick.card, "sent-anyway");
  };
  const resolveCard = (card: SidekickCard, outcome: "used" | "edited" | "sent-anyway") => {
    // A card that was sent keeps its queued asks for later; Edit sends nothing, and the next review finds them again.
    if (outcome !== "edited" && card.id === skCard && liveQueued.length > 0) {
      const keep = liveQueued;
      setLater((l) => [...keep, ...l.filter((q) => !keep.some((k) => k.key === q.key))]);
    }
    void client.sidekick.resolve(card.id, outcome).catch(() => undefined);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit(draft);
  };
  const onScroll = () => {
    const el = chatRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD;
  };
  const last = chat.entries.findLast(isReply);
  const lastUser = chat.entries.findLast((e) => e.role === "user");
  const backgroundError = engineProblem ? problemError(engineProblem) : null;
  const shown = !flow ? chat.entries : since === null ? [] : chat.entries.slice(since);
  const liveEntry: ChatEntry | null = chat.live
    ? { id: chat.live.id, role: "assistant", text: chat.live.text, blocks: chat.live.blocks, parts: chat.live.parts, activities: [], at: "", ...(chat.live.tools ? { tools: chat.live.tools } : {}) }
    : null;
  const showStart = flow && since === null && !chat.live;
  // The start view reads from its top (its first topics), not from the end the conversation sticks to; sending
  // anything sticks to the end again.
  useLayoutEffect(() => {
    if (!showStart) return;
    stick.current = false;
    if (chatRef.current) chatRef.current.scrollTop = 0;
  }, [showStart]);
  // The cards on screen, checked once per change of the list, when the window gets focus back, and when the reader
  // finds a document gone: a moved or deleted document's card is struck through.
  const cardKey = useMemo(
    () =>
      (!flow ? chat.entries : since === null ? [] : chat.entries.slice(since))
        .flatMap((e) => (e.role === "assistant" && e.documents !== undefined ? cleanDocumentCards(e.documents).map((d) => d.path) : []))
        .join("\n"),
    [chat.entries, flow, since],
  );
  useEffect(() => {
    // D0: no cards, no call, no listener.
    if (!cardKey) return;
    let live = true;
    const paths = cardKey.split("\n");
    client.documentsExist(paths).then(
      (found) => live && setMissingDocs(new Set(paths.filter((_, i) => found[i] !== true))),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [client, cardKey, docsCheck]);
  // Review chips (review spec §6.1): the cards' summaries, asked again when a review changes. D0: a harness that can't
  // review, or no cards: no call, no listener.
  const [reviewSummaries, setReviewSummaries] = useState<ReadonlyMap<string, ReviewSummary | null> | undefined>(undefined);
  const [reviewTick, setReviewTick] = useState(0);
  const canReview = state.review === true;
  useEffect(() => {
    if (!canReview || !cardKey) return;
    return client.documents.onChange(() => setReviewTick((n) => n + 1));
  }, [client, canReview, cardKey]);
  useEffect(() => {
    if (!canReview || !cardKey) return;
    let live = true;
    const paths = cardKey.split("\n");
    client.documents.summaries(paths).then(
      (s) => live && setReviewSummaries(new Map(paths.map((p, i) => [p, s[i] ?? null]))),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [client, canReview, cardKey, reviewTick, docsCheck]);
  useEffect(() => {
    if (!cardKey) return;
    window.addEventListener("focus", recheckDocs);
    return () => window.removeEventListener("focus", recheckDocs);
  }, [cardKey, recheckDocs]);
  // Focus goes back once the reader has closed (and the chat shows again, out of full screen): to the card or link
  // that opened it, else to the composer.
  const readerOpen = reader !== null;
  const wasReaderOpen = useRef(false);
  useEffect(() => {
    if (wasReaderOpen.current && !readerOpen) {
      const opener = readerOpener.current;
      readerOpener.current = null;
      if (opener?.isConnected && opener.getAttribute("aria-disabled") !== "true") opener.focus();
      else inputRef.current?.focus();
    }
    wasReaderOpen.current = readerOpen;
  }, [readerOpen]);
  /** The engine's name for an entry's `engine` id, else the configured engine's (the reader's "Written by"). */
  const engineName = (id: unknown): string => state.engines.find((e) => e.id === id)?.name ?? engine;
  const cardsFor = (entry: ChatEntry) => ({
    missing: missingDocs,
    open: (card: DocumentCard) => showReader({ path: card.path, agent: engineName(entry.engine) }),
    ...(canReview && reviewSummaries ? { reviews: reviewSummaries } : {}),
  });
  const saveReaderPrefs = useCallback(
    (p: ReaderPrefs) => {
      setReaderPrefs(p);
      client.saveConfig({ reader: p }).catch(() => undefined);
    },
    [client],
  );
  const closeReader = useCallback(() => {
    setReader(null);
    setReaderFull(false);
    if (focusRef.current) setFocusMode(false);
  }, [setFocusMode]);
  /** One side panel at a time: the reader, the timeline, the History and notes panels close. */
  const openContext = () => {
    const active = document.activeElement;
    contextOpener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    closeReader();
    setTimelineFile(null);
    setShowHistory(false);
    setNotesPanel(null);
    setContextOpen(true);
  };
  /** Close or Escape: focus goes back to the meter that opened the panel (or the meter on screen now). */
  const closeContext = () => {
    setContextOpen(false);
    focusContextOpener();
  };
  /** Focus back on the opener, else the meter on screen, else (the task ended: no meter) the composer. */
  const focusContextOpener = () => {
    const opener = contextOpener.current;
    contextOpener.current = null;
    const target = opener?.isConnected
      ? opener
      : (document.querySelector<HTMLElement>(".hh-ctxp-meter") ?? document.querySelector<HTMLElement>(".hh-composer textarea"));
    target?.focus();
  };
  /** An item of the panel opens like a History link: a `.md` in the reader, anything else in the timeline panel. */
  const openFromContext = (file: string) => {
    setContextOpen(false);
    contextOpener.current = null;
    if (isMarkdownPath(file) && !slim) showReader({ path: file });
    else setTimelineFile(file);
  };
  // The panel belongs to the open task: it closes when the task ends. Ending, or another task's panel taking its
  // place (its key), unmounts what had focus: focus goes back to the meter rather than dropping to the page.
  const contextTask = tasks.current?.id;
  const contextShown = useRef(false);
  contextShown.current = contextOpen;
  useEffect(() => {
    if (!contextTask) setContextOpen(false);
    const active = document.activeElement;
    if (contextShown.current && (!active || active === document.body)) focusContextOpener();
  }, [contextTask]);
  // A link followed in focus mode: the harness's view hears which document is read now.
  const readerPath = reader?.path;
  useEffect(() => {
    if (focusRef.current && readerPath) client.focus.set({ on: true, path: readerPath });
  }, [client, readerPath]);
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

  // One `main` per page: the setup screen has its own.
  const Main = slim ? "div" : "main";
  /** Slim: the interview's task isn't the open one (not started, closed, or another task is open). */
  const slimStart = slim !== undefined && loaded && tasksLoaded && !chat.live && tasks.current?.action !== slim.action;
  /** Slim: the composer only for the interview's own task (or a turn running), never before it is known. */
  const composer = !slim || Boolean(chat.live) || tasks.current?.action === slim.action;
  // Material spec §11: the scope's material panel, only when the harness takes material (D0) and a scope is open.
  const materialScope = state.material ? (state.scopes ? openScope : "main") : null;
  // Citations `[[frag:<id>]]` in the chat (§9): drawn only with material and a scope (D0); one label lookup per id.
  // Keyed by whether there is material, not by the object: every state refresh brings a new one, and the cache stays.
  const withMaterial = Boolean(state.material);
  /** One resolver per scope, each with its own label cache; null without material (D0). */
  const citationsFor = useMemo<((scope: string) => CitationResolver) | null>(() => {
    if (!withMaterial) return null;
    const byScope = new Map<string, CitationResolver>();
    return (scope) => {
      const made = byScope.get(scope);
      if (made) return made;
      const cache = new Map<string, Promise<string | null>>();
      const known = new Map<string, string>();
      const resolver: CitationResolver = {
        label: (id) => {
          let label = cache.get(id);
          if (!label) {
            label = client.material.cite(scope, id).then(
              (r) => r?.label ?? null,
              () => null,
            );
            cache.set(id, label);
            // A fragment not there yet (still converting, or a failed lookup) is asked again next time.
            label.then((l) => {
              if (l === null) cache.delete(id);
              else known.set(id, l);
            });
          }
          return label;
        },
        open: (id) => void client.material.open(scope, id).catch(() => undefined),
        known: (id) => known.get(id),
      };
      byScope.set(scope, resolver);
      return resolver;
    };
  }, [client, withMaterial]);
  /** A citation is resolved in the scope of the task that wrote it when that is known, else in the open scope. */
  const citeScope = (task: string | undefined): string | null =>
    (task !== undefined && task === tasks.current?.id && tasks.current.scope) || materialScope;
  const citationsOf = (task: string | undefined): CitationResolver | null => {
    const scope = citeScope(task);
    return citationsFor && scope ? citationsFor(scope) : null;
  };
  citationsRef.current = citationsOf(tasks.current?.id);
  const Panel = materialPanel ?? MaterialPanel;
  const material =
    state.material && materialScope && !slim ? (
      // Keyed by scope: another scope's panel starts fresh (its form, notices and cards are not this one's).
      <Panel key={materialScope} client={client} scope={materialScope} info={state.material} disabled={blocked() || !loaded} />
    ) : null;
  // The core's Plugins section: only while a running plugin has a panel there (none: the side panel as before, D0).
  const pluginsSection = surfaceCtx && surfaceCtx.surface.panels.some((p) => p.slot === PLUGINS_SLOT) ? <PluginsSection ctx={surfaceCtx} /> : null;
  const hasPluginsSection = pluginsSection !== null;
  const pluginPanelsTo = useRef(onPluginPanels);
  pluginPanelsTo.current = onPluginPanels;
  useEffect(() => {
    pluginPanelsTo.current?.(hasPluginsSection);
  }, [hasPluginsSection]);
  useEffect(() => () => pluginPanelsTo.current?.(false), []);
  // The rail's Notes: the drawer, as search's "Open notes" opens it (one panel at a time). Only a pick made while this
  // view is on screen counts: a remount (another task, back from Home) doesn't reopen it.
  const notesSeen = useRef(notesRequest);
  useEffect(() => {
    if (notesRequest === notesSeen.current || slim) return;
    notesSeen.current = notesRequest;
    closeReader();
    setContextOpen(false);
    setTimelineFile(null);
    setShowHistory(false);
    setNotesPanel({});
  }, [notesRequest]);
  // The rail's Plugins: the section's first panel, opened as a chip opens it (its tab, scrolled into view).
  const pluginsSeen = useRef(pluginsRequest);
  useEffect(() => {
    if (pluginsRequest === pluginsSeen.current) return;
    pluginsSeen.current = pluginsRequest;
    const first = surfaceNow.current?.panels.find((p) => p.slot === PLUGINS_SLOT);
    if (first) openPanel(first.plugin, first.id);
  }, [pluginsRequest, openPanel]);

  const blockedTo = useRef(onBlocked);
  blockedTo.current = onBlocked;
  const blockedSent = useRef<boolean | null>(null);
  // Read after every commit, not in render: `busy` is a ref that an earlier effect clears when the turn ends (no redraw).
  useEffect(() => {
    const now = blocked();
    if (now === blockedSent.current) return;
    blockedSent.current = now;
    blockedTo.current?.(now);
  });
  useEffect(() => () => blockedTo.current?.(false), []);
  /** The open task's name for the breadcrumb (a harness without `parallel` has no task list to read it from). */
  const taskLabel = tasks.current ? (tasks.current.action ? labelOf(tasks.current.action) : t("history.question")) : null;
  const taskLabelTo = useRef(onTaskLabel);
  taskLabelTo.current = onTaskLabel;
  useEffect(() => {
    taskLabelTo.current?.(taskLabel);
  }, [taskLabel]);
  useEffect(() => () => taskLabelTo.current?.(null), []);

  return (
    <DocumentContext.Provider value={documentHost}>
      <div className={slim ? "hh-app hh-app-slim" : "hh-app"}>
        {!slim && (
          <TaskHeader
            title={title ?? taskLabel ?? (startView?.title ? t(startView.title, { ns: "harness" }) : t("rail.tasks"))}
            leading={scopeBar?.(blocked())}
            meters={
              <>
                {/* The context panel's one button. In flow mode the flow side draws the ring, so the pill is text only. */}
                {tasks.current?.context && <ContextMeter {...tasks.current.context} onOpen={openContext} pill ring={!flow} />}
                <UsageMeter engine={engineOption} limits={chat.limits} lastTokens={lastTurnTokens(chat.entries)} />
              </>
            }
            sidekick={
              sidekick && (
                <SidekickToggle
                  on={sidekick.settings.on}
                  label={t(sidekick.settings.on ? "sidekick.toggleOn" : "sidekick.toggleOff")}
                  onToggle={() => {
                    const on = !sidekick.settings.on;
                    void client.sidekick.set(on ? { on, introSeen: true } : { on }).catch(() => undefined);
                    setSkOpen(on);
                  }}
                />
              )
            }
            chips={surfaceCtx && <PluginChips chips={surfaceCtx.surface.chips.filter((c) => c.slot === CHIPS_SLOT)} onOpen={(plugin, panel) => surfaceCtx.open(plugin, panel)} />}
            onHistory={() => {
              // One panel at a time: Escape closes the one on screen.
              setNotesPanel(null);
              setTimelineFile(null);
              setContextOpen(false);
              setShowHistory(true);
            }}
            {...(onNewTask ? { onNewTask } : {})}
          />
        )}
        <div
          className={`hh-body${(reader || contextOpen) && !slim ? " hh-with-reader" : ""}${reader && readerFull && !slim ? " hh-reader-full" : ""}${focus && reader && !slim ? " hh-focus" : ""}`}
        >
          {flow && !slim && (
            <FlowSide
              state={state}
              tasks={tasks}
              disabled={blocked() || !loaded}
              onStart={startTopic}
              onOpenNote={(slug) => {
                setShowHistory(false);
                setTimelineFile(null);
                setContextOpen(false);
                setNotesPanel({ expanded: slug });
              }}
              material={material}
              {...(pluginsSection ? { plugins: pluginsSection } : {})}
            />
          )}
          {/* Without actions there is no flow side panel: the material panel (and the Plugins section) get one of their own. */}
          {!flow && (material || pluginsSection) && (
            <nav className="hh-flow-side" aria-label={material ? t("material.title") : t("plugins.panels.section")}>
              {material}
              {pluginsSection}
            </nav>
          )}
          <Main className="hh-main">
            {taskStrip}
            {/* The task runs without its scope's engine config (hatches spec §5.3): only with enginePresets (D0). */}
            {state.hatches?.enginePresets && !slim && tasks.current?.engineNotice && tasks.current.scope && (
              <EngineNotice client={client} state={state} scope={tasks.current.scope} notice={tasks.current.engineNotice} />
            )}
            {/* A time box without phases (spec §5) still shows its time, its controls and, once time is up, Finish. */}
            {flow && since !== null && tasks.current && (taskPhases.length > 0 || tasks.current.timeBox) && (
              <PhaseStepper
                phases={taskPhases}
                task={tasks.current}
                disabled={blocked() || phasing || pending !== null || tasks.current.status !== "waiting"}
                onPhase={pickPhase}
                onFinish={finishTask}
                onPause={() => taskCall(() => client.pauseTask())}
                onResume={() => taskCall(() => client.resumeTask())}
                onExtend={() => taskCall(() => client.extendTimeBox())}
              />
            )}
            {phaseFailed && (
              <p className="hh-error" role="alert">
                {t("phases.failed")}
              </p>
            )}
            {flow && since !== null && tasks.current && barModes.length > 0 && (
              <ModeBar
                modes={barModes}
                current={tasks.current.mode}
                below={tasks.current.belowMinTier === true}
                disabled={blocked() || phasing || pending !== null || tasks.current.status !== "waiting"}
                onPick={(mode) => void chooseMode(mode, tasks.current?.id)}
              />
            )}
            <section className="hh-chat hh-card hh-conversation" aria-label={t("chat.conversation")} ref={chatRef} onScroll={onScroll}>
              {loadFailed && (
                <p className="hh-error" role="alert">
                  {t("chat.loadError")}
                </p>
              )}
              {/* Tools spec Decision 7: only a harness with tools has `state.tools`, and only crashes put this line here. */}
              {state.tools?.off === TOOLS_OFF_CRASHES && (
                <p className="hh-caption hh-tools-off" role="status">
                  {t("tools.off")}
                </p>
              )}
              {/* The last turn's card already offers the fix for this same problem: one fix button is enough. */}
              {backgroundError && !(isFixable(last?.error) && last?.error?.code === backgroundError.code) && (
                <ErrorCard error={backgroundError} engine={engine} onFix={onFixEngine} />
              )}
              {showStart && !slim && (
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
              {slim && slimStart && (
                <div className="hh-slim-start">
                  <button type="button" className="hh-primary" disabled={blocked()} onClick={() => startTopic(slim.action)}>
                    {t(Object.hasOwn(tasks.actions, slim.action) ? "setupSteps.continueInterview" : "setupSteps.startInterview")}
                  </button>
                </div>
              )}
              {flow && !slim && since !== null && !tasks.current && !chat.live && (
                <button type="button" className="hh-back-topics" onClick={() => setSince(null)}>
                  {t("flow.backToTopics")}
                </button>
              )}
              {/* The running turn is the list's last item, under the id its entry gets: it stays the same element when it ends. */}
              {(liveEntry ? [...shown, liveEntry] : shown).map((entry) => (
                <CitationContext.Provider key={entry.id} value={citationsOf(entry.task)}>
                  <div data-entry={entry.id} data-role={entry.role}>
                    {entry.role === "assistant" && entry.tools !== undefined && <ToolCallLines calls={entry.tools} />}
                    <Message
                      key={pickResets}
                      entry={entry}
                      components={entry === liveEntry || ofWaitingTask(entry.task) ? all : stale}
                      actions={blockActions(entry === lastAssistant && !chat.live && !closing, entry.task, entry === liveEntry ? null : entry.id)}
                      live={entry === liveEntry ? { activities: chat.live!.activities, label: checkpoint ? t("flow.checkpoint") : undefined } : undefined}
                      reveal={entry.id === pacedTurn.current ? (reveal ?? undefined) : undefined}
                      documents={cardsFor(entry)}
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
                </CitationContext.Provider>
              ))}
              {pickFailed && (
                <p className="hh-error" role="alert">
                  {t("choices.failed")}
                </p>
              )}
              {modeFailed && (
                <p className="hh-error" role="alert">
                  {t("modes.failed")}
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
              {tierAsk && (
                <div
                  ref={tierRef}
                  className="hh-confirm"
                  role="alertdialog"
                  aria-labelledby="hh-tier-title"
                  aria-describedby="hh-tier-text"
                  onKeyDown={(e) => {
                    if (e.key !== "Escape") return;
                    e.preventDefault();
                    answerTier();
                  }}
                >
                  <p id="hh-tier-title">
                    <strong className="hh-warn">{t("modes.tierTitle", { mode: modeLabel(tierAsk.mode) })}</strong>
                  </p>
                  <p id="hh-tier-text">
                    {t("modes.tierText", { required: t(`models.tier.${tierAsk.required}`), current: t(`models.tier.${tierAsk.current}`) })}
                  </p>
                  <button className="hh-primary" onClick={() => answerTier("continue")}>
                    {t("modes.keepTier")}
                  </button>
                  <button onClick={() => answerTier("new-task")}>{t("modes.newTask", { mode: modeLabel(tierAsk.mode) })}</button>
                  <button ref={tierNotNowRef} onClick={() => answerTier()}>
                    {t("modes.notNow")}
                  </button>
                </div>
              )}
              {timePick && (
                <div
                  ref={timeRef}
                  className="hh-confirm"
                  role="dialog"
                  aria-labelledby="hh-time-title"
                  onKeyDown={(e) => {
                    if (e.key !== "Escape") return;
                    e.preventDefault();
                    closeTime();
                  }}
                >
                  <p id="hh-time-title">
                    <strong>{t("phases.timeTitle")}</strong>
                  </p>
                  <div className="hh-mode-list" role="group" aria-labelledby="hh-time-title">
                    {timeChoices(timePick.options.action).map((m) => (
                      <button
                        key={m ?? "none"}
                        type="button"
                        className="hh-choice"
                        onClick={() => {
                          const p = timePick;
                          setTimePick(null);
                          questionOpener.current = null;
                          // The picker goes: focus on the composer, whether the send went out or waits for another question.
                          inputRef.current?.focus();
                          send(p.text, { ...p.options, timeBox: m });
                        }}
                      >
                        {m === null ? t("phases.noLimit") : t("phases.minutes", { count: m })}
                      </button>
                    ))}
                  </div>
                  <button onClick={closeTime}>{t("modes.notNow")}</button>
                </div>
              )}
              {askPick && (
                <div
                  ref={askRef}
                  className="hh-confirm"
                  role="dialog"
                  aria-labelledby="hh-ask-title"
                  onKeyDown={(e) => {
                    if (e.key !== "Escape") return;
                    e.preventDefault();
                    closeAsk();
                  }}
                >
                  <p id="hh-ask-title">
                    <strong>{t("modes.askTitle")}</strong>
                  </p>
                  <ModeList
                    modes={actionModes(state, askPick.options.action)}
                    disabled={false}
                    labelledBy="hh-ask-title"
                    onPick={(mode) => {
                      const p = askPick;
                      setAskPick(null);
                      questionOpener.current = null;
                      // The picker goes: focus on the composer, whether the send went out or waits for the pre-flight.
                      inputRef.current?.focus();
                      send(p.text, { ...p.options, mode });
                    }}
                  />
                  <button onClick={closeAsk}>{t("modes.notNow")}</button>
                </div>
              )}
              <div ref={spacerRef} className="hh-chat-spacer" style={{ display: "none" }} aria-hidden="true" />
            </section>
            {/* A plugin's prepared task (plugins part 2): only while main sends one, and nothing starts without Start (P6). */}
            {surfaceCtx?.surface.prepared && (
              <PreparedTask
                key={surfaceCtx.surface.prepared.token}
                client={client}
                prepared={surfaceCtx.surface.prepared}
                blocked={blocked()}
                needScope={surfaceCtx.surface.prepared.scope === "open" && state.scopes && !openScope ? state.scopes.label : null}
                closesTask={tasks.current !== null}
                onStart={() => {
                  // Like a sent question: the task goes on screen at once, the card's title as the person's line (main
                  // saves the same display); a refusal puts the screen back as it was, a failure after main took the task
                  // keeps the line and ends the turn as failed, as a failed send does.
                  const before = { since, placed: placed.current };
                  const at = new Date().toISOString();
                  stick.current = true;
                  pinNext.current = true;
                  if (flow) showNewTask();
                  dispatch({ type: "user", text: surfaceCtx.surface.prepared?.title ?? "", at });
                  return (outcome, message) => {
                    if (outcome === "failed") return failTurn(new Error(message));
                    placed.current = before.placed;
                    setSince(before.since);
                    dispatch({ type: "withdrawn", at });
                  };
                }}
              />
            )}
            {composer && (
              <form className="hh-composer" onSubmit={onSubmit}>
                {(() => {
                  const field = (
                    <textarea
                      ref={inputRef}
                      aria-label={placeholder}
                      placeholder={placeholder}
                      value={draft}
                      readOnly={reviewing !== null}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" || e.shiftKey) return;
                        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                        e.preventDefault();
                        // ⌘⏎ / Ctrl⏎ sends at once; ⌥⏎ asks for a review even without flags (spec §4.1).
                        if (sidekick && (e.metaKey || e.ctrlKey)) sendNow(draft);
                        else void submit(draft, e.altKey);
                      }}
                    />
                  );
                  // D0: without Sidekick, the bare textarea as before. Wrapped from the first render (not once the state
                  // loads) so the field is never remounted under the person's cursor.
                  if (!skEnabled) return field;
                  const card = sidekick?.card;
                  const spans = card && sidekick?.settings.on && card.prompt === draft ? cardSpans(card) : [];
                  return (
                    <FlaggedText text={draft} spans={spans}>
                      {field}
                    </FlaggedText>
                  );
                })()}
                {/* A closing or checkpoint turn is quiet (nothing live on screen) but still stoppable. */}
                {chat.live || closing || checkpoint ? (
                  <button type="button" onClick={() => void client.cancel()}>
                    {t("chat.stop")}
                  </button>
                ) : reviewing ? (
                  <button type="button" disabled>
                    {t("sidekick.composer.reviewing")}
                  </button>
                ) : (
                  <>
                    {reviewOn && (
                      <button type="button" onClick={() => void submit(draft, true)}>
                        {t("sidekick.composer.review")}
                      </button>
                    )}
                    <span className="hh-caption hh-composer-send-hint">{t("chat.enterToSend")}</span>
                    <button type="submit" className="hh-cta">
                      {t("chat.send")}
                    </button>
                  </>
                )}
              </form>
            )}
            {reviewing && <ReviewHint until={reviewing.until} sendKey={SEND_KEY} />}
            {startView?.hint && !slim && <p className="hh-composer-hint">{t(startView.hint, { ns: "harness" })}</p>}
          </Main>
          {(() => {
            const ownSide = renderSide && !slim ? renderSide(chat.blockState, sendFromHarness) : undefined;
            // The harness's `<PluginSlot>`s read the surface from here; without one, exactly its side panel (D0).
            const harnessSide =
              ownSide !== undefined && surfaceCtx ? <PluginSurfaceContext.Provider value={surfaceCtx}>{ownSide}</PluginSurfaceContext.Provider> : ownSide;
            // D0: without Sidekick, exactly the harness's side panel as before.
            // Narrow, the panel and rail hide (styles.css): the harness's side panel shows as before (D0).
            if (!sidekick || narrow) return harnessSide !== undefined ? <aside className="hh-side">{harnessSide}</aside> : null;
            if (!skExpanded) {
              return (
                <>
                  {harnessSide !== undefined && <aside className="hh-side">{harnessSide}</aside>}
                  <SidekickRail state={sidekick} buttonRef={railRef} onOpen={() => toggleSk(true)} />
                </>
              );
            }
            return (
              <SidekickPanel
                state={sidekick}
                view={harnessSide !== undefined ? skView : "sidekick"}
                onView={setSkView}
                {...(harnessSide !== undefined ? { harnessSide } : {})}
                sendKey={SEND_KEY}
                onCollapse={() => toggleSk(false)}
                offer={<FirstOpenOffer client={client} offered={sidekick.settings.presetsOffered} />}
                onMute={(id) => void client.sidekick.mute(id).catch(() => undefined)}
                onDismiss={(id, outcome) => void client.sidekick.resolve(id, outcome).catch(() => undefined)}
                onSaveDecision={(id) => client.sidekick.saveDecision(id)}
                // The heads-up leaves as used only when the closing turn really started.
                onFinishTask={(id) => {
                  if (finishTask()) void client.sidekick.resolve(id, "used").catch(() => undefined);
                }}
                queued={[...liveQueued, ...later]}
                onDropQueued={(key) => {
                  setLater((l) => l.filter((q) => q.key !== key));
                  setDroppedLive((d) => [...d, key]);
                }}
                {...(onSidekickSettings ? { onTier: onSidekickSettings } : {})}
                onTurnOn={() => void client.sidekick.set({ on: true, introSeen: true }).catch(() => undefined)}
                onNotNow={() => {
                  void client.sidekick.set({ introSeen: true }).catch(() => undefined);
                  toggleSk(false);
                }}
                // A suggestion goes through `send`, never `submit`: it is never reviewed again.
                // The card leaves only once the send went: a refused one keeps the rewrite.
                onSendSuggested={(card) => {
                  // A block answer's rewrite goes to the composer: the person sends it, or copies it into the form.
                  if (card.block) {
                    heldBy(card);
                    resolveCard(card, "used");
                    if (card.rewrite) setDraft(card.rewrite);
                    inputRef.current?.focus();
                    return;
                  }
                  if (!card.rewrite || !send(card.rewrite)) return;
                  setDraft("");
                  resolveCard(card, "used");
                }}
                onEdit={(card) => {
                  if (card.block) {
                    const hold = heldBy(card);
                    resolveCard(card, "edited");
                    hold?.focus();
                    return;
                  }
                  resolveCard(card, "edited");
                  setDraft(card.rewrite ?? card.prompt);
                  inputRef.current?.focus();
                }}
                onSendAnyway={(card) => {
                  // A block answer's card sends its form as it is, unreviewed.
                  if (card.block) {
                    const held = answerHold.current;
                    if (held?.cardId === card.id) {
                      // The form it held is gone (another task) or can't send now: nothing went, the card stays.
                      if (!held.hold.anyway()) return;
                      answerHold.current = null;
                    }
                    resolveCard(card, "sent-anyway");
                    return;
                  }
                  if (!send(card.prompt)) return;
                  setDraft("");
                  resolveCard(card, "sent-anyway");
                }}
                onPutInComposer={(text) => {
                  setDraft(text);
                  inputRef.current?.focus();
                }}
              />
            );
          })()}
          {reader && !slim && (
            <DocumentReader
              client={client}
              target={reader}
              kinds={documentKinds}
              prefs={readerPrefs}
              onPrefs={saveReaderPrefs}
              full={readerFull}
              onFull={setReaderFull}
              onClose={closeReader}
              onOpen={openDoc}
              onMissing={recheckDocs}
              review={state.review === true}
              busy={Boolean(chat.live) || closing || checkpoint}
              focus={focus}
              onFocus={(on) => setFocusMode(on, reader.path)}
            />
          )}
          {contextOpen && tasks.current && !slim && (
            <ContextPanel
              key={tasks.current.id}
              client={client}
              taskId={tasks.current.id}
              {...(tasks.current.context ? { usage: tasks.current.context } : {})}
              notes={tasks.notes}
              onOpen={openFromContext}
              onClose={closeContext}
            />
          )}
        </div>
        <div className="hh-sr-only" aria-live="polite">
          {announcement}
        </div>
        {showHistory && (
          <HistoryPanel
            key={historyTask ?? "history"}
            client={client}
            actions={state.actions}
            {...(historyTask ? { openTask: historyTask } : {})}
            currentTask={tasks.current?.id}
            {...(state.parallel || state.jobs ? { undoByFiles: true } : {})}
            {...(state.jobs ? { jobs: state.jobs.jobs } : {})}
            {...(state.hatches?.linkedFolders ? { linkedFolders: state.hatches.linkedFolders } : {})}
            disabled={Boolean(chat.live) || closing || checkpoint}
            onClose={() => {
              setShowHistory(false);
              setHistoryTask(undefined);
            }}
            onRestored={(kind) => {
              setSkRefresh((n) => n + 1);
              const text = t(kind === "task" ? "history.restoredTask" : "history.restored");
              dispatch({ type: "notice", text, at: new Date().toISOString() });
              setNotice(text);
            }}
            onOpenFile={(file, kind) => {
              setShowHistory(false);
              // A `.md` that is still there opens in the reader with its drawer; anything else in the timeline panel.
              if (kind !== "deleted" && isMarkdownPath(file) && !slim) showReader({ path: file, timeline: true });
              else setTimelineFile(file);
            }}
          />
        )}
        {timelineFile !== null && (
          <FileTimelinePanel client={client} path={timelineFile} busy={Boolean(chat.live) || closing || checkpoint} onClose={() => setTimelineFile(null)} />
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
    </DocumentContext.Provider>
  );
}

/** The card's spans to underline in the composer: the local flags' and the model's issues that point at the text. */
function cardSpans(card: SidekickCard): [number, number][] {
  return [...card.flags.map((f) => f.span), ...card.issues.flatMap((i) => (i.span ? [i.span] : []))];
}

/** "⌘" on macOS, "Ctrl" elsewhere: the key that sends at once. */
const SEND_KEY = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent) ? "⌘" : "Ctrl";

