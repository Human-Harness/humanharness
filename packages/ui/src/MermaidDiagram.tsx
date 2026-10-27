import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type Drawn, drawMermaid } from "./mermaid-loader";

/** The app's colours for Mermaid's `base` theme, read from the tokens when the diagram is drawn. */
function themeVariables(): Record<string, string> {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  const vars: Record<string, string> = {
    background: v("--hh-surface"),
    primaryColor: v("--hh-sheet"),
    primaryTextColor: v("--hh-ink"),
    primaryBorderColor: v("--hh-slate"),
    secondaryColor: v("--hh-segment"),
    tertiaryColor: v("--hh-paper"),
    lineColor: v("--hh-slate"),
    textColor: v("--hh-ink"),
    fontFamily: v("--hh-font"),
  };
  return Object.fromEntries(Object.entries(vars).filter(([, x]) => x));
}

/** "light" or "dark", following the system (the app sets nativeTheme from Settings › Appearance). */
function useScheme(): string {
  const query = typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: dark)") : undefined;
  const [dark, setDark] = useState(Boolean(query?.matches));
  useEffect(() => {
    if (!query) return;
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    query.addEventListener?.("change", on);
    return () => query.removeEventListener?.("change", on);
  }, [query]);
  return dark ? "dark" : "light";
}

/** A ```mermaid block (§3.3): its source while the fence is open, else the drawing, or its source and why it failed. */
export function MermaidDiagram({ code, closed, caption }: { code: string; closed: boolean; caption?: string }) {
  const { t } = useTranslation();
  const scheme = useScheme();
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const [source, setSource] = useState(false);
  useEffect(() => {
    if (!closed) return;
    let live = true;
    setDrawn(null);
    drawMermaid(code, themeVariables()).then((d) => live && setDrawn(d));
    return () => {
      live = false;
    };
  }, [code, closed, scheme]);
  const sourceBlock = (
    <pre className="hh-md-code">
      <code>{code}</code>
    </pre>
  );
  if (!closed) return sourceBlock;
  if (drawn && !drawn.ok) {
    return (
      <div className="hh-md-diagram hh-md-diagram-failed">
        <p className="hh-md-diagram-error" role="note">
          {t("reader.diagramFailed", { why: drawn.why })}
        </p>
        {sourceBlock}
      </div>
    );
  }
  return (
    <figure className="hh-md-diagram">
      <div className="hh-md-diagram-bar">
        <button type="button" aria-pressed={source} onClick={() => setSource((s) => !s)}>
          {t("reader.source")}
        </button>
      </div>
      {source ? (
        sourceBlock
      ) : drawn ? (
        <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawn.svg)}`} alt={caption || t("reader.diagram")} />
      ) : (
        <div className="hh-caption" role="status">
          {t("reader.drawing")}
        </div>
      )}
    </figure>
  );
}
