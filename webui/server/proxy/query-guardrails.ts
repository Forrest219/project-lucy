/**
 * WO-202610-15 — builtin measures, field disambiguation, and physical-name
 * aliases on the lucy_query / lucy_read_source path.
 *
 * The proxy calls `applyLucyCallGuard` before it forwards. Customer YAML is
 * read from the published semantic layer at runtime and is not committed.
 */
import { glob, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { loadContentPaths } from "../paths.js";
import { resolveProjectRoot } from "../project.js";
import {
  ambiguousFieldHint,
  resolveSourceAlias,
  type AmbiguityCandidateInput,
  type SourceAlias
} from "./source-ambiguity.js";
import { compileBuiltinMeasure } from "./question-experience.js";

export type AggregatedMeasure = { source?: string; name: string };

export type AmbiguityCatalog = {
  sources: AmbiguityCandidateInput[];
  aliases: SourceAlias[];
  aggregatedMeasures: AggregatedMeasure[];
};

export function queryGuardrailsEnabled(): boolean {
  return process.env.LUCY_QUERY_GUARDRAILS !== "off";
}

export type LucyCallGuard =
  | { action: "allow"; args: Record<string, unknown> }
  | { action: "stop"; reason: string; repair: string; failureDimension: "用法与语义" };

const EMPTY_CATALOG: AmbiguityCatalog = { sources: [], aliases: [], aggregatedMeasures: [] };
const CATALOG_TTL_MS = 60_000;

let cachedCatalog: { at: number; dir: string; catalog: AmbiguityCatalog } | null = null;

type SourceYaml = {
  name?: string;
  columns?: Array<{ name?: string } | string>;
  measures?: Array<{ name?: string; expr?: string } | string>;
};

type SchemaYaml = {
  tables?: Record<string, { table?: string }>;
};

function namesOf(items: SourceYaml["columns"]): string[] {
  const names: string[] = [];
  for (const item of items ?? []) {
    if (typeof item === "string" && item.trim()) names.push(item.trim());
    else if (item && typeof item === "object" && item.name?.trim()) names.push(item.name.trim());
  }
  return names;
}

function isAggregateExpr(expr: string | undefined): boolean {
  return Boolean(expr && /^\s*(sum|avg|min|max|count)\s*\(/i.test(expr));
}

export async function loadAmbiguityCatalogFromDir(semanticLayerDir: string): Promise<AmbiguityCatalog> {
  const sources: AmbiguityCandidateInput[] = [];
  const aliases: SourceAlias[] = [];
  const aggregatedMeasures: AggregatedMeasure[] = [];

  let files: string[] = [];
  try {
    for await (const entry of glob("**/*.yaml", { cwd: semanticLayerDir })) {
      files.push(entry);
    }
  } catch {
    return EMPTY_CATALOG;
  }
  files = files.filter((file) => !file.split(path.sep).includes("node_modules"));

  for (const relative of files) {
    const absolute = path.join(semanticLayerDir, relative);
    let parsed: SourceYaml & SchemaYaml;
    try {
      parsed = parse(await readFile(absolute, "utf8")) as SourceYaml & SchemaYaml;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const parts = relative.split(path.sep);
    const connectionId = parts[0] ?? "";
    const isSchema = parts.includes("_schema");

    if (isSchema && parsed.tables) {
      const schema = path.basename(relative, ".yaml");
      for (const [sourceName, tableDef] of Object.entries(parsed.tables)) {
        if (!tableDef?.table) continue;
        aliases.push({
          physicalTable: tableDef.table,
          sourceName,
          connectionId,
          schema
        });
      }
      continue;
    }

    const sourceName = (parsed.name ?? path.basename(relative, ".yaml")).trim();
    if (!sourceName || sourceName.startsWith("_")) continue;
    const columns = namesOf(parsed.columns);
    const measureNames = namesOf(parsed.measures);
    if (columns.length === 0 && measureNames.length === 0) continue;
    sources.push({
      connectionId,
      sourceName,
      columns: columns.map((name) => ({ name })),
      measures: measureNames.map((name) => ({ name }))
    });
    for (const measure of parsed.measures ?? []) {
      if (!measure || typeof measure !== "object" || !measure.name) continue;
      if (isAggregateExpr(measure.expr)) {
        aggregatedMeasures.push({ source: sourceName, name: measure.name.trim() });
      }
    }
  }

  return { sources, aliases, aggregatedMeasures };
}

export async function loadPublishedAmbiguityCatalog(): Promise<AmbiguityCatalog> {
  const projectRoot = await resolveProjectRoot();
  const paths = await loadContentPaths();
  const semanticLayerDir = path.resolve(projectRoot, paths.semanticLayer);
  const now = Date.now();
  if (cachedCatalog && cachedCatalog.dir === semanticLayerDir && now - cachedCatalog.at < CATALOG_TTL_MS) {
    return cachedCatalog.catalog;
  }
  const catalog = await loadAmbiguityCatalogFromDir(semanticLayerDir);
  cachedCatalog = { at: now, dir: semanticLayerDir, catalog };
  return catalog;
}

export function resetAmbiguityCatalogCache(): void {
  cachedCatalog = null;
}

function asRecord(args: unknown): Record<string, unknown> | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  return args as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function sourceOf(record: Record<string, unknown>): string | undefined {
  return stringField(record, ["sourceName", "source_name", "source", "table"]);
}

function visibleSource(source: AmbiguityCandidateInput, readable: ReadonlySet<string>): boolean {
  if (readable.has("*")) return true;
  if (readable.has(source.sourceName)) return true;
  if (source.connectionId && readable.has(`${source.connectionId}.${source.sourceName}`)) return true;
  return false;
}

function unqualifiedFields(record: Record<string, unknown>): Array<{ kind: "column" | "measure"; field: string }> {
  const found: Array<{ kind: "column" | "measure"; field: string }> = [];
  const push = (kind: "column" | "measure", value: unknown) => {
    if (typeof value !== "string") return;
    const field = value.trim();
    if (!field || field.includes(".")) return;
    if (field.includes("(")) return;
    found.push({ kind, field });
  };
  const measures = record.measures;
  if (Array.isArray(measures)) {
    for (const item of measures) {
      if (typeof item === "string") push("measure", item);
      else if (item && typeof item === "object" && "name" in item) push("measure", (item as { name?: unknown }).name);
    }
  }
  for (const key of ["dimensions", "order_by", "orderBy"]) {
    const items = record[key];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (item && typeof item === "object" && "field" in item) push("column", (item as { field?: unknown }).field);
    }
  }
  const filters = record.filters;
  const filterItems = Array.isArray(filters) ? filters : filters ? [filters] : [];
  for (const item of filterItems) {
    if (item && typeof item === "object" && "field" in item) push("column", (item as { field?: unknown }).field);
  }
  return found;
}

function guardMeasures(record: Record<string, unknown>, aggregated: readonly AggregatedMeasure[]): LucyCallGuard | null {
  const source = sourceOf(record);
  const measures = record.measures;
  if (!Array.isArray(measures)) return null;
  const namesForSource = aggregated
    .filter((item) => !item.source || !source || item.source === source || source.endsWith(`.${item.source}`) || source.endsWith(`/${item.source}`))
    .map((item) => item.name);
  const denominator = stringField(record, ["completenessDenominator", "completeness_denominator"]);
  for (const item of measures) {
    const measure = typeof item === "string"
      ? item
      : item && typeof item === "object" && typeof (item as { expr?: unknown }).expr === "string"
        ? (item as { expr: string }).expr
        : "";
    if (!measure.trim()) continue;
    const itemDenominator = item && typeof item === "object"
      ? stringField(item as Record<string, unknown>, ["denominator", "completenessDenominator"])
      : undefined;
    const decision = compileBuiltinMeasure({
      measure,
      source,
      aggregatedMeasures: namesForSource,
      completenessDenominator: itemDenominator ?? denominator
    });
    if (decision.action === "repair") {
      return { action: "stop", reason: decision.reason, repair: decision.repair, failureDimension: "用法与语义" };
    }
    if (decision.action === "reject") {
      return { action: "stop", reason: decision.reason, repair: decision.message, failureDimension: "用法与语义" };
    }
  }
  return null;
}

function requestedSource(record: Record<string, unknown>): string | undefined {
  return stringField(record, ["sourceName", "source_name", "source", "table"]);
}

function isReadableName(name: string, readable: ReadonlySet<string>): boolean {
  if (readable.has("*") || readable.has(name)) return true;
  return [...readable].some((entry) => entry.endsWith(`.${name}`) || entry.endsWith(`/${name}`));
}

export function applyLucyCallGuard(input: {
  toolName: string;
  args: unknown;
  readableSourceNames: ReadonlySet<string> | null;
  catalog: AmbiguityCatalog;
}): LucyCallGuard {
  const record = asRecord(input.args);
  if (!record) {
    return {
      action: "allow",
      args: input.args && typeof input.args === "object" ? input.args as Record<string, unknown> : {}
    };
  }

  if (input.toolName === "lucy_query") {
    const measureStop = guardMeasures(record, input.catalog.aggregatedMeasures);
    if (measureStop) return measureStop;
    if (input.readableSourceNames) {
      const visible = input.catalog.sources.filter((source) => visibleSource(source, input.readableSourceNames!));
      for (const field of unqualifiedFields(record)) {
        const hint = ambiguousFieldHint({ kind: field.kind, field: field.field, sources: visible });
        if (!hint) continue;
        return { action: "stop", reason: "ambiguous_field", repair: hint.repair, failureDimension: "用法与语义" };
      }
    }
    return { action: "allow", args: record };
  }

  if (input.toolName === "lucy_read_source" && input.readableSourceNames) {
    const requested = requestedSource(record);
    if (!requested || isReadableName(requested, input.readableSourceNames)) {
      return { action: "allow", args: record };
    }
    const resolution = resolveSourceAlias(requested, input.catalog.aliases, input.readableSourceNames);
    if (resolution.status === "resolved") {
      return {
        action: "allow",
        args: {
          ...record,
          sourceName: resolution.sourceName,
          ...(resolution.connectionId ? { connectionId: record.connectionId ?? resolution.connectionId } : {}),
          ...(resolution.schema ? { schema: record.schema ?? resolution.schema } : {})
        }
      };
    }
    return { action: "stop", reason: "source_not_found", repair: resolution.repair, failureDimension: "用法与语义" };
  }

  return { action: "allow", args: record };
}
