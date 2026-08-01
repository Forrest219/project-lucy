import clsx from "clsx";
import { useMemo, useRef, useState } from "react";
import { MarkdownPreview } from "./MarkdownPreview";
import { MarkdownToolbar } from "./MarkdownToolbar";
import { extractTemplatePlaceholders } from "../lib/wiki";
import type { WikiFrontmatter } from "../lib/types";

export type WikiEditViewProps = {
  frontmatter: WikiFrontmatter;
  content: string;
  onFrontmatterChange: (next: WikiFrontmatter) => void;
  onContentChange: (next: string) => void;
  /**
   * `true` forces the Markdown + Preview panels to stack as Tabs. The
   * parent decides when this is appropriate (narrow viewports). When
   * `false` the editor renders a side-by-side grid.
   */
  previewTab?: boolean;
  onPreviewTabChange?: (next: boolean) => void;
};

/**
 * Focused edit surface for the Business Wiki workbench.
 *
 * The Markdown source and rendered preview dominate the working area.
 * Frontmatter (`文档信息`) has been moved into a header-level Drawer
 * so it no longer interrupts the input flow. A lightweight toolbar
 * sits directly above the textarea and supports bold / italic /
 * inline code / code block / heading / table / link insertion.
 */
export function WikiEditView({
  frontmatter,
  content,
  onFrontmatterChange,
  onContentChange,
  previewTab = false,
  onPreviewTabChange
}: WikiEditViewProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [activePane, setActivePane] = useState<"markdown" | "preview">(
    "markdown"
  );
  const placeholders = useMemo(
    () => extractTemplatePlaceholders(content),
    [content]
  );

  return (
    <section
      aria-label="Wiki 编辑工作区"
      className="pl-wiki-edit-view"
      data-testid="wiki-edit-view"
    >
      {placeholders.length > 0 ? (
        <p
          aria-label="模板待补全占位符"
          className="pl-wiki-edit-placeholder-hint"
          data-testid="wiki-edit-placeholder-hint"
        >
          仍有 {placeholders.length} 个模板占位符待补全，例如
          <code className="notranslate" translate="no">[请输入…]</code>
          。
        </p>
      ) : null}

      <div
        className={clsx(
          "pl-wiki-edit-grid",
          previewTab && "pl-wiki-edit-grid--tab"
        )}
        data-testid="wiki-edit-grid"
      >
        <section
          aria-label="Markdown 源码"
          className="pl-wiki-edit-source"
          data-testid="wiki-edit-source"
        >
          <header className="pl-wiki-edit-source-header">
            <p className="pl-wiki-edit-source-title">正文 Markdown</p>
            <span
              className="pl-wiki-edit-source-hint notranslate"
              translate="no"
            >
              ⌘/Ctrl + S 触发保存预检
            </span>
          </header>
          <MarkdownToolbar onChange={onContentChange} textareaRef={textareaRef} />
          <textarea
            aria-label="Markdown 源码"
            className="pl-textarea pl-wiki-edit-source-input notranslate"
            data-testid="wiki-edit-textarea"
            onChange={(event) => onContentChange(event.target.value)}
            ref={textareaRef}
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
            <span className="pl-wiki-edit-preview-hint">
              仅显示最终渲染结果；Diff / Raw 在保存预检中查看。
            </span>
          </header>
          {content.trim() ? (
            <MarkdownPreview markdown={content} />
          ) : (
            <p className="pl-notice">正文为空，先在左侧 Markdown 编辑器中写点内容吧。</p>
          )}
        </section>
      </div>
      {previewTab ? (
        <div
          aria-label="Markdown 与 Preview 切换"
          className="pl-wiki-edit-tab-toggle"
          data-testid="wiki-edit-tab-toggle"
          role="tablist"
        >
          <button
            aria-selected={activePane === "markdown"}
            className={clsx(
              "pl-btn",
              "pl-btn--ghost",
              activePane === "markdown" &&
                "pl-wiki-edit-tab-toggle--active"
            )}
            data-testid="wiki-edit-tab-markdown"
            onClick={() => {
              setActivePane("markdown");
              onPreviewTabChange?.(false);
            }}
            role="tab"
            type="button"
          >
            Markdown
          </button>
          <button
            aria-selected={activePane === "preview"}
            className={clsx(
              "pl-btn",
              "pl-btn--ghost",
              activePane === "preview" && "pl-wiki-edit-tab-toggle--active"
            )}
            data-testid="wiki-edit-tab-preview"
            onClick={() => {
              setActivePane("preview");
              onPreviewTabChange?.(false);
            }}
            role="tab"
            type="button"
          >
            Preview
          </button>
        </div>
      ) : null}
    </section>
  );
}