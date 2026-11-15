import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The tests check the Worker's output against the app's own webhook schema,
// so "@/..." points at the admin app's src/ (as in the app's vitest config).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
      zod: fileURLToPath(new URL("./node_modules/zod", import.meta.url)),
    },
  },
  test: { environment: "node", include: ["test/**/*.test.js"] },
});
