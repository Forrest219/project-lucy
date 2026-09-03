import type { YamlRole } from "./agents.js";
import { DATA_PLANE_TOOLS, META_TOOLS } from "../proxy/acl.js";

export interface RoleTemplate extends YamlRole {
  id: string;
}

const READONLY_TOOLS = [
  "lucy_catalog",
  "lucy_read_source",
  "lucy_query",
  "lucy_explain_query",
  "lucy_freshness",
  "lucy_begin_question",
  "kx_catalog",
  "wiki_search",
  "wiki_read",
  "entity_details"
];
export const LUCY_R1_EXACT_TOOLS = [
  "lucy_catalog",
  "lucy_read_source",
  "lucy_query",
  "lucy_explain_query",
  "lucy_freshness",
  "lucy_begin_question"
];
const SUPERSTORE_NAMES = ["superstore_orders", "superstore_people", "superstore_returns"];
const POC_R1_NAMES = [
  "poc_metric_catalog",
  "poc_app_active_daily",
  "poc_ad_revenue_daily",
  "poc_ad_revenue_by_type_daily",
  "poc_ceo_metric_snapshot"
];
const KX_NAMES = [
  "kx_dim_company",
  "kx_dim_financial_item",
  "kx_fact_financial_amount",
  "kx_vw_balance_sheet_detail",
  "kx_vw_cash_flow_statement_detail",
  "kx_vw_income_statement_detail"
];

/** Spec 131 — lucy_admin tools = DataPlane ∪ Meta (AbsoluteDeny never included). */
export const LUCY_ADMIN_TOOLS = [...DATA_PLANE_TOOLS, ...META_TOOLS];

export const ROLE_TEMPLATES: Record<string, RoleTemplate> = {
  lucy_admin: {
    id: "lucy_admin",
    description:
      "平台运维数据面（非 WebUI 登录账户）：在已声明连接内绑定启用表目录（catalog_bound）。新连接须手工纳入 allow.connections。",
    permission_model_version: 2,
    allow: {
      connections: [],
      source_scope: "catalog_bound",
      tools: LUCY_ADMIN_TOOLS
    }
  },
  lucy_r1_exact_readonly: {
    id: "lucy_r1_exact_readonly",
    description:
      "Lucy R1 发布证据账号模板：仅允许访问 POC 数据源和 6 个受控查询工具。用于发布验收，不建议作为日常 Agent 角色。",
    allow: {
      connections: ["poc-mysql-aliyun"],
      tableSelectors: [
        {
          connection: "poc-mysql-aliyun",
          schema: "data_agent_poc",
          names: POC_R1_NAMES
        }
      ],
      tools: LUCY_R1_EXACT_TOOLS
    }
  },
  kx_readonly: {
    id: "kx_readonly",
    description: "KX 财务数据只读问答",
    allow: {
      connections: ["mysql-aliyun"],
      tableSelectors: [
        {
          connection: "mysql-aliyun",
          schema: "dataforai",
          names: KX_NAMES
        }
      ],
      tools: READONLY_TOOLS
    }
  },
  superstore_readonly: {
    id: "superstore_readonly",
    description: "Superstore 零售只读",
    allow: {
      connections: ["mysql-aliyun"],
      tableSelectors: [
        {
          connection: "mysql-aliyun",
          schema: "dataforai",
          names: SUPERSTORE_NAMES
        }
      ],
      tools: READONLY_TOOLS
    }
  },
  wiki_only: {
    id: "wiki_only",
    description: "仅访问 wiki / context",
    allow: {
      tools: ["wiki_search", "wiki_read", "dictionary_search", "discover_data"]
    }
  },
  guard_test: {
    id: "guard_test",
    description: "安全 attack 工具，无数据权限",
    allow: {
      connections: ["mysql-aliyun"],
      tools: ["entity_details"]
    }
  },
  dev_superstore: {
    id: "dev_superstore",
    description: "开发者模板：superstore 全表 + wiki + discover",
    allow: {
      connections: ["mysql-aliyun"],
      tableSelectors: [
        {
          connection: "mysql-aliyun",
          schema: "dataforai",
          names: SUPERSTORE_NAMES
        }
      ],
      tools: [...READONLY_TOOLS, "discover_data", "dictionary_search"]
    }
  }
};

export function expandTemplate(templateId: string): YamlRole | undefined {
  const template = ROLE_TEMPLATES[templateId];
  if (!template) return undefined;
  const { id: _id, ...role } = template;
  return structuredClone(role);
}
