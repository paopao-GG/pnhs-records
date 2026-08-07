/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app reads the SF10 templates and writes the SQLite file from the server at runtime,
  // so those paths must stay on disk rather than being bundled.
  outputFileTracingIncludes: {
    "/api/students/**": ["./templates/**"],
  },
};

export default nextConfig;
