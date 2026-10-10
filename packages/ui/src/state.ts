import type { ChatEntry, Event, LimitWindow } from "./client";

export interface LiveActivity {
  id: string;
  kind: ChatEntry["activities"][number]["kind"];
  detail: string;
  done: boolean;
  error?: boolean;
}

export interface LiveTurn {
  text: string;
  blocks: { name: string; data: unknown }[];
  activities: LiveActivity[];
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

export type ChatAction = Event | { type: "user"; text: string; at: string } | { type: "loaded"; entries: ChatEntry[] }
  /** A local assistant message that the UI shows but never saves. */
  | { type: "notice"; text: string; at: string };

export function initialChat(entries: ChatEntry[], stateBlocks: string[] = []): ChatState {
  return { entries, live: null, blockState: {}, stateBlocks: new Set(stateBlocks), limits: null };
}

const newId = () => Math.random().toString(36).slice(2);

export function reduceChat(state: ChatState, action: ChatAction): ChatState {
  const live = state.live;
  switch (action.type) {
    case "loaded":
      return { ...state, entries: [...action.entries, ...state.entries.filter((e) => !action.entries.some((s) => s.id === e.id))] };
    case "notice":
      return {
        ...state,
        entries: [...state.entries, { id: newId(), role: "assistant", text: action.text, blocks: [], activities: [], at: action.at }],
      };
    case "user":
      return {
        ...state,
        entries: [...state.entries, { id: newId(), role: "user", text: action.text, blocks: [], activities: [], at: action.at }],
        live: { text: "", blocks: [], activities: [] },
      };
    case "text":
      return live ? { ...state, live: { ...live, text: live.text + action.delta } } : state;
    case "paragraph":
      return live && live.text ? { ...state, live: { ...live, text: `${live.text}\n\n` } } : state;
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
      if (state.stateBlocks.has(action.name)) return { ...state, blockState: { ...state.blockState, [action.name]: action.data } };
      return live ? { ...state, live: { ...live, blocks: [...live.blocks, { name: action.name, data: action.data }] } } : state;
    case "limits":
      return { ...state, limits: action.windows };
    case "usage":
      return state;
    case "done": {
      if (!live) return state;
      const entry: ChatEntry = {
        id: newId(),
        role: "assistant",
        text: live.text.trim(),
        blocks: live.blocks,
        activities: live.activities.map(({ kind, detail }) => ({ kind, detail })),
        at: new Date().toISOString(),
        ...(action.ok ? {} : { error: action.error }),
      };
      return { ...state, entries: [...state.entries, entry], live: null };
    }
  }
}
