import type {
  AppConfig,
  AppState,
  ChatEntry,
  ChoiceOption,
  EngineError,
  EngineStatus,
  Event,
  FolderPick,
  HarnessClient,
  HistoryItem,
  HistoryTaskView,
  MoveResult,
  RunningSetup,
  SendOptions,
  SetupOutput,
  SetupResult,
  SetupStep,
  TaskView,
  TestResult,
  TextSize,
  UsageSummary,
} from "../src/client";

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
  /** Files revealPath was asked to show. */
  revealedFiles: string[] = [];
  async revealPath(file: string) {
    this.revealedFiles.push(file);
    return this.openResult;
  }
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
}
