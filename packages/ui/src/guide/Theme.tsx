import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { type ReactNode, useEffect, useState } from "react";

const DARK = "(prefers-color-scheme: dark)";

/**
 * True while the system is dark. The shell sets nativeTheme from the app's appearance setting, and the --hh-* tokens
 * follow only this media query, so Radix must follow it too, not the config (the spike's first bug was that mismatch).
 */
export function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => typeof matchMedia === "function" && matchMedia(DARK).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia(DARK);
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    setDark(media.matches);
    media.addEventListener("change", on);
    return () => media.removeEventListener("change", on);
  }, []);
  return dark;
}

/** The app's one Radix Themes root (Radix + Impeccable spec §3). It draws no box; the bridge is in styles.css. */
export function HhTheme({ children }: { children: ReactNode }) {
  const dark = useSystemDark();
  return (
    <Theme className="hh-theme" accentColor="amber" grayColor="sand" radius="large" appearance={dark ? "dark" : "light"} hasBackground={false}>
      {children}
    </Theme>
  );
}
