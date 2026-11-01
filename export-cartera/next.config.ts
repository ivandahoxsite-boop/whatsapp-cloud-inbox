import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // crm-update builds into a separate folder (NEXT_DIST_DIR=.next-new) and only swaps it in when the build
  // succeeded, so a failed build never touches the version that is running.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
