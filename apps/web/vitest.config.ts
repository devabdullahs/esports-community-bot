import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", setupFiles: ["./src/test/setup.ts"] },
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "src/test/server-only-stub.ts"),
      "@bot": path.resolve(__dirname, "../../src"),
      "@": path.resolve(__dirname, "src"),
    },
  },
});
