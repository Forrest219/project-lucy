import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, AlertCircle, FileCode } from "lucide-react";
import { ApiError, apiGet, apiPost } from "../../lib/apiClient";
import { uploadCatalogAsset, validateCatalogAsset } from "../../lib/catalog-assets";
import { queryKeys } from "../../lib/queryKeys";
import {
  canReadDatabaseStructure,
  getAssistantDraft,
  setAssistantDraft
} from "../../lib/setupAssistant";
import type {
  CatalogAssetUploadResponse,
  CatalogAssetValidateRequest,
  CatalogAssetValidateResponse,
  CatalogReloadRun,
  LiveSchemasResponse,
  ProjectInfo,
  SourcesResponse
} from "../../lib/types";
import { CatalogAssetValidationPanel } from "../catalog/CatalogAssetValidationPanel";

export type Step2UploadManifestProps = {
  connectionId: string;
  schema: string;
  onSuccess: (tables: number) => void;
  onExit: () => void;
  onSchemaResolved?: (schema: string) => void;
};

type SchemaStructurePreview = {
  schema: string;
  yaml: string;
  tableCount: number;
  columnCount: number;
  downgraded: Array<{ table: string; column: string; rawType: string; semanticType: "string" }>;
};

type PrimaryAction = "choose" | "read" | "upload" | "use" | "retry";

function buildRequest(
  connectionId: string,
  schema: string,
  filename: string,
  content: string
): CatalogAssetValidateRequest {
  return {
    connectionId,
    schema,
    assetKind: "schema_manifest",
    filename,
    content
  };
}

function requestSignature(input: CatalogAssetValidateRequest): string {
  return `${input.connectionId}|${input.schema}|${input.filename}|${input.content}`;
}

function validationFromError(err: unknown): CatalogAssetValidateResponse | null {
  if (!(err instanceof ApiError)) return null;
  const maybeValidation = (err.data as { validation?: unknown } | undefined)?.validation;
  if (!maybeValidation || typeof maybeValidation !== "object") return null;
  return maybeValidation as CatalogAssetValidateResponse;
}

function countReadyTables(sources: SourcesResponse | undefined, connectionId: string, schema: string): number {
  if (!schema) return 0;
  const tables = (sources?.tables ?? []).filter(
    (table) => table.conn === connectionId && table.schema === schema
  );
  return tables.length;
}

export function Step2UploadManifest({
  connectionId,
  schema,
  onSuccess,
  onExit,
  onSchemaResolved
}: Step2UploadManifestProps) {
  const queryClient = useQueryClient();
  const [schemaChoice, setSchemaChoice] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [content, setContent] = useState("");
  const [filename, setFilename] = useState(`${schema || "schema"}.yaml`);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [validation, setValidation] = useState<CatalogAssetValidateResponse | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [preview, setPreview] = useState<SchemaStructurePreview | null>(null);
  const [preferExisting, setPreferExisting] = useState(false);
  const [recoveryPending, setRecoveryPending] = useState(
    () => getAssistantDraft(connectionId)?.recovery === "manifest_written_reload_pending"
  );
  const [validatedSignature, setValidatedSignature] = useState("");
  const [busy, setBusy] = useState(false);
  const lastRequestedRef = useRef("");
  const errorRef = useRef<HTMLDivElement>(null);

  const activeSchema = schema || schemaChoice;
  const projectQuery = useQuery({
    queryKey: queryKeys.project,
    queryFn: () => apiGet<ProjectInfo>("/api/project")
  });
  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources,
    queryFn: () => apiGet<SourcesResponse>("/api/sources")
  });
  const connection = projectQuery.data?.connections.find((item) => item.id === connectionId) ?? null;
  const readable = canReadDatabaseStructure(connection);
  const liveQuery = useQuery({
    queryKey: queryKeys.connectionLiveSchemas(connectionId),
    queryFn: () =>
      apiGet<LiveSchemasResponse>(`/api/connections/${encodeURIComponent(connectionId)}/live-schemas`),
    enabled: Boolean(connectionId) && !schema && readable
  });

  const readyCount = countReadyTables(sourcesQuery.data, connectionId, activeSchema);
  const manifestKnown = Boolean(
    activeSchema &&
      ((sourcesQuery.data?.manifestSchemas ?? []).some(
        (item) => item.conn === connectionId && item.schema === activeSchema
      ) ||
        readyCount > 0)
  );
  const manifestReady = manifestKnown || preferExisting;

  const primaryAction: PrimaryAction = recoveryPending
    ? "retry"
    : !activeSchema
      ? "choose"
      : manifestReady
        ? "use"
        : readable
          ? "read"
          : "upload";

  useEffect(() => {
    if (schema || schemaChoice) return;
    const schemas = liveQuery.data?.schemas ?? [];
    if (schemas.length === 1) {
      setSchemaChoice(schemas[0]?.schema ?? "");
      if (schemas[0]?.schema) onSchemaResolved?.(schemas[0].schema);
    }
  }, [liveQuery.data, schema, schemaChoice, onSchemaResolved]);

  useEffect(() => {
    if (primaryAction === "upload") setShowUpload(true);
  }, [primaryAction]);

  const validateMutation = useMutation({
    mutationFn: (input: CatalogAssetValidateRequest) => validateCatalogAsset(input),
    onSuccess: (data, input) => {
      const signature = requestSignature(input);
      if (signature !== lastRequestedRef.current) return;
      setValidation(data);
      setValidatedSignature(signature);
      setValidationError(null);
    },
    onError: (err) => {
      setValidation(null);
      setValidatedSignature("");
      setValidationError(err instanceof Error ? err.message : "校验失败");
    }
  });

  const finishWritten = (tables: number, reloadStatus: string | undefined) => {
    if (reloadStatus !== "success") {
      setAssistantDraft(connectionId, {
        step: 2,
        connectionId,
        targetSchema: activeSchema,
        recovery: "manifest_written_reload_pending"
      });
      setRecoveryPending(true);
      setStructureError("Schema Manifest 已写入，但 Catalog 尚未同步。请重新同步后再继续。");
      return;
    }
    setAssistantDraft(connectionId, {
      step: 2,
      connectionId,
      targetSchema: activeSchema,
      recovery: null
    });
    setRecoveryPending(false);
    onSuccess(tables);
  };

  const uploadMutation = useMutation({
    mutationFn: () => {
      const request = buildRequest(connectionId, activeSchema, filename, content);
      return uploadCatalogAsset({
        ...request,
        ...(validation?.exists && confirmOverwrite ? { confirmOverwrite: true } : {})
      });
    },
    onSuccess: (data: CatalogAssetUploadResponse) => {
      setValidation(data.validation);
      setUploadError(null);
      invalidateCatalog();
      finishWritten(data.validation.tables, data.reload?.status);
    },
    onError: (err) => {
      const fromResponse = validationFromError(err);
      if (fromResponse) {
        setValidation(fromResponse);
        setValidatedSignature(requestSignature(buildRequest(connectionId, activeSchema, filename, content)));
      }
      if (err instanceof ApiError && err.code === "TARGET_EXISTS") {
        setConfirmOverwrite(false);
        setShowUpload(true);
      }
      setUploadError(err instanceof Error ? err.message : "上传失败");
    }
  });

  function invalidateCatalog() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.catalogReloads });
    void queryClient.invalidateQueries({ queryKey: queryKeys.catalogAssetUploads });
    void queryClient.invalidateQueries({ queryKey: queryKeys.project });
    void queryClient.invalidateQueries({ queryKey: queryKeys.connections });
    void queryClient.invalidateQueries({ queryKey: queryKeys.sources });
    if (activeSchema) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectionTables(connectionId) });
    }
  }

  useEffect(() => {
    if (!content.trim() || !showUpload) {
      return;
    }
    const next = buildRequest(connectionId, activeSchema, filename, content);
    const signature = requestSignature(next);
    if (signature === lastRequestedRef.current) return;
    lastRequestedRef.current = signature;
    setValidation(null);
    setValidatedSignature("");
    setConfirmOverwrite(false);
    const handle = window.setTimeout(() => {
      validateMutation.mutate(next);
    }, 250);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, activeSchema, filename, content, showUpload]);

  const canUpload = useMemo(() => {
    if (!validation?.valid) return false;
    if (!content.trim() || !activeSchema) return false;
    if (validatedSignature !== requestSignature(buildRequest(connectionId, activeSchema, filename, content))) {
      return false;
    }
    if (validation.exists && !confirmOverwrite) return false;
    return true;
  }, [validation, confirmOverwrite, content, validatedSignature, connectionId, activeSchema, filename]);

  useEffect(() => {
    if (uploadError || structureError) errorRef.current?.focus();
  }, [uploadError, structureError]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      setContent(String(event.target?.result || ""));
      setUploadError(null);
    };
    reader.readAsText(file);
  };

  async function syncExisting() {
    if (!activeSchema) return;
    setBusy(true);
    setStatusMessage("正在同步 Catalog...");
    setStructureError(null);
    try {
      const run = await apiPost<CatalogReloadRun>("/api/catalog/reload", {
        connectionId,
        schema: activeSchema
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.sources });
      await queryClient.invalidateQueries({ queryKey: queryKeys.project });
      const sources = queryClient.getQueryData<SourcesResponse>(queryKeys.sources);
      const tables = countReadyTables(sources, connectionId, activeSchema);
      if (run.status !== "success" || tables === 0) {
        setAssistantDraft(connectionId, {
          step: 2,
          connectionId,
          targetSchema: activeSchema,
          recovery: "manifest_written_reload_pending"
        });
        setRecoveryPending(true);
        setStructureError("Catalog 尚未同步出当前 Schema 的数据表。请重新同步后再继续。");
        return;
      }
      setAssistantDraft(connectionId, {
        step: 2,
        connectionId,
        targetSchema: activeSchema,
        recovery: null
      });
      setRecoveryPending(false);
      onSuccess(tables);
    } catch (err) {
      setStructureError(err instanceof Error ? err.message : "同步失败");
    } finally {
      setBusy(false);
      setStatusMessage("");
    }
  }

  async function writeGenerated(yaml: string) {
    const name = `${activeSchema}.yaml`;
    const request = buildRequest(connectionId, activeSchema, name, yaml);
    setBusy(true);
    setStatusMessage("正在写入 Schema Manifest...");
    try {
      const checked = await validateCatalogAsset(request);
      if (!checked.valid) {
        setValidation(checked);
        setStructureError(checked.errors[0]?.message || "生成结果未通过校验。");
        return;
      }
      if (checked.exists) {
        setPreferExisting(true);
        setPreview(null);
        setShowUpload(false);
        setStatusMessage("已存在 Schema Manifest，改为使用现有文件。");
        return;
      }
      const uploaded = await uploadCatalogAsset(request);
      invalidateCatalog();
      setPreview(null);
      finishWritten(uploaded.validation.tables, uploaded.reload?.status);
    } catch (err) {
      if (err instanceof ApiError && err.code === "TARGET_EXISTS") {
        setPreferExisting(true);
        setPreview(null);
        setShowUpload(false);
        return;
      }
      setStructureError(err instanceof Error ? err.message : "写入失败");
    } finally {
      setBusy(false);
      setStatusMessage("");
    }
  }

  async function readStructure() {
    if (!activeSchema) return;
    setBusy(true);
    setStatusMessage("正在读取表结构...");
    setStructureError(null);
    try {
      const data = await apiPost<SchemaStructurePreview>(
        `/api/connections/${encodeURIComponent(connectionId)}/schema-structure`,
        { schema: activeSchema }
      );
      if (data.downgraded.length > 0) {
        setPreview(data);
        return;
      }
      await writeGenerated(data.yaml);
    } catch (err) {
      if (err instanceof ApiError && err.code === "SCHEMA_UNSUPPORTED") {
        setShowUpload(true);
      }
      setStructureError(err instanceof Error ? err.message : "读取失败");
    } finally {
      setBusy(false);
      if (!preview) setStatusMessage("");
    }
  }

  function chooseSchema(next: string) {
    setSchemaChoice(next);
    onSchemaResolved?.(next);
    setAssistantDraft(connectionId, { step: 2, connectionId, targetSchema: next });
  }

  function exitWizard() {
    setAssistantDraft(connectionId, {
      step: 2,
      connectionId,
      targetSchema: activeSchema
    });
    onExit();
  }

  const primaryLabel =
    primaryAction === "retry"
      ? "重新同步并继续"
      : primaryAction === "use"
        ? "使用已有 Schema Manifest"
        : primaryAction === "read"
          ? "从数据库读取表结构"
          : primaryAction === "upload"
            ? "上传 Schema Manifest 并继续"
            : "请先选择 Schema";

  const primaryDisabled =
    busy ||
    uploadMutation.isPending ||
    primaryAction === "choose" ||
    (primaryAction === "upload" && !canUpload);

  const liveSchemas = liveQuery.data?.schemas ?? [];

  return (
    <div className="space-y-6" data-testid="setup-step-2">
      <div className="bg-bg-subtle p-5 rounded-lg border border-border-default space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-border-default">
          <div className="text-xs text-fg-muted">
            目标连接：
            <code className="text-fg-default font-semibold ml-1 notranslate" translate="no">
              {connectionId}
            </code>
            <span className="mx-2">·</span>
            目标 <span translate="no" className="notranslate">Schema</span>：
            <code className="text-fg-default font-semibold ml-1 notranslate" translate="no">
              {activeSchema || "未选择"}
            </code>
          </div>
          <span className="text-xs text-primary font-medium bg-primary/10 px-2 py-0.5 rounded notranslate" translate="no">
            Schema Manifest
          </span>
        </div>

        <p className="text-xs text-fg-muted notranslate" translate="no" aria-live="polite" data-testid="setup-step2-status">
          {statusMessage || "准备当前 Schema 的表结构。确认前不会覆盖已有文件。"}
        </p>

        {!schema && liveSchemas.length > 1 ? (
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-fg-default notranslate" translate="no">选择一个 Schema</legend>
            {liveSchemas.map((item) => (
              <label key={item.schema} className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="setup-target-schema"
                  checked={schemaChoice === item.schema}
                  onChange={() => chooseSchema(item.schema)}
                  data-testid={`setup-schema-${item.schema}`}
                />
                <span className="notranslate" translate="no">{item.schema}</span>
                <span className="text-fg-muted">{item.tableCount} 张表</span>
              </label>
            ))}
          </fieldset>
        ) : null}

        {preview ? (
          <div className="rounded border border-warning/40 bg-warning/10 p-3 text-xs space-y-2" data-testid="setup-downgrade-preview">
            <p>
              将生成 {preview.tableCount} 张表、{preview.columnCount} 个字段。
              {preview.downgraded.length} 个字段无法映射为 number、string 或 time，已降级为 string。
            </p>
            <ul className="max-h-32 overflow-y-auto space-y-1">
              {preview.downgraded.map((item) => (
                <li key={`${item.table}.${item.column}`} className="notranslate" translate="no">
                  {item.table}.{item.column} · {item.rawType}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button
                type="button"
                className="pl-btn pl-btn--primary text-xs"
                disabled={busy}
                onClick={() => void writeGenerated(preview.yaml)}
                data-testid="setup-downgrade-confirm"
              >
                继续生成
              </button>
              <button
                type="button"
                className="pl-btn pl-btn--outline text-xs notranslate"
                translate="no"
                onClick={() => {
                  setPreview(null);
                  setShowUpload(true);
                }}
              >
                我已有 Schema Manifest
              </button>
            </div>
          </div>
        ) : null}

        {showUpload ? (
          <>
            <div className="border-2 border-dashed border-border-default hover:border-primary/50 rounded-lg p-6 text-center bg-bg-surface transition-colors">
              <FileUp className="w-8 h-8 text-fg-muted mx-auto mb-2" />
              <p className="text-xs font-medium text-fg-default mb-1">
                拖拽或选择本地 <span translate="no" className="notranslate">Schema Manifest YAML</span> 文件
              </p>
              <label className="pl-btn pl-btn--outline text-xs cursor-pointer inline-flex items-center gap-1.5">
                <FileCode className="w-3.5 h-3.5" />
                <span>选择本地 YAML 文件</span>
                <input
                  type="file"
                  accept=".yaml,.yml"
                  className="hidden"
                  onChange={handleFileChange}
                  data-testid="setup-manifest-file-input"
                />
              </label>
            </div>
            <div>
              <label className="block text-xs font-medium text-fg-default mb-1">
                或直接粘贴 <span translate="no" className="notranslate">YAML</span> 内容：
              </label>
              <textarea
                className="pl-input w-full font-mono text-xs h-36 notranslate"
                translate="no"
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  setUploadError(null);
                }}
                data-testid="setup-manifest-textarea"
              />
            </div>
            {content.trim() ? (
              <CatalogAssetValidationPanel
                validation={validation}
                isValidating={validateMutation.isPending && !validation}
                errorMessage={validationError}
              />
            ) : null}
            {validation?.valid && validation.exists ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmOverwrite}
                  onChange={(e) => setConfirmOverwrite(e.target.checked)}
                  data-testid="setup-manifest-confirm-overwrite"
                />
                确认覆盖现有 YAML
              </label>
            ) : null}
          </>
        ) : null}
      </div>

      {uploadError || structureError ? (
        <div
          ref={errorRef}
          tabIndex={-1}
          className="p-3 bg-danger/10 border border-danger/30 rounded text-xs text-danger flex items-start gap-2"
          role="alert"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{uploadError || structureError}</span>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 p-4 bg-bg-surface rounded-lg border border-border-default">
        <button
          type="button"
          className="pl-btn pl-btn--ghost text-xs"
          onClick={exitWizard}
          data-testid="setup-step2-exit"
        >
          结束并稍后继续
        </button>
        <div className="flex gap-2">
          {primaryAction === "read" || primaryAction === "use" || primaryAction === "retry" ? (
            <button
              type="button"
              className="pl-btn pl-btn--outline text-xs notranslate"
              translate="no"
              onClick={() => setShowUpload((open) => !open)}
              data-testid="setup-step2-secondary"
            >
              {showUpload
                ? "收起"
                : manifestReady || recoveryPending
                  ? "替换已有 Schema Manifest"
                  : "我已有 Schema Manifest"}
            </button>
          ) : null}
          {showUpload && primaryAction !== "upload" ? (
            <button
              type="button"
              className="pl-btn pl-btn--outline text-xs notranslate"
              translate="no"
              disabled={!canUpload || uploadMutation.isPending}
              onClick={() => uploadMutation.mutate()}
              data-testid="setup-step2-upload"
            >
              {uploadMutation.isPending ? "正在上传..." : "上传 Schema Manifest"}
            </button>
          ) : null}
          <button
            type="button"
            className="pl-btn pl-btn--primary text-xs notranslate"
            translate="no"
            style={{ minWidth: "12rem" }}
            disabled={primaryDisabled}
            aria-busy={busy || uploadMutation.isPending}
            onClick={() => {
              if (primaryAction === "read") void readStructure();
              else if (primaryAction === "use" || primaryAction === "retry") void syncExisting();
              else if (primaryAction === "upload") uploadMutation.mutate();
            }}
            data-testid="setup-step2-next"
          >
            {busy || uploadMutation.isPending ? statusMessage || "正在处理..." : primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
