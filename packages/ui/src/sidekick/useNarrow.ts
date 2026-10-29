import { useEffect, useState } from "react";

/** The width under which the Sidekick panel and rail hide (styles.css `.hh-sk-panel, .hh-sk-rail`). */
const NARROW = "(max-width: 720px)";

function matches(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(NARROW).matches;
}

/** True while the window is too narrow for the Sidekick panel, live. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(NARROW);
    const onChange = () => setNarrow(query.matches);
    onChange();
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return narrow;
}
