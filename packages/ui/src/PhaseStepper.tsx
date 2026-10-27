import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CurrentTaskView, PhaseView } from "./client";
import { closePhaseOf, timeLeftMs } from "./phases";

/**
 * The open task's parts above the chat (task-phases spec §6): each part in order, the current one marked, a click
 * moves there. Under it, the agent's proposal waiting for the person, and the time box with its controls.
 */
export function PhaseStepper({
  phases,
  task,
  disabled,
  onPhase,
  onFinish,
  onPause,
  onResume,
  onExtend,
}: {
  phases: PhaseView[];
  task: CurrentTaskView;
  disabled: boolean;
  onPhase: (id: string) => void;
  onFinish: () => void;
  onPause: () => void;
  onResume: () => void;
  onExtend: () => void;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  // "Not now" hides the proposal on this screen; a new one (another target or reason) shows again.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const box = task.timeBox;
  // The clock ticks only while time runs: not paused, not ended, some left.
  const ticking = box !== undefined && !box.paused && !box.ended && timeLeftMs(box, now) > 0;
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  const current = phases.find((p) => p.id === task.phase);
  const currentAt = phases.findIndex((p) => p.id === task.phase);
  const proposal = task.phaseProposal;
  const proposalKey = proposal ? `${proposal.to}\n${proposal.reason}` : null;
  const target = proposal ? phases.find((p) => p.id === proposal.to) : undefined;
  const hasClose = closePhaseOf(phases) !== undefined;
  const left = box ? timeLeftMs(box, now) : null;
  const minute = box ? box.totalMs / box.minutes : 60_000;
  // The agent's "this part is done" card carries its own Finish; the bar's then stays hidden.
  const finishCard = target !== undefined && proposalKey !== dismissed && target.id === task.phase && target.close === true;
  return (
    <div className="hh-phase-bar">
      {/* A time box without phases (spec §5): no parts to show, only the time. */}
      {phases.length > 0 && (
        <nav aria-label={t("phases.stepper")}>
          <ol className="hh-phase-steps">
            {phases.map((p, i) => {
              // The current part is inert: a click on it would mean "same", or "finish" in the close part.
              const isCurrent = i === currentAt;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className={i < currentAt ? "hh-phase-done" : undefined}
                    aria-current={isCurrent ? "step" : undefined}
                    aria-disabled={isCurrent ? true : undefined}
                    disabled={disabled}
                    onClick={isCurrent ? undefined : () => onPhase(p.id)}
                  >
                    {p.label}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      )}
      {current?.close && !finishCard && (
        <button type="button" disabled={disabled} onClick={onFinish}>
          {t("phases.finish")}
        </button>
      )}
      {proposal && target && proposalKey !== dismissed && (
        <div className="hh-phase-proposal" role="status">
          <p>
            {target.id === task.phase && target.close
              ? t("phases.proposalFinish", { reason: proposal.reason })
              : t("phases.proposal", { phase: target.label, reason: proposal.reason })}
          </p>
          {target.id === task.phase && target.close ? (
            <button type="button" disabled={disabled} onClick={onFinish}>
              {t("phases.finish")}
            </button>
          ) : (
            <button type="button" disabled={disabled} onClick={() => onPhase(target.id)}>
              {t("phases.go", { phase: target.label })}
            </button>
          )}
          <button type="button" onClick={() => setDismissed(proposalKey)}>
            {t("phases.notNow")}
          </button>
        </div>
      )}
      {box && left !== null && (
        <div className="hh-time-box" role="group" aria-label={t("phases.timeTitle")}>
          <span aria-live="polite">
            {box.ended || left === 0
              ? t("phases.timeUp")
              : box.paused
                ? t("phases.paused")
                : left < minute
                  ? t("phases.lessThanMinute")
                  : t("phases.left", { count: Math.ceil(left / minute) })}
          </span>
          {!box.ended && (box.paused ? (
            <button type="button" onClick={onResume}>
              {t("phases.resume")}
            </button>
          ) : (
            <button type="button" disabled={task.status !== "waiting"} onClick={onPause}>
              {t("phases.pause")}
            </button>
          ))}
          <button type="button" onClick={onExtend}>
            {t("phases.extend")}
          </button>
          {!hasClose && (box.wrappedUp || box.ended) && (
            <button type="button" disabled={disabled} onClick={onFinish}>
              {t("phases.finish")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
