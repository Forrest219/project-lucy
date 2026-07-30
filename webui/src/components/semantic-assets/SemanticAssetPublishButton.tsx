import { useState } from "react";
import { SemanticAssetPublishDrawer } from "./SemanticAssetPublishDrawer";

export type SemanticAssetPublishButtonProps = {
  connectionId?: string;
  schema?: string;
  schemaOptions?: string[];
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  testId?: string;
};

function buttonClass(
  variant: NonNullable<SemanticAssetPublishButtonProps["variant"]>
): string {
  if (variant === "primary") return "pl-btn pl-btn--primary";
  if (variant === "secondary") return "pl-btn pl-btn--secondary";
  return "pl-btn pl-btn--ghost";
}

export function SemanticAssetPublishButton(props: SemanticAssetPublishButtonProps) {
  const {
    connectionId,
    schema,
    schemaOptions,
    label = "上传语义包",
    variant = "secondary",
    testId = "semantic-asset-publish-button"
  } = props;
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={buttonClass(variant)}
        onClick={() => setOpen(true)}
        data-testid={testId}
        data-connection={connectionId}
        data-schema={schema}
      >
        {label}
      </button>
      {open ? (
        <SemanticAssetPublishDrawer
          open={open}
          onClose={() => setOpen(false)}
          {...(connectionId ? { defaultConnectionId: connectionId } : {})}
          {...(schema ? { defaultSchema: schema } : {})}
        />
      ) : null}
    </>
  );
}
