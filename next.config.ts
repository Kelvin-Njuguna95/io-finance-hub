import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 16 removed the eslint config key — linting is handled
  // entirely by the standalone eslint.config.mjs.
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
