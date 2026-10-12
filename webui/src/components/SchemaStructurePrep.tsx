import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import {
  countReadyTables,
  fetchSchemaStructure,
  manifestKnown,
  reloadPreparedCatalog,
  writeMinimalManifest,
  type SchemaStructurePreview
} from "../lib/prepareSchemaStructure";
import { canReadDatabaseStructure } from "../lib/setupAssistant";
import type { CatalogAssetUploadResponse, ConnectionInfo, SourcesResponse } from "../lib/types";
import { CatalogAssetUploadButton } from "./catalog";

type PrimaryAction = "read" | "use" | "upload" | "retry" | "continue";

export type SchemaStructurePrepProps = {
  connection: ConnectionInfo;
  schema: string;
  showAddedStatus: boolean;
  exitLabel: "完成" | "关闭";
  idPrefix: string;
  onExit: () => void;
  onPrepared: () => void;
};

export function SchemaStructurePrep({
  connection,
  schema,
  showAddedStatus,
  exitLabel,
  idPrefix,
  onExit,
  onPrepared
}: SchemaStructurePrepProps) {
  const queryClient = useQueryClient();
  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources,
    queryFn: () => apiGet<SourcesResponse>("/api/sources")
  });
  const [preview, setPreview] = useState<SchemaStructurePreview | null>(null);
  const [preferExisting, setPreferExisting] = useState(false);
  const [reloadPending, setReloadPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readable = canReadDatabaseStructure(connection);
  const known = manifestKnown(sourcesQuery.data, connection.id, schema) || preferExisting;
  const primary: PrimaryAction = preview
    ? "continue"
    : reloadPending
      ? "retry"
      : known
        ? "use"
        : readable
          ? "read"
          : "upload";

  const secondaryLabel =
    primary === "upload" || primary === "continue"
      ? primary === "continue"
        ? "我已有 Schema Manifest"
        : null
      : known || reloadPending
        ? "替换已有 Schema Manifest"
        : "我已有 Schema Manifest";

  async function refreshSources(): Promise<number> {
    await queryClient.invalidateQueries({ queryKey: queryKeys.sources });
    await queryClient.refetchQueries({ queryKey: queryKeys.sources });
    const sources = queryClient.getQueryData<SourcesResponse>(queryKeys.sources);
    return countReadyTables(sources, connection.id, schema);
  }

  function invalidateCatalog() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.catalogReloads });
    void queryClient.invalidateQueries({ queryKey: queryKeys.catalogAssetUploads });
    void queryClient.invalidateQueries({ queryKey: queryKeys.project });
    void queryClient.invalidateQueries({ queryKey: queryKeys.connections });
    void queryClient.invalidateQueries({ queryKey: queryKeys.connectionTables(connection.id) });
  }

  async function settleAfterReload(reloadStatus: string | undefined) {
    const tables = await refreshSources();
    if (reloadStatus !== "success" || tables === 0) {
      setReloadPending(true);
      setPreview(null);
      setError("本地目录尚未读到表。");
      return;
    }
    setReloadPending(false);
    setError(null);
    onPrepared();
  }

  async function commitYaml(yaml: string) {
    const result = await writeMinimalManifest(connection.id, schema, yaml);
    invalidateCatalog();
    if (result.status === "invalid") {
      setError(result.message);
      return;
    }
    if (result.status === "exists") {
      setPreferExisting(true);
      setPreview(null);
      setReloadPending(false);
      setError(null);
      return;
    }
    setPreview(null);
    await settleAfterReload(result.reloadStatus);
  }

  async function readStructure() {
    setBusy(true);
    setError(null);
    try {
      const data = await fetchSchemaStructure(connection.id, schema);
      if (data.tableCount === 0) {
        setError("这个 Schema 没有可读取的表。");
        return;
      }
      if (data.downgraded.length > 0) {
        setPreview(data);
        return;
      }
      await commitYaml(data.yaml);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取失败");
    } finally {
      setBusy(false);
    }
  }

  async function useExisting() {
    setBusy(true);
    setError(null);
    try {
      const run = await reloadPreparedCatalog(connection.id, schema);
      await settleAfterReload(run.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleUploaded(result: CatalogAssetUploadResponse) {
    setBusy(true);
    try {
      await settleAfterReload(result.reload?.status);
    } finally {
      setBusy(false);
    }
  }

  const primaryLabel =
    primary === "retry"
      ? "重新同步并继续"
      : primary === "use"
        ? "使用已有 Schema Manifest"
        : primary === "upload"
          ? "上传 Schema Manifest"
          : primary === "continue"
            ? "继续生成"
            : "从数据库读取表结构";

  const primaryTestId =
    primary === "retry"
      ? `${idPrefix}-retry-reload`
      : primary === "use"
        ? `${idPrefix}-use-existing`
        : primary === "continue"
          ? `${idPrefix}-downgrade-confirm`
          : primary === "read"
            ? `${idPrefix}-read-structure`
            : `${idPrefix}-upload-yaml`;

  const secondaryTestId =
    secondaryLabel === "替换已有 Schema Manifest"
      ? `${idPrefix}-replace-manifest`
      : `${idPrefix}-have-manifest`;

  return (
    <section className="pl-drawer-body" aria-label={showAddedStatus ? "完成" : "准备表结构"}>
      {showAddedStatus ? (
        <p
          className="text-sm font-semibold text-green-700 notranslate"
          translate="no"
          data-testid="add-schema-success-message"
        >
          ✓ 已添加 Schema：{schema}
        </p>
      ) : (
        <p className="text-xs text-fg-muted">
          目标连接：
          <code className="notranslate" translate="no">{connection.id}</code>
          <span className="mx-2">·</span>
          目标 <span className="notranslate" translate="no">Schema</span>：
          <code className="notranslate" translate="no">{schema}</code>
        </p>
      )}
      {preview ? (
        <div
          className="rounded border border-warning/40 bg-warning/10 p-3 text-xs space-y-2"
          data-testid={`${idPrefix}-downgrade-preview`}
        >
          <p>
            读取到 {preview.tableCount} 张表、{preview.columnCount} 个字段。映射为 number{" "}
            {preview.mapped.number}、string {preview.mapped.string}、time {preview.mapped.time}。
            {preview.downgraded.length} 个字段无法识别，已降级为 string。
          </p>
          <ul className="max-h-32 overflow-y-auto space-y-1">
            {preview.downgraded.map((item) => (
              <li key={`${item.table}.${item.column}`} className="notranslate" translate="no">
                {item.table}.{item.column} · {item.rawType}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? (
        <p role="alert" data-testid={`${idPrefix}-structure-error`}>
          {error}
        </p>
      ) : null}
      <div className="pl-drawer-footer">
        <button
          type="button"
          className="pl-btn pl-btn--ghost"
          onClick={onExit}
          data-testid={`${idPrefix}-done`}
        >
          {exitLabel}
        </button>
        {secondaryLabel ? (
          <CatalogAssetUploadButton
            connectionId={connection.id}
            schema={schema}
            label={secondaryLabel}
            variant="secondary"
            testId={secondaryTestId}
            onUploaded={(result) => void handleUploaded(result)}
          />
        ) : null}
        {primary === "upload" ? (
          <CatalogAssetUploadButton
            connectionId={connection.id}
            schema={schema}
            label="上传 Schema Manifest"
            variant="primary"
            testId={primaryTestId}
            onUploaded={(result) => void handleUploaded(result)}
          />
        ) : (
          <button
            type="button"
            className="pl-btn pl-btn--primary notranslate"
            translate="no"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              if (primary === "read") void readStructure();
              else if (primary === "continue" && preview) void (async () => {
                setBusy(true);
                setError(null);
                try {
                  await commitYaml(preview.yaml);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "读取失败");
                } finally {
                  setBusy(false);
                }
              })();
              else if (primary === "use" || primary === "retry") void useExisting();
            }}
            data-testid={primaryTestId}
          >
            {busy && (primary === "read" || primary === "continue") ? "正在读取表结构..." : primaryLabel}
          </button>
        )}
      </div>
    </section>
  );
}

export function PrepareSchemaStructureDrawer({
  connection,
  schema,
  open,
  onClose
}: {
  connection: ConnectionInfo;
  schema: string;
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  if (!open) return null;
  return (
    <div
      className="pl-drawer-backdrop notranslate"
      role="dialog"
      aria-modal="true"
      aria-label="准备表结构"
      translate="no"
      data-testid="prepare-structure-drawer"
    >
      <div className="pl-drawer-panel">
        <header className="pl-drawer-header">
          <div>
            <h2 className="pl-panel-title notranslate" translate="no">准备表结构</h2>
          </div>
          <button
            type="button"
            className="pl-btn pl-btn--ghost pl-drawer-close"
            onClick={onClose}
            aria-label="关闭"
          >
            关闭
          </button>
        </header>
        <SchemaStructurePrep
          connection={connection}
          schema={schema}
          showAddedStatus={false}
          exitLabel="关闭"
          idPrefix="prepare-structure"
          onExit={onClose}
          onPrepared={() => {
            onClose();
            navigate(
              `/connections/enabled-tables?connection=${encodeURIComponent(connection.id)}&schema=${encodeURIComponent(schema)}`
            );
          }}
        />
      </div>
    </div>
  );
}
