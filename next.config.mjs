/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app reads the SF10 templates and writes the SQLite file from the server at runtime,
  // so those paths must stay on disk rather than being bundled.
  outputFileTracingIncludes: {
    "/api/students/**": ["./templates/**"],
  },

  /**
   * Headers that hold for every response.
   *
   * `frame-ancestors 'none'` is the one that earns its place: deleting a learner is a click on
   * a page reachable by URL, and a framed copy of that page on another site is how a signed-in
   * registrar is made to click something they cannot see. `X-Frame-Options` says the same thing
   * to anything that predates CSP.
   *
   * HSTS is absent on purpose - `vercel.app` is in the browser preload list, so it is already
   * enforced and setting it here would only be a claim we cannot make about a future domain.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Learner record URLs contain a database id; no other site needs to be told one.
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
