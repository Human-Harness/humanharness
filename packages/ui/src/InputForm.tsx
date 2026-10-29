import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BlockAnswer, InputField, InputIssue, InputSpec } from "./client";
import { type Draft, answerRows, draftOf, draftValue, emptyDraft, isSkipped, optionLabel, optionsOf } from "./input";
import { ReviewHint } from "./sidekick/ReviewHint";

/** Drafts by block id: they survive the chat being drawn again (Home, Settings), not a restart (spec §11.2). */
const drafts = new Map<string, Draft>();

/**
 * Drops the drafts whose block can't come back: every one outside the open task `task` (all of them when no task
 * is open) and, while the task waits on `pending`, every one but that question's. A sent answer's draft stays while
 * its task is open, so a send stopped before its turn reopens the form as it was.
 */
export function pruneDrafts(task: string | undefined, pending: string | undefined): void {
  for (const id of [...drafts.keys()]) {
    if (!task || !id.startsWith(`${task}:`) || (pending !== undefined && id !== pending)) drafts.delete(id);
  }
}

export interface InputFormProps {
  spec: InputSpec;
  /** The block's shown data: a choice's options may come from it. */
  data: unknown;
  /** Drafts are kept by it. */
  blockId?: string;
  /** Saved values to start from (a setup form, setup-steps spec §3). A kept draft wins. */
  initial?: Record<string, unknown>;
  /** The form's id: a button elsewhere (the setup screen's footer) submits it, so the form draws no buttons of its own. */
  formId?: string;
  disabled: boolean;
  sending: boolean;
  /** From the main process: by field (`path`), "" for the whole answer. */
  errors: InputIssue[];
  submit(value: Record<string, unknown>): void;
  skip?: () => void;
  /**
   * Sidekick's pre-send review of the answer's free text (sidekick spec §4.1), absent with Sidekick off (D0). A card
   * holds the answer: the form stays as it is and `hold.anyway` (the card's "Send anyway") sends it unreviewed. Skip
   * calls the card's `drop`: the card leaves with the answer.
   */
  review?: (text: string, hold: AnswerHold) => Promise<{ kind: "send" } | { kind: "card"; drop?: () => void }>;
  /** "Send now" while the review runs: stops the review this form started. */
  cancelReview?: () => void;
  /** The person's longest wait for a review (Sidekick settings): the form shows its countdown. */
  reviewWait?: number | "always";
}

/** What a held answer's card can do with the form. */
export interface AnswerHold {
  /**
   * Sends the form as it is now, without another review. False when nothing went: the form is gone (another task,
   * a skip) or can't send now; the card then stays.
   */
  anyway(): boolean;
  /** Moves focus to the answer's first text field. */
  focus(): void;
}

/** The answer's free text: its text fields' non-empty values, in the fields' order. */
function freeText(spec: InputSpec, value: Record<string, unknown>): string {
  return spec.fields
    .filter((f) => f.kind === "text" || f.kind === "longText")
    .map((f) => value[f.name])
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .join("\n\n");
}

const ofField = (e: InputIssue, name: string) => e.path === name || e.path.startsWith(`${name}.`);

/** The core form of an input block (input-blocks spec §5): a labelled control per field, errors next to each. */
export function InputForm({ spec, data, blockId, initial, formId, disabled, sending, errors, submit, skip, review, cancelReview, reviewWait }: InputFormProps) {
  const { t } = useTranslation();
  const base = useId();
  const box = useRef<HTMLFormElement>(null);
  /** A review in flight: a second Send starts no second one, and a late answer (after Send now) is dropped. */
  const [reviewing, setReviewing] = useState<{ until: number | null } | null>(null);
  const reviewSeq = useRef(0);
  const running = useRef(false);
  /** False once the form is gone: a hold it gave out sends nothing (a remounted form has a draft of its own). */
  const alive = useRef(true);
  /** The hold a card has now: Skip closes it and drops its card. */
  const held = useRef<{ close(): void; drop?: () => void } | null>(null);
  const [draft, setDraft] = useState<Draft>(() => (blockId ? drafts.get(blockId) : undefined) ?? (initial ? draftOf(spec, initial) : emptyDraft(spec)));
  const change = (name: string, v: unknown) =>
    setDraft((d) => {
      const next = { ...d, [name]: v };
      if (blockId) drafts.set(blockId, next);
      return next;
    });
  const general = errors.filter((e) => !spec.fields.some((f) => ofField(e, f.name)) && e.message);
  const hasFieldErrors = errors.some((e) => spec.fields.some((f) => ofField(e, f.name)));
  const unsupported = spec.fields.some((f) => f.kind === null);
  const send = (): boolean => {
    if (disabled || sending || unsupported) return false;
    submit(draftValue(spec, draft));
    return true;
  };
  // The hold outlives this render: it sends whatever the form holds when the card's button is pressed.
  const latest = useRef(send);
  latest.current = send;
  const latestCancel = useRef(cancelReview);
  latestCancel.current = cancelReview;
  const stopReview = () => {
    reviewSeq.current++;
    running.current = false;
    setReviewing(null);
    latestCancel.current?.();
  };
  // A form gone while its review runs (the question closed, the task changed) stops that review.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (running.current) {
        running.current = false;
        reviewSeq.current++;
        latestCancel.current?.();
      }
    };
  }, []);
  /** The first text or long-text field: Edit on the card moves focus there (never a pairs cell). */
  const textField = spec.fields.find((f) => f.kind === "text" || f.kind === "longText");
  const textId = textField ? `${base}-${textField.name}` : null;
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (running.current || disabled || sending || unsupported) return;
    const value = draftValue(spec, draft);
    const text = review ? freeText(spec, value) : "";
    // D0: no review (Sidekick off), choices only or no text: sent as before.
    if (!review || !text) {
      submit(value);
      return;
    }
    const seq = ++reviewSeq.current;
    running.current = true;
    setReviewing({ until: reviewWait === undefined || reviewWait === "always" ? null : Date.now() + reviewWait * 1000 });
    let open = true;
    const hold: AnswerHold = {
      anyway: () => {
        if (!open || !alive.current || !latest.current()) return false;
        open = false;
        return true;
      },
      focus: () => {
        if (alive.current && textId) document.getElementById(textId)?.focus();
      },
    };
    // Any failure sends the answer: Sidekick never stands in its way beyond the person's wait.
    const r = await review(text, hold).catch(() => ({ kind: "send" }) as const);
    if (seq !== reviewSeq.current) return;
    running.current = false;
    setReviewing(null);
    if (r.kind !== "card") {
      latest.current();
      return;
    }
    held.current = { close: () => (open = false), ...(r.drop ? { drop: r.drop } : {}) };
  };
  const sendNow = () => {
    if (!running.current) return;
    stopReview();
    send();
  };
  return (
    <form ref={box} id={formId} className="hh-input-form" onSubmit={(e) => void onSubmit(e)} noValidate {...(reviewing ? { "aria-busy": true } : {})}>
      {(hasFieldErrors || general.length > 0) && (
        <div className="hh-input-errors" role="alert">
          {hasFieldErrors && <p>{t("input.errorsTitle")}</p>}
          {general.map((e, i) => (
            <p key={i}>{e.message}</p>
          ))}
        </div>
      )}
      {spec.fields.map((f) => (
        <Field
          key={f.name}
          field={f}
          id={`${base}-${f.name}`}
          value={draft[f.name]}
          data={data}
          error={errors.filter((e) => ofField(e, f.name)).map((e) => e.message).join(" ")}
          disabled={disabled || sending}
          onChange={(v) => change(f.name, v)}
        />
      ))}
      {!formId && (
        <div className="hh-input-actions">
          {/* Reviewing keeps the button (and focus) in place: aria-disabled, never disabled. */}
          <button type="submit" className="hh-primary" disabled={disabled || sending || unsupported} {...(reviewing ? { "aria-disabled": true } : {})}>
            {reviewing ? t("sidekick.composer.reviewing") : sending ? t("input.sending") : (spec.submitLabel ?? t("input.send"))}
          </button>
          {reviewing && (
            <button type="button" onClick={sendNow}>
              {t("sidekick.answer.sendNow")}
            </button>
          )}
          {reviewing && reviewWait !== undefined && <ReviewHint until={reviewing.until} />}
          {skip && (
            <button
              type="button"
              className="hh-link"
              disabled={disabled || sending}
              onClick={() => {
                if (running.current) stopReview();
                // A held answer's card leaves with it: nothing it says is about an answer that goes now.
                const h = held.current;
                held.current = null;
                h?.close();
                h?.drop?.();
                skip();
              }}
            >
              {t("input.skip")}
            </button>
          )}
        </div>
      )}
    </form>
  );
}

function Field({
  field,
  id,
  value,
  data,
  error,
  disabled,
  onChange,
}: {
  field: InputField;
  id: string;
  value: unknown;
  data: unknown;
  error: string;
  disabled: boolean;
  onChange: (v: unknown) => void;
}) {
  const { t } = useTranslation();
  const label = field.label;
  const errId = `${id}-error`;
  const invalid = error ? { "aria-invalid": true as const, "aria-describedby": errId } : {};
  const errorLine = error ? (
    <p id={errId} className="hh-field-error">
      {error}
    </p>
  ) : null;
  const optional = field.optional ? <span className="hh-caption"> {t("input.optional")}</span> : null;
  if (field.kind === null) return <p className="hh-caption">{t("input.unsupported", { field: label })}</p>;
  if (field.kind === "boolean") {
    return (
      <div className="hh-field">
        <label className="hh-option">
          <input id={id} type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} {...invalid} />
          {label}
        </label>
        {errorLine}
      </div>
    );
  }
  const options = field.kind === "choice" || field.kind === "multiChoice" ? optionsOf(field, data) : [];
  if (field.kind === "choice" && options.length > 0) {
    return (
      <fieldset className="hh-field" {...(error ? { "aria-describedby": errId } : {})}>
        <legend>
          {label}
          {optional}
        </legend>
        {options.map((o) => (
          <label key={o} className="hh-option">
            <input type="radio" name={id} value={o} checked={value === o} disabled={disabled} onChange={() => onChange(o)} {...invalid} />
            {optionLabel(field, o)}
          </label>
        ))}
        {errorLine}
      </fieldset>
    );
  }
  if (field.kind === "multiChoice") {
    const picked = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset className="hh-field" {...(error ? { "aria-describedby": errId } : {})}>
        <legend>
          {label}
          {optional}
        </legend>
        {options.map((o) => (
          <label key={o} className="hh-option">
            <input
              type="checkbox"
              checked={picked.includes(o)}
              disabled={disabled}
              // In the options' order, whatever the order of the clicks.
              onChange={(e) => onChange(options.filter((x) => (x === o ? e.target.checked : picked.includes(x))))}
              {...invalid}
            />
            {optionLabel(field, o)}
          </label>
        ))}
        {errorLine}
      </fieldset>
    );
  }
  if (field.kind === "pairs") {
    return (
      <PairsField field={field} value={value} label={label} optional={optional} errorLine={errorLine} invalid={invalid} disabled={disabled} onChange={onChange} />
    );
  }
  // Text, long text, a number, and a choice whose shown data brought no options.
  const common = {
    id,
    value: typeof value === "string" ? value : "",
    disabled,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    ...invalid,
  };
  return (
    <div className="hh-field">
      <label htmlFor={id}>
        {label}
        {optional}
      </label>
      {field.kind === "longText" ? (
        <textarea className="hh-input-long" {...common} {...(field.max !== undefined ? { maxLength: field.max } : {})} />
      ) : field.kind === "number" ? (
        <input type="number" {...common} {...(field.min !== undefined ? { min: field.min } : {})} {...(field.max !== undefined ? { max: field.max } : {})} />
      ) : (
        <input type="text" {...common} {...(field.max !== undefined ? { maxLength: field.max } : {})} />
      )}
      {errorLine}
    </div>
  );
}

/** Rows of two cells. Each row keeps a key of its own, so removing one leaves the others' inputs (and focus) in place. */
function PairsField({
  field,
  value,
  label,
  optional,
  errorLine,
  invalid,
  disabled,
  onChange,
}: {
  field: InputField;
  value: unknown;
  label: string;
  optional: ReactNode;
  errorLine: ReactNode;
  invalid: { "aria-invalid"?: true; "aria-describedby"?: string };
  disabled: boolean;
  onChange: (v: unknown) => void;
}) {
  const { t } = useTranslation();
  const rows = Array.isArray(value) && value.length > 0 ? (value as Record<string, string>[]) : [{}];
  const cols = field.columns ?? [];
  const keys = useRef<number[]>([]);
  const nextKey = useRef(0);
  while (keys.current.length < rows.length) keys.current.push(nextKey.current++);
  keys.current.length = rows.length;
  const box = useRef<HTMLFieldSetElement>(null);
  const [focusRow, setFocusRow] = useState<number | null>(null);
  useEffect(() => {
    if (focusRow === null) return;
    const pairs = box.current?.querySelectorAll<HTMLElement>(".hh-pair");
    pairs?.[Math.min(focusRow, pairs.length - 1)]?.querySelector("input")?.focus();
    setFocusRow(null);
  }, [focusRow]);
  const remove = (r: number) => {
    keys.current.splice(r, 1);
    onChange(rows.filter((_, j) => j !== r));
    setFocusRow(r);
  };
  return (
    <fieldset ref={box} className="hh-field hh-pairs" {...(invalid["aria-describedby"] ? { "aria-describedby": invalid["aria-describedby"] } : {})}>
      <legend>
        {label}
        {optional}
      </legend>
      {rows.map((row, r) => (
        <div key={keys.current[r]} className="hh-pair">
          {cols.map((c) => (
            <input
              key={c.name}
              type="text"
              aria-label={`${c.label} ${r + 1}`}
              value={row[c.name] ?? ""}
              disabled={disabled}
              onChange={(e) => onChange(rows.map((x, j) => (j === r ? { ...x, [c.name]: e.target.value } : x)))}
              {...invalid}
            />
          ))}
          {rows.length > 1 && (
            <button type="button" aria-label={t("input.removeRow", { n: r + 1 })} disabled={disabled} onClick={() => remove(r)}>
              ×
            </button>
          )}
        </div>
      ))}
      <button type="button" disabled={disabled} onClick={() => onChange([...rows, {}])}>
        {t("input.addRow")}
      </button>
      {errorLine}
    </fieldset>
  );
}

/** A sent answer, read-only. */
export function AnswerView({ spec, answer }: { spec: InputSpec; answer: BlockAnswer }) {
  const { t } = useTranslation();
  if (isSkipped(answer.value)) return <p className="hh-answer hh-caption">{t("input.skipped")}</p>;
  const rows = answerRows(spec, answer.value, [t("input.yes"), t("input.no")]);
  return (
    <div className="hh-answer">
      <p className="hh-caption">{t("input.answered")}</p>
      <dl>
        {rows.map((r, i) => (
          <div key={i}>
            <dt>{r.label}</dt>
            <dd>{r.text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
