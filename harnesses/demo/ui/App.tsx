import { type HarnessClient, HarnessApp } from "@humanharness/ui";
import { useTranslation } from "react-i18next";
import en from "../locales/en.json";
import es from "../locales/es.json";
import { NoteCard } from "./NoteCard";

function Progress({ percent }: { percent: number }) {
  const { t } = useTranslation("harness");
  return <p>{t("progress", { percent })}</p>;
}

const locales = { es, en };

export default function App({ client }: { client: HarnessClient }) {
  return (
    <HarnessApp
      client={client}
      blocks={{ note: NoteCard }}
      stateBlocks={["progress"]}
      renderSide={(s) => <Progress percent={(s.progress as { percent?: number } | undefined)?.percent ?? 0} />}
      locales={locales}
    />
  );
}
