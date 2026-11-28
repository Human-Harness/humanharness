import { type RefObject, createElement, useCallback, useEffect, useRef, useState } from "react";
import type { HarnessClient } from "./client";
import { type Paused, NO_PAUSED, countPaused, pausedSummary } from "./focus-notices";
import { SlotBoundary } from "./layout/BlockBoundary";
import type { BlockRegistry, FileTarget, PanelProps, Slots } from "./layout/registry";

/** Ends the task view's quiet mode, whoever started it. */
export function endQuiet(registry: BlockRegistry): void {
  for (const held of registry.slot("quiet")) held.end();
}

/** Closes the panel a mod has open in the reader's slot. */
function closePanels(registry: BlockRegistry): void {
  for (const panel of registry.slot("openPanel")) panel.close();
}

/** A mod's open panel in the reader's slot. Opened again, it stays mounted and gets the new props. */
export function SidePanel({ entry, onError, ...app }: Omit<PanelProps, "props"> & { entry: Slots["openPanel"]; onError(mod: string): void }) {
  return createElement(SlotBoundary, {
    key: entry.mod,
    mod: entry.mod,
    client: app.client,
    onError: () => onError(entry.mod),
    children: createElement(entry.Component, { ...app, props: entry.props }),
  });
}

interface Options {
  client: HarnessClient;
  registry: BlockRegistry;
  /** Slim (the setup screen) shows no reader's slot: nothing opens a file there. */
  slim: boolean;
  /** The harness's agent may edit the folder (review spec D0). */
  review: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
  composer: RefObject<HTMLElement | null>;
  /** What else takes the reader's slot: the context panel. */
  setContextOpen(open: boolean): void;
  /** Says what quiet mode held back, on leaving it. */
  onSummary(line: string): void;
}

/**
 * The task view's side of the reader's slot: how a file opens (a mod's `openFile` handler: the core opens none), a mod's
 * panel, and the quiet mode (focus mode, review spec §6.2).
 */
export function useReaderSlot(options: Options) {
  const { client, registry, review } = options;
  /** The latest render's options: the callbacks below keep their identity. */
  const now = useRef(options);
  now.current = options;

  const [readerFull, setReaderFull] = useState(false);
  /** What had focus when the slot opened from the chat (a card, a link): it gets focus back when the slot closes. */
  const opener = useRef<HTMLElement | null>(null);
  const panel = registry.slot("openPanel").at(-1);
  /** The panel that shows a file's history alone (`historyOnly`), once opened. */
  const history = useRef<Slots["openPanel"]>(undefined);
  /** The slot held a panel at the last look: when it empties, the focus goes back. */
  const wasFilled = useRef(false);
  /** The mod whose panel threw: the failed part stands in the slot, until the slot lets go of it. */
  const [failedMod, setFailedMod] = useState<string | undefined>(undefined);
  const failed = panel !== undefined && panel.mod === failedMod;
  const held = registry.slot("quiet").length > 0;
  const quiet = held && !failed;
  const isQuiet = () => registry.slot("quiet").length > 0;
  /** What quiet mode held back, told in one line on leaving. */
  const paused = useRef<Paused>(NO_PAUSED);
  /** Counts a notice for the summary while quiet; false when the view is not quiet, so it shows as usual. */
  const hold = (notice: Parameters<typeof countPaused>[1]): boolean => {
    if (!isQuiet()) return false;
    paused.current = countPaused(paused.current, notice);
    return true;
  };

  useEffect(() => {
    let was = isQuiet();
    const off = registry.subscribe(() => {
      if (isQuiet() === was) return;
      was = !was;
      if (was) return;
      now.current.client.focus.set({ on: false });
      const line = pausedSummary(now.current.t, paused.current);
      paused.current = NO_PAUSED;
      if (line) now.current.onSummary(line);
    });
    return () => {
      off();
      // The slot and quiet mode go with the view, a mod's too (it hears no unmount); off first, so nothing is told.
      endQuiet(registry);
      closePanels(registry);
    };
  }, [registry]);

  const keepOpener = () => {
    const active = document.activeElement;
    // A link inside the reader keeps the first opener.
    if (active instanceof HTMLElement && active !== document.body && !active.closest(".hh-reader")) opener.current = active;
  };

  /** True when something opens files: a mod's handler. */
  const canOpen = () => registry.slot("opener").length > 0;

  /** Every way a file opens goes through here. */
  const open = useCallback(
    (target: FileTarget) => {
      const handler = registry.slot("opener").at(-1);
      if (!handler || now.current.slim) return;
      // A file's history alone gives the focus to the composer when it closes, not back to what opened it.
      if (target.historyOnly) opener.current = null;
      else keepOpener();
      try {
        handler.open(target);
        history.current = target.historyOnly ? registry.slot("openPanel").at(-1) : undefined;
      } catch (err) {
        console.error(`Mod ${handler.mod}: its openFile handler threw`, err);
      }
    },
    [registry],
  );

  const setFocusMode = useCallback(
    (on: boolean, path?: string) => {
      if (!on) return endQuiet(registry);
      client.focus.set(path ? { on: true, path } : { on: false });
      if (registry.slot("quiet").length > 0) return;
      const off: () => void = registry.add("quiet", { mod: "core", end: () => off() });
    },
    [client, registry],
  );

  // `client.documents.focus(path)` from a harness view: only where the review exists (D0), never on the setup screen.
  useEffect(
    () =>
      client.documents.onFocus((p) => {
        if (!review || now.current.slim || !canOpen() || typeof p !== "string" || !p) return;
        open({ path: p });
        setFocusMode(true, p);
      }),
    [client, review, open, setFocusMode],
  );

  /** Another page takes a file's history away: the focus stays where it is. */
  const dropHistory = useCallback(() => {
    const shown = history.current;
    history.current = undefined;
    if (!shown || !registry.slot("openPanel").includes(shown)) return;
    wasFilled.current = false;
    shown.close();
  }, [registry]);

  const close = useCallback(() => {
    setReaderFull(false);
    closePanels(registry);
    endQuiet(registry);
  }, [registry]);

  const panelFailed = useCallback((mod: string) => {
    setFailedMod(mod);
    setReaderFull(false);
  }, []);
  // Quiet and full screen would hide the chat, and quiet the failed part too: neither stays with a failed panel.
  useEffect(() => {
    if (failed && held) endQuiet(registry);
  }, [failed, held, registry]);

  // A mod's panel took the slot: what the core had there goes.
  const panelMod = panel?.mod;
  useEffect(() => {
    // Another panel, or none, mounts afresh.
    setFailedMod((mod) => (mod === panelMod ? mod : undefined));
    if (panelMod === undefined) return;
    setReaderFull(false);
    now.current.setContextOpen(false);
  }, [panelMod]);

  // Focus goes back once the slot has closed (and the chat shows again, out of full screen): to the card or link
  // that opened it, else the composer.
  const filled = panel !== undefined;
  useEffect(() => {
    if (wasFilled.current && !filled) {
      setReaderFull(false);
      endQuiet(registry);
      const from = opener.current;
      opener.current = null;
      if (from?.isConnected && from.getAttribute("aria-disabled") !== "true") from.focus();
      else options.composer.current?.focus();
    }
    // A view remounted by key renders before the old one closes its panel: that one never filled this view's slot.
    wasFilled.current = panel !== undefined && registry.slot("openPanel").includes(panel);
  }, [filled]);

  return { readerFull, setReaderFull, panel, panelFailed, filled, quiet, hold, canOpen, open, close, dropHistory };
}
