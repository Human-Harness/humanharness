import { type ComponentProps, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PARALLEL_MAX } from "@humanharness/harness-sdk/parallel";
import { BackupNotice, type FolderMove, MovePlaces, needsBackupNotice, useFolderMove } from "./BackupNotice";
import { TopBar } from "./chrome";
import { Group, Row, Rx, SectionHead as GuideSectionHead, SettingsNav } from "./guide";
import { Icon } from "./guide/icons";
import { type AppConfig, type AppState, type Appearance, type HarnessClient, type RunningSetup, TEXT_SIZES, type TextSize, isConfigured } from "./client";
import { ConnectionsTab } from "./connections/ConnectionsTab";
import { EngineTab } from "./EngineTab";
import { trapTab } from "./focus";
import { HarnessSettingsTab } from "./HarnessSettingsTab";
import { type Language, languageName } from "@humanharness/harness-sdk/language";
import { ownName, systemLanguage } from "./language";
import type { LanguageControl } from "./language-control";
import { LanguageChooser } from "./LanguageChooser";
import { useLatestConfig } from "./latest-config";
import { ModelsTab } from "./ModelsTab";
import { JobsTab } from "./parallel/JobsTab";
import { PluginsTab, type SettingsSub } from "./plugins/PluginsTab";
import { usePluginsView } from "./plugins/usePlugins";
import { ProfilesSection } from "./ProfilesSection";
import { focusSetting } from "./search/focus-setting";
import { SetupStepsList } from "./SetupStepsList";
import { SidekickTab, sidekickTitleKey } from "./sidekick/SidekickTab";
import { type SettingsTab, tabLabel, visibleTabs } from "./settings-tabs";
import { useSidekick } from "./sidekick/useSidekick";
import { UsageTab } from "./UsageTab";

export { type SettingsTab, tabLabel, visibleTabs } from "./settings-tabs";

const TEXT_SIZE_KEYS = Object.keys(TEXT_SIZES) as TextSize[];
/** The key that zooms with + and −: ⌘ on macOS, Ctrl elsewhere. */
const ZOOM_KEY = /Mac/.test(navigator.userAgent) ? "⌘" : "Ctrl";

/**
 * Settings as a page (DESIGN.md "Settings", template 5): in place of the screen (which stays mounted, hidden), its own
 * top bar with only Volver on the left, the section nav on the left and the section on the right.
 */
export function SettingsPage({
  client,
  state,
  tab,
  onTab,
  onChange,
  onClose,
  from,
  onSetup,
  move: shared,
  onStartAction,
  language,
  focus,
}: {
  client: HarnessClient;
  state: AppState;
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  onChange: (state: AppState) => void;
  onClose: () => void;
  /** The name of the place Settings opened over: Volver says it. Absent: "Tasks". */
  from?: string;
  /**
   * Opens the setup flow (the empty state of the harness's tab, Engine, Models and Usage before the app is configured);
   * at a harness step when one is given (the Setup list's Do it again / Do it now).
   */
  onSetup: (step?: string) => void;
  /** The app's folder move (HarnessApp), so a move outlives the page; without it the page keeps its own. */
  move?: FolderMove;
  /** Settings › Jobs' Start on a needs-you run: the action starts in the chat on screen; false when it couldn't. */
  onStartAction?: (action: string, scope: string | null) => boolean;
  /** Language on demand (plan 5b); absent (no `client.language`): the read-only Language row (D0). */
  language?: LanguageControl;
  /** Search opened the page at this field (§6); `n` changes on each search. */
  focus?: { id: string; n: number };
}) {
  const { t } = useTranslation();
  const own = useFolderMove(client, onChange);
  const move = shared ?? own;
  const runningId = useId();
  const baseId = useId();
  const tabId = (id: SettingsTab) => `${baseId}-tab-${id}`;
  const panelId = `${baseId}-panel`;
  // Models only shows when the main process sent its view (every packaged app does); the harness's tab only when it
  // declares settings or setup steps (harness-settings D0, setup-steps D0); Sidekick only when main sends it (sidekick D0);
  // Plugins only when the harness takes them (plugins D0); Connections only when it declares secrets (tools D0); Jobs
  // only when it declares jobs (parallel D0).
  const tabs = visibleTabs(state);
  const configured = isConfigured(state.config);
  // The tab reads as the section's title (spec §8); its id stays "sidekick".
  const sidekick = useSidekick(client, state.sidekick !== undefined);
  const sidekickTab = t(sidekickTitleKey(sidekick?.sidekicks));
  // A section that needs the person carries an orange count (§5.5): Plugins, for those waiting for a review or turned
  // off after crashes. Read only when the harness takes plugins (D0); the tab itself still rescans when it opens.
  const plugins = usePluginsView(client, tabs.includes("plugins"));
  const attention: Partial<Record<SettingsTab, number>> = {
    plugins: plugins?.plugins.filter((p) => p.status === "review" || p.status === "crashed").length ?? 0,
  };
  const titleId = useId();
  const back = from ?? t("rail.tasks");
  const doneRef = useRef<HTMLButtonElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  /** An install, update, sign-in or sign-out is running: the page stays open (it shows how it goes). */
  const [running, setRunning] = useState<RunningSetup | null>(null);
  const runningRef = useRef(false);
  runningRef.current = running !== null;
  const close = () => {
    if (!runningRef.current) onCloseRef.current();
  };
  /**
   * A screen inside a section (a plugin's detail or review): the top bar names the section and goes back to its list,
   * and so does Escape (DESIGN.md "Settings": "← Plugins").
   */
  const [sub, setSub] = useState<SettingsSub | null>(null);
  const subRef = useRef(sub);
  subRef.current = sub;

  useEffect(() => {
    let heard = false;
    const off = client.onSetupOutput((o) => {
      if (o.kind === "start" || o.kind === "end") {
        heard = true;
        setRunning(o.kind === "start" ? { engineId: o.engineId, step: o.step } : null);
      }
    });
    // A step may already be running (started before this page opened, e.g. before a reload).
    client.getSetup().then(
      (r) => {
        if (!heard && r) setRunning({ engineId: r.engineId, step: r.step });
      },
      () => {},
    );
    return off;
  }, [client]);

  // A disabled Done can't hold focus: while a step runs, focus goes to the selected tab instead.
  const isRunning = running !== null;
  useEffect(() => {
    const active = document.activeElement;
    if (isRunning && (active === doneRef.current || active === document.body || active === null)) {
      document.getElementById(tabId(tab))?.focus();
    }
    // Only when a step starts (or is found running); the tab is read as it is then.
  }, [isRunning]);

  // Whatever opened the page (the gear, the engine pill) gets focus back when it closes. Read before the browser moves
  // focus off the screen the page hides; given back once that screen shows again (a passive cleanup runs after it).
  const openerRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    doneRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const page = pageRef.current;
      if (!page) return;
      if (e.key === "Escape" && !runningRef.current) {
        // Handled: focus mode's window listener leaves this Escape alone.
        e.preventDefault();
        if (subRef.current) subRef.current.back();
        else onCloseRef.current();
      }
      if (e.key === "Tab") trapTab(page, e);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const opener = openerRef.current;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // Search (§6): the field gets focus once its tab rendered; a new search focus (`n`) runs it again.
  const focusN = focus?.n;
  useEffect(() => {
    if (!focus) return;
    const panel = document.getElementById(panelId);
    return panel ? focusSetting(panel, focus.id) : undefined;
  }, [focusN, tab]);

  return (
    <main ref={pageRef} className="hh-settings-page" aria-labelledby={titleId}>
      <TopBar
        leading={
          <Rx.Button
            ref={doneRef}
            variant="ghost"
            color="gray"
            size="1"
            className="hh-settings-done"
            aria-label={t("settings.backTo", { place: sub?.label ?? back })}
            disabled={running !== null}
            aria-describedby={running ? runningId : undefined}
            onClick={sub ? sub.back : close}
          >
            <Icon name="back" size={18} />
            {sub?.label ?? back}
          </Rx.Button>
        }
      />
      <div className="hh-settings-body">
        <SettingsNav
          title={t("settings.title")}
          titleId={titleId}
          label={t("settings.sections")}
          items={tabs.map((id) => ({ id, label: tabLabel(t, state, id, sidekickTab), count: attention[id] ?? 0 }))}
          current={tab}
          onPick={onTab}
          tabId={tabId}
          panelId={panelId}
        />
        <div className="hh-settings-main">
          {running && (
            <Rx.Callout.Root color="gray" mb="5">
              <Rx.Flex align="center" justify="between" gap="3">
                <Rx.Callout.Text id={runningId} role="status">
                  {t(`settings.running.${running.step}`, { engine: state.engines.find((e) => e.id === running.engineId)?.name ?? running.engineId })}{" "}
                  {t("settings.runningWait")}
                </Rx.Callout.Text>
                <Rx.Button size="1" variant="outline" color="gray" onClick={() => void client.cancelSetup().catch(() => {})}>
                  {t("settings.runningCancel")}
                </Rx.Button>
              </Rx.Flex>
            </Rx.Callout.Root>
          )}
          <div id={panelId} role="tabpanel" aria-labelledby={tabId(tab)}>
            {tab === "general" && <GeneralTab client={client} state={state} onChange={onChange} move={move} language={language} />}
            {tab !== "general" && !configured && <NotConfigured state={state} onSetup={onSetup} />}
            {tab === "engine" && configured && <EngineTab client={client} state={state} onChange={onChange} setupEngine={running?.engineId} />}
            {tab === "models" && configured && <ModelsTab client={client} state={state} onChange={onChange} {...(focus && focus.id.startsWith("models.") ? { focus: { part: focus.id === "models.levels" ? ("levels" as const) : ("tasks" as const), n: focus.n } } : {})} />}
            {tab === "sidekick" && configured && <SidekickTab client={client} onModels={() => onTab("models")} scopes={state.scopes} />}
            {tab === "plugins" && configured && <PluginsTab client={client} onSub={setSub} />}
            {tab === "connections" && configured && state.connections && <ConnectionsTab client={client} />}
            {tab === "jobs" && configured && state.jobs && <JobsTab client={client} state={state} onChange={onChange} {...(onStartAction ? { onStartAction } : {})} />}
            {tab === "usage" && configured && <UsageTab client={client} state={state} />}
            {tab === "harness" && configured && (
              <>
                <GuideSectionHead line={t("settings.line.harness", { name: state.harness.name })} />
                {state.setup && (
                  <SetupStepsList
                    client={client}
                    steps={state.setup}
                    onRun={(id) => onSetup(id)}
                    onConnections={state.connections ? () => onTab("connections") : undefined}
                  />
                )}
                {state.settings && <HarnessSettingsTab client={client} view={state.settings} {...(focus ? { focus } : {})} />}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

/** English and its variants (en-GB) show the bundled English: nothing to translate. */
const isEnglish = (tag: string): boolean => tag === "en" || tag.startsWith("en-");

/** A row's small action (DESIGN.md "Settings": Editar, Reactivar, Restaurar todo are quiet buttons). */
function Quiet(props: Omit<ComponentProps<typeof Rx.Button>, "variant" | "color" | "size">) {
  return <Rx.Button variant="ghost" color="gray" size="1" {...props} />;
}

/** A line under a row: what is happening now, and its one action (DESIGN.md "Status line"). */
function StatusLine({ text, role, action }: { text: string; role?: "status"; action?: ReactNode }) {
  return (
    <Rx.Flex align="center" justify="between" gap="3">
      <Rx.Text size="1" color="gray" role={role}>
        {text}
      </Rx.Text>
      {action}
    </Rx.Flex>
  );
}

/**
 * Settings › General › Language (spec §3, §5, §6): the language by its own name and its English name, Change…, a run's
 * progress and Cancel, Try again after a stopped run (it resumes, Q6), and Translate when texts are missing (new texts,
 * or a saved language with no translation yet). Without a language control (D0): the read-only row of plan 5a.
 */
function LanguageRow({ state, language }: { state: AppState; language?: LanguageControl }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<null | { pick?: Language } | { notice: Language }>(null);
  const reasonId = useId();
  const view = language?.view ?? null;
  const lang = view?.language ?? state.config.language ?? systemLanguage();
  const run = view?.run ?? null;
  const running = run?.status === "running";
  const can = view?.canTranslate === true;
  const stopped = run && (run.status === "failed" || run.status === "cancelled") ? run : null;
  const untranslated = view !== null && !isEnglish(lang) && !running && view.missing > 0;
  const none = untranslated && !view.cached.some((c) => c.tag === lang);
  // Asking for the state runs an engine check, so only a shown row asks. `language` is new on every render; `load` is stable.
  const load = language?.load;
  useEffect(() => load?.(), [load]);
  // The notice opens only when an engine can translate; a stopped run resumes from it (Q6).
  const notice = (tag: Language) => {
    if (can) setOpen({ notice: tag });
  };
  const lines = (
    <>
      {language && (running || stopped) && (
        // One line and one live region for a run's progress and its stop, so the change from one to the other is
        // announced. While the chooser is open its own progress dialog speaks: the line has no role then.
        <StatusLine
          text={running ? t("language.progress", { done: run.done, total: run.total }) : stopped?.reason === "quota" ? t("language.stoppedQuota") : t("language.stopped")}
          {...(open ? {} : { role: "status" as const })}
          action={
            running ? (
              <Rx.Button size="1" variant="outline" color="gray" onClick={() => language.cancel()}>
                {t("language.cancel")}
              </Rx.Button>
            ) : (
              stopped && (
                <Rx.Button size="1" variant="outline" color="gray" disabled={!can} aria-describedby={!can ? reasonId : undefined} onClick={() => notice(stopped.tag)}>
                  {t("language.tryAgain")}
                </Rx.Button>
              )
            )
          }
        />
      )}
      {language && !stopped && untranslated && (
        <StatusLine
          text={none ? t("language.notYet", { language: ownName(lang) }) : t("language.newTexts")}
          action={
            <Rx.Button size="1" variant="outline" color="gray" disabled={!can} aria-describedby={!can ? reasonId : undefined} onClick={() => notice(lang)}>
              {t("language.translate")}
            </Rx.Button>
          }
        />
      )}
      {language && view && !can && (stopped || untranslated) && (
        <Rx.Text as="p" size="1" color="gray" id={reasonId} mt="2">
          {t("language.needsEngine")}
        </Rx.Text>
      )}
    </>
  );
  const hasLines = language !== undefined && (running || stopped !== null || untranslated);
  return (
    <>
      <Row label={t("settings.language")} hint={t("settings.languageHint")} data-setting="general.language" {...(hasLines ? { below: lines } : {})}>
        <Rx.Text size="2">
          <span lang={lang}>{ownName(lang)}</span>
          {!isEnglish(lang) && (
            <Rx.Text size="1" color="gray" lang="en" ml="2">
              {languageName(lang)}
            </Rx.Text>
          )}
        </Rx.Text>
        {language && view && (
          <Quiet onClick={() => setOpen({})} disabled={running}>
            {t("language.change")}
          </Quiet>
        )}
      </Row>
      {language && open && <LanguageChooser control={language} start={open} harnessName={state.harness.name} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Backup state as a badge (DESIGN.md "Status as a badge"): green kept online, orange only here, gray you keep your own. */
function backupColor(kind: "synced" | "git-remote" | "local", dismissed: boolean): "green" | "orange" | "gray" {
  return kind === "local" ? (dismissed ? "gray" : "orange") : "green";
}

function GeneralTab({
  client,
  state,
  onChange,
  move,
  language,
}: {
  client: HarnessClient;
  state: AppState;
  onChange: (s: AppState) => void;
  move: FolderMove;
  language?: LanguageControl;
}) {
  const { t } = useTranslation();
  const placesId = useId();
  const sizeId = useId();
  /** The places to move the folder to are open (the backup notice, when it shows, offers them itself). */
  const [moveOpen, setMoveOpen] = useState(false);
  const offerMove = !needsBackupNotice(state);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // A move that worked closes the list (the folder row shows where it is now); focus stays on its toggle.
  useEffect(() => {
    if (!move.moved) return;
    setMoveOpen(false);
    const active = document.activeElement;
    const lost = active === null || active === document.body || document.getElementById(placesId)?.contains(active) === true;
    if (lost && toggleRef.current?.isConnected) toggleRef.current.focus();
  }, [move.moved]);
  /** Rejects when the save fails (ParallelSection says so); `save` swallows it. */
  const saveOrFail = (patch: AppConfig) => client.saveConfig(patch).then(onChange);
  const save = (patch: AppConfig) => saveOrFail(patch).catch(() => {});
  const backup = state.backup?.status;
  const dismissed = backup?.kind === "local" && state.config.backupDismissed === true;
  const backupText = !backup
    ? null
    : backup.kind === "synced"
      ? t("backup.status.synced", { provider: t(`backup.provider.${backup.provider}`) })
      : dismissed
        ? t("backup.status.dismissed")
        : t(`backup.status.${backup.kind}`);
  const folder = state.config.folder;

  return (
    <div className="hh-tab">
      <GuideSectionHead line={t("settings.line.general")} />
      <Group>
        <LanguageRow state={state} language={language} />
        <Row label={t("settings.appearance")} data-setting="general.appearance">
          <Rx.SegmentedControl.Root value={state.config.appearance ?? "system"} onValueChange={(v) => void save({ appearance: v as Appearance })} aria-label={t("settings.appearance")}>
            <Rx.SegmentedControl.Item value="system">{t("settings.appearanceSystem")}</Rx.SegmentedControl.Item>
            <Rx.SegmentedControl.Item value="light">{t("settings.appearanceLight")}</Rx.SegmentedControl.Item>
            <Rx.SegmentedControl.Item value="dark">{t("settings.appearanceDark")}</Rx.SegmentedControl.Item>
          </Rx.SegmentedControl.Root>
        </Row>
        <Row label={t("settings.textSize")} hint={t("settings.textSizeHint", { mod: ZOOM_KEY })} hintId={`${sizeId}-hint`} data-setting="general.textSize">
          <Rx.SegmentedControl.Root value={state.config.textSize ?? "normal"} onValueChange={(v) => void save({ textSize: v as TextSize })} aria-label={t("settings.textSize")} aria-describedby={`${sizeId}-hint`}>
            {TEXT_SIZE_KEYS.map((size) => (
              <Rx.SegmentedControl.Item key={size} value={size}>
                {t(`settings.textSizes.${size}`)}
              </Rx.SegmentedControl.Item>
            ))}
          </Rx.SegmentedControl.Root>
        </Row>
        {folder && (
          <Row
            label={t("settings.folder")}
            hint={
              <>
                {/* Plain hint text (Marco, 2026-11-04): breaks anywhere, no code chip. */}
                <span className="hh-gd-path">{folder}</span>
                <br />
                {t("settings.folderFixed")}
              </>
            }
            data-setting="general.folder"
            {...(offerMove && moveOpen
              ? {
                  below: (
                    <div id={placesId}>
                      <MovePlaces state={state} move={move} />
                    </div>
                  ),
                }
              : {})}
          >
            <Quiet onClick={() => void client.revealFolder()}>{t("settings.reveal")}</Quiet>
            {offerMove && (
              <Quiet ref={toggleRef} aria-expanded={moveOpen} aria-controls={placesId} onClick={() => setMoveOpen((o) => !o)}>
                {t("backup.moveFolder")}
              </Quiet>
            )}
          </Row>
        )}
        {folder && backup && backupText && (
          <Row label={t("backup.title")} data-setting="general.backup">
            <Rx.Badge color={backupColor(backup.kind, dismissed)}>{backupText}</Rx.Badge>
            {dismissed && <Quiet onClick={() => void save({ backupDismissed: false })}>{t("backup.showAgain")}</Quiet>}
          </Row>
        )}
      </Group>
      {state.parallel && <ParallelSection state={state} save={saveOrFail} />}
      {state.profiles && <ProfilesSection client={client} state={state} onChange={onChange} />}
      <BackupNotice client={client} state={state} onChange={onChange} move={move} />

      <Group title={t("settings.about")}>
        <Row label={state.harness.name}>
          <Rx.Badge color="gray">{t("settings.version", { version: state.harness.version })}</Rx.Badge>
        </Row>
        <Row label={t("settings.madeBy", { author: state.harness.author })}>
          {state.harness.donate && (
            <Rx.Button asChild size="1" variant="outline" color="gray">
              <a href={state.harness.donate} target="_blank" rel="noreferrer">
                {t("settings.support")}
              </a>
            </Rx.Button>
          )}
        </Row>
      </Group>
    </div>
  );
}

const CAP_CHOICES = Array.from({ length: PARALLEL_MAX }, (_, i) => i + 1);

/**
 * Settings › General for a harness that declares `parallel` (spec §7, §9.2): how many tasks and jobs run at once, and
 * the notification when a task waits. A cap saves the person's whole `parallel` (the store merges the top level only),
 * so the other cap they set stays; one they never set keeps following the manifest. An engine not yet checked with
 * two sessions holds both at 1.
 */
function ParallelSection({ state, save }: { state: AppState; save: (patch: AppConfig) => Promise<unknown> }) {
  const { t } = useTranslation();
  const id = useId();
  // A failed save says so above the card (DESIGN.md "Settings") and rejects inside `latest.save`, so its value is dropped.
  const [saveFailed, setSaveFailed] = useState(false);
  const said = (saving: Promise<unknown>) =>
    void saving.then(
      () => setSaveFailed(false),
      () => setSaveFailed(true),
    );
  const info = state.parallel!;
  const held = info.heldReason === "engine";
  const engine = state.engines.find((e) => e.id === state.config.engineId)?.name ?? state.config.engineId ?? "";
  // The other cap may still be on its way to main: each save builds on the last one asked for, not on `state`.
  const latest = useLatestConfig(state.config.parallel);
  // A number in a small range is a select (DESIGN.md "Control per kind of setting").
  const cap = (key: "tasks" | "jobs", label: string) => (
    <Rx.Select.Root value={String(info.caps[key])} disabled={held} onValueChange={(v) => said(latest.save({ ...latest.get(), [key]: Number(v) }, (parallel) => save({ parallel })))}>
      <Rx.Select.Trigger id={`${id}-${key}`} aria-label={label} aria-describedby={held ? `${id}-held` : undefined} />
      <Rx.Select.Content position="popper">
        {CAP_CHOICES.map((n) => (
          <Rx.Select.Item key={n} value={String(n)}>
            {n}
          </Rx.Select.Item>
        ))}
      </Rx.Select.Content>
    </Rx.Select.Root>
  );
  return (
    <>
      {saveFailed && (
        <Rx.Callout.Root color="red" role="alert" mb="3">
          <Rx.Callout.Text>{t("parallel.saveFailed")}</Rx.Callout.Text>
        </Rx.Callout.Root>
      )}
      <Group title={t("parallel.parallelSection")}>
        <Row label={t("parallel.tasksAtOnce")} htmlFor={`${id}-tasks`} {...(held ? { hint: t("parallel.engineHeld", { engine }), hintId: `${id}-held` } : {})} data-setting="general.tasksAtOnce">
          {cap("tasks", t("parallel.tasksAtOnce"))}
        </Row>
        <Row label={t("parallel.jobsAtOnce")} htmlFor={`${id}-jobs`} data-setting="general.jobsAtOnce">
          {cap("jobs", t("parallel.jobsAtOnce"))}
        </Row>
        <Row label={t("parallel.notifyWaiting")} htmlFor={`${id}-notify`} data-setting="general.notifyWaiting">
          <Rx.Switch id={`${id}-notify`} checked={info.notifyWaiting} onCheckedChange={(on) => said(save({ notifyWaiting: on }))} />
        </Row>
      </Group>
    </>
  );
}

/** The harness's tab, Engine, Models and Usage before the app is configured: they all lead to the setup flow. */
function NotConfigured({ state, onSetup }: { state: AppState; onSetup: (step?: string) => void }) {
  const { t } = useTranslation();
  const name = state.harness.name;
  return (
    <Rx.Card size="3">
      <Rx.Flex direction="column" gap="3">
        <Rx.Heading as="h2" size="3">
          {t("setupFlow.notConfiguredTitle")}
        </Rx.Heading>
        <Rx.Text as="p" size="2" color="gray">
          {t("setupFlow.notConfiguredText")}
        </Rx.Text>
        <Rx.Flex justify="end">
          {/* No step: the click event must not arrive as one (the flow would open that step alone). */}
          <Rx.Button size="2" onClick={() => onSetup()}>
            {t("setupFlow.configure", { name })}
          </Rx.Button>
        </Rx.Flex>
      </Rx.Flex>
    </Rx.Card>
  );
}
