import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EngineConfigView, EngineRunsCommandView, HarnessClient } from "../client";
import { shownLanguage } from "../language";
import { Markdown } from "../markdown";

/**
 * Scope settings › Engine config (hatches spec §5.3): everything the scope's engine folder holds, commands first, and
 * Approve. Only for a harness with `enginePresets` (D0). The window approves the hash it was shown; main computes it
 * again and refuses a folder that changed meanwhile ("changed": the view reads it again).
 *
 * Every change notice reads the view again (one approval sends two: the scope, then any scope after scopes.json's
 * commit). The view on screen stays until the new one arrives, and a late answer to an older read is dropped.
 */
export const EngineConfig = forwardRef<HTMLHeadingElement, { client: HarnessClient; scope: string; scopeLabel: string; labelOf: (action: string) => string }>(
  function EngineConfig({ client, scope, scopeLabel, labelOf }, headingRef) {
    const { t, i18n } = useTranslation();
    const baseId = useId();
    /** undefined: not read yet; null: the scope has no engine config. */
    const [view, setView] = useState<EngineConfigView | null | undefined>(undefined);
    const [failed, setFailed] = useState(false);
    const [changed, setChanged] = useState(false);
    const [busy, setBusy] = useState(false);
    const loads = useRef(0);

    const load = () => {
      const n = ++loads.current;
      return client.engineConfig.get(scope).then(
        (v) => {
          if (n !== loads.current) return;
          setView(v);
          setFailed(false);
        },
        () => {
          if (n === loads.current) setFailed(true);
        },
      );
    };
    useEffect(() => {
      setView(undefined);
      setFailed(false);
      setChanged(false);
      void load();
      return client.engineConfig.onChanged((s) => {
        if (s === null || s === scope) void load();
      });
    }, [client, scope]);

    const approve = async () => {
      if (!view || busy) return;
      setBusy(true);
      setChanged(false);
      setFailed(false);
      // A read already in flight would bring the view from before the approval: this answer wins over it.
      const n = ++loads.current;
      try {
        const r = await client.engineConfig.approve(scope, view.hash);
        if (r.ok) {
          if (n === loads.current) setView(r.view);
        } else {
          if (r.reason === "changed") setChanged(true);
          await load();
        }
      } catch {
        setFailed(true);
      }
      setBusy(false);
    };

    const layerName = (layer: string) => (layer === "" ? null : t("hatches.engineLayer", { action: labelOf(layer) }));
    const servers = new Set((view?.runsCommands ?? []).filter((c) => c.kind === "server").map((c) => c.label));
    /** A preset allow rule for a server's tools counts only for its own servers (`mcp__scope-<name>`). */
    const allowUsed = (rule: string) => !rule.startsWith("mcp__") || servers.has(rule.slice("mcp__".length).split("__")[0]!.replace(/\(.*$/, ""));
    const date = (at: string) => new Date(at).toLocaleString(shownLanguage(i18n), { dateStyle: "medium", timeStyle: "short" });

    const command = (c: EngineRunsCommandView, i: number) => (
      <li key={i} className="hh-engine-command">
        <span>{t(c.kind === "hook" ? "hatches.engineHook" : "hatches.engineServer", { label: c.label })}</span>
        <code>{[c.command, ...c.args].join(" ")}</code>
        <span className="hh-caption">
          {[layerName(c.layer), t("hatches.engineFrom", { file: c.file })].filter((x) => x !== null).join(" · ")}
        </span>
        {c.kind === "server" && <span className="hh-caption">{t("hatches.engineServerAllow", { name: c.label })}</span>}
        {c.loadsOtherCode && <strong className="hh-engine-warn">{t("hatches.engineLoadsOther")}</strong>}
      </li>
    );

    return (
      <section className="hh-engine" aria-labelledby={`${baseId}-title`}>
        <h3 id={`${baseId}-title`} ref={headingRef} tabIndex={-1}>
          {t("hatches.engineConfig")}
        </h3>
        {failed && <p role="alert">{t("hatches.engineLoadFailed")}</p>}
        {view === null && <p className="hh-caption">{t("hatches.engineNone", { scope: scopeLabel })}</p>}
        {view && (
          <>
            <p className="hh-engine-status">
              {view.approved && view.approvedAt
                ? t("hatches.engineApproved", { date: date(view.approvedAt) })
                : view.changed
                  ? t("hatches.engineChanged")
                  : t("hatches.engineNotApproved")}
            </p>
            {changed && <p role="alert">{t("hatches.engineChangedWhileShown")}</p>}
            {view.refusals.map((r, i) => (
              <p key={i} className="hh-engine-refusal">
                {t("hatches.engineRefused", { reason: r.file === "." ? r.message : `${r.file}: ${r.message}` })}
              </p>
            ))}
            {view.base === "global" ? (
              <div>
                <p>{t("hatches.engineBaseGlobal")}</p>
                <p className="hh-caption">{t("hatches.engineBaseGlobalDetail")}</p>
              </div>
            ) : (
              <p>{t("hatches.engineBaseIsolated")}</p>
            )}
            {view.codexLimit && <p className="hh-caption">{t("hatches.engineCodexLimit")}</p>}
            {view.runsCommands.length > 0 && (
              <div>
                <h4>{t("hatches.engineRunsCommands")}</h4>
                <ul className="hh-engine-list" aria-label={t("hatches.engineRunsCommands")}>
                  {view.runsCommands.map(command)}
                </ul>
              </div>
            )}
            {view.scripts.length > 0 && (
              <div>
                <h4>{t("hatches.engineScripts")}</h4>
                <ul className="hh-engine-list" aria-label={t("hatches.engineScripts")}>
                  {view.scripts.map((s) => (
                    <li key={s}>
                      <code>{s}</code>
                      {view.loadsOtherCode.includes(s) && <strong className="hh-engine-warn">{t("hatches.engineLoadsOther")}</strong>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {view.permissions.length > 0 && (
              <div>
                <h4>{t("hatches.enginePermissions")}</h4>
                {view.permissions.map((p) => (
                  <div key={p.layer}>
                    {p.layer !== "" && <p className="hh-caption">{layerName(p.layer)}</p>}
                    {p.allow.filter(allowUsed).length > 0 && <p>{t("hatches.engineAllow", { rules: p.allow.filter(allowUsed).join(", ") })}</p>}
                    {p.allow
                      .filter((r) => !allowUsed(r))
                      .map((r) => (
                        <p key={r} className="hh-caption">
                          {t("hatches.engineAllowUnused", { rule: r })}
                        </p>
                      ))}
                    {p.deny.length > 0 && <p>{t("hatches.engineDeny", { rules: p.deny.join(", ") })}</p>}
                    {p.ask.length > 0 && <p>{t("hatches.engineAsk", { rules: p.ask.join(", ") })}</p>}
                  </div>
                ))}
              </div>
            )}
            {view.instructions.map((ins) => (
              <div key={ins.layer} className="hh-engine-instructions">
                <h4>{ins.layer === "" ? t("hatches.engineScopeInstructions") : t("hatches.engineActionInstructions", { action: labelOf(ins.layer) })}</h4>
                <div className="hh-engine-doc">
                  <Markdown source={ins.text} document path={`.harness/engine/${scope}/${ins.layer === "" ? "" : `actions/${ins.layer}/`}instructions.md`} />
                </div>
              </div>
            ))}
            {view.skills.length > 0 && (
              <div>
                <h4>{t("hatches.engineSkills")}</h4>
                <ul className="hh-engine-list" aria-label={t("hatches.engineSkills")}>
                  {view.skills.map((s) => (
                    <li key={s.name}>
                      <span>
                        <code>{s.name}</code> {s.description}
                      </span>
                      {s.allowedTools.length > 0 && <span className="hh-caption">{t("hatches.engineSkillTools", { tools: s.allowedTools.join(", ") })}</span>}
                      {s.model && <span className="hh-caption">{t("hatches.engineSkillModel", { model: s.model })}</span>}
                      {s.fork && <span className="hh-caption">{t("hatches.engineSkillFork")}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {view.agents.length > 0 && (
              <div>
                <h4>{t("hatches.engineAgents")}</h4>
                <ul className="hh-engine-list" aria-label={t("hatches.engineAgents")}>
                  {view.agents.map((a) => (
                    <li key={a.name}>
                      <span>
                        <code>{a.name}</code> {a.description}
                      </span>
                      {a.ignored.length > 0 && <span className="hh-caption">{t("hatches.engineIgnored", { keys: a.ignored.join(", ") })}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {view.codexKeys.length > 0 && (
              <div>
                <h4>{t("hatches.engineCodexKeys")}</h4>
                <p>
                  <code>{view.codexKeys.join(", ")}</code>
                </p>
              </div>
            )}
            {view.ignored.length > 0 && <p className="hh-caption">{t("hatches.engineIgnored", { keys: view.ignored.join(", ") })}</p>}
            {!view.approved && (
              <div className="hh-engine-actions">
                <button type="button" className="hh-primary" disabled={busy || view.refusals.length > 0} onClick={() => void approve()}>
                  {t("hatches.engineApprove")}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    );
  },
);
