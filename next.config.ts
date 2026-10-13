import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // libSQL ships a native binding; keep it out of the server bundle.
  serverExternalPackages: ["@libsql/client", "libsql"],
  // The schema is read from disk when an empty database is seeded on first start.
  outputFileTracingIncludes: { "/api/**": ["./db/schema.sql"] },
};

export default nextConfig;
