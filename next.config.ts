import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep server-only packages out of the client/edge bundles.
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
};

export default nextConfig;
