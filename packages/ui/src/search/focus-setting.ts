const CONTROLS = "input, select, textarea, button";

/** A control the person can use: not disabled, not inside a disabled fieldset. */
const usable = (el: HTMLElement): boolean => !el.hasAttribute("disabled") && el.closest("fieldset[disabled]") === null;

/**
 * Settings opened from search (§6): the row `id` gets focus (its first usable control, else the row itself) and the
 * 2 s flash. Its tab may still be loading: waits for the row to render, 2 s at most. Answers the cancel.
 */
export function focusSetting(root: HTMLElement, id: string, waitMs = 2000): () => void {
  const attempt = (): boolean => {
    const row = [...root.querySelectorAll<HTMLElement>("[data-setting]")].find((el) => el.dataset.setting === id);
    if (!row) return false;
    const control = [...row.querySelectorAll<HTMLElement>(CONTROLS)].find(usable);
    if (!control) row.tabIndex = -1;
    row.scrollIntoView?.({ block: "center" });
    (control ?? row).focus();
    row.classList.add("hh-search-flash");
    setTimeout(() => row.classList.remove("hh-search-flash"), 2000);
    return true;
  };
  if (attempt()) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    if (attempt()) stop();
  });
  function stop() {
    observer.disconnect();
    if (timer !== undefined) clearTimeout(timer);
  }
  observer.observe(root, { childList: true, subtree: true });
  timer = setTimeout(stop, waitMs);
  return stop;
}
