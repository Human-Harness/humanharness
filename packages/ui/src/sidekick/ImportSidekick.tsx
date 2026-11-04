import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, SidekickDraftDef, SidekickImportInput, SidekickImportResult, SidekickPurposeView } from "../client";
import { Rx } from "../guide";
import { SidekickMark, markIcon } from "./mark";

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
 *
 * Radix stage 2d: the import is one card; the re-import is one line under its row, its preview in a card below.
 */
export function ImportSidekick({ client, onSaved, onCancel, original }: { client: HarnessClient; onSaved(): void; onCancel?(): void; original?: ImportedSidekick }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SidekickImportResult | null>(null);
  const [ack, setAck] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Set from the first Save click: a second click before the answer never sends a second save (a new sidekick each). */
  const savingNow = useRef(false);
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
    if (busy || savingNow.current) return;
    const n = ++runs.current;
    opener.current = from;
    setBusy(true);
    // The old preview or alert goes now: a draft from an earlier run can't be saved while this one works.
    setResult(null);
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
    if (savingNow.current || busy) return;
    savingNow.current = true;
    setSaving(true);
    setSaveFailed(false);
    const keep = original ? { id: original.id, ...(original.tier ? { tier: original.tier } : {}), ...(original.preset !== undefined ? { preset: original.preset } : {}), ...(original.defaultOn !== undefined ? { defaultOn: original.defaultOn } : {}) } : {};
    try {
      await client.sidekick.saveSidekick({ ...keep, ...d.draft }, d.learned);
    } catch {
      setSaveFailed(true);
      return;
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
    onSaved();
  };

  if (original && !changed) return null;

  const failure = result && !result.ok ? result : null;
  const purpose = (p: SidekickPurposeView) => (p.id === "custom" ? t("sidekick.purposes.customText", { text: p.text ?? "" }) : t(`sidekick.purposes.${p.id}`));
  const learnedAt = (level: "you" | "harness") => draft?.learned.filter((l) => l.level === level) ?? [];

  const working = busy && (
    <Rx.Text as="p" size="1" color="gray" role="status" mt="2">
      {t("sidekick.import.working")}
    </Rx.Text>
  );
  const failed = failure && (
    <Rx.Callout.Root color="red" role="alert" size="1" mt="3">
      <Rx.Callout.Text>
        {failure.reason === "too-big" && failure.file === undefined ? t("sidekick.import.errors.too-big-paste") : t(`sidekick.import.errors.${failure.reason}`, { file: failure.file ?? "" })}
      </Rx.Callout.Text>
    </Rx.Callout.Root>
  );
  // Everything in a draft came from someone else's text: plain text only, `dir="auto"` for its own direction.
  const preview = draft && (
    <Rx.Box asChild mt="3">
      <section aria-label={t("sidekick.import.preview")}>
        <Rx.Heading as="h4" size="2" ref={head} tabIndex={-1} mb="2">
          <Rx.Flex as="span" align="center" gap="2">
            <SidekickMark icon={markIcon(draft.draft.mark)} />
            <bdi dir="auto">{draft.draft.name}</bdi>
          </Rx.Flex>
        </Rx.Heading>
        {draft.draft.personality && (
          <Rx.Text as="p" size="2" dir="auto" mb="2">
            {draft.draft.personality}
          </Rx.Text>
        )}
        <Rx.Text as="p" size="1" color="gray">
          {draft.draft.purposes.map(purpose).join(" · ")}
        </Rx.Text>
        {(["you", "harness"] as const).map(
          (level) =>
            learnedAt(level).length > 0 && (
              <Rx.Box key={level} mt="3">
                <Rx.Heading as="h5" size="1" color="gray" mb="1">
                  {t(level === "you" ? "sidekick.import.learned" : "sidekick.import.learnedApp")}
                </Rx.Heading>
                <Rx.Box asChild pl="4">
                  <ul>
                    {learnedAt(level).map((l, i) => (
                      <li key={i} dir="auto">
                        <Rx.Text size="2">{l.text}</Rx.Text>
                      </li>
                    ))}
                  </ul>
                </Rx.Box>
              </Rx.Box>
            ),
        )}
        {draft.skipped.length > 0 && (
          <Rx.Text as="p" size="1" color="gray" mt="2">
            {t("sidekick.import.skipped", { list: draft.skipped.join(", ") })}
          </Rx.Text>
        )}
        <Rx.Text as="p" size="2" mt="3">
          {t("sidekick.import.copy")}
        </Rx.Text>
        <Rx.Text as="label" size="2" mt="2">
          <Rx.Flex gap="2" align="center" mt="2">
            <Rx.Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} />
            {t("sidekick.import.ack")}
          </Rx.Flex>
        </Rx.Text>
        {saveFailed && (
          <Rx.Callout.Root color="red" role="alert" size="1" mt="3">
            <Rx.Callout.Text>{t("sidekick.import.saveFailed", { name: draft.draft.name })}</Rx.Callout.Text>
          </Rx.Callout.Root>
        )}
        <Rx.Flex justify="end" gap="2" mt="3">
          <Rx.Button type="button" variant="outline" color="gray" onClick={close}>
            {t("sidekick.import.cancel")}
          </Rx.Button>
          <Rx.Button type="button" variant="solid" disabled={!ack} aria-disabled={saving} onClick={() => void save(draft)}>
            {t("sidekick.import.save")}
          </Rx.Button>
        </Rx.Flex>
      </section>
    </Rx.Box>
  );

  // The re-import: one line under the sidekick's row; its preview opens in a card below it.
  if (original) {
    return (
      <section aria-label={t("sidekick.import.title")}>
        <Rx.Flex align="center" gap="2" wrap="wrap">
          <Rx.Text size="1" color="orange">
            {t("sidekick.import.changed")}
          </Rx.Text>
          <Rx.Button type="button" ref={buttons.bring} variant="ghost" color="gray" size="1" aria-disabled={busy || saving} onClick={() => void bring()}>
            {t("sidekick.import.bring")}
          </Rx.Button>
        </Rx.Flex>
        {working}
        {failed}
        {preview && (
          // Inside the list's row: under a line, not a second card.
          <Rx.Box mt="3">
            <Rx.Separator size="4" mb="3" />
            {preview}
          </Rx.Box>
        )}
      </section>
    );
  }

  // The import: one card (DESIGN.md "an editor goes inside a card").
  return (
    <section aria-label={t("sidekick.import.title")}>
      <Rx.Card size="2">
        <Rx.Heading as="h3" size="3" mb="3">
          {t("sidekick.import.title")}
        </Rx.Heading>
        <Rx.TextArea aria-label={t("sidekick.import.paste")} value={text} onChange={(e) => setText(e.target.value)} rows={6} />
        <Rx.Flex gap="2" mt="3">
          {/* aria-disabled, not disabled: the pressed button keeps focus while the import runs. */}
          <Rx.Button
            type="button"
            variant="outline"
            color="gray"
            ref={buttons.run}
            aria-disabled={busy || saving || !text.trim()}
            onClick={() => text.trim() && void run("run", async () => ({ kind: "paste", text }))}
          >
            {t("sidekick.import.run")}
          </Rx.Button>
          <Rx.Button type="button" variant="outline" color="gray" ref={buttons.choose} aria-disabled={busy || saving} onClick={() => void choose()}>
            {t("sidekick.import.choose")}
          </Rx.Button>
        </Rx.Flex>
        {working}
        {failed}
        {preview && (
          <>
            <Rx.Separator size="4" mt="3" />
            {preview}
          </>
        )}
      </Rx.Card>
    </section>
  );
}
