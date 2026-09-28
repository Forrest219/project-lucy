import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
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
  if (isMysqlWire(input)) return true;
  return existing.database.trim() === (input.database ?? "").trim();
}

function usernamesMatch(existing: StoredConnection, input: CreateConnectionInput): boolean {
  const saved = existing.username.trim();
  if (!saved) return false;
  return saved === (input.username ?? "").trim();
}

function conflictSchema(input: CreateConnectionInput): string {
  const names = (input.schemas ?? []).map((item) => (typeof item === "string" ? item.trim() : ""));
  const resolved = isMysqlWire(input) && names.length === 0 ? [(input.database ?? "").trim()] : names;
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
  if (input.driver === "sqlite") return { action: "create" };

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
      throw new SameServerDifferentDatabaseError(
        "同一主机端口上的另一个 database 将新增一张连接卡片。",
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
