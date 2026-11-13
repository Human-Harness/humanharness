import { useEffect, useState } from "react";
import type { HarnessClient, HomeChange, LayoutView, ModReview, ModsView } from "../client";

export interface ModsState {
  view: ModsView | null;
  /** The first read was refused and no push came since. */
  failed: boolean;
  set(id: string, on: boolean): Promise<void>;
  /** Main shows the folder dialog: a review and its one-time token, why the folder isn't a mod, or null (cancelled). */
  review(): Promise<{ review: ModReview; token: string } | { problem: string } | null>;
  /**
   * Turns a mod on; a mod in the app's home folder the person hasn't reviewed is refused, and then answers its
   * review instead (the warning comes first, spec D2). Null: it is on.
   */
  turnOn(id: string): Promise<{ review: ModReview; token: string } | null>;
  add(token: string): Promise<void>;
  remove(id: string): Promise<void>;
}

/**
 * Settings › Mods (minimal-core spec §4, §6), live: one read, then main's pushes (a push before the read wins). Each
 * action replaces the view with main's answer.
 */
export function useMods(client: HarnessClient): ModsState {
  const [view, setView] = useState<ModsView | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let pushed = false;
    const off = client.mods.onChanged((v) => {
      pushed = true;
      if (!live) return;
      setView(v);
      setFailed(false);
    });
    client.mods.view().then(
      (v) => {
        if (live && !pushed) setView(v);
      },
      () => {
        if (live && !pushed) setFailed(true);
      },
    );
    return () => {
      live = false;
      off();
    };
  }, [client]);
  return {
    view,
    failed,
    set: async (id, on) => setView(await client.mods.set(id, on)),
    review: () => client.mods.reviewLocal(),
    turnOn: async (id) => {
      try {
        setView(await client.mods.set(id, true));
        return null;
      } catch (err) {
        // Main refuses an unreviewed home-folder mod; any other refusal has no review either and stays an error.
        const r = await client.mods.reviewLocal(id);
        if (r && "review" in r) return r;
        throw err;
      }
    },
    add: async (token) => setView(await client.mods.addLocal(token)),
    remove: async (id) => setView(await client.mods.removeLocal(id)),
  };
}

export interface LayoutPickState {
  /** Null until the first read answers; also when this app has no layout channel. */
  view: LayoutView | null;
  /** Picks a layout by name (null: the default); the view becomes main's answer. */
  pick(name: string | null): Promise<void>;
}

/** Settings › Mods › Layout (0b2), live: one read, then every `hh:layoutChanged` (a change before the read wins). */
export function useLayoutPick(client: Pick<HarnessClient, "layout" | "layoutPick" | "onLayoutChanged">): LayoutPickState {
  const [view, setView] = useState<LayoutView | null>(null);
  useEffect(() => {
    if (!client.layout) return;
    let live = true;
    let changed = false;
    const off = client.onLayoutChanged?.((v) => {
      changed = true;
      if (live) setView(v);
    });
    client.layout().then(
      (v) => {
        if (live && !changed) setView(v);
      },
      () => undefined,
    );
    return () => {
      live = false;
      off?.();
    };
  }, [client]);
  return {
    view,
    pick: async (name) => {
      if (!client.layoutPick) return;
      setView(await client.layoutPick(name));
    },
  };
}

export interface HomeHistoryState {
  /** False when this app has no home history channel; then there is no row. */
  has: boolean;
  /** The last change, or null before the first read answers and when there is none. */
  last: HomeChange | null;
  /** Undoes the last change; the state becomes main's answer. */
  undo(): Promise<void>;
}

/** Settings › Mods › Undo (0b2), live: one read, then every `hh:homeHistoryChanged` (a change before the read wins). */
export function useHomeHistory(client: Pick<HarnessClient, "homeHistory" | "homeUndo" | "onHomeHistory">): HomeHistoryState {
  const [last, setLast] = useState<HomeChange | null>(null);
  useEffect(() => {
    if (!client.homeHistory) return;
    let live = true;
    let changed = false;
    const off = client.onHomeHistory?.((c) => {
      changed = true;
      if (live) setLast(c);
    });
    client.homeHistory().then(
      (c) => {
        if (live && !changed) setLast(c);
      },
      () => undefined,
    );
    return () => {
      live = false;
      off?.();
    };
  }, [client]);
  return {
    has: client.homeHistory !== undefined && client.homeUndo !== undefined,
    last,
    undo: async () => {
      if (!client.homeUndo) return;
      const c = await client.homeUndo();
      if (c) setLast(c);
    },
  };
}
