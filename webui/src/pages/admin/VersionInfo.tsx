import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "../../components/PageHeader";
import { ApiError, apiGet } from "../../lib/apiClient";
import { formatLucyVersionLabel } from "../../lib/lucyVersion";
import {
  formatBundledKtxVersion,
  formatWorkspaceStatus,
  isRecordedCommit
} from "../../lib/lucyRevision";

type HealthVersion = {
  lucyVersion?: string;
  gitSha?: string;
  gitDirty?: boolean;
  bundledKtxVersion?: string;
};

export function VersionInfo() {
  const query = useQuery({
    queryKey: ["health", "version-info"],
    queryFn: () => apiGet<HealthVersion>("/api/health")
  });

  const data = query.data;
  const gitSha = typeof data?.gitSha === "string" ? data.gitSha : "unknown";
  const productVersion = formatLucyVersionLabel(typeof data?.lucyVersion === "string" ? data.lucyVersion : "");
  const workspace = formatWorkspaceStatus(gitSha, data?.gitDirty === true);
  const ktxVersion = formatBundledKtxVersion(data?.bundledKtxVersion);

  async function copySha() {
    try {
      await navigator.clipboard.writeText(gitSha);
      toast.success("已复制构建提交");
    } catch {
      toast.error("复制失败，请重试");
    }
  }

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="版本信息"
        description="核对这次运行对应的产品版本和构建提交。"
        breadcrumbs={["系统设置"]}
      />

      {query.isPending && (
        <p className="text-sm text-fg-muted" data-testid="version-info-loading">
          正在加载版本信息…
        </p>
      )}

      {query.isError && (
        <div className="pl-card p-4 text-sm text-danger" role="alert" data-testid="version-info-error">
          {query.error instanceof ApiError ? query.error.message : "加载版本信息失败"}
        </div>
      )}

      {data && (
        <dl className="pl-card divide-y divide-border-default" data-testid="version-info">
          <div className="grid grid-cols-[160px_minmax(0,1fr)] items-center gap-1 px-5 py-4">
            <dt className="text-sm text-fg-muted">产品版本</dt>
            <dd className="notranslate text-sm text-fg-default" translate="no" data-testid="version-info-product">
              {productVersion}
            </dd>
          </div>
          <div className="grid grid-cols-[160px_minmax(0,1fr)] items-center gap-1 px-5 py-4">
            <dt className="text-sm text-fg-muted">构建提交</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-3">
              <span className="notranslate break-all font-mono text-sm text-fg-default" translate="no" data-testid="version-info-sha">
                {gitSha}
              </span>
              {isRecordedCommit(gitSha) && (
                <button type="button" className="pl-btn pl-btn--ghost text-sm" data-testid="version-info-copy" onClick={() => void copySha()}>
                  复制
                </button>
              )}
            </dd>
          </div>
          {isRecordedCommit(gitSha) && data?.gitDirty === true && (
            <div className="grid grid-cols-[160px_minmax(0,1fr)] items-center gap-1 px-5 py-4">
              <dt className="text-sm text-fg-muted">工作区</dt>
              <dd className="text-sm text-fg-default" data-testid="version-info-workspace">
                {workspace}
              </dd>
            </div>
          )}
          <div className="grid grid-cols-[160px_minmax(0,1fr)] items-center gap-1 px-5 py-4">
            <dt className="text-sm text-fg-muted">
              随包 <span className="notranslate" translate="no">KTX</span> 版本
            </dt>
            <dd className="notranslate text-sm text-fg-default" translate="no" data-testid="version-info-ktx">
              {ktxVersion}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
