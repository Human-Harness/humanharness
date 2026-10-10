import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { ActivityList } from "./ActivityList";
import type { ChatEntry } from "./client";

export interface BlockProps {
  data: any;
  respond: (text: string) => void;
}

export function Blocks({
  blocks,
  components,
  respond,
}: {
  blocks: ChatEntry["blocks"];
  components: Record<string, ComponentType<BlockProps>>;
  respond: (text: string) => void;
}) {
  return (
    <>
      {blocks.map((b, i) => {
        const Component = components[b.name];
        return Component ? (
          <div key={i} className="hh-block">
            <Component data={b.data} respond={respond} />
          </div>
        ) : null;
      })}
    </>
  );
}

export function Message({
  entry,
  components,
  respond,
}: {
  entry: Pick<ChatEntry, "role" | "text" | "blocks" | "activities">;
  components: Record<string, ComponentType<BlockProps>>;
  respond: (text: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <article className={`hh-message ${entry.role}`}>
      {entry.role === "user" && <span className="hh-who">{t("chat.you")}</span>}
      {entry.role === "assistant" && <ActivityList items={entry.activities.map((a) => ({ ...a, done: true }))} />}
      {entry.text && entry.text.split("\n\n").map((p, i) => <p key={i}>{p}</p>)}
      <Blocks blocks={entry.blocks} components={components} respond={respond} />
    </article>
  );
}
