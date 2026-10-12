import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { ActivityList } from "./ActivityList";
import type { ChatEntry, ChoiceOption, SendOptions } from "./client";

export interface BlockProps {
  data: any;
  /** Sends a message as the user (e.g. the chosen option); `options.action` starts a harness action. */
  respond: (text: string, options?: SendOptions) => boolean;
  /**
   * Picks an option of a `choices` block: the app follows up, starts another topic or moves along the path.
   * True only when the pick was sent; false when refused or still waiting for the person's go-ahead.
   */
  choose: (option: ChoiceOption) => boolean;
  /** Opens a file inside the reference folders or the user's folder in its default app; false when it can't. */
  open: (path: string) => Promise<boolean>;
  /** Shows a file inside the reference folders or the user's folder in Finder, for files `open` refuses (see `canOpenFile`). */
  reveal: (path: string) => Promise<boolean>;
  /** The block belongs to the latest answer and nothing is running: its buttons may act. */
  active: boolean;
}

/** What a block component can do besides showing its data. */
export type BlockActions = Omit<BlockProps, "data">;

export function Blocks({
  blocks,
  components,
  actions,
}: {
  blocks: ChatEntry["blocks"];
  components: Record<string, ComponentType<BlockProps>>;
  actions: BlockActions;
}) {
  return (
    <>
      {blocks.map((b, i) => {
        const Component = components[b.name];
        return Component ? (
          <div key={i} className="hh-block">
            <Component data={b.data} {...actions} />
          </div>
        ) : null;
      })}
    </>
  );
}

export function Message({
  entry,
  components,
  actions,
}: {
  entry: Pick<ChatEntry, "role" | "text" | "blocks" | "activities">;
  components: Record<string, ComponentType<BlockProps>>;
  actions: BlockActions;
}) {
  const { t } = useTranslation();
  if (entry.role === "assistant" && !entry.text && entry.blocks.length === 0 && entry.activities.length === 0) return null;
  return (
    <article className={`hh-message ${entry.role}`}>
      {entry.role === "user" && <span className="hh-who">{t("chat.you")}</span>}
      {entry.role === "assistant" && <ActivityList items={entry.activities.map((a) => ({ ...a, done: true }))} />}
      {entry.text && entry.text.split("\n\n").map((p, i) => <p key={i}>{p}</p>)}
      <Blocks blocks={entry.blocks} components={components} actions={actions} />
    </article>
  );
}
