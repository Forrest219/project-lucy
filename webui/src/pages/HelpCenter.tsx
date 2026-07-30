import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { MarkdownPreview } from "../components/MarkdownPreview";
import { apiGet } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import type { HelpHandbook, HelpTocItem } from "../lib/types";

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

function sectionHref(id: string) {
  return `/help?section=${encodeURIComponent(id)}`;
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function displayTocTitle(title: string) {
  return title.replace(/^\d+(?:\.\d+)*\.?\s*/, "");
}

export function HelpCenter() {
  const [searchParams] = useSearchParams();
  const activeSection = searchParams.get("section") ?? "";
  const handbookQuery = useQuery({
    queryKey: queryKeys.helpHandbook,
    queryFn: () => apiGet<HelpHandbook>("/api/help/handbook")
  });

  const sections = useMemo(
    () => handbookQuery.data ? splitIntoSections(handbookQuery.data.markdown, handbookQuery.data.toc) : [],
    [handbookQuery.data]
  );

  useEffect(() => {
    if (!activeSection || sections.length === 0) return;
    const target = document.getElementById(activeSection);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeSection, sections.length]);

  if (handbookQuery.isLoading) {
    return <div className="pl-notice">系统手册加载中...</div>;
  }

  if (handbookQuery.isError || !handbookQuery.data) {
    return <div className="pl-error">系统手册加载失败。</div>;
  }

  const handbook = handbookQuery.data;

  return (
    <div className="pl-help-page">
      <header className="pl-page-header">
        <div className="pl-page-header-grid">
          <div className="pl-page-header-cell pl-page-header-cell--breadcrumbs">
            <ol className="pl-page-header-breadcrumbs">
              <li className="pl-page-header-breadcrumb-item">系统帮助</li>
              <li className="pl-page-header-breadcrumb-item">
                <span className="pl-page-header-breadcrumb-sep">/</span>
                <span>系统手册</span>
              </li>
            </ol>
          </div>
          <div className="pl-page-header-cell pl-page-header-cell--badges">
            <span>{handbook.sourcePath}</span>
            <span>{formatUpdatedAt(handbook.updatedAt)}</span>
          </div>
          <div className="pl-page-header-cell pl-page-header-cell--title">
            <h1 className="pl-page-header-title">系统手册</h1>
            <p className="pl-page-header-description">{handbook.title}</p>
          </div>
          <div className="pl-page-header-cell pl-page-header-cell--actions">
            <Link className="pl-btn pl-btn--secondary" to="/">
              返回工作台
            </Link>
          </div>
        </div>
      </header>

      <div className="pl-help-layout">
        <aside className="pl-help-toc" aria-label="系统手册目录">
          <div className="pl-help-toc-title">目录</div>
          <nav className="grid gap-1">
            {handbook.toc.map((item) => (
              <Link
                aria-current={activeSection === item.id ? "location" : undefined}
                className={`pl-help-toc-link pl-help-toc-link--level-${item.level}`}
                key={item.id}
                to={sectionHref(item.id)}
              >
                {displayTocTitle(item.title)}
              </Link>
            ))}
          </nav>
        </aside>

        <article className="pl-help-content" data-testid="help-content">
          {sections.map((section) => (
            <section className="pl-help-section" id={section.id} key={section.id}>
              <MarkdownPreview markdown={section.markdown} />
            </section>
          ))}
        </article>
      </div>
    </div>
  );
}
