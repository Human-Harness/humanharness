/**
 * `@humanharness/plugin-ui` (exported as `@humanharness/ui/plugin-ui`): what a plugin panel is built with. It imports
 * React, its own bridge and components and its own CSS only — nothing else from `@humanharness/ui` — so a panel bundle
 * holds no app code. `build` bundles it into `panel-<id>.js` (an IIFE) and its CSS into `panel-<id>.css`.
 */
import { type ComponentType, createContext, createElement, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PanelBridge, panelBridge, type PanelEvent } from "./bridge";
import "./plugin-ui.css";

export { CALL_TIMEOUT_MS, PanelBridge, type PanelEvent } from "./bridge";
export { Chip, Clock, clockText, Empty, ErrorBar, Stat, Table, type TableAction, type TableColumn } from "./components";

export type Theme = "light" | "dark";
export type QueryOptions = { where?: Record<string, unknown>; fields?: string[]; limit?: number };
export type QueryState<T> = {
  /** The records, once the first answer came. */
  rows: T[] | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

const BridgeContext = createContext<PanelBridge | null>(null);

function useBridge(): PanelBridge {
  return useContext(BridgeContext) ?? panelBridge();
}

function systemTheme(): Theme {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function themeOf(b: PanelBridge): Theme {
  return b.dark === null ? systemTheme() : b.dark ? "dark" : "light";
}

/** Calls `fn` for each event from the app while mounted. */
function useEvents(b: PanelBridge, fn: (e: PanelEvent) => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => b.on((e) => ref.current(e)), [b]);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Reads one of the plugin's own collections and reads it again whenever the app says the collection changed (the
 * spec's `data.subscribe`). Read-only: a panel never writes data.
 */
export function useQuery<T = Record<string, unknown>>(collection: string, opts: QueryOptions = {}): QueryState<T> {
  const b = useBridge();
  const optsKey = JSON.stringify(opts);
  const [state, setState] = useState<{ rows: T[] | undefined; error: string | null; loading: boolean }>({ rows: undefined, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEvents(b, (e) => {
    if (e.event === "data" && e.collections.includes(collection)) reload();
  });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    b.call("data.query", { collection, ...(JSON.parse(optsKey) as QueryOptions) }).then(
      (value) => live && setState({ rows: Array.isArray(value) ? (value as T[]) : [], error: null, loading: false }),
      (err: unknown) => live && setState((s) => ({ rows: s.rows, error: message(err), loading: false })),
    );
    return () => {
      live = false;
    };
  }, [b, collection, optsKey, tick]);
  return { ...state, reload };
}

export type PluginApi = {
  /** One read of an own collection (at most 500 records). */
  query: <T = Record<string, unknown>>(collection: string, opts?: QueryOptions) => Promise<T[]>;
  /** The hook form of `query`, read again on every change (call it at the top of a component, like any hook). */
  useQuery: typeof useQuery;
  /** The plugin's setting values (never its keys). */
  settings: () => Promise<Record<string, unknown>>;
  /** Asks the app to run a source now; "skipped" when it runs or ran less than 10 s ago. */
  refresh: (source: string) => Promise<"refreshed" | "skipped">;
  /** Asks for a prepared task: the person sees it and starts it, or not. */
  requestAction: (id: string, vars?: Record<string, unknown>) => Promise<unknown>;
  /** What an attention item asked this panel to show, the last time one did; else null. */
  focus: string | null;
  theme: Theme;
};

/** The panel's link to the app. */
export function usePlugin(): PluginApi {
  const b = useBridge();
  const [focus, setFocus] = useState<string | null>(b.focus);
  const [theme, setTheme] = useState<Theme>(() => themeOf(b));
  useEvents(b, (e) => {
    if (e.event === "focus") setFocus(e.focus);
    if (e.event === "theme") setTheme(e.dark ? "dark" : "light");
  });
  const calls = useMemo(
    () => ({
      query: async <T,>(collection: string, opts: QueryOptions = {}) => {
        const value = await b.call("data.query", { collection, ...opts });
        return (Array.isArray(value) ? value : []) as T[];
      },
      settings: async () => {
        const value = await b.call("settings.get", {});
        return (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
      },
      refresh: async (source: string) => ((await b.call("refresh", { source })) === "skipped" ? "skipped" : "refreshed") as "refreshed" | "skipped",
      requestAction: (id: string, vars: Record<string, unknown> = {}) => b.call("requestAction", { action: id, vars }),
    }),
    [b],
  );
  return { ...calls, useQuery, focus, theme };
}

/**
 * The panel's root: sets `data-theme` (tokens.css follows it) and reports the content's height to the app, which sizes
 * the frame (clamped there). `bridge` is for tests; a panel uses the shared one.
 */
export function PluginRoot({ children, bridge }: { children: ReactNode; bridge?: PanelBridge }) {
  const b = bridge ?? panelBridge();
  const [theme, setTheme] = useState<Theme>(() => themeOf(b));
  const root = useRef<HTMLDivElement>(null);
  useEvents(b, (e) => {
    if (e.event === "theme") setTheme(e.dark ? "dark" : "light");
  });
  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver !== "function") return;
    let last = -1;
    // The root's own height: the document's scrollHeight never drops below the frame's, so a panel could never shrink.
    const report = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      if (height === last) return;
      last = height;
      b.send("resize", { height });
    };
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => ro.disconnect();
  }, [b]);
  return createElement(BridgeContext.Provider, { value: b }, createElement("div", { ref: root, className: "hhp-root", "data-theme": theme }, children));
}

/** Renders the panel's component into `#root` (the page `build` writes). */
export function mountPanel(Component: ComponentType, opts: { container?: Element; bridge?: PanelBridge } = {}): Root {
  const container = opts.container ?? document.getElementById("root");
  if (!container) throw new Error("The panel page has no #root");
  const root = createRoot(container);
  root.render(createElement(PluginRoot, { bridge: opts.bridge, children: createElement(Component) }));
  return root;
}
