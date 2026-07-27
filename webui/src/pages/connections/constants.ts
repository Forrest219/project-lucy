export interface MetricMeta {
  title: string;
  description: string;
  question: string;
  healthyRule: string;
}

/**
 * Page-level UX copy for the five connection-overview metric cards.
 * Keep this in the page folder — it's not part of the API data model.
 */
export const METRIC_METADATA = {
  connections: {
    title: "数据连接",
    description: "打通的物理数据库数量，决定跨库联合查询的基础范围。",
    question: "打通了多少个物理数据源？数据孤岛破除了多少？",
    healthyRule: "至少包含 1 个生产/测试数据库"
  },
  enabledTables: {
    title: "启用的表",
    description: "贯彻最小权限原则，显式授权给 Agent / ChatBI 触达的白名单表。",
    question: "在数仓数千张表中，允许 AI 访问的边界在哪里？",
    healthyRule: "按需授权，严禁无脑全量放行（防数据越权与幻觉）"
  },
  semanticTables: {
    title: "语义层对象",
    description: "已补齐字段描述、业务口径与主外键关系的“机读”资产数量。",
    question: "授权的表里，真正被 AI 看懂、查准的数据有多少？",
    healthyRule: "转化率 (Semantic / Enabled) ≥ 80%"
  },
  semanticSources: {
    title: "语义源",
    description: "按 connection/schema 聚合的主题域概览。",
    question: "资产是否形成了高内聚的主题域（如财务域、销售域）？",
    healthyRule: "资产清晰归域名，避免散兵游勇式摆放"
  },
  ktxRuntime: {
    title: "KTX Runtime",
    description: "底层语义编译与计算引擎的运行状态。",
    question: "语义编译与查询底座是否健康可用？",
    healthyRule: "状态保持可用，服务未挂载时及时预警"
  }
} satisfies Record<string, MetricMeta>;

export type MetricType = keyof typeof METRIC_METADATA;
