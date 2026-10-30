/**
 * Lucy v0.25 P1-3 — 凭证清单（Token 附属区）。
 *
 * Authority: `webui/docs/187-access-relation-sankey-spec.md`
 *   §4.5  Token 凭证清单（不承载授权、不参与守恒、只过滤访问层）
 *   §7.3  交互：点击只过滤访问层，UI 必须显式提示「授权层不受影响」
 *
 * 呈现修订: `docs/specs/lucy-20261030-access-map-quiet-reading-spec.md` §5.6 / D7
 *   凭证清单改为**一张表**（Agent、Token、状态、窗口内调用）；守恒说明只出现一次。
 *
 * Token 不承载授权，因此它不进入流主干、不与 Role / Connection 连流带，
 * 也不参与守恒 —— 它只是这个 Agent 手上的调用凭据。
 */
import { type AccessMapNode } from "./AccessMapTypes";

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

function statusBadgeClass(status: string | undefined): string {
  switch (status) {
    case "expired":
      return "pl-status-badge pl-status-badge--pending";
    case "revoked":
      return "pl-status-badge border-danger-strong bg-danger-soft text-danger-strong";
    default:
      return "pl-status-badge pl-status-badge--included";
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
        Token 只过滤访问层，授权层不受影响。
      </p>
      <div className="pl-data-grid-frame">
        <div className="pl-data-grid-scroll">
          <table className="pl-data-grid pl-data-table">
            <caption className="sr-only">访问关系图凭证清单</caption>
            <thead>
              <tr>
                <th scope="col" className="notranslate" translate="no">
                  Agent
                </th>
                <th scope="col" className="notranslate" translate="no">
                  Token
                </th>
                <th scope="col">状态</th>
                <th scope="col" className="text-right">
                  窗口内调用
                </th>
              </tr>
            </thead>
            {/*
              每个 Agent 一个 `<tbody>`：表还是一张表，但分组关系在 DOM 里保留，
              既能给每个 Agent 留一个稳定锚点，也不必在行内重复分组说明。
            */}
            {agents.map((agent) => {
              const owned = tokens.filter((token) => token.parentId === agent.id);
              if (owned.length === 0) return null;
              return (
                <tbody key={agent.id} data-testid={`access-map-credential-${agent.id}`}>
                  {owned.map((token) => {
                    const active = activeToken === token.meta.label;
                    return (
                      <tr key={token.id}>
                        <td className="notranslate" translate="no">
                          {agent.label}
                        </td>
                        <td>
                          <button
                            type="button"
                            className={`underline notranslate ${active ? "font-semibold" : ""}`}
                            translate="no"
                            aria-pressed={active}
                            data-testid={`access-map-token-${token.id}`}
                            onClick={() => onSelectToken(active ? null : (token.meta.label ?? null))}
                          >
                            <span className="font-mono">{token.label}</span>
                          </button>
                        </td>
                        <td>
                          <span className={statusBadgeClass(token.meta.status)}>
                            {statusLabel(token.meta.status)}
                          </span>
                        </td>
                        <td className="text-right tabular-nums">{token.meta.callCount ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>
      </div>
    </section>
  );
}
