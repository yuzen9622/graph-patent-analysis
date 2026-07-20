import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Emit a self-contained server bundle at `.next/standalone` for slim Docker images.
  output: 'standalone',
  allowedDevOrigins: ['graph.yuzen.dev'],
};

export default nextConfig;
