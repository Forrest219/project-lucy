import { ConnectionTestResultPanel } from "./ConnectionTestResultPanel";
import type { ConnectionInfo, ConnectionTestResult } from "../../lib/types";

export type ConnectionTestDrawerProps = {
  connection: ConnectionInfo;
  open: boolean;
  /**
   * The latest test result for this connection. The drawer does not own
   * this state — the parent (`ConnectionOverview` or `ConnectionTest`)
   * runs the mutation, and we just render. This keeps the card status,
   * the page status, and the drawer panel in lockstep.
   */
  result: ConnectionTestResult | null;
  /**
   * Whether the parent's mutation is currently pending. The drawer uses
   * this to flip its "重新测试连接" button into a pending state and to
   * render the "正在测试连接..." banner.
   */
  isPending: boolean;
  logsExpanded: boolean;
  onClose: () => void;
  onRunTest: () => void;
  onToggleLogs: () => void;
};

export function ConnectionTestDrawer({
  connection,
  open,
  result,
  isPending,
  logsExpanded,
  onClose,
  onRunTest,
  onToggleLogs
}: ConnectionTestDrawerProps) {
  if (!open) return null;

  return (
    <div
      className="pl-drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`连通测试 · ${connection.id}`}
      data-testid="connection-test-drawer"
    >
      <div
        className="pl-drawer-panel"
        data-testid="connection-test-drawer-panel"
        data-connection={connection.id}
      >
        <header className="pl-drawer-header">
          <div>
            <p className="pl-eyebrow notranslate" translate="no">
              {connection.id}
            </p>
            <h2 className="pl-panel-title notranslate" translate="no">连通测试</h2>
            <p className="pl-notice">
              对该连接执行一次连通诊断，验证凭据、网络与驱动配置。
              不访问表数据，不会触发 <code className="notranslate" translate="no">Catalog Reload</code>。
            </p>
          </div>
          <button
            type="button"
            className="pl-btn pl-btn--ghost pl-drawer-close"
            onClick={onClose}
            data-testid="connection-test-drawer-close"
            aria-label="关闭连通测试"
          >
            关闭
          </button>
        </header>

        <div className="pl-drawer-body">
          <div className="pl-toolbar">
            <button
              type="button"
              className="pl-btn pl-btn--primary"
              onClick={onRunTest}
              disabled={isPending}
              data-testid="connection-test-drawer-run"
            >
              {isPending ? "测试中..." : "重新测试连接"}
            </button>
            <span className="text-xs text-fg-muted">
              也可以在 <code className="notranslate" translate="no">ktx connection test {connection.id}</code> 终端命令下得到相同结果。
            </span>
          </div>

          <ConnectionTestResultPanel
            connection={connection}
            result={result}
            isPending={isPending}
            logsExpanded={logsExpanded}
            onToggleLogs={onToggleLogs}
          />
        </div>
      </div>
    </div>
  );
}
