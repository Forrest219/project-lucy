import { describe, expect, it } from "vitest";
import { redactAuditText, redactStorageDetail } from "../security/redaction";

/**
 * P1-36 D9 / SC-07 — storage-side redaction of `error_detail`.
 * Table-driven: [label, input, expected output].
 */
const A = "[REDACTED_ADDR]";
const P = "[REDACTED_PATH]";
const T = "[REDACTED_TOOL]";

const CASES: Array<[string, string, string]> = [
  // --- internal IPv4 -------------------------------------------------------
  ["rfc1918 10/8", "connect to 10.1.2.3 failed", `connect to ${A} failed`],
  ["rfc1918 10/8 with port swallowed", "dial tcp 10.255.255.1:3306: refused", `dial tcp ${A}: refused`],
  ["rfc1918 172.16/12 low edge", "host 172.16.0.5 down", `host ${A} down`],
  ["rfc1918 172.16/12 high edge with port", "host 172.31.255.254:5432 down", `host ${A} down`],
  ["rfc1918 192.168/16", "Can't connect to MySQL server on '192.168.1.20'", `Can't connect to MySQL server on '${A}'`],
  ["loopback 127/8", "listen 127.0.0.1:8080 busy", `listen ${A} busy`],
  ["loopback 127.x.x.x", "peer 127.9.9.9 reset", `peer ${A} reset`],
  ["link-local 169.254/16", "metadata 169.254.169.254 timeout", `metadata ${A} timeout`],
  ["two addresses in one message", "from 10.0.0.1:1234 to 192.168.0.9:3306", `from ${A} to ${A}`],
  ["address inside url", "jdbc:mysql://10.2.3.4:3306/db failed", `jdbc:mysql://${A}/db failed`],
  // --- internal IPv6 -------------------------------------------------------
  ["ipv6 loopback", "connect ::1 refused", `connect ${A} refused`],
  ["ipv6 bracketed ULA with port swallowed", "dial [fd00::1]:3306 refused", `dial ${A} refused`],
  ["ipv6 bare ULA", "peer fd12:3456:789a::1 gone", `peer ${A} gone`],
  ["ipv6 fc00::/7 low edge", "peer fc00::2 gone", `peer ${A} gone`],
  ["ipv6 link-local", "peer fe80::1ff:fe23:4567:890a unreachable", `peer ${A} unreachable`],
  ["ipv6 bracketed loopback no port", "addr [::1] bad", `addr ${A} bad`],
  // --- storage paths -------------------------------------------------------
  ["hdfs path", "cannot read hdfs://nn1/warehouse/db/t1/part-0 now", `cannot read ${P} now`],
  ["hdfs path with host:port", "open hdfs://10.0.0.8:8020/user/hive/x.orc failed", `open ${P} failed`],
  ["hdfs path quoted", `path 'hdfs://ns/a/b' missing`, `path '${P}' missing`],
  ["hdfs path trailing period kept", "bad hdfs://ns/a/b.", `bad ${P}.`],
  ["s3 path", "no key s3://bucket/dir/file.parquet found", `no key ${P} found`],
  ["file path", "open file:///var/lib/data.csv failed", `open ${P} failed`],
  // --- connection-string passwords -----------------------------------------
  ["jdbc password masked, host redacted", "jdbc:mysql://root:secretpw@10.0.0.1:3306/db", `jdbc:mysql://root:[REDACTED]@${A}/db`],
  ["postgresql password masked", "postgresql://app_user:s3cr3t@db.example.com:5432/w", "postgresql://app_user:[REDACTED]@db.example.com:5432/w"],
  ["mongodb password masked", "mongodb://admin:letmein@mongo.svc:27017/l", "mongodb://admin:[REDACTED]@mongo.svc:27017/l"],
  ["url without userinfo untouched", "https://example.com:8443/a", "https://example.com:8443/a"],
  ["url user without password untouched", "ssh://git@example.com/repo", "ssh://git@example.com/repo"],
  // --- internal tool name --------------------------------------------------
  ["tool name exact", "Invalid arguments for tool sl_query", `Invalid arguments for tool ${T}`],
  ["tool name quoted", `tool "sl_query" rejected`, `tool "${T}" rejected`],
  ["tool name with punctuation", "sl_query: boom", `${T}: boom`],
  // --- combined ------------------------------------------------------------
  [
    "combined addr path tool, reason code kept",
    "E_UPSTREAM sl_query failed at 10.0.0.9:9030 reading hdfs://nn/a/b",
    `E_UPSTREAM ${T} failed at ${A} reading ${P}`
  ],
  // --- must stay unchanged (false-positive counter examples) ----------------
  ["public ipv4 kept", "resolve 8.8.8.8 failed", "resolve 8.8.8.8 failed"],
  ["public ipv4 with port kept", "dial 203.0.113.9:443 failed", "dial 203.0.113.9:443 failed"],
  ["public ipv6 kept", "resolve 2001:4860:4860::8888 failed", "resolve 2001:4860:4860::8888 failed"],
  ["version-like 1.2.3.4 kept", "client version 1.2.3.4 unsupported", "client version 1.2.3.4 unsupported"],
  ["v-prefixed version in private-looking range kept", "driver v10.0.0.1 too old", "driver v10.0.0.1 too old"],
  ["just outside 172.16/12 kept", "host 172.32.0.1 down", "host 172.32.0.1 down"],
  ["just outside 192.168/16 kept", "host 192.169.0.1 down", "host 192.169.0.1 down"],
  ["five-octet dotted number kept", "build 10.0.0.1.2 ready", "build 10.0.0.1.2 ready"],
  ["iso timestamp kept", "failed at 2026-11-17T01:02:03Z", "failed at 2026-11-17T01:02:03Z"],
  ["iso timestamp with offset kept", "failed at 2026-11-17T01:02:03+08:00", "failed at 2026-11-17T01:02:03+08:00"],
  ["clock time kept", "timeout after 12:34:56", "timeout after 12:34:56"],
  ["bare port-style string kept", "listening on :8080", "listening on :8080"],
  ["public domain kept", "GET https://example.com/api failed", "GET https://example.com/api failed"],
  ["longer identifier containing sl_query kept", "reason sl_query_timeout", "reason sl_query_timeout"],
  ["identifier ending in sl_query kept", "x_sl_query failed", "x_sl_query failed"],
  ["plain stable reason code kept", "upstream_timeout", "upstream_timeout"],
  ["empty input stays empty", "", ""]
];

describe("redactStorageDetail (P1-36 D9)", () => {
  it.each(CASES)("%s", (_label, input, expected) => {
    expect(redactStorageDetail(input)).toBe(expected);
  });

  it("table has at least 25 rows", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(25);
  });

  it("never returns an empty string for non-empty input", () => {
    for (const [, input] of CASES) {
      if (input !== "") expect(redactStorageDetail(input)).not.toBe("");
    }
    expect(redactStorageDetail("10.0.0.1")).toBe(A);
    expect(redactStorageDetail("hdfs://nn/x")).toBe(P);
    expect(redactStorageDetail("sl_query")).toBe(T);
  });

  it("is idempotent", () => {
    for (const [, input] of CASES) {
      const once = redactStorageDetail(input);
      expect(redactStorageDetail(once)).toBe(once);
    }
  });

  it("still applies the credential chain from redactAuditText", () => {
    const input = "login failed password=hunter2 at 10.0.0.1";
    expect(redactStorageDetail(input)).toBe(`login failed password=[REDACTED] at ${A}`);
  });

  it("leaves redactAuditText unchanged for addresses, paths and tool names", () => {
    const input = "10.0.0.1:3306 hdfs://nn/x sl_query";
    expect(redactAuditText(input)).toBe(input);
  });
});
