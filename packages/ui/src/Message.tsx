import { type ComponentType, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { FinishedActivity, WorkingStatus } from "./ActivityList";
import { type AnswerPart, type ChatEntry, type ChoiceOption, type SendOptions, partsOf } from "./client";
import { Markdown } from "./markdown";
import { type Reveal, wordsOf } from "./pace";
import type { LiveActivity } from "./state";

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

/**
 * An answer's text runs and blocks in the order they arrived. With `reveal`, only that much shows and each new
 * word and block fades in (the answer is arriving); without it, all of it shows at once.
 */
function Answer({
  parts,
  blocks,
  reveal,
  components,
  actions,
}: {
  parts: AnswerPart[];
  blocks: ChatEntry["blocks"];
  reveal?: Reveal;
  components: Record<string, ComponentType<BlockProps>>;
  actions: BlockActions;
}) {
  const fade = reveal !== undefined;
  return (
    <>
      {parts.map((p, i) => {
        if (reveal && (i > reveal.part || (i === reveal.part && ("block" in p || reveal.words === 0)))) return null;
        if ("text" in p) {
          const text = reveal && i === reveal.part ? wordsOf(p.text).slice(0, reveal.words).join("") : p.text;
          return (
            <Fragment key={i}>
              <Markdown text={text} fade={fade} />
            </Fragment>
          );
        }
        const block = blocks[p.block];
        const Component = block && components[block.name];
        return Component ? (
          <div key={i} className={fade ? "hh-block hh-appear" : "hh-block"}>
            <Component data={block.data} {...actions} />
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
  live,
  reveal,
}: {
  entry: Pick<ChatEntry, "role" | "text" | "blocks" | "activities" | "parts">;
  components: Record<string, ComponentType<BlockProps>>;
  actions: BlockActions;
  /** The turn is running: its status row instead of what it did, shown even before anything arrives. */
  live?: { activities: LiveActivity[]; label?: string };
  /** The answer is arriving: how much of it shows (see usePacedAnswer). */
  reveal?: Reveal;
}) {
  const { t } = useTranslation();
  if (!live && entry.role === "assistant" && !entry.text && entry.blocks.length === 0 && entry.activities.length === 0) return null;
  return (
    <article className={`hh-message ${entry.role}${live ? " live" : ""}`}>
      {entry.role === "user" && <span className="hh-who">{t("chat.you")}</span>}
      {entry.role === "assistant" &&
        (live ? <WorkingStatus items={live.activities} label={live.label} /> : <FinishedActivity items={entry.activities.map((a) => ({ ...a, done: true }))} />)}
      {entry.role === "assistant" ? (
        <Answer parts={partsOf(entry)} blocks={entry.blocks} reveal={reveal} components={components} actions={actions} />
      ) : (
        entry.text.split("\n\n").map((p, i) => <p key={i}>{p}</p>)
      )}
    </article>
  );
}
