import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CloseIcon } from "./chrome";
import type { ContextItem, ContextRead, ContextRefusal, ContextResult, HarnessClient, NoteView, TaskContext } from "./client";
import { shownLanguage } from "./language";

export interface ContextPanelProps {
  client: HarnessClient;
  taskId: string;
  /** The context in use and the task's cap (the meter's numbers), shown on top. */
  usage?: { used: number; cap: number };
  /** The open scope's notes, offered by "Add…". */
  notes?: NoteView[];
  /** Opens a file or a note (the core: the reader or the file timeline). Absent: items are plain text. */
  onOpen?: (path: string) => void;
  onClose?: () => void;
  /** The record only, with no action (for a job's run, once jobs exist). */
  readOnly?: boolean;
}

const fileName = (p: string): string => p.slice(p.lastIndexOf("/") + 1);

/**
 * What the agent takes into account in a task (context-panel spec §5.1): what the app loaded at the start, what the
 * agent used since, the pinned files and the excluded notes, with "Add…", "Pin", "Exclude", "Remove", "Include again".
 */
export function ContextPanel({ client, taskId, usage, notes = [], onOpen, onClose, readOnly = false }: ContextPanelProps) {
  const { t, i18n } = useTranslation();
  const startId = useId();
  const duringId = useId();
  const pinnedId = useId();
  const excludedId = useId();
  const [loaded, setCtx] = useState<TaskContext | null>(null);
  // Only the open task's record is ever drawn, even for the one render before a new task's reset runs.
  const ctx = loaded?.task === taskId ? loaded : null;
  const [failed, setFailed] = useState<ContextRefusal | null>(null);
  const [menu, setMenu] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [scopeTitle, setScopeTitle] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pickedRef = useRef<HTMLDivElement>(null);
  const startHead = useRef<HTMLHeadingElement>(null);
  const pinnedHead = useRef<HTMLHeadingElement>(null);
  const excludedHead = useRef<HTMLHeadingElement>(null);
  // The task the panel shows now, and whether it is still mounted: an answer for another task, or one that arrives
  // after the panel closed, is dropped.
  const shownTask = useRef(taskId);
  shownTask.current = taskId;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = (id: string) => mounted.current && shownTask.current === id;
  const fmt = (n: number) => n.toLocaleString(shownLanguage(i18n));

  // Focus follows the "Add…" flow: into the menu when it opens, onto the picked file's choices once one is picked.
  useEffect(() => {
    if (menu) menuRef.current?.querySelector("button")?.focus();
  }, [menu]);
  useEffect(() => {
    if (picked) pickedRef.current?.querySelector("button")?.focus();
  }, [picked]);
  const closeMenu = () => {
    setMenu(false);
    addRef.current?.focus();
  };
  /** The picked file was added or pinned: its choices go away and focus goes back to "Add…". */
  const settled = () => {
    setPicked(null);
    addRef.current?.focus();
  };

  useEffect(() => {
    // Another task: nothing of the previous one's panel (record, pick, notice, menu, wait) carries over.
    setCtx(null);
    setFailed(null);
    setMenu(false);
    setPicked(null);
    setWaiting(false);
    setNotice(null);
    let live = true;
    client.context.get(taskId).then(
      (r) => {
        if (!live) return;
        if (r.ok) {
          setCtx(r.context);
          setFailed(null);
        } else setFailed(r.reason);
      },
      () => live && setFailed("failed"),
    );
    const off = client.context.onChange(taskId, (c) => {
      if (live) setCtx(c);
    });
    return () => {
      live = false;
      off();
    };
  }, [client, taskId]);

  const scoped = ctx?.scoped === true;
  const scope = ctx?.scope;
  useEffect(() => {
    if (!scoped || !scope) return;
    let live = true;
    client.scopes.list().then(
      (list) => {
        if (live) setScopeTitle(list.find((s) => s.id === scope)?.title ?? null);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [client, scoped, scope]);

  const refresh = (id: string) =>
    client.context.get(id).then(
      (r) => {
        if (r.ok && current(id)) setCtx(r.context);
      },
      () => {},
    );
  const run = async (call: () => Promise<ContextResult>, after?: () => void) => {
    const id = taskId;
    setNotice(null);
    const r = await call().catch((): ContextResult => ({ ok: false, reason: "failed" }));
    if (!current(id)) return;
    if (!r.ok) {
      setNotice(t(`context.refused.${r.reason}`));
      return;
    }
    after?.();
    await refresh(id);
  };
  /** A row's action took its button away: focus goes to its section's heading (or "Add…" when the section goes too). */
  const focusOn = (el: { current: HTMLElement | null }) => () => (el.current ?? addRef.current)?.focus();

  const head = (
    <div className="hh-ctxp-head">
      <h2>{t("context.title")}</h2>
      {onClose && (
        <button type="button" className="hh-icon-button" aria-label={t("context.close")} onClick={onClose}>
          <CloseIcon />
        </button>
      )}
    </div>
  );
  if (!ctx) {
    return (
      <section className="hh-ctxp" aria-label={t("context.title")} onKeyDown={(e) => e.key === "Escape" && onClose?.()}>
        {head}
        {failed && <p className="hh-caption">{t(failed === "no-task" ? "context.noTask" : "context.loadFailed")}</p>}
      </section>
    );
  }

  const open = (path: string, label: ReactNode = path) =>
    onOpen ? (
      <button type="button" className="hh-link" onClick={() => onOpen(path)}>
        {label}
      </button>
    ) : (
      <span>{label}</span>
    );
  const excludedNotes = new Set(ctx.excluded.map((e) => e.note));
  const itemText = (i: ContextItem): string => {
    if (i.kind === "brief" && i.at) return t("context.item.briefLater", { time: new Date(i.at).toLocaleTimeString(shownLanguage(i18n), { hour: "2-digit", minute: "2-digit" }) });
    if (i.kind === "data" && i.id.startsWith("data:")) return t("context.item.dataNamed", { name: i.id.slice("data:".length), count: i.count ?? 0 });
    return t(`context.item.${i.kind}`, { count: i.count ?? 0, path: i.path ?? "" });
  };
  const total = ctx.start.reduce((n, i) => n + i.tokens, 0);
  const reads = [...ctx.reads].sort((a, b) => b.firstAt.localeCompare(a.firstAt));
  // Two reads outside the folder can share a file name: the key adds the time and the position.
  const readRow = (r: ContextRead, n: number) => (
    <li key={`${r.kind}:${r.path ?? r.label}:${r.firstAt}:${n}`} className={r.compacted ? "hh-ctxp-row hh-ctxp-faint" : "hh-ctxp-row"}>
      {r.path ? open(r.path) : <span>{r.label}</span>}
      {r.count > 1 && <span className="hh-ctxp-size">{t("context.times", { count: r.count })}</span>}
      {r.compacted && <span className="hh-caption">{t("context.faint")}</span>}
      {!readOnly && r.path && (
        <button type="button" aria-label={t("context.pinName", { name: r.path })} onClick={() => void run(() => client.context.pin(ctx.scope, r.path!))}>
          {t("context.pin")}
        </button>
      )}
    </li>
  );
  const pinLabel = scoped ? t("context.pinIn", { scope: scopeTitle ?? ctx.scope }) : t("context.pinEvery");

  return (
    <section className="hh-ctxp" aria-label={t("context.title")} onKeyDown={(e) => e.key === "Escape" && onClose?.()}>
      {head}
      {usage && <p className="hh-caption">{t("context.inUse", { used: fmt(usage.used), cap: fmt(usage.cap) })}</p>}
      {ctx.compacted && <p className="hh-caption">{t("context.compactedNote")}</p>}
      {!readOnly && (
        <div className="hh-ctxp-add">
          <button type="button" ref={addRef} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            {t("context.add")}
          </button>
          {menu && (
            <div
              ref={menuRef}
              className="hh-ctxp-menu"
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                // Escape closes the menu first; the panel's own Escape (close) needs a second press.
                e.stopPropagation();
                closeMenu();
              }}
            >
              <button
                type="button"
                onClick={async () => {
                  const id = taskId;
                  closeMenu();
                  const r = await client.context.pick().catch(() => ({ ok: false as const, reason: "failed" as const }));
                  if (!current(id)) return;
                  if (r.ok) setPicked(r.path);
                  else if (r.reason !== "cancelled") setNotice(t(`context.refused.${r.reason}`));
                }}
              >
                {t("context.chooseFile")}
              </button>
              {notes.length > 0 && <p className="hh-caption">{t("context.notes")}</p>}
              {notes.map((n) => (
                <button
                  key={n.path}
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    setPicked(n.path);
                  }}
                >
                  {n.title}
                </button>
              ))}
            </div>
          )}
          {picked && (
            <div ref={pickedRef} className="hh-ctxp-picked">
              <span>{picked}</span>
              <button
                type="button"
                disabled={waiting}
                onClick={async () => {
                  const id = taskId;
                  setWaiting(true);
                  await run(() => client.context.add(id, picked), settled);
                  if (current(id)) setWaiting(false);
                }}
              >
                {t("context.forTask")}
              </button>
              <button type="button" disabled={waiting} onClick={() => void run(() => client.context.pin(ctx.scope, picked), settled)}>
                {pinLabel}
              </button>
              {scoped && ctx.scope !== "_app" && (
                <button type="button" disabled={waiting} onClick={() => void run(() => client.context.pin("_app", picked), settled)}>
                  {t("context.pinApp")}
                </button>
              )}
            </div>
          )}
          {/* Always there, so a screen reader hears the text when it appears. */}
          <p role="status" className="hh-caption">
            {waiting ? t("context.waiting") : ""}
          </p>
        </div>
      )}
      {notice && (
        <p className="hh-caption" role="alert">
          {notice}
        </p>
      )}

      <section className="hh-ctxp-section" aria-labelledby={startId}>
        <h3 id={startId} ref={startHead} tabIndex={-1}>{t("context.start")}</h3>
        <ul className="hh-ctxp-list">
          {ctx.start.map((i) => (
            <li key={i.id} className={i.compacted ? "hh-ctxp-faint" : undefined}>
              <div className="hh-ctxp-row">
                {i.path && i.kind !== "instructions" ? open(i.path, itemText(i)) : <span>{itemText(i)}</span>}
                <span className="hh-ctxp-size">{t("context.approx", { tokens: fmt(i.tokens) })}</span>
                {i.compacted && <span className="hh-caption">{t("context.faint")}</span>}
              </div>
              {i.notes && i.notes.length > 0 && (
                <ul className="hh-ctxp-notes">
                  {i.notes.map((n) => (
                    <li key={n.path} className="hh-ctxp-row">
                      {open(n.path, n.title)}
                      {excludedNotes.has(n.path) ? (
                        <span className="hh-caption">{t("context.appliesNext")}</span>
                      ) : (
                        !readOnly && (
                          <button
                            type="button"
                            aria-label={t("context.excludeName", { name: n.title })}
                            onClick={() => void run(() => client.context.exclude(i.kind === "app-notes-index" ? "_app" : ctx.scope, n.path), focusOn(startHead))}
                          >
                            {t("context.exclude")}
                          </button>
                        )
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        <p className="hh-caption">{t("context.total", { tokens: fmt(total) })}</p>
        {ctx.startTokens !== undefined && <p className="hh-caption">{t("context.realFirst", { tokens: fmt(ctx.startTokens) })}</p>}
      </section>

      <section className="hh-ctxp-section" aria-labelledby={duringId}>
        <h3 id={duringId}>{t("context.during")}</h3>
        {reads.length === 0 ? <p className="hh-caption">{t("context.nothingRead")}</p> : <ul className="hh-ctxp-list">{reads.map(readRow)}</ul>}
      </section>

      <section className="hh-ctxp-section" aria-labelledby={pinnedId}>
        <h3 id={pinnedId} ref={pinnedHead} tabIndex={-1}>{t("context.pinned")}</h3>
        {ctx.pins.length === 0 ? (
          <p className="hh-caption">{t("context.nothingPinned")}</p>
        ) : (
          <ul className="hh-ctxp-list">
            {ctx.pins.map((p) => {
              const gone = p.state === "missing" || p.state === "binary";
              return (
                <li key={`${p.scope}:${p.path}`} className="hh-ctxp-row">
                  {gone ? <span className="hh-ctxp-gone">{p.path}</span> : open(p.path)}
                  {p.scope === "_app" && scoped && <span className="hh-caption">{t("context.wholeApp")}</span>}
                  {p.state === "title" && <span className="hh-caption">{t("context.titleOnly")}</span>}
                  {gone && <span className="hh-caption">{t(p.state === "missing" ? "context.missing" : "context.binary")}</span>}
                  {!gone && <span className="hh-ctxp-size">{t("context.approx", { tokens: fmt(p.tokens) })}</span>}
                  {!readOnly && (
                    <button type="button" aria-label={t("context.removeName", { name: p.path })} onClick={() => void run(() => client.context.unpin(p.scope, p.path), focusOn(pinnedHead))}>
                      {t("context.remove")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {ctx.excluded.length > 0 && (
        <section className="hh-ctxp-section" aria-labelledby={excludedId}>
          <h3 id={excludedId} ref={excludedHead} tabIndex={-1}>{t("context.excluded")}</h3>
          <ul className="hh-ctxp-list">
            {ctx.excluded.map((e) => (
              <li key={`${e.scope}:${e.note}`} className="hh-ctxp-row">
                {e.title ? open(e.note, e.title) : <span className="hh-ctxp-gone">{fileName(e.note)}</span>}
                {!readOnly && (
                  <button type="button" aria-label={t("context.includeName", { name: e.title ?? fileName(e.note) })} onClick={() => void run(() => client.context.include(e.scope, e.note), focusOn(ctx.excluded.length > 1 ? excludedHead : addRef))}>
                    {t("context.include")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
