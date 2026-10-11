import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk";
import { type EngineError, type EngineOption, type EngineStatus, type HarnessClient, type SetupStep, type TestResult, engineProblem } from "./client";

type Busy = null | "notice" | "test" | SetupStep;

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
  const { t, i18n } = useTranslation();
  const lang: Language = i18n.language === "es" ? "es" : "en";
  const [busy, setBusy] = useState<Busy>(null);
  /** "step": the last step failed (or timed out); "shared": ~/.humanharness/engines.json couldn't be written. */
  const [failed, setFailed] = useState<false | "step" | "shared">(false);
  const [accepted, setAccepted] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [url, setUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  /** Why the last test prompt failed. */
  const [testError, setTestError] = useState<EngineError | null>(null);
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
        setBusy(null);
        if (!o.ok) setFailed("step");
        void refreshRef.current();
      }
    });
    // Re-attach to a step that is still running for this engine.
    client.getSetup().then(
      (running) => {
        if (!live || !running || running.engineId !== engine.id) return;
        attached.current = true;
        setBusy(running.step);
        setUrl(running.url ?? null);
      },
      () => {},
    );
    return () => {
      live = false;
      off();
    };
  }, [client, engine.id]);

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

  // The test prompt runs by itself once; after a failure the user retries.
  useEffect(() => {
    if (problem === "untested" && busy === null && !autoTested.current) {
      autoTested.current = true;
      void runTest();
    }
  }, [problem, busy, runTest]);

  const runStep = async (step: SetupStep) => {
    setBusy(step);
    setFailed(false);
    setTestError(null);
    setLines([]);
    setUrl(null);
    setCode("");
    const result = await client.runSetup(engine.id, step).catch(() => ({ ok: false }));
    // Signed in again: the test prompt runs by itself again.
    if (result.ok && step === "login") autoTested.current = false;
    setBusy(null);
    await refresh();
    if (!result.ok) setFailed("step");
  };

  /** Starts ~/.humanharness/engines.json over (a copy of the old one is kept), then tries again. */
  const resetShared = async () => {
    try {
      await client.resetSharedConfig();
    } catch {
      return;
    }
    setFailed(false);
    if (problem === "untested") await runTest();
    else await refresh();
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
      <button onClick={() => void client.cancelSetup()}>{t("engine.cancel")}</button>
    </>
  );

  let body: ReactNode;
  if (problem === "notice") {
    body = (
      <>
        <h3>{t("engine.noticeTitle", v)}</h3>
        <p>{t("engine.noticeProvider", { ...v, where: engine.dataLocation[lang] })}</p>
        <p>{t("engine.noticeTraining", { trains: engine.trainsOnData[lang] })}</p>
        <p>{t("engine.noticeAccount", { ...v, plan: engine.requires[lang] })}</p>
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
            {busy === "install" ? (
              <p role="status">{t("engine.installing")}</p>
            ) : (
              <button className="hh-primary" disabled={busy !== null} onClick={() => void runStep("install")}>
                {failed ? t("engine.retry") : t("engine.installRun")}
              </button>
            )}
          </>
        ) : (
          <>
            <p>{t("engine.installManual", v)}</p>
            <button disabled={busy !== null} onClick={() => void refresh()}>
              {t("engine.recheck")}
            </button>
          </>
        )}
        {engine.installDocsUrl && <p>{link(engine.installDocsUrl, t("engine.installDocs"))}</p>}
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
            {failed === "step" && status.loggedIn === null && (
              <button onClick={() => void runStep("login")}>{t("errors.fix.session-expired", v)}</button>
            )}
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
            <button onClick={() => void client.revealSharedConfig().catch(() => {})}>{t("engine.sharedConfigReveal")}</button>{" "}
            <button onClick={() => void resetShared()}>{t("engine.sharedConfigReset")}</button>
          </p>
        </>
      )}
      {failed === "step" && (
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
