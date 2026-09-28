import { ApiError } from "./apiClient";

export type EndpointMatch = {
  id: string;
  driver: string;
  host: string;
  port: string;
  database: string;
  username: string;
  schemas: string[];
};

export type EndpointGateState =
  | {
      kind: "endpoint";
      reason: "multiple" | "username_differs" | "reuse_existing_credentials";
      schema?: string;
      matches: EndpointMatch[];
      message: string;
    }
  | {
      kind: "schema_exists";
      connectionId: string;
      schema: string;
      message: string;
    }
  | {
      kind: "schema_count";
      actual: number;
      message: string;
    }
  | {
      kind: "different_database";
      matches: EndpointMatch[];
      requestedDatabase: string;
      message: string;
    };

function isMatch(value: unknown): value is EndpointMatch {
  if (!value || typeof value !== "object") return false;
  const row = value as EndpointMatch;
  return typeof row.id === "string" && Array.isArray(row.schemas);
}

function matchesOf(value: unknown): EndpointMatch[] {
  return Array.isArray(value) ? value.filter(isMatch) : [];
}

export function readEndpointGate(err: unknown): EndpointGateState | null {
  if (!(err instanceof ApiError) || !err.detail || typeof err.detail !== "object") return null;
  const detail = err.detail as Record<string, unknown>;
  if (err.code === "ENDPOINT_ALREADY_CONNECTED") {
    const reason = detail.reason;
    if (reason !== "multiple" && reason !== "username_differs" && reason !== "reuse_existing_credentials") {
      return null;
    }
    return {
      kind: "endpoint",
      reason,
      ...(typeof detail.schema === "string" ? { schema: detail.schema } : {}),
      matches: matchesOf(detail.matches),
      message: err.message
    };
  }
  if (err.code === "SCHEMA_ALREADY_ON_CONNECTION" && typeof detail.connectionId === "string") {
    return {
      kind: "schema_exists",
      connectionId: detail.connectionId,
      schema: typeof detail.schema === "string" ? detail.schema : "",
      message: err.message
    };
  }
  if (err.code === "ENDPOINT_SCHEMA_COUNT") {
    return {
      kind: "schema_count",
      actual: typeof detail.actual === "number" ? detail.actual : 0,
      message: err.message
    };
  }
  if (err.code === "SAME_SERVER_DIFFERENT_DATABASE") {
    return {
      kind: "different_database",
      matches: matchesOf(detail.matches),
      requestedDatabase: typeof detail.requestedDatabase === "string" ? detail.requestedDatabase : "",
      message: err.message
    };
  }
  return null;
}

export function singleConflictSchema(input: {
  driver: string;
  engine?: string;
  database: string;
  schemas: string[];
}): string | null {
  const engine = (input.engine ?? "").toLowerCase();
  const mysql =
    input.driver === "mysql" ||
    engine === "mysql" ||
    engine === "starrocks" ||
    engine === "doris";
  const names = input.schemas.map((item) => item.trim()).filter(Boolean);
  const resolved = mysql && names.length === 0 ? [input.database.trim()].filter(Boolean) : names;
  return resolved.length === 1 ? resolved[0] : null;
}
