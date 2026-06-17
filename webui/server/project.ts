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
    const enabledSchemas = stringArray(conn.enabled_tables).map((table) => table.split(".")[0]).filter(Boolean);
    const schemas = Array.from(new Set([...explicitSchemas, ...enabledSchemas])).sort();
    return {
      id,
      driver: typeof conn.driver === "string" ? conn.driver : undefined,
      passwordSource: passwordSource(conn.password),
      schemas
    };
  });

  return {
    root: projectRoot,
    connections,
    ktxAvailable: true
  };
}
