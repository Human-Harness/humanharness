import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, SidekickDraftDef, SidekickImportInput, SidekickImportResult, SidekickPurposeView } from "../client";
import { SidekickMark } from "./mark";

/** A stored sidekick imported from files: its id and the fields a new draft doesn't carry (Save replaces every field). */
export interface ImportedSidekick {
  id: string;
  tier?: SidekickDraftDef["tier"];
  preset?: string;
  defaultOn?: boolean;
}

type Opener = "run" | "choose" | "bring";
type Ok = Extract<SidekickImportResult, { ok: true }>;

/**
 * Import (spec §2a.6): pasted instructions or picked files become a draft sidekick; the preview shows it, what it
 * learned and what was not imported, and Save (after "I understand it's a copy") stores it with its source. Files are
 * picked and read in main only: the renderer gets a token for the pick, never paths. With `original` it is the re-import instead: nothing unless that sidekick's files
 * changed, then "The original changed · Bring the changes", whose preview saves over the same sidekick.
 * Everything in a draft came from someone else's text: it is shown as plain text only.
 */
export function ImportSidekick({ client, onSaved, onCancel, original }: { client: HarnessClient; onSaved(): void; onCancel?(): void; original?: ImportedSidekick }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SidekickImportResult | null>(null);
  const [ack, setAck] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [changed, setChanged] = useState(false);
  /** Bumped by every run: an older import's answer never replaces a newer one. */
  const runs = useRef(0);
  const opener = useRef<Opener>("run");
  /** Focus goes to the opener once the preview closes (the opener stays mounted, so this is all it takes). */
  const back = useRef(false);
  const head = useRef<HTMLHeadingElement>(null);
  const buttons = { run: useRef<HTMLButtonElement>(null), choose: useRef<HTMLButtonElement>(null), bring: useRef<HTMLButtonElement>(null) };
  const draft = result?.ok ? result : null;

  useEffect(() => {
    if (!original) return;
    let live = true;
    client.sidekick.checkOriginal(original.id).then(
      (r) => live && setChanged(r === "changed"),
      () => live && setChanged(false),
    );
    return () => {
      live = false;
    };
  }, [client, original?.id]);

  // A new preview takes focus; when it closes, focus goes back to the button that opened it.
  useEffect(() => {
    if (draft) head.current?.focus();
    else if (back.current) {
      back.current = false;
      buttons[opener.current].current?.focus();
    }
  }, [draft]);

  const run = async (from: Opener, input: () => Promise<SidekickImportInput | null>) => {
    if (busy) return;
    const n = ++runs.current;
    opener.current = from;
    setBusy(true);
    setAck(false);
    setSaveFailed(false);
    try {
      const req = await input();
      if (!req) return;
      const r = await client.sidekick.importDraft(req).catch((): SidekickImportResult => ({ ok: false, reason: "failed" }));
      if (n === runs.current) setResult(r);
    } catch {
      if (n === runs.current) setResult({ ok: false, reason: "failed" });
    } finally {
      if (n === runs.current) setBusy(false);
    }
  };

  const choose = () =>
    run("choose", async () => {
      const pick = await client.sidekick.pickFiles();
      return pick ? { kind: "files", token: pick.token } : null;
    });
  // Main reads the stored sidekick's own files again: the renderer names only the sidekick.
  const bring = () => run("bring", async () => (original ? { kind: "original", sidekickId: original.id } : null));

  const close = () => {
    back.current = true;
    setResult(null);
    onCancel?.();
  };

  const save = async (d: Ok) => {
    setSaveFailed(false);
    const keep = original ? { id: original.id, ...(original.tier ? { tier: original.tier } : {}), ...(original.preset !== undefined ? { preset: original.preset } : {}), ...(original.defaultOn !== undefined ? { defaultOn: original.defaultOn } : {}) } : {};
    try {
      await client.sidekick.saveSidekick({ ...keep, ...d.draft }, d.learned);
    } catch {
      setSaveFailed(true);
      return;
    }
    onSaved();
  };

  if (original && !changed) return null;

  const failure = result && !result.ok ? result : null;
  const purpose = (p: SidekickPurposeView) => (p.id === "custom" ? t("sidekick.purposes.customText", { text: p.text ?? "" }) : t(`sidekick.purposes.${p.id}`));
  const learnedAt = (level: "you" | "harness") => draft?.learned.filter((l) => l.level === level) ?? [];

  return (
    <section aria-label={t("sidekick.import.title")} className="hh-sk-import">
      {original ? (
        <p>
          <span>{t("sidekick.import.changed")}</span> ·{" "}
          <button type="button" ref={buttons.bring} className="hh-link" aria-disabled={busy} onClick={() => void bring()}>
            {t("sidekick.import.bring")}
          </button>
        </p>
      ) : (
        <>
          <h3>{t("sidekick.import.title")}</h3>
          <textarea aria-label={t("sidekick.import.paste")} value={text} onChange={(e) => setText(e.target.value)} rows={6} />
          <div className="hh-sk-actions">
            {/* aria-disabled, not disabled: the pressed button keeps focus while the import runs. */}
            <button type="button" ref={buttons.run} aria-disabled={busy || !text.trim()} onClick={() => text.trim() && void run("run", async () => ({ kind: "paste", text }))}>
              {t("sidekick.import.run")}
            </button>
            <button type="button" ref={buttons.choose} aria-disabled={busy} onClick={() => void choose()}>
              {t("sidekick.import.choose")}
            </button>
          </div>
        </>
      )}
      {busy && (
        <p className="hh-caption" role="status">
          {t("sidekick.import.working")}
        </p>
      )}
      {failure && (
        <p role="alert">
          {failure.reason === "too-big" && failure.file === undefined
            ? t("sidekick.import.errors.too-big-paste")
            : t(`sidekick.import.errors.${failure.reason}`, { file: failure.file ?? "" })}
        </p>
      )}
      {draft && (
        <section aria-label={t("sidekick.import.preview")} className="hh-sk-preview">
          <h4 ref={head} tabIndex={-1}>
            <SidekickMark mark={draft.draft.mark} /> <strong>{draft.draft.name}</strong>
          </h4>
          {draft.draft.personality && <p className="hh-sk-personality">{draft.draft.personality}</p>}
          <ul className="hh-sk-purposes">
            {draft.draft.purposes.map((p, i) => (
              <li key={i}>{purpose(p)}</li>
            ))}
          </ul>
          {(["you", "harness"] as const).map(
            (level) =>
              learnedAt(level).length > 0 && (
                <div key={level}>
                  <h5>{t(level === "you" ? "sidekick.import.learned" : "sidekick.import.learnedApp")}</h5>
                  <ul>
                    {learnedAt(level).map((l, i) => (
                      <li key={i}>{l.text}</li>
                    ))}
                  </ul>
                </div>
              ),
          )}
          {draft.skipped.length > 0 && <p className="hh-caption">{t("sidekick.import.skipped", { list: draft.skipped.join(", ") })}</p>}
          <p>{t("sidekick.import.copy")}</p>
          <label>
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> {t("sidekick.import.ack")}
          </label>
          {saveFailed && <p role="alert">{t("sidekick.import.saveFailed", { name: draft.draft.name })}</p>}
          <div className="hh-sk-actions">
            <button type="button" className="hh-primary" disabled={!ack} onClick={() => void save(draft)}>
              {t("sidekick.import.save")}
            </button>
            <button type="button" onClick={close}>
              {t("sidekick.import.cancel")}
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
