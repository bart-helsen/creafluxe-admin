import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep server-only packages out of the client/edge bundles. pdfkit ships its
  // own font data files and must not be bundled, or Next can't find them at
  // runtime (invoice PDF rendering would fail).
  serverExternalPackages: ["@prisma/client", "bcryptjs", "pdfkit"],
};

export default nextConfig;
