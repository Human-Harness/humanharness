import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppState, HarnessClient, LinkDroppedView, LinkRefusalView, LinkedView } from "../client";

type Declared = NonNullable<NonNullable<AppState["hatches"]>["linkedFolders"]>;

/**
 * Scope settings › Linked folders (hatches spec §3.2): the scope's links the app signed, one "Link a folder…" per
 * declared key, Unlink, and the question after a folder gained or lost git (Decision 13). The window never names a
 * path: the picker opens in main.
 */
export function LinkedFolders({ client, scope, declared, scopeLabel }: { client: HarnessClient; scope: string; declared: Declared; scopeLabel: string }) {
  const { t } = useTranslation();
  const baseId = useId();
  const [folders, setFolders] = useState<LinkedView[] | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  /** The key whose link button started the refusal shown next to it. */
  const [refused, setRefused] = useState<{ key: string; reason: LinkRefusalView } | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const alertRef = useRef<HTMLParagraphElement>(null);
  /** The latest request: an answer to an earlier one (another scope's, say) arriving late is dropped. */
  const loads = useRef(0);

  const load = () => {
    const n = ++loads.current;
    return client.scopes.linked(scope).then(
      (r) => {
        if (n !== loads.current) return;
        setFolders(r.folders);
        setUnsupported(r.unsupported);
      },
      () => {
        if (n === loads.current) setFailed(true);
      },
    );
  };
  useEffect(() => {
    setFolders(null);
    setFailed(false);
    setRefused(null);
    void load();
  }, [client, scope]);
  useEffect(() => {
    if (refused || failed) alertRef.current?.focus();
  }, [refused, failed]);

  /** Runs one change, then reads the links again (main is the truth: a link may also be dropped there). */
  const act = async (run: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    setRefused(null);
    try {
      await run();
    } catch {
      setFailed(true);
    }
    await load();
    setBusy(false);
  };
  const link = (key: string) =>
    act(async () => {
      const answer = await client.scopes.linkFolder(scope, key);
      if (answer && "refused" in answer) setRefused({ key, reason: answer.refused });
    });

  const keys = Object.keys(declared);
  const refusal = (reason: LinkRefusalView) => t(`hatches.refused.${reason}`, { scope: scopeLabel });
  /** Why the agent doesn't get a stored folder now (the checks each turn runs). */
  const droppedText = (why: LinkDroppedView) =>
    why === "moved" || why === "not-folder" || why === "mode-changed"
      ? t(`hatches.dropped.${why === "mode-changed" ? "modeChanged" : "moved"}`)
      : t("hatches.dropped.refused", { reason: refusal(why) });
  return (
    <section className="hh-linked" aria-labelledby={`${baseId}-title`}>
      <h3 id={`${baseId}-title`}>{t("hatches.linkedTitle")}</h3>
      {unsupported && <p className="hh-caption">{t("hatches.codexUnsupported")}</p>}
      {failed && (
        <p ref={alertRef} role="alert" tabIndex={-1}>
          {t("hatches.failed")}
        </p>
      )}
      {folders && folders.length > 0 && (
        <ul className="hh-linked-list">
          {folders.map((f, i) => {
            const rowId = `${baseId}-row-${i}`;
            return (
              <li key={`${f.key}\0${f.path}`} className="hh-linked-row">
                <span id={rowId} className="hh-linked-text">
                  <strong>{f.label}</strong> <code title={f.path}>{f.path}</code>
                  <span className="hh-caption">
                    <span>{t(f.mode === "write" ? "hatches.modeWrite" : "hatches.modeRead")}</span>
                    {/* A read folder is never tracked (Decision 2): no history line. */}
                    {f.mode === "write" && (
                      <>
                        {" · "}
                        <span>{t(f.tracked ? "hatches.tracked" : "hatches.ownGit")}</span>
                      </>
                    )}
                  </span>
                  {f.dropped && <span className="hh-caption hh-linked-dropped">{droppedText(f.dropped)}</span>}
                </span>
                <button type="button" aria-describedby={rowId} disabled={busy} onClick={() => void act(() => client.scopes.unlinkFolder(scope, f.key, f.path))}>
                  {t("hatches.unlink")}
                </button>
                {f.gitChanged && (
                  <div className="hh-linked-git" role="group" aria-label={t(f.tracked ? "hatches.gainedGit" : "hatches.lostGit")}>
                    <p>{t(f.tracked ? "hatches.gainedGit" : "hatches.lostGit")}</p>
                    {/* Main never tracks a folder with git (L7): after gaining git, leaving it to its git is the answer.
                        A key whose folders keep their own git (history "own") is never tracked, even without git. */}
                    {!f.tracked && declared[f.key]?.history !== "own" && (
                      <button type="button" disabled={busy} onClick={() => void act(() => client.scopes.confirmGit(scope, f.key, f.path, true))}>
                        {t("hatches.keepTracked")}
                      </button>
                    )}
                    <button type="button" disabled={busy} onClick={() => void act(() => client.scopes.confirmGit(scope, f.key, f.path, false))}>
                      {t("hatches.leaveToGit")}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {folders &&
        keys.map((key) => {
          const d = declared[key];
          // A key that takes one folder hides its button once it has one.
          if (!d.many && folders.some((f) => f.key === key)) return null;
          return (
            <div key={key} className="hh-linked-add">
              <button type="button" disabled={busy} onClick={() => void link(key)}>
                {t("hatches.linkKey", { label: d.label })}
              </button>
              {refused?.key === key && (
                <p ref={alertRef} role="alert" tabIndex={-1}>
                  {refusal(refused.reason)}
                </p>
              )}
            </div>
          );
        })}
    </section>
  );
}
