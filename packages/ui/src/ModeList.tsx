import { type KeyboardEvent, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModeOption } from "./modes";

/** The modes as buttons, each with its description; the current one pressed. */
export function ModeList({
  id,
  modes,
  current,
  disabled,
  onPick,
  labelledBy,
}: {
  id?: string;
  modes: ModeOption[];
  current?: string;
  disabled: boolean;
  onPick: (id: string) => void;
  /** The id of the text that names the list. */
  labelledBy: string;
}) {
  return (
    <div id={id} className="hh-mode-list" role="group" aria-labelledby={labelledBy}>
      {modes.map((m) => (
        <button key={m.id} type="button" className="hh-choice" aria-pressed={m.id === current} disabled={disabled} onClick={() => onPick(m.id)}>
          <strong>{m.label}</strong>
          {m.description && <span className="hh-mode-reasons">{m.description}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * The open task's mode, above the chat (task-modes spec §5): its name, "Change mode", and a note when the task runs
 * below the level the mode asks for. Only for a task whose action has modes.
 */
export function ModeBar({
  modes,
  current,
  below,
  disabled,
  onPick,
}: {
  modes: ModeOption[];
  current?: string;
  below?: boolean;
  disabled: boolean;
  onPick: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const changeId = useId();
  const listId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const label = modes.find((m) => m.id === current)?.label;
  const shown = open && !disabled;
  // Escape closes the list and gives focus back to "Change mode".
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !shown) return;
    e.stopPropagation();
    setOpen(false);
    toggle.current?.focus();
  };
  return (
    <div className="hh-mode-bar" role="group" aria-label={t("modes.bar")} onKeyDown={onKey}>
      {/* Polite: a switch (from any window control or the harness's own UI) is announced once it is the task's. */}
      <span aria-live="polite">{label ? t("modes.current", { mode: label }) : t("modes.none")}</span>
      {below && label && <span className="hh-caption">{t("modes.belowTier")}</span>}
      <button
        ref={toggle}
        type="button"
        id={changeId}
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {t("modes.change")}
      </button>
      {shown && (
        <ModeList
          id={listId}
          modes={modes}
          current={current}
          disabled={disabled}
          labelledBy={changeId}
          onPick={(id) => {
            // The list goes: focus back on "Change mode", as with Escape (a question the pick opens takes it next).
            setOpen(false);
            toggle.current?.focus();
            onPick(id);
          }}
        />
      )}
    </div>
  );
}
