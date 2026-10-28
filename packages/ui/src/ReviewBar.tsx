import { type Dispatch, type KeyboardEvent, type SetStateAction, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReviewResult, ReviewSendResult, ReviewSummary } from "./client";

/** What the person is in the middle of: kept by the reader, so it survives the bar moving in and out of focus mode. */
export interface BarDraft {
  asking: "reason" | "unsent" | null;
  /** The reason form is open (after "Approve anyway, with a reason"). */
  writing: boolean;
  reason: string;
  /** "Discard and approve" was chosen: kept for the reason asked next, so the two questions never loop. */
  discard: boolean;
}
export const NO_BAR_DRAFT: BarDraft = { asking: null, writing: false, reason: "", discard: false };

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
  /** The draft held by the caller; absent: the bar keeps its own. */
  draft?: [BarDraft, Dispatch<SetStateAction<BarDraft>>];
}

/** The reader's footer (§5.3, §5.4): send the round, approve, and the approval's line. */
export function ReviewBar({ summary, busy, approvedReason, changesOpen, onSend, onApprove, onSeeChanges, draft }: ReviewBarProps) {
  const { t, i18n } = useTranslation();
  const own = useState<BarDraft>(NO_BAR_DRAFT);
  const [{ asking, writing, reason, discard }, setDraft] = draft ?? own;
  const set = (change: Partial<BarDraft>) => setDraft((d) => ({ ...d, ...change }));
  /** A new prompt starts closed (its reason form too); the reason typed so far stays. */
  const setAsking = (a: BarDraft["asking"]) => setDraft((d) => (d.asking === a ? d : { ...d, asking: a, writing: false }));
  const setReason = (r: string) => set({ reason: r });
  const setDiscard = (d: boolean) => set({ discard: d });
  const [said, setSaid] = useState<string | null>(null);
  const approveRef = useRef<HTMLButtonElement>(null);
  /** Esc closed a prompt: focus goes to "Approve" once it is back, never lost to the page. */
  const refocus = useRef(false);
  useLayoutEffect(() => {
    if (asking !== null || !refocus.current) return;
    refocus.current = false;
    approveRef.current?.focus();
  }, [asking]);
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
      setDraft(NO_BAR_DRAFT);
      setSaid(null);
    } else if (r.reason === "unsent") setAsking("unsent");
    else if (r.reason === "reason-required") setAsking("reason");
    else setSaid(r.reason === "changed" ? t("review.changedWhileOpen") : t("review.failed"));
  };
  const cancel = () => set({ asking: null, writing: false, discard: false });
  /** Esc closes the bar's own prompt and stops there: the reader's Esc (close, leave focus) would drop the reason. */
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || asking === null) return;
    e.preventDefault();
    e.stopPropagation();
    refocus.current = true;
    cancel();
  };
  const discardAndApprove = () => {
    setDiscard(true);
    if (summary.blocking > 0) setAsking("reason");
    else void approveNow(undefined, { discard: true });
  };
  const approve = () => {
    setSaid(null);
    if (summary.unsent > 0) setAsking("unsent");
    else if (summary.blocking > 0) setAsking("reason");
    else void approveNow();
  };

  // One live region, always mounted, so a screen reader hears each new line (§5.3).
  const status = (
    <p className="hh-caption" role="status">
      {said}
    </p>
  );
  if (summary.status === "approved")
    return (
      <footer className="hh-review-bar">
        <span className="hh-review-approved">{t("review.approved", { time: when(summary.approvedAt) })}</span>
        {approvedReason && <span className="hh-caption">{t("review.approvedReason", { reason: approvedReason })}</span>}
        {status}
      </footer>
    );
  return (
    <footer className="hh-review-bar" onKeyDown={onKeyDown}>
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
        <button type="button" ref={approveRef} className="hh-review-approve" onClick={approve}>
          {summary.blocking > 0 ? t("review.approveBlocking", { count: summary.blocking }) : t("review.approve")}
        </button>
      )}
      {asking === "reason" && (
        <div className="hh-review-ask" role="group">
          <ReasonForm open={writing} onOpen={() => set({ writing: true })} reason={reason} setReason={setReason} onApprove={() => approveNow(reason.trim(), discard ? { discard: true } : undefined)} onCancel={cancel} />
        </div>
      )}
      {asking === "unsent" && (
        <div className="hh-review-ask" role="group">
          <p>{t("review.unsent", { count: summary.unsent })}</p>
          <button type="button" disabled={busy} onClick={send}>
            {t("review.sendFirst")}
          </button>
          <button type="button" onClick={discardAndApprove}>
            {t("review.discardApprove")}
          </button>
          <button type="button" onClick={cancel}>
            {t("review.cancel")}
          </button>
        </div>
      )}
      {status}
    </footer>
  );
}

function ReasonForm({
  open,
  onOpen,
  reason,
  setReason,
  onApprove,
  onCancel,
}: {
  open: boolean;
  onOpen(): void;
  reason: string;
  setReason(s: string): void;
  onApprove(): void;
  onCancel(): void;
}) {
  const { t } = useTranslation();
  if (!open)
    return (
      <>
        <button type="button" onClick={onOpen}>
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
