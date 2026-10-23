/**
 * Spec 186 (T14) — Read-only trust-boundary inventory.
 *
 * Three dependency-free helpers used by the T14 audit step:
 *
 * - `collectPublishPortInventory()` scans the Helm Service template, the Helm
 *   `values.yaml`, and `docker-compose.demo.yml` to list every customer-facing
 *   published port (Helm Service `port:` entries, Helm `containerPorts.*`,
 *   compose `ports:` host mappings). 7878 (KTX upstream) is allowed only as a
 *   container-internal upstream — either inside `LUCY_PROXY_UPSTREAM_PORT` env
 *   or the helpers' upstream default. Any literal `7878` in Service ports or
 *   compose host mappings is surfaced in `forbiddenPublishedHits`.
 *
 * - `tokensAreDistinct(client, internal)` returns ONLY `{ distinct: boolean }`.
 *   Never echoes either token, never includes them in errors or logs. Empty
 *   tokens report distinct:false per the spec.
 *
 * - `summarizeSqlGrants(statements)` parses caller-supplied `SHOW GRANTS`-style
 *   text. It does not connect to a database, never logs the input, and emits
 *   per-account `GRANT` statements. The function never proposes changes.
 *
 * This module never reads process secrets, environment credentials, or makes
 * any network call. Test fixtures use only the repository's own files.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

// --------------------------------------------------------------------
// Repo-root discovery — file-URL based, no dependency on cwd.
// --------------------------------------------------------------------

function defaultRepoRoot(): string {
  // This module lives at <repoRoot>/webui/server/admin/trust-boundary-inventory.ts.
  // Walk up until we find the directory that contains both `webui/` and `deploy/`.
  const here = path.dirname(fileURLToPath(import.meta.url));
  let cursor = path.resolve(here);
  for (let i = 0; i < 10; i++) {
    if (
      existsSync(path.join(cursor, "webui")) &&
      existsSync(path.join(cursor, "deploy"))
    ) {
      return cursor;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return process.cwd();
}

// --------------------------------------------------------------------
// §2 — Publish-port inventory.
// --------------------------------------------------------------------

const INTERNAL_UPSTREAM_PORT = 7878;
const WEBUI_PORT = 5174;
const MCP_PORT = 7879;

export type PublishPortOrigin =
  | "helm-service"
  | "helm-containerPort"
  | "compose-publish"
  | "compose-internal-env"
  | "helm-internal-helper";

export type PublishPortEntry = {
  /** The numeric port that appears in the scanned text. */
  port: number;
  /** Kind of source location. */
  origin: PublishPortOrigin;
  /** Whether the port is exposed to a customer (Service / compose host) or kept internal. */
  scope: "published" | "pod-internal";
  /** Helm port name (e.g. `webui`, `mcp`) or compose service / label. */
  label?: string;
  /** Source file path, repo-root relative when under the repo root. */
  path: string;
  /** 1-indexed line within `path`. */
  line: number;
};

export type PublishPortInventory = {
  /** Every port exposed to a customer (Helm Service or compose host mapping). */
  publishedPorts: PublishPortEntry[];
  /** Port references that appear only inside container-internal positions. */
  internalUpstreamPorts: PublishPortEntry[];
  /**
   * All `7878` literals that landed in customer-facing positions. The T14
   * invariant says this list must be empty; tests fail when it is not.
   */
  forbiddenPublishedHits: PublishPortEntry[];
  /** Source files that were actually scanned. */
  sources: string[];
  /** Non-fatal notes (e.g. a file that was missing). */
  warnings: string[];
};

export type CollectPublishPortInventoryOptions = {
  /** Override the inferred repo root. Tests use this with a tmp dir. */
  root?: string;
};

const HELM_SERVICE_PATH = "deploy/k8s/helm/lucy/templates/service.yaml";
const HELM_VALUES_PATH = "deploy/k8s/helm/lucy/values.yaml";
const HELM_HELPERS_PATH = "deploy/k8s/helm/lucy/templates/_helpers.tpl";
const COMPOSE_DEMO_PATH = "deploy/compose/docker-compose.demo.yml";

export async function collectPublishPortInventory(
  options: CollectPublishPortInventoryOptions = {}
): Promise<PublishPortInventory> {
  const root = options.root ?? defaultRepoRoot();
  const sources: string[] = [];
  const warnings: string[] = [];
  const publishedPorts: PublishPortEntry[] = [];
  const internalUpstreamPorts: PublishPortEntry[] = [];
  const forbiddenPublishedHits: PublishPortEntry[] = [];

  const scan = (rel: string): string | null => {
    sources.push(rel);
    const abs = path.join(root, rel);
    if (!existsSync(abs)) {
      warnings.push(`missing_file:${rel}`);
      return null;
    }
    return readFileSync(abs, "utf8");
  };

  const recordPublished = (entry: PublishPortEntry) => {
    publishedPorts.push(entry);
    if (entry.port === INTERNAL_UPSTREAM_PORT) forbiddenPublishedHits.push(entry);
  };

  // Helm Service template — only the `name:` / `targetPort:` of published ports
  // are resolvable here (numeric `port:` is templated). We still scan the
  // whole block for any literal `7878` that may have crept into a `port:`.
  const serviceText = scan(HELM_SERVICE_PATH);
  if (serviceText !== null) {
    const lines = serviceText.split(/\r?\n/);
    let portsBlockIndent: number | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const trimmed = line.trim();
      const lineIndent = lineIndentOf(line);

      if (portsBlockIndent === null) {
        if (trimmed === "ports:") portsBlockIndent = lineIndent;
        continue;
      }
      if (trimmed !== "" && lineIndent <= portsBlockIndent) {
        portsBlockIndent = null;
        continue;
      }
      const portLiteral = /^\s*port:\s*(\d+)\s*$/.exec(line);
      if (portLiteral) {
        const port = Number(portLiteral[1]);
        recordPublished({
          port,
          origin: "helm-service",
          scope: "published",
          path: HELM_SERVICE_PATH,
          line: i + 1
        });
      }
    }
  }

  // Helm values.yaml — `containerPorts.*` and `service.{webui,mcp}Port`.
  const valuesText = scan(HELM_VALUES_PATH);
  if (valuesText !== null) {
    const lines = valuesText.split(/\r?\n/);
    let containerPortsIndent: number | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const trimmed = line.trim();
      const lineIndent = lineIndentOf(line);

      if (containerPortsIndent === null) {
        if (/^containerPorts:\s*$/.test(line)) containerPortsIndent = lineIndent;
      } else if (trimmed !== "" && lineIndent <= containerPortsIndent) {
        containerPortsIndent = null;
      }
      if (containerPortsIndent !== null) {
        const inner = /^(\s+)([A-Za-z0-9_-]+):\s*(\d+)\s*$/.exec(line);
        if (inner) {
          const port = Number(inner[3]);
          recordPublished({
            port,
            origin: "helm-containerPort",
            scope: "published",
            label: inner[2],
            path: HELM_VALUES_PATH,
            line: i + 1
          });
        }
      }
    }

    // Resolve `service.webuiPort` / `service.mcpPort` via YAML (cleaner than
    // regex on multi-line values; numeric literal is straightforward).
    try {
      const doc = parseYaml(valuesText) as Record<string, unknown> | null;
      const service = (doc?.["service"] as Record<string, unknown> | undefined) ?? {};
      const valueByKey: Array<[string, unknown]> = [
        ["webuiPort", service["webuiPort"]],
        ["mcpPort", service["mcpPort"]]
      ];
      for (const [label, raw] of valueByKey) {
        const port = Number(raw);
        if (!Number.isInteger(port) || port <= 0) continue;
        recordPublished({
          port,
          origin: "helm-service",
          scope: "published",
          label,
          path: HELM_VALUES_PATH,
          line: findServicePortLine(lines, label, port)
        });
      }
    } catch {
      warnings.push(`yaml_parse_failed:${HELM_VALUES_PATH}`);
    }
  }

  // Helm helpers — the upstream-default line is allowed to contain 7878.
  const helpersText = scan(HELM_HELPERS_PATH);
  if (helpersText !== null) {
    const idx = findLiteralLine(helpersText, INTERNAL_UPSTREAM_PORT);
    if (idx > 0) {
      internalUpstreamPorts.push({
        port: INTERNAL_UPSTREAM_PORT,
        origin: "helm-internal-helper",
        scope: "pod-internal",
        label: "LUCY_PROXY_UPSTREAM_PORT",
        path: HELM_HELPERS_PATH,
        line: idx
      });
    }
  }

  // docker-compose.demo.yml — published host mappings + container-internal env.
  const composeText = scan(COMPOSE_DEMO_PATH);
  if (composeText !== null) {
    const lines = composeText.split(/\r?\n/);
    try {
      const doc = parseYaml(composeText) as
        | { services?: Record<string, Record<string, unknown>> }
        | null;
      const services = doc?.services ?? {};
      for (const [serviceName, definition] of Object.entries(services)) {
        const portsRaw = definition?.["ports"];
        if (!Array.isArray(portsRaw)) continue;
        for (const entry of portsRaw) {
          if (typeof entry !== "string") continue;
          const parsed = parseComposePortEntry(entry);
          if (!parsed) continue;
          const idx = findComposePortLine(lines, entry);
          // Only the `lucy` service is the customer-facing entry; the DB
          // and init services are infrastructure and are out of scope for
          // T14's "customer entry" check.
          if (serviceName !== "lucy") continue;
          const publishEntry: PublishPortEntry = {
            port: parsed.host,
            origin: "compose-publish",
            scope: "published",
            label: `${serviceName}:host->${parsed.container}`,
            path: COMPOSE_DEMO_PATH,
            line: idx > 0 ? idx : 0
          };
          publishedPorts.push(publishEntry);
          // Spec: 7878 is forbidden on EITHER side of a customer-facing
          // compose mapping. Host side `78789:7878` would still pipe customer
          // traffic at the upstream port, bypassing the proxy.
          if (
            parsed.host === INTERNAL_UPSTREAM_PORT ||
            parsed.container === INTERNAL_UPSTREAM_PORT
          ) {
            forbiddenPublishedHits.push({
              ...publishEntry,
              port: INTERNAL_UPSTREAM_PORT,
              label: `${serviceName}:${parsed.host}->${parsed.container}`
            });
          }
        }
      }
    } catch {
      warnings.push(`yaml_parse_failed:${COMPOSE_DEMO_PATH}`);
    }

    // Compose internal env — `LUCY_PROXY_UPSTREAM_PORT: "7878"`.
    const upstreamIdx = findComposeEnvLine(lines, "LUCY_PROXY_UPSTREAM_PORT:", "7878");
    if (upstreamIdx > 0) {
      internalUpstreamPorts.push({
        port: INTERNAL_UPSTREAM_PORT,
        origin: "compose-internal-env",
        scope: "pod-internal",
        label: "LUCY_PROXY_UPSTREAM_PORT",
        path: COMPOSE_DEMO_PATH,
        line: upstreamIdx
      });
    }
  }

  return {
    publishedPorts,
    internalUpstreamPorts,
    forbiddenPublishedHits,
    sources,
    warnings
  };
}

function lineIndentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function findServicePortLine(lines: string[], label: string, port: number): number {
  const needle = `${label}:`;
  const portStr = String(port);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.includes(needle) && line.includes(portStr)) return i + 1;
  }
  return 0;
}

function findLiteralLine(text: string, port: number): number {
  const lines = text.split(/\r?\n/);
  const needle = String(port);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.includes(needle)) return i + 1;
  }
  return -1;
}

function findComposePortLine(lines: string[], needle: string): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.includes(needle)) return i + 1;
  }
  return -1;
}

function findComposeEnvLine(
  lines: string[],
  key: string,
  value: string
): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.includes(key) && line.includes(value)) return i + 1;
  }
  return -1;
}

function parseComposePortEntry(raw: string): { host: number; container: number } | null {
  // Accepts `${VAR:-53306}:3306` or `53306:3306`. Bare numbers without the
  // colon are not customer publish entries (they would be a single port
  // exposed without host mapping).
  if (raw.includes("${")) {
    const m = /\$\{[^:}]+:?-?(\d+)\}:(\d+)/.exec(raw);
    if (!m) return null;
    return { host: Number(m[1]), container: Number(m[2]) };
  }
  if (/^\d+:\d+$/.test(raw)) {
    const [h, c] = raw.split(":").map((n) => Number(n));
    return { host: h as number, container: c as number };
  }
  return null;
}

// --------------------------------------------------------------------
// §3 — Token-distinct check.
// --------------------------------------------------------------------

export type TokensAreDistinctResult = { distinct: boolean };

export function tokensAreDistinct(
  clientToken: unknown,
  internalToken: unknown
): TokensAreDistinctResult {
  // Inputs are coerced carefully but never echoed.
  const client = typeof clientToken === "string" ? clientToken : "";
  const internal = typeof internalToken === "string" ? internalToken : "";
  if (client.length === 0 || internal.length === 0) return { distinct: false };
  if (client === internal) return { distinct: false };
  return { distinct: true };
}

// --------------------------------------------------------------------
// §4 — SQL grant summarizer.
// --------------------------------------------------------------------

export type SqlGrantEntry = {
  /** Account identifier as printed in `SHOW GRANTS`, e.g. `'lucy'@'%'`. */
  user: string;
  /** The full `GRANT ...` statement lines for this account, in source order. */
  statements: string[];
};

export type SqlGrantSummary = {
  /** One entry per account, in the order the headers appear in the input. */
  entries: SqlGrantEntry[];
  /** Non-fatal notes (e.g. GRANT lines that had no preceding header). */
  warnings: string[];
};

const GRANTS_HEADER_RE = /^[Gg]rants\s+for\s+(.+?)\s*$/;
const GRANT_LINE_RE = /^GRANT\s+/i;

export function summarizeSqlGrants(
  statements: string | undefined | null
): SqlGrantSummary {
  const text = typeof statements === "string" ? statements : "";
  const lines = text.split(/\r?\n/);
  const entries: SqlGrantEntry[] = [];
  const userIndex = new Map<string, number>();
  const warnings: string[] = [];
  let currentUser: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "") continue;
    const header = GRANTS_HEADER_RE.exec(line);
    if (header) {
      currentUser = (header[1] ?? "").trim();
      if (currentUser && !userIndex.has(currentUser)) {
        userIndex.set(currentUser, entries.length);
        entries.push({ user: currentUser, statements: [] });
      }
      continue;
    }
    if (GRANT_LINE_RE.test(line)) {
      if (currentUser === null) {
        warnings.push("orphan_grant_line");
        continue;
      }
      const idx = userIndex.get(currentUser) ?? -1;
      const entry = entries[idx];
      if (entry) entry.statements.push(line);
      continue;
    }
    // Lines we don't recognise (e.g. MySQL border separators) are
    // silently skipped; we never log raw line content.
  }

  return { entries, warnings };
}

// Re-export port constants for tests.
export const PUBLISH_PORTS = {
  webui: WEBUI_PORT,
  mcp: MCP_PORT,
  internalUpstream: INTERNAL_UPSTREAM_PORT
} as const;
