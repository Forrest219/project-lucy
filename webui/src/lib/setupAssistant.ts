import type { ConnectionInfo } from "./types";
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
    title: "挂载数据资产清单",
    subtitle: "告诉 Lucy 您的数据库中有哪些表和字段 (Schema Manifest)",
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
    subtitle: "补充指标、维度与计算口径 (Semantic Overlay)",
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
    title: "连接 AI 客户端",
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

/**
 * Compute progress summary label for connection card.
 */
export function formatAssistantProgressLabel(step: SetupStep): string {
  const meta = SETUP_STEPS.find((s) => s.step === step);
  return `向导进度: ${step}/6 · 待${meta ? meta.title : "继续配置"}`;
}

/**
 * Build copy-pasteable client configurations for MCP.
 */
export function buildClientConfigs(
  endpointUrl: string,
  token: string = MCP_TOKEN_PLACEHOLDER,
  connectionId?: string
): Record<ClientType, ClientConfigItem> {
  const safeEndpoint = endpointUrl || "http://127.0.0.1:7879/mcp";
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
