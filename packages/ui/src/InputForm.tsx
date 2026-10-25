import { type ChangeEvent, type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BlockAnswer, InputField, InputIssue, InputSpec } from "./client";
import { type Draft, type Lang, answerRows, draftValue, emptyDraft, isSkipped, langOf, optionsOf } from "./input";

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
  const { t, i18n } = useTranslation();
  const lang = langOf(i18n.language);
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
          lang={lang}
          onChange={(v) => change(f.name, v)}
        />
      ))}
      <div className="hh-input-actions">
        <button type="submit" className="hh-primary" disabled={disabled || sending || unsupported}>
          {sending ? t("input.sending") : (spec.submitLabel?.[lang] ?? t("input.send"))}
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
  lang,
  onChange,
}: {
  field: InputField;
  id: string;
  value: unknown;
  data: unknown;
  error: string;
  disabled: boolean;
  lang: Lang;
  onChange: (v: unknown) => void;
}) {
  const { t } = useTranslation();
  const label = field.label[lang];
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
            <input type="radio" name={id} value={o} checked={value === o} disabled={disabled} onChange={() => onChange(o)} />
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
              onChange={(e) => onChange(e.target.checked ? [...picked, o] : picked.filter((p) => p !== o))}
            />
            {o}
          </label>
        ))}
        {errorLine}
      </fieldset>
    );
  }
  if (field.kind === "pairs") {
    const rows = Array.isArray(value) && value.length > 0 ? (value as Record<string, string>[]) : [{}];
    const cols = field.columns ?? [];
    return (
      <fieldset className="hh-field hh-pairs" {...(error ? { "aria-describedby": errId } : {})}>
        <legend>
          {label}
          {optional}
        </legend>
        {rows.map((row, r) => (
          <div key={r} className="hh-pair">
            {cols.map((c) => (
              <input
                key={c.name}
                type="text"
                aria-label={`${c.label[lang]} ${r + 1}`}
                value={row[c.name] ?? ""}
                disabled={disabled}
                onChange={(e) => onChange(rows.map((x, j) => (j === r ? { ...x, [c.name]: e.target.value } : x)))}
              />
            ))}
            {rows.length > 1 && (
              <button type="button" aria-label={t("input.removeRow", { n: r + 1 })} disabled={disabled} onClick={() => onChange(rows.filter((_, j) => j !== r))}>
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

/** A sent answer, read-only. */
export function AnswerView({ spec, answer }: { spec: InputSpec; answer: BlockAnswer }) {
  const { t, i18n } = useTranslation();
  if (isSkipped(answer.value)) return <p className="hh-answer hh-caption">{t("input.skipped")}</p>;
  const rows = answerRows(spec, answer.value, langOf(i18n.language), [t("input.yes"), t("input.no")]);
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
