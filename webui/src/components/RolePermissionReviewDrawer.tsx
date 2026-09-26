import * as Dialog from "@radix-ui/react-dialog";
import type { RefObject } from "react";
import type { PermissionImpactSummary } from "../lib/rolePermissionDraft";

export type RolePermissionReviewDrawerProps = {
  open: boolean;
  impact: PermissionImpactSummary;
  diff: string;
  proposedYaml?: string;
  onClose: () => void;
  onConfirm: () => void;
  pending?: boolean;
  deleteMode?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

const RISK_LABEL: Record<PermissionImpactSummary["risk"], string> = {
  expanded: "权限扩大",
  contracted: "权限收缩",
  mixed: "同时扩大与收缩",
  unchanged: "未检测到范围变化",
};

function ChangeList({ title, values, empty = "无", className, translate }: { title: string; values: string[]; empty?: string; className?: string; translate?: "no" }) {
  return (
    <div className={className} translate={translate}>
      <p className="text-sm font-medium">{title}</p>
      {values.length === 0 ? <p className="mt-1 text-xs text-fg-muted">{empty}</p> : (
        <ul className="mt-1 grid gap-1 text-xs text-fg-muted">
          {values.map((value) => <li key={value} className="notranslate" translate="no">{value}</li>)}
        </ul>
      )}
    </div>
  );
}

export function RolePermissionReviewDrawer({
  open,
  impact,
  diff,
  proposedYaml,
  onClose,
  onConfirm,
  pending = false,
  deleteMode = false,
  returnFocusRef,
}: RolePermissionReviewDrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !pending) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="pl-drawer-overlay" />
        <Dialog.Content
          className="pl-drawer-panel pl-drawer-panel--change-detail"
          data-testid="role-permission-review-drawer"
          aria-describedby="permission-review-description"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef?.current?.focus();
          }}
        >
          <header className="pl-drawer-header">
            <div>
              <Dialog.Title className="pl-panel-title">{deleteMode ? "确认删除 Role" : "确认权限变更"}</Dialog.Title>
              <Dialog.Description id="permission-review-description" className="mt-1 text-sm text-fg-muted">
                {deleteMode ? "删除后无法由此页面恢复，请确认影响范围。" : "系统已完成 dryRun。确认后才会正式写入权限配置。"}
              </Dialog.Description>
            </div>
            <Dialog.Close className="pl-btn pl-btn--ghost pl-drawer-close pl-drawer-close--prominent" disabled={pending}>关闭</Dialog.Close>
          </header>

          <div className="pl-drawer-body min-h-0 flex-1 content-start overflow-auto">
            <section className="grid gap-3" aria-label="结构化变化">
              <h3 className="text-sm font-semibold">结构化变化</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <ChangeList title="新增表" values={impact.tablesAdded} />
                <ChangeList title="移除表" values={impact.tablesRemoved} />
                <ChangeList title="新增 MCP 工具" values={impact.toolsAdded} className="notranslate" translate="no" />
                <ChangeList title="移除 MCP 工具" values={impact.toolsRemoved} className="notranslate" translate="no" />
                <ChangeList title="行级策略变化" values={impact.rowPoliciesChanged} />
                <div>
                  <p className="text-sm font-medium">启用目录绑定</p>
                  <p className="mt-1 text-xs text-fg-muted">
                    {impact.catalogBoundChange === "enabled" ? "将启用" : impact.catalogBoundChange === "disabled" ? "将关闭" : "无变化"}
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-md border border-warning-strong bg-warning-soft p-3" aria-label="风险">
              <h3 className="text-sm font-semibold text-warning-strong">风险：{RISK_LABEL[impact.risk]}</h3>
              {impact.catalogBoundChange === "enabled" ? <p className="mt-1 text-xs text-warning-strong">后续新启用的表会自动进入，并走扩权审计。</p> : null}
            </section>

            <section>
              <h3 className="notranslate text-sm font-semibold" translate="no">受影响 Agent</h3>
              {impact.affectedAgents.length === 0 ? <p className="notranslate mt-1 text-xs text-fg-muted" translate="no">当前没有 Agent 引用此 Role。</p> : (
                <ul className="mt-2 grid gap-1 text-xs text-fg-muted">
                  {impact.affectedAgents.map((user) => <li key={user.id}><span>{user.name}</span>（<code className="notranslate" translate="no">{user.id}</code>）</li>)}
                </ul>
              )}
            </section>

            {impact.rejectedToolsRemoved.length > 0 ? (
              <section className="rounded-md border border-warning-strong p-3" data-testid="role-review-rejected-tools">
                <h3 className="text-sm font-semibold">保存时将移除的系统禁止工具</h3>
                <ul className="mt-2 grid gap-1 text-xs text-warning-strong">
                  {impact.rejectedToolsRemoved.map((tool) => <li key={tool}><code className="notranslate" translate="no">{tool}</code>：系统拒绝，保存后从授权中移除</li>)}
                </ul>
              </section>
            ) : null}

            <details>
              <summary className="cursor-pointer text-sm font-medium">完整 YAML diff</summary>
              <pre className="pl-diff-viewer mt-2 max-h-96 overflow-auto text-xs notranslate" translate="no" data-testid="role-diff">{diff}</pre>
              {proposedYaml ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs">完整 proposed YAML</summary>
                  <pre className="pl-diff-viewer mt-2 max-h-80 overflow-auto text-xs notranslate" translate="no">{proposedYaml}</pre>
                </details>
              ) : null}
            </details>
          </div>

          <footer className="pl-drawer-footer pl-drawer-footer-border-t">
            <Dialog.Close className="pl-btn pl-btn--ghost" disabled={pending}>取消</Dialog.Close>
            <button type="button" className={`pl-btn ${deleteMode ? "pl-btn--danger" : "pl-btn--primary"}`} onClick={onConfirm} disabled={pending}>
              {pending ? "保存中…" : deleteMode ? "确认删除" : "确认保存"}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
