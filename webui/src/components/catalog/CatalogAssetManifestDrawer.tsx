import { useQuery } from "@tanstack/react-query";
import { fetchCatalogSchemaManifest } from "../../lib/catalog-assets";
import { queryKeys } from "../../lib/queryKeys";
import type { CatalogSchemaManifestReadResponse } from "../../lib/types";

export type CatalogAssetManifestDrawerProps = {
  open: boolean;
  onClose: () => void;
  connectionId: string;
  schema: string;
  onReupload: (asset: CatalogSchemaManifestReadResponse) => void;
};

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  return `${(sizeBytes / 1024).toFixed(1)} KB`;
}

export function triggerCatalogManifestDownload(asset: CatalogSchemaManifestReadResponse) {
  const blob = new Blob([asset.content], { type: "text/yaml;charset=utf-8" });
  const href = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = asset.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(href);
}

export function CatalogAssetManifestDrawer(props: CatalogAssetManifestDrawerProps) {
  const { open, onClose, connectionId, schema, onReupload } = props;
  const manifestQuery = useQuery({
    queryKey: queryKeys.catalogSchemaManifest(connectionId, schema),
    queryFn: () => fetchCatalogSchemaManifest(connectionId, schema),
    enabled: open
  });

  if (!open) return null;

  const asset = manifestQuery.data;

  return (
    <div
      className="pl-drawer-backdrop notranslate"
      role="dialog"
      aria-modal="true"
      aria-label="查看 Schema Manifest"
      translate="no"
      data-testid="catalog-asset-manifest-drawer"
    >
      <div className="pl-drawer-panel" data-testid="catalog-asset-manifest-panel">
        <header className="pl-drawer-header">
          <div>
            <h2 className="pl-panel-title notranslate" translate="no">
              查看 {schema} 的 Schema Manifest
            </h2>
            <p className="pl-notice">
              可在线查看、下载后编辑，也可以重新上传覆盖此文件。
            </p>
          </div>
          <button
            type="button"
            className="pl-btn pl-btn--ghost pl-drawer-close"
            onClick={onClose}
            data-testid="catalog-asset-manifest-close"
          >
            关闭
          </button>
        </header>

        <section className="pl-drawer-body notranslate" aria-label="Manifest 内容" translate="no">
          {manifestQuery.isLoading ? (
            <p className="pl-notice notranslate" data-testid="catalog-asset-manifest-loading" translate="no">
              正在读取 Schema Manifest...
            </p>
          ) : manifestQuery.error ? (
            <div className="pl-upload-validation pl-upload-validation--danger notranslate" role="alert" translate="no">
              Manifest 读取失败：
              {manifestQuery.error instanceof Error ? manifestQuery.error.message : "未知错误"}
            </div>
          ) : asset ? (
            <>
              <div className="pl-manifest-view-meta">
                <span className="text-sm font-medium">目标文件</span>
                <code
                  className="pl-upload-target-file notranslate"
                  data-testid="catalog-asset-manifest-target-file"
                  translate="no"
                  dir="ltr"
                >
                  {asset.targetPath}
                </code>
                <span className="text-sm font-medium">文件信息</span>
                <span className="pl-manifest-view-file-info notranslate" translate="no">
                  {asset.filename} · {formatBytes(asset.sizeBytes)} · sha256 {asset.sha256.slice(0, 12)}
                </span>
              </div>
              <label className="grid gap-1.5 text-sm">
                <span>YAML 源码</span>
                <textarea
                  className="pl-textarea pl-upload-source-textarea"
                  readOnly
                  value={asset.content}
                  data-testid="catalog-asset-manifest-content"
                />
              </label>
              <div className="pl-drawer-footer">
                <button
                  type="button"
                  className="pl-btn pl-btn--secondary"
                  onClick={() => triggerCatalogManifestDownload(asset)}
                  data-testid="catalog-asset-manifest-download"
                >
                  下载
                </button>
                <button
                  type="button"
                  className="pl-btn pl-btn--primary"
                  onClick={() => onReupload(asset)}
                  data-testid="catalog-asset-manifest-reupload"
                >
                  重新上传
                </button>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
