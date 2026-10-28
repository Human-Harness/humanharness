import { type ComponentType, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { FinishedActivity, WorkingStatus } from "./ActivityList";
import {
  type AnswerPart,
  type BlockAnswer,
  type ChatBlock,
  type ChatEntry,
  type ChoiceOption,
  type DocumentCard,
  type InputIssue,
  type InputSpec,
  type ModeView,
  type RespondResult,
  type SendOptions,
  partsOf,
} from "./client";
import { cleanDocumentCards } from "./card-shape";
import { DocumentCards } from "./DocumentCards";
import { InputHost } from "./InputBlock";
import { Markdown } from "./markdown";
import { type Reveal, wordsOf } from "./pace";
import type { LiveActivity } from "./state";

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
  /**
   * Task modes (task-modes spec §5): picks a mode for the open task. True only when the switch was sent (not while
   * the tier question waits, nor when refused). Absent without modes (D0), and on a block of an earlier task.
   */
  chooseMode?: (mode: string) => boolean;
  /** The harness's modes as the window shows them, the action's modes (`allowed`), and the task's mode now. */
  modes?: { views: Record<string, ModeView>; allowed: string[]; current?: string };
}

/** What a block component can do besides showing its data. */
export type BlockActions = Omit<BlockProps, "data" | "input"> & {
  /** Absent in a harness with no input block (spec D0). */
  inputs?: InputContext;
};

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
  blocks: ChatBlock[];
  reveal?: Reveal;
  components: Record<string, ComponentType<BlockProps>>;
  actions: BlockActions;
}) {
  const fade = reveal !== undefined;
  const { inputs, ...rest } = actions;
  return (
    <>
      {parts.map((p, i) => {
        if (reveal && (i > reveal.part || (i === reveal.part && ("block" in p || reveal.words === 0)))) return null;
        if ("text" in p) {
          const text = reveal && i === reveal.part ? wordsOf(p.text).slice(0, reveal.words).join("") : p.text;
          return (
            <Fragment key={i}>
              <Markdown source={text} fade={fade} />
            </Fragment>
          );
        }
        const block = blocks[p.block];
        if (!block) return null;
        // Own keys only: a block named like an Object method (`constructor`) finds nothing.
        const Component = Object.hasOwn(components, block.name) ? components[block.name] : undefined;
        const spec = inputs && Object.hasOwn(inputs.specs, block.name) ? inputs.specs[block.name] : undefined;
        // Keyed by block id: its errors, sending state and draft never move to another block.
        if (inputs && spec) return <InputHost key={block.id ?? i} block={block} spec={spec} Component={Component} actions={rest} inputs={inputs} fade={fade} />;
        return Component ? (
          <div key={i} className={fade ? "hh-block hh-appear" : "hh-block"}>
            <Component data={block.data} {...rest} />
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
  documents,
}: {
  entry: Pick<ChatEntry, "role" | "text" | "blocks" | "activities" | "parts" | "mode" | "phase" | "timeUp" | "documents">;
  components: Record<string, ComponentType<BlockProps>>;
  actions: BlockActions;
  /** The turn is running: its status row instead of what it did, shown even before anything arrives. */
  live?: { activities: LiveActivity[]; label?: string };
  /** The answer is arriving: how much of it shows (see usePacedAnswer). */
  reveal?: Reveal;
  /** The chat's handling of document cards (document-reader spec §5.1); absent: cards are not drawn. */
  documents?: { missing: ReadonlySet<string>; open(card: DocumentCard): void };
}) {
  const { t } = useTranslation();
  // The chat log is read from disk unchecked: only well-formed cards are drawn.
  const cards = entry.role === "assistant" && documents && entry.documents !== undefined ? cleanDocumentCards(entry.documents) : [];
  if (!live && entry.role === "assistant" && !entry.text && entry.blocks.length === 0 && entry.activities.length === 0 && cards.length === 0) return null;
  // A mode switch (task-modes spec §5.4), a phase change or the wrap-up (task-phases spec §4.4, §5): a system line,
  // not the person's message.
  if (entry.role === "user" && (entry.mode || entry.phase || entry.timeUp)) {
    return (
      <article className="hh-message system">
        <p className="hh-mode-line">{entry.text}</p>
      </article>
    );
  }
  return (
    <article className={`hh-message ${entry.role}${live ? " live" : ""}`}>
      {entry.role === "user" && <span className="hh-who">{t("chat.you")}</span>}
      {entry.role === "assistant" &&
        (live ? <WorkingStatus items={live.activities} label={live.label} /> : <FinishedActivity items={entry.activities.map((a) => ({ ...a, done: true }))} />)}
      {entry.role === "assistant" ? (
        <>
          <Answer parts={partsOf(entry)} blocks={entry.blocks} reveal={reveal} components={components} actions={actions} />
          {documents && cards.length > 0 && <DocumentCards cards={cards} missing={documents.missing} onOpen={documents.open} />}
        </>
      ) : (
        entry.text.split("\n\n").map((p, i) => <p key={i}>{p}</p>)
      )}
    </article>
  );
}
