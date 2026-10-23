import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost } from "../../lib/apiClient";
import { PageHeader } from "../../components/PageHeader";

type FieldQuestion = {
  id: string;
  summary: string;
  failure_class: string;
  hit_count: number;
  source_map_version: string;
  status: string;
};

type Draft = {
  question: string;
  executable?: { required_measures?: string[] };
};

export function FieldQuestions() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["eval", "field-questions"],
    queryFn: () => apiGet<{ questions: FieldQuestion[] }>("/api/eval/field-questions")
  });

  const promote = useMutation({
    mutationFn: (id: string) => apiPost<{ draft: Draft }>(`/api/eval/field-questions/${id}/promote`, {}),
    onSuccess: (result) => {
      setDraft(result.draft);
      toast.success("已生成草稿，问法留空，尚未写入用例");
    },
    onError: (error) => toast.error((error as Error).message)
  });

  const questions = data?.questions ?? [];

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="现场提问"
        description="从访问日志里反复出现、且不是权限拒绝的业务问法。收成用例前要补问法。"
        actions={
          <button
            type="button"
            className="pl-btn pl-btn--ghost text-sm"
            onClick={() => void qc.invalidateQueries({ queryKey: ["eval", "field-questions"] })}
          >
            刷新
          </button>
        }
      />
      {isLoading ? <div className="pl-notice">加载中…</div> : null}
      {!isLoading && questions.length === 0 ? <div className="pl-empty-state">暂无现场提问</div> : null}
      {questions.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-fg-muted">
              <th className="px-3 py-2">摘要</th>
              <th className="px-3 py-2">次数</th>
              <th className="px-3 py-2">语义版本</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {questions.map((item) => (
              <tr key={item.id} className="border-b border-border">
                <td className="px-3 py-2">{item.summary}</td>
                <td className="px-3 py-2">{item.hit_count}</td>
                <td className="px-3 py-2"><span translate="no">{item.source_map_version}</span></td>
                <td className="px-3 py-2 text-right">
                  <button type="button" className="pl-btn pl-btn--ghost text-sm" onClick={() => promote.mutate(item.id)}>
                    收成用例
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {draft && (
        <section className="pl-panel">
          <p className="pl-panel-title">草稿</p>
          <p className="text-sm">问法：{draft.question || "（空，保存前必须填写）"}</p>
          <p className="text-sm text-fg-muted">指标：{(draft.executable?.required_measures ?? []).join(", ") || "—"}</p>
        </section>
      )}
    </div>
  );
}
