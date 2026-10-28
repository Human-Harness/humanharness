import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk/language";
import type { LanguageRun } from "./client";
import type { LanguageControl } from "./language-control";
import { LanguagePicker } from "./LanguagePicker";
import { useDialogKeys } from "./focus";
import { TranslateNotice } from "./TranslateNotice";

/**
 * Picking a language (spec §3–§4): the picker, then, only for a language with no complete translation, the notice;
 * `{ notice }` opens straight at the notice (new texts, Try again: a stopped run resumes, Q6). The picker and the notice
 * replace each other, never stack. While a run is going, its progress and Cancel show instead of the picker (a choice
 * would answer busy), and the chooser closes when that run ends. It asks for the state when it opens; answers that come
 * after it closed are dropped.
 */
export function LanguageChooser({
  control,
  start,
  harnessName,
  onClose,
}: {
  control: LanguageControl;
  start: { pick?: Language } | { notice: Language };
  harnessName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<Language | null>("notice" in start ? start.notice : null);
  const [failed, setFailed] = useState(false);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const live = useRef(true);
  const view = control.view;
  const run = view?.run?.status === "running" ? view.run : null;
  // Only the picker step gives way to the progress: the notice stays put while its own run starts.
  const showProgress = !notice && run !== null;
  const sawRun = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const { load } = control;

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  // `control` is a new object on every render; `load` is stable.
  useEffect(() => load(), [load]);
  useEffect(() => {
    if (showProgress) sawRun.current = true;
    else if (sawRun.current) {
      sawRun.current = false;
      closeRef.current();
    }
  }, [showProgress]);

  if (!view) return null;
  // The notice can open straight (new texts, Try again) while no run can start: say why rather than fail on Translate.
  const ready = view.canTranslate === true;
  if (notice)
    return (
      <TranslateNotice
        tag={notice}
        harnessName={harnessName}
        engineName={view.engineName ?? ""}
        busy={starting}
        disabled={!ready}
        error={!ready ? t("language.needsEngine") : failed ? t("language.failed") : null}
        onCancel={() => {
          // A run that is starting is cancelled too: translate then answers failed and nothing switches.
          if (startingRef.current) control.cancel();
          onClose();
        }}
        onTranslate={() => {
          if (startingRef.current || !ready) return;
          startingRef.current = true;
          setStarting(true);
          setFailed(false);
          // false: nothing started (busy, no engine, or a cancel while it was preparing).
          const done = (ok: boolean) => {
            startingRef.current = false;
            if (!live.current) return;
            setStarting(false);
            if (ok) onClose();
            else setFailed(true);
          };
          control.translate(notice).then(done, () => done(false));
        }}
      />
    );
  if (showProgress) return <RunProgress run={run} onCancel={() => control.cancel()} onClose={onClose} />;
  return (
    <LanguagePicker
      current={view.language}
      {...("pick" in start && start.pick ? { suggested: start.pick } : {})}
      view={view}
      error={failed ? t("language.failed") : null}
      onClose={onClose}
      onPick={(tag) => {
        setFailed(false);
        return control.choose(tag).then(
          (r) => {
            if (!live.current) return;
            if (r === "switched") onClose();
            else if (r === "needs-translation") setNotice(tag);
            else setFailed(true);
          },
          () => live.current && setFailed(true),
        );
      }}
    />
  );
}

/** A run that is going: how far, Cancel (stops it; what it saved stays) and Close (it goes on). Close has focus first. */
function RunProgress({ run, onCancel, onClose }: { run: LanguageRun; onCancel: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    return () => {
      if (opener?.isConnected && opener.closest("[inert]") === null) opener.focus();
    };
  }, []);
  useDialogKeys(dialog, onClose);
  return (
    <div className="hh-langpick-backdrop" onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}>
      <div
        ref={dialog}
        className="hh-langpick"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <h2 id={`${id}-title`}>{t("language.pickTitle")}</h2>
        <p className="hh-langpick-progress" role="status">
          {t("language.progress", { done: run.done, total: run.total })}
        </p>
        <div className="hh-langpick-actions">
          <button type="button" onClick={onCancel}>
            {t("language.cancel")}
          </button>
          <button type="button" ref={close} className="hh-primary" onClick={onClose}>
            {t("language.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
