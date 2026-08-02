import * as Dialog from "@radix-ui/react-dialog";
import { WIKI_TEMPLATES, type WikiTemplate } from "../lib/wiki";

export type TemplatePickerProps = {
  open: boolean;
  onClose: () => void;
  onPick: (template: WikiTemplate) => void;
};

/**
 * Modal that lets the user choose a Markdown seed template when they
 * create an empty Wiki page. Replaces the inline empty-state list so
 * the new-doc flow has a clear, single entry point. Templates seed
 * `[请输入...]` placeholders that the user is expected to replace
 * before saving.
 */
export function TemplatePicker({ open, onClose, onPick }: TemplatePickerProps) {
  return (
    <Dialog.Root onOpenChange={(next) => (!next ? onClose() : null)} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="pl-wiki-template-overlay" />
        <Dialog.Content
          aria-describedby="wiki-template-picker-description"
          className="pl-wiki-template-content"
          data-testid="wiki-template-picker"
        >
          <Dialog.Title className="pl-wiki-template-title">模板选择</Dialog.Title>
          <Dialog.Description
            className="pl-wiki-template-description"
            id="wiki-template-picker-description"
          >
            选一个 Markdown 骨架开始撰写；模板会预填高亮占位符，请补全后再保存预检。
          </Dialog.Description>
          <ul className="pl-wiki-template-list" data-testid="wiki-template-list">
            {WIKI_TEMPLATES.map((template) => (
              <li
                className="pl-wiki-template-item"
                key={template.label}
              >
                <button
                  className="pl-wiki-template-button"
                  data-template-label={template.label}
                  data-testid={`wiki-template-option-${template.label}`}
                  onClick={() => onPick(template)}
                  type="button"
                >
                  <strong
                    className="pl-wiki-template-label notranslate"
                    translate="no"
                  >
                    {template.label}
                  </strong>
                  <span className="pl-wiki-template-desc">{template.description}</span>
                  <span className="pl-wiki-template-placeholder-hint">
                    包含 {template.placeholders.length} 个待补全占位符
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <footer className="pl-wiki-template-actions">
            <button
              className="pl-btn pl-btn--ghost"
              data-testid="wiki-template-cancel"
              onClick={onClose}
              type="button"
            >
              取消
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}