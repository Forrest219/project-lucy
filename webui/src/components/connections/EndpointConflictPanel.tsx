import type { EndpointGateState, EndpointMatch } from "../../lib/connectionEndpointGate";

type LiveView = {
  status: "idle" | "checking" | "missing" | "error";
  message?: string;
};

export type EndpointConflictPanelProps = {
  gate: EndpointGateState;
  schemaName: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  live: LiveView;
  pending: boolean;
  onAddSchema: (connectionId: string, schema: string) => void;
  onRetryLive: (connectionId: string, schema: string) => void;
  onSeparateConnection: () => void;
  onDifferentDatabase: () => void;
  onBackToExisting: () => void;
};

function targetId(gate: EndpointGateState, selectedId: string | null): string | null {
  if (gate.kind !== "endpoint") return null;
  if (gate.reason === "multiple") return selectedId;
  return gate.matches[0]?.id ?? null;
}

export function EndpointConflictPanel({
  gate,
  schemaName,
  selectedId,
  onSelect,
  live,
  pending,
  onAddSchema,
  onRetryLive,
  onSeparateConnection,
  onDifferentDatabase,
  onBackToExisting
}: EndpointConflictPanelProps) {
  const connectionId = targetId(gate, selectedId);
  const unique = gate.kind === "endpoint" && gate.matches.length === 1;
  const liveStopsAdd = live.status === "checking" || live.status === "error" || live.status === "missing";
  const showSeparate =
    (unique && live.status === "missing") ||
    (gate.kind === "endpoint" && unique && live.status !== "error" && live.status !== "checking" && gate.reason !== "multiple");
  const separateIsPrimary =
    (unique && live.status === "missing") ||
    (gate.kind === "endpoint" && gate.reason === "username_differs" && live.status !== "missing");
  const addReady = Boolean(schemaName) && Boolean(connectionId);
  const showRetry = gate.kind === "endpoint" && live.status === "error" && addReady;
  const showAdd =
    gate.kind === "endpoint" &&
    live.status !== "error" &&
    live.status !== "missing" &&
    (addReady || gate.reason === "multiple");
  const addLabel = gate.kind === "endpoint" && gate.reason === "multiple" ? "添加到所选连接" : "添加 Schema";

  return (
    <div className="rounded-md border border-border-default bg-bg-subtle p-3 text-sm" data-testid="endpoint-gate-panel">
      <p role="status">{gate.message}</p>
      {gate.kind === "endpoint" && gate.reason === "username_differs" ? (
        <p className="mt-2 text-fg-muted">添加到已有连接将使用已有用户名，新输入的用户名和密码不会保存。</p>
      ) : null}
      {gate.kind === "endpoint" && gate.reason === "reuse_existing_credentials" ? (
        <p className="mt-2 text-fg-muted">将使用已有凭据，新输入的密码不会保存。</p>
      ) : null}
      {gate.kind === "endpoint" && gate.reason === "multiple" ? (
        <fieldset className="mt-3 space-y-2">
          <legend className="text-xs text-fg-muted">选择已有连接</legend>
          {gate.matches.map((match) => (
            <MatchOption key={match.id} match={match} selected={selectedId === match.id} onSelect={onSelect} />
          ))}
        </fieldset>
      ) : null}
      {gate.kind === "different_database" ? (
        <ul className="mt-2 space-y-1">
          {gate.matches.map((match) => (
            <li key={match.id} className="notranslate" translate="no">
              {match.id} · {match.host}:{match.port} · {match.database}
            </li>
          ))}
        </ul>
      ) : null}
      {live.status === "error" ? (
        <p className="mt-2 text-danger notranslate" translate="no" role="alert">
          {live.message || "无法读取库内 Schema"}
        </p>
      ) : null}
      {live.status === "missing" ? (
        <p className="mt-2 notranslate" translate="no" role="status">已有连接看不到该 Schema。</p>
      ) : null}
      {!schemaName && gate.kind === "endpoint" ? (
        <p className="mt-2 text-danger notranslate" translate="no" role="alert">
          该主机端口已有连接时，一次只能添加一个 Schema。
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {gate.kind === "schema_exists" ? (
          <button type="button" className="pl-btn pl-btn--primary" onClick={onBackToExisting} data-testid="endpoint-gate-back">
            返回已有连接
          </button>
        ) : null}
        {gate.kind === "different_database" ? (
          <button
            type="button"
            className="pl-btn pl-btn--primary"
            disabled={pending}
            onClick={onDifferentDatabase}
            data-testid="endpoint-gate-different-database"
          >
            新建连接
          </button>
        ) : null}
        {showRetry ? (
          <button
            type="button"
            className="pl-btn pl-btn--primary"
            disabled={pending}
            onClick={() => onRetryLive(connectionId!, schemaName!)}
            data-testid="endpoint-gate-retry-live"
          >
            重试读取
          </button>
        ) : null}
        {showAdd && separateIsPrimary === false ? (
          <button
            type="button"
            className="pl-btn pl-btn--primary"
            disabled={pending || liveStopsAdd || !addReady}
            onClick={() => onAddSchema(connectionId!, schemaName!)}
            data-testid="endpoint-gate-add-schema"
          >
            {live.status === "checking" ? "正在读取..." : addLabel}
          </button>
        ) : null}
        {showSeparate && separateIsPrimary ? (
          <button
            type="button"
            className="pl-btn pl-btn--primary"
            disabled={pending}
            onClick={onSeparateConnection}
            data-testid="endpoint-gate-separate"
          >
            仍要新建连接
          </button>
        ) : null}
        {showAdd && separateIsPrimary ? (
          <button
            type="button"
            className="pl-btn pl-btn--secondary"
            disabled={pending || live.status === "checking" || !addReady}
            onClick={() => onAddSchema(connectionId!, schemaName!)}
            data-testid="endpoint-gate-add-schema"
          >
            添加到已有连接
          </button>
        ) : null}
        {showSeparate && !separateIsPrimary ? (
          <button
            type="button"
            className="pl-btn pl-btn--secondary"
            disabled={pending}
            onClick={onSeparateConnection}
            data-testid="endpoint-gate-separate"
          >
            仍要新建连接
          </button>
        ) : null}
      </div>
    </div>
  );
}

function MatchOption({
  match,
  selected,
  onSelect
}: {
  match: EndpointMatch;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 notranslate" translate="no">
      <input
        type="radio"
        name="endpoint-match"
        checked={selected}
        onChange={() => onSelect(match.id)}
        data-testid={`endpoint-gate-match-${match.id}`}
      />
      <span>
        {match.id} · {match.host}:{match.port}
        {match.username ? ` · ${match.username}` : ""}
      </span>
    </label>
  );
}
