import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { externalCatalogName, schemaNameFromDatabase, splitCatalogDatabase } from "./catalog-database.js";
import type { CreateConnectionInput } from "./project.js";

const SCHEMA_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;
const MYSQL_WIRE_ENGINES = new Set(["mysql", "starrocks", "doris"]);

export type EndpointMatch = {
  id: string;
  driver: string;
  host: string;
  port: string;
  database: string;
  username: string;
  schemas: string[];
};

export type EndpointFlags = {
  acknowledgeSeparateConnection?: boolean;
  acknowledgeDifferentDatabase?: boolean;
};

export type EndpointGateDecision = {
  action: "create";
  acknowledgedSeparateEndpoint?: boolean;
  acknowledgedDifferentDatabase?: boolean;
};

type StoredConnection = EndpointMatch;

export class EndpointAlreadyConnectedError extends Error {
  code = "ENDPOINT_ALREADY_CONNECTED";
  statusCode = 409;
  detail: {
    reason: "multiple" | "username_differs" | "reuse_existing_credentials";
    schema?: string;
    matches: EndpointMatch[];
  };

  constructor(
    message: string,
    detail: EndpointAlreadyConnectedError["detail"]
  ) {
    super(message);
    this.name = "EndpointAlreadyConnectedError";
    this.detail = detail;
  }
}

export class SchemaAlreadyOnConnectionError extends Error {
  code = "SCHEMA_ALREADY_ON_CONNECTION";
  statusCode = 409;
  detail: { connectionId: string; schema: string };

  constructor(message: string, detail: SchemaAlreadyOnConnectionError["detail"]) {
    super(message);
    this.name = "SchemaAlreadyOnConnectionError";
    this.detail = detail;
  }
}

export class EndpointSchemaCountError extends Error {
  code = "ENDPOINT_SCHEMA_COUNT";
  statusCode = 400;
  detail: { actual: number };

  constructor(message: string, actual: number) {
    super(message);
    this.name = "EndpointSchemaCountError";
    this.detail = { actual };
  }
}

export class SameServerDifferentDatabaseError extends Error {
  code = "SAME_SERVER_DIFFERENT_DATABASE";
  statusCode = 409;
  detail: { matches: EndpointMatch[]; requestedDatabase: string };

  constructor(message: string, detail: SameServerDifferentDatabaseError["detail"]) {
    super(message);
    this.name = "SameServerDifferentDatabaseError";
    this.detail = detail;
  }
}

export function normalizeHost(host: string): string {
  const text = host.trim().toLowerCase();
  if (text.startsWith("[") && text.endsWith("]") && text.length > 2) {
    return text.slice(1, -1);
  }
  return text;
}

function isMysqlWire(input: Pick<CreateConnectionInput, "driver" | "engine">): boolean {
  return input.driver === "mysql" || MYSQL_WIRE_ENGINES.has((input.engine ?? "").toLowerCase());
}

function textField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function portText(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function sameServer(existing: StoredConnection, input: CreateConnectionInput): boolean {
  if (input.driver === "sqlite" || existing.driver === "sqlite") return false;
  if (existing.driver !== input.driver) return false;
  if (!input.host || normalizeHost(existing.host) !== normalizeHost(input.host)) return false;
  if (input.port == null) return false;
  const existingPort = Number(existing.port);
  return Number.isInteger(existingPort) && existingPort === input.port;
}

function endpointMatches(existing: StoredConnection, input: CreateConnectionInput): boolean {
  if (!sameServer(existing, input)) return false;
  const requested = (input.database ?? "").trim();
  const saved = existing.database.trim();
  if (!isMysqlWire(input)) return saved === requested;
  const requestedCatalog = externalCatalogName(requested);
  const savedCatalog = externalCatalogName(saved);
  // Plain MySQL still matches on host and port. An external directory such as
  // hive_jd is not the same connection as hive or an unqualified internal database.
  if (requestedCatalog || savedCatalog) return requestedCatalog === savedCatalog;
  return true;
}

function usernamesMatch(existing: StoredConnection, input: CreateConnectionInput): boolean {
  const saved = existing.username.trim();
  if (!saved) return false;
  return saved === (input.username ?? "").trim();
}

function conflictSchema(input: CreateConnectionInput): string {
  const names = (input.schemas ?? []).map((item) => (typeof item === "string" ? item.trim() : ""));
  const resolved =
    isMysqlWire(input) && names.length === 0 ? [schemaNameFromDatabase(input.database)] : names;
  const schema = resolved[0] ?? "";
  if (resolved.length !== 1 || !SCHEMA_NAME_RE.test(schema)) {
    throw new EndpointSchemaCountError(
      "该主机端口已有连接时，一次只能添加一个 Schema。",
      resolved.length
    );
  }
  return schema;
}

function publicMatch(row: StoredConnection): EndpointMatch {
  return {
    id: row.id,
    driver: row.driver,
    host: row.host,
    port: row.port,
    database: row.database,
    username: row.username,
    schemas: [...row.schemas]
  };
}

export function decideEndpointGate(
  connections: StoredConnection[],
  input: CreateConnectionInput,
  flags: EndpointFlags = {}
): EndpointGateDecision {
  if (input.driver === "sqlite" || input.driver === "athena") return { action: "create" };

  const endpoint = connections.filter((row) => endpointMatches(row, input));
  const schema = endpoint.length > 0 ? conflictSchema(input) : null;
  if (endpoint.length > 1) {
    throw new EndpointAlreadyConnectedError("请选择要把 Schema 加到哪一条连接。", {
      reason: "multiple",
      matches: endpoint.map(publicMatch)
    });
  }

  if (endpoint.length === 1) {
    return decideUniqueEndpoint(endpoint[0], input, flags, schema!);
  }

  const sameServerHits = connections.filter((row) => sameServer(row, input));
  if (sameServerHits.length > 0) {
    conflictSchema(input);
    if (flags.acknowledgeDifferentDatabase !== true) {
      const differentCatalog = Boolean(splitCatalogDatabase((input.database ?? "").trim()));
      throw new SameServerDifferentDatabaseError(
        differentCatalog
          ? "这是另一个外部目录，不会加到已有连接。确认后将新增一张连接卡片。"
          : "同一主机端口上的另一个 database 将新增一张连接卡片。",
        {
          matches: sameServerHits.map(publicMatch),
          requestedDatabase: (input.database ?? "").trim()
        }
      );
    }
    return { action: "create", acknowledgedDifferentDatabase: true };
  }

  return { action: "create" };
}

function decideUniqueEndpoint(
  target: StoredConnection,
  input: CreateConnectionInput,
  flags: EndpointFlags,
  schema: string
): EndpointGateDecision {
  if (!usernamesMatch(target, input)) {
    if (flags.acknowledgeSeparateConnection === true) {
      return { action: "create", acknowledgedSeparateEndpoint: true };
    }
    throw new EndpointAlreadyConnectedError("已有连接使用另一用户名。默认不复用该连接。", {
      reason: "username_differs",
      schema,
      matches: [publicMatch(target)]
    });
  }
  if (target.schemas.includes(schema)) {
    throw new SchemaAlreadyOnConnectionError(`该 Schema 已在连接「${target.id}」上。`, {
      connectionId: target.id,
      schema
    });
  }
  if (flags.acknowledgeSeparateConnection === true) {
    return { action: "create", acknowledgedSeparateEndpoint: true };
  }
  throw new EndpointAlreadyConnectedError(
    "主机端口已有连接。添加 Schema 将使用已有凭据，新输入的密码不会保存。",
    {
      reason: "reuse_existing_credentials",
      schema,
      matches: [publicMatch(target)]
    }
  );
}

function storedConnections(config: unknown): StoredConnection[] {
  if (!config || typeof config !== "object") return [];
  const connections = (config as { connections?: unknown }).connections;
  if (!connections || typeof connections !== "object" || Array.isArray(connections)) return [];
  const rows: StoredConnection[] = [];
  for (const [id, raw] of Object.entries(connections)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const port = portText(row.port);
    const schemas = Array.isArray(row.schemas)
      ? row.schemas.filter((item): item is string => typeof item === "string")
      : [];
    rows.push({
      id,
      driver: textField(row.driver),
      host: textField(row.host),
      port: port ?? "",
      database: textField(row.database ?? row.db ?? row.dbname),
      username: textField(row.username),
      schemas
    });
  }
  return rows;
}

export async function assertEndpointGate(
  root: string,
  input: CreateConnectionInput,
  flags: EndpointFlags = {}
): Promise<EndpointGateDecision> {
  const text = await readFile(path.join(root, "ktx.yaml"), "utf8");
  return decideEndpointGate(storedConnections(parse(text)), input, flags);
}

/** Flags for Spec lucy-20261101-connection-endpoint-edit (not Spec 160 create). */
export type EndpointEditFlags = {
  acknowledgeSharedEndpoint?: boolean;
  acknowledgeSameServerDifferentDatabase?: boolean;
};

export type EndpointEditCandidate = {
  driver: string;
  engine?: string;
  host: string;
  port: number;
  database: string;
  username: string;
};

export class EndpointEditConflictError extends Error {
  code = "ENDPOINT_EDIT_CONFLICT";
  statusCode = 409;
  detail: {
    reason: "shared_endpoint" | "multiple" | "same_server_different_database";
    matches: EndpointMatch[];
    requestedDatabase?: string;
  };

  constructor(message: string, detail: EndpointEditConflictError["detail"]) {
    super(message);
    this.name = "EndpointEditConflictError";
    this.detail = detail;
  }
}

export type EndpointEditGateDecision = {
  action: "allow";
  acknowledgedSharedEndpoint?: boolean;
  acknowledgedSameServerDifferentDatabase?: boolean;
};

/**
 * Edit-path soft gate: reuses Spec 160 match keys, excludes `connId`, never calls
 * `conflictSchema` / create decision branches.
 */
export function decideEndpointEditGate(
  connections: StoredConnection[],
  connId: string,
  candidate: EndpointEditCandidate,
  flags: EndpointEditFlags = {}
): EndpointEditGateDecision {
  if (candidate.driver === "sqlite" || candidate.driver === "athena") {
    return { action: "allow" };
  }

  const asCreateInput: CreateConnectionInput = {
    id: connId,
    driver: candidate.driver as CreateConnectionInput["driver"],
    ...(candidate.engine ? { engine: candidate.engine } : {}),
    host: candidate.host,
    port: candidate.port,
    database: candidate.database,
    username: candidate.username,
    schemas: []
  };

  const others = connections.filter((row) => row.id !== connId);
  const endpoint = others.filter((row) => endpointMatches(row, asCreateInput));

  if (endpoint.length === 1) {
    if (flags.acknowledgeSharedEndpoint === true) {
      return { action: "allow", acknowledgedSharedEndpoint: true };
    }
    throw new EndpointEditConflictError("新服务器地址与另一条连接相同。", {
      reason: "shared_endpoint",
      matches: endpoint.map(publicMatch)
    });
  }

  if (endpoint.length > 1) {
    if (flags.acknowledgeSharedEndpoint === true) {
      return { action: "allow", acknowledgedSharedEndpoint: true };
    }
    throw new EndpointEditConflictError("新服务器地址与多条连接相同。", {
      reason: "multiple",
      matches: endpoint.map(publicMatch)
    });
  }

  const sameServerHits = others.filter((row) => sameServer(row, asCreateInput));
  if (sameServerHits.length > 0) {
    if (flags.acknowledgeSameServerDifferentDatabase === true) {
      return { action: "allow", acknowledgedSameServerDifferentDatabase: true };
    }
    throw new EndpointEditConflictError(
      "新服务器地址与另一条连接位于同一主机端口但 database 不同。",
      {
        reason: "same_server_different_database",
        matches: sameServerHits.map(publicMatch),
        requestedDatabase: candidate.database.trim()
      }
    );
  }

  return { action: "allow" };
}

export async function assertEndpointEditGate(
  root: string,
  connId: string,
  candidate: EndpointEditCandidate,
  flags: EndpointEditFlags = {}
): Promise<EndpointEditGateDecision> {
  const text = await readFile(path.join(root, "ktx.yaml"), "utf8");
  return decideEndpointEditGate(storedConnections(parse(text)), connId, candidate, flags);
}

export function loadStoredConnectionsFromYaml(text: string): StoredConnection[] {
  return storedConnections(parse(text));
}
