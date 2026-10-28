import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, SidekickPreset } from "../client";
import { SidekickMark } from "./mark";

/**
 * "Suggested by the harness" (spec §2a.7): the harness's presets not adopted yet, each with "Add <name>", and "Not
 * now", which marks them offered. Nothing when the harness has none or all are adopted (D0). Its place (Settings ›
 * Sidekicks, while `presetsOffered` is false) is the caller's to decide.
 */
export function PresetOffer({ client, onDone }: { client: HarnessClient; onDone?: () => void }) {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<SidekickPreset[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const head = useRef<HTMLHeadingElement>(null);
  /** After an adoption the Add button is gone: focus goes back to the offer's heading. */
  const refocus = useRef(false);

  useEffect(() => {
    let live = true;
    client.sidekick.presets().then(
      (p) => live && setPresets(p),
      () => live && setPresets([]),
    );
    return () => {
      live = false;
    };
  }, [client]);

  const open = presets.filter((p) => !p.adopted);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    if (open.length > 0) head.current?.focus();
    else onDone?.();
  });

  if (open.length === 0) return null;

  const adopt = async (name: string) => {
    setBusy(true);
    setFailed(null);
    try {
      await client.sidekick.adoptPreset(name);
      const next = await client.sidekick.presets();
      refocus.current = true;
      setPresets(next);
    } catch {
      setFailed(name);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={t("sidekick.presets.title")} className="hh-sk-presets">
      <h3 ref={head} tabIndex={-1}>
        {t("sidekick.presets.title")}
      </h3>
      <ul className="hh-sk-presets-list">
        {open.map((p) => (
          <li key={p.name}>
            <SidekickMark mark={p.mark} />
            <div>
              <strong>{p.name}</strong>
              {p.personality && <p className="hh-caption">{p.personality}</p>}
            </div>
            <button type="button" disabled={busy} onClick={() => void adopt(p.name)}>
              {t("sidekick.presets.add", { name: p.name })}
            </button>
          </li>
        ))}
      </ul>
      {failed !== null && <p role="alert">{t("sidekick.presets.failed", { name: failed })}</p>}
      <button type="button" className="hh-link" disabled={busy} onClick={() => void client.sidekick.set({ presetsOffered: true }).then(() => onDone?.(), () => undefined)}>
        {t("sidekick.presets.notNow")}
      </button>
    </section>
  );
}
