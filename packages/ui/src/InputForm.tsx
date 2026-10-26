import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BlockAnswer, InputField, InputIssue, InputSpec } from "./client";
import { type Draft, answerRows, draftValue, emptyDraft, isSkipped, optionsOf } from "./input";

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
  disabled: boolean;
  sending: boolean;
  /** From the main process: by field (`path`), "" for the whole answer. */
  errors: InputIssue[];
  submit(value: Record<string, unknown>): void;
  skip?: () => void;
}

const ofField = (e: InputIssue, name: string) => e.path === name || e.path.startsWith(`${name}.`);

/** The core form of an input block (input-blocks spec §5): a labelled control per field, errors next to each. */
export function InputForm({ spec, data, blockId, disabled, sending, errors, submit, skip }: InputFormProps) {
  const { t } = useTranslation();
  const base = useId();
  const [draft, setDraft] = useState<Draft>(() => (blockId ? drafts.get(blockId) : undefined) ?? emptyDraft(spec));
  const change = (name: string, v: unknown) =>
    setDraft((d) => {
      const next = { ...d, [name]: v };
      if (blockId) drafts.set(blockId, next);
      return next;
    });
  const general = errors.filter((e) => !spec.fields.some((f) => ofField(e, f.name)) && e.message);
  const hasFieldErrors = errors.some((e) => spec.fields.some((f) => ofField(e, f.name)));
  const unsupported = spec.fields.some((f) => f.kind === null);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!disabled && !sending && !unsupported) submit(draftValue(spec, draft));
  };
  return (
    <form className="hh-input-form" onSubmit={onSubmit} noValidate>
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
      <div className="hh-input-actions">
        <button type="submit" className="hh-primary" disabled={disabled || sending || unsupported}>
          {sending ? t("input.sending") : (spec.submitLabel ?? t("input.send"))}
        </button>
        {skip && (
          <button type="button" className="hh-link" disabled={disabled || sending} onClick={skip}>
            {t("input.skip")}
          </button>
        )}
      </div>
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
            {o}
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
            {o}
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
