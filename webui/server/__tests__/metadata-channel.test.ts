import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionOptions } from "mysql2";
import type { CatalogShowConnection } from "../catalog-show";
import { MetadataChannelUnavailable, openMetadataChannel } from "../metadata-channel";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(extra: Record<string, unknown> = {}, password = "file:.ktx/secrets/db-1-password") {
  const root = await mkdtemp(path.join(os.tmpdir(), "metadata-channel-"));
  roots.push(root);
  await mkdir(path.join(root, ".ktx/secrets"), { recursive: true });
  await writeFile(path.join(root, ".ktx/secrets/db-1-password"), "fixture-private-password", { mode: 0o600 });
  await writeFile(path.join(root, "ktx.yaml"), stringify({
    connections: {
      "db-1": { driver: "mysql", host: "db.invalid", port: 3306, username: "reader", database: "dw", password, ...extra }
    }
  }));
  return root;
}

function driver(mode: "ok" | "query-error" = "ok", rowCount = 1) {
  const conn = Object.assign(new EventEmitter(), {
    connect: vi.fn((callback: (error: Error | null) => void) => callback(null)),
    query: vi.fn((_options: unknown, callback: (error: Error | null, rows?: unknown, fields?: Array<{ name: string }>) => void) => {
      if (mode === "query-error") return callback(new Error("Unknown table fixture-private-password"));
      callback(null, Array.from({ length: rowCount }, (_, index) => [`t${index}`]), [{ name: "table_name" }]);
    }),
    destroy: vi.fn()
  });
  const createConnectionImpl = vi.fn((_options: ConnectionOptions) => conn as CatalogShowConnection);
  return { conn, createConnectionImpl };
}

const TABLES_SQL =
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'dw' AND table_type = 'BASE TABLE' AND LOWER(table_name) IN ('a','b')";
const COLUMNS_SQL =
  "SELECT table_name, column_name, data_type, is_nullable, column_key, column_comment FROM information_schema.columns WHERE table_schema = 'dw' AND table_name IN ('a','b') ORDER BY table_name, ordinal_position";

describe("metadata channel", () => {
  it("LS-04 opens one connection for many statements and closes it once", async () => {
    const root = await fixture();
    const injected = driver();
    const channel = await openMetadataChannel(root, "db-1", injected);
    await channel.run(TABLES_SQL, { maxRows: 100, timeoutMs: 1000 });
    await channel.run(COLUMNS_SQL, { maxRows: 100, timeoutMs: 1000 });
    await channel.run("DESC `hive`.`dim`.`t`", { maxRows: 100, timeoutMs: 1000 });
    await channel.run(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'dw' AND table_type = 'BASE TABLE' ORDER BY table_name",
      { maxRows: 100, timeoutMs: 1000 }
    );
    channel.close();
    expect(injected.createConnectionImpl).toHaveBeenCalledOnce();
    expect(injected.conn.connect).toHaveBeenCalledOnce();
    expect(injected.conn.query).toHaveBeenCalledTimes(4);
    expect(injected.conn.destroy).toHaveBeenCalledOnce();
  });

  it("reports truncation instead of throwing when a statement fills the row limit", async () => {
    const root = await fixture();
    const channel = await openMetadataChannel(root, "db-1", driver("ok", 5));
    const answer = await channel.run(TABLES_SQL, { maxRows: 5, timeoutMs: 1000 });
    expect(answer.truncated).toBe(true);
    expect(answer.rows).toHaveLength(5);
    channel.close();
  });

  it.each([
    "SELECT * FROM information_schema.columns",
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'dw'; DROP TABLE x",
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'd\\'w' AND table_type = 'BASE TABLE' AND LOWER(table_name) IN ('a')",
    "DROP TABLE a"
  ])("rejects a statement outside the metadata grammar: %s", async (sql) => {
    const root = await fixture();
    const injected = driver();
    const channel = await openMetadataChannel(root, "db-1", injected);
    await expect(channel.run(sql, { maxRows: 10, timeoutMs: 1000 })).rejects.toThrow(/Unsupported/);
    expect(injected.conn.query).not.toHaveBeenCalled();
    channel.close();
  });

  it("LS-15 redacts the password from a failed statement", async () => {
    const root = await fixture();
    const channel = await openMetadataChannel(root, "db-1", driver("query-error"));
    const failure = await channel.run(TABLES_SQL, { maxRows: 10, timeoutMs: 1000 }).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain("fixture-private-password");
    channel.close();
  });

  it.each([
    ["an ssl option", { ssl: true }, undefined],
    ["a tls option", { tls: { protocol: "TLSv1.2" } }, undefined],
    ["an inline password", {}, "plain-text"]
  ])("LS-14 is unavailable for %s", async (_label, extra, password) => {
    const root = await fixture(extra as Record<string, unknown>, password);
    const injected = driver();
    await expect(openMetadataChannel(root, "db-1", injected)).rejects.toBeInstanceOf(MetadataChannelUnavailable);
    expect(injected.createConnectionImpl).not.toHaveBeenCalled();
  });
});
