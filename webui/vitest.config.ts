import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { loadClientBuildRevision, lucyBuildRevisionDefine } from "./server/lucy-revision";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig({
  define: lucyBuildRevisionDefine(loadClientBuildRevision(repoRoot)),
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["server/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx", "scripts/__tests__/**/*.test.ts"]
  }
});
