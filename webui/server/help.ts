import { readFile, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HANDBOOK_REL_PATH = "docs/SYSTEM_HANDBOOK.md";
const DEFAULT_APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^```/;

/** Whitelisted product architecture HTML diagrams (SSOT under docs/user-guide/). */
export const HELP_DIAGRAM_IDS = [
  "lucy-architecture-diagram",
  "lucy-docs-flows"
] as const;

export type HelpDiagramId = (typeof HELP_DIAGRAM_IDS)[number];

const HELP_DIAGRAM_REL_PATHS: Record<HelpDiagramId, string> = {
  "lucy-architecture-diagram": "docs/user-guide/lucy-architecture-diagram.html",
  "lucy-docs-flows": "docs/user-guide/lucy-docs-flows.html"
};

/**
 * Section id 契约表：**精确标题 → 稳定 id**。
 *
 * 键是「去掉前导编号后的标题」（`cleanSectionTitle()` 的结果），值是稳定 id。
 *
 * 为什么不用正则表：正则会同时命中多个标题，章节一改名就静默漂移——评审
 * 报告记录了 18 条再也匹配不到任何标题的死别名。改成精确查表后，「契约表
 * 与手册正文不一致」会变成一条可测的失败，而不是无声的 id 漂移。
 *
 * 未命中契约表时回落到 `stableSlug()`（保留 sha1 兜底防 id 冲突）。手册里
 * 每个章节标题都应登记在表内——门禁见 `server/__tests__/help.test.ts`。
 */
export const SECTION_ID_CONTRACT = new Map<string, string>([
  // ---- H2 ----
  ["常见问题速查", "faq-quick-reference"],
  ["系统概述与架构拓扑", "system-overview"],
  ["快速上手", "quick-start"],
  ["功能模块操作指南", "functional-modules"],
  ["Agent / 客户端接入指南", "mcp-integration"],
  ["配置与环境变量速查", "configuration-reference"],
  ["FAQ 与排障指南", "troubleshooting"],

  // ---- H3 ----
  ["文档基线（自动同步）", "handbook-baseline"],
  ["v2.0.0 版本切换说明", "product-version-cutover"],
  ["面向开发者", "faq-developer"],
  ["面向管理员", "faq-admin"],
  ["面向接入协作者", "faq-agent-integration"],
  ["Lucy 是什么", "lucy"],
  ["架构拓扑", "architecture-topology"],
  ["核心原则", "core-principles"],
  ["目录与事实源地图", "source-of-truth-map"],
  ["WebUI 入口速查（运行状态侧栏地图）", "webui-entry-map"],
  ["产品架构图（摄取与服务）", "product-architecture-diagrams"],
  ["环境要求", "environment-requirements"],
  ["本地启动", "local-startup"],
  ["最小配置流程", "minimal-setup"],
  ["运行状态 · 系统概览与上线检查", "runtime-status-checklist"],
  ["数据接入 · 连接 / Schema / 表范围", "data-access-connections"],
  ["业务上下文 · 语义层", "semantic-layer"],
  ["业务上下文 · Wiki", "business-wiki"],
  ["访问治理 · 角色 / Agent / Token", "access-governance"],
  ["质量评测", "quality-evaluation"],
  ["YAML 规范与交付验收", "yaml-delivery-standard"],
  ["访问治理 · 角色列表与权限预览", "role-list-preview"],
  ["接入向导", "onboarding-guide"],
  ["访问治理 · 行级策略", "row-level-policy"],
  ["访问治理 · MCP 会话与上游连接", "mcp-session-upstream"],
  ["业务上下文 · 业务 Skill", "business-skill"],
  ["接入地址", "mcp-endpoint"],
  ["Codex / Claude Code `.mcp.json`", "codex-claude-code-mcp-json"],
  ["Hermes / 通用 HTTP MCP client", "hermes-http-mcp-client"],
  ["可用工具面", "available-tools"],
  ["`webui/config/access.yaml`", "webui-config-access-yaml"],
  ["`ktx.yaml`", "ktx-yaml"],
  ["环境变量", "environment-variables"],
  ["为什么提示“未发现本地 manifest”？", "manifest"],
  ["JSON-RPC `Access denied` / `decision_reason` 怎么查？", "json-rpc-access-denied-decision-reason"],
  ["配置文件改动后什么时候生效？", "config-change-effective-timeline"],
  ["WebUI 页面打不开", "webui"],
  ["MCP 返回 401", "mcp-401"],
  ["KTX upstream 不可用", "ktx-upstream-unavailable"],
  ["为什么启用表范围保存失败？", "enabled-tables-save-failure"],
  ["安全边界速查", "security-boundaries"],
  ["最小健康检查清单", "health-checklist"],
  ["`lucy_query` 报 No join path / 跨表失败", "lucy-query-no-join-path"],
  ["fanout / Aggregate locality 拒绝查询", "lucy-query-fanout-locality"],
  ["`order_by` 排序无效或排反", "lucy-query-order-by"],
  ["语义查询答不出复杂分析题，或 Eval 对不上 gold", "eval-semantic-vs-gold"],
  ["改了 Manifest / Wiki，MCP 仍旧或 reindex 失败", "manifest-wiki-reindex-sync"],

  // ---- H4 ----
  ["系统概览待处理事项", "overview-action-required"],
  ["刷新本地目录", "catalog-reload"],
  ["连接概览指标说明", "connection-overview-metrics"],
  ["WebUI 与 ktx.yaml 的职责边界", "database-connection-boundary"],
  ["连接形态与配置字段", "database-connection-shapes"],
  ["新增数据库连接（运维 Runbook）", "database-connection-operations-runbook"],
  ["Agent 可见性与 ACL 同步", "database-connection-acl-sync"],
  ["语义状态与启用表范围状态", "semantic-status-and-enabled-status"],
  ["为什么要编写语义 YAML", "semantic-yaml-why"],
  ["推荐编写工作流", "semantic-authoring-workflow"],
  ["grain、join 与 fanout", "semantic-grain-fanout"],
  ["overlay 常见字段速查", "semantic-overlay-fields"],
  ["KTX 官方延伸阅读", "ktx-further-reading"],
  ["语义资产范围树（连接与 Schema）", "semantic-asset-scope-tree"],
  ["什么时候配置角色、Agent 和 Token", "admin-role-agent-token-guide"],
  ["问询记录与调用流水怎么选、怎么导出", "admin-audit-turns-vs-calls"],
  ["WebUI 管理员登录", "admin-webui-login"],
  ["丢失管理员账号或密码时如何恢复（break-glass）", "admin-break-glass"],
  ["Role-first 模型", "role-first-model"],
  ["Token 发行规则", "token-issuance-policy"],
  ["权限裁决机制", "permission-decision-flow"],
  ["问题簇审计", "question-cluster-audit"],
  ["审计热库与冷库（SQL 留存边界）", "admin-audit-hot-cold-store"],
  ["配置作者 Skills", "config-author-skills"],
  ["角色列表与筛选", "admin-role-list"],
  ["接入向导六步流程", "onboarding-setup-assistant"],
  ["行级策略（行授予与最终行约束）", "row-policy"],
  ["MCP 会话保持与上游连接归属", "mcp-upstream-session"],
  ["业务 Skill 治理工作台", "business-skill-workbench"],
  ["overlay 字段速查（编写辅导）", "yaml-overlay-field-guide"],
  ["YAML 类型总览", "yaml-type-overview"],
  ["Schema manifest 规范", "yaml-schema-manifest"],
  ["Manifest augmentation overlay 规范", "yaml-augmentation-overlay"],
  ["New semantic source 规范", "yaml-new-semantic-source"],
  ["描述字段规范", "yaml-description-fields"],
  ["GO / NO-GO 交付 checklist", "yaml-go-no-go-checklist"],
  ["常见错误与诊断 Runbook", "yaml-common-errors"],
  ["Agent 自检协议", "yaml-agent-self-check"],
  ["调用监控（/ops/calls）", "call-monitor"],
  ["Token 凭据（/admin/tokens）", "agent-tokens"],
  ["MCP 调试台（/admin/mcp-playground）", "mcp-playground"],
  ["现场提问（/eval/field-questions）", "field-questions"],
  ["安全评测候选（/eval/security-candidates）", "security-candidates"],
  ["接入向导六步流程（按实现映射）", "onboarding-steps-implementation"],
  ["与各工作台的双轨关系", "onboarding-workbench-relation"],
  ["配置 MCP endpoint", "onboarding-mcp-endpoint"],
  ["客户端为何要回传 `Mcp-Session-Id`", "mcp-session-id"],
  ["上游会话复用与限流", "upstream-session-reuse"],
  ["排障速查", "mcp-session-troubleshooting"],
  ["先建立三层对象关系", "role-agent-token-overview"],
  ["什么时候该配角色", "when-to-configure-role"],
  ["什么时候该配 Agent", "when-to-configure-agent"],
  ["什么时候该配 Token", "when-to-configure-token"],
  ["场景速查", "role-agent-token-scenarios"],
  ["推荐操作顺序", "role-agent-token-order"],
  ["常见误区", "role-agent-token-pitfalls"],
  ["签发", "token-issuance"],
  ["吊销", "token-revocation"],
  ["复制 MCP 配置", "token-mcp-config-copy"],
  ["边界与常见误用", "token-boundaries"]
]);

/**
 * 旧 section id → 新 section id，供 `/help?section=<旧 id>` 深链重定向。
 *
 * 只收录**曾经真实分配给某个章节**的旧 id；匹配不到任何标题的纯死别名不收
 * （收进来只会在重定向时把用户带到不存在的章节）。与契约表同名的条目
 * （`semantic-layer` / `business-wiki`）必须自映射——它们既是旧 id，也是现行 id。
 */
export const LEGACY_SECTION_IDS: Record<string, string> = {
  "deployment-checklist": "runtime-status-checklist",
  "database-connections": "data-access-connections",
  "schema": "data-access-connections",
  "semantic-layer": "semantic-layer",
  "wiki": "business-wiki",
  "business-wiki": "business-wiki",
  "agent-token": "access-governance",
  "admin-governance": "access-governance",
  "eval": "quality-evaluation",
  "yaml-delivery-runbook": "yaml-delivery-standard",
  "yaml-delivery-checklist": "yaml-delivery-standard",
  "yaml-delivery-checklist-2": "yaml-go-no-go-checklist",
  "mcp": "mcp-session-upstream",
  "skill": "business-skill",
  "admin-audit": "admin-audit-turns-vs-calls",
  "b9c274fb1c": "handbook-baseline",
  "v2-0-0": "product-version-cutover"
};

/** 把旧 section id 重定向到现行 id；未登记的旧 id 原样返回。 */
export function resolveLegacySectionId(sectionId: string): string {
  if (!Object.hasOwn(LEGACY_SECTION_IDS, sectionId)) return sectionId;
  return LEGACY_SECTION_IDS[sectionId] ?? sectionId;
}

/**
 * 显式排除标记：紧邻标题上一行的 `<!-- toc:exclude -->` 会让该标题不进目录。
 * 手册目前未使用该语法，但机制必须存在——H4 现在默认放行，需要一条退出通道。
 */
const TOC_EXCLUDE_MARKER = "<!-- toc:exclude -->";

const HELP_SEARCH_QUERY_MAX = 80;
const HELP_SEARCH_DEFAULT_LIMIT = 20;
const HELP_SEARCH_SNIPPET_RADIUS = 72;

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
  /** 旧 section id → 现行 section id，供前端重定向历史深链。 */
  legacySectionMap: Record<string, string>;
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

export class HelpDiagramNotFoundError extends Error {
  code = "ERR_HELP_DIAGRAM_NOT_FOUND";
  statusCode = 404;

  constructor(id: string) {
    super(`Help diagram "${id}" was not found`);
    this.name = "HelpDiagramNotFoundError";
  }
}

export type HelpDiagram = {
  id: HelpDiagramId;
  sourcePath: string;
  html: string;
};

function isHelpDiagramId(value: string): value is HelpDiagramId {
  return (HELP_DIAGRAM_IDS as readonly string[]).includes(value);
}

export async function readHelpDiagram(
  id: string,
  appRoot = resolveHelpAppRoot()
): Promise<HelpDiagram> {
  if (!isHelpDiagramId(id)) {
    throw new HelpDiagramNotFoundError(id);
  }
  const sourcePath = HELP_DIAGRAM_REL_PATHS[id];
  let target: string;
  try {
    target = await assertHelpAppReadable(appRoot, sourcePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new HelpDiagramNotFoundError(id);
    }
    throw error;
  }

  let html: string;
  try {
    html = await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new HelpDiagramNotFoundError(id);
    }
    throw error;
  }

  return { id, sourcePath, html };
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

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Resolve a fixed relative path under the Lucy app root (handbook + architecture
 * diagrams). Independent of content-root / project-root fs-safe write rules.
 */
async function assertHelpAppReadable(appRoot: string, relPath: string): Promise<string> {
  if (!relPath || path.isAbsolute(relPath)) {
    throw Object.assign(new Error("Help path must be relative to the app root"), {
      code: "FORBIDDEN_PATH",
      statusCode: 403
    });
  }
  const normalized = path.normalize(relPath).replaceAll(path.sep, "/");
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw Object.assign(new Error("Path traversal is not allowed"), {
      code: "FORBIDDEN_PATH",
      statusCode: 403
    });
  }

  const rootReal = await realpath(appRoot);
  const target = path.resolve(rootReal, normalized);
  if (!isWithin(target, rootReal)) {
    throw Object.assign(new Error("Resolved path escapes the app root"), {
      code: "FORBIDDEN_PATH",
      statusCode: 403
    });
  }
  return target;
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

/**
 * 去掉标题的前导章节编号（`3.7.1 YAML 类型总览` → `YAML 类型总览`）。
 * 契约表的键就是它的结果。
 */
export function cleanSectionTitle(title: string): string {
  return title.replace(/^\d+(?:\.\d+)*\.?\s*/, "").trim();
}

function sectionIdFor(title: string): string {
  const cleanTitle = cleanSectionTitle(title);
  return SECTION_ID_CONTRACT.get(cleanTitle) ?? stableSlug(cleanTitle);
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
  let excludeNextHeading = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (FENCE_RE.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.trim() === TOC_EXCLUDE_MARKER) {
      // 标记只对**紧邻的下一行**生效：中间插入任何其它行都会打断这个邻接关系。
      excludeNextHeading = true;
      continue;
    }
    const match = line.match(HEADING_RE);
    if (!match) {
      excludeNextHeading = false;
      continue;
    }
    const rawLevel = match?.[1]?.length ?? 1;
    const title = (match?.[2] ?? "").trim();
    if (excludeNextHeading) {
      excludeNextHeading = false;
      continue;
    }
    // H2–H4 进目录。H1 是手册标题；H5 及更深是章节内部的实施步骤，
    // 进目录会把侧栏撑成流程清单。需要排除时用 `<!-- toc:exclude -->`。
    if (rawLevel < 2 || rawLevel > 4) continue;
    items.push({
      id: dedupeId(sectionIdFor(title), used),
      level: rawLevel as 2 | 3 | 4,
      title
    });
  }
  return items;
}

export async function readHelpHandbook(appRoot = resolveHelpAppRoot()): Promise<HelpHandbook> {
  let target: string;
  try {
    target = await assertHelpAppReadable(appRoot, HANDBOOK_REL_PATH);
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
    legacySectionMap: { ...LEGACY_SECTION_IDS },
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
