import { useEffect, useRef, useState } from "react";
import { type FileTarget, type HarnessClient, type PanelProps, type ReaderPrefs } from "@humanharness/ui";
import { defineMod } from "@humanharness/mod-sdk";
import { DocumentReader } from "./ui/DocumentReader";
import { FileTimelineSplit } from "./ui/FileTimelineSplit";

/** The target the opener hands the panel, with the open's own number. */
type Opened = FileTarget & { nonce: number };

/**
 * The reader's look, as last saved in this window: the panel unmounts when it closes, and the state it gets may be from
 * before the save.
 */
const savedPrefs = new WeakMap<HarnessClient, ReaderPrefs>();

type Quiet = (on: boolean) => void;

/** The reader's slot: a document in the reader, or (a deleted or non-`.md` file) its timeline's split view. */
function FilePanel({ quietMode, ...app }: PanelProps & { quietMode: Quiet }) {
  const { client, state, busy, full, onFull, onClose, openFile, onMissing, quiet } = app;
  const target = app.props as Opened;
  const path = target.historyOnly ? undefined : target.path;
  const [prefs, setPrefs] = useState<ReaderPrefs>(() => savedPrefs.get(client) ?? state.config.reader ?? {});
  const savePrefs = (p: ReaderPrefs) => {
    savedPrefs.set(client, p);
    setPrefs(p);
    client.saveConfig({ reader: p }).catch(() => undefined);
  };
  // A link followed in focus mode: the harness's view hears which document is read now.
  const quietNow = useRef(quiet);
  quietNow.current = quiet;
  useEffect(() => {
    if (quietNow.current && path) client.focus.set({ on: true, path });
  }, [client, path]);

  if (target.historyOnly) return <FileTimelineSplit client={client} path={target.path} busy={busy} onClose={onClose} />;
  return (
    <DocumentReader
      client={client}
      target={target}
      kinds={state.documents?.kinds}
      prefs={prefs}
      onPrefs={savePrefs}
      full={full}
      onFull={onFull}
      onClose={onClose}
      onOpen={(p, anchor) => openFile({ path: p, ...(anchor ? { anchor } : {}) })}
      onMissing={onMissing}
      review={state.review === true}
      busy={busy}
      focus={quiet}
      onFocus={(on) => {
        // Focus mode (review spec §6.2). Leaving it, the task view tells the harness's view itself.
        if (on) client.focus.set({ on: true, path: target.path });
        quietMode(on);
      }}
    />
  );
}

/** The documents mod's window part: it opens the files the task view opens, in a panel in the reader's slot. */
export default defineMod({
  id: "documents",
  ui(ctx) {
    const quietMode: Quiet = (on) => ctx.taskView?.quiet(on);
    const Panel = (props: PanelProps) => <FilePanel {...props} quietMode={quietMode} />;
    const panel = ctx.panel?.(Panel);
    let opens = 0;
    // Every open gets a new nonce: the same document at the same anchor opened again goes there again.
    if (panel) ctx.openFile?.((target) => panel.open({ ...target, nonce: ++opens } satisfies Opened));
  },
});
