import { useState } from "react";
import { useCatalogReload } from "../../lib/catalogReload";
import type { CatalogReloadRun } from "../../lib/types";
import { CatalogReloadResultPanel } from "./CatalogReloadResultPanel";

export type CatalogReloadButtonProps = {
  connectionId?: string;
  schema?: string;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  testId?: string;
  onReloadComplete?: (run: CatalogReloadRun) => void;
};

function defaultLabel(): string {
  return "刷新本地目录";
}

function buttonClass(
  variant: CatalogReloadButtonProps["variant"],
  size: CatalogReloadButtonProps["size"]
): string {
  const variantClass =
    variant === "primary"
      ? "pl-btn pl-btn--primary"
      : variant === "secondary"
        ? "pl-btn pl-btn--secondary"
        : "pl-btn pl-btn--ghost";
  if (size === "sm") {
    return `${variantClass} pl-btn--sm`;
  }
  return variantClass;
}

export function CatalogReloadButton(props: CatalogReloadButtonProps) {
  const {
    connectionId,
    schema,
    label,
    variant = "primary",
    size = "md",
    testId,
    onReloadComplete
  } = props;
  const reload = useCatalogReload({
    ...(connectionId ? { connectionId } : {}),
    ...(schema ? { schema } : {})
  });
  const [showPanel, setShowPanel] = useState(false);

  const baseLabel = label ?? defaultLabel();
  const buttonText = reload.isPending
    ? "刷新本地目录中..."
    : reload.lastRun
      ? `完成 ✓ · ${reload.lastRun.tables} 张表`
      : baseLabel;

  async function handleClick() {
    setShowPanel(true);
    try {
      const result = await reload.reload();
      if (result) {
        onReloadComplete?.(result);
      }
    } catch {
      // The hook clears lastRun on error; show the panel with whatever we have.
    }
  }

  return (
    <>
      <button
        type="button"
        className={`${buttonClass(variant, size)} notranslate`}
        onClick={handleClick}
        disabled={reload.isPending}
        data-testid={testId ?? "catalog-reload"}
        title="重新读取 ktx.yaml 与 semantic-layer YAML 文件，不会连接数据库，也不会执行 ingest。"
        translate="no"
        data-connection={connectionId ?? undefined}
        data-schema={schema ?? undefined}
      >
        {buttonText}
      </button>
      {showPanel && reload.lastRun && (
        <div
          className="pl-catalog-reload-inline"
          data-testid="catalog-reload-inline"
          data-state={reload.lastRun.status}
        >
          <CatalogReloadResultPanel run={reload.lastRun} />
        </div>
      )}
      {showPanel && reload.error && (
        <div
          className="pl-catalog-reload-error notranslate"
          role="alert"
          data-testid="catalog-reload-error"
          translate="no"
        >
          本地 Catalog 重新加载失败：{reload.error.message}
        </div>
      )}
    </>
  );
}
