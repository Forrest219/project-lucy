import clsx from "clsx";
import { useMemo, useState } from "react";
import { RowMoreMenu } from "./RowMoreMenu";
import {
  buildWikiDirectoryTree,
  pageMatchesSearch,
  wikiTitleFromKey
} from "../lib/wiki";
import type { WikiDirectorySummary, WikiSummary } from "../lib/types";
import type { WikiDirectoryNode } from "../lib/wiki";

export type WikiTreeProps = {
  pages: WikiSummary[];
  directories?: WikiDirectorySummary[];
  activeKey: string;
  /** Currently selected directory path (Spec 105 explorer IA). */
  selectedDirectory?: string;
  /**
   * When true, the right panel is already the directory library for
   * `selectedDirectory`. A second click then only toggles expand/collapse.
   * When false (document open), clicking the highlighted parent directory
   * navigates back to that directory's library view.
   */
  directoryPanelActive?: boolean;
  onSelect: (key: string) => void;
  onSelectDirectory?: (directory: string) => void;
  onCreateDocument?: (directory: string) => void;
  onCreateDirectory?: (parentDirectory: string) => void;
  /** Triggered when the user picks `删除目录` from a directory row menu.
   *  The Wiki editor wires this up to the DELETE route; the tree stays
   *  agnostic so other consumers can decide their own UX. */
  onDeleteDirectory?: (directory: string) => void;
  /** Optional seeded search term so the tree can mirror a header input. */
  initialSearch?: string;
};

type EnrichedPage = WikiSummary & {
  displayTitle: string;
  isActive: boolean;
};

/**
 * Searchable directory tree for the Business Wiki workbench.
 *
 * Pages are grouped by their leading path segments. Each row shows the
 * document's display title (frontmatter summary, first heading or
 * basename) as the primary label. Filtering matches across title, summary,
 * tags and `sl_refs` so the search bar in the page header and the tree stay
 * in sync. The UI labels use user-facing "关联表" wording even though
 * the underlying metadata field remains `sl_refs`.
 *
 * Spec 105: directory rows are selectable scopes that drive the right
 * panel via `onSelectDirectory`. Clicking an already-selected directory
 * only toggles expand/collapse.
 */
export function WikiTree({
  pages,
  directories = [],
  activeKey,
  selectedDirectory = "",
  directoryPanelActive = false,
  onSelect,
  onSelectDirectory,
  onCreateDocument,
  onCreateDirectory,
  onDeleteDirectory,
  initialSearch = ""
}: WikiTreeProps) {
  const [search, setSearch] = useState(initialSearch);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const directoryTree = useMemo(() => {
    const needle = search.trim();
    const enriched = pages.map<EnrichedPage>((page) => ({
        ...page,
        displayTitle: page.summary?.trim() || wikiTitleFromKey(page.key),
        isActive: page.key === activeKey
      }));
    return filterDirectoryTree(
      buildWikiDirectoryTree({ pages: enriched, directories }),
      needle
    );
  }, [activeKey, directories, pages, search]);

  function toggleDirectory(path: string) {
    setCollapsed((current) => ({
      ...current,
      [path]: !(current[path] ?? false)
    }));
  }

  function handleDirectoryActivate(path: string) {
    const isSelected = selectedDirectory === path;
    if (isSelected && directoryPanelActive) {
      toggleDirectory(path);
      return;
    }
    setCollapsed((current) => ({
      ...current,
      [path]: false
    }));
    onSelectDirectory?.(path);
  }

  function renderPage(page: EnrichedPage, level: number) {
    const extension = page.key.split(".").pop() ?? "";
    return (
      <li
        className={clsx(
          "pl-wiki-tree-page",
          page.isActive && "pl-wiki-tree-page--active"
        )}
        data-active={page.isActive || undefined}
        data-testid="wiki-tree-page"
        key={page.key}
      >
        <button
          aria-current={page.isActive ? "page" : undefined}
          className="pl-wiki-tree-page-button"
          onClick={() => onSelect(page.key)}
          style={{ paddingLeft: `${Math.max(level, 0) * 16 + 8}px` }}
          type="button"
        >
          <span
            aria-hidden
            className="pl-wiki-tree-page-ext notranslate"
            data-ext={extension}
            translate="no"
          >
            {extension}
          </span>
          <span
            className="pl-wiki-tree-page-title"
            title={page.key}
          >
            {page.displayTitle}
          </span>
        </button>
      </li>
    );
  }

  function renderDirectory(node: WikiDirectoryNode<EnrichedPage>, level: number) {
    const isCollapsed = search.trim() ? false : collapsed[node.path] ?? false;
    const isSelected = Boolean(selectedDirectory) && selectedDirectory === node.path;
    const key = node.path || "__root__";
    const label = node.name || "根目录";
    const toggleLabel = isSelected && directoryPanelActive
      ? isCollapsed
        ? `展开 ${label} 目录`
        : `收起 ${label} 目录`
      : `选择 ${label} 目录`;
    const toggleAriaLabel = `${label} ${node.documentCount} 篇，${
      isSelected && directoryPanelActive
        ? isCollapsed
          ? "展开目录"
          : "收起目录"
        : "选择目录"
    }`;
    return (
      <li
        className={clsx(
          "pl-wiki-tree-group",
          isSelected && "pl-wiki-tree-group--active"
        )}
        data-selected={isSelected || undefined}
        data-testid="wiki-tree-group"
        key={key}
        role="treeitem"
        aria-expanded={!isCollapsed}
        aria-selected={isSelected}
      >
        <div
          className="pl-wiki-tree-group-row"
          style={{ paddingLeft: `${Math.max(level, 0) * 16}px` }}
        >
          <button
            aria-current={isSelected ? "true" : undefined}
            aria-expanded={!isCollapsed}
            aria-label={toggleAriaLabel}
            className="pl-wiki-tree-group-toggle"
            data-testid="wiki-tree-group-toggle"
            onClick={() => handleDirectoryActivate(node.path)}
            title={toggleLabel}
            type="button"
          >
            <span className="pl-wiki-tree-group-label notranslate" translate="no">
              {label}
            </span>
            <span className="pl-wiki-tree-group-count">{node.documentCount} 篇</span>
          </button>
          {onCreateDocument || onCreateDirectory || onDeleteDirectory ? (
            <div className="pl-wiki-tree-group-menu">
              <RowMoreMenu
                ariaLabel={`${node.path || label} 目录操作`}
                items={[
                  ...(onCreateDirectory
                    ? [{
                      kind: "action" as const,
                      label: "新建子目录",
                      onSelect: () => onCreateDirectory(node.path || "global"),
                      testId: `wiki-tree-create-directory-${(node.path || "root").replace(/[^a-zA-Z0-9_-]/g, "-")}`
                    }]
                    : []),
                  ...(onCreateDocument
                    ? [{
                      kind: "action" as const,
                      label: "在此目录新建文档",
                      onSelect: () => onCreateDocument(node.path || "global"),
                      testId: `wiki-tree-create-document-${(node.path || "root").replace(/[^a-zA-Z0-9_-]/g, "-")}`
                    }]
                    : []),
                  ...(onDeleteDirectory
                    ? [{
                      kind: "action" as const,
                      label: "删除目录",
                      onSelect: () => onDeleteDirectory(node.path),
                      disabled: !node.empty,
                      disabledReason: node.empty
                        ? undefined
                        : "该目录下仍有 Markdown 文档或子目录，请先移动或删除内容。",
                      testId: `wiki-tree-delete-directory-${(node.path || "root").replace(/[^a-zA-Z0-9_-]/g, "-")}`
                    }]
                    : [])
                ]}
              />
            </div>
          ) : null}
        </div>
        {!isCollapsed ? (
          <ul className="pl-wiki-tree-pages">
            {node.children.map((child) => renderDirectory(child, level + 1))}
            {/* UX-WIKI-020: the tree shows directories + counts by default;
                document rows only appear while the user is actively
                searching, or for the currently open document (so the
                tree keeps showing "where am I"). A directory and its
                Markdown documents are otherwise never mixed by default. */}
            {node.pages
              .filter((page) => search.trim() || page.isActive)
              .map((page) => renderPage(page, level + 1))}
          </ul>
        ) : null}
      </li>
    );
  }

  return (
    <div
      aria-label="Wiki 目录树"
      className="pl-wiki-tree"
      data-testid="wiki-tree"
    >
      <input
        aria-label="搜索文档标题、标签、关联表"
        className="pl-input pl-wiki-tree-search notranslate"
        data-testid="wiki-tree-search"
        onChange={(event) => setSearch(event.target.value)}
        placeholder="搜索文档标题、标签、关联表..."
        translate="no"
        value={search}
      />
      {directoryTree.length === 0 ? (
        <p className="pl-notice" data-testid="wiki-tree-empty">
          没有匹配的 Wiki 页面。
        </p>
      ) : (
        <ul className="pl-wiki-tree-list" role="tree">
          {directoryTree.map((node) => renderDirectory(node, 0))}
        </ul>
      )}
    </div>
  );
}

function directoryMatchesSearch<TPage extends EnrichedPage>(
  node: WikiDirectoryNode<TPage>,
  needle: string
): boolean {
  if (!needle) return true;
  const lc = needle.toLowerCase();
  return node.name.toLowerCase().includes(lc) || node.path.toLowerCase().includes(lc);
}

function filterDirectoryTree<TPage extends EnrichedPage>(
  nodes: WikiDirectoryNode<TPage>[],
  needle: string
): WikiDirectoryNode<TPage>[] {
  if (!needle) return nodes;
  return nodes.flatMap((node) => {
    if (directoryMatchesSearch(node, needle)) {
      return [node];
    }
    const pages = node.pages.filter((page) =>
      pageMatchesSearch(page, page.displayTitle, needle)
    );
    const children = filterDirectoryTree(node.children, needle);
    if (pages.length === 0 && children.length === 0) {
      return [];
    }
    return [{
      ...node,
      documentCount:
        pages.length + children.reduce((sum, child) => sum + child.documentCount, 0),
      empty:
        pages.length + children.reduce((sum, child) => sum + child.documentCount, 0) === 0,
      pages,
      children
    }];
  });
}
