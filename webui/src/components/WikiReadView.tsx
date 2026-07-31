import clsx from "clsx";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { MarkdownPreview } from "./MarkdownPreview";
import {
  WIKI_TEMPLATES,
  extractWikiToc,
  wikiTitleFromContent
} from "../lib/wiki";
import { splitSlRef } from "../lib/slRef";
import type { SourceSummary, WikiFrontmatter } from "../lib/types";

export type WikiReadViewProps = {
  keyName: string;
  content: string;
  frontmatter: WikiFrontmatter;
  knownSources: ReadonlySet<string>;
  knownTables: SourceSummary[];
  onApplyTemplate: (content: string) => void;
  onSwitchToEdit: () => void;
};

const EMPTY_BODY_HINT =
  "Wiki 维护 Markdown 业务说明。Schema Manifest 请在连接概览上传；semantic overlay 请在表目录或表详情维护。";

/**
 * Read-only document surface for the Business Wiki workbench.
 *
 * Renders the article title, a compact meta header, the rendered
 * Markdown body and a sticky table of contents. When the underlying
 * body is empty, the surface doubles as a guided empty state with the
 * four canonical templates.
 */
export function WikiReadView({
  keyName,
  content,
  frontmatter,
  knownSources,
  knownTables,
  onApplyTemplate,
  onSwitchToEdit
}: WikiReadViewProps) {
  const trimmed = content.trim();
  const title = useMemo(
    () => wikiTitleFromContent(content, keyName, frontmatter),
    [content, frontmatter, keyName]
  );
  const toc = useMemo(() => (trimmed ? extractWikiToc(content) : []), [content, trimmed]);
  const slRefs = frontmatter.sl_refs ?? [];
  const tags = frontmatter.tags ?? [];

  return (
    <article className="pl-wiki-read-view" aria-label={`${title} 阅读视图`}>
      <header className="pl-wiki-read-header">
        <h1 className="pl-wiki-read-title" data-testid="wiki-read-title">
          {title}
        </h1>
        <p className="pl-wiki-read-key notranslate" translate="no" title={keyName}>
          wiki/{keyName}
        </p>
        {frontmatter.summary ? (
          <p className="pl-wiki-read-summary" data-testid="wiki-read-summary">
            {frontmatter.summary}
          </p>
        ) : null}
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
          {slRefs.length > 0 ? (
            <ul
              aria-label="关联语义对象"
              className="pl-wiki-read-refs"
              data-testid="wiki-read-refs"
            >
              {slRefs.map((ref) => {
                const split = splitSlRef(ref);
                const known = split ? knownSources.has(ref) : false;
                const state = known ? "known" : "unknown";
                const label = split ? `${split.schema}.${split.table}` : ref;
                const table = known ? knownTables.find((t) => `${t.conn}/${t.schema}/${t.table}` === ref) : undefined;
                const content = (
                  <>
                    <span className="pl-wiki-read-ref-label notranslate" translate="no">{label}</span>
                    {!known ? (
                      <span className="pl-wiki-read-ref-warning" aria-label="未知语义对象">
                        未知语义对象
                      </span>
                    ) : null}
                  </>
                );
                return (
                  <li
                    className={clsx("pl-wiki-read-ref", `pl-wiki-read-ref--${state}`)}
                    data-sl-ref-state={state}
                    data-testid="wiki-read-ref"
                    key={ref}
                  >
                    {known && split && table ? (
                      <Link
                        aria-label={`打开 ${table.table} 表语义编辑器`}
                        className="pl-wiki-read-ref-link"
                        to={`/sources/${encodeURIComponent(split.conn)}/${encodeURIComponent(split.schema)}/${encodeURIComponent(split.table)}`}
                      >
                        {content}
                      </Link>
                    ) : (
                      <span
                        aria-label={known ? `关联语义对象 ${ref}` : `未知关联语义对象 ${ref}`}
                        className="pl-wiki-read-ref-text"
                      >
                        {content}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
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
                选一个模板开始撰写，或直接进入 <button
                  className="pl-inline-link"
                  onClick={onSwitchToEdit}
                  type="button"
                >
                  编辑
                </button> 模式。
              </p>
              <ul className="pl-wiki-read-empty-templates" data-testid="wiki-read-templates">
                {WIKI_TEMPLATES.map((template) => (
                  <li className="pl-wiki-read-template" key={template.label}>
                    <button
                      className="pl-wiki-read-template-button"
                      data-testid={`wiki-read-template-${template.label}`}
                      onClick={() => onApplyTemplate(template.content)}
                      type="button"
                    >
                      <strong className="notranslate" translate="no">{template.label}</strong>
                      <span>{template.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <aside
          aria-label="文档目录"
          className="pl-wiki-read-toc"
          data-testid="wiki-read-toc"
        >
          <p className="pl-wiki-read-toc-title">目录</p>
          {toc.length > 0 ? (
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
          ) : (
            <p className="pl-notice">正文暂无可跳转的章节。</p>
          )}
        </aside>
      </div>
    </article>
  );
}
