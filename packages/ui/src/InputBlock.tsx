import { type ComponentType, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatBlock, InputIssue, InputSpec } from "./client";
import { AnswerView, InputForm, type InputFormProps } from "./InputForm";
import type { BlockActions, BlockProps, InputContext, InputProps } from "./Message";

/** The shown data's first text: the core view's heading (usually the question). */
export function headingOf(data: unknown): string {
  if (typeof data !== "object" || data === null) return "";
  const first = Object.values(data).find((v) => typeof v === "string" && v.trim());
  return typeof first === "string" ? first : "";
}

/**
 * One input block in the chat: it holds the last refusal's errors and the sending state, then draws the harness's
 * component (with `input`) or the core view. Only the open task's pending question may be sent, and only while
 * nothing runs.
 */
export function InputHost({
  block,
  spec,
  Component,
  actions,
  inputs,
  fade = false,
}: {
  block: ChatBlock;
  /** The block's own spec, found by the caller. */
  spec: InputSpec;
  Component?: ComponentType<BlockProps>;
  actions: Omit<BlockActions, "inputs">;
  inputs: InputContext;
  /** The answer is arriving: the block fades in. */
  fade?: boolean;
}) {
  const [errors, setErrors] = useState<InputIssue[]>([]);
  const [sending, setSending] = useState(false);
  // The question the task waits on. A send stopped after it was taken reopens it while its block stays marked
  // answered: the waiting task wins, so the person can answer again.
  const open = block.id !== undefined && block.id === inputs.pending && (block.input === undefined || inputs.waiting);
  // The app clears the pending question before the answer is taken: until then the form stays, never "closed".
  const pending = open || (sending && block.input === undefined);
  const answered = open ? undefined : block.input;
  const submit = (value: Record<string, unknown>) => {
    if (!block.id || !open || !inputs.ready || sending) return;
    setSending(true);
    setErrors([]);
    void inputs.respond(block.id, value).then((r) => {
      setSending(false);
      if (!r.ok) setErrors(r.errors);
    });
  };
  const input: InputProps = {
    spec,
    ...(block.id ? { blockId: block.id } : {}),
    pending,
    disabled: !open || !inputs.ready || sending,
    ...(answered ? { answered } : {}),
    errors,
    sending,
    submit,
    ...(spec.skippable ? { skip: () => submit({ skipped: true }) } : {}),
  };
  return (
    <div className={fade ? "hh-block hh-appear" : "hh-block"}>
      {Component ? (
        <Component data={block.data} {...actions} input={input} />
      ) : (
        <CoreInputBlock
          data={block.data}
          input={input}
          {...(inputs.review ? { review: inputs.review } : {})}
          {...(inputs.cancelReview ? { cancelReview: inputs.cancelReview } : {})}
        />
      )}
    </div>
  );
}

/** The core view of an input block: its question, then the form, the answer, or "closed". */
export function CoreInputBlock({ data, input, review, cancelReview }: { data: unknown; input: InputProps } & Pick<InputFormProps, "review" | "cancelReview">) {
  const { t } = useTranslation();
  const heading = headingOf(data);
  return (
    <section className="hh-input-block" {...(heading ? { "aria-label": heading } : {})}>
      {heading && <h3>{heading}</h3>}
      {input.answered ? (
        <AnswerView spec={input.spec} answer={input.answered} />
      ) : input.pending ? (
        <InputForm
          spec={input.spec}
          data={data}
          {...(input.blockId ? { blockId: input.blockId } : {})}
          disabled={input.disabled}
          sending={input.sending}
          errors={input.errors}
          submit={input.submit}
          {...(input.skip ? { skip: input.skip } : {})}
          {...(review ? { review } : {})}
          {...(cancelReview ? { cancelReview } : {})}
        />
      ) : (
        <p className="hh-caption">{t("input.closed")}</p>
      )}
    </section>
  );
}
