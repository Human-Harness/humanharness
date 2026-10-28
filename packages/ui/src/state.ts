import { type AnswerPart, type BlockAnswer, type ChatBlock, type ChatEntry, type DocumentCard, type Event, type LimitWindow, type TurnUsage, addParagraph, addText, finishParts } from "./client";

export interface LiveActivity {
  id: string;
  kind: ChatEntry["activities"][number]["kind"];
  detail: string;
  done: boolean;
  error?: boolean;
}

export interface LiveTurn {
  /** The id its entry gets when the turn ends: the answer stays the same element on screen. */
  id: string;
  text: string;
  blocks: ChatBlock[];
  /** Text runs and blocks in the order they arrived. */
  parts: AnswerPart[];
  activities: LiveActivity[];
  usage?: TurnUsage;
  limits?: LimitWindow[];
  /** State-only blocks emitted during this turn (saved on the entry). */
  state?: Record<string, unknown>;
  /** The `.md` files the turn added or changed (document-reader spec §5.1), saved on the entry. */
  documents?: DocumentCard[];
}

export interface ChatState {
  entries: ChatEntry[];
  live: LiveTurn | null;
  /** Latest data of state-only blocks (e.g. progress). */
  blockState: Record<string, unknown>;
  /** Names of state-only blocks; their events never enter the conversation. */
  stateBlocks: Set<string>;
  limits: LimitWindow[] | null;
}

/** A turn's end, with the task the window had open then (its entry is tagged with it). */
type DoneAction = Extract<Event, { type: "done" }> & { task?: string };

export type ChatAction =
  | Exclude<Event, { type: "done" }>
  | DoneAction
  | { type: "user"; text: string; at: string; action?: string; mode?: string; phase?: string; timeUp?: true }
  | { type: "loaded"; entries: ChatEntry[] }
  /** The person's answer to an input block was taken: it goes on its block (input-blocks spec §8). */
  | { type: "answered"; answer: BlockAnswer }
  /** A local assistant message that the UI shows but never saves. */
  | { type: "notice"; text: string; at: string };

export function initialChat(entries: ChatEntry[], stateBlocks: string[] = []): ChatState {
  return { entries, live: null, blockState: {}, stateBlocks: new Set(stateBlocks), limits: null };
}

const newId = () => Math.random().toString(36).slice(2);

export function reduceChat(state: ChatState, action: ChatAction): ChatState {
  const live = state.live;
  switch (action.type) {
    case "loaded": {
      const restored: Record<string, unknown> = Object.assign({}, ...action.entries.map((e) => e.state ?? {}));
      return {
        ...state,
        entries: [...action.entries, ...state.entries.filter((e) => !action.entries.some((s) => s.id === e.id))],
        blockState: { ...restored, ...state.blockState },
      };
    }
    case "notice":
      return {
        ...state,
        entries: [...state.entries, { id: newId(), role: "assistant", text: action.text, blocks: [], activities: [], at: action.at }],
      };
    case "user":
      return {
        ...state,
        entries: [
          ...state.entries,
          {
            id: newId(),
            role: "user",
            text: action.text,
            blocks: [],
            activities: [],
            at: action.at,
            ...(action.action ? { action: action.action } : {}),
            ...(action.mode ? { mode: action.mode } : {}),
            ...(action.phase ? { phase: action.phase } : {}),
            ...(action.timeUp ? { timeUp: true as const } : {}),
          },
        ],
        live: { id: newId(), text: "", blocks: [], parts: [], activities: [] },
      };
    case "text":
      return live ? { ...state, live: { ...live, text: live.text + action.delta, parts: addText(live.parts, action.delta) } } : state;
    case "paragraph":
      return live && live.text ? { ...state, live: { ...live, text: `${live.text}\n\n`, parts: addParagraph(live.parts) } } : state;
    case "activity": {
      if (!live) return state;
      if (action.state === "start") {
        const activity: LiveActivity = { id: action.id, kind: action.kind, detail: action.detail, done: false };
        return { ...state, live: { ...live, activities: [...live.activities, activity] } };
      }
      const activities = live.activities.map((a) => (a.id === action.id ? { ...a, done: true, error: action.error } : a));
      return { ...state, live: { ...live, activities } };
    }
    case "block":
      if (state.stateBlocks.has(action.name)) {
        return {
          ...state,
          blockState: { ...state.blockState, [action.name]: action.data },
          live: live ? { ...live, state: { ...live.state, [action.name]: action.data } } : live,
        };
      }
      return live
        ? {
            ...state,
            live: {
              ...live,
              blocks: [...live.blocks, { name: action.name, data: action.data, ...(action.id ? { id: action.id } : {}) }],
              parts: [...live.parts, { block: live.blocks.length }],
            },
          }
        : state;
    case "documents":
      return live ? { ...state, live: { ...live, documents: action.documents } } : state;
    case "context":
    case "compaction":
      // The task view carries them (the side panel's meter); the conversation doesn't change.
      return state;
    case "limits":
      return { ...state, limits: action.windows, live: live ? { ...live, limits: action.windows } : live };
    case "usage":
      return live
        ? {
            ...state,
            live: {
              ...live,
              usage: {
                inputTokens: action.inputTokens,
                outputTokens: action.outputTokens,
                cacheReadTokens: action.cacheReadTokens,
                cacheWriteTokens: action.cacheWriteTokens,
                ...(action.costUsd !== undefined ? { costUsd: action.costUsd } : {}),
              },
            },
          }
        : state;
    case "answered": {
      const id = action.answer.blockId;
      // A second answer (the question was reopened after a stopped send) replaces the first.
      const mark = (blocks: ChatBlock[]) => blocks.map((b) => (b.id === id ? { ...b, input: action.answer } : b));
      return {
        ...state,
        entries: state.entries.map((e) => (e.blocks.some((b) => b.id === id) ? { ...e, blocks: mark(e.blocks) } : e)),
        live: live && live.blocks.some((b) => b.id === id) ? { ...live, blocks: mark(live.blocks) } : live,
      };
    }
    case "done": {
      if (!live) {
        // A failure without a turn on screen (a quiet closing turn): show the error alone.
        if (action.ok) return state;
        const error: ChatEntry = {
          id: newId(),
          role: "assistant",
          text: "",
          blocks: [],
          activities: [],
          at: new Date().toISOString(),
          error: action.error,
          ...(action.task ? { task: action.task } : {}),
        };
        return { ...state, entries: [...state.entries, error] };
      }
      const entry: ChatEntry = {
        id: live.id,
        role: "assistant",
        text: live.text.trim(),
        blocks: live.blocks,
        parts: finishParts(live.parts),
        activities: live.activities.map(({ kind, detail }) => ({ kind, detail })),
        at: new Date().toISOString(),
        ...(live.usage ? { usage: live.usage } : {}),
        ...(live.limits ? { limits: live.limits } : {}),
        ...(live.state ? { state: live.state } : {}),
        ...(live.documents ? { documents: live.documents } : {}),
        ...(action.ok ? {} : { error: action.error }),
        ...(action.task ? { task: action.task } : {}),
      };
      return { ...state, entries: [...state.entries, entry], live: null };
    }
  }
}
