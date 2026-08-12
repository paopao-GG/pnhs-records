"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the app is talking to the server, shared by every component that asks.
 *
 * A module-level store rather than a hook that binds its own listeners: the encoding grid can
 * hold two hundred grade cells, and each of them needs to know whether editing is available.
 * Two window listeners for the whole page, not four hundred.
 *
 * Two signals feed it, because one is not enough:
 *
 * 1. `navigator.onLine`, which reports whether a network interface is up. It is the fast
 *    signal and it is also a liar — it says "online" on a school LAN whose uplink is dead, and
 *    it says "online" when Vercel is returning 500s.
 * 2. A message from the service worker, sent whenever it has had to answer a navigation from
 *    cache because the network did not. That is the signal that actually means "you are
 *    looking at a copy", and it catches the case `navigator.onLine` misses entirely — the
 *    network is fine and the server is not.
 *
 * Anything that reports being offline is believed immediately, and getting back is proved
 * rather than assumed — see the probe below.
 */

export type ConnState = "live" | "cached";

/** How often to re-check while offline. Only ever runs in the offline state. */
const PROBE_MS = 4000;

let state: ConnState = "live";
let probe: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function set(next: ConnState) {
  if (state === next) return;
  state = next;
  for (const l of listeners) l();

  if (next === "cached") startProbe();
  else stopProbe();
}

/*
 * The recovery path, and the reason it cannot be left out.
 *
 * The offline state disables every grade cell on the page. If the only way back were an
 * `online` event, then one failed request — a dropped packet, a server restart, a redeploy —
 * would leave a registrar sitting on the encoding grid with every field dead and no event
 * coming, because the browser never thought it was offline in the first place. They would have
 * to know to reload. That is a far worse failure than a briefly wrong indicator.
 *
 * So the offline state proves its own way out: a 204 every four seconds until one lands. It
 * runs only while offline, so a healthy session pays nothing for it.
 */
function startProbe() {
  if (probe !== null || typeof window === "undefined") return;

  probe = setInterval(() => {
    // A fresh query string as well as `no-store`: an intermediate proxy that ignores the header
    // would otherwise answer the probe itself and report a dead server as healthy.
    fetch(`/api/health?t=${Date.now()}`, { cache: "no-store" })
      .then((res) => {
        if (res.ok) set("live");
      })
      .catch(() => {
        /* Still down. The next tick tries again. */
      });
  }, PROBE_MS);
}

function stopProbe() {
  if (probe === null) return;
  clearInterval(probe);
  probe = null;
}

if (typeof window !== "undefined") {
  if (!navigator.onLine) {
    state = "cached";
    startProbe();
  }

  window.addEventListener("online", () => set("live"));
  window.addEventListener("offline", () => set("cached"));

  navigator.serviceWorker?.addEventListener("message", (event: MessageEvent) => {
    if (event.data?.type === "served-from-cache") set("cached");
    // A page that came off the network is proof the server is answering.
    if (event.data?.type === "served-from-network") set("live");
  });
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): ConnState {
  return state;
}

/*
 * The server always renders the optimistic state. Rendering "cached" on the server would put
 * a stale-copy warning into the HTML of a page that was, by definition, just fetched live.
 */
function getServerSnapshot(): ConnState {
  return "live";
}

export function useConnState(): ConnState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
