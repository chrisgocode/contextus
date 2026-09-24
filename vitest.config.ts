import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["convex/tests/**/*.test.ts", "tests/ui/**/*.test.{ts,tsx}"],
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary"],
      include: ["app/**/*.{ts,tsx}", "convex/**/*.ts"],
      exclude: ["convex/_generated/**", "convex/**/*.test.ts"],
      thresholds: {
        "app/**": { lines: 80 },
        "convex/**": { lines: 90, branches: 80 },
      },
    },
  },
});
