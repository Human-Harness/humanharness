import { type ReactNode, useEffect, useState } from "react";

/*
 * plugin-ui's components: small, styled only through the `.hhp-*` classes in plugin-ui.css and the `--hh-*` tokens.
 * The panel CSP blocks style elements and style attributes (spike P-S7), so nothing here injects either.
 */

export type TableColumn = { key: string; label: string };
export type TableAction<Row> = { label: string; onClick: (row: Row) => void; disabled?: boolean };

/** A cell's text: strings and numbers as they are, anything else as JSON, null and undefined as nothing. */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return "";
  }
}

/** Rows as a table. Cells are text only, never markup; an optional button per row (an action, say). */
export function Table<Row extends Record<string, unknown>>({
  columns,
  rows,
  rowKey,
  action,
  empty,
}: {
  columns: TableColumn[];
  rows: Row[];
  /** A stable key per row; the row's `id`, else its index. */
  rowKey?: (row: Row, index: number) => string;
  action?: TableAction<Row>;
  /** Shown instead of the table when there are no rows. */
  empty?: string;
}) {
  if (rows.length === 0 && empty !== undefined) return <Empty>{empty}</Empty>;
  const keyOf = rowKey ?? ((row: Row, i: number) => (typeof row.id === "string" || typeof row.id === "number" ? String(row.id) : String(i)));
  return (
    <table className="hhp-table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} scope="col">
              {c.label}
            </th>
          ))}
          {action && <th aria-hidden="true" />}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={keyOf(row, i)}>
            {columns.map((c) => (
              <td key={c.key}>{cellText(row[c.key])}</td>
            ))}
            {action && (
              <td className="hhp-table-action">
                <button type="button" className="hhp-button" disabled={action.disabled} onClick={() => action.onClick(row)}>
                  {action.label}
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Chip({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "ok" | "warn" }) {
  return <span className={`hhp-chip hhp-chip-${tone}`}>{children}</span>;
}

/** "14:05" for an IANA zone, or null for a zone this browser doesn't know. */
export function clockText(zone: string, at: Date, hour12 = false): string | null {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12 }).format(at);
  } catch {
    return null;
  }
}

/** The time now in a given IANA zone; checked every 15 s, so a new minute shows within that. */
export function Clock({ zone, label, hour12 }: { zone: string; label?: string; hour12?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  const text = clockText(zone, now, hour12);
  return (
    <span className="hhp-clock">
      {label !== undefined && <span className="hhp-clock-label">{label}</span>}
      <time className="hhp-clock-time">{text ?? "—"}</time>
    </span>
  );
}

/** One figure with its label. */
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="hhp-stat">
      <div className="hhp-stat-value">{value}</div>
      <div className="hhp-stat-label">{label}</div>
      {hint !== undefined && <div className="hhp-stat-hint">{hint}</div>}
    </div>
  );
}

/** What a panel shows with nothing to show. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="hhp-empty">{children}</p>;
}

/** A failure, with an optional retry. */
export function ErrorBar({ message, onRetry, retryLabel = "Try again" }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div className="hhp-error" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="hhp-button" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}
