import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../../components/PageHeader";
import { ApiError, apiGet } from "../../lib/apiClient";
import { copyTextWithToast } from "../../lib/clipboard";
import { formatLucyVersionLabel } from "../../lib/lucyVersion";
import {
  formatBundledKtxVersion,
  formatVisibleBuildCommit,
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
  const isRecorded = isRecordedCommit(gitSha);
  const visibleSha = formatVisibleBuildCommit(gitSha);
  const productVersion = formatLucyVersionLabel(typeof data?.lucyVersion === "string" ? data.lucyVersion : "");
  const workspace = formatWorkspaceStatus(gitSha, data?.gitDirty === true);
  const ktxVersion = formatBundledKtxVersion(data?.bundledKtxVersion);

  async function copySha() {
    await copyTextWithToast(gitSha, {
      successMessage: "已复制构建提交",
      failureMessage: "复制失败，请重试"
    });
  }

  return (
    <div className="pl-page-stack">
      <PageHeader title="版本信息" breadcrumbs={["系统设置"]} />

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
        <div className="max-w-xl space-y-4" data-testid="version-info">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-fg-muted">产品版本</span>
            <span
              className="notranslate text-2xl font-semibold tracking-tight text-fg-default"
              translate="no"
              data-testid="version-info-product"
            >
              {productVersion}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-fg-muted">构建提交</span>
            <span
              className="notranslate font-mono text-fg-default"
              translate="no"
              title={isRecorded ? gitSha : undefined}
              data-testid="version-info-sha"
            >
              {visibleSha}
            </span>
            {isRecorded && (
              <button type="button" className="pl-btn pl-btn--ghost text-sm" data-testid="version-info-copy" onClick={() => void copySha()}>
                复制
              </button>
            )}
            {isRecorded && data?.gitDirty === true && (
              <span className="text-warning-strong text-xs" data-testid="version-info-workspace">
                {workspace}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-baseline gap-3 text-xs text-fg-muted" data-testid="version-info-ktx">
            <span>
              随包 <span className="notranslate" translate="no">KTX</span> 版本
            </span>
            <span className="notranslate font-mono" translate="no">
              {ktxVersion}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
