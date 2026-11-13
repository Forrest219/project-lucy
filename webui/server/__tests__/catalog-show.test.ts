import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionOptions } from "mysql2";
import { runCatalogShow, type CatalogShowConnection } from "../catalog-show";

const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(passwordRef?: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "catalog-show-"));
  roots.push(root);
  await mkdir(path.join(root, ".ktx/secrets"), { recursive: true });
  await writeFile(path.join(root, ".ktx/secrets/hive-1-password"), "fixture-private-password", { mode: 0o600 });
  await writeFile(path.join(root, "ktx.yaml"), stringify({
    connections: {
      "hive-1": {
        driver: "mysql",
        host: "db.invalid",
        port: 9030,
        username: "reader",
        database: "hive.dw",
        password: passwordRef ?? "file:.ktx/secrets/hive-1-password"
      }
    }
  }));
  return root;
}

function driver(mode = "ok") {
  const conn = Object.assign(new EventEmitter(), {
    connect: vi.fn((callback: (error: Error | null) => void) => {
      if (mode === "connect-hang") return;
      callback(mode === "auth" ? new Error("Access denied fixture-private-password") : null);
    }),
    query: vi.fn((_options: unknown, callback: (error: Error | null, rows?: unknown, fields?: Array<{ name: string }>) => void) => {
      if (mode === "query-hang") return;
      callback(
        mode === "query-error" ? new Error("Unknown database fixture-private-password") : null,
        [["dw"]],
        [{ name: "Database" }]
      );
    }),
    destroy: vi.fn()
  });
  const createConnectionImpl = vi.fn((_options: ConnectionOptions) => conn as CatalogShowConnection);
  return { conn, createConnectionImpl };
}

describe("production catalog SHOW adapter", () => {
  it("reads the configured file and sends no default database during handshake", async () => {
    const root = await fixture();
    const injected = driver();
    const actual = await runCatalogShow(root, "hive-1", "SHOW DATABASES FROM `hive`", {}, injected);
    expect(actual.ok).toBe(true);
    expect(actual.json).toMatchObject({ rows: [["dw"]] });
    const params = injected.createConnectionImpl.mock.calls[0][0];
    expect(params).toMatchObject({
      host: "db.invalid",
      port: 9030,
      user: "reader",
      password: "fixture-private-password",
      connectTimeout: 120000,
      multipleStatements: false
    });
    expect(params).not.toHaveProperty("database");
    expect(injected.conn.query.mock.calls[0][0]).toMatchObject({ timeout: 120000, rowsAsArray: true });
    expect(injected.conn.destroy).toHaveBeenCalledOnce();
    expect(JSON.stringify(actual)).not.toContain("fixture-private-password");
  });

  it("accepts an absolute file reference inside the project", async () => {
    const root = await fixture();
    const config = {
      connections: {
        "hive-1": {
          host: "db.invalid",
          username: "reader",
          password: `file:${path.join(root, ".ktx/secrets/hive-1-password")}`
        }
      }
    };
    await writeFile(path.join(root, "ktx.yaml"), stringify(config));
    const injected = driver();
    expect((await runCatalogShow(root, "hive-1", "SHOW TABLES FROM `hive`.`dw`", {}, injected)).ok).toBe(true);
  });

  it.each([
    "inline-secret",
    "env:DB_PASSWORD",
    "file:.ktx/secrets/missing-password",
    "file:/tmp/outside-password",
    "file:../../outside-password"
  ])("rejects unsupported or missing password reference %s before connecting", async (ref) => {
    const root = await fixture(ref);
    const injected = driver();
    const actual = await runCatalogShow(root, "hive-1", "SHOW DATABASES FROM `hive`", {}, injected);
    expect(actual.ok).toBe(false);
    expect(injected.createConnectionImpl).not.toHaveBeenCalled();
    expect(JSON.stringify(actual)).not.toContain("inline-secret");
    expect(JSON.stringify(actual)).not.toContain("fixture-private-password");
  });

  it.each(["auth", "query-error"])("redacts password and destroys the connection after %s failure", async (mode) => {
    const root = await fixture();
    const injected = driver(mode);
    const actual = await runCatalogShow(root, "hive-1", "SHOW DATABASES FROM `hive`", {}, injected);
    expect(actual.ok).toBe(false);
    expect(actual.stderr).toContain(mode === "auth" ? "Access denied" : "Unknown database");
    expect(JSON.stringify(actual)).not.toContain("fixture-private-password");
    expect(injected.conn.destroy).toHaveBeenCalledOnce();
  });

  it.each(["connect-hang", "query-hang"])("enforces the deadline and closes a hung %s", async (mode) => {
    const root = await fixture();
    const injected = driver(mode);
    vi.useFakeTimers();
    const pending = runCatalogShow(root, "hive-1", "SHOW DATABASES FROM `hive`", {}, injected);
    await vi.waitFor(() => {
      expect(mode === "connect-hang" ? injected.conn.connect : injected.conn.query).toHaveBeenCalled();
    });
    await vi.advanceTimersByTimeAsync(120_000);
    const actual = await pending;
    expect(actual.ok).toBe(false);
    expect(actual.stderr).toMatch(/timed out/i);
    expect(injected.conn.destroy).toHaveBeenCalledOnce();
  });

  it.each([
    "SHOW DATABASES FROM `hive`; SELECT 1",
    "SELECT 1",
    "SHOW TABLES FROM `hive`.`dw` -- comment"
  ])("rejects statements outside the exact SHOW grammar", async (sql) => {
    const root = await fixture();
    const injected = driver();
    expect((await runCatalogShow(root, "hive-1", sql, {}, injected)).ok).toBe(false);
    expect(injected.createConnectionImpl).not.toHaveBeenCalled();
  });

  it.each([
    "DESC `hive`.`dim`.`dim_bidding_block_ad_id_2025`",
    "DESCRIBE `hive`.`dim`.`dim_bidding_block_ad_id_2025`",
    "SHOW COLUMNS FROM `hive`.`dim`.`dim_bidding_block_ad_id_2025`",
    "DESC `hive_jd`.`app`.`日活明细`",
    "DESC `hive`.`dim`.`odd``name`"
  ])("allows the exact three-part column probe %s", async (sql) => {
    const root = await fixture();
    const injected = driver();
    const actual = await runCatalogShow(root, "hive-1", sql, {}, injected);
    expect(actual.ok).toBe(true);
    expect(injected.conn.query.mock.calls[0][0]).toMatchObject({ sql });
    expect(injected.conn.destroy).toHaveBeenCalledOnce();
  });

  it.each([
    "DESC `hive`.`dim`",
    "DESC hive.dim.t",
    "DESC `hive`.`dim`.`t`; DROP TABLE x",
    "DESC `hive`.`dim`.`t` -- comment",
    "DESC `hive`.`dim`.`t` ALL",
    "SHOW FULL COLUMNS FROM `hive`.`dim`.`t`",
    "SHOW COLUMNS FROM `hive`.`dim`",
    "SHOW COLUMNS FROM `t`",
    "SELECT * FROM `hive`.`information_schema`.`columns`",
    "EXPLAIN SELECT 1"
  ])("rejects statements outside the column probe grammar %s", async (sql) => {
    const root = await fixture();
    const injected = driver();
    expect((await runCatalogShow(root, "hive-1", sql, {}, injected)).ok).toBe(false);
    expect(injected.createConnectionImpl).not.toHaveBeenCalled();
  });

  it.each(["auth", "query-error"])("redacts password and closes the connection on a column probe %s failure", async (mode) => {
    const root = await fixture();
    const injected = driver(mode);
    const actual = await runCatalogShow(root, "hive-1", "DESC `hive`.`dim`.`t`", {}, injected);
    expect(actual.ok).toBe(false);
    expect(JSON.stringify(actual)).not.toContain("fixture-private-password");
    expect(injected.conn.destroy).toHaveBeenCalledOnce();
  });

  it("closes a hung column probe at the deadline", async () => {
    const root = await fixture();
    const injected = driver("query-hang");
    vi.useFakeTimers();
    const pending = runCatalogShow(root, "hive-1", "DESC `hive`.`dim`.`t`", {}, injected);
    await vi.waitFor(() => expect(injected.conn.query).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(120_000);
    const actual = await pending;
    expect(actual.ok).toBe(false);
    expect(actual.stderr).toMatch(/timed out/i);
    expect(injected.conn.destroy).toHaveBeenCalledOnce();
  });

  it("does not echo a YAML source line that contains a secret", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "ktx.yaml"), "connections:\n  hive-1: \"super-secret-value\\q\"\n");
    const actual = await runCatalogShow(root, "hive-1", "SHOW DATABASES FROM `hive`", {}, driver());
    expect(actual.ok).toBe(false);
    expect(actual.stderr).toBe("读取表结构失败。");
    expect(JSON.stringify(actual)).not.toContain("super-secret-value");
  });

  it("fails closed when the result fills the row cap", async () => {
    const root = await fixture();
    const injected = driver();
    injected.conn.query.mockImplementation((_options, callback) => {
      callback(null, [["dw"], ["dim"]], [{ name: "Database" }]);
    });
    const actual = await runCatalogShow(root, "hive-1", "SHOW DATABASES FROM `hive`", { maxRows: 2 }, injected);
    expect(actual.ok).toBe(false);
    expect(actual.json).toBeNull();
    expect(actual.stderr).toBe("读取结果超过一次可读取的上限。");
  });
});
