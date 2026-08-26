import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPost } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import { DiffViewer } from "./DiffViewer";
import type {
  ConnectionInfo,
  DeleteConnectionPreview,
  DeleteConnectionResult
} from "../lib/types";

export type DeleteConnectionDrawerProps = {
  connection: ConnectionInfo;
  open: boolean;
  onClose: () => void;
};

export function DeleteConnectionDrawer({ connection, open, onClose }: DeleteConnectionDrawerProps) {
  const queryClient = useQueryClient();
  const [deleteSecret, setDeleteSecret] = useState(false);
  const [deleteAssets, setDeleteAssets] = useState(false);
  const [confirmId, setConfirmId] = useState("");
  const [step, setStep] = useState<"preview" | "submitting" | "success" | "fatal">("preview");
  const [fatalMessage, setFatalMessage] = useState<string | null>(null);

  const previewMutation = useMutation({
    mutationFn: () =>
      apiPost<DeleteConnectionPreview>(
        `/api/connections/${encodeURIComponent(connection.id)}/remove`,
        { dryRun: true }
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
      apiPost<DeleteConnectionResult>(
        `/api/connections/${encodeURIComponent(connection.id)}/remove`,
        { dryRun: false, deleteSecret, deleteAssets }
      ),
    onSuccess: () => {
      setStep("success");
      void queryClient.invalidateQueries({ queryKey: queryKeys.project });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectionTables(connection.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectionLiveSchemas(connection.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalogReloads });
      toast.success(`已删除连接: ${connection.id}`);
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
    setDeleteSecret(false);
    setDeleteAssets(false);
    setConfirmId("");
    setStep("preview");
    setFatalMessage(null);
    previewMutation.reset();
    writeMutation.reset();
  }

  function close() {
    reset();
    onClose();
  }

  useEffect(() => {
    if (!open) return;
    setDeleteSecret(false);
    setDeleteAssets(false);
    setConfirmId("");
    setStep("preview");
    setFatalMessage(null);
    previewMutation.reset();
    writeMutation.reset();
    previewMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open/connection.id gate
  }, [open, connection.id]);

  if (!open) return null;

  const preview = previewMutation.data;
  const confirmMatches = confirmId === connection.id;
  const enabledCount = preview?.enabledTables.length ?? 0;
  const schemaCount = preview?.schemas.length ?? 0;

  return (
    <div
      className="pl-drawer-backdrop notranslate"
      role="dialog"
      aria-modal="true"
      aria-label="删除连接"
      translate="no"
      data-testid="delete-connection-drawer"
    >
      <div className="pl-drawer-panel">
        <header className="pl-drawer-header">
          <div>
            <h2 className="pl-panel-title notranslate" translate="no">
              删除连接
            </h2>
            <p className="pl-notice notranslate" translate="no">
              连接 ID：
              <code className="notranslate" translate="no" dir="ltr" data-testid="delete-connection-id">
                {connection.id}
              </code>
              。从 <code className="notranslate" translate="no">ktx.yaml</code> 卸载该连接配置，不会删除物理数据库。
            </p>
          </div>
          <button
            type="button"
            className="pl-btn pl-btn--ghost pl-drawer-close"
            onClick={close}
            aria-label="关闭"
            data-testid="delete-connection-close"
          >
            关闭
          </button>
        </header>

        {step === "preview" && (
          <section className="pl-drawer-body" aria-label="删除影响预览">
            {previewMutation.isPending && (
              <p className="text-sm text-fg-muted notranslate" translate="no">正在加载删除影响...</p>
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
                      Schema：
                      <span className="notranslate" translate="no" data-testid="delete-connection-schema-count">
                        {schemaCount === 0 ? "无" : `${schemaCount} 个`}
                      </span>
                    </p>
                    {schemaCount > 0 && (
                      <ul className="mt-1 text-xs text-fg-muted space-y-0.5 notranslate" translate="no">
                        {preview.schemas.map((schema) => (
                          <li key={schema}>
                            <code className="notranslate" translate="no" dir="ltr">{schema}</code>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <p className="text-sm font-medium notranslate" translate="no">
                      将随配置消失的已启用表：
                      <span className="notranslate" translate="no" data-testid="delete-connection-enabled-count">
                        {enabledCount === 0 ? "无" : `${enabledCount} 张`}
                      </span>
                    </p>
                    {enabledCount > 0 && (
                      <ul
                        className="mt-1 text-xs text-fg-muted space-y-0.5 notranslate"
                        translate="no"
                        data-testid="delete-connection-enabled-list"
                      >
                        {preview.enabledTables.map((table) => (
                          <li key={table}>
                            <code className="notranslate" translate="no" dir="ltr">{table}</code>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="text-sm space-y-1">
                    <p className="notranslate" translate="no">
                      约定密码文件：
                      {preview.impact.canDeleteSecret ? (
                        <span className="text-warning-strong notranslate" translate="no">
                          {" "}可删（
                          <code className="notranslate" translate="no" dir="ltr">
                            {preview.impact.secretRelPath}
                          </code>
                          ）
                        </span>
                      ) : (
                        <span className="text-fg-muted notranslate" translate="no">
                          {" "}不在约定路径，不会经此操作删除
                        </span>
                      )}
                    </p>
                    <p className="notranslate" translate="no">
                      本地 YAML 资产：
                      <span className="notranslate" translate="no" data-testid="delete-connection-asset-count">
                        {preview.impact.yamlAssetPaths.length === 0
                          ? "无"
                          : `${preview.impact.yamlAssetPaths.length} 个`}
                      </span>
                    </p>
                    <p className="notranslate" translate="no">
                      仍引用此连接的 Role：
                      <span className="notranslate" translate="no" data-testid="delete-connection-acl-count">
                        {preview.impact.aclRoleIds.length === 0
                          ? "无"
                          : `${preview.impact.aclRoleIds.length} 个`}
                      </span>
                      <span className="text-xs text-fg-muted notranslate" translate="no">
                        {" "}（access.yaml 不会被改写，请在角色管理中手工清理）
                      </span>
                    </p>
                    {preview.impact.aclRoleIds.length > 0 && (
                      <ul className="text-xs text-fg-muted space-y-0.5 notranslate" translate="no">
                        {preview.impact.aclRoleIds.map((roleId) => (
                          <li key={roleId}>
                            <code className="notranslate" translate="no" dir="ltr">{roleId}</code>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="notranslate" translate="no">
                      Wiki 引用页数：
                      <span className="notranslate" translate="no" data-testid="delete-connection-wiki-count">
                        {preview.impact.wikiRefCount === 0 ? "无" : preview.impact.wikiRefCount}
                      </span>
                      <span className="text-xs text-fg-muted notranslate" translate="no">
                        {" "}（Wiki 文件不会被删除）
                      </span>
                    </p>
                    {preview.impact.wikiSamplePaths.length > 0 && (
                      <ul className="text-xs text-fg-muted space-y-0.5 notranslate" translate="no">
                        {preview.impact.wikiSamplePaths.map((wikiPath) => (
                          <li key={wikiPath}>
                            <code className="notranslate" translate="no" dir="ltr">{wikiPath}</code>
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
                        checked={deleteSecret}
                        onChange={(e) => setDeleteSecret(e.target.checked)}
                        disabled={!preview.impact.canDeleteSecret}
                        data-testid="delete-connection-secret-checkbox"
                      />
                      <span className="notranslate" translate="no">
                        同时删除密码文件
                        {preview.impact.secretRelPath ? (
                          <code className="ml-1 text-xs notranslate" translate="no" dir="ltr">
                            {preview.impact.secretRelPath}
                          </code>
                        ) : null}
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={deleteAssets}
                        onChange={(e) => setDeleteAssets(e.target.checked)}
                        disabled={preview.impact.yamlAssetPaths.length === 0}
                        data-testid="delete-connection-assets-checkbox"
                      />
                      <span className="notranslate" translate="no">
                        同时删除本地 YAML 资产（{preview.impact.yamlAssetPaths.length} 个）
                      </span>
                    </label>
                    <p className="text-xs text-fg-muted notranslate" translate="no">
                      物理数据库、业务 Wiki 与 access.yaml 都不会被本操作改写。
                    </p>
                  </div>

                  <label className="block space-y-1">
                    <span className="text-sm font-medium notranslate" translate="no">
                      请输入连接 ID
                      {" "}
                      <code className="notranslate" translate="no" dir="ltr">
                        {connection.id}
                      </code>
                      {" "}
                      以确认
                    </span>
                    <input
                      type="text"
                      className="pl-input notranslate"
                      translate="no"
                      value={confirmId}
                      onChange={(e) => setConfirmId(e.target.value)}
                      placeholder={connection.id}
                      autoComplete="off"
                      spellCheck={false}
                      data-testid="delete-connection-confirm-id"
                    />
                  </label>
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
                    disabled={writeMutation.isPending || !confirmMatches}
                    data-testid="delete-connection-confirm-btn"
                  >
                    {writeMutation.isPending ? "删除中..." : "确认删除连接"}
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
          <section className="pl-drawer-body" aria-label="删除中">
            <p className="text-sm notranslate" translate="no">正在删除连接配置...</p>
            {writeMutation.error && (
              <div className="pl-drawer-error" role="alert">
                <p>{writeMutation.error instanceof Error ? writeMutation.error.message : String(writeMutation.error)}</p>
              </div>
            )}
          </section>
        )}

        {step === "success" && (
          <section className="pl-drawer-body" aria-label="完成">
            <p
              className="text-sm font-semibold text-green-700 notranslate"
              translate="no"
              data-testid="delete-connection-success-message"
            >
              ✓ 已删除连接：<code className="notranslate" translate="no">{connection.id}</code>
            </p>
            <p className="text-sm notranslate" translate="no">
              该连接已从 <code className="notranslate" translate="no">ktx.yaml</code> 卸载。
            </p>
            <div className="pl-drawer-footer">
              <button className="pl-btn pl-btn--ghost" onClick={close} data-testid="delete-connection-done">
                完成
              </button>
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
