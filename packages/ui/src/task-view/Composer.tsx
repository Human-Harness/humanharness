import { type RefObject, useId } from "react";
import { useTranslation } from "react-i18next";
import { FlaggedText } from "../sidekick/FlaggedText";

export interface ComposerProps {
  draft: string;
  onDraft: (text: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  placeholder: string;
  /** Enter: send (a review first when Sidekick is on); `force` is ⌥⏎, a review even without flags (sidekick spec §4.1). */
  onEnter: (text: string, force: boolean) => void;
  /** ⌘⏎ / Ctrl⏎ with Sidekick: send at once, cancelling a running review. */
  onSendNow: (text: string) => void;
  /** Review: a review asked by hand. */
  onReview: (text: string) => void;
  /**
   * The harness has Sidekick: the field sits over its underline backdrop with the card's spans. Wrapped from the first
   * render (not once the state loads) so the field is never remounted under the person's cursor.
   */
  sidekick?: { spans: readonly [number, number][] } | undefined;
  /** Review offered (`idle`), or one running (`reviewing`: the field waits, read-only). Absent: no Review button. */
  review?: "idle" | "reviewing" | undefined;
}

/**
 * The one-field composer (DESIGN.md §10.7): the field with its hint inside, and Review when Sidekick reviews before
 * sending. No Send button: Enter sends, Shift+Enter adds a line. Stop lives on the working line, not here.
 */
export function Composer({ draft, onDraft, inputRef, placeholder, onEnter, onSendNow, onReview, sidekick, review }: ComposerProps) {
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
        if (sidekick && (e.metaKey || e.ctrlKey)) onSendNow(draft);
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
        {sidekick ? (
          <FlaggedText text={draft} spans={sidekick.spans}>
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
          {t("sidekick.composer.reviewing")}
        </button>
      ) : review === "idle" ? (
        <button type="button" onClick={() => onReview(draft)}>
          {t("sidekick.composer.review")}
        </button>
      ) : null}
    </form>
  );
}
