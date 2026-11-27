import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next 16 writes AGENTS.md into the repo on `dev`; not part of this deliverable.
  agentRules: false,
};

export default nextConfig;
