import type { CatalogReloadRun } from "../../lib/types";

export type CatalogReloadResultPanelProps = {
  run: CatalogReloadRun | null;
};

function formatScope(run: CatalogReloadRun): string {
  if (run.requestedConnectionId && run.requestedSchema) {
    return `连接 ${run.requestedConnectionId} · schema ${run.requestedSchema}`;
  }
  if (run.requestedConnectionId) {
    return `连接 ${run.requestedConnectionId}`;
  }
  if (run.requestedSchema) {
    return `schema ${run.requestedSchema}（全局）`;
  }
  return "全局";
}

export function CatalogReloadResultPanel({ run }: CatalogReloadResultPanelProps) {
  if (!run) return null;

  const hasWarnings = run.warnings.length > 0;
  return (
    <div
      className="pl-catalog-reload-result"
      data-testid="catalog-reload-result"
      data-state={hasWarnings ? "warnings" : "clean"}
    >
      <p
        className="text-sm font-medium"
        data-testid="catalog-reload-result-success"
      >
        本地 Catalog 已重新加载 · {run.connections} 个连接 · {run.tables} 张表 ·{" "}
        {run.enabledTables} 已启用 · {run.manifestSchemas} / {run.configuredSchemas} schemas
        {hasWarnings ? ` · ${run.warnings.length} 个提示` : ""}
      </p>
      <p className="text-xs text-fg-muted">
        范围：{formatScope(run)} · 耗时 {run.durationMs} ms
      </p>
      {hasWarnings ? (
        <ul
          className="pl-catalog-reload-warnings"
          data-testid="catalog-reload-warnings"
          aria-label="Catalog reload warnings"
        >
          {run.warnings.map((warning, idx) => (
            <li key={`${warning.code}-${idx}`} data-code={warning.code}>
              <strong>{warning.code}</strong>
              {warning.schema ? ` · ${warning.schema}` : ""}
              {warning.table ? ` · ${warning.table}` : ""}
              <span className="block text-fg-muted">{warning.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
