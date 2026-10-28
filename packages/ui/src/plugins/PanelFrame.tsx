import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, PanelAnswer, PanelCall, PluginPanelView } from "../client";

/**
 * The only sandbox a panel frame gets (P1–P3): scripts, nothing else. Never `allow-same-origin` (the frame would share
 * the app's origin), `allow-popups`, `allow-forms`, `allow-top-navigation*`, `allow-modals` or `allow-downloads`.
 */
export const PANEL_SANDBOX = "allow-scripts";
/** A message larger than this (as JSON) is ignored, as the panel's bridge refuses to send one (Decision 7). */
export const PANEL_MESSAGE_MAX_CHARS = 64 * 1024;
/** Calls per second a panel may make (a token bucket); `resize` doesn't count. */
export const PANEL_CALLS_PER_SECOND = 20;
/** Calls waiting for main at once; `resize` is never waited for. */
export const PANEL_IN_FLIGHT_MAX = 8;
export const PANEL_HEIGHT_MIN = 120;
export const PANEL_HEIGHT_MAX = 800;
const PANEL_HEIGHT_START = 240;
/** Remounts after a panel navigated itself, per minute; past that the frame stops (P3). */
export const PANEL_REMOUNTS_PER_MINUTE = 3;

const CALLS: readonly PanelCall[] = ["data.query", "settings.get", "refresh", "requestAction"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Only `ok` and `value`, or `ok` and a string `error`, go back into the frame. */
function shapeAnswer(a: PanelAnswer): PanelAnswer {
  if (isRecord(a) && a.ok === true) return { ok: true, value: a.value };
  return { ok: false, error: isRecord(a) && typeof a.error === "string" ? a.error : "The call failed" };
}

interface PanelFrameProps {
  client: HarnessClient;
  panel: PluginPanelView;
  /** Sent to the panel as a `focus` event once it loaded (an attention item opened it). */
  focus?: string;
  /** Bumped by the dev watcher: remounts the frame. */
  reload: number;
}

/**
 * A running plugin's panel (plugins part 2, Decision 7): its page in a sandboxed iframe with an opaque origin, and the
 * app's end of the message bridge. Another panel, another plugin or a dev reload gets a fresh frame and a fresh count.
 */
export function PanelFrame(props: PanelFrameProps) {
  const { panel, reload } = props;
  return <Frame key={`${panel.plugin}\n${panel.id}\n${panel.url}\n${reload}`} {...props} />;
}

/** What the listeners share; mutable, so a message never waits for a render. */
interface FrameState {
  el: HTMLIFrameElement | null;
  /** `load` events of the current element: the second means the panel navigated itself. */
  loads: number;
  /** The current element navigated itself: nothing from it counts, nothing goes to it, until the new one is mounted. */
  dead: boolean;
  /** Bumped per element: an answer for an older one is dropped. */
  gen: number;
  inFlight: number;
  tokens: number;
  tokensAt: number;
  remounts: number[];
  mounted: boolean;
}

function Frame({ client, panel, focus }: PanelFrameProps) {
  const { t } = useTranslation();
  const [frameKey, setFrameKey] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [height, setHeight] = useState(PANEL_HEIGHT_START);
  const s = useRef<FrameState>({
    el: null,
    loads: 0,
    dead: false,
    gen: 0,
    inFlight: 0,
    tokens: PANEL_CALLS_PER_SECOND,
    tokensAt: Date.now(),
    remounts: [],
    mounted: true,
  }).current;
  const focusNow = useRef(focus);
  focusNow.current = focus;

  /** An event into the live frame; dropped while there is none. */
  const post = useCallback(
    (msg: Record<string, unknown>) => {
      const win = s.el?.contentWindow;
      if (!win || s.dead) return;
      try {
        win.postMessage({ hh: 1, ...msg }, "*");
      } catch {
        // A frame that went away while posting: nothing to tell.
      }
    },
    [s],
  );
  const postTheme = useCallback(() => {
    const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    if (mq) post({ event: "theme", dark: mq.matches });
  }, [post]);

  // A new element (first mount or a remount) starts its own count; a message from the old one no longer matches.
  const setFrame = useCallback(
    (el: HTMLIFrameElement | null) => {
      if (el === s.el) return;
      s.el = el;
      s.loads = 0;
      s.dead = false;
      s.gen++;
      s.inFlight = 0;
    },
    [s],
  );

  const onLoad = useCallback(
    (e: { currentTarget: HTMLIFrameElement }) => {
      if (e.currentTarget !== s.el || s.dead) return;
      s.loads++;
      if (s.loads === 1) {
        postTheme();
        post({ event: "focus", focus: focusNow.current ?? null });
        return;
      }
      // P3: a second load is the panel navigating itself (main allows only its own panel page, and a refused target
      // ends on an error page). A new element brings it back: setting `src` again is refused once on the error page.
      s.dead = true;
      s.gen++;
      s.inFlight = 0;
      const now = Date.now();
      s.remounts = s.remounts.filter((at) => now - at < 60_000);
      if (s.remounts.length >= PANEL_REMOUNTS_PER_MINUTE) {
        setStopped(true);
        return;
      }
      s.remounts.push(now);
      setFrameKey((k) => k + 1);
    },
    [s, post, postTheme],
  );

  useEffect(() => {
    s.mounted = true;
    const take = (): boolean => {
      const now = Date.now();
      s.tokens = Math.min(PANEL_CALLS_PER_SECOND, s.tokens + ((now - s.tokensAt) * PANEL_CALLS_PER_SECOND) / 1000);
      s.tokensAt = now;
      if (s.tokens < 1) return false;
      s.tokens -= 1;
      return true;
    };
    const onMessage = (e: MessageEvent) => {
      // P4: only this frame's own window, opaque-origin, speaks for this panel; the ids come from props, never from it.
      const win = s.el?.contentWindow;
      if (!win || s.dead || e.source !== win || e.origin !== "null") return;
      // The message as JSON, measured and parsed back: only plain JSON goes on (an ArrayBuffer, Blob, Map or Set
      // stringifies to {} and would otherwise pass the cap and be cloned whole into main).
      let d: unknown;
      try {
        const json = JSON.stringify(e.data);
        if (typeof json !== "string" || json.length > PANEL_MESSAGE_MAX_CHARS) return;
        d = JSON.parse(json);
      } catch {
        return;
      }
      if (!isRecord(d) || d.hh !== 1 || typeof d.call !== "string") return;
      if (d.call === "resize") {
        // Fire-and-forget: never answered, never sent to main, outside the bucket and the in-flight cap.
        const h = isRecord(d.args) ? d.args.height : undefined;
        if (typeof h === "number" && Number.isFinite(h)) setHeight(Math.min(PANEL_HEIGHT_MAX, Math.max(PANEL_HEIGHT_MIN, Math.round(h))));
        return;
      }
      const id = d.id;
      if (typeof id !== "number" || !Number.isSafeInteger(id)) return;
      const gen = s.gen;
      const answer = (a: PanelAnswer) => {
        if (!s.mounted || s.gen !== gen) return;
        try {
          win.postMessage({ hh: 1, re: id, ...shapeAnswer(a) }, "*");
        } catch {
          // An answer that can't be cloned into the frame is lost; the panel's call times out.
        }
      };
      if (!take()) return answer({ ok: false, error: "Too many calls" });
      if (s.inFlight >= PANEL_IN_FLIGHT_MAX) return answer({ ok: false, error: "Too many calls at once" });
      const call = CALLS.find((c) => c === d.call);
      if (!call) return answer({ ok: false, error: "Unknown call" });
      s.inFlight++;
      client.plugins.panel(panel.plugin, panel.id, call, d.args).then(
        (a) => {
          if (s.gen === gen) s.inFlight--;
          answer(a);
        },
        () => {
          if (s.gen === gen) s.inFlight--;
          answer({ ok: false, error: "The call failed" });
        },
      );
    };
    window.addEventListener("message", onMessage);
    const offData = client.plugins.onPluginData((change) => {
      if (change.plugin !== panel.plugin) return;
      post({ event: "data", collections: change.collections.filter((c) => typeof c === "string") });
    });
    const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const onTheme = () => {
      if (s.loads >= 1) postTheme();
    };
    mq?.addEventListener("change", onTheme);
    return () => {
      s.mounted = false;
      window.removeEventListener("message", onMessage);
      offData();
      mq?.removeEventListener("change", onTheme);
    };
  }, [s, client, panel.plugin, panel.id, post, postTheme]);

  // A focus that changes after the load (another attention item for an open panel); the load itself sends the first.
  const firstFocus = useRef(true);
  useEffect(() => {
    if (firstFocus.current) {
      firstFocus.current = false;
      return;
    }
    if (s.loads >= 1) post({ event: "focus", focus: focus ?? null });
  }, [s, focus, post]);

  if (stopped)
    return (
      <p className="hh-plugin-frame-error" role="alert">
        {t("plugins.frame.stopped")}
      </p>
    );
  return (
    <iframe
      key={frameKey}
      ref={setFrame}
      className="hh-plugin-frame"
      sandbox={PANEL_SANDBOX}
      src={panel.url}
      title={`${panel.title} · ${panel.pluginName}`}
      referrerPolicy="no-referrer"
      allow=""
      loading="lazy"
      style={{ height }}
      onLoad={onLoad}
    />
  );
}
