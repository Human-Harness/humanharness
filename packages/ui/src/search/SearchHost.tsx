import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppState, HarnessClient, SearchHitView } from "../client";
import type { SearchIntent } from "./intent";
import { SearchPalette, isMod } from "./SearchPalette";

/**
 * ⌘K (Ctrl+K off macOS) anywhere in the window, and `client.search.open()` (the top bar's button, a harness view):
 * the palette (search spec §5.1). ⌘K again or Esc closes it and gives focus back.
 */
export function SearchHost({ client, state, openScope, onIntent }: { client: HarnessClient; state: AppState; openScope: string | null; onIntent: (intent: SearchIntent) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<{ query: string; n: number } | null>(null);
  const isOpen = useRef(false);
  isOpen.current = open !== null;
  const opener = useRef<HTMLElement | null>(null);
  const opens = useRef(0);
  const [scopeTitle, setScopeTitle] = useState<string | null>(null);

  const show = useCallback((query = "") => {
    const active = document.activeElement;
    if (!isOpen.current) opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setOpen({ query, n: ++opens.current });
  }, []);
  const close = useCallback(() => {
    setOpen(null);
    const back = opener.current;
    opener.current = null;
    if (back?.isConnected) back.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || e.altKey || e.shiftKey || !isMod(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (isOpen.current) close();
      else show();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [show, close]);
  useEffect(() => client.search.onOpen((q) => show(typeof q === "string" ? q : "")), [client, show]);
  // A profile switch closes search (§7).
  const profile = state.config.profile;
  useEffect(() => {
    setOpen(null);
  }, [profile]);
  // "<scope> + app" names the open scope by its title.
  const shown = open !== null;
  useEffect(() => {
    if (!shown || !state.scopes || !openScope) return setScopeTitle(null);
    let live = true;
    client.scopes.list().then(
      (list) => {
        if (live) setScopeTitle(list.find((s) => s.id === openScope)?.title ?? openScope);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [client, shown, state.scopes, openScope]);

  if (!open) return null;
  const where = state.scopes && openScope ? t("search.whereScope", { scope: scopeTitle ?? openScope }) : t("search.where", { name: state.harness.name });
  /** A picked result: focus goes to what it opens, not back to the opener. */
  const leave = () => {
    setOpen(null);
    opener.current = null;
  };
  const pick = (hit: SearchHitView) => {
    void client.search.opened(hit);
    leave();
    if (hit.target.kind !== "reveal" && hit.target.kind !== "none") onIntent(hit.target);
  };
  return (
    <SearchPalette
      key={open.n}
      client={client}
      initialQuery={open.query}
      where={where}
      {...(state.scopes ? { scopesPlural: state.scopes.plural } : {})}
      references={(state.references?.length ?? 0) > 0}
      harnessName={state.harness.name}
      onClose={close}
      onPick={pick}
      onAsk={(text) => {
        leave();
        onIntent({ kind: "draft", text });
      }}
    />
  );
}
