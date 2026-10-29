import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ToolCallView } from "../client";

/** "0.3 s": a call's time in seconds, one decimal. */
const seconds = (ms: number): string => (Math.max(0, ms) / 1000).toFixed(1);

/**
 * One harness tool call in a task's chat (tools spec §8.2, Decision 10): a folded line "<id> · <summary> · <s> s ·
 * 0 tokens" that unfolds to its arguments, result, accesses and the tool's log lines. A failed call reads "<id> failed · <message>" and starts
 * unfolded. It shows only what main's trace view holds: arguments and result already cut and with key values hidden,
 * and each access as one target line (never a header, a body or a key).
 */
export function ToolCallLine({ call }: { call: ToolCallView }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(!call.ok);
  const details = useId();
  const line = call.ok
    ? t("tools.line", { tool: call.tool, summary: call.summary, seconds: seconds(call.ms) })
    : t("tools.failed", { tool: call.tool, message: call.error ?? call.summary });
  return (
    <div className={call.ok ? "hh-tool-call" : "hh-tool-call hh-error"}>
      <button type="button" className="hh-tool-line" aria-expanded={open} aria-controls={details} onClick={() => setOpen((o) => !o)}>
        {line}
      </button>
      {/* Always in the page, so aria-controls names it even when folded. */}
      <dl id={details} className="hh-tool-details" hidden={!open}>
        <dt>{t("tools.args")}</dt>
        <dd>
          <pre dir="auto">{call.args}</pre>
        </dd>
        {call.ok && call.result !== undefined && (
          <>
            <dt>{t("tools.result")}</dt>
            <dd>
              <pre dir="auto">{call.result}</pre>
            </dd>
          </>
        )}
        {call.accesses.length > 0 && (
          <>
            <dt>{t("tools.accesses")}</dt>
            <dd>
              <ul>
                {call.accesses.map((a, i) => (
                  <li key={i}>
                    {a.kind} <span dir="auto">{a.target}</span>
                    {!a.allowed && <> · {t("tools.accessDenied")}</>}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {call.logs && call.logs.length > 0 && (
          <>
            <dt>{t("tools.logs")}</dt>
            <dd>
              <ul className="hh-tool-logs">
                {call.logs.map((l, i) => (
                  <li key={i}>
                    {l.level}: <span dir="auto">{l.message}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

const ACCESS_KINDS = new Set(["fetch", "exec", "data", "files"]);
const isText = (v: unknown): v is string => typeof v === "string";

/** One access as main writes it, else null. */
function cleanAccess(a: unknown): ToolCallView["accesses"][number] | null {
  if (typeof a !== "object" || a === null) return null;
  const { kind, target, allowed } = a as Record<string, unknown>;
  return isText(kind) && ACCESS_KINDS.has(kind) && isText(target) && typeof allowed === "boolean" ? { kind: kind as ToolCallView["accesses"][number]["kind"], target, allowed } : null;
}

const LOG_LEVELS = new Set(["info", "warn", "error"]);

/** A call's log lines as main writes them: only well-formed ones (none: no key). */
function cleanLogs(raw: unknown): Pick<ToolCallView, "logs"> {
  if (!Array.isArray(raw)) return {};
  const logs = (raw as unknown[]).flatMap((l) => {
    if (typeof l !== "object" || l === null) return [];
    const { level, message } = l as Record<string, unknown>;
    return isText(level) && LOG_LEVELS.has(level) && isText(message) ? [{ level: level as "info" | "warn" | "error", message }] : [];
  });
  return logs.length > 0 ? { logs } : {};
}

/** The chat log is read from disk unchecked: only well-formed calls are drawn, with only the fields the line shows. */
export function cleanToolCalls(raw: unknown): ToolCallView[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolCallView[] = [];
  for (const c of raw as unknown[]) {
    if (typeof c !== "object" || c === null) continue;
    const v = c as Record<string, unknown>;
    if (!isText(v.tool) || typeof v.ok !== "boolean" || typeof v.ms !== "number" || !isText(v.summary) || !isText(v.args) || !isText(v.at)) continue;
    if (!Array.isArray(v.accesses) || (v.error !== undefined && !isText(v.error)) || (v.result !== undefined && !isText(v.result))) continue;
    out.push({
      tool: v.tool,
      caller: v.caller as ToolCallView["caller"],
      ok: v.ok,
      ms: v.ms,
      summary: v.summary,
      ...(isText(v.error) ? { error: v.error } : {}),
      args: v.args,
      ...(isText(v.result) ? { result: v.result } : {}),
      accesses: (v.accesses as unknown[]).map(cleanAccess).filter((a) => a !== null),
      ...cleanLogs(v.logs),
      at: v.at,
    });
  }
  return out;
}

/** A turn's tool calls, in the order they ran (none well-formed: nothing). */
export function ToolCallLines({ calls }: { calls: unknown }) {
  const shown = cleanToolCalls(calls);
  if (shown.length === 0) return null;
  return (
    <div className="hh-tool-calls">
      {shown.map((c, i) => (
        <ToolCallLine key={`${c.at}-${i}`} call={c} />
      ))}
    </div>
  );
}
