import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let projectRoot: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;
let auditDbPath: string;

function hashToken(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-identity-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  auditDbPath = path.join(projectRoot, "audit.sqlite");
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = auditDbPath;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("identifyRequestDetailed", () => {
  it("rejects expired tokens with token_expired", async () => {
    const plain = "a".repeat(64);
    const hash = hashToken(plain);
    await writeFile(
      path.join(projectRoot, "webui", "config", "access.yaml"),
      `users:
  - id: alice
    name: Alice
    enabled: true
    tokens:
      - hash: "${hash}"
        label: expired-laptop
        created: "2026-01-01"
        expires_at: "2020-01-01T00:00:00.000Z"
`,
      "utf8"
    );

    const { identifyRequestDetailed } = await import("../proxy/identity");
    const result = await identifyRequestDetailed(`Bearer ${plain}`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("token_expired");
      expect(result.userId).toBe("alice");
      expect(result.tokenLabel).toBe("expired-laptop");
    }
  });

  it("invalidateAccessConfigCache drops stale yaml hits after revoke-style rewrite", async () => {
    const plain = "b".repeat(64);
    const hash = hashToken(plain);
    const accessPath = path.join(projectRoot, "webui", "config", "access.yaml");
    await writeFile(
      accessPath,
      `users:
  - id: bob
    name: Bob
    enabled: true
    tokens:
      - hash: "${hash}"
        label: live
        created: "2026-01-01"
        device_name: bob-mbp
`,
      "utf8"
    );

    const { identifyRequestDetailed, invalidateAccessConfigCache } = await import("../proxy/identity");
    const first = await identifyRequestDetailed(`Bearer ${plain}`);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.identity.deviceName).toBe("bob-mbp");

    await writeFile(
      accessPath,
      `users:
  - id: bob
    name: Bob
    enabled: true
    tokens: []
`,
      "utf8"
    );

    // Without invalidate, cached config would still accept the token within TTL.
    invalidateAccessConfigCache();
    const second = await identifyRequestDetailed(`Bearer ${plain}`);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("token_unrecognized");
  });
});
