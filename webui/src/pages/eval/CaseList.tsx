import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ApiError, apiGet, apiDelete, apiPost } from "../../lib/apiClient";
import type { EvalDomainInfo, EvalCase, EvalRun, EvalRunWithResults } from "../../lib/types";
import { PageHeader } from "../../components/PageHeader";

type DomainsResponse = { domains: EvalDomainInfo[] };
type CasesResponse = { cases: EvalCase[] };
type RunsResponse = { total: number; runs: EvalRun[] };
type SuiteImportResponse = {
  domain: string;
  suiteId: string;
  suiteHash: string;
  caseCount: number;
  format: string;
  warnings: string[];
  errors: unknown[];
  diff: string;
  proposedYaml: string;
  written?: true;
};
type ResultImportResponse = {
  runId?: number;
  domain: string;
  suiteId: string;
  suiteHash: string;
  currentSuiteHash: string;
  totalCases: number;
  passCount: number;
  failCount: number;
  skippedCount: number;
  errorCount: number;
  suiteHashMatched: boolean;
  hashStatus: "matched" | "mismatch";
  warnings: string[];
  written?: true;
};

function runnerCommandFor(domain: string): string {
  return `node scripts/lucy-eval-runner.mjs --suite ${domain || "eval"}-eval-suite.yaml --output result.json`;
}

function filenameFromContentDisposition(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1].replace(/^"|"$/g, ""));
  const plainMatch = value.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] ?? fallback;
}

function triggerFileDownload(href: string, filename: string): void {
  if (typeof document === "undefined") {
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function errorDetail(err: unknown): string {
  if (err instanceof ApiError && err.detail && typeof err.detail === "object" && "errors" in err.detail) {
    const errors = (err.detail as { errors?: Array<{ path?: string; message?: string }> }).errors ?? [];
    return errors.map((e) => `${e.path ?? ""} ${e.message ?? ""}`.trim()).filter(Boolean).join("\n");
  }
  return err instanceof Error ? err.message : String(err);
}

export function CaseList() {
  const { domain: paramDomain } = useParams<{ domain?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: domainsData, isLoading: loadingDomains } = useQuery({
    queryKey: ["eval", "domains"],
    queryFn: () => apiGet<DomainsResponse>("/api/eval/domains")
  });

  const domains = domainsData?.domains ?? [];
  const activeDomain = paramDomain ?? domains[0]?.domain ?? "";

  const { data: casesData, isLoading: loadingCases } = useQuery({
    queryKey: ["eval", "cases", activeDomain],
    queryFn: () => apiGet<CasesResponse>(`/api/eval/cases/${activeDomain}`),
    enabled: Boolean(activeDomain)
  });

  const cases = casesData?.cases ?? [];

  const { data: latestRunsData } = useQuery({
    queryKey: ["eval", "runs", activeDomain, "latest"],
    queryFn: () => apiGet<RunsResponse>(`/api/eval/runs?domain=${activeDomain}&limit=1`),
    enabled: Boolean(activeDomain)
  });

  const latestRun = latestRunsData?.runs[0];

  const { data: latestRunDetail } = useQuery({
    queryKey: ["eval", "run", latestRun?.id],
    queryFn: () => apiGet<EvalRunWithResults>(`/api/eval/runs/${latestRun?.id}`),
    enabled: Boolean(latestRun?.id)
  });

  const latestStatusByCase = new Map((latestRunDetail?.results ?? []).map((r) => [r.caseId, r.status]));

  const [search, setSearch] = useState("");
  const [suiteMenuOpen, setSuiteMenuOpen] = useState(false);
  const [suitePanel, setSuitePanel] = useState<"import" | "result" | "command" | null>(null);
  const [suiteYaml, setSuiteYaml] = useState("");
  const [resultJson, setResultJson] = useState("");
  const [suitePreview, setSuitePreview] = useState<SuiteImportResponse | null>(null);
  const [resultPreview, setResultPreview] = useState<ResultImportResponse | null>(null);
  const [downloadedYaml, setDownloadedYaml] = useState("");
  const [runnerCommand, setRunnerCommand] = useState("");
  const [resultActionHint, setResultActionHint] = useState<"sync-suite" | null>(null);
  const filteredCases = search
    ? cases.filter((c) => c.id.includes(search) || (c.question ?? "").includes(search))
    : cases;

  const deleteMutation = useMutation({
    mutationFn: (caseId: string) => apiDelete<unknown>(`/api/eval/cases/${activeDomain}/${caseId}`),
    onSuccess: (_, caseId) => {
      toast.success(`Case ${caseId} 已删除`);
      void qc.invalidateQueries({ queryKey: ["eval", "cases", activeDomain] });
    },
    onError: (err) => toast.error(`删除失败：${(err as Error).message}`)
  });

  const suiteImportMutation = useMutation({
    mutationFn: (dryRun: boolean) => apiPost<SuiteImportResponse>("/api/eval/suites/import", {
      dryRun,
      filename: `${activeDomain || "eval"}-eval-suite.yaml`,
      content: suiteYaml
    }),
    onSuccess: (data, dryRun) => {
      setSuitePreview(data);
      if (dryRun) {
        toast.success(`Eval YAML 预检通过：${data.caseCount} 个 case`);
      } else {
        toast.success("Eval YAML 已导入");
        void qc.invalidateQueries({ queryKey: ["eval", "domains"] });
        void qc.invalidateQueries({ queryKey: ["eval", "cases", data.domain] });
        if (resultActionHint === "sync-suite") {
          setResultActionHint(null);
          setResultPreview(null);
          setSuitePanel("result");
          toast.success("Eval YAML 已同步，请重新预检运行结果");
        }
      }
    },
    onError: (err) => toast.error(`Eval YAML 导入失败：${errorDetail(err)}`)
  });

  const resultImportMutation = useMutation({
    mutationFn: (options: { dryRun: boolean; archiveLocalVariant?: boolean }) => apiPost<ResultImportResponse>("/api/eval/results/import", {
      dryRun: options.dryRun,
      archiveLocalVariant: options.archiveLocalVariant,
      content: resultJson
    }),
    onSuccess: (data, options) => {
      setResultPreview(data);
      if (options.dryRun) {
        toast.success(data.hashStatus === "mismatch" ? "运行结果可作为本地变体归档" : "运行结果预检通过");
      } else {
        toast.success("运行结果已归档");
        setResultActionHint(null);
        void qc.invalidateQueries({ queryKey: ["eval", "runs"] });
        if (data.runId) navigate(`/eval/runs/${data.runId}`);
      }
    },
    onError: (err) => toast.error(`运行结果导入失败：${errorDetail(err)}`)
  });

  async function downloadSuite() {
    if (!activeDomain) return;
    const downloadHref = `/api/eval/suites/${encodeURIComponent(activeDomain)}/download`;
    const response = await fetch(downloadHref);
    if (!response.ok) {
      toast.error("下载 Eval YAML 失败");
      return;
    }
    const text = await response.text();
    const command = response.headers.get("X-Lucy-Runner-Command") ?? runnerCommandFor(activeDomain);
    const filename = filenameFromContentDisposition(
      response.headers.get("Content-Disposition"),
      `${activeDomain}-eval-suite.yaml`
    );
    triggerFileDownload(downloadHref, filename);
    setDownloadedYaml(text);
    setRunnerCommand(command);
    setSuitePanel("command");
    toast.success("Eval YAML 已准备，可在本地 runner 中运行");
  }

  if (loadingDomains) return <div className="pl-notice">加载中…</div>;

  if (domains.length === 0) {
    return (
      <div className="grid gap-6">
        <PageHeader
          title="评测用例"
          description="管理各 domain 的 eval case 定义（YAML 源文件）。"
        />
        <div className="pl-notice">未找到 eval domain，请确认 evals/ 目录下有对应的 cases yaml 文件。</div>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="评测用例"
        description="管理各 domain 的 eval case 定义（YAML 源文件）。"
        badges={
          <>
            <span>{cases.length} 个 case</span>
            <span data-testid="case-list-coverage">
              {latestRun ? `最近一次 Run #${latestRun.id} 通过率 ${Math.round((latestRun.passRate ?? 0) * 100)}%` : "尚未运行"}
            </span>
          </>
        }
        actions={
          <div className="relative flex gap-2">
            <button
              type="button"
              className="pl-btn pl-btn--primary text-sm"
              onClick={() => void downloadSuite()}
              disabled={!activeDomain}
            >
              下载 <span className="notranslate" translate="no">Eval YAML</span>
            </button>
            <button
              type="button"
              className="pl-btn pl-btn--ghost text-sm"
              aria-expanded={suiteMenuOpen}
              onClick={() => setSuiteMenuOpen((v) => !v)}
            >
              评测套件 <span className="notranslate" translate="no">(YAML)</span> ▾
            </button>
            {suiteMenuOpen && (
              <div className="absolute right-0 top-10 z-10 min-w-56 rounded border border-border bg-bg p-2 shadow-lg grid gap-1">
                <button type="button" className="pl-btn pl-btn--ghost text-sm justify-start" onClick={() => { setSuitePanel("import"); setSuiteMenuOpen(false); }}>
                  上传 <span className="notranslate" translate="no">Eval YAML</span>
                </button>
                <button type="button" className="pl-btn pl-btn--ghost text-sm justify-start" onClick={() => { setSuiteMenuOpen(false); void downloadSuite(); }}>
                  下载 <span className="notranslate" translate="no">Eval YAML</span>
                </button>
                <button type="button" className="pl-btn pl-btn--ghost text-sm justify-start" onClick={() => { setRunnerCommand(runnerCommandFor(activeDomain)); setSuitePanel("command"); setSuiteMenuOpen(false); }}>
                  查看本地运行命令
                </button>
                <button type="button" className="pl-btn pl-btn--ghost text-sm justify-start" onClick={() => { setSuitePanel("result"); setSuiteMenuOpen(false); }}>
                  上传运行结果
                </button>
              </div>
            )}
          </div>
        }
      />

      <div className="pl-notice">
        当前服务器未配置 <span className="notranslate" translate="no">Agent runtime</span> 时，仍可下载 <span className="notranslate" translate="no">Eval YAML</span>，在本机 <span className="notranslate" translate="no">Claude Code</span> 或 <span className="notranslate" translate="no">Hermes</span> 中运行；结果可选择上传归档。
      </div>

      {suitePanel === "command" && (
        <div className="border border-border rounded p-4 grid gap-3">
          <div className="flex justify-between gap-3">
            <h2 className="font-medium">本地运行命令</h2>
            <button type="button" className="pl-btn pl-btn--ghost text-xs" onClick={() => setSuitePanel(null)}>关闭</button>
          </div>
          <code className="notranslate block rounded bg-bg-muted p-3 text-xs overflow-x-auto" translate="no">{runnerCommand || runnerCommandFor(activeDomain)}</code>
          {downloadedYaml && (
            <textarea className="pl-input min-h-40 font-mono text-xs notranslate" translate="no" readOnly value={downloadedYaml} />
          )}
        </div>
      )}

      {suitePanel === "import" && (
        <div className="border border-border rounded p-4 grid gap-3">
          <div className="flex justify-between gap-3">
            <h2 className="font-medium">上传 <span className="notranslate" translate="no">Eval YAML</span></h2>
            <button type="button" className="pl-btn pl-btn--ghost text-xs" onClick={() => setSuitePanel(null)}>关闭</button>
          </div>
          <textarea
            className="pl-input min-h-52 font-mono text-xs notranslate"
            translate="no"
            placeholder="粘贴 Eval YAML 内容..."
            value={suiteYaml}
            onChange={(e) => setSuiteYaml(e.target.value)}
          />
          {resultActionHint === "sync-suite" && (
            <div className="pl-notice text-xs">
              正在同步本地 <span className="notranslate" translate="no">Eval YAML</span>：确认导入后会回到上传运行结果，请重新预检并归档。
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <button type="button" className="pl-btn pl-btn--ghost text-sm" disabled={!suiteYaml || suiteImportMutation.isPending} onClick={() => suiteImportMutation.mutate(true)}>预检</button>
            <button type="button" className="pl-btn pl-btn--primary text-sm" disabled={!suiteYaml || suiteImportMutation.isPending} onClick={() => suiteImportMutation.mutate(false)}>确认导入</button>
          </div>
          {suitePreview && (
            <div className="pl-notice text-xs">
              <span className="notranslate" translate="no">{suitePreview.suiteId}</span> · {suitePreview.caseCount} 个 case · <span className="notranslate" translate="no">{suitePreview.suiteHash}</span>
            </div>
          )}
        </div>
      )}

      {suitePanel === "result" && (
        <div className="border border-border rounded p-4 grid gap-3">
          <div className="flex justify-between gap-3">
            <h2 className="font-medium">上传运行结果</h2>
            <button type="button" className="pl-btn pl-btn--ghost text-xs" onClick={() => setSuitePanel(null)}>关闭</button>
          </div>
          <textarea
            className="pl-input min-h-52 font-mono text-xs notranslate"
            translate="no"
            placeholder="粘贴 Result JSON 内容..."
            value={resultJson}
            onChange={(e) => setResultJson(e.target.value)}
          />
          <div className="flex gap-2 justify-end">
            <button type="button" className="pl-btn pl-btn--ghost text-sm" disabled={!resultJson || resultImportMutation.isPending} onClick={() => resultImportMutation.mutate({ dryRun: true })}>预检</button>
            {resultPreview?.hashStatus !== "mismatch" && (
              <button type="button" className="pl-btn pl-btn--primary text-sm" disabled={!resultJson || resultImportMutation.isPending} onClick={() => resultImportMutation.mutate({ dryRun: false })}>
                确认归档
              </button>
            )}
          </div>
          {resultPreview && (
            resultPreview.hashStatus === "mismatch" ? (
              <div className="pl-notice text-xs grid gap-3">
                <div>Hash 不匹配 · 可作为本地变体归档，默认不进入趋势和质量门禁 · PASS {resultPreview.passCount} / FAIL {resultPreview.failCount} / SKIP {resultPreview.skippedCount}</div>
                <div className="flex flex-wrap gap-2 justify-end">
                  <button
                    type="button"
                    className="pl-btn pl-btn--ghost text-xs"
                    disabled={resultImportMutation.isPending}
                    onClick={() => {
                      setResultJson("");
                      setResultPreview(null);
                      setResultActionHint(null);
                      setSuitePanel(null);
                    }}
                  >
                    取消导入
                  </button>
                  <button
                    type="button"
                    className="pl-btn pl-btn--ghost text-xs"
                    disabled={resultImportMutation.isPending}
                    onClick={() => {
                      setResultActionHint("sync-suite");
                      setSuitePanel("import");
                    }}
                  >
                    同步本地 <span className="notranslate" translate="no">Eval YAML</span> 后归档
                  </button>
                  <button
                    type="button"
                    className="pl-btn pl-btn--primary text-xs"
                    disabled={resultImportMutation.isPending}
                    onClick={() => resultImportMutation.mutate({ dryRun: false, archiveLocalVariant: true })}
                  >
                    归档为本地变体
                  </button>
                </div>
              </div>
            ) : (
              <div className="pl-notice text-xs">
                Hash 匹配 · PASS {resultPreview.passCount} / FAIL {resultPreview.failCount} / SKIP {resultPreview.skippedCount}
              </div>
            )
          )}
        </div>
      )}

      <div
        className="pl-metric-grid pl-metric-grid--three"
        data-testid="case-list-coverage-card"
      >
        <div className="pl-metric-card">
          <span>Case 总数</span>
          <strong>{cases.length}</strong>
          <small>{activeDomain} domain</small>
        </div>
        <div className="pl-metric-card">
          <span>最近 Run 通过率</span>
          <strong>
            {latestRun ? `${Math.round((latestRun.passRate ?? 0) * 100)}%` : "—"}
          </strong>
          <small>
            {latestRun
              ? `${latestRun.passCount}/${latestRun.totalCases}`
              : "运行后才会出现"}
          </small>
        </div>
        <div className="pl-metric-card">
          <span>最近 Run 失败数</span>
          <strong>{latestRun?.failCount ?? 0}</strong>
          <small>
            {latestRun
              ? `Run #${latestRun.id} · ${new Date(latestRun.startedAt).toLocaleString("zh-CN")}`
              : "等待首次运行"}
          </small>
        </div>
      </div>

      {/* Domain tabs */}
      <div className="flex gap-2 flex-wrap">
        {domains.map((d) => (
          <button
            key={d.domain}
            type="button"
            className={`pl-btn text-sm ${d.domain === activeDomain ? "pl-btn--primary" : "pl-btn--ghost"}`}
            onClick={() => navigate(`/eval/cases/${d.domain}`)}
          >
            {d.domain}
            <span className="ml-1 text-xs opacity-70">({d.caseCount})</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex gap-2 flex-wrap items-center">
        <input
          className="pl-input w-72"
          placeholder="搜索 case id 或问题…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          className="pl-btn pl-btn--ghost text-sm"
          onClick={() => navigate(`/eval/cases/${activeDomain}/new`)}
          disabled={!activeDomain}
        >
          新建 Case
        </button>
      </div>

      {/* Table */}
      {loadingCases ? (
        <div className="pl-notice">加载中…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-fg-muted">
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">类型</th>
                <th className="px-3 py-2">问题</th>
                <th className="px-3 py-2">指标</th>
                <th className="px-3 py-2">关联 Quiz</th>
                <th className="px-3 py-2">最近运行</th>
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredCases.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-fg-muted">暂无 Case</td>
                </tr>
              ) : (
                filteredCases.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-border hover:bg-bg-muted/50 cursor-pointer"
                    onClick={() => navigate(`/eval/cases/${activeDomain}/${c.id}`)}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{c.id}</td>
                    <td className="px-3 py-2 text-xs text-fg-muted">{c.case_type}</td>
                    <td className="px-3 py-2 max-w-xs truncate text-fg-muted">{c.question ?? "(multi_turn)"}</td>
                    <td className="px-3 py-2 text-xs text-fg-muted">{c.expected_measures?.join(", ") ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-fg-muted">{c.linked_quiz_questions?.join(", ") ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {latestStatusByCase.get(c.id) ? (
                        <span className={`pl-status-badge ${latestStatusByCase.get(c.id) === "PASS" ? "pl-status-done" : "pl-status-validation_failed"}`}>
                          {latestStatusByCase.get(c.id)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="pl-btn pl-btn--ghost text-xs mr-2"
                        onClick={() => navigate(`/eval/cases/${activeDomain}/new?copyFrom=${encodeURIComponent(c.id)}`)}
                      >
                        复制
                      </button>
                      <button
                        type="button"
                        className="pl-btn pl-btn--ghost text-xs text-red-500"
                        onClick={() => {
                          if (confirm(`确认删除 ${c.id}？`)) {
                            deleteMutation.mutate(c.id);
                          }
                        }}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="text-xs text-fg-muted mt-2 px-3">共 {filteredCases.length} 个 case</div>
        </div>
      )}
    </div>
  );
}
