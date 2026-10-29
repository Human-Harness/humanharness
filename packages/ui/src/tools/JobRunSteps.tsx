import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, ToolCallView } from "../client";
import { ToolCallLine } from "./ToolCallLine";

type Read = { state: "loading" } | { state: "error" } | { state: "done"; calls: ToolCallView[] };

/**
 * A job run's steps under its summary (tools spec §8.2), in the inbox's Jobs rows and Settings › Jobs: "Steps" unfolds
 * the run's trace (`client.tools.trace(run)`) as slice 2's tool lines, a note as its one line, a failed call unfolded.
 * Shown only for a row whose last run has an id (the harness has tools). The trace is read on the first open only; it
 * is not polled. A row stays mounted when its job runs again: a new run id folds the steps and drops the old run's.
 */
export function JobRunSteps({ client, run, describedBy }: { client: HarnessClient; run: string; describedBy?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<Read | null>(null);
  const [shownRun, setShownRun] = useState(run);
  if (shownRun !== run) {
    // Adjusted while rendering, so the old run's steps are never drawn under the new run's summary.
    setShownRun(run);
    setOpen(false);
    setRead(null);
  }
  const list = useId();
  /** The run the row shows now: an answer for any other is dropped. */
  const current = useRef<string | null>(run);
  useEffect(() => {
    current.current = run;
    return () => {
      current.current = null;
    };
  }, [run]);

  const toggle = () => {
    setOpen(!open);
    // Read on an open, and again after an unreadable answer; a fold reads nothing.
    if (open || (read !== null && read.state !== "error")) return;
    setRead({ state: "loading" });
    const asked = run;
    const settle = (next: Read) => {
      if (current.current === asked) setRead(next);
    };
    client.tools.trace(asked).then(
      // A reply that isn't a list is unreadable, never a throw that takes the row down.
      (calls) => settle(Array.isArray(calls) ? { state: "done", calls } : { state: "error" }),
      // Main's reason (a path, a stack) never reaches the window: a fixed line.
      () => settle({ state: "error" }),
    );
  };

  return (
    <div className="hh-tool-calls">
      <button type="button" className="hh-tool-line" aria-expanded={open} aria-controls={list} aria-describedby={describedBy} onClick={toggle}>
        {t("tools.jobSteps")}
      </button>
      <div id={list} className="hh-tool-group-list" hidden={!open}>
        {open && read?.state === "loading" && <p className="hh-tool-note">{t("tools.jobStepsLoading")}</p>}
        {open && read?.state === "error" && <p className="hh-tool-note">{t("tools.jobStepsError")}</p>}
        {open && read?.state === "done" && read.calls.length === 0 && <p className="hh-tool-note">{t("tools.jobStepsNone")}</p>}
        {open && read?.state === "done" && read.calls.map((c, i) => <ToolCallLine key={`${c.at}-${i}`} call={c} />)}
      </div>
    </div>
  );
}
