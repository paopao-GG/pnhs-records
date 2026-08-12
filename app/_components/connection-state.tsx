"use client";

import { useEffect } from "react";
import { useConnState } from "./online-store.ts";

/**
 * Connection state, mounted permanently in the masthead.
 *
 * Not a toast. A toast tells you once, while you are looking somewhere else, and then removes
 * the only evidence that it said anything. Whether this screen is talking to the server or
 * showing a copy of it decides whether an edit will be kept, so it stays on screen.
 */
export function ConnectionState() {
  const state = useConnState();

  return (
    <span
      className="conn"
      data-state={state}
      title={
        state === "live"
          ? "Connected. Changes save to the server as you make them."
          : "Showing a saved copy. Records stay readable; editing is unavailable until the connection is back."
      }
    >
      {state === "live" ? "Live" : "Cached"}
    </span>
  );
}

/**
 * The freshness line on a page being served from cache.
 *
 * `renderedAt` is stamped by the server when it built the HTML. If this page came out of the
 * cache, that timestamp is exactly when the copy was made — which is the fact the reader needs
 * and the word "offline" on its own does not carry. A grade encoded after that time is not in
 * front of them, and they should be able to work out whether that matters.
 */
export function CachedNotice({ renderedAt }: { renderedAt: string }) {
  const state = useConnState();
  if (state === "live") return null;

  const when = new Date(renderedAt);
  const stamp = when.toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });

  return (
    <div className="freshness" role="status">
      <strong>Saved copy</strong>
      <span>·</span>
      <span>as of {stamp}</span>
      <span className="spacer" />
      <span>Editing unavailable</span>
    </div>
  );
}

/**
 * Registers the service worker.
 *
 * Kept out of the connection indicator so that a registration failure — an unsupported
 * browser, a blocked scope, plain HTTP — costs the indicator nothing. `navigator.onLine` still
 * works without a service worker, so the app degrades to a slightly less accurate signal
 * rather than to a broken one.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Registration is not urgent and competes with the first paint for bandwidth.
    const id = setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* No offline support here. Every other part of the app is unaffected. */
      });
    }, 1200);

    return () => clearTimeout(id);
  }, []);

  return null;
}

/**
 * Sign out, clearing the cached pages first.
 *
 * These machines are shared. Without this, signing out leaves every record the last person
 * opened sitting in the cache, readable offline by whoever sits down next — a session ends but
 * the copies do not.
 */
export function SignOutButton() {
  return (
    <button
      className="btn"
      data-variant="ghost"
      onClick={() => {
        navigator.serviceWorker?.controller?.postMessage({ type: "purge" });
      }}
    >
      Sign out
    </button>
  );
}
