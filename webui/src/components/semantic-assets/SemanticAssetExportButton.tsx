import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { exportSemanticAssetPackage } from "../../lib/semantic-assets";
import { ApiError } from "../../lib/apiClient";
import type { SemanticAssetExportResponse } from "../../lib/types";

export type SemanticAssetExportButtonProps = {
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  testId?: string;
  scope?: { connectionId?: string; schema?: string };
  includeWiki?: boolean;
  includeEvals?: boolean;
};

function buttonClass(
  variant: NonNullable<SemanticAssetExportButtonProps["variant"]>
): string {
  if (variant === "primary") return "pl-btn pl-btn--primary";
  if (variant === "secondary") return "pl-btn pl-btn--secondary";
  return "pl-btn pl-btn--ghost";
}

export function SemanticAssetExportButton(props: SemanticAssetExportButtonProps) {
  const {
    label = "下载当前全量资产包 (.zip)",
    variant = "secondary",
    testId = "semantic-asset-export-button",
    scope,
    includeWiki = false,
    includeEvals = false
  } = props;
  const [result, setResult] = useState<SemanticAssetExportResponse | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      exportSemanticAssetPackage({
        ...(scope ? { scope } : {}),
        includeWiki,
        includeEvals,
        includeSanitizedKtxYaml: true
      })
  });

  function handleClick() {
    setResult(null);
    mutation.mutate(undefined, {
      onSuccess: (data) => {
        setResult(data);
      },
      onError: (err) => {
        const apiError = err instanceof ApiError ? err : null;
        toast.error(
          `导出失败：${apiError?.message ?? (err instanceof Error ? err.message : "未知错误")}`
        );
      }
    });
  }

  const includedCount = result?.includedFiles.length ?? 0;
  const excludedCount = result?.excludedFiles.length ?? 0;
  const excludedByCategory = (result?.excludedFiles ?? []).reduce<Record<string, number>>(
    (acc, item) => {
      const key = item.reason;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {}
  );

  return (
    <div className="grid gap-2">
      <button
        type="button"
        className={buttonClass(variant)}
        onClick={handleClick}
        disabled={mutation.isPending}
        data-testid={testId}
        data-export-state={mutation.isPending ? "pending" : result ? "ready" : "idle"}
      >
        {mutation.isPending ? "正在打包…" : label}
      </button>
      {result ? (
        <section
          className="grid gap-2 rounded-md border border-border-default bg-bg-subtle p-3 text-xs"
          data-testid="semantic-asset-export-summary"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>{result.filename}</strong>
            <a
              className="pl-btn pl-btn--primary pl-btn--sm"
              href={result.downloadUrl}
              data-testid="semantic-asset-export-download"
            >
              下载 ({result.sizeBytes} 字节)
            </a>
          </div>
          <p className="text-fg-muted">
            包含 {includedCount} 个文件，排除 {excludedCount} 个。{" "}
            <strong className="text-success-strong">Secrets 已强制排除</strong>，
            <code className="notranslate" translate="no">ktx.yaml</code> 已脱敏为 <code className="notranslate" translate="no">&lt;REDACTED&gt;</code>。
          </p>
          {Object.keys(excludedByCategory).length > 0 ? (
            <ul
              className="list-none p-0 text-fg-muted"
              data-testid="semantic-asset-export-excluded"
            >
              {Object.entries(excludedByCategory).map(([reason, count]) => (
                <li key={reason}>
                  <code>{reason}</code>: {count} 个
                </li>
              ))}
            </ul>
          ) : null}
          <details>
            <summary className="cursor-pointer text-fg-default">查看 included 文件</summary>
            <ul className="list-none p-0 text-fg-muted">
              {result.includedFiles.map((f) => (
                <li key={f}>
                  <code className="font-mono">{f}</code>
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}
    </div>
  );
}
