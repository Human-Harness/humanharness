import { type RefObject, useEffect, useRef } from "react";

/** What Tab can reach inside a modal: enabled controls, links and anything with a non-negative tabindex. */
export const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab and Shift+Tab cycling inside a modal (the Settings sheet, its confirmations and the language dialogs). */
export function trapTab(sheet: HTMLElement, e: KeyboardEvent) {
  const items = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)];
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!sheet.contains(active)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Tab and Escape for a dialog stacked on another modal (the language dialogs over the Settings sheet), heard on the
 * document while it is open, so they keep working once focus has left the dialog (a click on its backdrop). It
 * listens in the capture phase and stops the event there: the sheet's own document listener never sees it, so
 * Escape closes only this dialog and Tab cycles only inside it.
 */
export function useDialogKeys(dialog: RefObject<HTMLElement | null>, onEscape: () => void) {
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = dialog.current;
      if (!el) return;
      if (e.key === "Tab") {
        e.stopPropagation();
        trapTab(el, e);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        escapeRef.current();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [dialog]);
}
