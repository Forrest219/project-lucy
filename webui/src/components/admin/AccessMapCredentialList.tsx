/**
 * Lucy v0.25 P1-3 — 凭证清单（Token 附属区）。
 *
 * Authority: `webui/docs/187-access-relation-sankey-spec.md`
 *   §4.5  Token 凭证清单（不承载授权、不参与守恒、只过滤访问层）
 *   §7.3  交互：点击只过滤访问层，UI 必须显式提示「授权层不受影响」
 *
 * 凭证清单是 Agent 下的**虚线附属区**，宽度固定，不随路径数缩放，
 * 也不与 Role / Connection 连流带 —— Token 不携带授权。
 */
import { accessMapNodeSubtitle, type AccessMapNode } from "./AccessMapTypes";

export type AccessMapCredentialListProps = {
  nodes: AccessMapNode[];
  /** 当前 Token 过滤；null 表示未过滤。 */
  activeToken: string | null;
  onSelectToken: (label: string | null) => void;
};

function statusLabel(status: string | undefined): string {
  switch (status) {
    case "expired":
      return "已过期";
    case "revoked":
      return "已吊销";
    default:
      return "生效中";
  }
}

export function AccessMapCredentialList({
  nodes,
  activeToken,
  onSelectToken
}: AccessMapCredentialListProps) {
  const agents = nodes.filter((node) => node.kind === "agent");
  const tokens = nodes.filter((node) => node.kind === "token");

  if (tokens.length === 0) {
    return (
      <div className="text-xs text-fg-muted" data-testid="access-map-credential-empty">
        没有可展示的凭证。
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-2" data-testid="access-map-credential-list">
      <h3 className="text-xs font-semibold text-fg-muted">凭证清单</h3>
      <p className="text-xs text-fg-muted notranslate" translate="no">
        Token 只承载调用归因，不承载授权：它不进入流主干、不参与守恒，点击后只过滤访问层。
      </p>
      {agents.map((agent) => {
        const owned = tokens.filter((token) => token.parentId === agent.id);
        if (owned.length === 0) return null;
        return (
          <div
            key={agent.id}
            className="rounded-md border border-dashed border-border-strong p-2"
            data-testid={`access-map-credential-${agent.id}`}
          >
            <div className="mb-1 text-xs text-fg-muted notranslate" translate="no">
              {agent.label} · {accessMapNodeSubtitle(agent)}
            </div>
            <ul className="flex flex-col gap-1">
              {owned.map((token) => {
                const active = activeToken === token.meta.label;
                return (
                  <li key={token.id}>
                    <button
                      type="button"
                      className={`pl-btn pl-btn--ghost text-xs notranslate ${active ? "pl-btn--primary" : ""}`}
                      translate="no"
                      aria-pressed={active}
                      data-testid={`access-map-token-${token.id}`}
                      onClick={() => onSelectToken(active ? null : (token.meta.label ?? null))}
                    >
                      <span className="font-mono">{token.label}</span>
                      <span className="ml-2 text-fg-muted">{statusLabel(token.meta.status)}</span>
                      <span className="ml-2 text-fg-muted">
                        窗口内调用 {token.meta.callCount ?? 0} 次
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
