import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { MarkdownPreview } from "../components/MarkdownPreview";
import { apiGet } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import type { HelpHandbook, HelpSearchResult, HelpTocItem } from "../lib/types";

type HelpSection = {
  id: string;
  tocItem?: HelpTocItem;
  markdown: string;
};

type HeadingMatch = {
  index: number;
  level: 2 | 3 | 4;
  title: string;
};

type TocItemWithIndex = HelpTocItem & {
  index: number;
};

function headingMatchesOutsideFences(markdown: string, toc: HelpTocItem[]): HeadingMatch[] {
  const matches: HeadingMatch[] = [];
  const tocTitles = new Set(toc.map((item) => item.title));
  let offset = 0;
  let inFence = false;
  for (const line of markdown.split(/(\r?\n)/)) {
    if (line === "\n" || line === "\r\n") {
      offset += line.length;
      continue;
    }
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
    } else if (!inFence) {
      const heading = line.match(/^(#{2,4})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        const level = (heading[1]?.length ?? 2) as 2 | 3 | 4;
        const title = (heading[2] ?? "").trim();
        if (level > 3 && !tocTitles.has(title)) {
          offset += line.length;
          continue;
        }
        matches.push({
          index: offset,
          level,
          title
        });
      }
    }
    offset += line.length;
  }
  return matches;
}

function splitIntoSections(markdown: string, toc: HelpTocItem[]): HelpSection[] {
  if (toc.length === 0) {
    return [{ id: "system-overview", markdown }];
  }

  const headingToItem = new Map(toc.map((item) => [item.title, item]));
  const matches = headingMatchesOutsideFences(markdown, toc);
  const sections: HelpSection[] = [];

  const firstHeading = matches[0];
  if (firstHeading?.index && firstHeading.index > 0) {
    const preface = markdown.slice(0, firstHeading.index).replace(/^#\s+.+(?:\r?\n)?/, "").trim();
    if (preface) {
      sections.push({
        id: "handbook-title",
        markdown: preface
      });
    }
  }

  matches.forEach((match, index) => {
    const item = headingToItem.get(match.title);
    const start = match.index;
    const end = matches[index + 1]?.index ?? markdown.length;
    sections.push({
      id: item?.id ?? `section-${index}`,
      tocItem: item,
      markdown: markdown.slice(start, end).trim()
    });
  });

  return sections.filter((section) => section.markdown.length > 0);
}

function isHelpTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  if (!inner) return false;
  return inner
    .split("|")
    .map((cell) => cell.trim())
    .every((cell) => /^:?-{3,}:?$/.test(cell));
}

/**
 * Strip the leading handbook H1, immediately-following metadata pipe table,
 * and the optional hand-authored "目录" section. The backend `markdown` field
 * and the `toc` array remain the single source of truth and are not mutated.
 */
function stripLeadingHandbookPreface(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let i = 0;

  // Skip leading blank lines, then expect a top-level H1.
  while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
  if (i >= lines.length || !/^#\s+/.test(lines[i] ?? "")) return markdown;
  i++;

  // Skip blank lines between the H1 and the metadata table.
  while (i < lines.length && (lines[i] ?? "").trim() === "") i++;

  // The metadata block is a GFM pipe table: header row, separator row, body rows.
  if (i + 1 >= lines.length) return markdown;
  const headerLine = lines[i] ?? "";
  const separatorLine = lines[i + 1] ?? "";
  if (!headerLine.includes("|") || !isHelpTableSeparatorLine(separatorLine)) return markdown;

  i += 2;
  while (i < lines.length && (lines[i] ?? "").trim() !== "") {
    if (!(lines[i] ?? "").includes("|")) break;
    i++;
  }

  // Trim trailing blank lines so subsequent splitting starts at the first H2.
  while (i < lines.length && (lines[i] ?? "").trim() === "") i++;

  if (/^##\s+目录\s*#*\s*$/.test(lines[i] ?? "")) {
    i++;
    while (i < lines.length && !/^##\s+/.test(lines[i] ?? "")) i++;
    while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
  }

  return lines.slice(i).join("\n");
}

function visibleHelpTocItems(toc: HelpTocItem[], activeSection: string): HelpTocItem[] {
  const indexed = toc.map<TocItemWithIndex>((item, index) => ({ ...item, index }));
  const activeItem = indexed.find((item) => item.id === activeSection);
  if (!activeItem || activeItem.level < 4) {
    return toc.filter((item) => item.level <= 3);
  }

  let parentIndex = activeItem.index;
  while (parentIndex >= 0 && indexed[parentIndex]?.level !== 3) parentIndex--;
  const nextPeerIndex = indexed.findIndex(
    (item) => item.index > parentIndex && item.level <= 3
  );
  const sectionEnd = nextPeerIndex === -1 ? indexed.length : nextPeerIndex;

  return indexed
    .filter((item) => item.level <= 3 || (item.index > parentIndex && item.index < sectionEnd))
    .map(({ index: _index, ...item }) => item);
}

function sectionHref(id: string, q?: string) {
  const params = new URLSearchParams();
  params.set("section", id);
  if (q?.trim()) params.set("q", q.trim());
  return `/help?${params.toString()}`;
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function displayTocTitle(title: string) {
  return title.replace(/^\d+(?:\.\d+)*\.?\s*/, "");
}

function highlightText(text: string, query: string): ReactNode {
  const needle = query.trim();
  if (!needle || !text) return text;
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let next = lowerText.indexOf(lowerNeedle, cursor);
  let part = 0;
  while (next !== -1) {
    if (next > cursor) {
      nodes.push(<span key={`t-${part++}`}>{text.slice(cursor, next)}</span>);
    }
    nodes.push(
      <mark className="pl-help-search-highlight" key={`m-${part++}`}>
        {text.slice(next, next + needle.length)}
      </mark>
    );
    cursor = next + needle.length;
    next = lowerText.indexOf(lowerNeedle, cursor);
  }
  if (cursor < text.length) {
    nodes.push(<span key={`t-${part++}`}>{text.slice(cursor)}</span>);
  }
  return nodes;
}

export function HelpCenter() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSection = searchParams.get("section") ?? "";
  const queryFromUrl = searchParams.get("q") ?? "";
  const [draftQuery, setDraftQuery] = useState(queryFromUrl);

  useEffect(() => {
    setDraftQuery(queryFromUrl);
  }, [queryFromUrl]);

  const handbookQuery = useQuery({
    queryKey: queryKeys.helpHandbook,
    queryFn: () => apiGet<HelpHandbook>("/api/help/handbook")
  });

  const activeQuery = queryFromUrl.trim();
  const searchQuery = useQuery({
    queryKey: queryKeys.helpSearch(activeQuery),
    queryFn: () =>
      apiGet<HelpSearchResult>(`/api/help/search?q=${encodeURIComponent(activeQuery)}`),
    enabled: activeQuery.length > 0
  });

  const sections = useMemo(
    () =>
      handbookQuery.data
        ? splitIntoSections(
            stripLeadingHandbookPreface(handbookQuery.data.markdown),
            handbookQuery.data.toc
          )
        : [],
    [handbookQuery.data]
  );
  const visibleToc = useMemo(
    () => (handbookQuery.data ? visibleHelpTocItems(handbookQuery.data.toc, activeSection) : []),
    [activeSection, handbookQuery.data]
  );

  useEffect(() => {
    if (!activeSection || sections.length === 0 || activeQuery) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(activeSection)?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSection, sections.length, activeQuery]);

  function commitSearch(nextQuery: string) {
    const trimmed = nextQuery.trim();
    const next = new URLSearchParams(searchParams);
    if (trimmed) {
      next.set("q", trimmed);
    } else {
      next.delete("q");
    }
    setSearchParams(next, { replace: true });
  }

  function clearSearch() {
    setDraftQuery("");
    const next = new URLSearchParams(searchParams);
    next.delete("q");
    setSearchParams(next, { replace: true });
  }

  if (handbookQuery.isLoading) {
    return <div className="pl-notice">系统手册加载中...</div>;
  }

  if (handbookQuery.isError || !handbookQuery.data) {
    return <div className="pl-error">系统手册加载失败。</div>;
  }

  const handbook = handbookQuery.data;
  const searchItems = searchQuery.data?.items ?? [];
  const showSearchResults = activeQuery.length > 0;

  return (
    <div className="pl-help-page">
      <PageHeader
        title="系统手册"
        breadcrumbs={["系统帮助"]}
        description={handbook.title}
        badges={
          <>
            <span>
              来源 <code className="notranslate" translate="no">{handbook.sourcePath}</code>
            </span>
            <span>更新时间 {formatUpdatedAt(handbook.updatedAt)}</span>
          </>
        }
        actions={
          <Link className="pl-btn pl-btn--secondary" to="/overview">
            返回系统概览
          </Link>
        }
      />

      <div className="pl-help-layout">
        <aside className="pl-help-toc" aria-label="系统手册目录">
          <div className="pl-help-search">
            <label className="sr-only" htmlFor="help-search-input">
              搜索系统手册
            </label>
            <input
              className="pl-help-search-input"
              id="help-search-input"
              placeholder="搜索手册内容…"
              type="search"
              value={draftQuery}
              onChange={(event) => {
                const value = event.target.value;
                setDraftQuery(value);
                commitSearch(value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  clearSearch();
                }
              }}
            />
          </div>
          <div className="pl-help-toc-title">目录</div>
          <nav className="grid gap-1">
            {visibleToc.map((item) => (
              <Link
                aria-current={activeSection === item.id ? "location" : undefined}
                className={`pl-help-toc-link pl-help-toc-link--level-${item.level}`}
                key={item.id}
                to={sectionHref(item.id, activeQuery || undefined)}
              >
                {displayTocTitle(item.title)}
              </Link>
            ))}
          </nav>
        </aside>

        <article className="pl-help-content" data-testid="help-content">
          {showSearchResults ? (
            <div className="pl-help-search-results" data-testid="help-search-results">
              <div className="pl-help-search-results-header">
                <h2 className="pl-help-search-results-title">搜索结果</h2>
                <p className="pl-help-search-results-meta">
                  关键词「{activeQuery}」
                  {searchQuery.isFetching ? " · 搜索中…" : ` · ${searchItems.length} 条`}
                </p>
                <button className="pl-btn pl-btn--secondary pl-btn--sm" onClick={clearSearch} type="button">
                  清除搜索
                </button>
              </div>
              {searchQuery.isError ? (
                <p className="pl-error">手册搜索失败。</p>
              ) : null}
              {!searchQuery.isFetching && !searchQuery.isError && searchItems.length === 0 ? (
                <p className="pl-notice" data-testid="help-search-empty">
                  未找到与「{activeQuery}」相关的手册内容。
                </p>
              ) : null}
              <ul className="pl-help-search-result-list">
                {searchItems.map((item) => (
                  <li className="pl-help-search-result-item" key={`${item.sectionId}-${item.title}`}>
                    <Link
                      className="pl-help-search-result-link"
                      to={sectionHref(item.sectionId)}
                      onClick={() => {
                        const next = new URLSearchParams();
                        next.set("section", item.sectionId);
                        setSearchParams(next, { replace: true });
                        setDraftQuery("");
                      }}
                    >
                      <span className="pl-help-search-result-title">
                        {highlightText(displayTocTitle(item.title), activeQuery)}
                      </span>
                      <span className="pl-help-search-result-snippet">
                        {highlightText(item.snippet, activeQuery)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            sections.map((section) => (
              <section className="pl-help-section" id={section.id} key={section.id}>
                <MarkdownPreview markdown={section.markdown} />
              </section>
            ))
          )}
        </article>
      </div>
    </div>
  );
}
