import { pagesUnderDirectory, wikiTitleFromKey } from "../lib/wiki";
import { WikiAccessStatusBadge } from "./WikiAccessSummary";
import {
  WIKI_ACCESS_FILTERS,
  WIKI_ACCESS_FILTER_LABELS,
  matchesWikiAccessFilter
} from "../lib/wikiAccess";
import type { WikiAccessFilter } from "../lib/wikiAccess";
import type { WikiAccessListEntry, WikiDirectorySummary, WikiSummary } from "../lib/types";

export type WikiLibraryHomeProps = {
  pages: WikiSummary[];
  directories?: WikiDirectorySummary[];
  /** Spec 105: when set, list only documents under this directory prefix. */
  selectedDirectory?: string | null;
  onSelect: (key: string) => void;
  /* Spec 193 §6.1 / §7.1 — view-only authorization filter + explicit selection. */
  accessFilter?: WikiAccessFilter;
  onAccessFilterChange?: (filter: WikiAccessFilter) => void;
  selectionMode?: boolean;
  selectedKeys?: readonly string[];
  onToggleSelected?: (key: string) => void;
  onSelectFiltered?: () => void;
  onClearSelection?: () => void;
  onStartSelection?: () => void;
  onExitSelection?: () => void;
  onOpenBatchAccess?: () => void;
  selectionNotice?: string | null;
};

const EMPTY_ACCESS: WikiAccessListEntry = {
  file_version: "",
  acl: { state: "missing" },
  declared_role_count: 0,
  declared_without_discover: 0,
  declared_without_read: 0
};

function accessOf(page: WikiSummary): WikiAccessListEntry {
  return page.access ?? EMPTY_ACCESS;
}

/**
 * Right-panel Markdown list for the Business Wiki explorer.
 *
 * Spec 105 (Attu-aligned): without a selected directory, show a select
 * prompt instead of a flat whole-library dump. With a directory, filter
 * to that prefix. The sidebar tree remains the only directory hierarchy.
 *
 * Spec 193: every row shows its authorization status from the ONE aggregate
 * list response, the authorization filter is a view-only concern, and the
 * bulk selection always contains explicit document keys (never a directory).
 */
export function WikiLibraryHome({
  pages,
  selectedDirectory = null,
  onSelect,
  accessFilter = "all",
  onAccessFilterChange,
  selectionMode = false,
  selectedKeys = [],
  onToggleSelected,
  onSelectFiltered,
  onClearSelection,
  onStartSelection,
  onExitSelection,
  onOpenBatchAccess,
  selectionNotice = null
}: WikiLibraryHomeProps) {
  const directory = selectedDirectory?.trim() || "";
  const scopedPages = directory ? pagesUnderDirectory(pages, directory) : [];
  const filteredPages = scopedPages.filter((page) =>
    matchesWikiAccessFilter(accessOf(page), accessFilter)
  );

  if (!directory) {
    return (
      <section
        aria-label="Markdown 文档库"
        className="pl-wiki-library-home"
        data-testid="wiki-library-home"
      >
        <div
          className="pl-wiki-library-select-prompt"
          data-testid="wiki-library-select-prompt"
        >
          <p className="pl-wiki-library-select-prompt-title">从左侧选择目录或文档</p>
          <p className="pl-wiki-library-select-prompt-hint">
            选择 Wiki 目录后，将在此列出该目录下的 <span className="notranslate" translate="no">Markdown</span> 文档。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Markdown 文档库"
      className="pl-wiki-library-home"
      data-directory={directory}
      data-testid="wiki-library-home"
    >
      <p className="pl-wiki-library-summary" data-testid="wiki-library-summary">
        当前目录{" "}
        <code className="notranslate" translate="no">
          wiki/{directory}
        </code>
        {" · "}
        <strong>{scopedPages.length}</strong> 篇
      </p>

      <div
        aria-label="按授权状态筛选"
        className="pl-segmented-control pl-segmented-control--auto"
        data-testid="wiki-library-access-filters"
        role="group"
      >
        {WIKI_ACCESS_FILTERS.map((filter) => (
          <button
            aria-pressed={accessFilter === filter}
            className={
              accessFilter === filter
                ? "pl-segmented-control-item pl-segmented-control-item--active"
                : "pl-segmented-control-item"
            }
            data-testid={`wiki-library-access-filter-${filter}`}
            key={filter}
            onClick={() => onAccessFilterChange?.(filter)}
            type="button"
          >
            {WIKI_ACCESS_FILTER_LABELS[filter]}
          </button>
        ))}
      </div>

      <div className="pl-wiki-library-toolbar" data-testid="wiki-library-toolbar">
        {selectionMode ? (
          <>
            <span
              className="pl-wiki-library-selection-count"
              data-testid="wiki-library-selection-count"
            >
              已选 {selectedKeys.length} 篇
            </span>
            <button
              className="pl-btn pl-btn--secondary text-sm"
              data-testid="wiki-library-select-filtered"
              onClick={onSelectFiltered}
              type="button"
            >
              选择当前筛选结果
            </button>
            <button
              className="pl-btn pl-btn--ghost text-sm"
              data-testid="wiki-library-clear-selection"
              onClick={onClearSelection}
              type="button"
            >
              清空选择
            </button>
            <button
              aria-describedby="wiki-library-continue-reason"
              className="pl-btn pl-btn--primary text-sm"
              data-testid="wiki-library-batch-continue"
              disabled={selectedKeys.length === 0}
              onClick={onOpenBatchAccess}
              type="button"
            >
              继续
            </button>
            <button
              className="pl-btn pl-btn--ghost text-sm"
              data-testid="wiki-library-batch-exit"
              onClick={onExitSelection}
              type="button"
            >
              退出批量选择
            </button>
            <span
              className="pl-wiki-library-selection-reason"
              data-testid="wiki-library-continue-reason"
              id="wiki-library-continue-reason"
            >
              {selectedKeys.length === 0
                ? "请先选择至少一篇文档。"
                : `将批量管理已选的 ${selectedKeys.length} 篇文档。`}
            </span>
          </>
        ) : (
          <button
            className="pl-btn pl-btn--secondary text-sm"
            data-testid="wiki-library-batch-start"
            onClick={onStartSelection}
            type="button"
          >
            批量管理权限
          </button>
        )}
        {selectionNotice ? (
          <p className="pl-wiki-library-selection-notice" data-testid="wiki-library-selection-notice">
            {selectionNotice}
          </p>
        ) : null}
      </div>

      {filteredPages.length === 0 ? (
        <div
          className="pl-wiki-library-empty"
          data-testid="wiki-library-directory-empty"
        >
          <p>此目录还没有 Markdown 文档。</p>
        </div>
      ) : (
        <ul className="pl-wiki-library-documents" data-testid="wiki-library-documents">
          {filteredPages.map((page) => {
            const title = page.summary?.trim() || wikiTitleFromKey(page.key);
            return (
              <li
                className="pl-wiki-library-document"
                data-testid="wiki-library-document"
                key={page.key}
              >
                {selectionMode ? (
                  <input
                    aria-label={`选择 ${title}`}
                    checked={selectedKeys.includes(page.key)}
                    className="pl-wiki-library-select"
                    data-testid={`wiki-library-select-${page.key}`}
                    onChange={() => onToggleSelected?.(page.key)}
                    type="checkbox"
                  />
                ) : null}
                <button
                  className="pl-wiki-library-document-button"
                  data-testid={`wiki-library-document-button-${page.key}`}
                  onClick={() => onSelect(page.key)}
                  type="button"
                >
                  <span
                    className="pl-wiki-library-md-icon notranslate"
                    aria-hidden
                    translate="no"
                  >
                    MD
                  </span>
                  <span className="pl-wiki-library-document-main">
                    <span
                      className="pl-wiki-library-document-title"
                      data-testid="wiki-library-document-title"
                    >
                      {title}
                    </span>
                    <code
                      className="pl-wiki-library-document-path notranslate"
                      data-testid="wiki-library-document-path"
                      translate="no"
                    >
                      wiki/{page.key}
                    </code>
                  </span>
                </button>
                <WikiAccessStatusBadge
                  access={accessOf(page)}
                  testId={`wiki-library-access-status-${page.key}`}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
