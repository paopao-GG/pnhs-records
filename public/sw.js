/*
 * PNHS Records — offline shell (phase A: read-only).
 *
 * What this buys: if Vercel, Turso or the school's uplink is down, a record the registrar has
 * already opened stays readable, and the app itself still starts. That is the cheap half of
 * backlog item #8, and it is deliberately all of it — there is no outbox here, no queued
 * write, no sync. Editing offline is refused visibly rather than accepted and lost.
 *
 * WHAT IS NOT CACHED, AND WHY IT MATTERS
 *
 * This app serves the personal data of children — names, birthdates, parents' names,
 * occupations and home addresses. Caching a page writes that to disk on whatever machine is
 * being used. Three rules follow, and none of them are optional:
 *
 *   1. `/api/*` is never cached. Original documents and generated SF10 workbooks are the most
 *      sensitive things the system holds, and they are also the things nobody needs offline.
 *   2. `/login` and `/admin/*` are never cached. A cached sign-in page can serve a stale CSRF
 *      state, and account management has no offline use whatsoever.
 *   3. The page cache is purged on sign-out. A shared office machine must not hand the next
 *      person a readable copy of the last person's session, and the browser's normal cache
 *      eviction is far too slow to rely on for that.
 */

const SHELL = "pnhs-shell-v1";
const PAGES = "pnhs-pages-v1";
const KEEP = [SHELL, PAGES];

/** Header carrying the moment a page was cached. See `stamp()` and `readFresh()`. */
const CACHED_AT = "x-pnhs-cached-at";

/** How long a cached record stays readable. See `readFresh()` for the reasoning. */
const MAX_PAGE_AGE_MS = 12 * 60 * 60 * 1000;

/** Paths that must never touch a cache. See rules 1 and 2 above. */
const NEVER_CACHE = [/^\/api\//, /^\/login\b/, /^\/admin\//];

self.addEventListener("install", (event) => {
  // Fonts are the one thing worth fetching ahead of need: without them a cached page renders
  // in a fallback face and looks broken rather than offline.
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) =>
        cache.addAll([
          "/fonts/atkinson-400-latin.woff2",
          "/fonts/atkinson-700-latin.woff2",
          "/fonts/fraunces-var-latin.woff2",
          "/fonts/plexmono-400-latin.woff2",
          "/fonts/plexmono-500-latin.woff2",
          "/fonts/plexmono-600-latin.woff2",
        ]),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  // Sent by the sign-out button before it submits. See rule 3.
  if (event.data?.type === "purge") {
    event.waitUntil(caches.delete(PAGES));
  }
});

/**
 * Tells every open tab which side its last page came from.
 *
 * Both directions are announced. Announcing only the cache hit would let one failed request
 * pin the whole app in its offline state until the tab was reloaded, with every grade cell
 * disabled and no event on its way to release them.
 */
async function announce(type) {
  const clients = await self.clients.matchAll({ type: "window" });
  for (const client of clients) client.postMessage({ type });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some((re) => re.test(url.pathname))) return;

  /*
   * Immutable build output and fonts: cache-first. `/_next/static` filenames carry a content
   * hash, so a cached entry can never be stale — a changed file is a different URL.
   */
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/fonts/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(SHELL).then((c) => c.put(request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  /*
   * Pages: network-first. The server is always the authority on what a record says, and a
   * records system that shows a day-old grade in preference to today's one is worse than a
   * records system that fails.
   */
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          /*
           * Only 200s are cached, and only same-origin ones. A redirect to /login is an
           * unauthenticated response; caching it would pin the sign-in page in place of the
           * record the user asked for and it would survive signing back in.
           */
          if (res.ok && res.type === "basic") {
            stamp(request, res.clone());
          }
          announce("served-from-network");
          return res;
        })
        .catch(async () => {
          const { response, expired } = await readFresh(request);
          await announce("served-from-cache");
          return response ?? offlineFallback(url, expired);
        }),
    );
  }
});

/**
 * Store a page with the time it was taken.
 *
 * A `Response` from `caches.match` carries no timestamp of its own, so the age check below
 * needs one written in. The body has to be re-read to attach a header, which is why this is a
 * copy rather than the response being served.
 */
async function stamp(request, response) {
  const body = await response.blob();
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT, String(Date.now()));

  const cache = await caches.open(PAGES);
  await cache.put(
    request,
    new Response(body, { status: response.status, statusText: response.statusText, headers }),
  );
}

/**
 * Read a cached page, refusing anything older than MAX_PAGE_AGE_MS.
 *
 * Sign-out purges this cache, but a browser closed *without* signing out would otherwise leave
 * every record the last person opened readable on disk indefinitely — on a shared office
 * machine, that is a copy of a child's permanent record available to whoever sits down next.
 *
 * The expiry is the compromise between that and the reason the cache exists at all. Twelve
 * hours covers an outage lasting most of a working day, and does not survive the machine being
 * left overnight. An expired entry is deleted on the way past rather than left to rot.
 */
async function readFresh(request) {
  const cache = await caches.open(PAGES);
  const hit = await cache.match(request);
  if (!hit) return { response: undefined, expired: false };

  const at = Number(hit.headers.get(CACHED_AT) ?? 0);
  if (Date.now() - at <= MAX_PAGE_AGE_MS) return { response: hit, expired: false };

  await cache.delete(request);
  return { response: undefined, expired: true };
}

/**
 * Shown when the requested page is not available from the cache.
 *
 * Two reasons, and they need different words: the page was never opened while connected, or the
 * copy was taken more than MAX_PAGE_AGE_MS ago and has been discarded. Telling someone "not
 * saved" about a record they know they opened this morning would read as the app losing things.
 *
 * Deliberately plain HTML with inline styles: it must render with no stylesheet, no font and
 * no JavaScript, because if any of those were available this page would not be needed.
 */
function offlineFallback(url, expired) {
  const heading = expired
    ? "The saved copy of this page has expired"
    : "This page was not saved for offline use";

  const explain = expired
    ? "Saved copies are kept for twelve hours and then discarded, so a record cannot be read " +
      "off a machine long after the person who opened it has gone."
    : "Only records opened while connected are available.";

  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading} — PNHS Records</title></head>
<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#eceae4;color:#14181c;font-family:Corbel,'Segoe UI',sans-serif">
<div style="max-width:34rem;padding:2rem;text-align:center">
<div style="font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;color:#8a6318;font-weight:700">Offline</div>
<h1 style="font-family:Constantia,Georgia,serif;font-size:1.6rem;margin:.6rem 0 0">${heading}</h1>
<p style="color:#4a5359;line-height:1.6">You are looking at a saved copy of PNHS Records. ${explain} Nothing has been lost — <code style="font-family:Consolas,monospace">${url.pathname.replace(/[<>&"]/g, "")}</code> will load normally once the connection is back.</p>
<p><a href="/" style="color:#17564f">Back to the records you have</a></p>
</div></body></html>`;

  return new Response(body, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
