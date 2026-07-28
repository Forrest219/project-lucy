import { useState } from "react";
import { useIngestRun } from "../../lib/ingest";
import type { IngestRun } from "../../lib/types";
import { IngestDiagnosticsDrawer } from "./IngestDiagnosticsDrawer";

export type IngestActionButtonProps = {
  connectionId: string;
  schema?: string;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  onRunComplete?: (run: IngestRun) => void;
  // Override the default `data-testid` so callers can keep stable anchors in
  // composite layouts (e.g. the whitelist toolbar or empty-schema panel).
  testId?: string;
};

function defaultLabel(connectionId: string, schema?: string): string {
  if (schema) return "重新扫描";
  return `触发 Ingest`;
}

function buttonClass(variant: IngestActionButtonProps["variant"], size: IngestActionButtonProps["size"]): string {
  const variantClass =
    variant === "primary" ? "pl-btn pl-btn--primary" : variant === "secondary" ? "pl-btn pl-btn--secondary" : "pl-btn pl-btn--ghost";
  // Size only changes padding via utilities; keep the contract simple.
  if (size === "sm") {
    return `${variantClass} pl-btn--sm`;
  }
  return variantClass;
}

export function IngestActionButton(props: IngestActionButtonProps) {
  const { connectionId, schema, label, variant = "primary", size = "md", onRunComplete, testId } = props;
  const { lastRun, isPending, run, clearLastRun } = useIngestRun({ connectionId, schema });
  const [drawerOpen, setDrawerOpen] = useState(false);

  const baseLabel = label ?? defaultLabel(connectionId, schema);
  const isConnectionOnly = !schema;
  const buttonText = isPending
    ? isConnectionOnly
      ? "Ingest 中..."
      : "重新扫描中..."
    : lastRun && lastRun.status === "success"
      ? `完成 ✓${
          typeof lastRun.scannedTableCount === "number"
            ? ` · ${lastRun.scannedTableCount} 张表`
            : ""
        }`
      : baseLabel;

  async function handleClick() {
    try {
      const result = await run();
      if (result) {
        onRunComplete?.(result);
        if (result.status === "failed") {
          setDrawerOpen(true);
        }
      }
    } catch {
      // The hook already invalidates and clears lastRun on error. Drawer is
      // only shown for structured failure payloads (HTTP ok:true + status:failed).
    }
  }

  const showUnsupportedNotice =
    Boolean(schema) && lastRun && lastRun.executedScope === "connection";

  return (
    <>
      <button
        type="button"
        className={buttonClass(variant, size)}
        onClick={handleClick}
        disabled={isPending}
        data-testid={
          testId ??
          (schema
            ? `ingest-action-${connectionId}-${schema}`
            : `ingest-action-${connectionId}`)
        }
        aria-label={
          schema
            ? `重新扫描 schema ${schema} (${connectionId})`
            : `触发 Ingest ${connectionId}`
        }
        data-schema={schema ?? undefined}
      >
        {buttonText}
      </button>
      {showUnsupportedNotice && (
        <p
          className="pl-ingest-unsupported-hint"
          role="note"
          data-testid={`ingest-unsupported-${connectionId}-${schema}`}
        >
          当前 KTX 仅支持连接级 ingest，将扫描整个连接 <code>{connectionId}</code>，完成后刷新此 schema 的表清单。
        </p>
      )}
      <IngestDiagnosticsDrawer
        run={lastRun}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          clearLastRun();
        }}
      />
    </>
  );
}
