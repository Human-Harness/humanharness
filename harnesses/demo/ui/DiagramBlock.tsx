import type { BlockProps } from "@humanharness/ui";
import { useTranslation } from "react-i18next";

interface DiagramNode {
  id: string;
  label: string;
  detail?: string;
}
interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

const isNode = (n: unknown): n is DiagramNode => !!n && typeof (n as DiagramNode).id === "string" && typeof (n as DiagramNode).label === "string";
const isEdge = (e: unknown): e is DiagramEdge => !!e && typeof (e as DiagramEdge).from === "string" && typeof (e as DiagramEdge).to === "string";

function Arrow({ last }: { last: boolean }) {
  return (
    <svg
      className={last ? "demo-arrow demo-arrow-end" : "demo-arrow"}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Back() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M19 5v6a4 4 0 0 1-4 4H5M9 11l-4 4 4 4" />
    </svg>
  );
}

/**
 * `show_diagram`: boxes in order joined by arrows, wrapping onto more rows when they don't fit;
 * each arrow follows its box so a row never starts with one. Edges that don't join neighbours are listed under them.
 */
export function DiagramBlock({ data }: BlockProps) {
  const { t } = useTranslation("harness");
  const nodes = Array.isArray(data?.nodes) ? (data.nodes as unknown[]).filter(isNode) : [];
  const edges = Array.isArray(data?.edges) ? (data.edges as unknown[]).filter(isEdge) : [];
  if (nodes.length === 0) return null;
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const labelOf = (id: string) => nodes[order.get(id) ?? -1]?.label ?? id;
  const others = edges.filter((e) => order.get(e.to) !== (order.get(e.from) ?? -2) + 1);
  const title = typeof data?.title === "string" && data.title ? data.title : t("diagram");
  return (
    <figure className="demo-diagram" aria-label={title}>
      <figcaption className="demo-kicker">{title}</figcaption>
      <ol className="demo-nodes">
        {nodes.map((n, i) => (
          <li key={n.id} className="demo-node-item">
            <span className="demo-node">
              <strong>{n.label}</strong>
              {n.detail && <span>{n.detail}</span>}
            </span>
            <Arrow last={i === nodes.length - 1} />
          </li>
        ))}
      </ol>
      {others.length > 0 && (
        <ul className="demo-edges">
          {others.map((e, i) => (
            <li key={i}>
              <Back />
              {`${labelOf(e.from)} → ${labelOf(e.to)}${e.label ? `: ${e.label}` : ""}`}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
