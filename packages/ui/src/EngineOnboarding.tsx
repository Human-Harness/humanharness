import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type EngineError, type EngineOption, type EngineStatus, type HarnessClient, type SetupResult, type SetupStep, type TestResult, engineProblem } from "./client";

type Busy = null | "notice" | "test" | SetupStep;

/** What a finished step leaves on screen: nothing when it worked or the user cancelled it. */
const stepFailure = (r: SetupResult): false | "step" | "timeout" => (r.ok || r.cancelled ? false : r.timedOut ? "timeout" : "step");

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

  const loginProgress = (
    <>
      <p role="status">{t("engine.loggingIn")}</p>
      {url && <p>{link(url, t("engine.loginOpen"))}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!code.trim()) return;
          void client.setupInput(code.trim());
          setCode("");
        }}
      >
        <label>
          {t("engine.loginCode")} <input value={code} onChange={(e) => setCode(e.target.value)} />
        </label>{" "}
        <button type="submit">{t("engine.loginCodeSend")}</button>
      </form>
    </>
  );

  const recheckButton = (
    <button disabled={busy !== null || rechecking} onClick={() => void recheck()}>
      {t("engine.installedRecheck")}
    </button>
  );
  /** Installing by hand: the app copies the official command and opens Terminal; the user runs it. */
  const manualInstall = (
    <div className="hh-manual">
      {!failed && (
        <p>
          <strong>{t("engine.manualTitle")}</strong>
        </p>
      )}
      <ol aria-label={t("engine.manualTitle")}>
        <li>{t("engine.manualStep1")}</li>
        <li>{t("engine.manualStep2")}</li>
        <li>{t("engine.manualStep3")}</li>
      </ol>
      <p>
        <button onClick={() => void copyCommand()}>{t("engine.copyCommand")}</button>{" "}
        <button onClick={() => void client.openTerminal().catch(() => {})}>{t("engine.openTerminal")}</button>{" "}
        {recheckButton} {copy === "copied" && <span role="status">{t("engine.copied")}</span>}
      </p>
      {copy === "failed" && (
        <p className="hh-save-error" role="alert">
          {t("engine.copyFailed")}
        </p>
      )}
    </div>
  );

  let body: ReactNode;
  if (problem === "notice") {
    body = (
      <>
        <h3>{t("engine.noticeTitle", v)}</h3>
        <p>{t("engine.noticeProvider", { ...v, where: engine.dataLocation })}</p>
        <p>{t("engine.noticeTraining", { trains: engine.trainsOnData })}</p>
        <p>{t("engine.noticeAccount", { ...v, plan: engine.requires })}</p>
        {engine.userProvider && <p>{t("engine.noticeUserProvider", v)}</p>}
        <p>{t("engine.noticeContent", v)}</p>
        <p>
          {link(engine.termsUrl, t("engine.terms", v))} · {link(engine.privacyUrl, t("engine.privacy", v))}
        </p>
        <label>
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /> {t("engine.accept")}
        </label>
        <button className="hh-primary" disabled={!accepted || busy !== null} onClick={() => void accept()}>
          {t("engine.continue")}
        </button>
      </>
    );
  } else if (problem === "not-installed") {
    body = (
      <>
        <h3>{t("engine.installTitle", v)}</h3>
        {engine.installCommand ? (
          <>
            <p>{t("engine.installText", v)}</p>
            <code>{engine.installCommand}</code>
            {/* After a failed install, doing it by hand comes first; trying again stays possible. */}
            {failed === "step" && (
              <p className="hh-save-error" role="alert">
                {t("engine.manualFailed")}
              </p>
            )}
            {failed && manualInstall}
            {busy === "install" ? (
              <p role="status">{t("engine.installing")}</p>
            ) : (
              <button className={failed ? undefined : "hh-primary"} disabled={busy !== null} onClick={() => void runStep("install")}>
                {failed ? t("engine.retry") : t("engine.installRun")}
              </button>
            )}
            {!failed && manualInstall}
          </>
        ) : (
          <>
            <p>{t("engine.installManual", v)}</p>
            {recheckButton}
          </>
        )}
        {engine.installDocsUrl && <p>{link(engine.installDocsUrl, t("engine.installDocs"))}</p>}
        {stillMissing && <p role="status">{t("engine.stillMissing", v)}</p>}
      </>
    );
  } else if (problem === "outdated") {
    body = (
      <>
        <h3>{t("engine.updateTitle", v)}</h3>
        <p>{t("engine.updateText", { ...v, min: status.minVersion, version: status.version })}</p>
        {busy === "update" ? (
          <p role="status">{t("engine.updating")}</p>
        ) : (
          <button className="hh-primary" disabled={busy !== null} onClick={() => void runStep("update")}>
            {failed ? t("engine.retry") : t("engine.updateRun")}
          </button>
        )}
        {engine.installDocsUrl && <p>{link(engine.installDocsUrl, t("engine.installDocs"))}</p>}
      </>
    );
  } else if (problem === "logged-out" && engine.terminalSteps?.login) {
    // OpenCode (spec §2): the person picks a provider in OpenCode's own login, in Terminal. The app runs nothing there.
    body = (
      <>
        <h3>{t("engine.providerTitle", v)}</h3>
        <p>{t("engine.providerText", v)}</p>
        <code>{engine.terminalSteps.login}</code>
        <ol aria-label={t("engine.providerTitle", v)}>
          <li>{t("engine.providerStep1")}</li>
          <li>{t("engine.providerStep2", v)}</li>
          <li>{t("engine.providerStep3")}</li>
        </ol>
        <p>
          <button className="hh-primary" onClick={() => void copySetup("login")}>
            {t("engine.copyCommand")}
          </button>{" "}
          <button onClick={() => void client.openTerminal().catch(() => {})}>{t("engine.openTerminal")}</button>{" "}
          <button disabled={busy !== null || rechecking} onClick={() => void recheck()}>
            {t("engine.providerRecheck")}
          </button>{" "}
          {copy === "copied" && <span role="status">{t("engine.copied")}</span>}
        </p>
        {copy === "failed" && (
          <p className="hh-save-error" role="alert">
            {t("engine.copyFailed")}
          </p>
        )}
        <p>
          {t("engine.providerLocal", v)}{" "}
          <button disabled={busy !== null} onClick={() => void runTest()}>
            {t("engine.providerLocalTest")}
          </button>
        </p>
        {engine.providersUrl && <p>{link(engine.providersUrl, t("engine.providerDocs", v))}</p>}
      </>
    );
  } else if (problem === "logged-out") {
    body = (
      <>
        <h3>{t("engine.loginTitle", v)}</h3>
        <p>{t("engine.loginText", v)}</p>
        {busy === "login" ? (
          loginProgress
        ) : (
          <button className="hh-primary" disabled={busy !== null} onClick={() => void runStep("login")}>
            {failed ? t("engine.retry") : t("engine.loginRun")}
          </button>
        )}
      </>
    );
  } else {
    body = (
      <>
        <h3>{t("engine.testTitle")}</h3>
        {busy === "login" ? (
          loginProgress
        ) : failed && busy === null ? (
          <>
            <button className="hh-primary" onClick={() => void runTest()}>
              {t("engine.retry")}
            </button>
            {/* The CLI can't say whether it is signed in: signing in again may be the fix. */}
            {failed === "step" &&
              (status.loggedIn === null || testError?.code === "session-expired") &&
              (engine.terminalSteps?.login ? (
                // Signing in runs in Terminal: copy the command and open it.
                <button onClick={() => void copySetup("login").then(() => client.openTerminal().catch(() => {}))}>
                  {t("errors.fix.session-expired", v)}
                </button>
              ) : (
                <button onClick={() => void runStep("login")}>{t("errors.fix.session-expired", v)}</button>
              ))}
          </>
        ) : (
          <p role="status">{t("engine.testing", v)}</p>
        )}
      </>
    );
  }

  return (
    <section className="hh-onboarding" aria-busy={busy !== null}>
      {body}
      {failed === "shared" && (
        <>
          <p className="hh-save-error" role="alert">
            {t("engine.sharedConfigError")}
          </p>
          <p>
            <button disabled={reset === "running"} onClick={() => void client.revealSharedConfig().catch(() => {})}>
              {t("engine.sharedConfigReveal")}
            </button>{" "}
            <button disabled={reset === "running" || reset === "confirm"} onClick={() => setReset("confirm")}>
              {t("engine.sharedConfigReset")}
            </button>
          </p>
          {reset === "confirm" && (
            <div role="group" aria-label={t("engine.sharedConfigReset")}>
              <p>{t("engine.sharedConfigConfirm")}</p>
              <button className="hh-primary" onClick={() => void resetShared()}>
                {t("engine.sharedConfigConfirmYes")}
              </button>{" "}
              <button onClick={() => setReset(null)}>{t("engine.cancel")}</button>
            </div>
          )}
          {reset === "running" && <p role="status">{t("engine.sharedConfigResetting")}</p>}
          {reset === "failed" && (
            <p className="hh-save-error" role="alert">
              {t("engine.sharedConfigResetError")}
            </p>
          )}
        </>
      )}
      {failed === "timeout" && (
        <p className="hh-save-error" role="alert">
          {t("engine.timedOut")}
        </p>
      )}
      {/* A failed install says so above, with the way to do it by hand. */}
      {failed === "step" && problem !== "not-installed" && (
        <p className="hh-save-error" role="alert">
          {testError ? t(`errors.${testError.code}`, { ...v, defaultValue: t("errors.agent-crashed", v) }) : t("engine.failed")}
        </p>
      )}
      {lines.length > 0 && (
        <details>
          <summary>{t("engine.details")}</summary>
          <pre>{lines.join("\n")}</pre>
        </details>
      )}
    </section>
  );
}
