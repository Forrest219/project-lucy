import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseEvalSuite } from "./suite-schema.js";
import { BatchRejectedError, runOfflineBatch, type QueryExecutor, type SemanticQuerySuccess } from "./offline-batch.js";
import type { Identity } from "../proxy/identity.js";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function tableFromPayload(payload: unknown): Omit<SemanticQuerySuccess, "ok"> | null {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const result = record?.result && typeof record.result === "object" ? record.result as Record<string, unknown> : record;
  const content = Array.isArray(result?.content) ? result.content as Array<Record<string, unknown>> : [];
  const text = content.find((item) => typeof item.text === "string")?.text;
  const parsed = typeof text === "string" ? JSON.parse(text) as Record<string, unknown> : result;
  if (!parsed || !Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) return null;
  return {
    columns: parsed.columns.filter((item): item is string => typeof item === "string"),
    rows: parsed.rows as Array<Record<string, unknown>>,
    measures: Array.isArray(parsed.measures) ? parsed.measures.filter((item): item is string => typeof item === "string") : [],
    grain: Array.isArray(parsed.grain) ? parsed.grain.filter((item): item is string => typeof item === "string") : [],
    filters: Array.isArray(parsed.filters) ? parsed.filters as Array<{ field: string; value?: string }> : [],
    sql: typeof parsed.sql === "string" ? parsed.sql : undefined
  };
}

export function productionExecutor(userId: string): QueryExecutor {
  return async (request) => {
    const identity: Identity = { userId, tokenLabel: "offline-batch", tokenHashPrefix: "offline" };
    const { forwardAuthorizedLucyQuery } = await import("../proxy/mcp-proxy.js");
    const forwarded = await forwardAuthorizedLucyQuery(identity, {
      measures: request.measures,
      dimensions: request.grain,
      filters: request.filters,
      role_id: request.roleId
    });
    if (!forwarded.ok) return { ok: false, reason: forwarded.reason };
    try {
      const table = tableFromPayload(forwarded.payload);
      if (!table) return { ok: false, reason: "compile_other" };
      return { ok: true, ...table };
    } catch {
      return { ok: false, reason: "compile_other" };
    }
  };
}

async function boundRoles(projectRoot: string, domain: string): Promise<string[]> {
  try {
    const text = await readFile(path.join(projectRoot, ".ktx-ui/eval/monitor-config.json"), "utf8");
    const config = JSON.parse(text) as { domains?: Record<string, { roleIds?: string[] }> };
    return config.domains?.[domain]?.roleIds ?? [];
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const suitePath = arg("--suite");
  const asOf = arg("--as-of");
  const roleId = arg("--role-id") ?? "";
  const output = arg("--output") ?? "result.json";
  if (!suitePath || !asOf) {
    throw new Error("用法：--suite <yaml> --as-of <YYYY-MM-DD> --role-id <角色>");
  }
  const projectRoot = arg("--project-root") ?? process.cwd();
  const parsed = parseEvalSuite(await readFile(suitePath, "utf8"));
  if (!parsed.ok) {
    throw new Error(parsed.errors.map((item) => item.message).join("; "));
  }
  const result = await runOfflineBatch({
    suite: parsed.suite,
    asOf,
    timeZone: arg("--timezone"),
    roleId,
    boundRoleIds: await boundRoles(projectRoot, parsed.suite.domain),
    executor: productionExecutor(arg("--user-id") ?? "offline-batch")
  });
  await writeFile(output, JSON.stringify(result, null, 2));
  process.stdout.write(`${output}\n`);
}

const invoked = process.argv[1]?.includes("offline-batch-main");
if (invoked) {
  main().catch((error: unknown) => {
    const rejected = error instanceof BatchRejectedError;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(rejected ? 2 : 1);
  });
}
