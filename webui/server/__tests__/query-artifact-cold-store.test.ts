import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  decryptQueryArtifactPayload,
  encryptQueryArtifactPayload,
  resolveQueryArtifactKey
} from "../audit/query-artifact-crypto.js";
import {
  captureQueryPayload,
  mergeIncludeSql
} from "../audit/query-artifact-capture.js";
import {
  readQueryArtifact,
  writeQueryArtifact
} from "../audit/query-artifact-store.js";

describe("query artifact crypto", () => {
  it("round-trips AES-GCM payloads", () => {
    const key = resolveQueryArtifactKey({ LUCY_AUDIT_QUERY_KEY: "unit-test-secret-key" });
    expect(key).not.toBeNull();
    const sealed = encryptQueryArtifactPayload("SELECT 1", key!);
    expect(decryptQueryArtifactPayload(sealed, key!)).toBe("SELECT 1");
  });

  it("returns null key when env missing", () => {
    expect(resolveQueryArtifactKey({})).toBeNull();
  });
});

describe("query artifact capture", () => {
  it("prefers generated sql from tool result", () => {
    const captured = captureQueryPayload({
      toolArgs: { measures: ["orders.sales"] },
      toolResultBody: {
        result: { structuredContent: { sql: "SELECT SUM(sales) FROM t" } }
      }
    });
    expect(captured?.kind).toBe("generated_sql");
    expect(captured?.plaintext).toContain("SUM(sales)");
  });

  it("captures raw sql from args", () => {
    const captured = captureQueryPayload({
      toolArgs: { sql: "SELECT * FROM secret_table" }
    });
    expect(captured?.kind).toBe("raw_sql");
  });

  it("falls back to semantic_query", () => {
    const captured = captureQueryPayload({
      toolArgs: { measures: ["orders.sales"], limit: 10 }
    });
    expect(captured?.kind).toBe("semantic_query");
    expect(captured?.plaintext).toContain("orders.sales");
  });

  it("merges include sql", () => {
    expect(mergeIncludeSql({ include: ["rows"], limit: 1 }).include).toEqual(["rows", "sql"]);
  });
});

describe("query artifact store", () => {
  let tempRoot: string | undefined;
  let previousRoot: string | undefined;
  let previousKey: string | undefined;
  let previousCold: string | undefined;

  afterEach(async () => {
    if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
    else process.env.KTX_PROJECT_ROOT = previousRoot;
    if (previousKey === undefined) delete process.env.LUCY_AUDIT_QUERY_KEY;
    else process.env.LUCY_AUDIT_QUERY_KEY = previousKey;
    if (previousCold === undefined) delete process.env.LUCY_AUDIT_COLD_DIR;
    else process.env.LUCY_AUDIT_COLD_DIR = previousCold;
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it("writes ciphertext only and decrypts by ref", async () => {
    previousRoot = process.env.KTX_PROJECT_ROOT;
    previousKey = process.env.LUCY_AUDIT_QUERY_KEY;
    previousCold = process.env.LUCY_AUDIT_COLD_DIR;
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-qa-"));
    await writeFile(path.join(tempRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    process.env.KTX_PROJECT_ROOT = tempRoot;
    process.env.LUCY_AUDIT_QUERY_KEY = "forensics-test-key";
    process.env.LUCY_AUDIT_COLD_DIR = path.join(tempRoot, "cold");

    const written = await writeQueryArtifact({
      kind: "raw_sql",
      tool: "lucy_query",
      requestId: "req-1",
      plaintext: "SELECT id FROM t WHERE secret = 1"
    });
    expect(written?.ref).toMatch(/^qa_[a-f0-9]{24}$/);

    const loaded = await readQueryArtifact(written!.ref);
    expect(loaded?.plaintext).toBe("SELECT id FROM t WHERE secret = 1");
    expect(JSON.stringify(loaded?.record)).not.toContain("secret = 1");
  });

  it("skips write when key missing", async () => {
    previousKey = process.env.LUCY_AUDIT_QUERY_KEY;
    delete process.env.LUCY_AUDIT_QUERY_KEY;
    await expect(
      writeQueryArtifact({
        kind: "raw_sql",
        tool: "lucy_query",
        requestId: "req-2",
        plaintext: "SELECT 1"
      })
    ).resolves.toBeNull();
  });
});
