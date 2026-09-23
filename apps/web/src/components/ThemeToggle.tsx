"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

/**
 * Cycles light → dark → system. The chosen theme is written to
 * <html data-theme> and persisted in localStorage; "system" removes the
 * attribute so the prefers-color-scheme media query takes over. The inline
 * script in the root layout applies the stored theme before paint to avoid a
 * flash, so this component only has to keep it in sync afterwards.
 */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("hal-theme", theme);
  } catch {
    /* private mode / blocked storage — ignore */
  }
}

const ICON: Record<Theme, string> = {
  // sun
  light:
    "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4",
  // moon
  dark: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z",
  // monitor
  system: "M3 4h18v12H3zM8 20h8M12 16v4",
};
const NEXT: Record<Theme, Theme> = { light: "dark", dark: "system", system: "light" };
const TITLE: Record<Theme, string> = {
  light: "Theme: light — click for dark",
  dark: "Theme: dark — click for system",
  system: "Theme: system — click for light",
};

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    let stored: Theme = "system";
    try {
      stored = (localStorage.getItem("hal-theme") as Theme) ?? "system";
    } catch {
      /* ignore */
    }
    setTheme(stored);
  }, []);

  function cycle() {
    const next = NEXT[theme];
    setTheme(next);
    applyTheme(next);
  }

  return (
    <button type="button" className="theme-toggle" onClick={cycle} title={TITLE[theme]} aria-label={TITLE[theme]}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {theme === "dark" ? (
          <path d={ICON.dark} />
        ) : theme === "light" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d={ICON.light} />
          </>
        ) : (
          <path d={ICON.system} />
        )}
      </svg>
    </button>
  );
}
