import { defineMod } from "@humanharness/mod-sdk";
import {
  type AnswerHold,
  type CoreUiCtx,
  type OverlayButtonProps,
  type OverlayPanelProps,
  type SidekickCard,
  type SidekickReview,
  type SidekickState,
  type TaskReviewer,
  type TaskViewValue,
  useApp,
  useTaskView,
} from "@humanharness/ui";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { FirstOpenOffer } from "./ui/PresetOffer";
import { SidekickButton, SidekickPanel, waitingCards } from "./ui/SidekickPanel";
import { useSidekick } from "./ui/useSidekick";

/** The overlay's name: named after the mod, so its element is `hh-overlay-sidekick`. */
const NAME = "sidekick";

type Queued = { key: string; text: string };
type Shared = { sk: SidekickState | null; later: Queued[]; droppedLive: string[] };

/**
 * What Sidekick's task-view pieces share in one run of its ui: its state (read by the task-bar piece), the asks kept
 * "For later", and the reviews in flight. The task-bar piece is always drawn while the chat is, so it reads the state
 * and registers the reviewer; the button and the panel draw from here.
 */
function createStore() {
  let shared: Shared = { sk: null, later: [], droppedLive: [] };
  const subs = new Set<() => void>();
  return {
    get: () => shared,
    set(patch: Partial<Shared>) {
      shared = { ...shared, ...patch };
      for (const fn of subs) fn();
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    /** The task view as last drawn: the reviewer acts on it. */
    tv: null as TaskViewValue | null,
    /** A composer review's number; an answer's, the composer's number when it started, and the form a card holds. */
    composerSeq: 0,
    answerSeq: 0,
    answerRun: null as { seq: number; composerSeq: number } | null,
    answerCard: null as string | null,
    answerHold: null as { cardId: string; hold: AnswerHold } | null,
    announced: new Set<string>(),
  };
}
type Store = ReturnType<typeof createStore>;

const quiet = () => undefined;

/** The card's spans to underline in the composer: the local flags' and the model's issues that point at the text. */
function cardSpans(card: SidekickCard): [number, number][] {
  return [...card.flags.map((f) => f.span), ...card.issues.flatMap((i) => (i.span ? [i.span] : []))];
}

/** The live card's queued asks, by key (`<card id>:<position>`), but those the person dropped. */
function liveQueued({ sk, droppedLive }: Shared): Queued[] {
  const card = sk?.card;
  return (card?.queued ?? []).map((text, at) => ({ key: `${card?.id}:${at}`, text })).filter((q) => !droppedLive.includes(q.key));
}

function actions(store: Store) {
  const tv = () => store.tv as TaskViewValue;
  /** Opens Sidekick's cards without taking focus (the panel never takes focus on its own). */
  const showCards = () => {
    tv().setSideView("own");
    tv().overlay.show(tv().overlayName(NAME, NAME), false);
  };
  const resolveCard = (card: SidekickCard, outcome: "used" | "edited" | "sent-anyway") => {
    // A card that was sent keeps its queued asks for later; Edit sends nothing, and the next review finds them again.
    const shared = store.get();
    const keep = liveQueued(shared);
    if (outcome !== "edited" && card.id === shared.sk?.card?.id && keep.length > 0) {
      store.set({ later: [...keep, ...shared.later.filter((q) => !keep.some((k) => k.key === q.key))] });
    }
    void tv().client.sidekick.resolve(card.id, outcome).catch(quiet);
  };
  /** The form a block card holds, while that card is the live one. */
  const heldBy = (card: SidekickCard): AnswerHold | null => {
    const held = store.answerHold;
    if (!held || held.cardId !== card.id) return null;
    store.answerHold = null;
    return held.hold;
  };
  /** Enter's review (spec §4.1): a card holds the draft and shows; anything else, a `cancelled` included, sends. */
  const reviewComposer = async (text: string, signal: AbortSignal, force: boolean): Promise<"send" | "hold"> => {
    const { client } = tv();
    store.composerSeq++;
    // Send now stops the review in main.
    signal.addEventListener("abort", () => void client.sidekick.cancelReview().catch(quiet), { once: true });
    // Material in the open scope goes with the prompt: the missing-context flag stays quiet.
    const attached = await tv().attached();
    if (signal.aborted) return "send";
    const r: SidekickReview = await client.sidekick
      .review({ text, ...(force ? { force: true } : {}), ...(attached ? { attached: true } : {}) })
      .catch(() => ({ kind: "error" }) as const);
    if (signal.aborted) return "send";
    if (r.kind !== "card") return "send";
    showCards();
    return "hold";
  };
  /**
   * A block answer's free text before it goes (spec §4.1): a card holds the form. The same text sent again while its
   * card waits goes as is (the card leaves as sent anyway).
   */
  const reviewAnswer = async (text: string, signal: AbortSignal): Promise<"send" | "hold"> => {
    const { client } = tv();
    const held = store.answerHold;
    const card = store.get().sk?.card;
    if (held && card?.id === held.cardId && card.prompt === text) {
      store.answerHold = null;
      resolveCard(card, "sent-anyway");
      return "send";
    }
    const seq = ++store.answerSeq;
    const composerSeq = store.composerSeq;
    store.answerRun = { seq, composerSeq };
    // Send now on the answer form: stops its review in main, never a composer review that started since.
    signal.addEventListener(
      "abort",
      () => {
        const run = store.answerRun;
        store.answerRun = null;
        store.answerSeq++;
        if (run && run.composerSeq === store.composerSeq) void client.sidekick.cancelReview().catch(quiet);
      },
      { once: true },
    );
    const r: SidekickReview = await client.sidekick.review({ text, block: true }).catch(() => ({ kind: "error" }) as const);
    if (store.answerRun?.seq === seq) store.answerRun = null;
    // Stopped by Send now (the form already sent), or replaced by a composer review in main: a card that came anyway
    // is about an answer that went, and leaves as sent anyway.
    if (seq !== store.answerSeq || composerSeq !== store.composerSeq || r.kind !== "card") {
      if (r.kind === "card") void client.sidekick.resolve(r.card.id, "sent-anyway").catch(quiet);
      return "send";
    }
    store.answerCard = r.card.id;
    showCards();
    return "hold";
  };
  /** The held form, tied to its card; Skip on it drops the card with the answer. */
  const holdAnswer = (hold: AnswerHold) => {
    const cardId = store.answerCard;
    store.answerCard = null;
    if (!cardId) return undefined;
    store.answerHold = { cardId, hold };
    return () => {
      if (store.answerHold?.cardId !== cardId) return;
      store.answerHold = null;
      void tv().client.sidekick.resolve(cardId, "dismissed").catch(quiet);
    };
  };
  return { tv, showCards, resolveCard, heldBy, reviewComposer, reviewAnswer, holdAnswer };
}
type Actions = ReturnType<typeof actions>;

const useShared = (store: Store) => useSyncExternalStore(store.subscribe, store.get);

/**
 * Sidekick's piece in the task bar (sidekick spec §7): its toggle, once its state is there. Drawn whenever the chat is,
 * it also reads that state, registers the reviewer, holds the harness's side panel in its overlay and announces cards.
 */
function TaskBarPiece({ ctx, store, act }: { ctx: CoreUiCtx; store: Store; act: Actions }) {
  const { t } = useTranslation();
  const tv = useTaskView();
  store.tv = tv;
  // Only when main sends `state.sidekick`, never in slim mode (D0).
  const enabled = tv.state.sidekick !== undefined && !tv.slim;
  const sk = useSidekick(tv.client, enabled, tv.refresh);
  useEffect(() => store.set({ sk }), [sk]);
  const name = tv.overlayName(NAME, NAME);

  // The reviewer, registered once from the first render (the composer's field is never remounted under the cursor, and
  // its place among the mods' reviewers stays): the backdrop with the live card's spans; it reviews only while Sidekick
  // is on and reviews before sending. It reads the state from the store, and says when it changes.
  useEffect(() => {
    if (!enabled) return;
    const sk = () => store.get().sk;
    const reviewer: TaskReviewer = {
      name: "Sidekick",
      ownWait: true,
      get reviews() {
        const s = sk();
        return s !== null && s.settings.on && s.settings.preSend;
      },
      get wait() {
        return sk()?.settings.wait;
      },
      marks: (draft) => {
        const s = sk();
        return s?.card && s.settings.on && s.card.prompt === draft ? cardSpans(s.card) : [];
      },
      review: (text, signal, o) => (o.answer ? act.reviewAnswer(text, signal) : act.reviewComposer(text, signal, o.force)),
      sent: () => {
        const card = sk()?.card;
        if (card) act.resolveCard(card, "sent-anyway");
      },
      holdAnswer: act.holdAnswer,
      subscribe: store.subscribe,
    };
    return ctx.composer(reviewer);
  }, [enabled]);

  // Sidekick's overlay holds the harness's side panel: not in a window too narrow for it.
  const shown = sk !== null && !tv.narrow && !tv.slim;
  useEffect(() => {
    tv.hostSide(shown ? name : null);
    return () => tv.hostSide(null);
  }, [shown]);

  // The asks kept "For later" belong to the task: another task (or none) starts with none. The first send opening a
  // task keeps them.
  const lastTask = useRef(tv.task);
  useEffect(() => {
    const was = lastTask.current;
    lastTask.current = tv.task;
    if (was !== null && was !== tv.task) store.set({ later: [] });
  }, [tv.task]);
  // The live card's dropped asks belong to it: another card starts with none dropped.
  const cardId = sk?.card?.id;
  useEffect(() => {
    if (store.get().droppedLive.length) store.set({ droppedLive: [] });
  }, [cardId]);

  // Each new card is announced once (spec §7 accessibility), heads-ups and other moments too; the panel never takes focus.
  const waiting = sk ? waitingCards(sk) : [];
  const waitingIds = waiting.map((c) => c.id).join(" ");
  const waitingRef = useRef(waiting);
  waitingRef.current = waiting;
  useEffect(() => {
    const fresh = waitingRef.current.filter((c) => !store.announced.has(c.id));
    for (const c of fresh) store.announced.add(c.id);
    // The live pre-send card says the most; else the newest other card, by who speaks.
    const card = fresh.find((c) => c.id === cardId) ?? fresh.at(-1);
    if (!card) return;
    tv.announce(card.id === cardId ? t("sidekick.card.announce") : t("sidekick.card.announceFrom", { name: card.speaker.name }));
  }, [waitingIds, cardId, t]);

  if (!sk) return null;
  const on = sk.settings.on;
  return (
    <button
      type="button"
      className="hh-sk-toggle hh-pill"
      data-on={on}
      aria-label={t(on ? "sidekick.toggleOn" : "sidekick.toggleOff")}
      onClick={() => {
        const next = !on;
        void tv.client.sidekick.set(next ? { on: next, introSeen: true } : { on: next }).catch(quiet);
        if (next && !tv.narrow) tv.overlay.show(name);
        else if (tv.overlay.open === name) tv.overlay.hide();
      }}
    >
      <span className="hh-dot" aria-hidden="true" />
      {t("sidekick.toggle")}
    </button>
  );
}

/** The bar's button that opens Sidekick's overlay. */
function OverlayButton({ store, ...p }: OverlayButtonProps & { store: Store }) {
  const { sk } = useShared(store);
  if (!sk) return null;
  return <SidekickButton state={sk} expanded={p.expanded} controls={p.controls} onOpen={p.onOpen} buttonRef={p.buttonRef} />;
}

/** Sidekick's overlay: its cards, or the harness's side panel (spec §7). */
function OverlayPanel({ close, store, act }: OverlayPanelProps & { store: Store; act: Actions }) {
  const shared = useShared(store);
  const tv = useTaskView();
  const app = useApp();
  const { sk } = shared;
  if (!sk) return null;
  const { client } = tv;
  const { resolveCard, heldBy } = act;
  return (
    <SidekickPanel
      state={sk}
      view={tv.harnessSide !== undefined && tv.sideView === "harness" ? "harness" : "sidekick"}
      onView={(v) => tv.setSideView(v === "harness" ? "harness" : "own")}
      {...(tv.harnessSide !== undefined ? { harnessSide: tv.harnessSide } : {})}
      sendKey={tv.sendKey}
      onCollapse={close}
      offer={<FirstOpenOffer client={client} offered={sk.settings.presetsOffered} />}
      onMute={(id) => void client.sidekick.mute(id).catch(quiet)}
      onDismiss={(id, outcome) => void client.sidekick.resolve(id, outcome).catch(quiet)}
      onSaveDecision={(id) => client.sidekick.saveDecision(id)}
      // The heads-up leaves as used only when the closing turn really started.
      onFinishTask={(id) => {
        if (tv.finishTask()) void client.sidekick.resolve(id, "used").catch(quiet);
      }}
      queued={[...liveQueued(shared), ...shared.later]}
      onDropQueued={(key) => {
        const now = store.get();
        store.set({ later: now.later.filter((q) => q.key !== key), droppedLive: [...now.droppedLive, key] });
      }}
      onTier={() => app.nav.open({ kind: "command", command: "open-settings", arg: "sidekick" })}
      onTurnOn={() => void client.sidekick.set({ on: true, introSeen: true }).catch(quiet)}
      onNotNow={() => {
        void client.sidekick.set({ introSeen: true }).catch(quiet);
        close();
      }}
      // A suggestion goes through `send`, never a review: it is never reviewed again.
      // The card leaves only once the send went: a refused one keeps the rewrite.
      onSendSuggested={(card) => {
        // A block answer's rewrite goes to the composer: the person sends it, or copies it into the form.
        if (card.block) {
          heldBy(card);
          resolveCard(card, "used");
          if (card.rewrite) tv.setDraft(card.rewrite);
          tv.focusComposer();
          return;
        }
        if (!card.rewrite || !tv.send(card.rewrite)) return;
        tv.setDraft("");
        resolveCard(card, "used");
      }}
      onEdit={(card) => {
        if (card.block) {
          const hold = heldBy(card);
          resolveCard(card, "edited");
          hold?.focus();
          return;
        }
        resolveCard(card, "edited");
        tv.setDraft(card.rewrite ?? card.prompt);
        tv.focusComposer();
      }}
      onSendAnyway={(card) => {
        // A block answer's card sends its form as it is, unreviewed.
        if (card.block) {
          const held = store.answerHold;
          if (held?.cardId === card.id) {
            // The form it held is gone (another task) or can't send now: nothing went, the card stays.
            if (!held.hold.anyway()) return;
            store.answerHold = null;
          }
          resolveCard(card, "sent-anyway");
          return;
        }
        if (!tv.send(card.prompt)) return;
        tv.setDraft("");
        resolveCard(card, "sent-anyway");
      }}
      onPutInComposer={(text) => {
        tv.setDraft(text);
        tv.focusComposer();
      }}
    />
  );
}

/**
 * Sidekick's task-view UI (minimal-core step 1b): the toggle in the task bar, the overlay with its cards, and the
 * composer's review. It calls main through the core's `client.sidekick` channels.
 */
export default defineMod({
  id: "sidekick",
  ui(base) {
    // A core mod: the window's own loader gives it the core's ctx, with the task view's slots.
    const ctx = base as unknown as CoreUiCtx;
    const store = createStore();
    const act = actions(store);
    ctx.taskBar(() => <TaskBarPiece ctx={ctx} store={store} act={act} />);
    ctx.taskOverlay({
      name: NAME,
      bare: true,
      button: (p: OverlayButtonProps) => <OverlayButton {...p} store={store} />,
      panel: (p: OverlayPanelProps) => <OverlayPanel {...p} store={store} act={act} />,
    });
  },
});
