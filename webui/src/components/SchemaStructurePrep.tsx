import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { queryKeys } from "../lib/queryKeys";
import {
  countReadyTables,
  fetchExistingSchemaManifest,
  fetchSchemaStructure,
  manifestKnown,
  manifestTableNames,
  mergeManifestTables,
  newTablesFromGenerated,
  readCheckedTableColumns,
  reloadPreparedCatalog,
  writeMinimalManifest,
  type SchemaStructurePreview
} from "../lib/prepareSchemaStructure";
import { canReadDatabaseStructure } from "../lib/setupAssistant";
import type { CatalogAssetUploadResponse, ConnectionInfo, SourcesResponse } from "../lib/types";
import { CatalogAssetUploadButton } from "./catalog";
import { sourcesQueryOptions } from "../lib/displayQueryOptions";

type PrimaryAction = "read" | "use" | "upload" | "retry" | "continue";

export type SchemaStructurePrepProps = {
  connection: ConnectionInfo;
  schema: string;
  showAddedStatus: boolean;
  exitLabel: "完成" | "关闭";
  idPrefix: string;
  /** Opened from an existing Manifest to refresh structure from the database. */
  refreshExisting?: boolean;
  onExit: () => void;
  onPrepared: () => void;
};

export function SchemaStructurePrep({
  connection,
  schema,
  showAddedStatus,
  exitLabel,
  idPrefix,
  refreshExisting = false,
  onExit,
  onPrepared
}: SchemaStructurePrepProps) {
  const queryClient = useQueryClient();
  const sourcesQuery = useQuery({
    ...sourcesQueryOptions()
  });
  const [preview, setPreview] = useState<SchemaStructurePreview | null>(null);
  const [preferExisting, setPreferExisting] = useState(false);
  const [pendingYaml, setPendingYaml] = useState<string | null>(null);
  const [refreshPlan, setRefreshPlan] = useState<{
    existingYaml: string;
    generatedYaml: string;
    existingCount: number;
    newTables: string[];
    selected: string[];
  } | null>(null);
  const [reloadPending, setReloadPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readable = canReadDatabaseStructure(connection);
  const known =
    !refreshExisting && (manifestKnown(sourcesQuery.data, connection.id, schema) || preferExisting);
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
    refreshExisting
      ? null
      : primary === "upload" || primary === "continue"
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

  async function commitYaml(yaml: string, confirmOverwrite = false) {
    const result = await writeMinimalManifest(connection.id, schema, yaml, { confirmOverwrite });
    invalidateCatalog();
    if (result.status === "invalid") {
      setError(result.message);
      return;
    }
    if (result.status === "exists") {
      setPendingYaml(yaml);
      setPreview(null);
      setReloadPending(false);
      setError(null);
      return;
    }
    setPendingYaml(null);
    setPreview(null);
    await settleAfterReload(result.reloadStatus);
  }

  async function readStructure() {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const data = await fetchSchemaStructure(connection.id, schema);
      const names = manifestTableNames(data.yaml);
      if (names.length === 0) {
        setError("这个 Schema 没有可读取的表。");
        return;
      }
      const existingYaml = refreshExisting
        ? await fetchExistingSchemaManifest(connection.id, schema)
        : "tables: {}\n";
      const candidates = refreshExisting ? newTablesFromGenerated(existingYaml, data.yaml) : names;
      if (candidates.length === 0) {
        setError("数据库里没有尚未写入 Manifest 的表。现有 YAML 已保留。");
        return;
      }
      setRefreshPlan({
        existingYaml,
        generatedYaml: data.yaml,
        existingCount: refreshExisting ? manifestTableNames(existingYaml).length : 0,
        newTables: candidates,
        selected: candidates
      });
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取失败");
    } finally {
      setBusy(false);
    }
  }

  function toggleRefreshTable(name: string, checked: boolean) {
    setRefreshPlan((current) => {
      if (!current) return current;
      const selected = checked
        ? current.selected.includes(name)
          ? current.selected
          : [...current.selected, name]
        : current.selected.filter((item) => item !== name);
      return { ...current, selected };
    });
  }

  async function commitRefreshPlan() {
    if (!refreshPlan || refreshPlan.selected.length === 0) return;
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const data = await readCheckedTableColumns(
        connection.id,
        schema,
        refreshPlan.selected,
        (_done, total, table) => {
          const index = refreshPlan.selected.indexOf(table);
          setProgress(`正在读取字段 ${index + 1}/${total}：${table}`);
        }
      );
      const yaml = mergeManifestTables(refreshPlan.existingYaml, data.yaml, refreshPlan.selected);
      const overwrite = refreshPlan.existingCount > 0;
      setRefreshPlan(null);
      setProgress(null);
      if (data.downgraded.length > 0) {
        setPreview({ ...data, yaml });
        return;
      }
      await commitYaml(yaml, overwrite);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取失败");
    } finally {
      setBusy(false);
      setProgress(null);
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
    refreshPlan
      ? `读取选中的 ${refreshPlan.selected.length} 张表字段`
      : pendingYaml
        ? "确认覆盖并继续"
        : primary === "retry"
          ? "重新同步并继续"
          : primary === "use"
            ? "使用已有 Schema Manifest"
            : primary === "upload"
              ? "上传 Schema Manifest"
              : primary === "continue"
                ? "继续生成"
                : "从数据库读取表结构";

  const primaryTestId =
    refreshPlan
      ? `${idPrefix}-add-tables`
      : pendingYaml
        ? `${idPrefix}-confirm-overwrite`
        : primary === "retry"
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
      {refreshExisting && !refreshPlan ? (
        <p className="text-xs text-fg-muted" data-testid={`${idPrefix}-refresh-hint`}>
          保留现有 YAML 中已有的表，只从数据库补选尚未写入的表。不会自动启用；完成后到启用表范围勾选。
        </p>
      ) : null}
      {refreshPlan ? (
        <div className="grid gap-2 text-xs" data-testid={`${idPrefix}-table-picker`}>
          <p className="notranslate" translate="no">
            {refreshPlan.existingCount > 0
              ? `现有 Manifest 中的 ${refreshPlan.existingCount} 张表会原样保留。数据库里还有 ${refreshPlan.newTables.length} 张未写入的表，请勾选要读取字段并加入的表。`
              : `读到 ${refreshPlan.newTables.length} 张表。请勾选要读取字段的表，然后写入 Schema Manifest。`}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="pl-btn pl-btn--ghost text-xs"
              onClick={() =>
                setRefreshPlan((current) =>
                  current ? { ...current, selected: current.newTables } : current
                )
              }
            >
              全选
            </button>
            <button
              type="button"
              className="pl-btn pl-btn--ghost text-xs"
              onClick={() =>
                setRefreshPlan((current) => (current ? { ...current, selected: [] } : current))
              }
            >
              清除
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto grid gap-1 sm:grid-cols-2">
            {refreshPlan.newTables.map((name) => (
              <label key={name} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={refreshPlan.selected.includes(name)}
                  onChange={(event) => toggleRefreshTable(name, event.target.checked)}
                  data-testid={`${idPrefix}-add-table-${name}`}
                />
                <span className="notranslate" translate="no">
                  {name}
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
      {pendingYaml ? (
        <p className="text-xs notranslate" role="status" data-testid={`${idPrefix}-overwrite-hint`} translate="no">
          该 Schema 已有 Manifest。确认后会用数据库当前表结构覆盖现有文件，已手写的字段说明可能被替换。
        </p>
      ) : null}
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
        <p
          role="alert"
          data-testid={`${idPrefix}-structure-error`}
          className="whitespace-pre-wrap break-words text-sm"
        >
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
            disabled={busy || Boolean(refreshPlan && refreshPlan.selected.length === 0)}
            aria-busy={busy}
            onClick={() => {
              if (refreshPlan) {
                void commitRefreshPlan();
                return;
              }
              if (pendingYaml) {
                void (async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await commitYaml(pendingYaml, true);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "读取失败");
                  } finally {
                    setBusy(false);
                  }
                })();
                return;
              }
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
            {progress ?? (busy && (primary === "read" || primary === "continue" || refreshPlan) ? "正在读取表结构..." : primaryLabel)}
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
  refreshExisting = false,
  onClose
}: {
  connection: ConnectionInfo;
  schema: string;
  open: boolean;
  refreshExisting?: boolean;
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
          refreshExisting={refreshExisting}
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
