import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { WikiBatchAccessResult } from "./WikiBatchAccessResult";
import { useAssignableRoleState } from "./ObjectAclField";
import { queryKeys } from "../lib/queryKeys";
import {
  commitWikiBatchAccess,
  fetchWikiBatchAccessResult,
  isWikiBatchRetryable,
  previewWikiBatchAccess,
  wikiAccessErrorText,
  wikiAclDisplayText,
  wikiDirectionLabel
} from "../lib/wikiAccess";
import type {
  WikiAclState,
  WikiBatchAccessAction,
  WikiBatchAccessPlan,
  WikiBatchAccessResult as WikiBatchAccessResultType
} from "../lib/types";

export type WikiBatchAccessDocument = {
  key: string;
  title?: string;
  /** The persisted file version used as the per-document baseline. */
  file_version: string;
  /** The persisted declaration (from the aggregate list response). */
  acl?: WikiAclState;
};

export type WikiBatchAccessDrawerProps = {
  open: boolean;
  documents: WikiBatchAccessDocument[];
  onClose: () => void;
  onCommitted?: (result: WikiBatchAccessResultType) => void;
  /** Restore a previous run by operation id after a refresh / network drop. */
  initialOperationId?: string | null;
};

type BatchMode = "add" | "replace";
type ReplaceMode = "roles" | "none" | "all";

function newIdempotencyKey(): string {
  const globalCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
    return globalCrypto.randomUUID();
  }
  return `wiki-batch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Spec 193 §7 — the bulk authorization drawer.
 *
 * Exactly two operations are offered: 添加角色 (union with the current ACL)
 * and 替换可访问角色 (the same exact ACL for every document). The preview
 * always shows the per-document difference plus a summary; a bulk run is
 * never presented as an atomic transaction.
 */
export function WikiBatchAccessDrawer({
  open,
  documents,
  onClose,
  onCommitted,
  initialOperationId
}: WikiBatchAccessDrawerProps) {
  const queryClient = useQueryClient();
  const roleState = useAssignableRoleState();
  const [mode, setMode] = useState<BatchMode>("add");
  const [replaceMode, setReplaceMode] = useState<ReplaceMode>("roles");
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [confirmedEmpty, setConfirmedEmpty] = useState(false);
  const [confirmedAll, setConfirmedAll] = useState(false);
  const [plan, setPlan] = useState<WikiBatchAccessPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [result, setResult] = useState<WikiBatchAccessResultType | null>(null);
  const [restoring, setRestoring] = useState(false);
  const planSeqRef = useRef(0);
  const idempotencyKeyRef = useRef(newIdempotencyKey());

  // A previous run can be restored by operation id after a refresh or a
  // dropped connection.
  useEffect(() => {
    if (!open || !initialOperationId) {
      return;
    }
    let cancelled = false;
    setRestoring(true);
    fetchWikiBatchAccessResult(initialOperationId)
      .then((restored) => {
        if (!cancelled) setResult(restored);
      })
      .catch((error: unknown) => {
        if (!cancelled) setCommitError(wikiAccessErrorText(error));
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialOperationId, open]);

  const corruptDocuments = useMemo(
    () => documents.filter((item) => item.acl?.state === "corrupt"),
    [documents]
  );

  const action = useMemo<WikiBatchAccessAction | null>(() => {
    if (mode === "add") {
      if (selectedRoleIds.length === 0) return null;
      if (selectedRoleIds.includes("*")) return null;
      return { mode: "add", role_ids: [...selectedRoleIds] };
    }
    if (replaceMode === "none") return { mode: "replace", allowed_roles: [] };
    if (replaceMode === "all") return { mode: "replace", allowed_roles: ["*"] };
    if (selectedRoleIds.length === 0) return null;
    return { mode: "replace", allowed_roles: [...selectedRoleIds] };
  }, [mode, replaceMode, selectedRoleIds]);

  const finalIsEmpty = action?.mode === "replace" && action.allowed_roles.length === 0;
  const finalIsAll = action?.mode === "replace" && action.allowed_roles.includes("*");
  const addBlockedByCorrupt = mode === "add" && corruptDocuments.length > 0;
  const rolesReady = roleState.roleStatus === "ready";
  const previewBlocked = !action || planLoading || committing || !rolesReady || addBlockedByCorrupt;

  function toggleRole(roleId: string) {
    setSelectedRoleIds((current) =>
      current.includes(roleId) ? current.filter((item) => item !== roleId) : [...current, roleId]
    );
  }

  async function runPreview(items: WikiBatchAccessDocument[], act: WikiBatchAccessAction) {
    const seq = planSeqRef.current + 1;
    planSeqRef.current = seq;
    setPlanLoading(true);
    setPlanError(null);
    try {
      const next = await previewWikiBatchAccess({
        items: items.map((item) => ({ key: item.key, expected_version: item.file_version })),
        action: act
      });
      if (planSeqRef.current !== seq) return;
      setPlan(next);
      idempotencyKeyRef.current = newIdempotencyKey();
      setConfirmedEmpty(false);
      setConfirmedAll(false);
    } catch (error: unknown) {
      if (planSeqRef.current !== seq) return;
      setPlan(null);
      setPlanError(wikiAccessErrorText(error));
    } finally {
      if (planSeqRef.current === seq) setPlanLoading(false);
    }
  }

  async function commit() {
    if (!plan || !action) {
      return;
    }
    setCommitting(true);
    setCommitError(null);
    try {
      const committed = await commitWikiBatchAccess({
        operation_id: plan.operation_id,
        plan_digest: plan.plan_digest,
        idempotency_key: idempotencyKeyRef.current,
        // The commit covers exactly the documents of the current plan.
        items: plan.items.map((item) => ({
          key: item.key,
          expected_version: item.file_version
        })),
        action,
        confirmed_empty: finalIsEmpty ? confirmedEmpty : false,
        confirmed_all: finalIsAll ? confirmedAll : false
      });
      setResult(committed);
      queryClient.invalidateQueries({ queryKey: queryKeys.wiki });
      onCommitted?.(committed);
      toast.success("批量授权已提交");
    } catch (error: unknown) {
      setCommitError(wikiAccessErrorText(error));
    } finally {
      setCommitting(false);
    }
  }

  async function retryIncomplete(keys: string[]) {
    if (!action || keys.length === 0) {
      return;
    }
    const remaining = documents.filter((item) => keys.includes(item.key));
    setResult(null);
    setCommitError(null);
    await runPreview(remaining, action);
  }

  const planBlocking = plan?.blocking || (plan?.items.some((item) => item.issues.some((issue) => issue.blocking)) ?? false);
  const submitBlocked =
    !plan ||
    planBlocking ||
    committing ||
    (finalIsEmpty && !confirmedEmpty) ||
    (finalIsAll && !confirmedAll);

  return (
    <Dialog.Root onOpenChange={(next) => (!next ? onClose() : null)} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="pl-drawer-overlay" />
        <Dialog.Content
          aria-describedby="wiki-batch-drawer-description"
          className="pl-drawer-panel"
          data-testid="wiki-batch-drawer"
        >
          <header className="pl-drawer-header">
            <div className="grid gap-1 min-w-0">
              <Dialog.Title className="pl-wiki-access-drawer-title">批量管理权限</Dialog.Title>
              <Dialog.Description
                className="pl-wiki-access-drawer-description"
                id="wiki-batch-drawer-description"
              >
                只影响本次显式选中的 {documents.length} 篇文档，不影响以后新增文档。
              </Dialog.Description>
            </div>
            <button
              aria-label="关闭批量管理权限"
              className="pl-drawer-close"
              data-testid="wiki-batch-drawer-close"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          </header>

          <div className="pl-drawer-body">
            {restoring ? (
              <p className="pl-notice" data-testid="wiki-batch-restoring">
                正在恢复批量结果…
              </p>
            ) : null}

            {result ? (
              <WikiBatchAccessResult
                onRetryIncomplete={(keys) => void retryIncomplete(keys)}
                result={result}
                retrying={planLoading}
                testId="wiki-batch-result"
              />
            ) : (
              <>
                <section className="pl-wiki-access-drawer-section">
                  <h3 className="pl-wiki-preflight-section-title">操作</h3>
                  <div className="pl-wiki-batch-modes">
                    <label className="pl-acl-option">
                      <input
                        checked={mode === "add"}
                        name="wiki-batch-mode"
                        onChange={() => setMode("add")}
                        type="radio"
                      />
                      <span>添加角色</span>
                    </label>
                    <label className="pl-acl-option">
                      <input
                        checked={mode === "replace"}
                        name="wiki-batch-mode"
                        onChange={() => setMode("replace")}
                        type="radio"
                      />
                      <span>替换可访问角色</span>
                    </label>
                  </div>
                  {mode === "add" ? (
                    <p className="pl-notice" data-testid="wiki-batch-add-hint">
                      对每篇文档的当前授权加入所选角色；至少选择一个角色，且不接受所有角色可见。
                    </p>
                  ) : (
                    <p className="pl-notice" data-testid="wiki-batch-replace-hint">
                      把每篇文档的可访问角色设为同一精确值。
                    </p>
                  )}
                </section>

                <section className="pl-wiki-access-drawer-section">
                  <h3 className="pl-wiki-preflight-section-title">角色</h3>
                  {mode === "replace" ? (
                    <div className="pl-wiki-batch-modes">
                      <label className="pl-acl-option">
                        <input
                          checked={replaceMode === "roles"}
                          name="wiki-batch-replace-mode"
                          onChange={() => setReplaceMode("roles")}
                          type="radio"
                        />
                        <span>指定角色</span>
                      </label>
                      <label className="pl-acl-option">
                        <input
                          checked={replaceMode === "none"}
                          name="wiki-batch-replace-mode"
                          onChange={() => setReplaceMode("none")}
                          type="radio"
                        />
                        <span>无人可见</span>
                      </label>
                      <label className="pl-acl-option">
                        <input
                          checked={replaceMode === "all"}
                          name="wiki-batch-replace-mode"
                          onChange={() => setReplaceMode("all")}
                          type="radio"
                        />
                        <span>所有角色可见</span>
                      </label>
                    </div>
                  ) : null}
                  {roleState.roleStatus === "loading" ? (
                    <p className="pl-notice" data-testid="wiki-batch-roles-loading">
                      正在加载可授权角色…
                    </p>
                  ) : null}
                  {roleState.roleStatus === "error" ? (
                    <p className="pl-error" data-testid="wiki-batch-roles-error">
                      可授权角色加载失败：{roleState.roleError}
                    </p>
                  ) : null}
                  {roleState.roleStatus === "ready" && roleState.roleIds.length === 0 ? (
                    <p className="pl-notice" data-testid="wiki-batch-roles-empty">
                      暂无可授权的正式 <span className="notranslate" translate="no">Role</span>。
                    </p>
                  ) : null}
                  {roleState.roleStatus === "ready" && roleState.roleIds.length > 0 ? (
                    <div className="pl-acl-roles" data-testid="wiki-batch-roles">
                      {roleState.roleIds.map((roleId) => (
                        <label className="pl-acl-role" key={roleId}>
                          <input
                            checked={selectedRoleIds.includes(roleId)}
                            onChange={() => toggleRole(roleId)}
                            type="checkbox"
                          />
                          <span className="notranslate" translate="no">
                            {roleId}
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </section>

                {addBlockedByCorrupt ? (
                  <p className="pl-error" data-testid="wiki-batch-corrupt-block">
                    {corruptDocuments.length} 篇文档的授权声明已损坏，添加角色无法计算并集，请改用替换可访问角色。
                  </p>
                ) : null}
                {planError ? (
                  <p className="pl-error" data-testid="wiki-batch-plan-error">
                    批量预检失败：{planError}
                  </p>
                ) : null}
                {commitError ? (
                  <p className="pl-error" data-testid="wiki-batch-commit-error">
                    批量授权失败：{commitError}
                  </p>
                ) : null}

                <section className="pl-wiki-access-drawer-section">
                  <h3 className="pl-wiki-preflight-section-title">预检摘要</h3>
                  {!plan ? (
                    <p className="pl-notice" data-testid="wiki-batch-plan-empty">
                      选择操作与角色后先预检，预检会逐篇列出授权差异。
                    </p>
                  ) : (
                    <>
                      <dl
                        className="pl-wiki-preflight-summary-list"
                        data-testid="wiki-batch-plan-summary"
                      >
                        <div className="pl-wiki-preflight-summary-row">
                          <dt className="pl-wiki-preflight-summary-label">将扩权</dt>
                          <dd className="pl-wiki-preflight-summary-value">{plan.summary.widening}</dd>
                        </div>
                        <div className="pl-wiki-preflight-summary-row">
                          <dt className="pl-wiki-preflight-summary-label">将收窄</dt>
                          <dd className="pl-wiki-preflight-summary-value">{plan.summary.narrowing}</dd>
                        </div>
                        <div className="pl-wiki-preflight-summary-row">
                          <dt className="pl-wiki-preflight-summary-label">不变</dt>
                          <dd className="pl-wiki-preflight-summary-value">{plan.summary.unchanged}</dd>
                        </div>
                        <div className="pl-wiki-preflight-summary-row">
                          <dt className="pl-wiki-preflight-summary-label">授权异常</dt>
                          <dd className="pl-wiki-preflight-summary-value">{plan.summary.corrupt}</dd>
                        </div>
                        <div className="pl-wiki-preflight-summary-row">
                          <dt className="pl-wiki-preflight-summary-label">缺少读取通道</dt>
                          <dd className="pl-wiki-preflight-summary-value">
                            {plan.summary.missing_channel}
                          </dd>
                        </div>
                        <div className="pl-wiki-preflight-summary-row">
                          <dt className="pl-wiki-preflight-summary-label">
                            受影响{" "}
                            <span className="notranslate" translate="no">
                              Agent
                            </span>{" "}
                            数
                          </dt>
                          <dd className="pl-wiki-preflight-summary-value">
                            {plan.summary.affected_agent_count}
                          </dd>
                        </div>
                      </dl>

                      {finalIsEmpty ? (
                        <label className="pl-wiki-access-confirm" data-testid="wiki-batch-empty-confirm">
                          <input
                            checked={confirmedEmpty}
                            onChange={(event) => setConfirmedEmpty(event.target.checked)}
                            type="checkbox"
                          />
                          <span>
                            我确认把这批文档设为无人可见，<span className="notranslate" translate="no">Agent</span>{" "}
                            将无法访问。
                          </span>
                        </label>
                      ) : null}
                      {finalIsAll ? (
                        <label className="pl-wiki-access-confirm" data-testid="wiki-batch-all-confirm">
                          <input
                            checked={confirmedAll}
                            onChange={(event) => setConfirmedAll(event.target.checked)}
                            type="checkbox"
                          />
                          <span>我确认把这批文档设为所有角色可见，这不是匿名公开。</span>
                        </label>
                      ) : null}

                      <p className="pl-notice" data-testid="wiki-batch-transaction-note">
                        批量授权不是跨文件事务：已完成的文档不会因其他文档失败而回滚。
                      </p>

                      <div className="pl-data-grid-scroll">
                        <table
                          className="pl-data-grid pl-wiki-batch-plan-table"
                          data-testid="wiki-batch-plan-table"
                        >
                          <thead>
                            <tr>
                              <th scope="col">文档</th>
                              <th scope="col">当前授权</th>
                              <th scope="col">新授权</th>
                              <th scope="col">方向</th>
                              <th scope="col">问题</th>
                            </tr>
                          </thead>
                          <tbody>
                            {plan.items.map((item) => (
                              <tr data-testid={`wiki-batch-plan-item-${item.key}`} key={item.key}>
                                <td>
                                  <code className="notranslate" translate="no">
                                    wiki/{item.key}
                                  </code>
                                </td>
                                <td>{wikiAclDisplayText(item.current_acl)}</td>
                                <td>{wikiAclDisplayText(item.next_acl)}</td>
                                <td>
                                  {wikiDirectionLabel(item.direction)}
                                  {item.noop ? "（无变化）" : ""}
                                </td>
                                <td>
                                  {item.issues.length === 0
                                    ? "—"
                                    : item.issues.map((issue) => issue.message).join("；")}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </section>
              </>
            )}
          </div>

          <footer className="pl-drawer-footer">
            <button className="pl-btn pl-btn--ghost" onClick={onClose} type="button">
              关闭
            </button>
            {result ? null : (
              <>
                <button
                  className="pl-btn pl-btn--secondary"
                  data-testid="wiki-batch-preview"
                  disabled={previewBlocked}
                  onClick={() => {
                    if (action) void runPreview(documents, action);
                  }}
                  type="button"
                >
                  预检批量授权
                </button>
                <button
                  aria-busy={committing}
                  className="pl-btn pl-btn--primary"
                  data-testid="wiki-batch-submit"
                  disabled={submitBlocked}
                  onClick={() => void commit()}
                  type="button"
                >
                  {committing ? "提交中…" : "提交批量授权"}
                </button>
              </>
            )}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
