import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  uploadCatalogAsset,
  validateCatalogAsset
} from "../../lib/catalog-assets";
import { ApiError } from "../../lib/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import type {
  CatalogAssetUploadResponse,
  CatalogAssetValidateRequest,
  CatalogAssetValidateResponse
} from "../../lib/types";
import { CatalogAssetValidationPanel } from "./CatalogAssetValidationPanel";

export type CatalogAssetUploadDrawerProps = {
  open: boolean;
  onClose: () => void;
  connectionId: string;
  schema?: string;
  schemaOptions?: string[];
  onUploaded?: (result: CatalogAssetUploadResponse) => void;
};

const FILENAME_HINT = "openclaw_db.yaml";

function defaultFilenameForSchema(schema: string): string {
  return schema ? `${schema}.yaml` : FILENAME_HINT;
}

function yamlPlaceholderForSchema(schema: string): string {
  const qualifiedTable = schema ? `${schema}.customers` : "<schema>.customers";
  return [
    "tables:",
    "  customers:",
    `    table: ${qualifiedTable}`,
    "    columns:",
    "      - name: customer_id",
    "      - name: customer_name",
    ""
  ].join("\n");
}

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
    filename: filename || FILENAME_HINT,
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

export function CatalogAssetUploadDrawer(props: CatalogAssetUploadDrawerProps) {
  const {
    open,
    onClose,
    connectionId,
    schema: schemaProp,
    schemaOptions,
    onUploaded
  } = props;
  const queryClient = useQueryClient();

  const schemaLocked = typeof schemaProp === "string" && schemaProp.length > 0;
  const fallbackSchema = schemaOptions?.[0] ?? "";
  const [schema, setSchema] = useState<string>(schemaProp ?? fallbackSchema);
  const [filename, setFilename] = useState<string>(defaultFilenameForSchema(schemaProp ?? fallbackSchema));
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [confirmOverwrite, setConfirmOverwrite] = useState<boolean>(false);
  const [validation, setValidation] = useState<CatalogAssetValidateResponse | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validatedSignature, setValidatedSignature] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastRequestedRef = useRef<string>("");
  const title = schemaLocked
    ? `上传 ${schema} 的 Schema Manifest`
    : `上传 ${connectionId} 的 Schema Manifest`;
  const targetFile = schema
    ? `semantic-layer/${connectionId}/_schema/${schema}.yaml`
    : `semantic-layer/${connectionId}/_schema/<schema>.yaml`;

  useEffect(() => {
    if (!open) return;
    const nextSchema = schemaProp ?? fallbackSchema;
    setSchema(nextSchema);
    setFilename(defaultFilenameForSchema(nextSchema));
    setSelectedFileName(null);
    setContent("");
    setConfirmOverwrite(false);
    setValidation(null);
    setValidationError(null);
    setValidatedSignature("");
    lastRequestedRef.current = "";
  }, [open, schemaProp, fallbackSchema]);

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

  const uploadMutation = useMutation({
    mutationFn: () =>
      uploadCatalogAsset({
        ...buildRequest(connectionId, schema, filename, content),
        confirmOverwrite
      }),
    onSuccess: (data) => {
      setValidation(data.validation);
      setConfirmOverwrite(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalogReloads });
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalogAssetUploads });
      void queryClient.invalidateQueries({ queryKey: queryKeys.project });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources });
      if (schema) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.connectionTables(connectionId) });
      }
      onUploaded?.(data);
      toast.success("YAML 已上传并刷新本地目录");
    },
    onError: (err) => {
      const validationFromResponse = validationFromError(err);
      if (validationFromResponse) {
        setValidation(validationFromResponse);
        setValidatedSignature(requestSignature(buildRequest(
          connectionId,
          schema,
          filename,
          content
        )));
      }
      toast.error(`上传失败：${err instanceof Error ? err.message : "未知错误"}`);
    }
  });

  // Re-validate when schema / filename / content changes.
  useEffect(() => {
    if (!open) return;
    if (!schema) {
      setValidation(null);
      setValidatedSignature("");
      return;
    }
    if (!content.trim()) {
      setValidation(null);
      setValidatedSignature("");
      setValidationError(null);
      return;
    }
    const next = buildRequest(connectionId, schema, filename, content);
    const signature = requestSignature(next);
    if (signature === lastRequestedRef.current) return;
    lastRequestedRef.current = signature;
    setValidation(null);
    setValidatedSignature("");
    const handle = window.setTimeout(() => {
      validateMutation.mutate(next);
    }, 250);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connectionId, schema, filename, content]);

  async function handleFile(file: File | null) {
    if (!file) return;
    const safeName = file.name || filename;
    setFilename(safeName);
    setSelectedFileName(safeName);
    const text = await file.text();
    setContent(text);
  }

  function handleSubmit() {
    const currentSignature = requestSignature(buildRequest(connectionId, schema, filename, content));
    if (!validation || validation.errors.length > 0 || validatedSignature !== currentSignature) return;
    if (validation.exists && !confirmOverwrite) return;
    if (!schema) return;
    uploadMutation.mutate();
  }

  function handleTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab" || event.shiftKey) return;
    event.preventDefault();
    const target = event.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const next = `${content.slice(0, start)}  ${content.slice(end)}`;
    setContent(next);
    window.requestAnimationFrame(() => {
      target.selectionStart = start + 2;
      target.selectionEnd = start + 2;
    });
  }

  const canUpload = useMemo(() => {
    if (!validation) return false;
    if (!validation.valid) return false;
    if (!content.trim()) return false;
    if (validatedSignature !== requestSignature(buildRequest(connectionId, schema, filename, content))) return false;
    if (validation.exists && !confirmOverwrite) return false;
    return true;
  }, [validation, confirmOverwrite, content, validatedSignature, connectionId, schema, filename]);

  if (!open) return null;

  return (
    <div
      className="pl-drawer-backdrop notranslate"
      role="dialog"
      aria-modal="true"
      aria-label="上传 Schema Manifest"
      translate="no"
      data-testid="catalog-asset-upload-drawer"
    >
      <div className="pl-drawer-panel" data-testid="catalog-asset-upload-panel">
        <header className="pl-drawer-header">
          <div>
            <p className="pl-eyebrow">数据接入</p>
            <h2 className="pl-panel-title notranslate" translate="no">
              {title}
            </h2>
            <p className="pl-notice">
              受控上传 <code className="notranslate" translate="no">Schema Manifest</code>；系统计算目标路径并校验文件，成功后刷新本地目录。
            </p>
          </div>
          <button
            type="button"
            className="pl-btn pl-btn--ghost pl-drawer-close"
            onClick={onClose}
            data-testid="catalog-asset-upload-close"
          >
            关闭
          </button>
        </header>

        {!uploadMutation.data ? (
          <section className="pl-drawer-body" aria-label="上传表单">
            <div className="grid gap-2">
              {!schemaLocked ? (
                <label className="grid gap-1.5 text-sm">
                  <span className="notranslate" translate="no">Schema</span>
                  <select
                    className="pl-input"
                    value={schema}
                    onChange={(e) => {
                      setSchema(e.target.value);
                      setFilename(defaultFilenameForSchema(e.target.value));
                      setSelectedFileName(null);
                    }}
                    data-testid="catalog-asset-upload-schema"
                  >
                    <option className="notranslate" value="" translate="no">请选择 Schema</option>
                    {(schemaOptions ?? []).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="pl-upload-target-group">
                <span className="text-sm font-medium">目标文件</span>
                <code
                  className="pl-upload-target-file notranslate"
                  data-testid="catalog-asset-upload-target-file"
                  translate="no"
                  dir="ltr"
                >
                  {targetFile}
                </code>
                <span className="text-sm font-medium">所选文件</span>
                <code
                  className="pl-upload-filename-readonly notranslate"
                  data-testid="catalog-asset-upload-filename"
                  translate="no"
                  dir="ltr"
                >
                  {filename}
                </code>
                <span className="col-span-2 text-xs text-fg-muted">
                  只写入目标文件；不会编辑指标、<code className="notranslate" translate="no">Join</code> 或业务语义。
                </span>
              </div>
              <div
                className="pl-upload-dropzone"
                onDragOver={(e) => {
                  e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0] ?? null;
                  void handleFile(file);
                }}
                data-testid="catalog-asset-upload-dropzone"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".yaml,.yml"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    void handleFile(file);
                  }}
                  data-testid="catalog-asset-upload-file"
                />
                <p className="text-sm">
                  选择 <code className="notranslate" translate="no">.yaml</code> / <code className="notranslate" translate="no">.yml</code> 文件或拖入此处。
                </p>
                <div className="pl-upload-file-summary" data-testid="catalog-asset-upload-file-summary">
                  <button
                    type="button"
                    className="pl-btn pl-btn--ghost pl-btn--sm"
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="catalog-asset-upload-pick-file"
                  >
                    选择文件
                  </button>
                  {selectedFileName ? (
                    <span
                      className="text-xs text-fg-muted"
                      data-testid="catalog-asset-upload-filename-display"
                    >
                      已选择：
                      <span className="notranslate" translate="no" dir="ltr">
                        {selectedFileName}
                      </span>
                    </span>
                  ) : null}
                </div>
              </div>
              <label className="grid gap-1.5 text-sm">
                <span>或直接粘贴 YAML 源码</span>
                <textarea
                  className="pl-textarea pl-upload-source-textarea"
                  rows={10}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onKeyDown={handleTextareaKeyDown}
                  placeholder={yamlPlaceholderForSchema(schema)}
                  data-testid="catalog-asset-upload-textarea"
                />
              </label>

              <CatalogAssetValidationPanel
                validation={validation}
                isValidating={validateMutation.isPending}
                errorMessage={validationError}
              />

              {validation?.exists ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={confirmOverwrite}
                    onChange={(e) => setConfirmOverwrite(e.target.checked)}
                    data-testid="catalog-asset-upload-confirm-overwrite"
                  />
                  确认覆盖现有 YAML
                </label>
              ) : null}
            </div>

            <div className="pl-drawer-footer">
              <button className="pl-btn pl-btn--ghost" onClick={onClose}>
                取消
              </button>
              <button
                className="pl-btn pl-btn--primary"
                disabled={!canUpload || uploadMutation.isPending}
                onClick={handleSubmit}
                data-testid="catalog-asset-upload-submit"
              >
                {uploadMutation.isPending ? "上传中..." : "上传并刷新本地目录"}
              </button>
            </div>
          </section>
        ) : (
          <section
            className="pl-drawer-body"
            aria-label="上传成功"
            data-testid="catalog-asset-upload-success"
          >
            <p className="text-sm font-semibold text-success-strong notranslate" translate="no">
              ✓ 已上传 Schema Manifest：{uploadMutation.data.record.originalFilename}
            </p>
            <p className="text-sm">
              解析到 <strong>{uploadMutation.data.record.tables}</strong> 张表，
              并已刷新本地目录。
            </p>
            <p className="text-xs text-fg-muted" data-testid="catalog-asset-upload-target-display">
              目标文件：<code>{uploadMutation.data.record.targetPath}</code>
            </p>
            {uploadMutation.data.record.overwritten ? (
              <p className="text-xs text-warning-strong">
                已覆盖既有文件。
              </p>
            ) : null}
            <div className="pl-drawer-footer">
              <button
                className="pl-btn pl-btn--ghost"
                onClick={() => {
                  uploadMutation.reset();
                  onClose();
                }}
                data-testid="catalog-asset-upload-secondary"
              >
                完成并关闭
              </button>
              <Link
                className="pl-btn pl-btn--primary"
                to={`/connections/whitelist?schema=${encodeURIComponent(schema)}`}
                onClick={onClose}
                data-testid="catalog-asset-upload-primary"
              >
                前往配置启用表范围 →
              </Link>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
