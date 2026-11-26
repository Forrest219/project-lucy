import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { evaluateSyncIo, scanFileSyncIo } from "./server-sync-io-gate.mjs";

describe("server-sync-io-gate", () => {
  it("ignores sync I/O names inside comments and strings", () => {
    const src = `
      // do not call readFileSync() in request handlers
      const note = "avoid execSync() and statSync()";
    `;
    assert.deepEqual(scanFileSyncIo(src), []);
  });

  it("enforces ratchet baseline and zero-tolerance on proxy hot path", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sync-io-gate-"));
    try {
      mkdirSync(path.join(dir, "webui/server/admin"), { recursive: true });
      mkdirSync(path.join(dir, "webui/server/proxy"), { recursive: true });

      writeFileSync(
        path.join(dir, "webui/server/admin/existing.ts"),
        `import { readFileSync } from "node:fs";\nexport const x = () => readFileSync("a", "utf8");\n`,
        "utf8"
      );
      writeFileSync(
        path.join(dir, "webui/server/proxy/hot.ts"),
        `import { statSync } from "node:fs";\nexport const y = () => statSync("b");\n`,
        "utf8"
      );

      // Unbaselined proxy file fails immediately
      const res = evaluateSyncIo({
        rootDir: path.join(dir, "webui/server"),
        repoRoot: dir,
        baselineCounts: {
          "webui/server/admin/existing.ts": 1
        }
      });
      assert.equal(res.violations.length, 1);
      assert.equal(res.violations[0].file, "webui/server/proxy/hot.ts");

      // Exceeding baseline on non-proxy file also fails
      const over = evaluateSyncIo({
        rootDir: path.join(dir, "webui/server/admin"),
        repoRoot: dir,
        baselineCounts: { "webui/server/admin/existing.ts": 0 }
      });
      assert.equal(over.violations.length, 1);
      assert.equal(over.violations[0].file, "webui/server/admin/existing.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
