import { useState } from "react";
import { FrontmatterForm } from "./FrontmatterForm";
import { MarkdownPreview } from "./MarkdownPreview";
import type { WikiFrontmatter } from "../lib/types";

export type WikiEditViewProps = {
  frontmatter: WikiFrontmatter;
  content: string;
  onFrontmatterChange: (next: WikiFrontmatter) => void;
  onContentChange: (next: string) => void;
};

/**
 * Focused edit surface for the Business Wiki workbench.
 *
 * The 80%+ working area is dedicated to the Markdown source and the
 * rendered preview. Frontmatter (summary / tags / sl_refs) collapses
 * into a compact "文档信息" disclosure so the body editor remains
 * dominant. Diff / Raw are intentionally NOT rendered here — they live
 * in `WikiSavePreflight`.
 */
export function WikiEditView({
  frontmatter,
  content,
  onFrontmatterChange,
  onContentChange
}: WikiEditViewProps) {
  const [showMeta, setShowMeta] = useState(false);
  return (
    <section
      aria-label="Wiki 编辑工作区"
      className="pl-wiki-edit-view"
      data-testid="wiki-edit-view"
    >
      <details
        className="pl-wiki-edit-meta"
        data-testid="wiki-edit-meta"
        onToggle={(event) => setShowMeta((event.currentTarget as HTMLDetailsElement).open)}
        open={showMeta}
      >
        <summary className="pl-wiki-edit-meta-summary">
          <span>文档信息</span>
          <span className="pl-wiki-edit-meta-hint">
            关联语义对象、标签、摘要。高级字段（外部引用 / 使用方式）请展开更多元信息。
          </span>
        </summary>
        <div className="pl-wiki-edit-meta-body">
          <FrontmatterForm onChange={onFrontmatterChange} value={frontmatter} />
        </div>
      </details>

      <div className="pl-wiki-edit-grid" data-testid="wiki-edit-grid">
        <section
          aria-label="Markdown 源码"
          className="pl-wiki-edit-source"
          data-testid="wiki-edit-source"
        >
          <header className="pl-wiki-edit-source-header">
            <p className="pl-wiki-edit-source-title">正文 Markdown</p>
            <span className="pl-wiki-edit-source-hint notranslate" translate="no">
              ⌘/Ctrl + S 触发保存预检
            </span>
          </header>
          <textarea
            aria-label="Markdown 源码"
            className="pl-textarea pl-wiki-edit-source-input notranslate"
            data-testid="wiki-edit-textarea"
            onChange={(event) => onContentChange(event.target.value)}
            rows={22}
            translate="no"
            value={content}
          />
        </section>
        <section
          aria-label="渲染预览"
          className="pl-wiki-edit-preview"
          data-testid="wiki-edit-preview"
        >
          <header className="pl-wiki-edit-preview-header">
            <p className="pl-wiki-edit-preview-title">渲染预览</p>
            <span className="pl-wiki-edit-preview-hint">仅显示最终渲染结果；Diff / Raw 在保存预检中查看。</span>
          </header>
          {content.trim() ? (
            <MarkdownPreview markdown={content} />
          ) : (
            <p className="pl-notice">正文为空，先在左侧 Markdown 编辑器中写点内容吧。</p>
          )}
        </section>
      </div>
    </section>
  );
}
