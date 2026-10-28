import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReviewResult, ReviewSendResult, ReviewSummary } from "./client";

export interface ReviewBarProps {
  summary: ReviewSummary;
  /** A turn runs: sending waits (§5.3). */
  busy: boolean;
  /** The last approval's reason, when it had one. */
  approvedReason?: string;
  /** "See what changed" is open: its button says "Hide changes". */
  changesOpen?: boolean;
  onSend(): Promise<ReviewSendResult>;
  onApprove(reason?: string, opts?: { discard?: boolean }): Promise<ReviewResult>;
  onSeeChanges(): void;
}

/** The reader's footer (§5.3, §5.4): send the round, approve, and the approval's line. */
export function ReviewBar({ summary, busy, approvedReason, changesOpen, onSend, onApprove, onSeeChanges }: ReviewBarProps) {
  const { t, i18n } = useTranslation();
  const [asking, setAsking] = useState<"reason" | "unsent" | null>(null);
  const [reason, setReason] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const when = (iso?: string) => (iso ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "");

  const send = async () => {
    const r = await onSend();
    setAsking(null);
    setSaid(r.ok ? t(r.to === "open" ? "review.sentOpen" : "review.sentNew") : r.reason === "busy" ? t("review.busy") : t("review.failed"));
  };
  /** The one place approval happens: a later Sidekick `before-approve` hold goes here (Conflicts 3). */
  const approveNow = async (why?: string, opts?: { discard?: boolean }) => {
    const r = await onApprove(why, opts);
    if (r.ok) {
      setAsking(null);
      setReason("");
      setSaid(null);
    } else if (r.reason === "unsent") setAsking("unsent");
    else if (r.reason === "reason-required") setAsking("reason");
    else setSaid(r.reason === "changed" ? t("review.changedWhileOpen") : t("review.failed"));
  };
  const approve = () => {
    setSaid(null);
    if (summary.unsent > 0) setAsking("unsent");
    else if (summary.blocking > 0) setAsking("reason");
    else void approveNow();
  };

  if (summary.status === "approved")
    return (
      <footer className="hh-review-bar">
        <span className="hh-review-approved">{t("review.approved", { time: when(summary.approvedAt) })}</span>
        {approvedReason && <span className="hh-caption">{t("review.approvedReason", { reason: approvedReason })}</span>}
      </footer>
    );
  return (
    <footer className="hh-review-bar">
      {summary.status === "stale" && (
        <span className="hh-warn">
          {t("review.stale")}{" "}
          <button type="button" aria-expanded={changesOpen === true} onClick={onSeeChanges}>
            {changesOpen ? t("review.hideChanges") : t("review.seeChanges")}
          </button>
        </span>
      )}
      {summary.unsent > 0 && asking !== "unsent" && (
        <button type="button" disabled={busy} onClick={send}>
          {t("review.send", { count: summary.unsent })}
        </button>
      )}
      {asking === null && (
        <button type="button" className="hh-review-approve" onClick={approve}>
          {summary.blocking > 0 ? t("review.approveBlocking", { count: summary.blocking }) : t("review.approve")}
        </button>
      )}
      {asking === "reason" && (
        <div className="hh-review-ask" role="group">
          <ReasonForm reason={reason} setReason={setReason} onApprove={() => approveNow(reason.trim())} onCancel={() => setAsking(null)} />
        </div>
      )}
      {asking === "unsent" && (
        <div className="hh-review-ask" role="group">
          <p>{t("review.unsent", { count: summary.unsent })}</p>
          <button type="button" disabled={busy} onClick={send}>
            {t("review.sendFirst")}
          </button>
          <button type="button" onClick={() => approveNow(undefined, { discard: true })}>
            {t("review.discardApprove")}
          </button>
          <button type="button" onClick={() => setAsking(null)}>
            {t("review.cancel")}
          </button>
        </div>
      )}
      {said && (
        <p className="hh-caption" role="status">
          {said}
        </p>
      )}
    </footer>
  );
}

function ReasonForm({ reason, setReason, onApprove, onCancel }: { reason: string; setReason(s: string): void; onApprove(): void; onCancel(): void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          {t("review.approveAnyway")}
        </button>
        <button type="button" onClick={onCancel}>
          {t("review.cancel")}
        </button>
      </>
    );
  return (
    <>
      <textarea aria-label={t("review.reasonLabel")} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      <button type="button" disabled={!reason.trim()} onClick={onApprove}>
        {t("review.approve")}
      </button>
      <button type="button" onClick={onCancel}>
        {t("review.cancel")}
      </button>
    </>
  );
}
