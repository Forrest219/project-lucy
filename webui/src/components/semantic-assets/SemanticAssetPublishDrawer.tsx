import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchSemanticAssetReleaseStatus,
  publishSemanticAssets,
  validateSemanticAssets
} from "../../lib/semantic-assets";
import { ApiError } from "../../lib/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import type {
  SemanticAssetFilePreview,
  SemanticAssetValidateRequest,
  SemanticAssetReleaseRecord,
  SemanticAssetValidateResponse
} from "../../lib/types";
import { SemanticAssetValidationPanel } from "./SemanticAssetValidationPanel";
import { DiffViewer } from "../DiffViewer";

export type SemanticAssetPublishDrawerProps = {
  open: boolean;
  onClose: () => void;
  defaultConnectionId?: string;
  defaultSchema?: string;
  onPublished?: (release: SemanticAssetReleaseRecord) => void;
};

type Stage =
  | { name: "idle" }
  | { name: "parsed"; validation: SemanticAssetValidateResponse }
  | { name: "publishing" }
  | { name: "reindexing"; release: SemanticAssetReleaseRecord }
  | { name: "published"; release: SemanticAssetReleaseRecord }
  | { name: "blocked"; validation: SemanticAssetValidateResponse; release?: SemanticAssetReleaseRecord };

const MAX_FILES = 50;
const MAX_BYTES = 512 * 1024;
const MAX_PACKAGE_BYTES = 3 * 1024 * 1024;

type SelectedYamlFile = { filename: string; content: string };
type SelectedPackageFile = { filename: string; contentBase64: string };

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function contentFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function requestSignature(
  files: SelectedYamlFile[],
  packages: SelectedPackageFile[],
  defaultConnectionId?: string,
  defaultSchema?: string
): string {
  const filePart = files
    .map((f) => `${f.filename}:${utf8ByteLength(f.content)}:${contentFingerprint(f.content)}`)
    .join(";");
  const packagePart = packages
    .map((f) => `${f.filename}:${f.contentBase64.length}:${contentFingerprint(f.contentBase64)}`)
    .join(";");
  return `${defaultConnectionId ?? ""}|${defaultSchema ?? ""}|${filePart}|packages:${packagePart}`;
}

async function readFileAsText(file: File): Promise<string> {
  if (file.size > MAX_BYTES) {
    throw new Error(`${file.name} 超过 ${MAX_BYTES / 1024} KB 上限`);
  }
  return file.text();
}

function isPackageFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".zip") || lower.endsWith(".tar.gz") || lower.endsWith(".tgz");
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function readFileAsPackage(file: File): Promise<string> {
  if (file.size > MAX_PACKAGE_BYTES) {
    throw new Error(`${file.name} 超过 ${MAX_PACKAGE_BYTES / 1024 / 1024} MB 包大小上限`);
  }
  return arrayBufferToBase64(await file.arrayBuffer());
}

function FilePill({ file }: { file: SemanticAssetFilePreview }) {
  return (
    <span
      className="rounded-pill border border-border-default bg-bg-muted px-2 py-0.5 text-xs"
      data-testid="semantic-asset-publish-file-pill"
    >
      <code className="font-mono">{file.targetPath.split("/").slice(-1)[0]}</code>
      <span className="ml-1 text-fg-muted">{file.sizeBytes} B</span>
    </span>
  );
}

function ReleaseSummary({ release }: { release: SemanticAssetReleaseRecord }) {
  return (
    <section
      className="grid gap-2 rounded-md border border-border-default bg-bg-subtle p-3 text-sm"
      data-testid="semantic-asset-release-summary"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>Release {release.id}</strong>
        <span
          className="rounded-pill border border-border-default bg-bg-elevated px-2 py-0.5 text-xs"
          data-testid="semantic-asset-release-status"
          data-status={release.status}
        >
          {release.status}
        </span>
      </div>
      <p className="text-xs text-fg-muted">
        创建于 {release.createdAt} · 包含 {release.files.length} 个文件
      </p>
      {release.changedSources.length > 0 ? (
        <p className="text-xs text-fg-muted">
          changed sources: {release.changedSources.map((c) => `${c.connectionId}/${c.sourceName}`).join(", ")}
        </p>
      ) : null}
      {release.validation.results.length > 0 ? (
        <ul
          className="list-none p-0 text-xs"
          data-testid="semantic-asset-release-validation"
        >
          {release.validation.results.map((row) => (
            <li
              key={`${row.connectionId}-${row.sourceName}`}
              className={row.ok ? "text-success-strong" : "text-danger-strong"}
            >
              {row.connectionId}/{row.sourceName} — exit {row.exitCode} {row.ok ? "OK" : "FAIL"}
            </li>
          ))}
        </ul>
      ) : null}
      {release.reindex ? (
        <p className="text-xs text-fg-muted">
          reindex exit {release.reindex.exitCode} ({release.reindex.ok ? "ok" : "failed"})
        </p>
      ) : null}
    </section>
  );
}

export function SemanticAssetPublishDrawer(props: SemanticAssetPublishDrawerProps) {
  const { open, onClose, defaultConnectionId, defaultSchema, onPublished } = props;
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<SelectedYamlFile[]>([]);
  const [packages, setPackages] = useState<SelectedPackageFile[]>([]);
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [validation, setValidation] = useState<SemanticAssetValidateResponse | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const signatureRef = useRef("");
  const [pollingReleaseId, setPollingReleaseId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setFiles([]);
      setPackages([]);
      setStage({ name: "idle" });
      setValidation(null);
      setValidationError(null);
      setConfirmOverwrite(false);
      signatureRef.current = "";
      setPollingReleaseId(null);
    }
  }, [open]);

  const signature = useMemo(
    () => requestSignature(files, packages, defaultConnectionId, defaultSchema),
    [files, packages, defaultConnectionId, defaultSchema]
  );

  const validateMutation = useMutation({
    mutationFn: (payload: Pick<SemanticAssetValidateRequest, "files" | "packages">) =>
      validateSemanticAssets({
        files: payload.files,
        packages: payload.packages,
        defaultConnectionId,
        defaultSchema
      })
  });

  const publishMutation = useMutation({
    mutationFn: (input: { validationId: string; confirmOverwrite?: boolean }) =>
      publishSemanticAssets(input),
    onSuccess: (data) => {
      setStage({ name: "reindexing", release: data.release });
      setPollingReleaseId(data.release.id);
      void queryClient.invalidateQueries({ queryKey: queryKeys.semanticAssetReleases });
    },
    onError: (err) => {
      const apiError = err instanceof ApiError ? err : null;
      if (apiError?.code === "VALIDATION_GATE_FAILED") {
        const data = (apiError.data as { errors?: SemanticAssetValidateResponse["errors"] } | undefined) ?? {};
        const validationFromResponse: SemanticAssetValidateResponse | null = validation
          ? { ...validation, errors: data.errors ?? [] }
          : null;
        if (validationFromResponse) {
          setValidation(validationFromResponse);
          setStage({ name: "blocked", validation: validationFromResponse });
        } else {
          setStage({ name: "blocked", validation: validation! });
        }
        toast.error(`发布被阻断：${apiError.message}`);
      } else if (apiError?.code === "PUBLISH_IN_PROGRESS") {
        toast.error("已有发布批次正在进行，请等待当前批次完成。");
      } else {
        toast.error(`发布失败：${err instanceof Error ? err.message : "未知错误"}`);
      }
    }
  });

  const releaseStatusQuery = useQuery({
    queryKey: pollingReleaseId
      ? queryKeys.semanticAssetRelease(pollingReleaseId)
      : ["semantic-assets", "releases", "_none"],
    queryFn: () => fetchSemanticAssetReleaseStatus(pollingReleaseId as string),
    enabled: stage.name === "reindexing" && Boolean(pollingReleaseId),
    refetchInterval: (query) => {
      const release = query.state.data?.release;
      if (!release) return 1500;
      if (release.status === "reindexing") return 1500;
      return false;
    }
  });

  useEffect(() => {
    const release = releaseStatusQuery.data?.release;
    if (release) {
      if (release.status === "published" || release.status === "reindex_failed") {
        setStage({ name: "published", release });
        onPublished?.(release);
        void queryClient.invalidateQueries({ queryKey: queryKeys.semanticAssetReleases });
      }
    }
  }, [releaseStatusQuery.data, onPublished, queryClient]);

  // Re-validate when the file set signature changes.
  useEffect(() => {
    if (!open) return;
    if (files.length === 0 && packages.length === 0) {
      setValidation(null);
      setValidationError(null);
      signatureRef.current = "";
      setStage({ name: "idle" });
      return;
    }
    if (signature === signatureRef.current) return;
    signatureRef.current = signature;
    setValidation(null);
    setValidationError(null);
    setStage({ name: "idle" });
    const handle = window.setTimeout(() => {
      validateMutation.mutate(
        { files, packages },
        {
          onSuccess: (data) => {
            setValidation(data);
            setStage({ name: "parsed", validation: data });
          },
          onError: (err) => {
            setValidationError(err instanceof Error ? err.message : "校验失败");
          }
        }
      );
    }, 250);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, open, files.length, packages.length]);

  async function handleDropOrPick(picked: FileList | null) {
    if (!picked) return;
    const next: SelectedYamlFile[] = [];
    const nextPackages: SelectedPackageFile[] = [];
    for (const f of Array.from(picked)) {
      if (next.length + nextPackages.length >= MAX_FILES) {
        toast.error(`一次最多 ${MAX_FILES} 个 YAML 文件`);
        break;
      }
      try {
        if (isPackageFile(f.name)) {
          nextPackages.push({ filename: f.name, contentBase64: await readFileAsPackage(f) });
        } else {
          const text = await readFileAsText(f);
          next.push({ filename: f.name, content: text });
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "读取文件失败");
      }
    }
    setFiles(next);
    setPackages(nextPackages);
  }

  function handlePasteYaml(filename: string, content: string) {
    setFiles((prev) => [...prev, { filename, content }]);
  }

  function handleSubmit() {
    if (!validation || !validation.valid) return;
    if (stage.name === "publishing" || stage.name === "reindexing") return;
    setStage({ name: "publishing" });
    publishMutation.mutate({
      validationId: validation.validationId,
      confirmOverwrite
    });
  }

  const canPublish = useMemo(() => {
    if (!validation || !validation.valid) return false;
    if (stage.name === "publishing" || stage.name === "reindexing") return false;
    if (validation.files.some((f) => f.exists) && !confirmOverwrite) return false;
    return true;
  }, [validation, stage, confirmOverwrite]);

  if (!open) return null;

  const blockedView = stage.name === "blocked" ? stage : null;
  const publishingView = stage.name === "publishing" ? stage : null;
  const reindexingView = stage.name === "reindexing" ? stage : null;
  const publishedView = stage.name === "published" ? stage : null;
  const showSuccess = publishedView || reindexingView;

  return (
    <div
      className="pl-drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="发布语义资产"
      data-testid="semantic-asset-publish-drawer"
    >
      <div className="pl-drawer-panel" data-testid="semantic-asset-publish-panel">
        <header className="pl-drawer-header">
          <div>
            <p className="pl-eyebrow">语义资产</p>
            <h2 className="pl-panel-title notranslate" translate="no">发布 Schema Manifest + Semantic Overlay</h2>
            <p className="pl-notice notranslate" translate="no">
              走 staging 验证门禁：通过 <code className="notranslate" translate="no">ktx sl validate</code> 后才原子落盘正式 PVC；只有
              落盘成功才会触发 <code className="notranslate" translate="no">ktx admin reindex</code>。正式文件不会被覆盖除非你勾选确认。
            </p>
          </div>
          <button
            className="pl-btn pl-btn--ghost"
            onClick={onClose}
            data-testid="semantic-asset-publish-close"
          >
            关闭
          </button>
        </header>

        {!showSuccess ? (
          <section className="pl-drawer-body" aria-label="发布表单">
            <div
              className="pl-upload-dropzone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void handleDropOrPick(e.dataTransfer.files);
              }}
              data-testid="semantic-asset-publish-dropzone"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".yaml,.yml,.zip,.tar.gz,.tgz"
                multiple
                hidden
                onChange={(e) => {
                  void handleDropOrPick(e.target.files);
                }}
                data-testid="semantic-asset-publish-file"
              />
              <p className="text-sm">
                选择 <code className="notranslate" translate="no">.yaml</code> / <code className="notranslate" translate="no">.zip</code> / <code className="notranslate" translate="no">.tar.gz</code> 文件或拖入此处。
              </p>
              <div className="pl-upload-file-summary">
                <button
                  type="button"
                  className="pl-btn pl-btn--ghost pl-btn--sm"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="semantic-asset-publish-pick-file"
                >
                  选择文件
                </button>
                <span className="text-xs text-fg-muted">
                  {files.length + packages.length} / {MAX_FILES} 个文件
                </span>
              </div>
            </div>

            <label className="grid gap-1.5 text-sm">
              <span>或粘贴单个 YAML 源码</span>
              <textarea
                className="pl-textarea pl-upload-source-textarea"
                rows={6}
                placeholder="name: international_country_metrics\ntable: chatbi.ai_metric_international_country_daily\n"
                onPaste={(e) => {
                  const text = e.clipboardData.getData("text");
                  if (!text) return;
                  handlePasteYaml("pasted.yaml", text);
                }}
                data-testid="semantic-asset-publish-paste"
              />
            </label>

            {files.length > 0 || packages.length > 0 ? (
              <div className="flex flex-wrap gap-2" data-testid="semantic-asset-publish-files">
                {files.map((f) => (
                  <span
                    key={f.filename}
                    className="rounded-pill border border-border-default bg-bg-muted px-2 py-0.5 text-xs"
                  >
                    <code className="font-mono">{f.filename}</code>
                  </span>
                ))}
                {packages.map((f) => (
                  <span
                    key={f.filename}
                    className="rounded-pill border border-border-default bg-bg-muted px-2 py-0.5 text-xs"
                  >
                    <code className="font-mono">{f.filename}</code>
                    <span className="ml-1 text-fg-muted">package</span>
                  </span>
                ))}
              </div>
            ) : null}

            <SemanticAssetValidationPanel
              validation={validation}
              isValidating={validateMutation.isPending}
              errorMessage={validationError}
            />

            {validation?.files.some((f) => f.exists) ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmOverwrite}
                  onChange={(e) => setConfirmOverwrite(e.target.checked)}
                  data-testid="semantic-asset-publish-confirm-overwrite"
                />
                确认覆盖现有 YAML 文件
              </label>
            ) : null}

            {validation?.changedSources && validation.changedSources.length > 0 ? (
              <div className="grid gap-1 text-xs text-fg-muted">
                <strong>Changed sources</strong>
                <ul className="list-none p-0" data-testid="semantic-asset-changed-sources">
                  {validation.changedSources.map((c) => (
                    <li key={`${c.connectionId}/${c.sourceName}`}>
                      <code>
                        {c.connectionId}/{c.sourceName}
                      </code>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {validation?.diff ? (
              <details className="text-xs">
                <summary className="cursor-pointer text-fg-default">查看 unified diff</summary>
                <DiffViewer diff={validation.diff} />
              </details>
            ) : null}

            {blockedView ? (
              <div
                className="pl-drawer-error"
                role="alert"
                data-testid="semantic-asset-publish-blocked"
              >
                <strong>发布被阻断</strong>
                <p className="text-xs">{blockedView.validation.errors[0]?.message ?? "请检查上面的错误"}</p>
              </div>
            ) : null}

            {publishingView ? (
              <p className="pl-notice" data-testid="semantic-asset-publish-progress">
                正在通过 staging 门禁并落盘…
              </p>
            ) : null}

            <div className="pl-drawer-footer">
              <button className="pl-btn pl-btn--ghost" onClick={onClose}>
                取消
              </button>
              <button
                className="pl-btn pl-btn--primary"
                disabled={!canPublish}
                onClick={handleSubmit}
                data-testid="semantic-asset-publish-submit"
              >
                {publishMutation.isPending ? "发布中…" : "发布语义层"}
              </button>
            </div>
          </section>
        ) : (
          <section
            className="pl-drawer-body"
            aria-label="发布结果"
            data-testid="semantic-asset-publish-result"
          >
            {publishedView && publishedView.release.status === "published" ? (
              <div
                className="rounded-md border border-success-strong bg-success-soft p-3 text-sm text-success-strong"
                data-testid="semantic-asset-publish-success"
              >
                ✓ 已发布 {publishedView.release.files.length} 个文件，reindex 完成。
              </div>
            ) : null}
            {reindexingView ? (
              <div
                className="rounded-md border border-warning bg-warning-soft p-3 text-sm text-warning-strong"
                data-testid="semantic-asset-publish-reindexing"
              >
                落盘成功，正在 reindex… 每 1.5s 轮询一次状态。
              </div>
            ) : null}
            <ReleaseSummary release={(publishedView ?? reindexingView)!.release} />
            <div className="pl-drawer-footer">
              <button
                className="pl-btn pl-btn--ghost"
                onClick={onClose}
                data-testid="semantic-asset-publish-result-close"
              >
                完成并关闭
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
