import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: [
      "server/**/*.test.ts",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "scripts/__tests__/**/*.test.ts",
      "tests/live-e2e/helpers/**/*.test.ts"
    ]
  }
});
