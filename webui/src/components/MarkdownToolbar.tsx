import { useCallback } from "react";

export type MarkdownToolbarAction =
  | "bold"
  | "italic"
  | "code"
  | "codeblock"
  | "heading"
  | "table"
  | "link";

export type MarkdownToolbarProps = {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onChange: (next: string) => void;
  /**
   * Hide the math button when the renderer cannot handle it. Today
   * MarkdownPreview does not render LaTeX, so this defaults to false.
   */
  showMath?: boolean;
};

type ToolbarButton = {
  action: MarkdownToolbarAction;
  label: string;
  ariaLabel: string;
  hint: string;
};

const BUTTONS: ToolbarButton[] = [
  { action: "bold", label: "B", ariaLabel: "加粗", hint: "加粗所选文本" },
  { action: "italic", label: "I", ariaLabel: "斜体", hint: "斜体所选文本" },
  { action: "code", label: "</>", ariaLabel: "行内代码", hint: "插入行内代码" },
  { action: "codeblock", label: "{ }", ariaLabel: "代码块", hint: "插入代码块" },
  { action: "heading", label: "H", ariaLabel: "标题", hint: "插入二级标题" },
  { action: "table", label: "▦", ariaLabel: "表格", hint: "插入 Markdown 表格骨架" },
  { action: "link", label: "🔗", ariaLabel: "链接", hint: "插入 Markdown 链接" }
];

const MATH_BUTTON: ToolbarButton = {
  action: "math" as MarkdownToolbarAction,
  label: "∑",
  ariaLabel: "公式",
  hint: "插入数学公式"
};

/**
 * Insertion logic for the lightweight Markdown toolbar. The toolbar
 * always uses `selectionStart` / `selectionEnd` so empty selections,
 * partial selections and multi-line selections all behave the same
 * way. After insertion the textarea keeps focus and the new selection
 * covers the inserted text where possible.
 */
function applyInsertion(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
  placeholder: string
): string {
  const { selectionStart, selectionEnd, value } = textarea;
  const start = selectionStart ?? value.length;
  const end = selectionEnd ?? value.length;
  const selected = value.slice(start, end);
  const replacement = selected || placeholder;
  const nextValue = `${value.slice(0, start)}${before}${replacement}${after}${value.slice(end)}`;
  const cursorStart = start + before.length;
  const cursorEnd = cursorStart + replacement.length;
  // Restore focus + selection on the next paint so React state has
  // already committed to the new value.
  window.requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(cursorStart, cursorEnd);
  });
  return nextValue;
}

function insertAction(
  textarea: HTMLTextAreaElement,
  action: MarkdownToolbarAction
): string {
  switch (action) {
    case "bold":
      return applyInsertion(textarea, "**", "**", "加粗文本");
    case "italic":
      return applyInsertion(textarea, "*", "*", "斜体文本");
    case "code":
      return applyInsertion(textarea, "`", "`", "code");
    case "codeblock":
      return applyInsertion(
        textarea,
        "\n```sql\n",
        "\n```\n",
        "SELECT 1;"
      );
    case "heading": {
      // Promote the current line to `## ` if it does not already start
      // with one. Always insert at the very beginning of the line so
      // the user can keep typing.
      const { selectionStart, value } = textarea;
      const start = selectionStart ?? value.length;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const linePrefix = value.slice(lineStart, start);
      const alreadyHeading = /^#{1,6}\s/.test(linePrefix);
      if (alreadyHeading) {
        return value;
      }
      const nextValue = `${value.slice(0, lineStart)}## ${value.slice(lineStart)}`;
      window.requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(lineStart + 3, lineStart + 3);
      });
      return nextValue;
    }
    case "table": {
      const skeleton = [
        "",
        "| 列 1 | 列 2 |",
        "|---|---|",
        "| [请输入] | [请输入] |",
        ""
      ].join("\n");
      return applyInsertion(textarea, "\n", skeleton, "");
    }
    case "link":
      return applyInsertion(textarea, "[", "](https://)", "链接文本");
    case "math":
      return applyInsertion(textarea, "$", "$", "公式");
    default:
      return textarea.value;
  }
}

export function MarkdownToolbar({
  textareaRef,
  onChange,
  showMath = false
}: MarkdownToolbarProps) {
  const handleClick = useCallback(
    (action: MarkdownToolbarAction) => () => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const nextValue = insertAction(textarea, action);
      if (nextValue !== textarea.value) {
        onChange(nextValue);
      }
    },
    [onChange, textareaRef]
  );

  const buttons = showMath ? [...BUTTONS, MATH_BUTTON] : BUTTONS;

  return (
    <div
      aria-label="Markdown 工具栏"
      className="pl-wiki-markdown-toolbar"
      data-testid="wiki-markdown-toolbar"
      role="toolbar"
    >
      {buttons.map((button) => (
        <button
          aria-label={button.ariaLabel}
          className="pl-btn pl-btn--ghost pl-wiki-markdown-toolbar-button"
          data-testid={`wiki-toolbar-${button.action}`}
          key={button.action}
          onClick={handleClick(button.action)}
          title={button.hint}
          type="button"
        >
          <span aria-hidden className="notranslate" translate="no">
            {button.label}
          </span>
        </button>
      ))}
    </div>
  );
}