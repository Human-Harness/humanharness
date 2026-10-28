import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_LANGUAGE, type Language, canonicalLanguage, languageName, offeredLanguage, pickerLanguages } from "@humanharness/harness-sdk/language";
import type { LanguageState } from "./client";
import { ownName } from "./language";
import { useDialogKeys } from "./focus";

/** English and its variants (en-GB) need no translation: main answers them with the bundled English. */
const isEnglish = (tag: Language) => tag === DEFAULT_LANGUAGE || tag.startsWith(`${DEFAULT_LANGUAGE}-`);

/** Whether `tag` can be used without a translation run: English, or a complete cached translation. Tags compare canonical. */
export const readyLanguage = (view: LanguageState, tag: Language): boolean => {
  const want = canonicalLanguage(tag);
  if (!want) return false;
  return isEnglish(want) || view.cached.some((c) => c.complete && canonicalLanguage(c.tag) === want);
};

/**
 * The language picker (spec §2, §3): each language by its own name, its English name under it. Languages that need a
 * translation are disabled while none can run (no engine, mock mode), with the reason (Q3: English and complete ones
 * stay pickable). The saved language can be picked again while it still has English texts, to finish its translation.
 * Search filters by either name. While `onPick`'s promise is pending the choices are off, so two clicks can't race.
 * Modal: Tab stays inside, Escape closes (and doesn't reach the sheet), focus goes back to the opener.
 */
export function LanguagePicker({
  current,
  suggested,
  view,
  onPick,
  onClose,
  error = null,
}: {
  current: Language;
  suggested?: Language;
  view: LanguageState;
  onPick: (tag: Language) => void | Promise<unknown>;
  onClose: () => void;
  /** Why the last pick didn't work, shown inside the dialog. */
  error?: string | null;
}) {
  const { t } = useTranslation();
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  // Saved, cached and suggested tags may come in another case ("pt-br"): pickerLanguages drops non-canonical ones.
  const now = canonicalLanguage(current) ?? DEFAULT_LANGUAGE;
  // Only an offered suggestion (canonical, left to right, D9) is listed and preselected: "ar" never is.
  const canonicalHint = suggested === undefined ? null : canonicalLanguage(suggested);
  const hint = canonicalHint && offeredLanguage(canonicalHint) ? canonicalHint : null;
  const usable = (tag: Language) => view.canTranslate === true || readyLanguage(view, tag);
  const [picked, setPicked] = useState<Language>(() => (hint && usable(hint) ? hint : now));
  const cachedKey = view.cached.map((c) => c.tag).join(" ");
  const all = useMemo(
    () => pickerLanguages([now, ...(hint ? [hint] : []), ...cachedKey.split(" ").flatMap((tag) => canonicalLanguage(tag) ?? [])]),
    [now, hint, cachedKey],
  );
  const names = useMemo(() => new Map(all.map((tag) => [tag, { own: ownName(tag), english: languageName(tag) }])), [all]);
  const q = query.trim().toLocaleLowerCase();
  const shown = q ? all.filter((tag) => names.get(tag)!.own.toLocaleLowerCase().includes(q) || names.get(tag)!.english.toLocaleLowerCase().includes(q)) : all;
  // The saved language with English texts left: picking it again finishes its translation (main answers needs-translation).
  // `missing` is about view.language: it counts only when that is the language shown as current here.
  const unfinished = (tag: Language) =>
    tag === now && canonicalLanguage(view.language) === now && !isEnglish(tag) && view.missing > 0 && view.canTranslate === true;
  const canUse = !pending && offeredLanguage(picked) && usable(picked) && (picked !== now || unfinished(picked));

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    search.current?.focus();
    return () => {
      if (opener?.isConnected && opener.closest("[inert]") === null) opener.focus();
    };
  }, []);
  useDialogKeys(dialog, onClose);

  const use = () => {
    if (pendingRef.current || !canUse) return;
    const r = onPick(picked);
    if (!(r instanceof Promise)) return;
    pendingRef.current = true;
    setPending(true);
    const done = () => {
      pendingRef.current = false;
      setPending(false);
    };
    r.then(done, done);
  };

  return (
    <div className="hh-langpick-backdrop" onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}>
      <div
        ref={dialog}
        className="hh-langpick"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-busy={pending || undefined}
      >
        <h2 id={`${id}-title`}>{t("language.pickTitle")}</h2>
        <input ref={search} type="search" aria-label={t("language.search")} placeholder={t("language.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        {view.canTranslate !== true && (
          <p id={`${id}-reason`} className="hh-caption hh-langpick-reason">
            {t("language.needsEngine")}
          </p>
        )}
        {shown.length === 0 && <p className="hh-caption hh-langpick-none">{t("language.noMatch")}</p>}
        <div
          className="hh-langpick-list"
          role="radiogroup"
          aria-labelledby={`${id}-title`}
          aria-describedby={view.canTranslate !== true ? `${id}-reason` : undefined}
        >
          {shown.map((tag) => (
            <label key={tag} className="hh-langpick-option">
              <input type="radio" name={`${id}-lang`} value={tag} checked={picked === tag} disabled={pending || !usable(tag)} onChange={() => setPicked(tag)} />
              <span className="hh-langpick-name" lang={tag}>
                {names.get(tag)!.own}
              </span>
              <span className="hh-caption hh-langpick-english" lang="en">{names.get(tag)!.english}</span>
              {!isEnglish(tag) && readyLanguage(view, tag) && <span className="hh-langpick-ready">{t("language.ready")}</span>}
            </label>
          ))}
        </div>
        {error && (
          <p className="hh-save-error" role="alert">
            {error}
          </p>
        )}
        <div className="hh-langpick-actions">
          <button type="button" onClick={onClose}>
            {t("language.cancel")}
          </button>
          <button type="button" className="hh-primary" disabled={!canUse} onClick={use}>
            {t("language.use")}
          </button>
        </div>
      </div>
    </div>
  );
}
