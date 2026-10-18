import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Pin the tracing root to this project even when a parent directory has its
  // own lockfile (e.g. a monorepo checkout).
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
