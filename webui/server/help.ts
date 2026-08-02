import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertReadable } from "./fs-safe.js";

const HANDBOOK_REL_PATH = "docs/SYSTEM_HANDBOOK.md";
const DEFAULT_APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^```/;

const SECTION_ALIASES: Array<[RegExp, string]> = [
  [/常见问题速查/, "faq-quick-reference"],
  [/面向开发者/, "faq-developer"],
  [/面向管理员/, "faq-admin"],
  [/面向接入协作者|面向接入 Agent 的协作者|接入 Agent 的协作者/, "faq-agent-integration"],
  [/系统概述与架构拓扑/, "system-overview"],
  [/快速上手/, "quick-start"],
  [/部署向导与上线检查/, "deployment-checklist"],
  [/数据库接入/, "database-connections"],
  [/WebUI 与 ktx\.yaml 的职责边界|职责边界|WebUI Boundary/i, "database-connection-boundary"],
  [/连接形态与配置字段|Connection Shape/i, "database-connection-shapes"],
  [/新增数据库连接（运维 Runbook）|Database Connection Operations/i, "database-connection-operations-runbook"],
  [/Agent 可见性与 ACL 同步|ACL 同步/i, "database-connection-acl-sync"],
  [/表白名单/, "table-whitelist"],
  [/刷新本地目录|静态 Catalog reload|Catalog Reload|Reload Catalog/i, "catalog-reload"],
  [/语义层维护/, "semantic-layer"],
  [/表目录/, "semantic-catalog"],
  [/表语义编辑|Human vs AI/, "semantic-table-editor"],
  [/关联关系|Joins/i, "semantic-joins"],
  [/业务文档 Wiki|业务 Wiki/, "business-wiki"],
  [/访问治理 Admin/, "admin-governance"],
  [/Agent 实例/, "admin-agents"],
  [/Role 权限模板|角色配置/, "admin-roles"],
  [/Bearer Token|Token 发行/, "admin-tokens"],
  [/MCP 访问日志|问题簇|审计/, "admin-audit"],
  [/质量评测 Eval/, "eval"],
  [/Eval Case|Case 维护/, "eval-cases"],
  [/Run 试跑|运行历史/, "eval-runs"],
  [/趋势监控/, "eval-monitor"],
  [/YAML 文件规范与交付验收|YAML Delivery/i, "yaml-delivery-runbook"],
  [/YAML 类型总览/, "yaml-type-overview"],
  [/Schema manifest 规范|Schema Manifest/i, "yaml-schema-manifest"],
  [/Manifest augmentation overlay|Augmentation Overlay|Overlay 规范/i, "yaml-augmentation-overlay"],
  [/New semantic source 规范|New Semantic Source/i, "yaml-new-semantic-source"],
  [/描述字段规范/, "yaml-description-fields"],
  [/GO \/ NO-GO|交付 checklist|交付验收/i, "yaml-delivery-checklist"],
  [/常见错误与修复|常见错误与诊断|诊断 Runbook/i, "yaml-common-errors"],
  [/Agent 自检协议/, "yaml-agent-self-check"],
  [/Agent \/ 客户端接入指南|MCP Integration Guide/, "mcp-integration"],
  [/配置与环境变量速查/, "configuration-reference"],
  [/FAQ 与排障指南/, "troubleshooting"],
  [/MCP 返回 401/, "mcp-401"],
  [/KTX upstream 不可用/, "ktx-upstream-unavailable"],
  [/安全边界速查/, "security-boundaries"],
  [/审阅|校验/, "review-validate"],
  [/WebUI 入口速查/, "webui-entry-map"]
];

const DATABASE_OPS_HEADING_TITLES = new Set([
  "WebUI 与 ktx.yaml 的职责边界",
  "刷新本地目录",
  "连接形态与配置字段",
  "新增数据库连接（运维 Runbook）",
  "Agent 可见性与 ACL 同步"
]);

export type HelpTocItem = {
  id: string;
  level: 2 | 3 | 4;
  title: string;
};

export type HelpHandbook = {
  id: "system-handbook";
  title: string;
  sourcePath: typeof HANDBOOK_REL_PATH;
  updatedAt: string;
  etag: string;
  toc: HelpTocItem[];
  markdown: string;
};

export class HelpDocNotFoundError extends Error {
  code = "ERR_HELP_DOC_NOT_FOUND";
  statusCode = 404;

  constructor() {
    super(`${HANDBOOK_REL_PATH} was not found`);
    this.name = "HelpDocNotFoundError";
  }
}

export function resolveHelpAppRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.LUCY_APP_ROOT ?? DEFAULT_APP_ROOT);
}

function stableSlug(title: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii) return ascii;
  return createHash("sha1").update(title).digest("hex").slice(0, 10);
}

function sectionIdFor(title: string): string {
  const cleanTitle = title.replace(/^\d+(?:\.\d+)*\s*/, "").trim();
  const alias = SECTION_ALIASES.find(([pattern]) => pattern.test(cleanTitle));
  return alias?.[1] ?? stableSlug(cleanTitle);
}

function dedupeId(base: string, used: Map<string, number>): string {
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

export function parseHelpToc(markdown: string): HelpTocItem[] {
  const used = new Map<string, number>();
  const items: HelpTocItem[] = [];
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (FENCE_RE.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(HEADING_RE);
    const rawLevel = match?.[1]?.length ?? 1;
    const title = (match?.[2] ?? "").trim();
    const yamlRunbookSubheading = rawLevel === 4 && /^3\.7\.\d+/.test(title);
    const cleanTitle = title.replace(/^\d+(?:\.\d+)*\.?\s*/, "").trim();
    const databaseOpsSubheading = rawLevel === 4 && DATABASE_OPS_HEADING_TITLES.has(cleanTitle);
    if (!match || rawLevel < 2 || (rawLevel > 3 && !yamlRunbookSubheading && !databaseOpsSubheading)) continue;
    // 3.7.x 子标题为兼容性保留 level 3；3.2.x 运维 Runbook 子标题按真实 level 4 输出。
    const level: 2 | 3 | 4 = yamlRunbookSubheading
      ? (Math.min(rawLevel, 3) as 2 | 3)
      : (rawLevel as 2 | 3 | 4);
    items.push({
      id: dedupeId(sectionIdFor(title), used),
      level,
      title
    });
  }
  return items;
}

export async function readHelpHandbook(appRoot = resolveHelpAppRoot()): Promise<HelpHandbook> {
  let target: string;
  try {
    target = await assertReadable(appRoot, HANDBOOK_REL_PATH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new HelpDocNotFoundError();
    }
    throw error;
  }

  let markdown: string;
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    [markdown, info] = await Promise.all([
      readFile(target, "utf8"),
      stat(target)
    ]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new HelpDocNotFoundError();
    }
    throw error;
  }

  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "Project Lucy 系统使用与运维手册";
  const hash = createHash("sha256").update(markdown).digest("hex");
  return {
    id: "system-handbook",
    title,
    sourcePath: HANDBOOK_REL_PATH,
    updatedAt: info.mtime.toISOString(),
    etag: `sha256:${hash}`,
    toc: parseHelpToc(markdown),
    markdown
  };
}

export function handbookPathForTests(projectRoot: string): string {
  return path.join(projectRoot, HANDBOOK_REL_PATH);
}
