import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { type Drawn, drawMermaid, mermaidAccessible } from "./mermaid-loader";

/** The app's colours for Mermaid's `base` theme, read from the tokens when the diagram is drawn. */
function themeVariables(): Record<string, string> {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  const vars: Record<string, string> = {
    background: v("--hh-surface"),
    primaryColor: v("--hh-rail"),
    primaryTextColor: v("--hh-ink"),
    primaryBorderColor: v("--hh-muted"),
    secondaryColor: v("--hh-surface-2"),
    tertiaryColor: v("--hh-bg"),
    lineColor: v("--hh-muted"),
    textColor: v("--hh-ink"),
    fontFamily: v("--hh-font"),
  };
  return Object.fromEntries(Object.entries(vars).filter(([, x]) => x));
}

const DARK = "(prefers-color-scheme: dark)";

function subscribeScheme(onChange: () => void): () => void {
  const query = typeof window !== "undefined" ? window.matchMedia?.(DARK) : undefined;
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}

function schemeNow(): "light" | "dark" {
  return typeof window !== "undefined" && window.matchMedia?.(DARK).matches ? "dark" : "light";
}

/** "light" or "dark", following the system (the app sets nativeTheme from Settings › Appearance). */
function useScheme(): "light" | "dark" {
  return useSyncExternalStore(subscribeScheme, schemeNow, () => "light");
}

/** A ```mermaid block (§3.3): its source while the fence is open, else the drawing, or its source and why it failed. */
export function MermaidDiagram({ code, closed, caption }: { code: string; closed: boolean; caption?: string }) {
  const { t } = useTranslation();
  const scheme = useScheme();
  const bodyId = useId();
  // The drawing is kept with the code it shows: on a colour change the old drawing stays until the new one arrives.
  const [drawn, setDrawn] = useState<{ code: string; result: Drawn } | null>(null);
  const [source, setSource] = useState(false);
  useEffect(() => {
    if (!closed) return;
    let live = true;
    drawMermaid(code, themeVariables(), () => live).then((result) => {
      if (live && !("skipped" in result)) setDrawn({ code, result });
    });
    return () => {
      live = false;
    };
  }, [code, closed, scheme]);
  const sourceBlock = (
    <pre className="hh-md-code" id={bodyId}>
      <code>{code}</code>
    </pre>
  );
  if (!closed) return sourceBlock;
  const result = drawn?.code === code ? drawn.result : null;
  if (result && !result.ok) {
    const why = "slow" in result ? t("reader.diagramSlow") : "why" in result ? result.why : "";
    return (
      <div className="hh-md-diagram hh-md-diagram-failed">
        <p className="hh-md-diagram-error" role="note">
          {t("reader.diagramFailed", { why })}
        </p>
        {sourceBlock}
      </div>
    );
  }
  const acc = mermaidAccessible(code);
  const alt = caption || [acc.title, acc.description].filter(Boolean).join(": ") || t("reader.diagram");
  return (
    <figure className="hh-md-diagram">
      <div className="hh-md-diagram-bar">
        <button type="button" aria-pressed={source} aria-controls={bodyId} onClick={() => setSource((s) => !s)}>
          {t("reader.source")}
        </button>
      </div>
      {source ? (
        sourceBlock
      ) : result?.ok ? (
        <img id={bodyId} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`} alt={alt} />
      ) : (
        <div id={bodyId} className="hh-caption" role="status">
          {t("reader.drawing")}
        </div>
      )}
    </figure>
  );
}
