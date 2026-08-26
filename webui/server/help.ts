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
  [/系统概览待处理事项/, "overview-action-required"],
  [/数据库接入/, "database-connections"],
  [/WebUI 与 ktx\.yaml 的职责边界|职责边界|WebUI Boundary/i, "database-connection-boundary"],
  [/连接形态与配置字段|Connection Shape/i, "database-connection-shapes"],
  [/新增数据库连接（运维 Runbook）|Database Connection Operations/i, "database-connection-operations-runbook"],
  [/Agent 可见性与 ACL 同步|ACL 同步/i, "database-connection-acl-sync"],
  [/表白名单/, "table-whitelist"],
  [/刷新本地目录|静态 Catalog reload|Catalog Reload|Reload Catalog/i, "catalog-reload"],
  [/连接概览指标说明/, "connection-overview-metrics"],
  [/语义层维护/, "semantic-layer"],
  [/语义状态与启用表范围状态/, "semantic-status-and-enabled-status"],
  [/为什么要编写语义 YAML|编写语义 YAML/, "semantic-yaml-why"],
  [/推荐编写工作流|语义编写工作流/, "semantic-authoring-workflow"],
  [/grain、join 与 fanout|grain.*fanout/i, "semantic-grain-fanout"],
  [/^overlay 常见字段速查$/, "semantic-overlay-fields"],
  [/KTX 官方延伸阅读/, "ktx-further-reading"],
  [/表目录/, "semantic-catalog"],
  [/表语义编辑|Human vs AI/, "semantic-table-editor"],
  [/关联关系|Joins/i, "semantic-joins"],
  [/业务文档 Wiki|业务 Wiki/, "business-wiki"],
  [/访问治理 Admin/, "admin-governance"],
  [/什么时候配置角色、Agent 和 Token|Role \/ Agent \/ Token 怎么选/, "admin-role-agent-token-guide"],
  [/^Agent$/, "admin-agents"],
  [/Role 权限模板|角色配置/, "admin-roles"],
  [/Bearer Token|Token 发行/, "admin-tokens"],
  [/热库与冷库|SQL 留存边界/, "admin-audit-hot-cold-store"],
  [/MCP 访问日志|问题簇|审计/, "admin-audit"],
  [/质量评测 Eval/, "eval"],
  [/Eval Case|Case 维护/, "eval-cases"],
  [/Run 试跑|运行历史/, "eval-runs"],
  [/趋势监控/, "eval-monitor"],
  [/YAML 文件规范与交付验收|YAML Delivery/i, "yaml-delivery-runbook"],
  [/配置作者 Skills/, "config-author-skills"],
  [/^overlay 字段速查（编写辅导）$/, "yaml-overlay-field-guide"],
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
  [/最小健康检查清单/, "health-checklist"],
  [/No join path|跨表失败/, "lucy-query-no-join-path"],
  [/fanout|Aggregate locality/, "lucy-query-fanout-locality"],
  [/order_by.*排序无效|排序无效或排反/, "lucy-query-order-by"],
  [/复杂分析题|Eval 对不上 gold|对不上 gold/, "eval-semantic-vs-gold"],
  [/MCP 仍旧|reindex 失败/, "manifest-wiki-reindex-sync"],
  [/审阅|校验/, "review-validate"],
  [/WebUI 入口速查/, "webui-entry-map"]
];

const DATABASE_OPS_HEADING_TITLES = new Set([
  "WebUI 与 ktx.yaml 的职责边界",
  "刷新本地目录",
  "连接概览指标说明",
  "连接形态与配置字段",
  "新增数据库连接（运维 Runbook）",
  "Agent 可见性与 ACL 同步"
]);

const HELP_SEARCH_QUERY_MAX = 80;
const HELP_SEARCH_DEFAULT_LIMIT = 20;
const HELP_SEARCH_SNIPPET_RADIUS = 72;

const DEPLOYMENT_CHECKLIST_HEADING_TITLES = new Set(["系统概览待处理事项"]);

const ADMIN_GOVERNANCE_HEADING_TITLES = new Set([
  "什么时候配置角色、Agent 和 Token",
  "审计热库与冷库（SQL 留存边界）"
]);

const SEMANTIC_AUTHORING_HEADING_TITLES = new Set([
  "语义状态与启用表范围状态",
  "为什么要编写语义 YAML",
  "推荐编写工作流",
  "grain、join 与 fanout",
  "overlay 常见字段速查",
  "KTX 官方延伸阅读"
]);

const YAML_DELIVERY_EXTRA_HEADING_TITLES = new Set(["配置作者 Skills"]);

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

export type HelpSearchItem = {
  sectionId: string;
  title: string;
  snippet: string;
};

export type HelpSearchResult = {
  query: string;
  items: HelpSearchItem[];
};

export class HelpDocNotFoundError extends Error {
  code = "ERR_HELP_DOC_NOT_FOUND";
  statusCode = 404;

  constructor() {
    super(`${HANDBOOK_REL_PATH} was not found`);
    this.name = "HelpDocNotFoundError";
  }
}

export class HelpQueryTooLongError extends Error {
  code = "ERR_HELP_QUERY_TOO_LONG";
  statusCode = 400;

  constructor(maxLength = HELP_SEARCH_QUERY_MAX) {
    super(`Help search query exceeds ${maxLength} characters`);
    this.name = "HelpQueryTooLongError";
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
    const deploymentChecklistSubheading =
      rawLevel === 4 && DEPLOYMENT_CHECKLIST_HEADING_TITLES.has(cleanTitle);
    const adminGovernanceSubheading =
      rawLevel === 4 && ADMIN_GOVERNANCE_HEADING_TITLES.has(cleanTitle);
    const semanticAuthoringSubheading =
      rawLevel === 4 && SEMANTIC_AUTHORING_HEADING_TITLES.has(cleanTitle);
    const yamlDeliveryExtraSubheading =
      rawLevel === 4 && YAML_DELIVERY_EXTRA_HEADING_TITLES.has(cleanTitle);
    if (
      !match ||
      rawLevel < 2 ||
      (rawLevel > 3 &&
        !yamlRunbookSubheading &&
        !databaseOpsSubheading &&
        !deploymentChecklistSubheading &&
        !adminGovernanceSubheading &&
        !semanticAuthoringSubheading &&
        !yamlDeliveryExtraSubheading)
    )
      continue;
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

type HelpSectionSlice = {
  item: HelpTocItem;
  body: string;
};

function findHeadingOffsets(markdown: string): Array<{ index: number; title: string }> {
  const matches: Array<{ index: number; title: string }> = [];
  let offset = 0;
  let inFence = false;
  for (const line of markdown.split(/(\r?\n)/)) {
    if (line === "\n" || line === "\r\n") {
      offset += line.length;
      continue;
    }
    const trimmed = line.trim();
    if (FENCE_RE.test(trimmed)) {
      inFence = !inFence;
    } else if (!inFence) {
      const heading = line.match(HEADING_RE);
      if (heading && (heading[1]?.length ?? 0) >= 2) {
        matches.push({
          index: offset,
          title: (heading[2] ?? "").trim()
        });
      }
    }
    offset += line.length;
  }
  return matches;
}

function splitHandbookSections(markdown: string, toc: HelpTocItem[]): HelpSectionSlice[] {
  if (toc.length === 0) return [];
  const headingOffsets = findHeadingOffsets(markdown);
  const titleToIndex = new Map<string, number>();
  for (const heading of headingOffsets) {
    if (!titleToIndex.has(heading.title)) {
      titleToIndex.set(heading.title, heading.index);
    }
  }

  const slices: HelpSectionSlice[] = [];
  for (let i = 0; i < toc.length; i += 1) {
    const item = toc[i]!;
    const start = titleToIndex.get(item.title);
    if (start === undefined) continue;
    let end = markdown.length;
    for (let j = i + 1; j < toc.length; j += 1) {
      const nextStart = titleToIndex.get(toc[j]!.title);
      if (nextStart !== undefined && nextStart > start) {
        end = nextStart;
        break;
      }
    }
    slices.push({
      item,
      body: markdown.slice(start, end)
    });
  }
  return slices;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function countOccurrences(haystackLower: string, needleLower: string): number {
  if (!needleLower) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor < haystackLower.length) {
    const index = haystackLower.indexOf(needleLower, cursor);
    if (index === -1) break;
    count += 1;
    cursor = index + needleLower.length;
  }
  return count;
}

function buildSnippet(body: string, query: string): string {
  const collapsed = collapseWhitespace(body);
  const lower = collapsed.toLowerCase();
  const needle = query.toLowerCase();
  const index = lower.indexOf(needle);
  if (index === -1) {
    return collapsed.slice(0, HELP_SEARCH_SNIPPET_RADIUS * 2);
  }
  const start = Math.max(0, index - HELP_SEARCH_SNIPPET_RADIUS);
  const end = Math.min(collapsed.length, index + needle.length + HELP_SEARCH_SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < collapsed.length ? "…" : "";
  return `${prefix}${collapsed.slice(start, end)}${suffix}`;
}

export function searchHelpMarkdown(
  markdown: string,
  query: string,
  options?: { limit?: number }
): HelpSearchResult {
  const trimmed = query.trim();
  if (trimmed.length > HELP_SEARCH_QUERY_MAX) {
    throw new HelpQueryTooLongError();
  }
  if (!trimmed) {
    return { query: "", items: [] };
  }

  const limit = Math.max(1, Math.min(options?.limit ?? HELP_SEARCH_DEFAULT_LIMIT, 50));
  const toc = parseHelpToc(markdown);
  const needle = trimmed.toLowerCase();
  const ranked: Array<HelpSearchItem & { titleHit: boolean; hits: number; firstIndex: number }> = [];

  for (const slice of splitHandbookSections(markdown, toc)) {
    const titleLower = slice.item.title.toLowerCase();
    const bodyLower = slice.body.toLowerCase();
    const titleHit = titleLower.includes(needle);
    const bodyHits = countOccurrences(bodyLower, needle);
    if (!titleHit && bodyHits === 0) continue;
    ranked.push({
      sectionId: slice.item.id,
      title: slice.item.title,
      snippet: buildSnippet(slice.body, trimmed),
      titleHit,
      hits: bodyHits + (titleHit ? 10 : 0),
      firstIndex: titleHit ? -1 : bodyLower.indexOf(needle)
    });
  }

  ranked.sort((a, b) => {
    if (a.titleHit !== b.titleHit) return a.titleHit ? -1 : 1;
    if (b.hits !== a.hits) return b.hits - a.hits;
    if (a.firstIndex !== b.firstIndex) return a.firstIndex - b.firstIndex;
    return a.sectionId.localeCompare(b.sectionId);
  });

  return {
    query: trimmed,
    items: ranked.slice(0, limit).map(({ sectionId, title, snippet }) => ({
      sectionId,
      title,
      snippet
    }))
  };
}

export async function searchHelpHandbook(
  query: string,
  options?: { limit?: number; appRoot?: string }
): Promise<HelpSearchResult> {
  const handbook = await readHelpHandbook(options?.appRoot);
  return searchHelpMarkdown(handbook.markdown, query, { limit: options?.limit });
}

export function handbookPathForTests(projectRoot: string): string {
  return path.join(projectRoot, HANDBOOK_REL_PATH);
}
