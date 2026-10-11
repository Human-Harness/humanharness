import { type HarnessClient, HarnessApp, type SendFn } from "@humanharness/ui";
import { useTranslation } from "react-i18next";
import en from "../locales/en.json";
import es from "../locales/es.json";
import { NoteCard } from "./NoteCard";

function Side({ percent, send }: { percent: number; send: SendFn }) {
  const { t } = useTranslation("harness");
  return (
    <>
      <p>{t("progress", { percent })}</p>
      <button onClick={() => send(t("tidyMessage"), { action: "tidy" })}>{t("tidy")}</button>
    </>
  );
}

const locales = { es, en };

export default function App({ client }: { client: HarnessClient }) {
  return (
    <HarnessApp
      client={client}
      blocks={{ note: NoteCard }}
      stateBlocks={["progress"]}
      renderSide={(s, send) => <Side percent={(s.progress as { percent?: number } | undefined)?.percent ?? 0} send={send} />}
      locales={locales}
    />
  );
}
