import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    // Test files share workers instead of paying environment and dependency
    // setup per file, so every file must leave global state as it found it.
    isolate: false,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    projects: [
      {
        extends: true,
        test: {
          name: "convex",
          environment: "edge-runtime",
          server: { deps: { inline: ["convex-test"] } },
          include: ["convex/tests/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "ui",
          environment: "jsdom",
          setupFiles: ["tests/ui/setup.ts"],
          include: ["tests/ui/**/*.test.{ts,tsx}"],
          // Pre-bundle barrel packages that otherwise load thousands of modules.
          deps: {
            optimizer: {
              client: {
                enabled: true,
                include: [
                  "react-day-picker",
                  "date-fns",
                  "@hugeicons/core-free-icons",
                ],
              },
            },
          },
        },
      },
    ],
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
