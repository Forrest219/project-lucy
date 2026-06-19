import { readFile, stat } from "node:fs/promises";
import { glob } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { resolveProjectRoot } from "../project.js";
import { getAccessConfig } from "./identity.js";
import type { Identity } from "./identity.js";

export interface AclDecision {
  allowed: boolean;
  reason?: string; // 'tool_forbidden' | 'table_forbidden:<table>' | 'tool_default_deny'
}

// ─── sourceName → "schema.table" cache ───────────────────────────────────────

interface SourceMapEntry {
  physicalTable: string; // e.g. "dataforai.superstore_orders"
}

let sourceMap: Map<string, SourceMapEntry> = new Map();
let sourceMapLoadedAt = 0;
const SOURCE_MAP_TTL = 60_000;

interface SchemaYaml {
  tables?: Record<string, { table?: string }>;
}

async function loadSourceMap(): Promise<Map<string, SourceMapEntry>> {
  const now = Date.now();
  if (sourceMap.size > 0 && now - sourceMapLoadedAt < SOURCE_MAP_TTL) return sourceMap;

  const projectRoot = await resolveProjectRoot();
  const semanticLayerDir = path.join(projectRoot, "semantic-layer");

  // Collect all _schema/*.yaml files
  const schemaFiles: string[] = [];
  try {
    for await (const entry of glob("**/_schema/*.yaml", { cwd: semanticLayerDir })) {
      schemaFiles.push(path.join(semanticLayerDir, entry));
    }
  } catch {
    // semantic-layer may not exist yet
    return sourceMap;
  }

  const newMap = new Map<string, SourceMapEntry>();

  for (const schemaFile of schemaFiles) {
    try {
      const content = await readFile(schemaFile, "utf-8");
      const yaml = parse(content) as SchemaYaml;
      if (!yaml?.tables) continue;
      for (const [sourceName, tableDef] of Object.entries(yaml.tables)) {
        if (tableDef?.table) {
          newMap.set(sourceName, { physicalTable: tableDef.table });
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  sourceMap = newMap;
  sourceMapLoadedAt = now;
  return sourceMap;
}

function sourceNameToTable(sourceName: string, map: Map<string, SourceMapEntry>): string {
  return map.get(sourceName)?.physicalTable ?? sourceName;
}

export async function extractTables(toolName: string, args: unknown): Promise<string[]> {
  const a = args as Record<string, unknown> | undefined;
  if (!a) return [];

  const map = await loadSourceMap();
  const tables = new Set<string>();

  switch (toolName) {
    case "sl_query": {
      // measures: ["superstore_orders.total_sales", "sum(superstore_orders.sales)"]
      // dimensions: [{field: "superstore_orders.region"}, ...]
      for (const m of (a.measures as string[] | undefined) ?? []) {
        const raw = m.replace(/^[a-z_]+\(/, "").replace(/\)$/, ""); // strip aggregate fn
        const sourceName = raw.split(".")[0];
        if (sourceName) tables.add(sourceNameToTable(sourceName, map));
      }
      for (const d of (a.dimensions as Array<{ field?: string }> | undefined) ?? []) {
        const sourceName = d?.field?.split(".")[0];
        if (sourceName) tables.add(sourceNameToTable(sourceName, map));
      }
      break;
    }
    case "sl_read_source": {
      const sourceName = a.sourceName as string | undefined;
      if (sourceName) tables.add(sourceNameToTable(sourceName, map));
      break;
    }
    case "entity_details": {
      for (const e of (a.entities as Array<{ table?: string }> | undefined) ?? []) {
        if (e?.table) tables.add(e.table);
      }
      break;
    }
    default:
      break;
  }

  return [...tables].filter(Boolean);
}

// ─── ACL check ────────────────────────────────────────────────────────────────

export async function check(
  identity: Identity,
  toolName: string,
  args: unknown
): Promise<AclDecision> {
  const config = await getAccessConfig();

  // 1. Global deny_tools
  const denyTools = config.defaults?.deny_tools ?? [];
  if (denyTools.includes(toolName)) {
    return { allowed: false, reason: "tool_default_deny" };
  }

  const user = config.users.find((u) => u.id === identity.userId);
  if (!user?.allow) {
    // No allow block = deny everything
    return { allowed: false, reason: "tool_forbidden" };
  }

  const { tools: allowedTools, tables: allowedTables } = user.allow;

  // 2. Tool-level check
  if (allowedTools && !allowedTools.includes("*") && !allowedTools.includes(toolName)) {
    return { allowed: false, reason: "tool_forbidden" };
  }

  // 3. Table-level check (only for tools that touch tables)
  const tableTouchingTools = new Set(["sl_query", "sl_read_source", "entity_details"]);
  if (tableTouchingTools.has(toolName)) {
    if (allowedTables && !allowedTables.includes("*")) {
      const requested = await extractTables(toolName, args);
      for (const table of requested) {
        if (!allowedTables.includes(table)) {
          return { allowed: false, reason: `table_forbidden:${table}` };
        }
      }
    }
  }

  return { allowed: true };
}
