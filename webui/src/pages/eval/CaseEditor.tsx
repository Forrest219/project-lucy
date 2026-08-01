import { useState, useEffect } from "react";
import { stringify as yamlStringify } from "yaml";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { apiGet, apiPut, apiPost } from "../../lib/apiClient";
import type { EvalCase, EvalDomainInfo } from "../../lib/types";
import { PageHeader } from "../../components/PageHeader";

type DomainsResponse = { domains: EvalDomainInfo[] };

function emptyCase(domain: string): EvalCase {
  return {
    id: "",
    case_type: "single_turn",
    question: "",
    domain,
    expected_source: "semantic_layer",
    expected_measures: [],
    sql_assertions: [],
    result_assertions: [{ value_type: "scalar", compare_mode: "approx", data: {}, numeric_tolerance: 0.0001, check_schema: true }],
    snapshot_date: new Date().toISOString().slice(0, 10),
    notes: ""
  };
}

export function CaseEditor() {
  const { domain = "", caseId } = useParams<{ domain: string; caseId?: string }>();
  const [searchParams] = useSearchParams();
  const copyFrom = searchParams.get("copyFrom") ?? "";
  const isNew = !caseId || caseId === "new";
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [form, setForm] = useState<EvalCase>(emptyCase(domain));
  const [diffPreview, setDiffPreview] = useState<{ diff: string; proposedYaml: string } | null>(null);
  const [activeTab, setActiveTab] = useState<"meta" | "question" | "sql" | "result" | "advanced" | "yaml" | "raw">("meta");
  const [rawText, setRawText] = useState("");
  const [rawError, setRawError] = useState<string | null>(null);

  const { data: caseData, isLoading } = useQuery({
    queryKey: ["eval", "case", domain, caseId],
    queryFn: () => apiGet<EvalCase>(`/api/eval/cases/${domain}/${caseId}`),
    enabled: !isNew && Boolean(domain) && Boolean(caseId)
  });

  const { data: copySource, isLoading: loadingCopySource } = useQuery({
    queryKey: ["eval", "case", domain, copyFrom],
    queryFn: () => apiGet<EvalCase>(`/api/eval/cases/${domain}/${copyFrom}`),
    enabled: isNew && Boolean(domain) && Boolean(copyFrom)
  });

  useEffect(() => {
    if (caseData) {
      setForm(caseData);
    }
  }, [caseData]);

  useEffect(() => {
    if (copySource) {
      setForm({
        ...copySource,
        id: `${copySource.id}-copy`,
        notes: copySource.notes ? `${copySource.notes}\nUAT copy test` : "UAT copy test"
      });
    }
  }, [copySource]);

  const saveMutation = useMutation({
    mutationFn: async (dryRun: boolean) => {
      if (isNew) {
        return apiPost<{ diff?: string; proposedYaml?: string; written?: boolean }>(
          `/api/eval/cases/${domain}`,
          { dryRun, case: form }
        );
      }
      return apiPut<{ diff?: string; proposedYaml?: string; written?: boolean }>(
        `/api/eval/cases/${domain}/${caseId}`,
        { dryRun, case: form }
      );
    },
    onSuccess: (data, dryRun) => {
      if (isNew) {
        if (dryRun) {
          const result = data as { diff?: string; proposedYaml?: string };
          setDiffPreview({ diff: result.diff ?? "", proposedYaml: result.proposedYaml ?? "" });
        } else {
          toast.success("Case 已创建");
          setDiffPreview(null);
          void qc.invalidateQueries({ queryKey: ["eval", "cases", domain] });
          navigate(`/eval/cases/${domain}`);
        }
        return;
      }
      if (dryRun) {
        const result = data as { diff?: string; proposedYaml?: string };
        setDiffPreview({ diff: result.diff ?? "", proposedYaml: result.proposedYaml ?? "" });
      } else {
        toast.success("Case 已保存");
        setDiffPreview(null);
        void qc.invalidateQueries({ queryKey: ["eval", "cases", domain] });
        void qc.invalidateQueries({ queryKey: ["eval", "case", domain, caseId] });
      }
    },
    onError: (err) => toast.error(`保存失败：${(err as Error).message}`)
  });

  const field = (key: keyof EvalCase) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
  };

  if ((!isNew && isLoading) || loadingCopySource) return <div className="pl-notice">加载中…</div>;

  const tabs = [
    { key: "meta", label: "元数据" },
    { key: "question", label: "问题 & 期望" },
    { key: "sql", label: "SQL 断言" },
    { key: "result", label: "结果断言" },
    { key: "advanced", label: "关联 & 上下文" },
    { key: "yaml", label: "YAML 预览" },
    { key: "raw", label: "Raw JSON" }
  ] as const;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={isNew ? "新建评测用例" : form.id}
        breadcrumbs={["质量评测", "评测用例", domain, isNew ? "新建" : form.id]}
        badges={
          <>
            <span>{domain}</span>
            <span>{form.case_type}</span>
          </>
        }
        actions={
          <>
            <button type="button" className="pl-btn pl-btn--ghost text-sm" onClick={() => navigate(`/eval/cases/${domain}`)}>
              ‹ 返回
            </button>
            {!isNew && (
              <button
                type="button"
                className="pl-btn pl-btn--ghost text-sm"
                onClick={() => navigate(`/eval/cases/${domain}/new?copyFrom=${encodeURIComponent(form.id)}`)}
                disabled={saveMutation.isPending}
              >
                复制
              </button>
            )}
            <button
              type="button"
              className="pl-btn pl-btn--ghost text-sm"
              onClick={() => saveMutation.mutate(true)}
              disabled={saveMutation.isPending}
            >
              预览 Diff
            </button>
            <button
              type="button"
              className="pl-btn pl-btn--primary text-sm"
              onClick={() => saveMutation.mutate(false)}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "保存中…" : "保存"}
            </button>
          </>
        }
      />

      {/* Diff preview */}
      {diffPreview && (
        <div className="border border-border rounded p-4 grid gap-3">
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm">变更预览</span>
            <div className="flex gap-2">
              <button
                type="button"
                className="pl-btn pl-btn--ghost text-sm"
                onClick={() => setDiffPreview(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="pl-btn pl-btn--primary text-sm"
                onClick={() => saveMutation.mutate(false)}
              >
                确认写入
              </button>
            </div>
          </div>
          <pre className="text-xs font-mono bg-bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap">
            {diffPreview.diff || "(无变更)"}
          </pre>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`px-4 py-2 text-sm ${activeTab === t.key ? "border-b-2 border-fg font-medium" : "text-fg-muted hover:text-fg"}`}
            onClick={() => {
              if (t.key === "raw") {
                setRawText(JSON.stringify(form, null, 2));
                setRawError(null);
              }
              setActiveTab(t.key);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4">
        {activeTab === "meta" && (
          <div className="grid gap-4 max-w-lg">
            <div className="grid gap-1">
              <label className="text-sm font-medium">Case ID {isNew && <span className="text-red-500">*</span>}</label>
              <input className="pl-input" value={form.id} onChange={field("id")} placeholder="superstore-discount-001" readOnly={!isNew} />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium">case_type</label>
              <select className="pl-input" value={form.case_type} onChange={field("case_type")}>
                <option value="single_turn">single_turn</option>
                <option value="multi_turn">multi_turn</option>
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium">domain (只读)</label>
              <input className="pl-input opacity-60" value={domain} readOnly />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium">skill_version</label>
              <input className="pl-input" value={form.skill_version ?? ""} onChange={field("skill_version")} placeholder="v1.0" />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium">semantic_version</label>
              <input className="pl-input" value={form.semantic_version ?? ""} onChange={field("semantic_version")} placeholder="v1.0" />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium">model_id</label>
              <input className="pl-input" value={form.model_id ?? ""} onChange={field("model_id")} placeholder="claude-sonnet-4-6" />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium">snapshot_date</label>
              <input className="pl-input" type="date" value={form.snapshot_date ?? ""} onChange={field("snapshot_date")} />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium">coverage</label>
              <select className="pl-input" value={form.coverage ?? ""} onChange={field("coverage")}>
                <option value="">— 未设置 —</option>
                <option value="basic">basic</option>
                <option value="anti_pattern">anti_pattern</option>
                <option value="edge">edge</option>
                <option value="fallback">fallback</option>
                <option value="multi_turn">multi_turn</option>
                <option value="path">path</option>
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium">notes</label>
              <textarea className="pl-input min-h-[80px]" value={form.notes ?? ""} onChange={field("notes")} />
            </div>
          </div>
        )}

        {activeTab === "question" && (
          <div className="grid gap-4 max-w-lg">
            <div className="grid gap-1">
              <label className="text-sm font-medium">question <span className="text-red-500">*</span></label>
              <textarea className="pl-input min-h-[80px]" value={form.question ?? ""} onChange={field("question")} />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium">expected_source</label>
              <select className="pl-input" value={form.expected_source ?? "semantic_layer"} onChange={field("expected_source")}>
                <option value="semantic_layer">semantic_layer</option>
                <option value="raw_sql_fallback">raw_sql_fallback</option>
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium">expected_measures（逗号分隔）</label>
              <input
                className="pl-input"
                value={(form.expected_measures ?? []).join(", ")}
                onChange={(e) => setForm((p) => ({ ...p, expected_measures: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }))}
                placeholder="weighted_discount, profit_margin"
              />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium">linked_quiz_questions（逗号分隔）</label>
              <input
                className="pl-input"
                value={(form.linked_quiz_questions ?? []).join(", ")}
                onChange={(e) => setForm((p) => ({
                  ...p,
                  linked_quiz_questions: e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                }))}
                placeholder="Q1, Q6"
              />
            </div>
          </div>
        )}

        {activeTab === "sql" && (
          <div className="grid gap-4">
            <p className="text-sm text-fg-muted">SQL 断言列表（type / value / reason）</p>
            {(form.sql_assertions ?? []).map((assertion, idx) => (
              <div key={idx} className="border border-border rounded p-4 grid gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">断言 #{idx + 1}</span>
                  <button
                    type="button"
                    className="pl-btn pl-btn--ghost text-xs text-red-500"
                    onClick={() => setForm((p) => ({ ...p, sql_assertions: (p.sql_assertions ?? []).filter((_, i) => i !== idx) }))}
                  >
                    删除
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1">
                    <label className="text-xs font-medium">type</label>
                    <select
                      className="pl-input text-sm"
                      value={assertion.type}
                      onChange={(e) => {
                        const updated = [...(form.sql_assertions ?? [])];
                        updated[idx] = { ...updated[idx], type: e.target.value as typeof assertion.type };
                        setForm((p) => ({ ...p, sql_assertions: updated }));
                      }}
                    >
                      <option value="measure_lineage">measure_lineage</option>
                      <option value="required_ast">required_ast</option>
                      <option value="forbidden_ast">forbidden_ast</option>
                      <option value="required_sql_pattern">required_sql_pattern</option>
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <label className="text-xs font-medium">normalize</label>
                    <input
                      type="checkbox"
                      className="mt-2"
                      checked={assertion.normalize ?? false}
                      onChange={(e) => {
                        const updated = [...(form.sql_assertions ?? [])];
                        updated[idx] = { ...updated[idx], normalize: e.target.checked };
                        setForm((p) => ({ ...p, sql_assertions: updated }));
                      }}
                    />
                  </div>
                </div>
                <div className="grid gap-1">
                  <label className="text-xs font-medium">value</label>
                  <input
                    className="pl-input text-sm font-mono"
                    value={assertion.value}
                    onChange={(e) => {
                      const updated = [...(form.sql_assertions ?? [])];
                      updated[idx] = { ...updated[idx], value: e.target.value };
                      setForm((p) => ({ ...p, sql_assertions: updated }));
                    }}
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-xs font-medium">reason</label>
                  <input
                    className="pl-input text-sm"
                    value={assertion.reason}
                    onChange={(e) => {
                      const updated = [...(form.sql_assertions ?? [])];
                      updated[idx] = { ...updated[idx], reason: e.target.value };
                      setForm((p) => ({ ...p, sql_assertions: updated }));
                    }}
                  />
                </div>
              </div>
            ))}
            <button
              type="button"
              className="pl-btn pl-btn--ghost text-sm"
              onClick={() => setForm((p) => ({
                ...p,
                sql_assertions: [...(p.sql_assertions ?? []), { type: "measure_lineage", value: "", normalize: true, reason: "" }]
              }))}
            >
              + 增加 SQL 断言
            </button>
          </div>
        )}

        {activeTab === "result" && (
          <div className="grid gap-4">
            <p className="text-sm text-fg-muted">结果断言列表</p>
            {(form.result_assertions ?? []).map((assertion, idx) => (
              <div key={idx} className="border border-border rounded p-4 grid gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">断言 #{idx + 1}</span>
                  <button
                    type="button"
                    className="pl-btn pl-btn--ghost text-xs text-red-500"
                    onClick={() => setForm((p) => ({ ...p, result_assertions: (p.result_assertions ?? []).filter((_, i) => i !== idx) }))}
                  >
                    删除
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1">
                    <label className="text-xs font-medium">value_type</label>
                    <select
                      className="pl-input text-sm"
                      value={assertion.value_type}
                      onChange={(e) => {
                        const updated = [...(form.result_assertions ?? [])];
                        updated[idx] = { ...updated[idx], value_type: e.target.value as typeof assertion.value_type };
                        setForm((p) => ({ ...p, result_assertions: updated }));
                      }}
                    >
                      <option value="scalar">scalar</option>
                      <option value="dataframe">dataframe</option>
                      <option value="text">text</option>
                      <option value="empty_result">empty_result</option>
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <label className="text-xs font-medium">compare_mode</label>
                    <select
                      className="pl-input text-sm"
                      value={assertion.compare_mode ?? "approx"}
                      onChange={(e) => {
                        const updated = [...(form.result_assertions ?? [])];
                        updated[idx] = { ...updated[idx], compare_mode: e.target.value };
                        setForm((p) => ({ ...p, result_assertions: updated }));
                      }}
                    >
                      <option value="exact">exact</option>
                      <option value="approx">approx</option>
                      <option value="schema_only">schema_only</option>
                      <option value="checksum">checksum</option>
                      <option value="subset">subset</option>
                      <option value="unordered_rows">unordered_rows</option>
                    </select>
                  </div>
                </div>
                {assertion.value_type !== "empty_result" && (
                  <div className="grid gap-1">
                    <label className="text-xs font-medium">data (JSON)</label>
                    <textarea
                      className="pl-input font-mono text-xs min-h-[80px]"
                      value={typeof assertion.data === "object" ? JSON.stringify(assertion.data, null, 2) : String(assertion.data ?? "")}
                      onChange={(e) => {
                        const updated = [...(form.result_assertions ?? [])];
                        try {
                          updated[idx] = { ...updated[idx], data: JSON.parse(e.target.value) };
                        } catch {
                          // keep raw string during editing
                        }
                        setForm((p) => ({ ...p, result_assertions: updated }));
                      }}
                    />
                  </div>
                )}
                {assertion.compare_mode === "approx" && (
                  <div className="grid gap-1">
                    <label className="text-xs font-medium">numeric_tolerance</label>
                    <input
                      className="pl-input text-sm"
                      type="number"
                      step="0.0001"
                      value={assertion.numeric_tolerance ?? 0.0001}
                      onChange={(e) => {
                        const updated = [...(form.result_assertions ?? [])];
                        updated[idx] = { ...updated[idx], numeric_tolerance: parseFloat(e.target.value) };
                        setForm((p) => ({ ...p, result_assertions: updated }));
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
            <button
              type="button"
              className="pl-btn pl-btn--ghost text-sm"
              onClick={() => setForm((p) => ({
                ...p,
                result_assertions: [
                  ...(p.result_assertions ?? []),
                  { value_type: "scalar", compare_mode: "approx", data: {}, numeric_tolerance: 0.0001, check_schema: true }
                ]
              }))}
            >
              + 增加结果断言
            </button>
          </div>
        )}

        {activeTab === "advanced" && (
          <div className="grid gap-4">
            <div className="grid gap-1">
              <label className="text-sm font-medium">turns (JSON)</label>
              <textarea
                className="pl-input font-mono text-xs min-h-[140px]"
                value={JSON.stringify(form.turns ?? [], null, 2)}
                onChange={(e) => {
                  try {
                    const turns = JSON.parse(e.target.value) as unknown[];
                    setForm((p) => ({ ...p, turns }));
                  } catch {
                    // keep last valid value
                  }
                }}
              />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium">context_assertions (JSON)</label>
              <textarea
                className="pl-input font-mono text-xs min-h-[120px]"
                value={JSON.stringify(form.context_assertions ?? {}, null, 2)}
                onChange={(e) => {
                  try {
                    const context_assertions = JSON.parse(e.target.value);
                    setForm((p) => ({ ...p, context_assertions }));
                  } catch {
                    // keep last valid value
                  }
                }}
              />
            </div>
          </div>
        )}

        {activeTab === "yaml" && (
          <div className="grid gap-2">
            <p className="text-sm text-fg-muted">当前表单对应的 YAML 序列化（预览，不可直接编辑）</p>
            <pre className="text-xs font-mono bg-bg-muted p-4 rounded overflow-x-auto whitespace-pre-wrap">
              {yamlStringify(form)}
            </pre>
          </div>
        )}

        {activeTab === "raw" && (
          <div className="grid gap-2">
            <p className="text-sm text-fg-muted">编辑完整 EvalCase JSON；用于保留或修改表单尚未建模的字段。</p>
            {rawError && <div className="text-sm text-red-500">{rawError}</div>}
            <textarea
              className="pl-input font-mono text-xs min-h-[420px]"
              value={rawText}
              onChange={(e) => {
                const next = e.target.value;
                setRawText(next);
                try {
                  const parsed = JSON.parse(next) as EvalCase;
                  setForm(parsed);
                  setRawError(null);
                } catch (error) {
                  setRawError((error as Error).message);
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
