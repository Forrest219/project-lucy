import * as Dialog from "@radix-ui/react-dialog";
import { FrontmatterForm } from "./FrontmatterForm";
import type { WikiFrontmatter } from "../lib/types";

export type FrontmatterDrawerProps = {
  open: boolean;
  onClose: () => void;
  frontmatter: WikiFrontmatter;
  onChange: (next: WikiFrontmatter) => void;
};

/**
 * Drawer surface for the Wiki frontmatter form. Lives in the editor
 * header instead of directly above the Markdown textarea so the
 * document body can stay focused on writing. Reuses the existing
 * FrontmatterForm so the validation, sl_ref picker and tag input are
 * unchanged.
 */
export function FrontmatterDrawer({
  open,
  onClose,
  frontmatter,
  onChange
}: FrontmatterDrawerProps) {
  return (
    <Dialog.Root onOpenChange={(next) => (!next ? onClose() : null)} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="pl-wiki-meta-overlay" />
        <Dialog.Content
          aria-describedby="wiki-meta-drawer-description"
          className="pl-wiki-meta-content"
          data-testid="wiki-meta-drawer"
        >
          <header className="pl-wiki-meta-header">
            <Dialog.Title className="pl-wiki-meta-title">文档信息</Dialog.Title>
            <Dialog.Description
              className="pl-wiki-meta-description"
              id="wiki-meta-drawer-description"
            >
              关联语义对象、标签与摘要会驱动 Wiki ↔ 表编辑器的双向跳转。
            </Dialog.Description>
            <button
              aria-label="关闭文档信息"
              className="pl-btn pl-btn--ghost pl-wiki-meta-close"
              data-testid="wiki-meta-close"
              onClick={onClose}
              type="button"
            >
              关闭
            </button>
          </header>
          <FrontmatterForm onChange={onChange} value={frontmatter} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}