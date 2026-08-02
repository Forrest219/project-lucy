import { useState } from "react";
import type { CatalogReloadRun, CatalogReloadWarning } from "../../lib/types";

export type CatalogReloadResultPanelProps = {
  /**
   * The latest catalog reload run for the current scope. `null` is
   * rendered as an empty state so callers can mount the panel before
   * any reload has happened without dealing with `null` themselves.
   */
  run: CatalogReloadRun | null;
};

function formatScope(run: CatalogReloadRun): string {
  if (run.requestedConnectionId && run.requestedSchema) {
    return `连接 ${run.requestedConnectionId} · Schema ${run.requestedSchema}`;
  }
  if (run.requestedConnectionId) {
    return `连接 ${run.requestedConnectionId}`;
  }
  if (run.requestedSchema) {
    return `Schema ${run.requestedSchema}（全局）`;
  }
  return "全局";
}

const SCHEMA_MANIFEST_MISSING_LABEL = "缺失 Manifest";
const SCHEMA_MANIFEST_EMPTY_LABEL = "空 Manifest";
const MANIFEST_PARSE_FAILED_LABEL = "Manifest 解析失败";
const ENABLED_TABLE_NOT_SCANNED_LABEL = "白名单表未发现";

function warningLabel(warning: CatalogReloadWarning): string {
  if (warning.code === "SCHEMA_MANIFEST_MISSING") return SCHEMA_MANIFEST_MISSING_LABEL;
  if (warning.code === "SCHEMA_MANIFEST_EMPTY") return SCHEMA_MANIFEST_EMPTY_LABEL;
  if (warning.code === "MANIFEST_PARSE_FAILED") return MANIFEST_PARSE_FAILED_LABEL;
  if (warning.code === "ENABLED_TABLE_NOT_SCANNED") return ENABLED_TABLE_NOT_SCANNED_LABEL;
  return warning.code;
}

function warningContext(warning: CatalogReloadWarning): string | null {
  if (warning.schema && warning.table) {
    return `${warning.schema} · ${warning.table}`;
  }
  if (warning.schema) return warning.schema;
  if (warning.table) return warning.table;
  return null;
}

export function CatalogReloadResultPanel({ run }: CatalogReloadResultPanelProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (run === null) {
    return (
      <div
        className="pl-catalog-reload-result notranslate"
        data-testid="catalog-reload-result-empty"
        data-state="empty"
        translate="no"
      >
        尚未运行本地 Catalog 重新加载。
      </div>
    );
  }

  const hasWarnings = run.warnings.length > 0;
  return (
    <div
      className="pl-catalog-reload-result"
      data-testid="catalog-reload-result"
      data-state={hasWarnings ? "warnings" : "clean"}
    >
      <p
        className="text-sm font-medium notranslate"
        data-testid="catalog-reload-result-success"
        translate="no"
      >
        本地 Catalog 已重新加载
        {hasWarnings ? ` · ${run.warnings.length} 个提示` : ""}
      </p>

      {hasWarnings ? (
        <ul
          className="pl-catalog-reload-warnings notranslate"
          data-testid="catalog-reload-warnings"
          aria-label="Catalog reload warnings"
          translate="no"
        >
          {run.warnings.map((warning, idx) => {
            const context = warningContext(warning);
            return (
              <li key={`${warning.code}-${idx}`} data-code={warning.code}>
                <strong>
                  {warningLabel(warning)}
                  {context ? ` · ${context}` : ""}
                </strong>
                <span className="block text-fg-muted">{warning.message}</span>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div
        className="pl-catalog-reload-details"
        data-testid="catalog-reload-result-details"
      >
        <button
          type="button"
          className="pl-btn pl-btn--ghost pl-btn--sm"
          aria-expanded={detailsOpen}
          aria-controls="catalog-reload-result-details-panel"
          onClick={() => setDetailsOpen((v) => !v)}
        >
          {detailsOpen ? "收起详情" : "详情"}
        </button>
        {detailsOpen ? (
          <ul
            id="catalog-reload-result-details-panel"
            className="pl-catalog-reload-details-list"
            data-testid="catalog-reload-result-details-list"
          >
            <li>
              <span>范围</span>
              <strong>{formatScope(run)}</strong>
            </li>
            <li>
              <span>表</span>
              <strong>{run.tables} 张表</strong>
            </li>
            <li>
              <span>已启用</span>
              <strong>{run.enabledTables}</strong>
            </li>
            <li>
              <span className="notranslate" translate="no">Schema</span>
              <strong className="notranslate" translate="no">
                {run.manifestSchemas} / {run.configuredSchemas} Schema
              </strong>
            </li>
            <li>
              <span>耗时</span>
              <strong>{run.durationMs} ms</strong>
            </li>
          </ul>
        ) : null}
      </div>
    </div>
  );
}
