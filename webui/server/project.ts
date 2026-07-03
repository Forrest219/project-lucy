import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import type { ConnectionInfo, ProjectInfo } from "./model";

export type ProjectOptions = {
  projectRoot?: string;
  argv?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

class ProjectError extends Error {
  code = "PROJECT_NOT_FOUND";
  statusCode = 404;
}

function valueAsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function passwordSource(value: unknown): ConnectionInfo["passwordSource"] | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  if (value.startsWith("file:")) {
    return "file";
  }
  if (value.startsWith("env:") || value.includes("${")) {
    return "env";
  }
  return "inline";
}

function normalizedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined;
}

function connectionEngine(conn: Record<string, unknown>): string | undefined {
  const explicit = normalizedString(conn.engine ?? conn.dialect ?? conn.database_engine);
  const driver = normalizedString(conn.driver);
  if (explicit) return explicit;
  if (!driver) return undefined;
  if (["doris", "apache-doris"].includes(driver)) return "doris";
  if (["starrocks", "starrocks-mysql"].includes(driver)) return "starrocks";
  if (driver.includes("postgres")) return "postgres";
  if (driver.includes("mysql")) return "mysql";
  return driver;
}

function wireProtocol(conn: Record<string, unknown>, engine?: string): ConnectionInfo["wireProtocol"] {
  const explicit = normalizedString(conn.wire_protocol ?? conn.protocol);
  if (explicit === "mysql" || explicit === "mysql-wire") return "mysql";
  if (explicit === "postgres" || explicit === "postgresql") return "postgres";
  if (explicit === "native") return "native";
  const driver = normalizedString(conn.driver);
  if (engine === "doris" || engine === "starrocks") return "mysql";
  if (driver?.includes("mysql")) return "mysql";
  if (driver?.includes("postgres")) return "postgres";
  return "unknown";
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1"].includes(normalized)) return true;
    if (["false", "no", "0"].includes(normalized)) return false;
  }
  return undefined;
}

async function hasKtxYaml(dir: string): Promise<boolean> {
  try {
    await access(path.join(dir, "ktx.yaml"));
    return true;
  } catch {
    return false;
  }
}

async function findProjectRoot(start: string): Promise<string> {
  let current = path.resolve(start);
  while (true) {
    if (await hasKtxYaml(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new ProjectError(`Could not find ktx.yaml from ${start}`);
    }
    current = parent;
  }
}

function projectArg(argv: string[]): string | undefined {
  const index = argv.indexOf("--project");
  if (index >= 0) {
    return argv[index + 1];
  }
  const inline = argv.find((arg) => arg.startsWith("--project="));
  return inline?.slice("--project=".length);
}

export async function resolveProjectRoot(options: ProjectOptions = {}): Promise<string> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const explicit = options.projectRoot ?? projectArg(argv) ?? env.KTX_PROJECT_ROOT;
  if (explicit) {
    const root = path.resolve(explicit);
    if (!(await hasKtxYaml(root))) {
      throw new ProjectError(`Project root ${root} does not contain ktx.yaml`);
    }
    return root;
  }
  return findProjectRoot(options.cwd ?? process.cwd());
}

export async function readProject(projectRoot: string): Promise<ProjectInfo> {
  const yamlText = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
  const config = valueAsRecord(parse(yamlText));
  const connectionsConfig = valueAsRecord(config.connections);
  const connections: ConnectionInfo[] = Object.entries(connectionsConfig).map(([id, raw]) => {
    const conn = valueAsRecord(raw);
    const explicitSchemas = stringArray(conn.schemas);
    const enabledTables = stringArray(conn.enabled_tables);
    const enabledSchemas = enabledTables.map((table) => table.split(".")[0]).filter(Boolean);
    const schemas = Array.from(new Set([...explicitSchemas, ...enabledSchemas])).sort();
    const engine = connectionEngine(conn);
    const readOnlyExpected = booleanValue(conn.readonly ?? conn.read_only ?? conn.readOnly) ?? true;
    return {
      id,
      driver: typeof conn.driver === "string" ? conn.driver : undefined,
      engine,
      wireProtocol: wireProtocol(conn, engine),
      r1Target: booleanValue(conn.r1_target ?? conn.r1Target) ?? engine === "doris",
      readOnlyExpected,
      passwordSource: passwordSource(conn.password),
      schemas,
      enabledTables
    };
  });

  return {
    root: projectRoot,
    connections,
    ktxAvailable: true
  };
}

export async function readConnections(projectRoot: string): Promise<ConnectionInfo[]> {
  return (await readProject(projectRoot)).connections;
}
