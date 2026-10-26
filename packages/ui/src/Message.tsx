import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { FinishedActivity } from "./ActivityList";
import type { BlockAnswer, ChatBlock, ChatEntry, ChoiceOption, InputIssue, InputSpec, RespondResult, SendOptions } from "./client";
import { InputHost } from "./InputBlock";
import { Markdown } from "./markdown";

/** What a block the person answers gets (input-blocks spec §5): draw the form, or the answer once sent. */
export interface InputProps {
  spec: InputSpec;
  blockId?: string;
  /** This is the question the open task waits on, still unanswered (or its answer is on its way). */
  pending: boolean;
  /** The form can't be sent now: not pending, something runs, or the answer is on its way. */
  disabled: boolean;
  answered?: BlockAnswer;
  /** Why the last send was refused: by field (`path`), "" for the whole answer. */
  errors: InputIssue[];
  sending: boolean;
  submit(value: Record<string, unknown>): void;
  /** Only for a skippable block. */
  skip?: () => void;
}

/** What the chat knows about input blocks, for every block of a message. */
export interface InputContext {
  specs: Record<string, InputSpec>;
  /** The id of the question the open task waits on. */
  pending?: string;
  /** The open task waits for the person (its pending question wins over an answer already marked on its block). */
  waiting: boolean;
  /** The task waits and nothing runs: the pending question may be answered. */
  ready: boolean;
  respond(blockId: string, value: Record<string, unknown>): Promise<RespondResult>;
}

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
  /** Blocks the person answers only (their component draws the form, or uses the exported InputForm). */
  input?: InputProps;
  /** The answer an `annotate` block is about: an answered block's id, or "last" (the latest one before this block). */
  answerOf?: (ref: string) => BlockAnswer | null;
}

/** What a block component can do besides showing its data. */
export type BlockActions = Omit<BlockProps, "data" | "input"> & {
  /** Absent in a harness with no input block (spec D0). */
  inputs?: InputContext;
};

export function Blocks({
  blocks,
  components,
  actions,
}: {
  blocks: ChatBlock[];
  components: Record<string, ComponentType<BlockProps>>;
  actions: BlockActions;
}) {
  const { inputs, ...rest } = actions;
  return (
    <>
      {blocks.map((b, i) => {
        const Component = components[b.name];
        // Keyed by block id: its errors, sending state and draft never move to another block.
        if (inputs?.specs[b.name]) return <InputHost key={b.id ?? i} block={b} Component={Component} actions={rest} inputs={inputs} />;
        return Component ? (
          <div key={i} className="hh-block">
            <Component data={b.data} {...rest} />
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
      {entry.role === "assistant" && <FinishedActivity items={entry.activities.map((a) => ({ ...a, done: true }))} />}
      {entry.text &&
        (entry.role === "assistant" ? <Markdown text={entry.text} /> : entry.text.split("\n\n").map((p, i) => <p key={i}>{p}</p>))}
      <Blocks blocks={entry.blocks} components={components} actions={actions} />
    </article>
  );
}
