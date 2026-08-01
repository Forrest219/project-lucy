import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import { toast } from "sonner";
import type { Join, JoinCandidate, JoinCandidatesResponse, SourceDetail } from "../lib/types";
import { PageHeader } from "../components/PageHeader";
import { RELATIONSHIP_LABELS, suggestedJoins } from "./semantic/join-utils";

export function JoinEditor() {
  const params = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const conn = params.conn ?? "";
  const schema = params.schema ?? "";
  const table = params.table ?? "";
  const sourceQuery = useQuery({
    queryKey: queryKeys.source(conn, schema, table),
    queryFn: () => apiGet<SourceDetail>(`/api/sources/${encodeURIComponent(conn)}/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`),
    enabled: Boolean(conn && schema && table)
  });
  const candidatesQuery = useQuery({
    queryKey: queryKeys.joinCandidates,
    queryFn: () => apiGet<JoinCandidatesResponse>("/api/joins/candidates")
  });
  const candidates = candidatesQuery.data?.candidates ?? [];
  const tableCandidates = candidates.filter((item) => item.conn === conn && item.schema === schema && item.fromTable === table);
  const suggestions = useMemo(() => suggestedJoins(sourceQuery.data), [sourceQuery.data]);
  const writeCandidates = useMutation({
    mutationFn: (next: JoinCandidate[]) => apiPut<JoinCandidatesResponse>("/api/joins/candidates", { candidates: next }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.joinCandidates });
      toast.success("候选已保存");
    },
    onError: (error) => {
      toast.error(`保存候选失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  });
  const confirmJoin = useMutation({
    mutationFn: (join: Join) =>
      apiPut(`/api/sources/${encodeURIComponent(conn)}/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`, {
        dryRun: false,
        patch: {
          joins: [...(sourceQuery.data?.model.joins ?? []), { ...join, source: "formal" }]
        }
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.source(conn, schema, table) });
      toast.success("已写入语义层");
      navigate("/review");
    },
    onError: (error) => {
      toast.error(`确认失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  });

  function upsertCandidate(candidate: JoinCandidate) {
    const remaining = candidates.filter(
      (item) =>
        !(
          item.conn === candidate.conn &&
          item.schema === candidate.schema &&
          item.fromTable === candidate.fromTable &&
          item.join.to === candidate.join.to &&
          item.join.on === candidate.join.on
        )
    );
    writeCandidates.mutate([...remaining, candidate]);
  }

  return (
    <div className="pl-page-stack">
      <PageHeader
        title={`维护关联关系：${table}`}
        breadcrumbs={["语义建模", "关联关系", table]}
        description="候选关系先保存在 .ktx-ui sidecar，只有确认后的正式关系才写入 semantic-layer。"
        badges={
          <>
            <span>{conn}</span>
            <span>{schema}</span>
          </>
        }
        actions={
          <Link className="pl-btn pl-btn--ghost" to={`/sources/${encodeURIComponent(conn)}/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`}>
            返回表编辑
          </Link>
        }
      />

      <div className="grid gap-4">
        <section className="pl-panel">
          <p className="pl-panel-title">已确认关系</p>
          <div className="grid gap-2">
            {(sourceQuery.data?.model.joins ?? []).map((join) => (
              <div className="pl-join-row" key={`${join.to}-${join.on}`}>
                <strong>{join.to}</strong>
                <span>{join.on}</span>
                <span>{RELATIONSHIP_LABELS[join.relationship]}</span>
                <span />
              </div>
            ))}
          </div>
        </section>

        <section className="pl-panel">
          <p className="pl-panel-title">候选关系</p>
          <div className="grid gap-2">
            {[...tableCandidates, ...suggestions].map((candidate) => (
              <div className="pl-join-row" key={`${candidate.join.to}-${candidate.join.on}-${candidate.note}`}>
                <strong>{candidate.join.to}</strong>
                <span>{candidate.join.on}</span>
                <span>{RELATIONSHIP_LABELS[candidate.join.relationship]}</span>
                <div className="flex items-center gap-2 justify-end">
                  <button type="button" className="pl-btn pl-btn--ghost" onClick={() => upsertCandidate({ ...candidate, confidence: "candidate", join: { ...candidate.join, source: "candidate" } })}>
                    保留为候选
                  </button>
                  <button type="button" className="pl-btn pl-btn--ghost" onClick={() => upsertCandidate({ ...candidate, confidence: "rejected", join: { ...candidate.join, source: "candidate" } })}>
                    标记为不采用
                  </button>
                  <button type="button" className="pl-btn pl-btn--primary" onClick={() => confirmJoin.mutate(candidate.join)} disabled={confirmJoin.isPending}>
                    确认写入语义层
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
