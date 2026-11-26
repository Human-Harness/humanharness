import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The folded overlays of an open task (task view one column): the path on the left, a mod's overlay (`mod:<id>/<name>`,
 * `ctx.taskOverlay`) on the right.
 */
export type OverlayName = "path" | `mod:${string}`;

/**
 * Which overlay is open: one at a time, none on mount, and none again when `key` (the task) changes. A close puts
 * focus back on the overlay's trigger; `show(name, false)` opens without moving focus (a card arriving).
 */
export function useOverlay(key: unknown) {
  const [open, setOpen] = useState<OverlayName | null>(null);
  const [focusIn, setFocusIn] = useState(true);
  const triggers = useRef<Partial<Record<OverlayName, HTMLElement | null>>>({});
  const refs = useRef<Partial<Record<OverlayName, (el: HTMLElement | null) => void>>>({});
  const openRef = useRef(open);
  openRef.current = open;
  const seen = useRef(key);
  useEffect(() => {
    if (seen.current === key) return;
    seen.current = key;
    setOpen(null);
  }, [key]);
  const show = useCallback((name: OverlayName, focus = true) => {
    setFocusIn(focus);
    setOpen(name);
  }, []);
  const close = useCallback((returnFocus = true) => {
    const was = openRef.current;
    if (was === null) return;
    setOpen(null);
    if (returnFocus) triggers.current[was]?.focus();
  }, []);
  const toggle = useCallback((name: OverlayName) => (openRef.current === name ? close() : show(name)), [close, show]);
  /** A stable ref callback for the trigger of `name`. */
  const trigger = (name: OverlayName) =>
    (refs.current[name] ??= (el: HTMLElement | null) => {
      triggers.current[name] = el;
    });
  return { open, focusIn, show, close: () => close(), hide: () => close(false), toggle, trigger };
}
