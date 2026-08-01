import clsx from "clsx";
import { useMemo, useState } from "react";
import {
  groupWikiPages,
  pageMatchesSearch,
  wikiTitleFromKey
} from "../lib/wiki";
import type { WikiSummary } from "../lib/types";

export type WikiTreeProps = {
  pages: WikiSummary[];
  activeKey: string;
  onSelect: (key: string) => void;
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
 * basename) as the primary label, with the raw key rendered as muted
 * secondary text. Filtering matches across title, summary, tags and
 * `sl_refs` so the search bar in the page header and the tree stay in
 * sync.
 */
export function WikiTree({ pages, activeKey, onSelect, initialSearch = "" }: WikiTreeProps) {
  const [search, setSearch] = useState(initialSearch);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const needle = search.trim();
    const filtered = pages
      .map<EnrichedPage>((page) => ({
        ...page,
        displayTitle: page.summary?.trim() || wikiTitleFromKey(page.key),
        isActive: page.key === activeKey
      }))
      .filter((page) => pageMatchesSearch(page, page.displayTitle, needle));
    return groupWikiPages(filtered);
  }, [activeKey, pages, search]);

  return (
    <div
      aria-label="Wiki 目录树"
      className="pl-wiki-tree"
      data-testid="wiki-tree"
    >
      <input
        aria-label="按标题、标签或 sl_ref 搜索 Wiki"
        className="pl-input pl-wiki-tree-search notranslate"
        data-testid="wiki-tree-search"
        onChange={(event) => setSearch(event.target.value)}
        placeholder="搜索标题、标签、sl_ref…"
        translate="no"
        value={search}
      />
      {groups.length === 0 ? (
        <p className="pl-notice" data-testid="wiki-tree-empty">
          没有匹配的 Wiki 页面。
        </p>
      ) : (
        <ul className="pl-wiki-tree-list" role="tree">
          {groups.map((group) => {
            const isCollapsed = collapsed[group.directory] ?? false;
            return (
              <li
                className="pl-wiki-tree-group"
                data-testid="wiki-tree-group"
                key={group.directory || "__root__"}
                role="treeitem"
                aria-expanded={!isCollapsed}
              >
                <button
                  className="pl-wiki-tree-group-toggle"
                  onClick={() =>
                    setCollapsed((current) => ({
                      ...current,
                      [group.directory]: !isCollapsed
                    }))
                  }
                  type="button"
                >
                  <span className="pl-wiki-tree-group-caret" aria-hidden>
                    {isCollapsed ? "▶" : "▼"}
                  </span>
                  <span className="pl-wiki-tree-group-label notranslate" translate="no">
                    {group.directoryLabel}
                  </span>
                  <span className="pl-wiki-tree-group-count">{group.pages.length}</span>
                </button>
                {!isCollapsed ? (
                  <ul className="pl-wiki-tree-pages">
                    {group.pages.map((page) => {
                      const enriched = page as EnrichedPage;
                      const extension = page.key.split(".").pop() ?? "";
                      return (
                        <li
                          className={clsx(
                            "pl-wiki-tree-page",
                            enriched.isActive && "pl-wiki-tree-page--active"
                          )}
                          data-active={enriched.isActive || undefined}
                          data-testid="wiki-tree-page"
                          key={page.key}
                        >
                          <button
                            aria-current={enriched.isActive ? "page" : undefined}
                            className="pl-wiki-tree-page-button"
                            onClick={() => onSelect(page.key)}
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
                            <span className="pl-wiki-tree-page-title">{enriched.displayTitle}</span>
                            <span
                              className="pl-wiki-tree-page-path notranslate"
                              title={page.key}
                              translate="no"
                            >
                              {page.key}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
