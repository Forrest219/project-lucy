/**
 * Helpers for the Business Wiki workbench.
 *
 * These helpers stay client-side and deterministic so the read view,
 * the tree sidebar, the save preflight and the editor toolbar can all
 * share the same conventions (title extraction, TOC, template seeds,
 * validation findings) without leaning on a heavy markdown parser.
 */
import type { WikiFrontmatter, WikiPreview, WikiSummary } from "./types";

export type WikiTemplate = {
  /** Short Chinese label rendered on the empty-draft card. */
  label: string;
  /** One-line description rendered under the label. */
  description: string;
  /** Markdown body seeded when the user picks the template. */
  content: string;
};

export const WIKI_TEMPLATES: ReadonlyArray<WikiTemplate> = [
  {
    label: "表使用说明",
    description: "记录表的主题、覆盖场景、典型查询示例与已知限制。",
    content: [
      "## 表主题",
      "",
      "一句话说明这张表解决了什么业务问题。",
      "",
      "## 典型查询",
      "",
      "```sql",
      "SELECT 1;",
      "```",
      "",
      "## 已知限制",
      "",
      "- 数据更新窗口：",
      "- 取舍说明："
    ].join("\n")
  },
  {
    label: "指标口径",
    description: "锁定指标定义、计算口径、责任人与变更记录。",
    content: [
      "## 指标定义",
      "",
      "指标名、所属业务域、计算口径。",
      "",
      "## 责任人与审阅",
      "",
      "- 业务 Owner：",
      "- 数据 Owner：",
      "- 最近审阅：",
      "",
      "## 变更记录",
      "",
      "- YYYY-MM-DD：初版"
    ].join("\n")
  },
  {
    label: "分析 Playbook",
    description: "把一个常见分析问题拆成步骤、依赖与结论模板。",
    content: [
      "## 业务问题",
      "",
      "要回答什么业务问题。",
      "",
      "## 数据依赖",
      "",
      "需要哪些表与字段。",
      "",
      "## 分析步骤",
      "",
      "1. 明确口径",
      "2. 取数",
      "3. 校验",
      "4. 结论",
      "",
      "## 结论模板",
      "",
      "一句话结论 + 关键数据点。"
    ].join("\n")
  },
  {
    label: "FAQ / 注意事项",
    description: "沉淀常见疑问、踩坑、容易误用的边界条件。",
    content: [
      "## FAQ",
      "",
      "- Q：",
      "  A：",
      "",
      "## 注意事项",
      "",
      "- 数据来源：",
      "- 取数频次：",
      "- 容易误用的字段："
    ].join("\n")
  }
];

/**
 * Extract a human-readable title for a Wiki page.
 *
 * Priority: frontmatter summary (kept as fallback even though not currently
 * used as a frontmatter field), then the first Markdown `#` heading, then
 * the basename of the key without its `.md` suffix.
 */
export function wikiTitleFromContent(
  content: string,
  key: string,
  frontmatter?: WikiFrontmatter
): string {
  if (frontmatter?.summary && frontmatter.summary.trim()) {
    return frontmatter.summary.trim();
  }
  const heading = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "));
  if (heading) {
    return heading.replace(/^#\s+/, "").trim() || wikiTitleFromKey(key);
  }
  return wikiTitleFromKey(key);
}

export function wikiTitleFromKey(key: string): string {
  const segments = key.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? key;
  return last.replace(/\.md$/, "");
}

/**
 * Slugify a heading the same way the rendered Markdown anchors do.
 * Exported so `MarkdownPreview` and `extractWikiToc` can share a single
 * source of truth — TOC links must always point at a real DOM anchor.
 */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Return a slug that is unique within the provided set. The first
 * occurrence keeps the bare slug; subsequent duplicates get a `-2`,
 * `-3`… suffix. Empty input falls back to `section`.
 */
export function ensureUniqueHeadingId(base: string, taken: Set<string>): string {
  if (!base) {
    base = "section";
  }
  let candidate = base;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * Extract a deterministic table of contents from the Markdown body using
 * only `##` and `###` headings. Anchors are produced with the same
 * slugging rule used by `MarkdownPreview` so click-to-scroll stays
 * aligned with the rendered DOM.
 */
export type WikiTocItem = {
  id: string;
  level: 2 | 3;
  text: string;
};

export function extractWikiToc(content: string): WikiTocItem[] {
  const items: WikiTocItem[] = [];
  const usedIds = new Set<string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("##")) continue;
    if (trimmed.startsWith("### ")) {
      const text = trimmed.slice(4).trim();
      items.push({ id: ensureUniqueHeadingId(slugifyHeading(text), usedIds), level: 3, text });
      continue;
    }
    if (trimmed.startsWith("## ")) {
      const text = trimmed.slice(3).trim();
      items.push({ id: ensureUniqueHeadingId(slugifyHeading(text), usedIds), level: 2, text });
      continue;
    }
  }
  return items;
}

/**
 * Lightweight, stable identifier for a draft payload. Used to tag
 * each dry-run response so the Save Preflight can refuse to confirm
 * against a stale diff.
 */
export function wikiDraftVersion(frontmatter: WikiFrontmatter, content: string): string {
  // JSON.stringify preserves key order, which is deterministic for
  // string keys. That is good enough for an in-memory equality check.
  return `${JSON.stringify(frontmatter ?? {})}::${content}`;
}

export type WikiGroup = {
  /** Directory label (e.g. `global`, `kx`, `poc`). Empty string for top-level. */
  directory: string;
  /** Display title for the directory node, falls back to the directory key. */
  directoryLabel: string;
  pages: WikiSummary[];
};

/**
 * Group Wiki pages by the leading path segments. The trailing segment is
 * the page itself. Empty directory values (top-level pages) are bucketed
 * under `""` and rendered with a "根目录" label.
 */
export function groupWikiPages(pages: WikiSummary[]): WikiGroup[] {
  const buckets = new Map<string, WikiSummary[]>();
  for (const page of pages) {
    const segments = page.key.split("/").filter(Boolean);
    const directory = segments.length > 1 ? segments.slice(0, -1).join("/") : "";
    const list = buckets.get(directory) ?? [];
    list.push(page);
    buckets.set(directory, list);
  }
  const groups: WikiGroup[] = [];
  for (const [directory, items] of buckets) {
    items.sort((a, b) => a.key.localeCompare(b.key));
    groups.push({
      directory,
      directoryLabel: directory || "根目录",
      pages: items
    });
  }
  groups.sort((a, b) => {
    if (a.directory === "") return -1;
    if (b.directory === "") return 1;
    return a.directory.localeCompare(b.directory);
  });
  return groups;
}

/**
 * Match a single page against the active search needle. The same
 * title/summary/tag/sl_ref rule powers both the tree and the legacy
 * sidebar list to keep behaviour consistent.
 */
export function pageMatchesSearch(
  page: WikiSummary,
  titleHint: string,
  needle: string
): boolean {
  if (!needle) return true;
  const lc = needle.toLowerCase();
  return (
    page.key.toLowerCase().includes(lc) ||
    (page.summary ?? "").toLowerCase().includes(lc) ||
    titleHint.toLowerCase().includes(lc) ||
    page.tags.some((tag) => tag.toLowerCase().includes(lc)) ||
    page.slRefs.some((ref) => ref.toLowerCase().includes(lc))
  );
}

export type WikiValidationLevel = "error" | "warning" | "info";

export type WikiValidationFinding = {
  level: WikiValidationLevel;
  message: string;
};

export type WikiValidationContext = {
  key: string;
  frontmatter: WikiFrontmatter;
  content: string;
  /** sl_refs that resolve to a real table in the catalog (case-sensitive). */
  knownSlRefs: ReadonlySet<string>;
};

/**
 * Run the P0 client-side validation suite required by the Save
 * Preflight flow. Findings are ordered by severity so the UI can render
 * `error` first, then `warning`, then `info`.
 */
export function validateWikiDraft(ctx: WikiValidationContext): WikiValidationFinding[] {
  const findings: WikiValidationFinding[] = [];
  const { key, frontmatter, content, knownSlRefs } = ctx;
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    findings.push({ level: "error", message: "正文为空：保存的 Wiki 没有任何业务说明。" });
  }
  if (!frontmatter.summary || !frontmatter.summary.trim()) {
    findings.push({ level: "warning", message: "摘要为空：文档列表和搜索将无法定位这篇 Wiki。" });
  }
  const refs = frontmatter.sl_refs ?? [];
  if (refs.length === 0) {
    findings.push({ level: "warning", message: "未关联语义对象：这张表还没有对应的 Wiki，反向跳转无法生效。" });
  } else {
    const unknown = refs.filter((ref) => !knownSlRefs.has(ref));
    if (unknown.length > 0) {
      findings.push({
        level: "warning",
        message: `未知语义对象：${unknown.join("、")}，确认后仍可保存。`
      });
    }
  }
  if (!key.endsWith(".md")) {
    findings.push({ level: "error", message: "路径必须以 `.md` 结尾，Wiki 文档使用 Markdown 存储。" });
  }
  // Match an H1 at the start of the document OR after a blank line,
  // not just one preceded by a newline. Otherwise a Markdown body
  // whose very first line is `# Title` (no leading newline) gets a
  // false-positive "missing H1" finding.
  if (!/(^|\n)#\s+\S/.test(trimmedContent)) {
    findings.push({
      level: "info",
      message: "正文缺少 `# 一级标题`，阅读态将回退到文件名作为标题。"
    });
  }
  if (trimmedContent.includes("<script") || trimmedContent.includes("<iframe")) {
    findings.push({
      level: "error",
      message: "正文包含原始 HTML 标签，Wiki 不允许嵌入脚本或外部页面。"
    });
  }
  // Stable severity order.
  return findings.sort(compareFindings);
}

function compareFindings(a: WikiValidationFinding, b: WikiValidationFinding) {
  const order: Record<WikiValidationLevel, number> = { error: 0, warning: 1, info: 2 };
  return order[a.level] - order[b.level];
}

export type SavePreflightState = {
  target: string;
  filePath: string;
  diff: string;
  proposedMarkdown: string;
  findings: WikiValidationFinding[];
  previewLoading: boolean;
  previewError: string | null;
  /** Diff/Raw match the current draft. `false` means the displayed
   *  preview is stale relative to the editor buffer and must be
   *  regenerated before the user can confirm a save. */
  previewFresh: boolean;
  /** `true` when no successful preview has ever landed for the
   *  current draft. The Save Preflight treats this the same as a
   *  stale preview — confirmation must wait for a fresh response. */
  previewMissing: boolean;
};

export function buildSavePreflightState(params: {
  key: string;
  preview: WikiPreview | null;
  previewError: string | null;
  frontmatter: WikiFrontmatter;
  content: string;
  knownSlRefs: ReadonlySet<string>;
  previewLoading: boolean;
  currentDraftVersion: string;
  previewVersion: string | null;
}): SavePreflightState {
  const {
    key,
    preview,
    previewError,
    frontmatter,
    content,
    knownSlRefs,
    previewLoading,
    currentDraftVersion,
    previewVersion
  } = params;
  return {
    target: `wiki/${key}`,
    filePath: preview?.filePath ?? `wiki/${key}`,
    diff: preview?.diff ?? "",
    proposedMarkdown: preview?.proposedMarkdown ?? "",
    findings: validateWikiDraft({ key, frontmatter, content, knownSlRefs }),
    previewLoading,
    previewError,
    previewFresh: !previewLoading && !previewError && previewVersion === currentDraftVersion,
    previewMissing: previewVersion === null && preview === null
  };
}
