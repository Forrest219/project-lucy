import type { YamlRole } from "./agents.js";
import { DATA_PLANE_TOOLS, META_TOOLS } from "../proxy/acl.js";
import {
  OPS_EVIDENCE_CONNECTION_ID,
  OPS_EVIDENCE_FROZEN,
  OPS_EVIDENCE_ROLE_ID
} from "../ops-evidence/contract.js";

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

/** Spec 131 preset ops data-plane Role id; formal yaml instance must not be deleted via Admin. */
export const LUCY_ADMIN_ROLE_ID = "lucy_admin";

export function isDeleteProtectedRole(roleId: string): boolean {
  return roleId === LUCY_ADMIN_ROLE_ID;
}

export const ROLE_TEMPLATES: Record<string, RoleTemplate> = {
  lucy_admin: {
    id: LUCY_ADMIN_ROLE_ID,
    description:
      "平台运维数据面（非 WebUI 登录账户）：覆盖全部连接上的已启用表。新连接自动生效。",
    permission_model_version: 2,
    allow: {
      connections: ["*"],
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
  },
  /**
   * Spec 149 §6 — 运维问数角色。
   *
   * 连接只有 `lucy-ops`；表只有两张视图；`row_access: all`；禁止
   * `source_scope: catalog_bound`。`schema` 用 T0 冻结的 schema 字段，
   * `names` 用 sourceName（都**不是** physicalTable）。
   *
   * 工具含目录、查询、解释，以及 Wiki 与 Skill 的四个只读通道工具。
   */
  [OPS_EVIDENCE_ROLE_ID]: {
    id: OPS_EVIDENCE_ROLE_ID,
    description:
      "运维问数角色：只读访问运维问数连接（lucy-ops）的两张调用流水视图，可查看生成 SQL。与 lucy_admin 正交，不并入 lucy_admin。",
    allow: {
      connections: [OPS_EVIDENCE_CONNECTION_ID],
      tableSelectors: [
        {
          connection: OPS_EVIDENCE_CONNECTION_ID,
          schema: OPS_EVIDENCE_FROZEN.schema,
          names: [
            OPS_EVIDENCE_FROZEN.sourceName.ops_calls,
            OPS_EVIDENCE_FROZEN.sourceName.ops_call_tables
          ],
          row_access: "all"
        }
      ],
      tools: [
        "lucy_catalog",
        "connection_list",
        "lucy_query",
        "lucy_read_source",
        "lucy_explain_query",
        "lucy_freshness",
        "lucy_begin_question",
        "wiki_search",
        "wiki_read",
        "lucy_skill_search",
        "lucy_skill_read"
      ]
    }
  }
};

export function expandTemplate(templateId: string): YamlRole | undefined {
  const template = ROLE_TEMPLATES[templateId];
  if (!template) return undefined;
  const { id: _id, ...role } = template;
  return structuredClone(role);
}
