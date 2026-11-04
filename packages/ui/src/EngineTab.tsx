import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "./guide/icons";
import { type AppState, type EngineStatus, type HarnessClient, engineProblem } from "./client";
import { EngineOnboarding, useLegalLang } from "./EngineOnboarding";
import { Group, Row, Rx, SectionHead } from "./guide";

/** The reason behind a failed call, without Electron's English "Error invoking remote method …: Error:" wrapper. */
export function errorDetail(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "");
}

/** Settings → Engine (and the setup flow's engine step): engine tiles, onboarding and the engine in use. */
export function EngineTab({
  client,
  state,
  onChange,
  setupEngine,
  setup = false,
  onSelection,
}: {
  client: HarnessClient;
  state: AppState;
  onChange: (s: AppState) => void;
  /** The engine whose install, update, sign-in or sign-out is running: its tile stays selected until it ends. */
  setupEngine?: string;
  /** Shown as a step of the setup flow, which saves the engine itself: no "Use <engine>" button. */
  setup?: boolean;
  /** Told whenever the selected engine or its readiness changes. */
  onSelection?: (engineId: string, ready: boolean) => void;
}) {
  const { t } = useTranslation();
  const legalLang = useLegalLang();
  const current = state.config.engineId;
  const [selected, setSelected] = useState(current ?? state.engines[0]?.id);
  const [statuses, setStatuses] = useState<Record<string, EngineStatus>>({});
  const [busy, setBusy] = useState<null | "use" | "logout">(null);
  const [failed, setFailed] = useState(false);
  /**
   * Signing out runs in Terminal (`terminalSteps.logout`): says to finish there, then check again.
   * "manual": the command was copied but Terminal did not open, so the person opens it by hand.
   */
  const [signOutHint, setSignOutHint] = useState<false | "opened" | "manual">(false);
  /** Signing out asks first, inline under its row (DESIGN.md "Button": a danger action always asks). */
  const [askSignOut, setAskSignOut] = useState(false);
  /** Why checking an engine failed, by engine id. */
  const [checkErrors, setCheckErrors] = useState<Record<string, string>>({});
  const ids = state.engines.map((e) => e.id).join(",");
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;

  const refresh = useCallback(
    async (id: string) => {
      setCheckErrors(({ [id]: _, ...rest }) => rest);
      try {
        const status = await client.engineStatus(id);
        setStatuses((all) => ({ ...all, [id]: status }));
      } catch (err) {
        setCheckErrors((all) => ({ ...all, [id]: errorDetail(err) }));
      }
    },
    [client],
  );

  // A running step keeps its engine on screen (its progress is shown only there).
  useEffect(() => {
    if (setupEngine) setSelected(setupEngine);
  }, [setupEngine]);

  useEffect(() => {
    for (const id of ids.split(",").filter(Boolean)) void refresh(id);
  }, [ids, refresh]);

  const engine = state.engines.find((e) => e.id === selected);
  const checkError = selected ? checkErrors[selected] : undefined;
  const status = selected && checkError === undefined ? statuses[selected] : undefined;
  const ready = status ? engineProblem(status) === null : false;

  useEffect(() => {
    if (selected) onSelectionRef.current?.(selected, ready);
  }, [selected, ready]);

  // The Terminal sign-out hint belongs to the engine it was shown for.
  useEffect(() => {
    setSignOutHint(false);
    setAskSignOut(false);
  }, [selected]);

  const use = async () => {
    if (!selected) return;
    setBusy("use");
    setFailed(false);
    try {
      onChange(await client.saveConfig({ engineId: selected }));
    } catch {
      setFailed(true);
    }
    setBusy(null);
  };
  const signOut = async () => {
    if (!selected) return;
    // OpenCode (spec §2): the person signs out in Terminal; the app copies the command and opens it.
    if (engine?.terminalSteps?.logout) {
      setBusy("logout");
      setFailed(false);
      try {
        await client.copySetupCommand(selected, "logout");
        // The command is on the clipboard: a Terminal that does not open is a step to do by hand, not a failure.
        const opened = await client.openTerminal().then(
          () => true,
          () => false,
        );
        setSignOutHint(opened ? "opened" : "manual");
      } catch {
        setFailed(true);
      }
      setBusy(null);
      return;
    }
    setBusy("logout");
    setFailed(false);
    const result = await client.runSetup(selected, "logout").catch(() => ({ ok: false }));
    setBusy(null);
    await refresh(selected);
    if (!result.ok) setFailed(true);
  };

  /**
   * An engine's state as a badge. In the Assistant a missing step is orange, what comes next (DESIGN.md tag colors);
   * Settings keeps it gray, as stage 2b set it.
   */
  const badge = (e: (typeof state.engines)[number]) => {
    const s = statuses[e.id];
    const problem = s ? engineProblem(s) : undefined;
    const off = checkErrors[e.id] !== undefined;
    const ok = !off && s !== undefined && problem === null;
    const next = setup && !off && problem !== undefined && problem !== null;
    const label = off ? t("home.notConnected") : !s ? t("home.checking") : ok ? t("home.connected") : next ? t(`setupFlow.tileBadge.${problem}`) : t("home.notConnected");
    return (
      <Rx.Badge color={ok ? "green" : next ? "orange" : "gray"} variant="soft">
        {label}
      </Rx.Badge>
    );
  };
  // Read-only data: the row with its value as a grey tag (DESIGN.md "Settings rows").
  const readOnly = (key: string, label: string, value: string | null) => (
    <Row key={key} label={label}>
      <Rx.Badge color="gray" variant="soft">
        {value}
      </Rx.Badge>
    </Row>
  );
  const link = (href: string, text: string) => (
    <a href={href} target="_blank" rel="noreferrer">
      {text}
    </a>
  );

  /**
   * The engines as a choice with a description (DESIGN.md "Engine choice"): logo, name, then its state as badges. The
   * Assistant adds the maker and what it needs, in 12 grey, since the person has not seen them yet.
   */
  const choice = (
    <Rx.Box asChild mb={setup ? undefined : "5"}>
      <section data-setting="engine.engine">
        <Rx.Card size="3">
          <Rx.RadioGroup.Root value={selected ?? ""} onValueChange={setSelected} aria-label={t("engine.tilesLabel")}>
            <Rx.Flex direction="column" gap="4">
              {state.engines.map((e) => (
                <Rx.RadioGroup.Item key={e.id} value={e.id} data-engine={e.id} disabled={setupEngine !== undefined && e.id !== setupEngine}>
                  <Rx.Flex align="start" gap="3">
                    {e.logo ? <img src={e.logo} alt="" width={24} height={24} /> : <Icon name="engine" size={18} />}
                    <Rx.Flex direction="column" gap="1">
                      <Rx.Text size="2" weight="medium">
                        {e.name}
                      </Rx.Text>
                      {setup && (
                        <Rx.Text size="1" color="gray">
                          {e.provider} · {t("setup.engineRequires", { plan: e.requires })}
                        </Rx.Text>
                      )}
                      <Rx.Flex gap="2" wrap="wrap" align="center">
                        {badge(e)}
                        {e.id === current && (
                          <Rx.Badge color="green" variant="soft">
                            {t("engine.current")}
                          </Rx.Badge>
                        )}
                        {e.status === "pending" && (
                          <Rx.Text size="1" color="gray">
                            {t("setup.enginePending")}
                          </Rx.Text>
                        )}
                      </Rx.Flex>
                    </Rx.Flex>
                  </Rx.Flex>
                </Rx.RadioGroup.Item>
              ))}
            </Rx.Flex>
          </Rx.RadioGroup.Root>
          {/* The card's end: a caption, and on the right the one action (DESIGN.md "Card and settings rows"). The
              Assistant saves the engine itself, with its Next. */}
          <Rx.Flex align="center" justify="between" gap="3" mt="4" wrap="wrap">
            <Rx.Text as="p" size="1" color="gray">
              {t("engine.moreSoon")}
            </Rx.Text>
            {!setup && engine && status && ready && selected !== current && (
              <Rx.Button size="1" disabled={busy !== null} onClick={() => void use()}>
                {t("engine.use", { engine: engine.name })}
              </Rx.Button>
            )}
          </Rx.Flex>
        </Rx.Card>
      </section>
    </Rx.Box>
  );

  const failedNotice = failed && (
    <Rx.Callout.Root color="red" role="alert" mb={setup ? undefined : "3"}>
      <Rx.Callout.Text>{t("engine.failed")}</Rx.Callout.Text>
    </Rx.Callout.Root>
  );

  const checking = engine && (
    <>
      {checkError !== undefined && (
        <Rx.Callout.Root color="red" mb={setup ? undefined : "5"}>
          <Rx.Flex direction="column" gap="2" role="alert">
            <Rx.Callout.Text>{t("engine.checkFailed", { engine: engine.name })}</Rx.Callout.Text>
            {checkError && (
              <details>
                <Rx.Text size="1" asChild>
                  <summary>{t("engine.details")}</summary>
                </Rx.Text>
                <Rx.Text as="p" size="1" className="hh-gd-path">
                  {checkError}
                </Rx.Text>
              </details>
            )}
          </Rx.Flex>
          <Rx.Box>
            <Rx.Button size="1" variant="outline" color="gray" onClick={() => void refresh(engine.id)}>
              {t("engine.recheck")}
            </Rx.Button>
          </Rx.Box>
        </Rx.Callout.Root>
      )}
      {checkError === undefined && !status && (
        <Rx.Text as="p" size="2" color="gray" role="status">
          {t("engine.checking", { engine: engine.name })}
        </Rx.Text>
      )}
      {/* Not ready: the step it still needs, in a card of its own (spec §9). */}
      {status && !ready && (
        <Rx.Box mb={setup ? undefined : "5"}>
          <EngineOnboarding key={engine.id} client={client} engine={engine} status={status} refresh={() => refresh(engine.id)} />
        </Rx.Box>
      )}
    </>
  );

  /**
   * A ready engine: what it is, signing out, its plan, data and version. In the Assistant it is the step's
   * "One last check" (UI refresh spec §5.6) and carries the provider's terms, read for the first time here.
   */
  const readyCard = engine && status && ready && (
    <Group
      flush={setup}
      title={setup ? t("setupFlow.lastCheck") : engine.name}
      tag={
        selected === current && (
          <Rx.Badge color="green" variant="soft">
            {t("engine.current")}
          </Rx.Badge>
        )
      }
    >
      {engine.mock
        ? // The test engine: nothing to sign out of, no plan, no provider to disclose.
          [
            readOnly("model", t("mock.model"), t("mock.modelName")),
            readOnly("answers", t("mock.answers"), t("mock.answersValue")),
            readOnly("data", t("mock.data"), t("mock.dataValue")),
            readOnly("plan", t("mock.plan"), t("mock.planValue")),
          ]
        : [
            <Row
              key="ready"
              label={t("engine.ready", { engine: engine.name })}
              below={
                askSignOut && (
                  <Rx.Flex align="center" justify="between" gap="3" wrap="wrap">
                    <Rx.Text as="p" size="2">
                      {t("engine.signOutAsk", { engine: engine.name })}
                    </Rx.Text>
                    <Rx.Flex gap="2">
                      <Rx.Button
                        size="1"
                        variant="soft"
                        color="red"
                        onClick={() => {
                          setAskSignOut(false);
                          void signOut();
                        }}
                      >
                        {t("engine.signOut")}
                      </Rx.Button>
                      <Rx.Button size="1" variant="outline" color="gray" onClick={() => setAskSignOut(false)}>
                        {t("engine.cancel")}
                      </Rx.Button>
                    </Rx.Flex>
                  </Rx.Flex>
                )
              }
            >
              {busy === "logout" ? (
                <Rx.Text size="1" color="gray" role="status">
                  {t("engine.signingOut")}
                </Rx.Text>
              ) : (
                !askSignOut && (
                  <Rx.Button size="1" variant="soft" color="red" disabled={busy !== null} onClick={() => setAskSignOut(true)}>
                    {t("engine.signOut")}
                  </Rx.Button>
                )
              )}
            </Row>,
            signOutHint && (
              <Row key="hint" label={<span role="status">{t(signOutHint === "manual" ? "engine.signOutManual" : "engine.signOutTerminal")}</span>}>
                <Rx.Button size="1" variant="outline" color="gray" onClick={() => void refresh(engine.id).then(() => setSignOutHint(false))}>
                  {t("engine.providerRecheck")}
                </Rx.Button>
              </Row>
            ),
            readOnly("plan", t("engine.plan"), engine.requires),
            readOnly("data", t("engine.data"), engine.dataLocation),
            readOnly("version", t("engine.version"), status.version),
            <Rx.Flex key="legal" direction="column" gap="1" pt="3">
              <Rx.Text as="p" size="1" color="gray" lang={legalLang}>
                {t("legal.engine.noticeContent", { provider: engine.provider })}
              </Rx.Text>
              {legalLang && (
                <Rx.Text as="p" size="1" color="gray">
                  {t("language.legalEnglish")}
                </Rx.Text>
              )}
              {setup && (
                <Rx.Text as="p" size="1" color="gray">
                  {link(engine.termsUrl, t("engine.terms", { provider: engine.provider }))} ·{" "}
                  {link(engine.privacyUrl, t("engine.privacy", { provider: engine.provider }))}
                </Rx.Text>
              )}
            </Rx.Flex>,
          ]}
    </Group>
  );

  // The Assistant's engine step (stage 3c): the parts follow each other in the step's column, the save error last.
  if (setup) {
    return (
      <Rx.Flex direction="column" gap="4">
        {choice}
        {checking}
        {readyCard}
        {failedNotice}
      </Rx.Flex>
    );
  }
  // Settings › Engine (stage 2b): the save error above the card it is about.
  return (
    <div>
      <SectionHead line={t("settings.line.engine", { name: state.harness.name })} />
      {failedNotice}
      {choice}
      {checking}
      {readyCard}
    </div>
  );
}
