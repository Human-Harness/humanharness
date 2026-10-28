import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, SidekickPurposeView, SidekickView } from "../client";
import { ImportSidekick } from "./ImportSidekick";
import { SidekickMark } from "./mark";
import { SidekickEditor } from "./SidekickEditor";

/** Where focus goes once a view closes or the list changes under it. */
type Back = { kind: "new" } | { kind: "import" } | { kind: "head" } | { kind: "edit" | "remove" | "up" | "down"; id: string };

/**
 * Settings › Sidekicks (spec §8): the person's sidekicks by order (the higher one speaks when two could), each with
 * its purposes, Edit, Move up / down and Remove (with more than one; Remove asks first), "New sidekick" and "Import".
 * A sidekick imported from files shows "The original changed · Bring the changes" when its files changed since.
 * The list is read again after every change and whenever main sends a new Sidekick state (an adopted preset).
 */
export function SidekickList({ client, places = [] }: { client: HarnessClient; places?: { id: string; label: string }[] }) {
  const { t } = useTranslation();
  const [list, setList] = useState<SidekickView[] | null>(null);
  /** The sidekick being edited, "new", or null. */
  const [editing, setEditing] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [loads, setLoads] = useState(0);
  const reload = useCallback(() => setLoads((n) => n + 1), []);
  const ids = useId();
  const head = useRef<HTMLHeadingElement>(null);
  const newRef = useRef<HTMLButtonElement>(null);
  const importRef = useRef<HTMLButtonElement>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  /** Row buttons by `<kind>/<id>`, to give focus back after a view closes or a reorder moves the row. */
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const back = useRef<Back | null>(null);
  /** Bumped by every read: an older answer never replaces a newer one. */
  const reads = useRef(0);

  useEffect(() => {
    const n = ++reads.current;
    client.sidekick.list().then(
      (l) => n === reads.current && setList(l),
      () => n === reads.current && setList((now) => now ?? []),
    );
  }, [client, loads]);
  // A preset adopted, an import saved elsewhere: main pushes its state, and the list is read again.
  useEffect(() => client.sidekick.onChange(() => reload()), [client, reload]);

  // Focus: into the confirmation when it opens; back to the opener (or the moved row's button) when a view closes.
  useEffect(() => {
    if (confirm) {
      yesRef.current?.focus();
      return;
    }
    const b = back.current;
    if (!b || editing !== null) return;
    const row = (kind: string, id: string) => rowButtons.current.get(`${kind}/${id}`);
    let target: HTMLElement | null | undefined;
    if (b.kind === "new") target = newRef.current;
    else if (b.kind === "import") target = importRef.current;
    else if (b.kind === "head") target = head.current;
    // A moved row keeps focus on the same button; at the top or bottom that button is gone, so the other one.
    else if (b.kind === "up" || b.kind === "down") target = row(b.kind, b.id) ?? row(b.kind === "up" ? "down" : "up", b.id) ?? row("edit", b.id);
    else target = row(b.kind, b.id) ?? head.current;
    if (target) {
      back.current = null;
      target.focus();
    }
  }, [confirm, editing, importing, list]);

  /** Runs a change; the list is read again whatever happened, and a failure says why. */
  const run = async (change: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    try {
      await change();
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      reload();
    }
  };

  if (!list) return null;

  const purpose = (p: SidekickPurposeView) => (p.id === "custom" ? t("sidekick.purposes.customText", { text: p.text ?? "" }) : t(`sidekick.purposes.${p.id}`, { defaultValue: p.id }));
  const move = (id: string, dir: "up" | "down") =>
    run(async () => {
      const at = list.findIndex((k) => k.id === id);
      const to = dir === "up" ? at - 1 : at + 1;
      if (at < 0 || to < 0 || to >= list.length) return;
      const next = list.map((k) => k.id);
      [next[at], next[to]] = [next[to]!, next[at]!];
      back.current = { kind: dir, id };
      await client.sidekick.reorder(next);
    });
  const remove = (id: string) =>
    run(async () => {
      setConfirm(null);
      back.current = { kind: "head" };
      const r = await client.sidekick.remove(id);
      if (!r.ok) {
        back.current = { kind: "remove", id };
        throw new Error(r.message ?? "");
      }
    });
  const closeEditor = (saved: boolean) => {
    const was = editing;
    setEditing(null);
    back.current = was === "new" || was === null ? { kind: "new" } : { kind: "edit", id: was };
    if (saved) reload();
  };
  const ref = (kind: string, id: string) => (el: HTMLButtonElement | null) => {
    if (el) rowButtons.current.set(`${kind}/${id}`, el);
    else rowButtons.current.delete(`${kind}/${id}`);
  };
  /** A daily-summary sidekick off by default never speaks at daily (the app has no scope records to turn it on). */
  const dailyOff = (k: SidekickView) => k.defaultOn === false && k.purposes.some((p) => p.id === "daily-summary" || (p.id === "custom" && p.moments?.includes("daily")));
  const editingOne = editing !== null && editing !== "new" ? list.find((k) => k.id === editing) : undefined;

  return (
    <section aria-labelledby={`${ids}-head`} className="hh-sk-list">
      <h3 id={`${ids}-head`} ref={head} tabIndex={-1}>
        {t("sidekick.list.title")}
      </h3>
      <p className="hh-caption">{t("sidekick.list.orderHint")}</p>
      <ul className="hh-sk-list-rows">
        {list.map((k, i) => (
          <li key={k.id}>
            <div className="hh-sk-list-row">
              <SidekickMark mark={k.mark} />
              <div className="hh-sk-list-text">
                <strong>{k.name}</strong>
                <p className="hh-caption">{k.purposes.map(purpose).join(" · ")}</p>
                {dailyOff(k) && <p className="hh-caption">{t("sidekick.list.dailyOff")}</p>}
              </div>
              <div className="hh-sk-actions">
                <button type="button" className="hh-link" ref={ref("edit", k.id)} aria-disabled={busy} onClick={() => !busy && (setImporting(false), setEditing(k.id))}>
                  {t("sidekick.list.edit", { name: k.name })}
                </button>
                {i > 0 && (
                  <button type="button" className="hh-link" ref={ref("up", k.id)} aria-disabled={busy} onClick={() => void move(k.id, "up")}>
                    {t("sidekick.list.up", { name: k.name })}
                  </button>
                )}
                {i < list.length - 1 && (
                  <button type="button" className="hh-link" ref={ref("down", k.id)} aria-disabled={busy} onClick={() => void move(k.id, "down")}>
                    {t("sidekick.list.down", { name: k.name })}
                  </button>
                )}
                {list.length > 1 && (
                  <button type="button" className="hh-link" ref={ref("remove", k.id)} aria-disabled={busy} onClick={() => !busy && setConfirm(k.id)}>
                    {t("sidekick.list.remove", { name: k.name })}
                  </button>
                )}
              </div>
            </div>
            {confirm === k.id && (
              <div className="hh-sk-actions">
                <p id={`${ids}-confirm`}>{t("sidekick.list.confirmRemove", { name: k.name })}</p>
                <button ref={yesRef} type="button" aria-describedby={`${ids}-confirm`} aria-disabled={busy} onClick={() => void remove(k.id)}>
                  {t("sidekick.list.confirmYes")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    back.current = { kind: "remove", id: k.id };
                    setConfirm(null);
                  }}
                >
                  {t("sidekick.editor.cancel")}
                </button>
              </div>
            )}
            {k.source?.kind === "files" && (
              <ImportSidekick
                client={client}
                original={{ id: k.id, ...(k.tier ? { tier: k.tier } : {}), ...(k.preset !== undefined ? { preset: k.preset } : {}), ...(k.defaultOn !== undefined ? { defaultOn: k.defaultOn } : {}) }}
                onSaved={reload}
              />
            )}
            {editingOne?.id === k.id && <SidekickEditor key={k.id} client={client} initial={editingOne} places={places} onDone={closeEditor} />}
          </li>
        ))}
      </ul>
      {editing === "new" && <SidekickEditor key="new" client={client} places={places} onDone={closeEditor} />}
      {failed !== null && <p role="alert">{t("sidekick.settings.failed", { message: failed })}</p>}
      <div className="hh-sk-actions">
        <button type="button" ref={newRef} aria-disabled={busy} onClick={() => !busy && (setImporting(false), setEditing("new"))}>
          {t("sidekick.list.new")}
        </button>
        <button
          type="button"
          ref={importRef}
          aria-expanded={importing}
          onClick={() => {
            if (importing) back.current = { kind: "import" };
            setImporting(!importing);
            setEditing(null);
          }}
        >
          {t("sidekick.import.title")}
        </button>
      </div>
      {importing && (
        <ImportSidekick
          client={client}
          onSaved={() => {
            back.current = { kind: "import" };
            setImporting(false);
            reload();
          }}
        />
      )}
    </section>
  );
}
