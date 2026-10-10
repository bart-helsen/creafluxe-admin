import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep server-only packages out of the client/edge bundles. pdfkit ships its
  // own font data files and must not be bundled, or Next can't find them at
  // runtime (invoice PDF rendering would fail).
  serverExternalPackages: ["@prisma/client", "bcryptjs", "pdfkit"],
  // Server actions default to a 1 MB body limit, which rejects most design
  // files. Uploads are capped at 10 MB in the actions (MAX_UPLOAD_BYTES).
  experimental: {
    serverActions: { bodySizeLimit: "11mb" },
  },
};

export default nextConfig;
