/**
 * Is the server reachable?
 *
 * Polled by the client only while it believes it is offline, to work out when it is not any
 * more. `navigator.onLine` cannot answer this — it reports whether a network interface exists,
 * which on a school LAN is true whether or not anything is listening at the other end.
 *
 * Deliberately unauthenticated and deliberately empty. It discloses exactly one bit — that
 * something is answering on this origin — which any TCP connection already discloses. Adding a
 * session check would make the offline indicator lie for a signed-out user, and a body would
 * make it a thing that has to be kept correct.
 */

export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}
