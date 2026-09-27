import type {
  ConnectionInfo,
  McpRuntimeStatus,
  SourceSummary,
  SourcesResponse
} from "./types";
import { MCP_TOKEN_PLACEHOLDER } from "./mcpEndpoint";

export type SetupStep = 1 | 2 | 3 | 4 | 5 | 6;

export type StepKey =
  | "connect_db"
  | "upload_manifest"
  | "select_tables"
  | "semantic_overlay"
  | "business_wiki"
  | "connect_agent";

export type StepMeta = {
  step: SetupStep;
  key: StepKey;
  title: string;
  subtitle: string;
  isOptional: boolean;
};

export const SETUP_STEPS: StepMeta[] = [
  {
    step: 1,
    key: "connect_db",
    title: "连接数据库",
    subtitle: "输入数据库连接信息，建立与数据底座的安全链路",
    isOptional: false
  },
  {
    step: 2,
    key: "upload_manifest",
    title: "上传 Schema Manifest",
    subtitle: "上传描述数据库表与字段的 Schema Manifest",
    isOptional: false
  },
  {
    step: 3,
    key: "select_tables",
    title: "选择启用表",
    subtitle: "圈定开放给 AI 问答的数据表范围 (enabled_tables)",
    isOptional: false
  },
  {
    step: 4,
    key: "semantic_overlay",
    title: "丰富业务语义",
    subtitle: "补充指标、维度与计算口径 (semantic overlay)",
    isOptional: true
  },
  {
    step: 5,
    key: "business_wiki",
    title: "注入业务知识",
    subtitle: "上传业务口径说明与分析指引文档 (Business Wiki)",
    isOptional: true
  },
  {
    step: 6,
    key: "connect_agent",
    title: "连接 Agent 客户端",
    subtitle: "配置 MCP 服务并在您的 Agent 中体验首条数据问答",
    isOptional: false
  }
];

export type ClientType = "cursor" | "claude_code" | "codex" | "json";

export type ClientConfigItem = {
  type: ClientType;
  label: string;
  filenameHint?: string;
  snippet: string;
};

/**
 * Infer current setup progress step based on existing backend assets.
 */
export function inferCurrentStep(options: {
  connection?: ConnectionInfo | null;
  hasManifest?: boolean;
  enabledTableCount?: number;
  overlayCount?: number;
  wikiCount?: number;
}): SetupStep {
  const { connection, hasManifest = false, enabledTableCount = 0 } = options;

  if (!connection) {
    return 1;
  }

  if (connection.schemas.length === 0 || !hasManifest) {
    return 2;
  }

  if (enabledTableCount === 0) {
    return 3;
  }

  // If tables are enabled and manifest is present, but no overlay, can resume at 4.
  // If overlay or skipped, step 5 or 6 can be used.
  if ((options.overlayCount ?? 0) === 0) {
    return 4;
  }

  if ((options.wikiCount ?? 0) === 0) {
    return 5;
  }

  return 6;
}

export type SetupAssistantResumeState = {
  step: SetupStep;
  schema: string;
  hasManifest: boolean;
  enabledTables: string[];
  availableTables: SourceSummary[];
};

/**
 * Rebuild the resumable wizard state from backend assets. Local draft progress
 * may only advance optional steps after all required guards still pass.
 */
export function deriveAssistantResumeState(options: {
  connection?: ConnectionInfo | null;
  sources?: SourcesResponse | null;
  draft?: SetupAssistantDraft | null;
}): SetupAssistantResumeState {
  const connection = options.connection ?? null;
  if (!connection) {
    return {
      step: 1,
      schema: "",
      hasManifest: false,
      enabledTables: [],
      availableTables: []
    };
  }

  const sourceTables = options.sources?.tables ?? [];
  const connectionTables = sourceTables.filter((table) => table.conn === connection.id);
  const schema =
    connection.schemas[0] ?? connectionTables[0]?.schema ?? "";
  const availableTables = connectionTables.filter(
    (table) => !schema || table.schema === schema
  );
  const hasManifest = Boolean(
    options.sources?.manifestSchemas?.some(
      (manifest) =>
        manifest.conn === connection.id && (!schema || manifest.schema === schema)
    ) || availableTables.length > 0
  );
  const requiredStep = inferCurrentStep({
    connection,
    hasManifest,
    enabledTableCount: connection.enabledTables.length
  });
  const draftStep = options.draft?.step ?? requiredStep;
  const step = (
    requiredStep <= 3
      ? requiredStep
      : Math.max(requiredStep, draftStep)
  ) as SetupStep;

  return {
    step,
    schema,
    hasManifest,
    enabledTables: [...connection.enabledTables],
    availableTables
  };
}

export type SetupReadinessIssueCode =
  | "connection_missing"
  | "connection_probe_failed"
  | "manifest_missing"
  | "enabled_tables_empty"
  | "config_not_loaded"
  | "catalog_not_synced"
  | "policy_not_ready"
  | "execution_not_ready"
  | "endpoint_not_ready";

export type SetupReadinessIssue = {
  code: SetupReadinessIssueCode;
  message: string;
};

export type SetupReadiness = {
  serviceReady: boolean;
  clientReady: boolean;
  issues: SetupReadinessIssue[];
};

/** Build the user-visible readiness verdict from the same runtime facts used by the console. */
export function deriveSetupReadiness(options: {
  connection?: ConnectionInfo | null;
  sources?: SourcesResponse | null;
  runtime?: McpRuntimeStatus | null;
  probeStatus?: "ok" | "error" | "pending" | "unknown";
  endpointReady: boolean;
  credentialReady?: boolean;
}): SetupReadiness {
  const issues: SetupReadinessIssue[] = [];
  const connection = options.connection ?? null;
  const runtime = options.runtime ?? null;

  if (!connection) {
    issues.push({ code: "connection_missing", message: "连接配置尚未写入。" });
  }

  if (options.probeStatus !== "ok") {
    issues.push({
      code: "connection_probe_failed",
      message:
        options.probeStatus === "pending"
          ? "正在确认数据库连通性。"
          : "数据库连通性尚未通过。"
    });
  }

  const schemas = connection?.schemas ?? [];
  const hasManifest = Boolean(
    connection &&
      (options.sources?.manifestSchemas?.some(
        (manifest) => manifest.conn === connection.id && schemas.includes(manifest.schema)
      ) ||
        options.sources?.tables?.some(
          (table) => table.conn === connection.id && schemas.includes(table.schema)
        ))
  );
  if (!hasManifest) {
    issues.push({ code: "manifest_missing", message: "尚未读取到 Schema Manifest。" });
  }

  if (!connection?.enabledTables.length) {
    issues.push({ code: "enabled_tables_empty", message: "启用表范围为空。" });
  }

  if (!connection || !runtime?.config?.connectionIds?.includes(connection.id)) {
    issues.push({ code: "config_not_loaded", message: "运行时尚未读取连接配置。" });
  }

  const catalogRun = connection
    ? runtime?.catalog?.lastByConnection?.[connection.id]
    : undefined;
  if (catalogRun?.status !== "success") {
    issues.push({ code: "catalog_not_synced", message: "Catalog 尚未同步成功。" });
  }

  if (!runtime?.policy?.healthy) {
    issues.push({ code: "policy_not_ready", message: "Policy Runtime 尚未确认。" });
  }

  const executionReady = Boolean(
    connection &&
      runtime &&
      !runtime.execution?.missingConnections?.includes(connection.id) &&
      (runtime.execution?.loadedConnectionIds?.includes(connection.id) ||
        runtime.execution?.status === "ok")
  );
  if (!executionReady) {
    issues.push({
      code: "execution_not_ready",
      message: "MCP Execution 尚未确认加载该连接。"
    });
  }

  if (!options.endpointReady) {
    issues.push({ code: "endpoint_not_ready", message: "MCP Endpoint 尚未配置完成。" });
  }

  const serviceReady = issues.length === 0;
  return {
    serviceReady,
    clientReady: serviceReady && Boolean(options.credentialReady),
    issues
  };
}

export function formatProbeFailure(message: string): {
  summary: string;
  technicalDetail: string;
} {
  const technicalDetail = message.trim();
  const normalized = technicalDetail.toLowerCase();
  if (/eai_again|enotfound|getaddrinfo/.test(normalized)) {
    return {
      summary: "无法解析主机地址，请检查主机名或 DNS 配置。",
      technicalDetail
    };
  }
  if (/econnrefused|connection refused/.test(normalized)) {
    return {
      summary: "目标主机拒绝连接，请检查地址、端口和数据库服务状态。",
      technicalDetail
    };
  }
  if (/etimedout|timed out|timeout/.test(normalized)) {
    return {
      summary: "连接超时，请检查网络、防火墙或数据库访问策略。",
      technicalDetail
    };
  }
  if (/access denied|authentication|password|credential/.test(normalized)) {
    return {
      summary: "数据库身份验证失败，请检查用户名和数据库密码。",
      technicalDetail
    };
  }
  return {
    summary: "连通测试失败，请检查连接参数后重试。",
    technicalDetail
  };
}

/**
 * Compute progress summary label for connection card.
 */
export function formatAssistantProgressLabel(step: SetupStep): string {
  const meta = SETUP_STEPS.find((s) => s.step === step);
  return `接入进度 ${step}/6 · 当前：${meta ? meta.title : "继续配置"}`;
}

/** Placeholder when callers have not yet loaded `GET /api/project.mcpEndpoint.url`. */
export const MCP_ENDPOINT_PLACEHOLDER = "<LUCY_PUBLIC_MCP_URL>";

/**
 * Build copy-pasteable client configurations for MCP.
 *
 * Endpoint must come from `GET /api/project.mcpEndpoint.url` (or an explicit
 * caller-supplied URL). Do not invent `localhost` / `127.0.0.1` defaults here —
 * those are only produced by the backend local-dev fallback in
 * `resolveMcpEndpoint`.
 */
export function buildClientConfigs(
  endpointUrl: string,
  token: string = MCP_TOKEN_PLACEHOLDER,
  connectionId?: string
): Record<ClientType, ClientConfigItem> {
  const safeEndpoint = endpointUrl.trim() || MCP_ENDPOINT_PLACEHOLDER;
  const serverName = connectionId ? `lucy-${connectionId}` : "lucy-data-agent";

  const cursorJson = JSON.stringify(
    {
      mcpServers: {
        [serverName]: {
          url: safeEndpoint,
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      }
    },
    null,
    2
  );

  const claudeCodeCommand = `claude mcp add ${serverName} ${safeEndpoint} --header "Authorization: Bearer ${token}"`;

  const codexToml = [
    `# ~/.codex/config.toml`,
    `[mcp_servers.${serverName}]`,
    `url = "${safeEndpoint}"`,
    `type = "http"`,
    `headers = { Authorization = "Bearer ${token}" }`
  ].join("\n");

  const jsonSnippet = JSON.stringify(
    {
      name: serverName,
      type: "http",
      url: safeEndpoint,
      headers: {
        Authorization: `Bearer ${token}`
      }
    },
    null,
    2
  );

  return {
    cursor: {
      type: "cursor",
      label: "Cursor",
      filenameHint: "粘贴到 ~/.cursor/mcp.json 或 Settings > MCP",
      snippet: cursorJson
    },
    claude_code: {
      type: "claude_code",
      label: "Claude Code",
      filenameHint: "在终端中直接运行命令添加 MCP 服务",
      snippet: claudeCodeCommand
    },
    codex: {
      type: "codex",
      label: "OpenAI Codex",
      filenameHint: "添加到 ~/.codex/config.toml 配置文件中",
      snippet: codexToml
    },
    json: {
      type: "json",
      label: "通用 JSON",
      filenameHint: "标准 MCP HTTP/SSE 协议配置对象",
      snippet: jsonSnippet
    }
  };
}

/**
 * Generate a recommended "Hello World" query for the user to try first.
 */
export function buildHelloWorldPrompt(connectionId?: string, defaultTable?: string): string {
  const target = connectionId ? `「${connectionId}」` : "当前数据库";
  if (defaultTable) {
    return `请帮我查询 ${target} 中 ${defaultTable} 表的字段结构，并统计总记录数。`;
  }
  return `请列出 ${target} 中所有已启用的数据表，并简要概括各表的业务含义。`;
}

// LocalStorage helpers for draft persistence
const DRAFT_KEY_PREFIX = "lucy_setup_draft_";

export type SetupAssistantDraft = {
  connectionId?: string;
  step?: SetupStep;
  form?: Record<string, unknown>;
  selectedTables?: string[];
  skippedSteps?: SetupStep[];
  updatedAt?: string;
};

export function getAssistantDraft(connectionId: string): SetupAssistantDraft | null {
  try {
    const raw = localStorage.getItem(`${DRAFT_KEY_PREFIX}${connectionId}`);
    if (!raw) return null;
    return JSON.parse(raw) as SetupAssistantDraft;
  } catch {
    return null;
  }
}

export function setAssistantDraft(connectionId: string, draft: Partial<SetupAssistantDraft>): void {
  try {
    const existing = getAssistantDraft(connectionId) || {};
    const merged: SetupAssistantDraft = {
      ...existing,
      ...draft,
      connectionId,
      updatedAt: new Date().toISOString()
    };
    localStorage.setItem(`${DRAFT_KEY_PREFIX}${connectionId}`, JSON.stringify(merged));
  } catch {
    // Ignore localStorage write failures
  }
}

export function clearAssistantDraft(connectionId: string): void {
  try {
    localStorage.removeItem(`${DRAFT_KEY_PREFIX}${connectionId}`);
  } catch {
    // Ignore
  }
}
