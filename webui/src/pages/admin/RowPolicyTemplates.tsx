/**
 * Lucy v0.25 P1 — L25-14 R1: 行策略模板管理页.
 *
 * Authority: docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md
 *   §4（管理 API 与写入合同）, §6.1（模板管理与角色引用）; RTP-05 … RTP-09.
 *
 * The page is a TWO-STEP write surface on purpose (P1-1 §6.1): 新建 / 修改 /
 * 删除 always dry-run first, show the impact (affected tables, Agents, policy
 * summary change, audit state), and only then allow the formal save. The formal
 * save reports success ONLY when the runtime confirmed the new policy
 * (`runtimeAck === true`) — a write that was written but not confirmed is not a
 * success.
 *
 * This page owns the TEMPLATE side of R1. Binding a template to a Role
 * selector happens in the Role editor; the picker that shows every candidate
 * (including the ones that cannot be bound) lives in
 * `components/admin/RowPolicyTemplatePicker.tsx`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "../../components/PageHeader";
import { apiDelete, apiGet, apiPatch, apiPost } from "../../lib/apiClient";
import {
  RowPolicyTemplateDetail,
  RowPolicyTemplateImpactPanel,
  RowPolicyTemplateTable,
  type RowPolicyTemplateListResponse,
  type RowPolicyTemplatePredicate,
  type RowPolicyTemplateWriteResponse
} from "../../components/admin/RowPolicyTemplatePanel";
import { RowPolicySnapshotBadge } from "../../components/admin/RowPolicyStateBadge";

type DraftPredicate = {
  field: string;
  op: "eq" | "in";
  value: string;
};

const TEMPLATE_QUERY_KEY = ["admin", "row-policy", "templates"] as const;

function emptyDraft(): DraftPredicate[] {
  return [{ field: "", op: "eq", value: "" }];
}

function toApiPredicates(draft: DraftPredicate[]): RowPolicyTemplatePredicate[] {
  return draft
    .filter((row) => row.field.trim())
    .map((row) =>
      row.op === "eq"
        ? { field: row.field.trim(), op: "eq" as const, value: row.value.trim() }
        : {
            field: row.field.trim(),
            op: "in" as const,
            values: row.value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
          }
    );
}

export function RowPolicyTemplates() {
  const queryClient = useQueryClient();
  const [selectedName, setSelectedName] = useState<string | undefined>();
  const [editingName, setEditingName] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<DraftPredicate[]>(emptyDraft());
  const [preview, setPreview] = useState<RowPolicyTemplateWriteResponse | undefined>();
  /** Which action the current preview belongs to. A preview of one action must not enable the other. */
  const [pendingAction, setPendingAction] = useState<"save" | "delete" | null>(null);
  /**
   * Which template the current DELETE preview belongs to. Without it, 「预演删除 A →
   * 选中 B → 正式删除」会把删除请求指向 B（P2-8）。
   */
  const [deletePreviewName, setDeletePreviewName] = useState<string | undefined>();
  const [auditState, setAuditState] = useState("未预演");
  /**
   * 草稿修订号：草稿每改一次 +1。预演在飞行中时若草稿又变了，那份预演描述的是**旧**
   * 草稿，不能拿来解锁「正式保存」（P2-7）。
   */
  const draftRevision = useRef(0);

  const templatesQuery = useQuery({
    queryKey: TEMPLATE_QUERY_KEY,
    queryFn: () => apiGet<RowPolicyTemplateListResponse>("/api/admin/row-policy/templates")
  });

  const templates = templatesQuery.data?.templates ?? [];
  const selected = useMemo(
    () => templates.find((template) => template.name === selectedName),
    [templates, selectedName]
  );

  /**
   * 草稿任一字段变更 → 旧预演结果、待办动作与审计状态全部作废。
   *
   * 否则影响面板仍显示**旧候选**的影响面、「正式保存」仍可点，操作员读到的是错的
   * 影响面（P1-1 §6.1 / RTP-06）。服务端会用 `NEW_PREVIEW_REQUIRED` 拒绝陈旧摘要，
   * 不会写坏数据，但前端不能把「会被拒绝」当「可以保存」。
   */
  function invalidatePreview(): void {
    draftRevision.current += 1;
    setPreview(undefined);
    setPendingAction(null);
    setAuditState("未预演");
  }

  function changeName(value: string): void {
    setName(value);
    invalidatePreview();
  }

  function changeDescription(value: string): void {
    setDescription(value);
    invalidatePreview();
  }

  function changePredicate(
    index: number,
    patch: Partial<Pick<DraftPredicate, "field" | "op" | "value">>
  ): void {
    setDraft((current) =>
      current.map((item, position) => (position === index ? { ...item, ...patch } : item))
    );
    invalidatePreview();
  }

  function addPredicate(): void {
    setDraft((current) => [...current, { field: "", op: "eq", value: "" }]);
    invalidatePreview();
  }

  function resetDraft(): void {
    draftRevision.current += 1;
    setEditingName(undefined);
    setName("");
    setDescription("");
    setDraft(emptyDraft());
    setPreview(undefined);
    setPendingAction(null);
    setDeletePreviewName(undefined);
    setAuditState("未预演");
  }

  function startEdit(templateName: string): void {
    const template = templates.find((item) => item.name === templateName);
    if (!template) return;
    draftRevision.current += 1;
    setEditingName(template.name);
    setName(template.name);
    setDescription(template.description ?? "");
    setDraft(
      template.predicates.map((predicate) => ({
        field: predicate.field,
        op: predicate.op,
        value:
          predicate.op === "eq"
            ? String(predicate.value ?? "")
            : (predicate.values ?? []).map((item) => String(item)).join(",")
      }))
    );
    setPreview(undefined);
    setPendingAction(null);
    setDeletePreviewName(undefined);
    setAuditState("未预演");
  }

  const dryRun = useMutation({
    mutationFn: async () => {
      const revision = draftRevision.current;
      const body = {
        name: name.trim(),
        description: description.trim() || undefined,
        predicates: toApiPredicates(draft)
      };
      const response = editingName
        ? await apiPatch<RowPolicyTemplateWriteResponse>(
            `/api/admin/row-policy/templates/${encodeURIComponent(editingName)}`,
            body
          )
        : await apiPost<RowPolicyTemplateWriteResponse>("/api/admin/row-policy/templates", body);
      return { response, revision };
    },
    onSuccess: ({ response, revision }) => {
      if (revision !== draftRevision.current) {
        // 预演在飞行中草稿又变了：这份影响面描述的是旧草稿，不能解锁正式保存。
        setAuditState("预演期间草稿已变更，请重新预演");
        return;
      }
      setPreview(response);
      setPendingAction("save");
      // A save preview never authorizes a delete.
      setDeletePreviewName(undefined);
      setAuditState(response.dryRun ? "预演完成，待保存" : "已保存");
    },
    onError: (error: Error) => {
      setAuditState("预演失败");
      toast.error(error.message);
    }
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("没有可提交的预演结果");
      const body = {
        dryRun: false,
        version: preview.version,
        candidateDigest: preview.candidateDigest,
        name: name.trim(),
        description: description.trim() || undefined,
        predicates: toApiPredicates(draft)
      };
      if (editingName) {
        return apiPatch<RowPolicyTemplateWriteResponse>(
          `/api/admin/row-policy/templates/${encodeURIComponent(editingName)}`,
          body
        );
      }
      return apiPost<RowPolicyTemplateWriteResponse>("/api/admin/row-policy/templates", body);
    },
    onSuccess: (data) => {
      setPreview(data);
      // A written-but-unconfirmed policy is NOT a success.
      if (data.runtimeAck) {
        setAuditState("已保存，运行态已确认");
        toast.success("行策略模板已保存");
      } else {
        setAuditState("已写入，运行态未确认");
        toast.error("模板已写入但运行态未确认，请检查运行态状态");
      }
      void queryClient.invalidateQueries({ queryKey: TEMPLATE_QUERY_KEY });
    },
    onError: (error: Error) => {
      setAuditState("保存失败");
      toast.error(error.message);
    }
  });

  const remove = useMutation({
    mutationFn: async (templateName: string) => {
      const body = {
        dryRun: false,
        version: preview?.version,
        candidateDigest: preview?.candidateDigest
      };
      return apiDelete<RowPolicyTemplateWriteResponse>(
        `/api/admin/row-policy/templates/${encodeURIComponent(templateName)}`,
        body
      );
    },
    onSuccess: (data) => {
      setPreview(data);
      setPendingAction(null);
      setDeletePreviewName(undefined);
      setAuditState(data.runtimeAck ? "已删除，运行态已确认" : "已写入，运行态未确认");
      void queryClient.invalidateQueries({ queryKey: TEMPLATE_QUERY_KEY });
      resetDraft();
    },
    onError: (error: Error) => {
      setAuditState("删除失败");
      toast.error(error.message);
    }
  });

  const deleteDryRun = useMutation({
    mutationFn: async (templateName: string) => {
      const revision = draftRevision.current;
      const response = await apiDelete<RowPolicyTemplateWriteResponse>(
        `/api/admin/row-policy/templates/${encodeURIComponent(templateName)}`,
        { dryRun: true }
      );
      return { response, revision, templateName };
    },
    onSuccess: ({ response, revision, templateName }) => {
      if (revision !== draftRevision.current) {
        setAuditState("预演期间草稿已变更，请重新预演");
        return;
      }
      setPreview(response);
      setPendingAction("delete");
      // 记住这次预演针对的是哪个模板：删除确认必须针对**同一个**模板。
      setDeletePreviewName(templateName);
      setAuditState(
        response.blockingReferences.length > 0 ? "存在引用，禁止删除" : "预演完成，待删除"
      );
    },
    onError: (error: Error) => {
      setAuditState("预演失败");
      toast.error(error.message);
    }
  });

  /** 删除预演针对的模板与当前选中项不一致 → 删除按钮必须禁用。 */
  const deleteTargetMismatch =
    pendingAction === "delete" && deletePreviewName !== undefined && deletePreviewName !== selectedName;

  return (
    <div className="grid gap-4 p-4" data-testid="row-policy-templates-page">
      <PageHeader
        title="行策略模板"
        description="把重复的静态行条件抽成可复用的模板；模板与内联条件在同一选择器内取交集。"
        badges={
          templatesQuery.data ? (
            <RowPolicySnapshotBadge identity={templatesQuery.data.snapshot.identity} />
          ) : undefined
        }
      />

      <section className="grid gap-2">
        <h2 className="text-sm font-medium">模板列表</h2>
        {templatesQuery.isError ? (
          <p className="text-sm text-warning-strong" data-testid="row-policy-templates-error">
            模板列表读取失败：{(templatesQuery.error as Error).message}
          </p>
        ) : (
          <RowPolicyTemplateTable
            templates={templates}
            selectedName={selectedName}
            onSelect={setSelectedName}
          />
        )}
        {templatesQuery.data && templatesQuery.data.issues.length > 0 ? (
          <ul className="grid gap-1 text-xs text-warning-strong" data-testid="row-policy-template-issues">
            {templatesQuery.data.issues.map((issue, index) => (
              <li key={index} className="notranslate" translate="no">
                {issue.code}
                {issue.templateName ? ` · ${issue.templateName}` : ""}
                {issue.detail ? ` · ${issue.detail}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="grid gap-2">
        <h2 className="text-sm font-medium">模板详情</h2>
        <RowPolicyTemplateDetail template={selected} />
      </section>

      <section className="grid gap-2" data-testid="row-policy-template-editor">
        <h2 className="text-sm font-medium">{editingName ? "修改模板" : "新建模板"}</h2>
        <div className="grid gap-2">
          <label className="grid gap-1 text-xs text-fg-muted" htmlFor="row-policy-template-name">
            模板名
            {/*
              模板名是**标识**（它就是行策略模板的键），术语标准 §2.6 要求输入框与它
              显示的值一样受翻译防御。说明框是自由文本，不加。
            */}
            <input
              id="row-policy-template-name"
              className="rounded border border-line bg-surface px-2 py-1 text-sm notranslate"
              translate="no"
              value={name}
              onChange={(event) => changeName(event.target.value)}
              placeholder="by_region"
            />
          </label>
          <label className="grid gap-1 text-xs text-fg-muted" htmlFor="row-policy-template-description">
            说明
            <input
              id="row-policy-template-description"
              className="rounded border border-line bg-surface px-2 py-1 text-sm"
              value={description}
              onChange={(event) => changeDescription(event.target.value)}
            />
          </label>
          <div className="grid gap-1">
            <span className="text-xs text-fg-muted">谓词</span>
            {draft.map((row, index) => (
              <div key={index} className="flex gap-2">
                {/* 谓词字段是列名、谓词取值是列里的值：两者都是标识。 */}
                <input
                  className="rounded border border-line bg-surface px-2 py-1 text-sm notranslate"
                  translate="no"
                  aria-label={`谓词 ${index + 1} 字段`}
                  value={row.field}
                  onChange={(event) => changePredicate(index, { field: event.target.value })}
                />
                <select
                  className="rounded border border-line bg-surface px-2 py-1 text-sm"
                  aria-label={`谓词 ${index + 1} 运算符`}
                  value={row.op}
                  onChange={(event) =>
                    changePredicate(index, { op: event.target.value as "eq" | "in" })
                  }
                >
                  <option value="eq">等于</option>
                  <option value="in">属于</option>
                </select>
                <input
                  className="rounded border border-line bg-surface px-2 py-1 text-sm notranslate"
                  translate="no"
                  aria-label={`谓词 ${index + 1} 取值`}
                  value={row.value}
                  placeholder={row.op === "in" ? "A, B, C" : "A"}
                  onChange={(event) => changePredicate(index, { value: event.target.value })}
                />
              </div>
            ))}
            <button
              type="button"
              className="text-xs underline"
              onClick={addPredicate}
            >
              添加谓词
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border border-line px-3 py-1 text-sm"
            data-testid="row-policy-template-dry-run"
            disabled={dryRun.isPending}
            onClick={() => dryRun.mutate()}
          >
            预演
          </button>
          <button
            type="button"
            className="rounded bg-primary px-3 py-1 text-sm text-primary-fg"
            data-testid="row-policy-template-save"
            disabled={!preview || preview.dryRun === false || pendingAction !== "save" || save.isPending}
            onClick={() => save.mutate()}
          >
            正式保存
          </button>
          <button
            type="button"
            className="rounded border border-line px-3 py-1 text-sm"
            data-testid="row-policy-template-reset"
            onClick={resetDraft}
          >
            清空
          </button>
        </div>

        <RowPolicyTemplateImpactPanel preview={preview} auditState={auditState} />
      </section>

      <section className="grid gap-2">
        <h2 className="text-sm font-medium">删除</h2>
        <p className="text-xs text-fg-muted">
          删除前必须先预演：模板仍被角色引用时，主操作不可用。
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border border-line px-3 py-1 text-sm"
            data-testid="row-policy-template-delete-dry-run"
            disabled={!selectedName || deleteDryRun.isPending}
            onClick={() => selectedName && deleteDryRun.mutate(selectedName)}
          >
            预演删除
          </button>
          <button
            type="button"
            className="rounded border border-line px-3 py-1 text-sm"
            data-testid="row-policy-template-delete"
            disabled={
              !preview ||
              preview.dryRun === false ||
              pendingAction !== "delete" ||
              Boolean(preview.blockingReferences.length) ||
              deleteTargetMismatch ||
              !deletePreviewName
            }
            onClick={() => deletePreviewName && remove.mutate(deletePreviewName)}
          >
            正式删除
          </button>
        </div>
        {deleteTargetMismatch ? (
          <p
            className="text-xs text-warning-strong"
            data-testid="row-policy-template-delete-target-mismatch"
          >
            {`删除预演针对的是 ${deletePreviewName ?? ""}，当前选中的是 ${selectedName ?? ""}；请对当前选中的模板重新预演删除。`}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button
            type="button"
            className="text-xs underline"
            data-testid="row-policy-template-edit"
            disabled={!selectedName}
            onClick={() => selectedName && startEdit(selectedName)}
          >
            编辑选中模板
          </button>
        </div>
      </section>
    </div>
  );
}

export default RowPolicyTemplates;
