import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff, Lock, CheckCircle2, AlertCircle } from "lucide-react";
import { apiPost } from "../../lib/apiClient";
import {
  DATABASE_TYPES,
  getDatabaseTypeConfig,
  validateConnectionId,
  type DatabaseType,
  type DatabaseTypeConfig
} from "../../lib/connectionId";
import { validateSchemaName } from "../../lib/schemas";
import { formatProbeFailure } from "../../lib/setupAssistant";
import type { CreateConnectionResult, ProbeConnectionResult } from "../../lib/types";

export type Step1ConnectDbProps = {
  initialValues?: {
    id?: string;
    driver?: DatabaseTypeConfig["driver"];
    databaseType?: DatabaseType;
    engine?: string;
    host?: string;
    port?: string;
    database?: string;
    username?: string;
    schema?: string;
  };
  existingIds?: string[];
  onSuccess: (result: { connectionId: string; schema: string }) => void;
};

export function Step1ConnectDb({
  initialValues,
  existingIds = [],
  onSuccess
}: Step1ConnectDbProps) {
  const initialType = getDatabaseTypeConfig(initialValues?.databaseType || initialValues?.driver || "mysql");
  const [id, setId] = useState(initialValues?.id || "");
  const [databaseType, setDatabaseType] = useState<DatabaseType>(initialType.key);
  const [driver, setDriver] = useState<DatabaseTypeConfig["driver"]>(initialType.driver);
  const [engine, setEngine] = useState(initialValues?.engine || initialType.engine);
  const [wireProtocol, setWireProtocol] = useState(initialType.wireProtocol);
  const [host, setHost] = useState(initialValues?.host || "");
  const [port, setPort] = useState(initialValues?.port || String(initialType.defaultPort ?? ""));
  const [database, setDatabase] = useState(initialValues?.database || "");
  const [username, setUsername] = useState(initialValues?.username || "");
  const [password, setPassword] = useState("");
  const [schema, setSchema] = useState(initialValues?.schema || "");
  const [schemaEdited, setSchemaEdited] = useState(Boolean(initialValues?.schema));
  const [showPassword, setShowPassword] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeConnectionResult | null>(null);
  const [verifiedProbeFingerprint, setVerifiedProbeFingerprint] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const idIssue = validateConnectionId(id, existingIds);
  const schemaIssue = schema.trim() ? validateSchemaName(schema.trim()) : null;
  const portNum = Number(port);
  const portIssue =
    !Number.isInteger(portNum) || portNum < 1 || portNum > 65535
      ? "端口须为 1–65535 的整数"
      : null;

  const isSqlite = databaseType === "sqlite";
  const canProbe = isSqlite
    ? Boolean(database.trim())
    : Boolean(host.trim() && !portIssue && database.trim() && username.trim() && password.length > 0);
  const probeFingerprint = JSON.stringify({
    databaseType,
    driver,
    engine: engine.trim(),
    wireProtocol: wireProtocol.trim(),
    host: isSqlite ? "" : host.trim(),
    port: isSqlite ? "" : portNum,
    database: database.trim(),
    username: isSqlite ? "" : username.trim(),
    password: isSqlite ? "" : password,
    schema: schema.trim()
  });
  const probeVerified = Boolean(
    probeResult?.status === "ok" && verifiedProbeFingerprint === probeFingerprint
  );

  const canSubmit = Boolean(
    id.trim() &&
      !idIssue &&
      canProbe &&
      probeVerified &&
      (!schema.trim() || !schemaIssue)
  );

  const probeMutation = useMutation({
    mutationFn: ({ fingerprint: _fingerprint }: { fingerprint: string }) =>
      apiPost<ProbeConnectionResult>("/api/connections/probe", {
        driver,
        ...(engine.trim() ? { engine: engine.trim() } : {}),
        ...(wireProtocol.trim() ? { wireProtocol: wireProtocol.trim() } : {}),
        readonly: !isSqlite,
        ...(isSqlite
          ? {}
          : {
              host: host.trim(),
              port: portNum,
              username: username.trim(),
              password
            }),
        database: database.trim(),
        ...(schema.trim() ? { schema: schema.trim() } : {})
      }),
    onSuccess: (res, variables) => {
      setProbeResult(res);
      setVerifiedProbeFingerprint(res.status === "ok" ? variables.fingerprint : null);
      setSubmitError(null);
    },
    onError: (err) => {
      setVerifiedProbeFingerprint(null);
      setProbeResult({
        status: "error",
        message: err instanceof Error ? err.message : String(err)
      });
    }
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiPost<CreateConnectionResult>("/api/connections", {
        id: id.trim(),
        driver,
        ...(engine.trim() ? { engine: engine.trim() } : {}),
        ...(wireProtocol.trim() ? { wireProtocol: wireProtocol.trim() } : {}),
        readonly: !isSqlite,
        ...(isSqlite
          ? {}
          : {
              host: host.trim(),
              port: portNum,
              username: username.trim(),
              password
            }),
        database: database.trim(),
        schemas: schema.trim() ? [schema.trim()] : isSqlite ? ["main"] : [database.trim()],
        dryRun: false
      }),
    onSuccess: (res) => {
      const createdSchema = schema.trim() || (isSqlite ? "main" : database.trim());
      onSuccess({
        connectionId: res.connection.id,
        schema: createdSchema
      });
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  });

  const handleDatabaseTypeChange = (nextKey: DatabaseType) => {
    const config = getDatabaseTypeConfig(nextKey);
    const prevConfig = getDatabaseTypeConfig(databaseType);
    const prevDefaultPort = prevConfig.defaultPort != null ? String(prevConfig.defaultPort) : "";
    const nextDefaultPort = config.defaultPort != null ? String(config.defaultPort) : "";
    setDatabaseType(config.key);
    setDriver(config.driver);
    setEngine(config.engine);
    setWireProtocol(config.wireProtocol);
    if (!schemaEdited) {
      setSchema(config.key === "sqlite" ? "" : database);
    }
    if (!port.trim() || port === prevDefaultPort) {
      setPort(nextDefaultPort);
    }
  };
  const probeFailure =
    probeResult?.status === "error" ? formatProbeFailure(probeResult.message) : null;

  return (
    <div className="space-y-6" data-testid="setup-step-1">
      <div className="bg-bg-subtle p-4 rounded-lg border border-border-default space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="setup-conn-id" className="block text-xs font-medium text-fg-default mb-1">
              连接 ID <span className="text-danger" aria-hidden="true">*</span>
            </label>
            <input
              id="setup-conn-id"
              type="text"
              className="pl-input w-full notranslate"
              translate="no"
              placeholder="如：mysql-prod"
              value={id}
              onChange={(e) => {
                setId(e.target.value);
                setTouched(true);
              }}
              required
              aria-invalid={Boolean(touched && idIssue)}
              aria-describedby={touched && idIssue ? "setup-conn-id-error" : undefined}
              data-testid="setup-conn-id"
            />
            {touched && idIssue ? (
              <p className="text-xs text-danger mt-1" id="setup-conn-id-error">{idIssue.message}</p>
            ) : null}
          </div>

          <div>
            <label htmlFor="setup-driver" className="block text-xs font-medium text-fg-default mb-1">
              数据库类型
            </label>
            <select
              id="setup-driver"
              className="pl-input w-full notranslate"
              translate="no"
              value={databaseType}
              onChange={(e) => handleDatabaseTypeChange(e.target.value as DatabaseType)}
              data-testid="setup-driver"
              data-setup-dirty
            >
              {DATABASE_TYPES.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
            {databaseType === "starrocks" || databaseType === "doris" ? (
              <p className="text-xs text-fg-muted mt-1" data-testid="setup-engine-hint">
                底层走 MySQL 协议；超时策略与原生 MySQL 不同，请优先选此类型而非 MySQL。
              </p>
            ) : null}
          </div>
        </div>

        {!isSqlite ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label htmlFor="setup-host" className="block text-xs font-medium text-fg-default mb-1">
              主机地址 <span className="text-danger" aria-hidden="true">*</span>
            </label>
            <input
              id="setup-host"
              type="text"
              className="pl-input w-full notranslate"
              translate="no"
              placeholder="127.0.0.1 或 db.example.com"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              required
              data-testid="setup-host"
            />
          </div>
          <div>
            <label htmlFor="setup-port" className="block text-xs font-medium text-fg-default mb-1">
              端口 <span className="text-danger" aria-hidden="true">*</span>
            </label>
            <input
              id="setup-port"
              type="text"
              className="pl-input w-full notranslate"
              translate="no"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              required
              inputMode="numeric"
              aria-invalid={Boolean(portIssue)}
              aria-describedby={portIssue ? "setup-port-error" : undefined}
              data-testid="setup-port"
            />
            {portIssue ? <p className="text-xs text-danger mt-1" id="setup-port-error">{portIssue}</p> : null}
          </div>
        </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="setup-database" className="block text-xs font-medium text-fg-default mb-1">
              {isSqlite ? "数据库文件路径" : "数据库名"} <span className="text-danger" aria-hidden="true">*</span>
            </label>
            <input
              id="setup-database"
              type="text"
              className="pl-input w-full notranslate"
              translate="no"
              placeholder={isSqlite ? "例如 db/analytics.sqlite" : "如：analytics_db"}
              value={database}
              onChange={(e) => {
                setDatabase(e.target.value);
                if (!isSqlite && !schemaEdited) setSchema(e.target.value);
              }}
              required
              data-testid="setup-database"
            />
          </div>
          <div>
            <label htmlFor="setup-schema" className="block text-xs font-medium text-fg-default mb-1 notranslate" translate="no">
              初始 Schema (可选)
            </label>
            <input
              id="setup-schema"
              type="text"
              className="pl-input w-full notranslate"
              translate="no"
              placeholder={isSqlite ? "留空默认为 main" : database || "留空默认同数据库名"}
              value={schema}
              onChange={(e) => {
                setSchema(e.target.value);
                setSchemaEdited(true);
              }}
              aria-invalid={Boolean(schemaIssue)}
              aria-describedby={schemaIssue ? "setup-schema-error" : undefined}
              data-testid="setup-schema"
            />
            {schemaIssue ? <p className="text-xs text-danger mt-1" id="setup-schema-error">{schemaIssue.message}</p> : null}
          </div>
        </div>

        {!isSqlite ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="setup-username" className="block text-xs font-medium text-fg-default mb-1">
              用户名 <span className="text-danger" aria-hidden="true">*</span>
            </label>
            <input
              id="setup-username"
              type="text"
              className="pl-input w-full notranslate"
              translate="no"
              placeholder="root / readonly_user"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              data-testid="setup-username"
            />
          </div>
          <div>
            <label htmlFor="setup-password" className="block text-xs font-medium text-fg-default mb-1">
              数据库密码 <span className="text-danger" aria-hidden="true">*</span>
            </label>
            <div className="relative">
              <input
                id="setup-password"
                type={showPassword ? "text" : "password"}
                className="pl-input w-full pr-8 notranslate"
                translate="no"
                placeholder="安全密码（一次性写入）"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                data-testid="setup-password"
              />
              <button
                type="button"
                className="absolute right-2 top-2 text-fg-muted hover:text-fg-default"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "隐藏数据库密码" : "显示数据库密码"}
                title={showPassword ? "隐藏数据库密码" : "显示数据库密码"}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between p-4 bg-bg-surface rounded-lg border border-border-default">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="pl-btn pl-btn--outline text-xs"
            disabled={!canProbe || probeMutation.isPending}
            onClick={() => probeMutation.mutate({ fingerprint: probeFingerprint })}
            aria-describedby={!canProbe ? "setup-probe-requirement" : undefined}
            data-testid="setup-probe-btn"
          >
            {probeMutation.isPending ? "正在探测..." : "测试连接"}
          </button>
          {probeMutation.isPending ? (
            <span className="text-xs text-fg-muted" role="status" aria-live="polite">正在进行连通探测...</span>
          ) : probeResult ? (
            probeResult.status === "ok" ? (
              <span className="flex items-center gap-1.5 text-xs text-success-strong font-medium" role="status" aria-live="polite">
                <CheckCircle2 className="w-4 h-4 text-success" />
                连通测试成功 {probeResult.latencyMs != null ? `(${probeResult.latencyMs} ms)` : ""}
              </span>
            ) : (
              <div className="text-xs text-danger" role="alert" aria-live="assertive">
                <span className="flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" aria-hidden="true" />
                  {probeFailure?.summary}
                </span>
                <details className="mt-1 text-fg-muted">
                  <summary className="cursor-pointer font-medium">技术详情</summary>
                  <code className="mt-1 block max-w-lg overflow-x-auto whitespace-pre-wrap break-all notranslate" translate="no">
                    {probeFailure?.technicalDetail}
                  </code>
                </details>
              </div>
            )
          ) : (
            <span className="text-xs text-fg-muted" id="setup-probe-requirement">请先完成连通测试，验证网络与凭据后才能继续。</span>
          )}
        </div>

        <button
          type="button"
          className="pl-btn pl-btn--primary"
          disabled={!canSubmit || createMutation.isPending}
          aria-describedby={!canSubmit ? "setup-step1-next-requirement" : undefined}
          onClick={() => createMutation.mutate()}
          data-testid="setup-step1-next"
        >
          {createMutation.isPending ? "正在创建..." : "继续：准备表结构 →"}
        </button>
      </div>

      {!canSubmit ? (
        <p className="sr-only" id="setup-step1-next-requirement">
          请填写有效参数并完成一次成功的连通测试。
        </p>
      ) : null}

      {submitError ? (
        <div className="p-3 bg-danger/10 border border-danger/30 rounded text-xs text-danger" role="alert">
          {submitError}
        </div>
      ) : null}
    </div>
  );
}
