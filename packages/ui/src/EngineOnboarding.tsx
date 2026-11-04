import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type EngineError, type EngineOption, type EngineStatus, type HarnessClient, type SetupResult, type SetupStep, type TestResult, engineProblem } from "./client";
import { Rx } from "./guide";

type Busy = null | "notice" | "test" | SetupStep;

/** Button types (DESIGN.md "Button"): compact, as everything inside a card. */
const primary = { size: "1" } as const;
const secondary = { size: "1", variant: "outline", color: "gray" } as const;

/** What a finished step leaves on screen: nothing when it worked or the user cancelled it. */
const stepFailure = (r: SetupResult): false | "step" | "timeout" => (r.ok || r.cancelled ? false : r.timedOut ? "timeout" : "step");

/**
 * Under a legal block when the screen isn't English (spec §8): the line is in the app's language, the block in English.
 * Nothing in English, nor in a language with no translation (it resolves to "en"), so D0 screens are unchanged.
 */
export function LegalInEnglish() {
  const { t } = useTranslation();
  return useLegalLang() ? (
    <Rx.Text as="p" size="1" color="gray">
      {t("language.legalEnglish")}
    </Rx.Text>
  ) : null;
}

/** `lang` for a legal block: "en" when the screen is in another language, so screen readers read it as English; unset in English (D0). */
export function useLegalLang(): "en" | undefined {
  const { i18n } = useTranslation();
  return i18n.resolvedLanguage && i18n.resolvedLanguage !== "en" ? "en" : undefined;
}

/**
 * The step an engine still needs (spec §9): legal notice, install, update, sign in, test prompt.
 * Each step ends with `refresh()`, which re-reads the real status; nothing is trusted from a local flag.
 * Renders nothing once the engine is ready.
 */
export function EngineOnboarding({
  client,
  engine,
  status,
  refresh,
}: {
  client: HarnessClient;
  engine: EngineOption;
  status: EngineStatus;
  refresh: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const legalLang = useLegalLang();
  const [busy, setBusy] = useState<Busy>(null);
  /**
   * "step": the last step failed; "timeout": it ran too long and was stopped; "shared":
   * ~/.humanharness/engines.json couldn't be written. A step the user cancelled isn't a failure.
   */
  const [failed, setFailed] = useState<false | "step" | "timeout" | "shared">(false);
  const [accepted, setAccepted] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [url, setUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  /** Why the last test prompt failed. */
  const [testError, setTestError] = useState<EngineError | null>(null);
  /** Starting ~/.humanharness/engines.json over: "confirm" asks first, "running" while it runs, "failed" after an error. */
  const [reset, setReset] = useState<null | "confirm" | "running" | "failed">(null);
  /** getSetup has answered: until then a step may be running that this screen would reattach to. */
  const [checkedSetup, setCheckedSetup] = useState(false);
  /** Installing by hand: whether copying the command worked, and the last "check again". */
  const [copy, setCopy] = useState<null | "copied" | "failed">(null);
  const [rechecking, setRechecking] = useState(false);
  /** "Check again" ran and the screen is still on this step (the CLI isn't there yet). */
  const [stillMissing, setStillMissing] = useState(false);
  const titleId = useId();
  const codeId = useId();
  const autoTested = useRef(false);
  /** Showing a step this screen didn't start (it was reopened while the step runs): its end comes as an event. */
  const attached = useRef(false);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const problem = engineProblem(status);

  useEffect(() => {
    let live = true;
    const off = client.onSetupOutput((o) => {
      if (o.kind === "line") setLines((l) => [...l.slice(-19), o.text]);
      else if (o.kind === "url") setUrl(o.url);
      else if (o.kind === "end" && o.engineId === engine.id && attached.current) {
        attached.current = false;
        // Signed in again: the test prompt runs by itself again.
        if (o.ok && o.step === "login") autoTested.current = false;
        setBusy(null);
        setFailed(stepFailure(o));
        void refreshRef.current();
      }
    });
    // Re-attach to a step that is still running for this engine.
    client.getSetup().then(
      (running) => {
        if (!live) return;
        setCheckedSetup(true);
        if (!running || running.engineId !== engine.id) return;
        attached.current = true;
        setBusy(running.step);
        setUrl(running.url ?? null);
      },
      () => {
        if (live) setCheckedSetup(true);
      },
    );
    return () => {
      live = false;
      off();
    };
  }, [client, engine.id]);

  // A new attempt (or a new failure) leaves the last "Start over" behind.
  useEffect(() => {
    if (failed !== "shared") setReset(null);
  }, [failed]);

  const runTest = useCallback(async () => {
    setBusy("test");
    setFailed(false);
    setTestError(null);
    setStillMissing(false);
    // A rejection (the app couldn't run it) is a plain failure.
    const result: TestResult = await client.testEngine(engine.id).catch(() => ({ ok: false }));
    setBusy(null);
    if (result.ok && result.recorded === false) setFailed("shared");
    else if (!result.ok) {
      setFailed("step");
      setTestError(result.error ?? { code: "agent-crashed" });
    }
    await refresh();
  }, [client, engine.id, refresh]);

  // The test prompt runs by itself once (never alongside a step this screen reattaches to);
  // after a failure the user retries.
  useEffect(() => {
    if (checkedSetup && problem === "untested" && busy === null && !autoTested.current) {
      autoTested.current = true;
      void runTest();
    }
  }, [checkedSetup, problem, busy, runTest]);

  const runStep = async (step: SetupStep) => {
    setBusy(step);
    setFailed(false);
    setTestError(null);
    setLines([]);
    setUrl(null);
    setCode("");
    const result: SetupResult = await client.runSetup(engine.id, step).catch(() => ({ ok: false }));
    // Signed in again: the test prompt runs by itself again.
    if (result.ok && step === "login") autoTested.current = false;
    setBusy(null);
    await refresh();
    setFailed(stepFailure(result));
  };

  /**
   * Starts ~/.humanharness/engines.json over (a copy of the old one is kept). The notice is then
   * asked for again before anything is sent to the engine, so only the status is re-read.
   */
  const resetting = useRef(false);
  const resetShared = async () => {
    // One reset at a time, even for a double click that lands before the re-render.
    if (resetting.current) return;
    resetting.current = true;
    setReset("running");
    try {
      await resetAndRetry();
    } finally {
      resetting.current = false;
    }
  };
  const resetAndRetry = async () => {
    try {
      await client.resetSharedConfig();
    } catch {
      setReset("failed");
      return;
    }
    setReset(null);
    setFailed(false);
    // Once the notice is accepted again, the test prompt runs by itself.
    autoTested.current = false;
    await refresh();
  };

  const copyCommand = async () => {
    try {
      await client.copyInstallCommand(engine.id);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  };

  /** A step the person runs in Terminal (`terminalSteps`): the app copies its command and runs nothing. */
  const copySetup = async (step: "login" | "logout") => {
    try {
      await client.copySetupCommand(engine.id, step);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  };

  /** "I installed it, check again": detects the CLI again, and says so when it still isn't there. */
  const recheck = async () => {
    setRechecking(true);
    setStillMissing(false);
    await refresh();
    setRechecking(false);
    setStillMissing(true);
  };

  const accept = async () => {
    setBusy("notice");
    setFailed(false);
    try {
      await client.acceptNotice(engine.id);
    } catch {
      // The only thing acceptNotice writes is ~/.humanharness/engines.json.
      setFailed("shared");
    }
    setBusy(null);
    await refresh();
  };

  if (problem === null) return null;
  const v = { engine: engine.name, provider: engine.provider };
  const link = (href: string, text: string) => (
    <a href={href} target="_blank" rel="noreferrer">
      {text}
    </a>
  );
  // The card's pieces (DESIGN.md "Inicio, Assistant and Settings": an install box is a card with numbered steps, a
  // code block and secondary buttons). Its one primary is compact and last on the right (DESIGN.md "Card").
  const title = (text: string, lang?: string) => (
    <Rx.Heading as="h3" size="3" id={titleId} lang={lang}>
      {text}
    </Rx.Heading>
  );
  const para = (text: ReactNode, lang?: string) => (
    <Rx.Text as="p" size="2" lang={lang}>
      {text}
    </Rx.Text>
  );
  const command = (text: string) => (
    <Rx.Text as="p" size="2">
      <Rx.Code size="2" variant="soft" color="gray" className="hh-gd-path">
        {text}
      </Rx.Code>
    </Rx.Text>
  );
  const steps = (label: string, items: string[]) => (
    <Rx.Box asChild m="0" pl="5">
      <ol aria-label={label}>
        {items.map((item) => (
          <Rx.Text size="2" key={item} asChild>
            <li>{item}</li>
          </Rx.Text>
        ))}
      </ol>
    </Rx.Box>
  );
  const actions = (children: ReactNode) => (
    <Rx.Flex align="center" justify="end" gap="2" wrap="wrap">
      {children}
    </Rx.Flex>
  );
  /** A row of secondary buttons from the left: the steps the person runs by hand. */
  const tools = (children: ReactNode) => (
    <Rx.Flex align="center" gap="2" wrap="wrap">
      {children}
    </Rx.Flex>
  );
  const statusLine = (text: string) => (
    <Rx.Text as="p" size="1" color="gray" role="status">
      {text}
    </Rx.Text>
  );
  const problemNote = (text: string) => (
    <Rx.Callout.Root color="red" size="1" role="alert">
      <Rx.Callout.Text>{text}</Rx.Callout.Text>
    </Rx.Callout.Root>
  );
  const docs = (href: string | undefined, text: string) =>
    href && (
      <Rx.Text as="p" size="1" color="gray">
        {link(href, text)}
      </Rx.Text>
    );
  /** Whether copying the command worked, next to the buttons it came from (green: a status line that went well). */
  const copied = copy === "copied" && (
    <Rx.Text size="1" color="green" role="status">
      {t("engine.copied")}
    </Rx.Text>
  );
  const copyFailed = copy === "failed" && problemNote(t("engine.copyFailed"));

  const loginProgress = (
    <>
      {statusLine(t("engine.loggingIn"))}
      {url && para(link(url, t("engine.loginOpen")))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!code.trim()) return;
          void client.setupInput(code.trim());
          setCode("");
        }}
      >
        {/* Label on top (DESIGN.md "Field"), the send button on the field's line. */}
        <Rx.Flex direction="column" gap="2">
          <Rx.Text as="label" size="2" weight="bold" htmlFor={codeId}>
            {t("engine.loginCode")}
          </Rx.Text>
          <Rx.Flex gap="2" align="center">
            <Rx.Box flexGrow="1">
              <Rx.TextField.Root id={codeId} value={code} onChange={(e) => setCode(e.target.value)} />
            </Rx.Box>
            <Rx.Button type="submit" variant="outline" color="gray">
              {t("engine.loginCodeSend")}
            </Rx.Button>
          </Rx.Flex>
        </Rx.Flex>
      </form>
    </>
  );

  const recheckButton = (
    <Rx.Button {...secondary} disabled={busy !== null || rechecking} onClick={() => void recheck()}>
      {t("engine.installedRecheck")}
    </Rx.Button>
  );
  /** Installing by hand: the app copies the official command and opens Terminal; the user runs it. */
  const manualInstall = (
    <Rx.Flex direction="column" gap="2">
      {!failed && (
        <Rx.Text as="p" size="2" weight="bold">
          {t("engine.manualTitle")}
        </Rx.Text>
      )}
      {steps(t("engine.manualTitle"), [t("engine.manualStep1"), t("engine.manualStep2"), t("engine.manualStep3")])}
      {tools(
        <>
          <Rx.Button {...secondary} onClick={() => void copyCommand()}>
            {t("engine.copyCommand")}
          </Rx.Button>
          <Rx.Button {...secondary} onClick={() => void client.openTerminal().catch(() => {})}>
            {t("engine.openTerminal")}
          </Rx.Button>
          {recheckButton}
          {copied}
        </>,
      )}
      {copyFailed}
    </Rx.Flex>
  );

  let body: ReactNode;
  if (problem === "notice") {
    body = (
      <>
        {title(t("legal.engine.noticeTitle", v), legalLang)}
        {para(t("legal.engine.noticeProvider", { ...v, where: engine.dataLocation }), legalLang)}
        {para(t("legal.engine.noticeTraining", { trains: engine.trainsOnData }), legalLang)}
        {para(t("legal.engine.noticeAccount", { ...v, plan: engine.requires }), legalLang)}
        {engine.userProvider && para(t("legal.engine.noticeUserProvider", v), legalLang)}
        {para(t("legal.engine.noticeContent", v), legalLang)}
        <Rx.Text as="p" size="2">
          {link(engine.termsUrl, t("engine.terms", v))} · {link(engine.privacyUrl, t("engine.privacy", v))}
        </Rx.Text>
        {/* Accepting before going on is the checkbox's one use (DESIGN.md "Switch and Checkbox"). */}
        <Rx.Text as="label" size="2">
          <Rx.Flex gap="2" align="center">
            <Rx.Checkbox checked={accepted} onCheckedChange={(c) => setAccepted(c === true)} />
            <span lang={legalLang}>{t("legal.engine.accept")}</span>
          </Rx.Flex>
        </Rx.Text>
        {/* After the accept text, so the line covers every legal block of the notice. */}
        <LegalInEnglish />
        {actions(
          <Rx.Button {...primary} disabled={!accepted || busy !== null} onClick={() => void accept()}>
            {t("engine.continue")}
          </Rx.Button>,
        )}
      </>
    );
  } else if (problem === "not-installed") {
    const install =
      busy === "install"
        ? statusLine(t("engine.installing"))
        : actions(
            // After a failed install, doing it by hand comes first; trying again stays possible, as a secondary.
            <Rx.Button {...(failed ? secondary : primary)} disabled={busy !== null} onClick={() => void runStep("install")}>
              {failed ? t("engine.retry") : t("engine.installRun")}
            </Rx.Button>,
          );
    body = (
      <>
        {title(t("engine.installTitle", v))}
        {engine.installCommand ? (
          <>
            {para(t("engine.installText", v))}
            {command(engine.installCommand)}
            {failed === "step" && problemNote(t("engine.manualFailed"))}
            {failed ? manualInstall : install}
            <Rx.Separator size="4" />
            {failed ? install : manualInstall}
          </>
        ) : (
          <>
            {para(t("engine.installManual", v))}
            {actions(recheckButton)}
          </>
        )}
        {docs(engine.installDocsUrl, t("engine.installDocs"))}
        {stillMissing && statusLine(t("engine.stillMissing", v))}
      </>
    );
  } else if (problem === "outdated") {
    body = (
      <>
        {title(t("engine.updateTitle", v))}
        {para(t("engine.updateText", { ...v, min: status.minVersion, version: status.version }))}
        {busy === "update"
          ? statusLine(t("engine.updating"))
          : actions(
              <Rx.Button {...primary} disabled={busy !== null} onClick={() => void runStep("update")}>
                {failed ? t("engine.retry") : t("engine.updateRun")}
              </Rx.Button>,
            )}
        {docs(engine.installDocsUrl, t("engine.installDocs"))}
      </>
    );
  } else if (problem === "logged-out" && engine.terminalSteps?.login) {
    // OpenCode (spec §2): the person picks a provider in OpenCode's own login, in Terminal. The app runs nothing there.
    body = (
      <>
        {title(t("engine.providerTitle", v))}
        {para(t("engine.providerText", v))}
        {command(engine.terminalSteps.login)}
        {steps(t("engine.providerTitle", v), [t("engine.providerStep1"), t("engine.providerStep2", v), t("engine.providerStep3")])}
        {tools(
          <>
            <Rx.Button {...secondary} onClick={() => void copySetup("login")}>
              {t("engine.copyCommand")}
            </Rx.Button>
            <Rx.Button {...secondary} onClick={() => void client.openTerminal().catch(() => {})}>
              {t("engine.openTerminal")}
            </Rx.Button>
            <Rx.Button {...secondary} disabled={busy !== null || rechecking} onClick={() => void recheck()}>
              {t("engine.providerRecheck")}
            </Rx.Button>
            {copied}
          </>,
        )}
        {copyFailed}
        {stillMissing && statusLine(t("engine.providerStillMissing", v))}
        <Rx.Separator size="4" />
        {para(t("engine.providerLocal", v))}
        {tools(
          <Rx.Button {...secondary} disabled={busy !== null} onClick={() => void runTest()}>
            {t("engine.providerLocalTest")}
          </Rx.Button>,
        )}
        {busy === "test" && statusLine(t("engine.testing", v))}
        {docs(engine.providersUrl, t("engine.providerDocs", v))}
      </>
    );
  } else if (problem === "logged-out") {
    body = (
      <>
        {title(t("engine.loginTitle", v))}
        {para(t("engine.loginText", v))}
        {busy === "login"
          ? loginProgress
          : actions(
              <Rx.Button {...primary} disabled={busy !== null} onClick={() => void runStep("login")}>
                {failed ? t("engine.retry") : t("engine.loginRun")}
              </Rx.Button>,
            )}
      </>
    );
  } else {
    body = (
      <>
        {title(t("engine.testTitle"))}
        {busy === "login" ? (
          loginProgress
        ) : failed && busy === null ? (
          <>
            {/* What was copied for Terminal, to paste by hand if the clipboard let us down. */}
            {engine.terminalSteps?.login && copy !== null && (
              <>
                {command(engine.terminalSteps.login)}
                {copied}
                {copyFailed}
              </>
            )}
            {actions(
              <>
                {/* The CLI can't say whether it is signed in: signing in again may be the fix. */}
                {failed === "step" &&
                  (status.loggedIn === null || testError?.code === "session-expired") &&
                  (engine.terminalSteps?.login ? (
                    // Signing in runs in Terminal: copy the command and open it.
                    <Rx.Button {...secondary} onClick={() => void copySetup("login").then(() => client.openTerminal().catch(() => {}))}>
                      {t("errors.fix.session-expired", v)}
                    </Rx.Button>
                  ) : (
                    <Rx.Button {...secondary} onClick={() => void runStep("login")}>
                      {t("errors.fix.session-expired", v)}
                    </Rx.Button>
                  ))}
                <Rx.Button {...primary} onClick={() => void runTest()}>
                  {t("engine.retry")}
                </Rx.Button>
              </>,
            )}
          </>
        ) : (
          statusLine(t("engine.testing", v))
        )}
      </>
    );
  }

  return (
    <Rx.Card size="3" asChild>
      <section aria-labelledby={titleId} aria-busy={busy !== null}>
        <Rx.Flex direction="column" gap="3">
          {body}
          {failed === "shared" && (
            <>
              {problemNote(t("engine.sharedConfigError"))}
              {tools(
                <>
                  <Rx.Button {...secondary} disabled={reset === "running"} onClick={() => void client.revealSharedConfig().catch(() => {})}>
                    {t("engine.sharedConfigReveal")}
                  </Rx.Button>
                  <Rx.Button {...secondary} disabled={reset === "running" || reset === "confirm"} onClick={() => setReset("confirm")}>
                    {t("engine.sharedConfigReset")}
                  </Rx.Button>
                </>,
              )}
              {/* Starting over asks first, inline (DESIGN.md "Signing out"): nothing runs until the second button. */}
              {reset === "confirm" && (
                <Rx.Flex role="group" aria-label={t("engine.sharedConfigReset")} direction="column" gap="2">
                  {para(t("engine.sharedConfigConfirm"))}
                  <Rx.Flex gap="2" wrap="wrap">
                    <Rx.Button size="1" variant="soft" color="red" onClick={() => void resetShared()}>
                      {t("engine.sharedConfigConfirmYes")}
                    </Rx.Button>
                    <Rx.Button {...secondary} onClick={() => setReset(null)}>
                      {t("engine.cancel")}
                    </Rx.Button>
                  </Rx.Flex>
                </Rx.Flex>
              )}
              {reset === "running" && statusLine(t("engine.sharedConfigResetting"))}
              {reset === "failed" && problemNote(t("engine.sharedConfigResetError"))}
            </>
          )}
          {failed === "timeout" && problemNote(t("engine.timedOut"))}
          {/* A failed install says so above, with the way to do it by hand. */}
          {failed === "step" &&
            problem !== "not-installed" &&
            problemNote(testError ? t(`errors.${testError.code}`, { ...v, defaultValue: t("errors.agent-crashed", v) }) : t("engine.failed"))}
          {lines.length > 0 && (
            <details>
              <Rx.Text size="1" color="gray" asChild>
                <summary>{t("engine.details")}</summary>
              </Rx.Text>
              <Rx.Text size="1" color="gray" asChild>
                <Rx.Box asChild maxHeight="160px" overflow="auto" m="0" mt="2">
                  <pre>{lines.join("\n")}</pre>
                </Rx.Box>
              </Rx.Text>
            </details>
          )}
        </Rx.Flex>
      </section>
    </Rx.Card>
  );
}
