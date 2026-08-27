/** @type {import('next').NextConfig} */
const nextConfig = {
  /*
   * Build a self-contained server the Electron main process can spawn.
   *
   * `standalone` emits `.next/standalone/server.js` with only the dependencies actually
   * reached, which is what makes the installer a sensible size and means the shipped app does
   * not carry `node_modules` whole.
   */
  output: "standalone",

  /*
   * Two folders are read from disk at runtime and neither can be inferred.
   *
   * `templates/` holds the SF10 workbooks the exporter fills, and `db/schema.sql` is read by
   * lib/db/index.ts on first use. Both are opened through a path built at runtime, so Next's
   * file tracing cannot see the dependency and would leave them out of the bundle - where the
   * failure is a fresh install throwing `no such table` or `ENOENT` on the first print.
   *
   * Scoped to every route rather than `/api/students/**`, because lib/db is imported by every
   * page, not only by the route that prints.
   */
  outputFileTracingIncludes: {
    "/**": ["./templates/**", "./db/**"],
  },

  /**
   * Headers that hold for every response.
   *
   * `frame-ancestors 'none'` is the one that earns its place, and it still does with the app
   * on loopback: any page in any browser on this machine can frame `http://127.0.0.1:<port>`,
   * and deleting a learner is a click on a page reachable by URL. `X-Frame-Options` says the
   * same thing to anything that predates CSP.
   *
   * No HSTS: the app is served over plain HTTP to 127.0.0.1, where there is no transport to
   * upgrade and the header would only be a claim about a domain that does not exist.
   */
  async headers() {
    return [
      {
        /*
         * The three self-hosted typefaces. Their filenames are stable and their contents never
         * change, so anything short of a year is a round trip on the critical path of first
         * paint for no benefit. `immutable` also stops a revalidation request being made at
         * all, which matters on the school's connection.
         */
        source: "/fonts/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
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
