"use client";

// Light or dark (spec 17.2). The app opens light; dark is a choice in Settings, kept on this device.
// The landing page and legal pages always stay light. The same key is read by the inline script in
// web/src/app/layout.tsx so a dark choice applies before the first paint.
import { useEffect, useState, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
const KEY = "openstudy.theme";

export function readTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function apply(theme: Theme) {
  if (theme === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
}

/** Keeps <html data-theme> in step with the saved choice while app pages are mounted. */
export function useAppTheme(): void {
  useEffect(() => {
    apply(readTheme());
    return () => apply("light");
  }, []);
}

const noSubscribe = () => () => {};

export function useThemeSetting(): [Theme, (t: Theme) => void] {
  // Read after hydration: the server can't see this device's choice.
  const stored = useSyncExternalStore(noSubscribe, readTheme, () => "light" as Theme);
  const [chosen, setChosen] = useState<Theme | null>(null);
  const setTheme = (t: Theme) => {
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* storage unavailable: the choice lasts for this visit */
    }
    apply(t);
    setChosen(t);
  };
  return [chosen ?? stored, setTheme];
}
