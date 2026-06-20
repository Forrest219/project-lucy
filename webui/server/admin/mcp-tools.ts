import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import type { FastifyInstance } from "fastify";
import { resolveProjectRoot } from "../project.js";
import type { YamlAccessConfig } from "./agents.js";

const ACCESS_YAML_REL = "webui/config/access.yaml";

// Hard-coded known tools that the KTX MCP server exposes
// These serve as the candidate list when the proxy hasn't cached them
const KNOWN_TOOLS: Array<{ name: string; description: string }> = [
  { name: "sl_query", description: "使用语义层生成并执行 SQL" },
  { name: "sl_read_source", description: "读取语义层表定义" },
  { name: "sl_validate", description: "验证语义层定义" },
  { name: "wiki_search", description: "检索 wiki / reference docs" },
  { name: "wiki_read", description: "读取 wiki 文档" },
  { name: "entity_details", description: "查询实体详情" },
  { name: "dictionary_search", description: "搜索数据字典" },
  { name: "discover_data", description: "发现可用数据源" },
  { name: "connection_list", description: "列出可用数据库连接" },
  { name: "kx_catalog", description: "列出当前 agent 可访问的 KX 财务语义层 source" },
  { name: "sql_execution", description: "执行原始 SQL（受限）" },
  { name: "memory_ingest", description: "注入记忆" },
  { name: "memory_ingest_status", description: "查询记忆注入状态" }
];

export function registerMcpToolsRoutes(app: FastifyInstance) {
  app.get("/api/admin/mcp-tools", async () => {
    const projectRoot = await resolveProjectRoot();
    const filePath = path.join(projectRoot, ACCESS_YAML_REL);
    let denyTools: string[] = [];

    try {
      const raw = await readFile(filePath, "utf-8");
      const config = parse(raw) as YamlAccessConfig;
      denyTools = config.defaults?.deny_tools ?? [];

      // Collect user-level allowed tools as candidates (to augment KNOWN_TOOLS)
      const userTools = new Set<string>();
      for (const user of config.users ?? []) {
        for (const t of user.allow?.tools ?? []) {
          if (t !== "*") userTools.add(t);
        }
      }

      // Merge user tools into known tools list (avoid duplicates)
      const toolMap = new Map(KNOWN_TOOLS.map((t) => [t.name, t]));
      for (const t of userTools) {
        if (!toolMap.has(t)) toolMap.set(t, { name: t, description: "" });
      }

      const tools = [...toolMap.values()].map((t) => ({
        name: t.name,
        description: t.description || undefined,
        globalDenied: denyTools.includes(t.name)
      }));

      return { ok: true, data: { tools } };
    } catch {
      // Fallback: return known tools with empty deny list
      const tools = KNOWN_TOOLS.map((t) => ({
        name: t.name,
        description: t.description || undefined,
        globalDenied: denyTools.includes(t.name)
      }));
      return { ok: true, data: { tools } };
    }
  });
}
