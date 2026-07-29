import { useState } from "react";
import { CatalogAssetUploadDrawer } from "./CatalogAssetUploadDrawer";

export type CatalogAssetUploadButtonProps = {
  connectionId: string;
  schema?: string;
  schemaOptions?: string[];
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "default" | "sm";
  testId?: string;
};

function defaultLabel(schema?: string): string {
  if (schema) return "上传该 Schema 的 YAML";
  return "上传 YAML";
}

function buttonClass(
  variant: NonNullable<CatalogAssetUploadButtonProps["variant"]>,
  size: NonNullable<CatalogAssetUploadButtonProps["size"]>
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

export function CatalogAssetUploadButton(props: CatalogAssetUploadButtonProps) {
  const {
    connectionId,
    schema,
    schemaOptions,
    label,
    variant = "secondary",
    size = "default",
    testId
  } = props;
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={buttonClass(variant, size)}
        onClick={() => setOpen(true)}
        data-testid={testId ?? "catalog-asset-upload-button"}
        data-connection={connectionId}
        data-schema={schema ?? undefined}
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
        />
      ) : null}
    </>
  );
}
