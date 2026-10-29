import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, ToolCallView } from "../client";
import { ToolCallLine } from "./ToolCallLine";

type Read = { state: "loading" } | { state: "error" } | { state: "done"; calls: ToolCallView[] };

/**
 * A job run's steps under its summary (tools spec §8.2), in the inbox's Jobs rows and Settings › Jobs: "Steps" unfolds
 * the run's trace (`client.tools.trace(run)`) as slice 2's tool lines, a note as its one line, a failed call unfolded.
 * Shown only for a row whose last run has an id (the harness has tools). The trace is read on the first open only; it
 * is not polled.
 */
export function JobRunSteps({ client, run }: { client: HarnessClient; run: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<Read | null>(null);
  const list = useId();
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const toggle = () => {
    setOpen((o) => !o);
    if (read !== null) return;
    setRead({ state: "loading" });
    client.tools.trace(run).then(
      (calls) => {
        if (live.current) setRead({ state: "done", calls });
      },
      () => {
        // Main's reason (a path, a stack) never reaches the window: a fixed line.
        if (live.current) setRead({ state: "error" });
      },
    );
  };

  return (
    <div className="hh-tool-calls">
      <button type="button" className="hh-tool-line" aria-expanded={open} aria-controls={list} onClick={toggle}>
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
