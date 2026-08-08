import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPost } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import { DiffViewer } from "./DiffViewer";
import { CatalogReloadButton } from "./catalog";
import type {
  ConnectionInfo,
  RemoveSchemaPreview,
  RemoveSchemaResult
} from "../lib/types";

export type RemoveSchemaDrawerProps = {
  connection: ConnectionInfo;
  schema: string;
  open: boolean;
  onClose: () => void;
};

export function RemoveSchemaDrawer({ connection, schema, open, onClose }: RemoveSchemaDrawerProps) {
  const queryClient = useQueryClient();
  const [deleteManifest, setDeleteManifest] = useState(false);
  const [deleteOverlays, setDeleteOverlays] = useState(false);
  const [step, setStep] = useState<"preview" | "submitting" | "success" | "fatal">("preview");
  const [fatalMessage, setFatalMessage] = useState<string | null>(null);

  const previewMutation = useMutation({
    mutationFn: () =>
      apiPost<RemoveSchemaPreview>(
        `/api/connections/${encodeURIComponent(connection.id)}/schemas/remove`,
        { schema, dryRun: true }
      ),
    onError: (err) => {
      const code = errorCode(err);
      if (code === "KTX_YAML_PARSE_ERROR") {
        setStep("fatal");
        setFatalMessage(err instanceof Error ? err.message : String(err));
      }
    }
  });

  const writeMutation = useMutation({
    mutationFn: () =>
      apiPost<RemoveSchemaResult>(
        `/api/connections/${encodeURIComponent(connection.id)}/schemas/remove`,
        { schema, dryRun: false, deleteManifest, deleteOverlays }
      ),
    onSuccess: () => {
      setStep("success");
      void queryClient.invalidateQueries({ queryKey: queryKeys.project });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectionTables(connection.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectionLiveSchemas(connection.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalogReloads });
      toast.success(`已移除 Schema: ${schema}`);
    },
    onError: (err) => {
      const code = errorCode(err);
      if (code === "KTX_YAML_PARSE_ERROR") {
        setStep("fatal");
        setFatalMessage(err instanceof Error ? err.message : String(err));
        return;
      }
      setStep("preview");
      toast.error(`${code}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  function reset() {
    setDeleteManifest(false);
    setDeleteOverlays(false);
    setStep("preview");
    setFatalMessage(null);
    previewMutation.reset();
    writeMutation.reset();
  }

  function close() {
    reset();
    onClose();
  }

  // Auto-trigger dryRun preview when the drawer opens (or target schema changes).
  useEffect(() => {
    if (!open) return;
    setDeleteManifest(false);
    setDeleteOverlays(false);
    setStep("preview");
    setFatalMessage(null);
    previewMutation.reset();
    writeMutation.reset();
    previewMutation.mutate();
    // Intentionally depend on open target identity only; mutate/reset are stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open/schema/connection.id gate
  }, [open, schema, connection.id]);

  if (!open) return null;

  const preview = previewMutation.data;
  const removedCount = preview?.removedEnabledTables.length ?? 0;

  return (
    <div
      className="pl-drawer-backdrop notranslate"
      role="dialog"
      aria-modal="true"
      aria-label="移除 Schema"
      translate="no"
      data-testid="remove-schema-drawer"
    >
      <div className="pl-drawer-panel">
        <header className="pl-drawer-header">
          <div>
            <h2 className="pl-panel-title notranslate" translate="no">
              移除 Schema：<code className="notranslate" translate="no">{schema}</code>
            </h2>
            <p className="pl-notice notranslate" translate="no">
              从 <code className="notranslate" translate="no">ktx.yaml</code> 移除该 Schema 配置及其前缀的已启用表。
            </p>
          </div>
          <button
            type="button"
            className="pl-btn pl-btn--ghost pl-drawer-close"
            onClick={close}
            aria-label="关闭"
            data-testid="remove-schema-close"
          >
            关闭
          </button>
        </header>

        {step === "preview" && (
          <section className="pl-drawer-body" aria-label="移除影响预览">
            {previewMutation.isPending && (
              <p className="text-sm text-fg-muted notranslate" translate="no">正在加载移除影响...</p>
            )}
            {previewMutation.isError && (
              <div className="pl-drawer-error" role="alert">
                <p className="font-semibold">加载预览失败</p>
                <p>{previewMutation.error instanceof Error ? previewMutation.error.message : "未知错误"}</p>
              </div>
            )}
            {preview && (
              <>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium notranslate" translate="no">
                      将移出已启用表：
                      <span className="notranslate" translate="no" data-testid="remove-schema-enabled-count">
                        {removedCount === 0 ? "无" : `${removedCount} 张`}
                      </span>
                    </p>
                    {removedCount > 0 && (
                      <ul
                        className="mt-1 text-xs text-fg-muted space-y-0.5 notranslate"
                        translate="no"
                        data-testid="remove-schema-enabled-list"
                      >
                        {preview.removedEnabledTables.map((table) => (
                          <li key={table}>
                            <code className="notranslate" translate="no" dir="ltr">{table}</code>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="text-sm space-y-1">
                    <p className="notranslate" translate="no">
                      Schema Manifest：
                      {preview.impact.hasManifest ? (
                        <span className="text-warning-strong notranslate" translate="no">
                          {" "}存在（<code className="notranslate" translate="no" dir="ltr">{preview.impact.manifestPath}</code>）
                        </span>
                      ) : (
                        <span className="text-fg-muted notranslate" translate="no"> 不存在</span>
                      )}
                    </p>
                    <p className="notranslate" translate="no">
                      Semantic overlay 候选：
                      <span className="notranslate" translate="no" data-testid="remove-schema-overlay-count">
                        {preview.impact.overlayPaths.length === 0 ? "无" : `${preview.impact.overlayPaths.length} 个`}
                      </span>
                    </p>
                    <p className="notranslate" translate="no">
                      Wiki 引用页数：
                      <span className="notranslate" translate="no" data-testid="remove-schema-wiki-count">
                        {preview.impact.wikiRefCount === 0 ? "无" : preview.impact.wikiRefCount}
                      </span>
                      {preview.impact.wikiSamplePaths.length > 0 && (
                        <span className="text-xs text-fg-muted notranslate" translate="no">
                          {" "}（Wiki 文件不会被删除）
                        </span>
                      )}
                    </p>
                    {preview.impact.wikiSamplePaths.length > 0 && (
                      <ul className="text-xs text-fg-muted space-y-0.5 notranslate" translate="no">
                        {preview.impact.wikiSamplePaths.map((p) => (
                          <li key={p}>
                            <code className="notranslate" translate="no" dir="ltr">{p}</code>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <p className="text-sm font-medium notranslate" translate="no">
                      ktx.yaml 计划变更（unified diff）：
                    </p>
                    <DiffViewer diff={preview.diff} />
                  </div>

                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={deleteManifest}
                        onChange={(e) => setDeleteManifest(e.target.checked)}
                        disabled={!preview.impact.hasManifest}
                        data-testid="remove-schema-delete-manifest-checkbox"
                      />
                      <span className="notranslate" translate="no">
                        同时删除 Schema Manifest
                        {preview.impact.manifestPath ? (
                          <code className="ml-1 text-xs notranslate" translate="no" dir="ltr">
                            {preview.impact.manifestPath}
                          </code>
                        ) : null}
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={deleteOverlays}
                        onChange={(e) => setDeleteOverlays(e.target.checked)}
                        disabled={preview.impact.overlayPaths.length === 0}
                        data-testid="remove-schema-delete-overlays-checkbox"
                      />
                      <span className="notranslate" translate="no">
                        同时删除 semantic overlay（{preview.impact.overlayPaths.length} 个）
                      </span>
                    </label>
                    <p className="text-xs text-fg-muted notranslate" translate="no">
                      业务 Wiki 文件不会被删除，引用失效仅影响预览。
                    </p>
                  </div>

                  {removedCount > 0 && (
                    <p className="text-sm text-warning-strong notranslate" translate="no" data-testid="remove-schema-enabled-warning">
                      将移出 {removedCount} 张已启用表
                    </p>
                  )}
                </div>

                <div className="pl-drawer-footer">
                  <button className="pl-btn pl-btn--ghost" onClick={close}>
                    取消
                  </button>
                  <button
                    className="pl-btn pl-btn--danger"
                    onClick={() => {
                      setStep("submitting");
                      writeMutation.mutate();
                    }}
                    disabled={writeMutation.isPending}
                    data-testid="remove-schema-confirm-btn"
                  >
                    {writeMutation.isPending ? "移除中..." : "确认移除 Schema"}
                  </button>
                </div>
                {writeMutation.error && (
                  <div className="pl-drawer-error" role="alert">
                    <p className="font-semibold">{errorCode(writeMutation.error)}</p>
                    <p>{writeMutation.error instanceof Error ? writeMutation.error.message : String(writeMutation.error)}</p>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {step === "submitting" && (
          <section className="pl-drawer-body" aria-label="移除中">
            <p className="text-sm notranslate" translate="no">正在移除 Schema 配置...</p>
            {writeMutation.error && (
              <div className="pl-drawer-error" role="alert">
                <p>{writeMutation.error instanceof Error ? writeMutation.error.message : String(writeMutation.error)}</p>
              </div>
            )}
          </section>
        )}

        {step === "success" && (
          <section className="pl-drawer-body" aria-label="完成">
            <p className="text-sm font-semibold text-green-700 notranslate" translate="no" data-testid="remove-schema-success-message">
              ✓ 已移除 Schema：<code className="notranslate" translate="no">{schema}</code>
            </p>
            <p className="text-sm notranslate" translate="no">
              <code className="notranslate" translate="no">{schema}</code> 已从 <code className="notranslate" translate="no">{connection.id}</code> 配置中移除。
            </p>
            <div className="pl-drawer-footer">
              <button className="pl-btn pl-btn--ghost" onClick={close}>
                完成
              </button>
              <CatalogReloadButton
                connectionId={connection.id}
                label="同步配置变更"
                pendingLabel="正在同步配置变更..."
                variant="secondary"
                testId="remove-schema-reload-catalog"
              />
            </div>
          </section>
        )}

        {step === "fatal" && (
          <section className="pl-drawer-body" aria-label="致命错误">
            <p className="text-sm font-semibold text-danger-strong">
              {fatalMessage ?? "ktx.yaml 无法解析，请在终端检查。"}
            </p>
            <div className="pl-drawer-footer">
              <button className="pl-btn pl-btn--ghost" onClick={close}>
                关闭
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function errorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string") {
    return (err as { code: string }).code;
  }
  return "UNKNOWN";
}
