import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["tests/**/*.test.ts"],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['app/**/*.{ts,tsx}', 'convex/**/*.ts'],
      exclude: ['convex/_generated/**'],
    }
  },
});
