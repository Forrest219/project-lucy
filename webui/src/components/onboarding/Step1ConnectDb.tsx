import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Lock, CheckCircle2, AlertCircle } from "lucide-react";
import { apiGet, apiPost } from "../../lib/apiClient";
import {
  ATHENA_CREDENTIAL_HINT,
  DATABASE_TYPES,
  getDatabaseTypeConfig,
  validateConnectionId,
  type DatabaseType,
  type DatabaseTypeConfig
} from "../../lib/connectionId";
import { queryKeys } from "../../lib/queryKeys";
import { validateSchemaName } from "../../lib/schemas";
import { formatProbeFailure } from "../../lib/setupAssistant";
import { readEndpointGate, type EndpointGateState } from "../../lib/connectionEndpointGate";
import { EndpointConflictPanel } from "../connections/EndpointConflictPanel";
import type { CreateConnectionResult, LiveSchemasResponse, ProbeConnectionResult } from "../../lib/types";

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
  onClose?: () => void;
  onSuccess: (result: { connectionId: string; schema: string }) => void;
};

export function Step1ConnectDb({
  initialValues,
  existingIds = [],
  onClose,
  onSuccess
}: Step1ConnectDbProps) {
  const queryClient = useQueryClient();
  const gateEpoch = useRef(0);
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
  const [region, setRegion] = useState("");
  const [s3StagingDir, setS3StagingDir] = useState("");
  const [workgroup, setWorkgroup] = useState("primary");
  const [catalog, setCatalog] = useState("AwsDataCatalog");
  const [schema, setSchema] = useState(initialValues?.schema || "");
  const [schemaEdited, setSchemaEdited] = useState(Boolean(initialValues?.schema));
  const [showPassword, setShowPassword] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeConnectionResult | null>(null);
  const [verifiedProbeFingerprint, setVerifiedProbeFingerprint] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [gate, setGate] = useState<EndpointGateState | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [live, setLive] = useState<{ status: "idle" | "checking" | "missing" | "error"; message?: string }>({
    status: "idle"
  });

  const idIssue = validateConnectionId(id, existingIds);
  const schemaIssue = schema.trim() ? validateSchemaName(schema.trim()) : null;
  const portNum = Number(port);
  const portIssue =
    !Number.isInteger(portNum) || portNum < 1 || portNum > 65535
      ? "端口须为 1–65535 的整数"
      : null;

  const isSqlite = databaseType === "sqlite";
  const isAthena = databaseType === "athena";
  const regionOk = /^[a-z]{2}-[a-z]+-\d$/.test(region.trim());
  const stagingOk = s3StagingDir.trim().startsWith("s3://") && !/\s/.test(s3StagingDir.trim());
  const canProbe = isAthena
    ? Boolean(regionOk && stagingOk && database.trim())
    : isSqlite
      ? Boolean(database.trim())
      : Boolean(host.trim() && !portIssue && database.trim() && username.trim() && password.length > 0);
  const probeFingerprint = JSON.stringify({
    databaseType,
    driver,
    engine: engine.trim(),
    wireProtocol: wireProtocol.trim(),
    host: isSqlite || isAthena ? "" : host.trim(),
    port: isSqlite || isAthena ? "" : portNum,
    database: database.trim(),
    username: isSqlite || isAthena ? "" : username.trim(),
    password: isSqlite || isAthena ? "" : password,
    region: isAthena ? region.trim() : "",
    s3StagingDir: isAthena ? s3StagingDir.trim() : "",
    workgroup: isAthena ? workgroup.trim() : "",
    catalog: isAthena ? catalog.trim() : "",
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
      apiPost<ProbeConnectionResult>("/api/connections/probe", isAthena
        ? {
            driver,
            readonly: true,
            database: database.trim(),
            region: region.trim(),
            s3StagingDir: s3StagingDir.trim(),
            ...(workgroup.trim() ? { workgroup: workgroup.trim() } : {}),
            ...(catalog.trim() ? { catalog: catalog.trim() } : {})
          }
        : {
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

  useEffect(() => {
    gateEpoch.current += 1;
    setGate(null);
    setLive({ status: "idle" });
    setSelectedMatchId(null);
  }, [id, driver, engine, host, port, database, username, schema]);

  const createMutation = useMutation({
    mutationFn: (input: {
      acknowledgeSeparateConnection?: boolean;
      acknowledgeDifferentDatabase?: boolean;
      epoch: number;
    }) =>
      apiPost<CreateConnectionResult>("/api/connections", isAthena
        ? {
            id: id.trim(),
            driver,
            readonly: true,
            database: database.trim(),
            region: region.trim(),
            s3StagingDir: s3StagingDir.trim(),
            ...(workgroup.trim() ? { workgroup: workgroup.trim() } : {}),
            ...(catalog.trim() ? { catalog: catalog.trim() } : {}),
            schemas: schema.trim() ? [schema.trim()] : [database.trim()],
            dryRun: false
          }
        : {
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
            dryRun: false,
            ...(input.acknowledgeSeparateConnection ? { acknowledgeSeparateConnection: true } : {}),
            ...(input.acknowledgeDifferentDatabase ? { acknowledgeDifferentDatabase: true } : {})
          }),
    onSuccess: (res, input) => {
      if (input.epoch !== gateEpoch.current) return;
      const nextSchema = schema.trim() || (isSqlite ? "main" : database.trim());
      onSuccess({
        connectionId: res.connection.id,
        schema: nextSchema
      });
    },
    onError: (err, input) => {
      if (input.epoch !== gateEpoch.current) return;
      const nextGate = readEndpointGate(err);
      if (nextGate) {
        setGate(nextGate);
        setLive({ status: "idle" });
        setSelectedMatchId(null);
        setSubmitError(null);
        return;
      }
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  });

  const createdSchema = schema.trim() || (isSqlite ? "main" : database.trim());

  async function addSchemaToExisting(connectionId: string, schemaName: string) {
    setLive({ status: "checking" });
    try {
      const found = await apiGet<LiveSchemasResponse>(
        `/api/connections/${encodeURIComponent(connectionId)}/live-schemas?refresh=1`
      );
      if (found.status !== "ok") {
        setLive({ status: "error", message: found.reason || "无法读取库内 Schema" });
        return;
      }
      if (!found.schemas.some((item) => item.schema === schemaName)) {
        setLive({ status: "missing" });
        return;
      }
      await apiPost(`/api/connections/${encodeURIComponent(connectionId)}/schemas`, {
        schema: schemaName,
        dryRun: false
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.project });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectionTables(connectionId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectionLiveSchemas(connectionId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalogReloads });
      onSuccess({ connectionId, schema: schemaName });
    } catch (err) {
      setLive({
        status: "error",
        message: err instanceof Error ? err.message : "无法读取库内 Schema"
      });
    }
  }

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
            {isAthena ? (
              <p className="text-xs text-fg-muted mt-1" data-testid="setup-athena-hint">
                {ATHENA_CREDENTIAL_HINT}
              </p>
            ) : null}
          </div>
        </div>

        {isAthena ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="setup-region" className="block text-xs font-medium text-fg-default mb-1">
                区域 <span className="text-danger" aria-hidden="true">*</span>
              </label>
              <input
                id="setup-region"
                type="text"
                className="pl-input w-full notranslate"
                translate="no"
                placeholder="例如 eu-west-1"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                required
                data-testid="setup-region"
              />
            </div>
            <div>
              <label htmlFor="setup-s3-staging-dir" className="block text-xs font-medium text-fg-default mb-1">
                结果目录 <span className="text-danger" aria-hidden="true">*</span>
              </label>
              <input
                id="setup-s3-staging-dir"
                type="text"
                className="pl-input w-full notranslate"
                translate="no"
                placeholder="例如 s3://bucket/athena-results/"
                value={s3StagingDir}
                onChange={(e) => setS3StagingDir(e.target.value)}
                required
                data-testid="setup-s3-staging-dir"
              />
            </div>
            <div>
              <label htmlFor="setup-workgroup" className="block text-xs font-medium text-fg-default mb-1">
                工作组
              </label>
              <input
                id="setup-workgroup"
                type="text"
                className="pl-input w-full notranslate"
                translate="no"
                value={workgroup}
                onChange={(e) => setWorkgroup(e.target.value)}
                data-testid="setup-workgroup"
              />
            </div>
            <div>
              <label htmlFor="setup-catalog" className="block text-xs font-medium text-fg-default mb-1">
                数据目录
              </label>
              <input
                id="setup-catalog"
                type="text"
                className="pl-input w-full notranslate"
                translate="no"
                value={catalog}
                onChange={(e) => setCatalog(e.target.value)}
                data-testid="setup-catalog"
              />
            </div>
          </div>
        ) : null}

        {!isSqlite && !isAthena ? (
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
              {isSqlite ? "数据库文件路径" : isAthena ? "默认数据库" : "数据库名"} <span className="text-danger" aria-hidden="true">*</span>
            </label>
            <input
              id="setup-database"
              type="text"
              className="pl-input w-full notranslate"
              translate="no"
              placeholder={isSqlite ? "例如 db/analytics.sqlite" : isAthena ? "例如 da_moji" : "如：analytics_db"}
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
              {isAthena ? "初始 Glue 数据库 (可选)" : "初始 Schema (可选)"}
            </label>
            <input
              id="setup-schema"
              type="text"
              className="pl-input w-full notranslate"
              translate="no"
              placeholder={isSqlite ? "留空默认为 main" : isAthena ? "留空默认同默认数据库，写入 databases" : database || "留空默认同数据库名"}
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

        {!isSqlite && !isAthena ? (
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
          hidden={Boolean(gate && gate.kind !== "schema_count")}
          onClick={() => createMutation.mutate({ epoch: gateEpoch.current })}
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

      {gate ? (
        <EndpointConflictPanel
          gate={gate}
          schemaName={createdSchema || null}
          selectedId={selectedMatchId}
          onSelect={setSelectedMatchId}
          live={live}
          pending={createMutation.isPending}
          onAddSchema={(connectionId, schemaName) => {
            void addSchemaToExisting(connectionId, schemaName);
          }}
          onRetryLive={(connectionId, schemaName) => {
            void addSchemaToExisting(connectionId, schemaName);
          }}
          onSeparateConnection={() =>
            createMutation.mutate({ acknowledgeSeparateConnection: true, epoch: gateEpoch.current })
          }
          onDifferentDatabase={() =>
            createMutation.mutate({ acknowledgeDifferentDatabase: true, epoch: gateEpoch.current })
          }
          onBackToExisting={() => onClose?.()}
        />
      ) : null}

      {submitError ? (
        <div className="p-3 bg-danger/10 border border-danger/30 rounded text-xs text-danger" role="alert">
          {submitError}
        </div>
      ) : null}
    </div>
  );
}
