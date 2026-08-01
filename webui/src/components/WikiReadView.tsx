import clsx from "clsx";
import { useMemo } from "react";
import { LinkedSemanticObjects } from "./LinkedSemanticObjects";
import { MarkdownPreview } from "./MarkdownPreview";
import { extractTemplatePlaceholders, extractWikiToc, wikiTitleFromContent } from "../lib/wiki";
import type { SourceSummary, WikiFrontmatter } from "../lib/types";

export type WikiReadViewProps = {
  keyName: string;
  content: string;
  frontmatter: WikiFrontmatter;
  knownSources: ReadonlySet<string>;
  knownTables: SourceSummary[];
  onApplyTemplate: (content: string) => void;
  onOpenTemplatePicker: () => void;
  onSwitchToEdit: () => void;
};

const EMPTY_BODY_HINT =
  "Wiki 维护 Markdown 业务说明。Schema Manifest 请在连接概览上传；semantic overlay 请在表详情维护。";

/**
 * Read-only document surface for the Business Wiki workbench.
 *
 * Renders the article title, a compact meta header, the rendered
 * Markdown body and a sticky table of contents. When the underlying
 * body is empty, the surface doubles as a guided empty state that
 * opens the dedicated Template Picker modal instead of rendering
 * templates inline.
 */
export function WikiReadView({
  keyName,
  content,
  frontmatter,
  knownSources,
  knownTables,
  onApplyTemplate,
  onOpenTemplatePicker,
  onSwitchToEdit
}: WikiReadViewProps) {
  const trimmed = content.trim();
  const title = useMemo(
    () => wikiTitleFromContent(content, keyName, frontmatter),
    [content, frontmatter, keyName]
  );
  const toc = useMemo(() => (trimmed ? extractWikiToc(content) : []), [content, trimmed]);
  const tags = frontmatter.tags ?? [];
  const slRefs = frontmatter.sl_refs ?? [];
  const hasMeta = tags.length > 0 || slRefs.length > 0;
  const summary = frontmatter.summary?.trim();
  const placeholders = useMemo(
    () => (trimmed ? extractTemplatePlaceholders(content) : []),
    [content, trimmed]
  );

  return (
    <article className="pl-wiki-read-view" aria-label={`${title} 阅读视图`}>
      <header className="pl-wiki-read-header">
        <h1 className="pl-wiki-read-title" data-testid="wiki-read-title">
          {title}
        </h1>
        {summary && summary !== title ? (
          <p className="pl-wiki-read-summary" data-testid="wiki-read-summary">
            {summary}
          </p>
        ) : null}
        {hasMeta ? (
          <div className="pl-wiki-read-meta" data-testid="wiki-read-meta">
            {tags.length > 0 ? (
              <ul
                aria-label="文档标签"
                className="pl-wiki-read-tags"
                data-testid="wiki-read-tags"
              >
                {tags.map((tag) => (
                  <li className="pl-wiki-read-tag notranslate" key={tag} translate="no">
                    #{tag}
                  </li>
                ))}
              </ul>
            ) : null}
            <LinkedSemanticObjects
              knownSources={knownSources}
              knownTables={knownTables}
              refs={slRefs}
            />
          </div>
        ) : null}
        {placeholders.length > 0 ? (
          <p
            aria-label="模板待补全占位符"
            className="pl-wiki-read-placeholder-hint"
            data-testid="wiki-read-placeholder-hint"
          >
            还有 {placeholders.length} 个待补全模板占位符，进入
            <button
              className="pl-inline-link"
              data-testid="wiki-read-placeholder-edit"
              onClick={onSwitchToEdit}
              type="button"
            >
              编辑态
            </button>
            完善。
          </p>
        ) : null}
      </header>

      <div
        className={clsx("pl-wiki-read-layout", toc.length === 0 && "pl-wiki-read-layout--no-toc")}
        data-testid="wiki-read-layout"
      >
        <div className="pl-wiki-read-body" data-testid="wiki-read-body">
          {trimmed ? (
            <MarkdownPreview markdown={content} />
          ) : (
            <section
              aria-label="空草稿引导"
              className="pl-wiki-read-empty"
              data-testid="wiki-read-empty"
            >
              <p className="pl-wiki-read-empty-hint">{EMPTY_BODY_HINT}</p>
              <p className="pl-wiki-read-empty-subhint">
                打开模板选择填充 Markdown 骨架，或直接进入
                <button
                  className="pl-inline-link"
                  data-testid="wiki-read-empty-edit"
                  onClick={onSwitchToEdit}
                  type="button"
                >
                  编辑
                </button>
                模式。
              </p>
              <div className="pl-wiki-read-empty-actions">
                <button
                  className="pl-btn pl-btn--primary"
                  data-testid="wiki-read-empty-pick-template"
                  onClick={onOpenTemplatePicker}
                  type="button"
                >
                  模板选择
                </button>
                <button
                  className="pl-btn pl-btn--ghost"
                  data-testid="wiki-read-empty-blank"
                  onClick={() => onApplyTemplate("")}
                  type="button"
                >
                  从空白草稿开始
                </button>
              </div>
            </section>
          )}
        </div>
        {toc.length > 0 ? (
          <aside
            aria-label="文档目录"
            className="pl-wiki-read-toc"
            data-testid="wiki-read-toc"
          >
            <p className="pl-wiki-read-toc-title">目录</p>
            <ol className="pl-wiki-read-toc-list">
              {toc.map((item) => (
                <li
                  className={clsx(
                    "pl-wiki-read-toc-item",
                    `pl-wiki-read-toc-item--level-${item.level}`
                  )}
                  key={`${item.id}-${item.text}`}
                >
                  <a className="pl-wiki-read-toc-link" href={`#${item.id}`}>
                    {item.text}
                  </a>
                </li>
              ))}
            </ol>
          </aside>
        ) : null}
      </div>
    </article>
  );
}
