import { type RefObject, useId } from "react";
import { useTranslation } from "react-i18next";
import { FlaggedText } from "./FlaggedText";

export interface ComposerProps {
  draft: string;
  onDraft: (text: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  placeholder: string;
  /** Enter: send (a review first when a reviewer reviews); `force` is ⌥⏎, a review even without marks. */
  onEnter: (text: string, force: boolean) => void;
  /** ⌘⏎ / Ctrl⏎ with a reviewer: send at once, cancelling a running review. */
  onSendNow: (text: string) => void;
  /** Review: a review asked by hand. */
  onReview: (text: string) => void;
  /**
   * A reviewer is there (a mod's `ctx.composer`): the field sits over the underline backdrop with these spans, and ⌘⏎
   * sends at once. Wrapped from the first render (not once the reviewer's state loads) so the field is never remounted
   * under the person's cursor.
   */
  marks?: readonly (readonly [number, number])[] | undefined;
  /** Review offered (`idle`), or one running (`reviewing`: the field waits, read-only). Absent: no Review button. */
  review?: "idle" | "reviewing" | undefined;
}

/**
 * The one-field composer (DESIGN.md §10.7): the field with its hint inside, and Review when a reviewer reviews before
 * sending. No Send button: Enter sends, Shift+Enter adds a line. Stop lives on the working line, not here.
 */
export function Composer({ draft, onDraft, inputRef, placeholder, onEnter, onSendNow, onReview, marks, review }: ComposerProps) {
  /** The spans underlined, when a reviewer reviews before sending. */
  const spans = marks as readonly [number, number][] | undefined;
  const { t } = useTranslation();
  const hintId = useId();
  const textarea = (
    <textarea
      ref={inputRef}
      aria-label={placeholder}
      aria-describedby={hintId}
      placeholder={placeholder}
      value={draft}
      readOnly={review === "reviewing"}
      onChange={(e) => onDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.shiftKey) return;
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        if (spans && (e.metaKey || e.ctrlKey)) onSendNow(draft);
        else onEnter(draft, e.altKey);
      }}
    />
  );
  return (
    <form
      className="hh-composer"
      onSubmit={(e) => {
        e.preventDefault();
        onEnter(draft, false);
      }}
    >
      <div className="hh-composer-field">
        {spans ? (
          <FlaggedText text={draft} spans={spans}>
            {textarea}
          </FlaggedText>
        ) : (
          textarea
        )}
        <span id={hintId} className="hh-composer-send-hint">
          {t("chat.composerHint", { defaultValue: "↵ send · ⇧↵ new line" })}
        </span>
      </div>
      {review === "reviewing" ? (
        <button type="button" disabled>
          {t("chat.reviewing")}
        </button>
      ) : review === "idle" ? (
        <button type="button" onClick={() => onReview(draft)}>
          {t("chat.review")}
        </button>
      ) : null}
    </form>
  );
}
