"use client";

import { useEffect, useState } from "react";

export const THEME_KEY = "pnhs-theme";

/**
 * The colour scheme the app paints when nothing has been chosen.
 *
 * Light, unconditionally — the OS preference is deliberately not consulted. These are shared
 * office machines, and a laptop that dims itself in the evening would otherwise hand the next
 * person a different-looking app than the one beside them. One default, one switch.
 */
export const DEFAULT_THEME = "light";

/** Kept beside the toggle so the meta tag and the palette cannot drift apart. */
const THEME_COLOR = { light: "#ffffff", dark: "#1c2024" } as const;

type Theme = keyof typeof THEME_COLOR;

/**
 * Runs before the first paint, inlined into <head> by the root layout.
 *
 * It has to be a blocking inline script rather than an effect: the layout is a server
 * component, so by the time React could set this the browser has already painted a light page,
 * and anyone who chose dark would see it flash white on every navigation.
 *
 * Written as a string because that is the only form `dangerouslySetInnerHTML` accepts. The
 * localStorage read is wrapped because it throws outright in a browser with site data blocked,
 * and an exception here would abort parsing of the rest of the document.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

/**
 * The light/dark switch, mounted in the masthead on every page including sign-in.
 *
 * The choice lives in localStorage rather than a cookie on purpose: it is a display preference,
 * it never needs to reach the server, and keeping it out of the cookie jar means signing out —
 * which purges the service worker's page cache — does not also reset how the app looks for the
 * next person to sit down.
 */
export function ThemeToggle() {
  /*
   * Both of these start at the value the server rendered, so hydration matches exactly and the
   * button needs no `suppressHydrationWarning` of its own. `ready` is what holds the icon on the
   * moon until the effect has read the real theme off <html> — after that it is an ordinary
   * state update, not a mismatch. The page itself was already painted in the right colours by
   * THEME_SCRIPT well before any of this ran; only the icon is catching up.
   */
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    setTheme(current);
    setReady(true);
    /*
     * The meta tag is server-rendered with the light value and THEME_SCRIPT does not touch it,
     * so on a reload in dark mode the address bar would otherwise stay white. Syncing it here
     * rather than in the script keeps the colours in one file — and the browser chrome is not
     * on the critical path of the first paint the way the page background is.
     */
    setThemeColor(current);
  }, []);

  const next: Theme = theme === "dark" ? "light" : "dark";

  function apply() {
    const root = document.documentElement;

    if (next === DEFAULT_THEME) {
      delete root.dataset.theme;
    } else {
      root.dataset.theme = next;
    }

    // A browser with site data blocked throws on write as well as on read.
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* The switch still works for this page load; it just will not be remembered. */
    }

    setThemeColor(next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={apply}
      aria-pressed={theme === "dark"}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {ready && theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

/** The address bar and the phone status bar are painted from this, not from the stylesheet. */
function setThemeColor(theme: Theme): void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
}

/* Drawn inline, like every other mark in this app — nothing is fetched at runtime. */

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4.1" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4 17 7M7 17l-1.6 1.6M18.6 18.6 17 17M7 7 5.4 5.4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
