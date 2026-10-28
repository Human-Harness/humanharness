import type {
  AppConfig,
  AppState,
  ChatEntry,
  ChoiceOption,
  DataChangeView,
  DataDiffView,
  DataKey,
  DataQuery,
  DataRecord,
  DocumentRead,
  EngineError,
  FileDiffResult,
  FileRestoreAnswer,
  FileRestorePrompt,
  FocusState,
  EngineStatus,
  Event,
  FolderPick,
  HarnessClient,
  HistoryItem,
  HistoryTaskView,
  MaterialAddResult,
  MaterialChoice,
  MaterialResult,
  MaterialView,
  ModeChoice,
  ModeResult,
  ModeSwitch,
  MoveResult,
  PhaseResult,
  ProfileResult,
  ProfilesState,
  ProfileView,
  RespondResult,
  Review,
  ReviewResult,
  ReviewSendResult,
  ReviewSummary,
  RunningSetup,
  ScopeView,
  ScopesView,
  SendOptions,
  SettingsResult,
  SettingsState,
  SetupOutput,
  SetupResult,
  SetupStep,
  SetupStepResult,
  SetupStepsState,
  TaskTurnNotice,
  TaskView,
  TestResult,
  TextSize,
  TimelineEntry,
  UsageSummary,
} from "../src/client";
import { hearsDataChange } from "../src/client";
import { anchorForSelection, answerQuestion, nextCommentId, summarizeReview } from "@humanharness/harness-sdk/review";

/** A stand-in blob id (40 hex characters) that changes with the text, like a real one. */
export function fakeBlob(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0").repeat(5);
}

export class FakeClient implements HarnessClient {
  state: AppState;
  sent: string[] = [];
  sentOptions: SendOptions[] = [];
  restored: string[] = [];
  /** What historyTasks answers: one task, newest first. */
  historyGroups: HistoryTaskView[] = [
    {
      taskId: "t1",
      actionId: null,
      start: "s0",
      end: "abc",
      date: "2026-10-10T12:00:00.000Z",
      changes: [{ path: "notes.md", kind: "modified" }],
      entries: [{ sha: "abc", message: "Turn: hi", date: "2026-10-10T12:00:00.000Z" }],
    },
  ];
  /** Tasks restoreTask was asked to go back before. */
  restoredTasks: string[] = [];
  cancelled = 0;
  chat: ChatEntry[] = [];
  switchedFrom: string | undefined;
  sendError: Error | null = null;
  saveError: Error | null = null;
  restoreError: Error | null = null;
  /** What historyTasks throws, if anything. */
  historyError: Error | null = null;
  /** While set, restore and restoreTask wait for it. */
  restoreGate: Promise<void> | null = null;
  pickResult: FolderPick | null = { folder: "/Users/me/Elsewhere", problem: null };
  stateError: Error | null = null;
  getStateCalls = 0;
  loadChatGate: Promise<void> | null = null;
  /** Engine status returned by engineStatus (any engine id); setup steps update it. */
  status: EngineStatus = {
    engineId: "claude",
    installed: true,
    version: "2.1.296",
    minVersion: "2.1.296",
    outdated: false,
    loggedIn: true,
    noticeAccepted: true,
    verified: true,
  };
  /** Per-engine statuses that win over `status`. */
  statusFor: Record<string, EngineStatus> = {};
  /** Per-engine: engineStatus waits for it. */
  statusGates: Record<string, Promise<void>> = {};
  /** When set, engineStatus rejects with it. */
  statusError: Error | null = null;
  accepted: string[] = [];
  /** When set, acceptNotice rejects (e.g. ~/.humanharness/engines.json can't be written). */
  acceptError: Error | null = null;
  /** When set, testEngine rejects (e.g. the IPC failed). */
  testError: Error | null = null;
  /** The test passes but ~/.humanharness/engines.json can't record it. */
  testUnrecorded = false;
  /** The setup step running now (getSetup). */
  running: RunningSetup | null = null;
  sharedRevealed = 0;
  sharedReset = 0;
  /** Engines whose install command was copied. */
  copied: string[] = [];
  /** Commands copied for Terminal steps, as "engine:step". */
  setupCopied: string[] = [];
  /** When set, copyInstallCommand rejects with it. */
  copyError: Error | null = null;
  terminalOpened = 0;
  /** When set, resetSharedConfig waits for it. */
  resetGate: Promise<void> | null = null;
  /** When set, resetSharedConfig rejects with it. */
  resetError: Error | null = null;
  /** When set, getSetup waits for it. */
  getSetupGate: Promise<void> | null = null;
  setupRuns: { engineId: string; step: SetupStep }[] = [];
  setupResult: SetupResult = { ok: true };
  /** When set, runSetup waits for it (a login in progress). */
  setupGate: Promise<void> | null = null;
  setupInputs: string[] = [];
  setupCancelled = 0;
  tested: string[] = [];
  testResult: TestResult & { error?: EngineError } = { ok: true };
  usage: UsageSummary = { limits: null, estimates: {}, tokens: {} };
  revealed = 0;
  /** Places moveFolder was asked to move to. */
  moved: string[] = [];
  /** What moveFolder answers; default: success with the current state. */
  moveResult: MoveResult | null = null;
  tasks: TaskView = { current: null, actions: {}, notes: [] };
  chosen: ChoiceOption[] = [];
  /** The task each pick was sent for. */
  chosenTasks: string[] = [];
  /** When set, choose rejects with it. */
  chooseError: Error | null = null;
  opened: string[] = [];
  /** What openPath answers. */
  openResult = true;
  /** What settings.get answers. */
  settingsState: SettingsState = { values: {}, pending: [] };
  /** What settings.set was asked, in order. */
  settingsSets: { field: string; value: unknown }[] = [];
  settingsResets = 0;
  /** When set, settings.set and reset answer it instead of saving. */
  settingsFailure: SettingsResult | null = null;
  private settingsListeners = new Set<(s: SettingsState) => void>();
  private taskListeners = new Set<(v: TaskView) => void>();
  private listeners = new Set<(e: Event) => void>();
  private setupListeners = new Set<(o: SetupOutput) => void>();

  constructor(config: AppConfig = {}) {
    this.state = {
      harness: {
        id: "demo",
        name: "Demo",
        tagline: "Test notes",
        author: "Marco Zanger",
        donate: "https://example.com/donate",
        version: "0.1.0",
      },
      config,
      suggestedFolder: "/Users/me/Documents/Demo",
      engines: [
        {
          id: "claude",
          name: "Claude",
          status: "allowed",
          provider: "Anthropic",
          requires: "Pro plan",
          dataLocation: "USA",
          trainsOnData: "Depends on your settings",
          termsUrl: "https://example.com/terms",
          privacyUrl: "https://example.com/privacy",
          reportsLimits: true,
          installCommand: "curl -fsSL https://claude.ai/install.sh | bash",
          installDocsUrl: "https://code.claude.com/docs/en/setup",
          logo: "data:image/svg+xml;base64,PHN2Zy8+",
        },
      ],
      actions: {},
    };
  }

  emit(e: Event) {
    for (const l of this.listeners) l(e);
  }
  emitSetup(o: SetupOutput) {
    if (o.kind === "url" && this.running) this.running = { ...this.running, url: this.running.url ?? o.url };
    for (const l of this.setupListeners) l(o);
  }

  async getState() {
    this.getStateCalls++;
    if (this.stateError) throw this.stateError;
    return this.state;
  }
  async pickFolder() {
    return this.pickResult;
  }
  async saveConfig(patch: AppConfig) {
    if (this.saveError) throw this.saveError;
    this.state = { ...this.state, config: { ...this.state.config, ...patch } };
    return this.state;
  }
  async loadChat() {
    if (this.loadChatGate) await this.loadChatGate;
    return { entries: this.chat, ...(this.switchedFrom ? { switchedFrom: this.switchedFrom } : {}) };
  }
  async send(message: string, options: SendOptions = {}) {
    this.sent.push(message);
    this.sentOptions.push(options);
    if (this.sendError) throw this.sendError;
  }
  async cancel() {
    this.cancelled++;
  }
  onEvent(listener: (e: Event) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async restore(sha: string) {
    await this.restoreGate;
    if (this.restoreError) throw this.restoreError;
    this.restored.push(sha);
  }
  async historyTasks() {
    if (this.historyError) throw this.historyError;
    return this.historyGroups;
  }
  async restoreTask(taskId: string) {
    await this.restoreGate;
    if (this.restoreError) throw this.restoreError;
    this.restoredTasks.push(taskId);
  }
  async engineStatus(engineId: string) {
    await this.statusGates[engineId];
    if (this.statusError) throw this.statusError;
    return { ...(this.statusFor[engineId] ?? this.status), engineId };
  }
  async acceptNotice(engineId: string) {
    if (this.acceptError) throw this.acceptError;
    this.accepted.push(engineId);
    this.status = { ...this.status, noticeAccepted: true };
  }
  async runSetup(engineId: string, step: SetupStep) {
    this.setupRuns.push({ engineId, step });
    this.running = { engineId, step };
    this.emitSetup({ kind: "start", engineId, step });
    if (this.setupGate) await this.setupGate;
    if (this.setupResult.ok) {
      if (step === "install") this.status = { ...this.status, installed: true };
      if (step === "update") this.status = { ...this.status, outdated: false };
      if (step === "login") this.status = { ...this.status, loggedIn: true };
      if (step === "logout") this.status = { ...this.status, loggedIn: false };
    }
    this.running = null;
    this.emitSetup({ kind: "end", engineId, step, ...this.setupResult });
    return this.setupResult;
  }
  async setupInput(text: string) {
    this.setupInputs.push(text);
  }
  async cancelSetup() {
    this.setupCancelled++;
  }
  onSetupOutput(listener: (o: SetupOutput) => void) {
    this.setupListeners.add(listener);
    return () => this.setupListeners.delete(listener);
  }
  async testEngine(engineId: string) {
    this.tested.push(engineId);
    if (this.testError) throw this.testError;
    if (this.testResult.ok && this.testUnrecorded) return { ok: true, recorded: false };
    if (this.testResult.ok) this.status = { ...this.status, verified: true };
    return this.testResult;
  }
  async getSetup() {
    if (this.getSetupGate) await this.getSetupGate;
    return this.running;
  }
  async revealSharedConfig() {
    this.sharedRevealed++;
  }
  async copyInstallCommand(engineId: string) {
    if (this.copyError) throw this.copyError;
    this.copied.push(engineId);
  }
  async copySetupCommand(engineId: string, step: "login" | "logout") {
    if (this.copyError) throw this.copyError;
    this.setupCopied.push(`${engineId}:${step}`);
  }
  async openTerminal() {
    this.terminalOpened++;
  }
  async resetSharedConfig() {
    this.sharedReset++;
    if (this.resetGate) await this.resetGate;
    if (this.resetError) throw this.resetError;
    this.acceptError = null;
    // Every engine asks for its notice and test again.
    this.status = { ...this.status, noticeAccepted: false, verified: false };
    this.testUnrecorded = false;
  }
  async getUsage() {
    return this.usage;
  }
  async revealFolder() {
    this.revealed++;
  }
  async moveFolder(to: string) {
    this.moved.push(to);
    return this.moveResult ?? { ok: true as const, state: this.state };
  }
  emitTasks(view: TaskView) {
    this.tasks = view;
    for (const l of this.taskListeners) l(view);
  }
  async getTasks() {
    return this.tasks;
  }
  onTasks(listener: (v: TaskView) => void) {
    this.taskListeners.add(listener);
    return () => {
      this.taskListeners.delete(listener);
    };
  }
  async choose(option: ChoiceOption, task: string) {
    this.chosen.push(option);
    this.chosenTasks.push(task);
    if (this.chooseError) throw this.chooseError;
  }
  /** What respond was asked, in order. */
  responded: { blockId: string; value: Record<string, unknown> }[] = [];
  /** What respond answers; default: taken, with the line "answered" (a taken answer clears the task's pendingInput). */
  respondResult: RespondResult | null = null;
  /** When set, respond rejects with it. */
  respondError: Error | null = null;
  /** While set, respond waits for it before answering. */
  respondGate: Promise<void> | null = null;
  async respond(blockId: string, value: Record<string, unknown>): Promise<RespondResult> {
    this.responded.push({ blockId, value });
    if (this.respondGate) await this.respondGate;
    if (this.respondError) throw this.respondError;
    const result: RespondResult = this.respondResult ?? { ok: true, display: "answered", value, answeredAt: "2026-10-25T10:00:00.000Z" };
    // Like the main process: a taken answer clears the task's pending question before `accepted` resolves.
    const current = this.tasks.current;
    if (result.ok && current?.pendingInput === blockId) {
      const { pendingInput: _, ...rest } = current;
      this.emitTasks({ ...this.tasks, current: rest });
    }
    return result;
  }
  /** What chooseMode was asked, in order. */
  modeChoices: { mode: string; choice: ModeChoice }[] = [];
  /** What chooseMode answers; default: a switch turn runs. */
  modeResult: ModeResult | null = null;
  /** When set, chooseMode rejects with it. */
  modeError: Error | null = null;
  async chooseMode(mode: string, choice: ModeChoice = {}): Promise<ModeResult> {
    this.modeChoices.push({ mode, choice });
    if (this.modeError) throw this.modeError;
    const result: ModeResult = this.modeResult ?? { ok: true, switched: "turn" };
    // Like the preload: a switch is told before the result resolves.
    if (result.ok && result.switched !== "same") for (const l of this.modeSwitchListeners) l({ mode, switched: result.switched });
    return result;
  }
  modeSwitchListeners = new Set<(s: ModeSwitch) => void>();
  onModeSwitch(listener: (s: ModeSwitch) => void) {
    this.modeSwitchListeners.add(listener);
    return () => void this.modeSwitchListeners.delete(listener);
  }
  /** What setPhase was asked, in order. */
  phaseCalls: { taskId: string; phaseId: string }[] = [];
  /** What setPhase answers; default: a change turn runs. */
  phaseResult: PhaseResult | null = null;
  async setPhase(taskId: string, phaseId: string): Promise<PhaseResult> {
    this.phaseCalls.push({ taskId, phaseId });
    return this.phaseResult ?? { ok: true, changed: "turn" };
  }
  /** Calls to finishTask, pauseTask, resumeTask and extendTimeBox, in order. */
  taskCalls: string[] = [];
  async finishTask() {
    this.taskCalls.push("finish");
    return true;
  }
  async pauseTask() {
    this.taskCalls.push("pause");
    return true;
  }
  async resumeTask() {
    this.taskCalls.push("resume");
    return true;
  }
  async extendTimeBox() {
    this.taskCalls.push("extend");
    return true;
  }
  taskTurnListeners = new Set<(n: TaskTurnNotice) => void>();
  onTaskTurn(listener: (n: TaskTurnNotice) => void) {
    this.taskTurnListeners.add(listener);
    return () => void this.taskTurnListeners.delete(listener);
  }
  /** Tells the window a phase change or wrap-up turn starts, as main does before its events. */
  emitTaskTurn(n: TaskTurnNotice) {
    for (const l of this.taskTurnListeners) l(n);
  }
  /** Files revealPath was asked to show. */
  revealedFiles: string[] = [];
  async revealPath(file: string) {
    this.revealedFiles.push(file);
    return this.openResult;
  }
  /** Documents by path (relative to the folder); readDocument answers from here. */
  docTexts: Record<string, string> = {};
  documentMtime = "2026-10-27T10:00:00.000Z";
  /** Images by path, as data: URLs. */
  images: Record<string, string> = {};
  private documentWatchers = new Map<string, Set<() => void>>();
  private documentOpeners = new Set<(path: string, anchor?: string) => void>();
  async readDocument(file: string): Promise<DocumentRead> {
    if (file.startsWith("../") || file.startsWith("/")) return { ok: false, reason: "outside" };
    if (!Object.hasOwn(this.docTexts, file)) return { ok: false, reason: "missing" };
    const text = this.docTexts[file];
    return { ok: true, text, mtime: this.documentMtime, size: new TextEncoder().encode(text).length };
  }
  async readImage(file: string) {
    return Object.hasOwn(this.images, file) ? this.images[file] : null;
  }
  async documentsExist(paths: string[]) {
    return paths.map((p) => Object.hasOwn(this.docTexts, p));
  }
  watchDocument(file: string, listener: () => void) {
    const set = this.documentWatchers.get(file) ?? new Set();
    set.add(listener);
    this.documentWatchers.set(file, set);
    return () => void set.delete(listener);
  }
  /** Rewrites (or with null deletes) a document and tells its watchers, as main does after a change. */
  changeDocument(file: string, text: string | null) {
    if (text === null) delete this.docTexts[file];
    else this.docTexts[file] = text;
    for (const l of [...(this.documentWatchers.get(file) ?? [])]) l();
  }
  openDocument(file: string, anchor?: string) {
    for (const l of [...this.documentOpeners]) l(file, anchor);
  }
  onOpenDocument(listener: (path: string, anchor?: string) => void) {
    this.documentOpeners.add(listener);
    return () => void this.documentOpeners.delete(listener);
  }
  /** Review records by document path; the fake's `documents` answers from here like main. */
  reviews: Record<string, Review> = {};
  /** Every review call, in order. */
  reviewCalls: { op: string; args: unknown[] }[] = [];
  /** What `send` and `approve` answer when set (else they succeed). */
  sendResult: ReviewSendResult | null = null;
  approveResult: ReviewResult | null = null;
  approvedTexts: Record<string, string> = {};
  /** The current blob id by path; absent: the last approval's (an approved record reads as approved), else the text's. */
  currentBlobs: Record<string, string> = {};
  private reviewListeners = new Set<(path: string) => void>();
  private focusOpeners = new Set<(path: string) => void>();
  private focusListeners = new Set<(s: FocusState) => void>();
  private focusState: FocusState = { on: false };
  /** Tells every `documents.onChange` listener, as main does after a change. */
  emitReviewChanged(path: string) {
    for (const l of [...this.reviewListeners]) l(path);
  }
  private blobOf(path: string): string {
    return this.currentBlobs[path] ?? this.reviews[path]?.approvals.at(-1)?.blob ?? fakeBlob(this.docTexts[path] ?? "");
  }
  private summaryOf(path: string): ReviewSummary {
    return summarizeReview(this.reviews[path] ?? null, this.blobOf(path));
  }
  documents: HarnessClient["documents"] = {
    view: async (path) => {
      this.reviewCalls.push({ op: "view", args: [path] });
      if (!Object.hasOwn(this.docTexts, path)) return { ok: false, reason: "missing" };
      return { ok: true, review: this.reviews[path] ?? null, blob: this.blobOf(path), summary: this.summaryOf(path) };
    },
    review: async (path) => (this.reviews[path] ? this.summaryOf(path) : null),
    summaries: async (paths) => {
      this.reviewCalls.push({ op: "summaries", args: [paths] });
      return paths.map((p) => (this.reviews[p] ? this.summaryOf(p) : null));
    },
    answer: async (path, id, pick) => {
      this.reviewCalls.push({ op: "answer", args: [path, id, pick] });
      const r = this.reviews[path];
      const c = r?.comments.find((x) => x.id === id);
      if (!r || !c || !Object.hasOwn(this.docTexts, path)) return { ok: false, reason: "unknown" };
      const a = answerQuestion(this.docTexts[path], c, pick);
      if (!a.ok) return { ok: false, reason: "bad-input" };
      if (a.text !== null) this.docTexts[path] = a.text;
      this.reviews[path] = { ...r, comments: r.comments.map((x) => (x.id === id ? a.comment : x)) };
      this.emitReviewChanged(path);
      return { ok: true, applied: a.text !== null };
    },
    comment: async (path, input) => {
      this.reviewCalls.push({ op: "comment", args: [path, input] });
      const anchor = anchorForSelection(this.docTexts[path] ?? "", input.selected, input.heading);
      if (!anchor) return { ok: false, reason: "not-found" };
      const r = this.reviews[path] ?? { path, task: null, comments: [], approvals: [] };
      const id = nextCommentId(r);
      this.reviews[path] = {
        ...r,
        comments: [...r.comments, { id, author: "person", kind: "comment", anchor, text: input.text, state: "draft", replies: [], at: "2026-10-28T10:00:00.000Z" }],
      };
      this.emitReviewChanged(path);
      return { ok: true, id };
    },
    editDraft: async (path, id, text) => {
      this.reviewCalls.push({ op: "editDraft", args: [path, id, text] });
      const r = this.reviews[path];
      if (!r) return { ok: false, reason: "unknown" };
      this.reviews[path] = { ...r, comments: text === null ? r.comments.filter((c) => c.id !== id) : r.comments.map((c) => (c.id === id ? { ...c, text } : c)) };
      this.emitReviewChanged(path);
      return { ok: true };
    },
    reopen: async (path, id) => {
      this.reviewCalls.push({ op: "reopen", args: [path, id] });
      return { ok: true };
    },
    send: async (path) => {
      this.reviewCalls.push({ op: "send", args: [path] });
      return this.sendResult ?? { ok: true, sent: 1, to: "open" };
    },
    approve: async (path, blob, opts) => {
      this.reviewCalls.push({ op: "approve", args: [path, blob, opts] });
      return this.approveResult ?? { ok: true };
    },
    approvedText: async (path) => (Object.hasOwn(this.approvedTexts, path) ? { ok: true, text: this.approvedTexts[path] } : { ok: false, reason: "missing" }),
    onChange: (listener) => {
      this.reviewListeners.add(listener);
      return () => void this.reviewListeners.delete(listener);
    },
    focus: (path) => {
      for (const l of [...this.focusOpeners]) l(path);
    },
    onFocus: (listener) => {
      this.focusOpeners.add(listener);
      return () => void this.focusOpeners.delete(listener);
    },
  };
  focus: HarnessClient["focus"] = {
    current: () => this.focusState,
    onChange: (listener) => {
      this.focusListeners.add(listener);
      return () => void this.focusListeners.delete(listener);
    },
    set: (s) => {
      this.focusState = s;
      for (const l of [...this.focusListeners]) l(s);
    },
  };
  /** Timelines by path, and diffs by `${path}|${from}|${to}`; the fake's `files` answers from here like main. */
  timelines: Record<string, TimelineEntry[]> = {};
  diffs: Record<string, FileDiffResult> = {};
  /** Every files call, in order. */
  fileCalls: { op: string; args: unknown[] }[] = [];
  /** What a confirmed restore answers. */
  restoreAnswer: FileRestoreAnswer = { ok: true };
  private fileListeners = new Map<string, Set<() => void>>();
  private confirmer: ((prompt: FileRestorePrompt) => Promise<boolean>) | null = null;
  /** As main does after a commit. */
  emitFileCommit(paths: string[]) {
    for (const p of paths) for (const l of [...(this.fileListeners.get(p) ?? [])]) l();
  }
  files: HarnessClient["files"] = {
    timeline: async (path) => {
      this.fileCalls.push({ op: "timeline", args: [path] });
      return Object.hasOwn(this.timelines, path) ? { ok: true, entries: this.timelines[path] } : { ok: false, reason: "untracked" };
    },
    diff: async (path, from, to) => {
      this.fileCalls.push({ op: "diff", args: [path, from, to] });
      return this.diffs[`${path}|${from}|${to}`] ?? { ok: false, reason: "not-found" };
    },
    restore: async (path, commit) => {
      this.fileCalls.push({ op: "restore", args: [path, commit] });
      const e = (this.timelines[path] ?? []).find((x) => x.to === commit);
      if (!e) return { refused: "not-found" };
      if (!this.confirmer) return "cancelled";
      const yes = await this.confirmer({ path, author: e.author, at: e.at, kind: e.kind, ...(e.version ? { version: e.version } : {}) });
      if (!yes) return "cancelled";
      return this.restoreAnswer.ok ? "restored" : { refused: this.restoreAnswer.reason };
    },
    onChange: (path, listener) => {
      const set = this.fileListeners.get(path) ?? new Set();
      set.add(listener);
      this.fileListeners.set(path, set);
      return () => void set.delete(listener);
    },
    hostConfirm: (confirm) => {
      this.confirmer = confirm;
      return () => {
        if (this.confirmer === confirm) this.confirmer = null;
      };
    },
  };
  context: HarnessClient["context"] = {
    get: async () => ({ ok: false, reason: "not-ready" }),
    onChange: () => () => {},
    add: async () => ({ ok: false, reason: "not-ready" }),
    pick: async () => ({ ok: false, reason: "not-ready" }),
    pin: async () => ({ ok: false, reason: "not-ready" }),
    unpin: async () => ({ ok: false, reason: "not-ready" }),
    exclude: async () => ({ ok: false, reason: "not-ready" }),
    include: async () => ({ ok: false, reason: "not-ready" }),
  };
  async openPath(file: string) {
    this.opened.push(file);
    return this.openResult;
  }
  private textSizeListeners = new Set<(size: TextSize) => void>();
  /** What the main process does on ⌘+, ⌘− or ⌘0: saves the size, then tells the window. */
  emitTextSize(textSize: TextSize) {
    this.state = { ...this.state, config: { ...this.state.config, textSize } };
    for (const l of this.textSizeListeners) l(textSize);
  }
  onTextSize(listener: (size: TextSize) => void) {
    this.textSizeListeners.add(listener);
    return () => {
      this.textSizeListeners.delete(listener);
    };
  }
  /** The scope registry the fake answers with. */
  scopeList: ScopeView[] = [];
  /** The open scope. */
  openScope: string | null = null;
  private scopeListeners = new Set<(v: ScopesView) => void>();
  emitScopes() {
    const view = { open: this.openScope, list: this.scopeList };
    for (const l of this.scopeListeners) l(view);
  }
  private changeScope(id: string, change: Partial<ScopeView>): ScopeView {
    const i = this.scopeList.findIndex((s) => s.id === id);
    if (i < 0) throw new Error(`Unknown scope: "${id}"`);
    const next = { ...this.scopeList[i], ...change };
    this.scopeList = this.scopeList.map((s, j) => (j === i ? next : s));
    return next;
  }
  scopes = {
    list: async () => this.scopeList,
    create: async (title: string) => {
      const s: ScopeView = { id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title, createdAt: "2026-10-25T10:00:00.000Z", archived: false };
      this.scopeList = [...this.scopeList, s];
      this.emitScopes();
      return s;
    },
    rename: async (id: string, title: string) => {
      const s = this.changeScope(id, { title });
      this.emitScopes();
      return s;
    },
    archive: async (id: string) => {
      if (this.openScope === id) this.openScope = null;
      this.changeScope(id, { archived: true });
      this.emitScopes();
    },
    unarchive: async (id: string) => {
      this.changeScope(id, { archived: false });
      this.emitScopes();
    },
    open: async (id: string | null) => {
      this.openScope = id;
      this.emitScopes();
      return true;
    },
    current: async () => this.openScope,
    onChange: (listener: (v: ScopesView) => void) => {
      this.scopeListeners.add(listener);
      return () => {
        this.scopeListeners.delete(listener);
      };
    },
  };
  /** The fake's data: records by collection, in the order they were put; `dataKey` names the key field. */
  records: Record<string, DataRecord[]> = {};
  dataKey = "id";
  private dataListeners = new Set<(c: DataChangeView) => void>();
  private dataChanged(change: DataChangeView) {
    for (const l of this.dataListeners) l(change);
  }
  dataDiffs: Record<string, DataDiffView[]> = {};
  dataDiff = async (taskId: string) => this.dataDiffs[taskId] ?? [];
  data = {
    get: async (collection: string, key?: DataKey) => (this.records[collection] ?? []).find((r) => key === undefined || r[this.dataKey] === key) ?? null,
    query: async (collection: string, query: DataQuery = {}) => {
      const all = (this.records[collection] ?? []).filter((r) => Object.entries(query.where ?? {}).every(([f, v]) => r[f] === v));
      return { records: all.slice(0, query.limit ?? 50), total: all.length, invalid: 0 };
    },
    put: async (collection: string, record: DataRecord) => {
      const key = record[this.dataKey] as DataKey | undefined;
      this.records[collection] = [...(this.records[collection] ?? []).filter((r) => key === undefined || r[this.dataKey] !== key), record];
      this.dataChanged({ collection, scope: this.openScope ?? "main", who: "person", op: "put", ...(key !== undefined ? { key } : {}) });
      return record;
    },
    patch: async (collection: string, key: DataKey | undefined, patch: DataRecord) => {
      const prev = (this.records[collection] ?? []).find((r) => key === undefined || r[this.dataKey] === key);
      if (!prev) throw new Error("not found");
      const next = { ...prev, ...patch };
      this.records[collection] = (this.records[collection] ?? []).map((r) => (r === prev ? next : r));
      this.dataChanged({ collection, scope: this.openScope ?? "main", who: "person", op: "patch", ...(key !== undefined ? { key } : {}) });
      return next;
    },
    delete: async (collection: string, key?: DataKey) => {
      const before = this.records[collection] ?? [];
      this.records[collection] = before.filter((r) => key !== undefined && r[this.dataKey] !== key);
      this.dataChanged({ collection, scope: this.openScope ?? "main", who: "person", op: "delete", ...(key !== undefined ? { key } : {}) });
      return before.length !== this.records[collection].length;
    },
    subscribe: (collection: string, scope: string | null, listener: (c: DataChangeView) => void) => {
      const l = (c: DataChangeView) => {
        if (hearsDataChange(c, collection, scope)) listener(c);
      };
      this.dataListeners.add(l);
      return () => {
        this.dataListeners.delete(l);
      };
    },
  };
  /** A write the agent made (for tests of harness UIs that subscribe). */
  emitDataChange(change: DataChangeView) {
    this.dataChanged(change);
  }
  /** The main process sent new settings (a pending field applied, another window's change). */
  emitSettings(state: SettingsState) {
    this.settingsState = state;
    for (const l of this.settingsListeners) l(state);
  }
  settings = {
    get: async () => this.settingsState,
    set: async (field: string, value: unknown): Promise<SettingsResult> => {
      this.settingsSets.push({ field, value });
      if (this.settingsFailure) return this.settingsFailure;
      this.emitSettings({ ...this.settingsState, values: { ...this.settingsState.values, [field]: value } });
      return { ok: true, state: this.settingsState };
    },
    reset: async (): Promise<SettingsResult> => {
      this.settingsResets++;
      if (this.settingsFailure) return this.settingsFailure;
      const defaults = Object.fromEntries((this.state.settings?.fields ?? []).map((f) => [f.name, f.default]));
      this.emitSettings({ values: defaults, pending: [] });
      return { ok: true, state: this.settingsState };
    },
    onChange: (listener: (s: SettingsState) => void) => {
      this.settingsListeners.add(listener);
      return () => {
        this.settingsListeners.delete(listener);
      };
    },
  };
  /** What setupSteps.get answers; submit, complete and skip change it. */
  setupState: SetupStepsState = { steps: {}, blocking: [] };
  /** What setupSteps.values answers, by step id. */
  setupValues: Record<string, Record<string, unknown>> = {};
  /** Calls to setupSteps, in order: "get", "submit:<id>", "complete:<id>", "skip:<id>", "finish", "acknowledge". */
  setupCalls: string[] = [];
  /** What submit was sent, by step id. */
  setupSubmits: Record<string, Record<string, unknown>> = {};
  /** When set, submit, complete and skip answer it instead. */
  setupFailure: SetupStepResult | null = null;
  private setupStepListeners = new Set<(s: SetupStepsState) => void>();
  /** The main process sent the steps' state. */
  emitSetupSteps(state: SetupStepsState) {
    this.setupState = state;
    for (const l of this.setupStepListeners) l(state);
  }
  private markStep(id: string, status: "done" | "skipped"): SetupStepResult {
    if (this.setupFailure) return this.setupFailure;
    const blocking = status === "done" ? this.setupState.blocking.filter((b) => b !== id) : this.setupState.blocking;
    this.emitSetupSteps({ steps: { ...this.setupState.steps, [id]: status }, blocking });
    return { ok: true, state: this.setupState };
  }
  setupSteps = {
    get: async () => {
      this.setupCalls.push("get");
      return this.setupState;
    },
    values: async (id: string) => this.setupValues[id] ?? {},
    submit: async (id: string, value: Record<string, unknown>) => {
      this.setupCalls.push(`submit:${id}`);
      this.setupSubmits[id] = value;
      return this.markStep(id, "done");
    },
    complete: async (id: string) => {
      this.setupCalls.push(`complete:${id}`);
      return this.markStep(id, "done");
    },
    skip: async (id: string) => {
      this.setupCalls.push(`skip:${id}`);
      return this.markStep(id, "skipped");
    },
    finish: async () => {
      this.setupCalls.push("finish");
      return this.setupState;
    },
    acknowledge: async () => {
      this.setupCalls.push("acknowledge");
      return this.setupState;
    },
    onChange: (listener: (s: SetupStepsState) => void) => {
      this.setupStepListeners.add(listener);
      return () => {
        this.setupStepListeners.delete(listener);
      };
    },
  };
  /** The registry; `state.config.profile` is the active one. */
  profileList: ProfileView[] = [];
  /** Calls to profiles, in order: "create:<name>", "open:<id>", "edit:<name>", "archive:<id>", "unarchive:<id>", "delete:<id>". */
  profileCalls: string[] = [];
  /** When set, create, open and edit are refused with it. */
  profileRefusal: Exclude<ProfileResult, { ok: true }> | null = null;
  /** When set, create makes the profile but its switch fails (`failed` with `made`). */
  profileSwitchFails = false;
  private profileListeners = new Set<(s: ProfilesState) => void>();
  private profilesNow(): ProfilesState {
    return { active: this.state.config.profile ?? null, list: this.profileList };
  }
  private profileChanged(): ProfileResult {
    const s = this.profilesNow();
    for (const l of this.profileListeners) l(s);
    return { ok: true, state: this.state };
  }
  private setProfileArchived(id: string, archived: boolean): ProfileResult {
    this.profileCalls.push(`${archived ? "archive" : "unarchive"}:${id}`);
    if (id === this.state.config.profile) return { ok: false, reason: "active" };
    this.profileList = this.profileList.map((p) => (p.id === id ? { ...p, archived } : p));
    return this.profileChanged();
  }
  profiles = {
    get: async () => this.profilesNow(),
    create: async (values: Record<string, unknown>): Promise<ProfileResult> => {
      this.profileCalls.push(`create:${String(values.name)}`);
      if (!this.state.profiles) return { ok: false, reason: "not-ready" };
      if (this.profileRefusal) return this.profileRefusal;
      const title = String(values.name ?? "");
      const id = title
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-");
      const color = typeof values.color === "string" ? { color: values.color } : {};
      this.profileList = [...this.profileList, { id, title, ...color, createdAt: "2026-10-27T10:00:00.000Z", archived: false }];
      // The profile is made, but its switch fails: it is registered, not active, and the answer names it.
      if (this.profileSwitchFails) {
        this.profileChanged();
        return { ok: false, reason: "failed", made: id };
      }
      this.state = { ...this.state, config: { ...this.state.config, profile: id } };
      return this.profileChanged();
    },
    open: async (id: string): Promise<ProfileResult> => {
      this.profileCalls.push(`open:${id}`);
      if (this.profileRefusal) return this.profileRefusal;
      if (!this.profileList.some((p) => p.id === id && !p.archived)) return { ok: false, reason: "unknown" };
      this.state = { ...this.state, config: { ...this.state.config, profile: id } };
      return this.profileChanged();
    },
    // Like the main process: the form's fields come only from `values` (one left out is cleared); a blank name is refused.
    edit: async (values: Record<string, unknown>): Promise<ProfileResult> => {
      const id = this.state.config.profile;
      this.profileCalls.push(`edit:${String(values.name)}`);
      if (!this.state.profiles || id === undefined) return { ok: false, reason: "not-ready" };
      if (this.profileRefusal) return this.profileRefusal;
      const title = typeof values.name === "string" ? values.name.trim() : "";
      if (!title) return { ok: false, reason: "invalid", errors: [{ path: "name", message: "Enter a name" }] };
      const asked = this.state.profiles.form.fields.map((f) => f.name);
      const stored = (this.records.profile ?? []).at(-1) ?? {};
      const kept = Object.fromEntries(Object.entries(stored).filter(([k]) => !asked.includes(k)));
      const given = Object.fromEntries(Object.entries(values).filter(([k]) => asked.includes(k)));
      this.records.profile = [...(this.records.profile ?? []), { ...kept, ...given, name: title }];
      this.profileList = this.profileList.map((p) => (p.id === id ? { ...p, title } : p));
      return this.profileChanged();
    },
    archive: async (id: string) => this.setProfileArchived(id, true),
    unarchive: async (id: string) => this.setProfileArchived(id, false),
    delete: async (id: string): Promise<ProfileResult> => {
      this.profileCalls.push(`delete:${id}`);
      if (id === this.state.config.profile) return { ok: false, reason: "active" };
      this.profileList = this.profileList.filter((p) => p.id !== id);
      return this.profileChanged();
    },
    onChange: (listener: (s: ProfilesState) => void) => {
      this.profileListeners.add(listener);
      return () => {
        this.profileListeners.delete(listener);
      };
    },
  };

  /**
   * Calls to material, in order: "add:<scope>", "link:<scope>:<url>", "confirm:<id>", "grounding:<mode>", "retry:<id>",
   * "decide:<id>:<fragment or ->:<choice>", "remove:<id>", "open:<id>".
   */
  materialCalls: string[] = [];
  materialViews: Record<string, MaterialView> = {};
  /** The choices `confirm` got, in order. */
  materialChoices: unknown[] = [];
  /** What `add` and `addLink` answer; an Error rejects. */
  materialAddResult: MaterialAddResult | Error = { ok: true, added: [], refused: [] };
  /** What `confirm` answers; an Error rejects. */
  materialConfirmResult: MaterialResult | Error = { ok: true };
  /** What `decide` answers; an Error rejects. */
  materialDecideResult: MaterialResult | Error = { ok: true };
  /** What `remove` answers; an Error rejects. */
  materialRemoveResult: MaterialResult | Error = { ok: true };
  /** What `cite` answers per fragment id; absent: no such fragment. */
  citeLabels: Record<string, string> = {};
  /** The scope of every citation lookup, in order. */
  citeScopes: string[] = [];
  private materialListeners = new Set<(v: MaterialView) => void>();
  /** Pushes a view as the main process would. */
  pushMaterial(view: MaterialView) {
    this.materialViews[view.scope] = view;
    for (const l of this.materialListeners) l(view);
  }
  material = {
    list: async (scope: string) => (Object.hasOwn(this.materialViews, scope) ? this.materialViews[scope] : null),
    add: async (scope: string) => {
      this.materialCalls.push(`add:${scope}`);
      if (this.materialAddResult instanceof Error) throw this.materialAddResult;
      return this.materialAddResult;
    },
    addLink: async (scope: string, url: string) => {
      this.materialCalls.push(`link:${scope}:${url}`);
      if (this.materialAddResult instanceof Error) throw this.materialAddResult;
      return this.materialAddResult;
    },
    confirm: async (_scope: string, id: string, choice: unknown) => {
      this.materialCalls.push(`confirm:${id}`);
      this.materialChoices.push(choice);
      if (this.materialConfirmResult instanceof Error) throw this.materialConfirmResult;
      return this.materialConfirmResult;
    },
    setGrounding: async (_scope: string, mode: "strict" | "mixed") => {
      this.materialCalls.push(`grounding:${mode}`);
      return { ok: true as const };
    },
    retry: async (_scope: string, id: string) => {
      this.materialCalls.push(`retry:${id}`);
      return { ok: true as const };
    },
    decide: async (_scope: string, id: string, fragment: string | null, choice: MaterialChoice) => {
      this.materialCalls.push(`decide:${id}:${fragment ?? "-"}:${choice}`);
      if (this.materialDecideResult instanceof Error) throw this.materialDecideResult;
      return this.materialDecideResult;
    },
    remove: async (_scope: string, id: string): Promise<MaterialResult> => {
      this.materialCalls.push(`remove:${id}`);
      if (this.materialRemoveResult instanceof Error) throw this.materialRemoveResult;
      return this.materialRemoveResult;
    },
    open: async (_scope: string, id: string) => {
      this.materialCalls.push(`open:${id}`);
      return { ok: true as const };
    },
    cite: async (scope: string, id: string) => {
      this.citeScopes.push(scope);
      return Object.hasOwn(this.citeLabels, id) ? { label: this.citeLabels[id] } : null;
    },
    onChange: (l: (v: MaterialView) => void) => {
      this.materialListeners.add(l);
      return () => {
        this.materialListeners.delete(l);
      };
    },
  };
}
