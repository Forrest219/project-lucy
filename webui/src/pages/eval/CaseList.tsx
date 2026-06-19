import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { apiGet, apiDelete } from "../../lib/apiClient";
import type { EvalDomainInfo, EvalCase } from "../../lib/types";

type DomainsResponse = { domains: EvalDomainInfo[] };
type CasesResponse = { cases: EvalCase[] };

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

  const [search, setSearch] = useState("");
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

  if (loadingDomains) return <div className="pl-notice">加载中…</div>;

  if (domains.length === 0) {
    return (
      <div className="grid gap-6">
        <h1 className="text-xl font-semibold">Case 管理</h1>
        <div className="pl-notice">未找到 eval domain，请确认 evals/ 目录下有对应的 cases yaml 文件。</div>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Case 管理</h1>
          <p className="text-sm text-fg-muted mt-1">管理各 domain 的 eval case 定义（YAML 源文件）。</p>
        </div>
        <button
          type="button"
          className="pl-btn pl-btn--primary text-sm"
          onClick={() => navigate(`/eval/cases/${activeDomain}/new`)}
          disabled={!activeDomain}
        >
          新建 Case
        </button>
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
      <input
        className="pl-input w-72"
        placeholder="搜索 case id 或问题…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

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
                <th className="px-3 py-2">覆盖维度</th>
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredCases.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-fg-muted">暂无 Case</td>
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
                    <td className="px-3 py-2 text-xs text-fg-muted">{c.coverage ?? "—"}</td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
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
