import { useState } from "react";
import type { CatalogAssetUploadResponse } from "../../lib/types";
import { CatalogAssetUploadDrawer } from "./CatalogAssetUploadDrawer";

export type CatalogAssetUploadButtonProps = {
  connectionId: string;
  schema?: string;
  schemaOptions?: string[];
  label?: string;
  variant?: "primary" | "secondary" | "ghost" | "link";
  size?: "default" | "sm";
  testId?: string;
  onOpen?: () => void;
  onUploaded?: (result: CatalogAssetUploadResponse) => void;
};

function defaultLabel(schema?: string): string {
  if (schema) return "上传 Manifest";
  return "上传 Schema Manifest";
}

function buttonClass(
  variant: NonNullable<CatalogAssetUploadButtonProps["variant"]>,
  size: NonNullable<CatalogAssetUploadButtonProps["size"]>
): string {
  if (variant === "link") return "pl-row-action-link";
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

export function CatalogAssetUploadButton(props: CatalogAssetUploadButtonProps) {
  const {
    connectionId,
    schema,
    schemaOptions,
    label,
    variant = "secondary",
    size = "default",
    testId,
    onOpen,
    onUploaded
  } = props;
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={`${buttonClass(variant, size)} notranslate`}
        onClick={() => {
          onOpen?.();
          setOpen(true);
        }}
        data-testid={testId ?? "catalog-asset-upload-button"}
        data-connection={connectionId}
        data-schema={schema ?? undefined}
        translate="no"
      >
        {label ?? defaultLabel(schema)}
      </button>
      {open ? (
        <CatalogAssetUploadDrawer
          open={open}
          onClose={() => setOpen(false)}
          connectionId={connectionId}
          {...(schema !== undefined ? { schema } : {})}
          {...(schemaOptions ? { schemaOptions } : {})}
          {...(onUploaded ? { onUploaded } : {})}
        />
      ) : null}
    </>
  );
}
