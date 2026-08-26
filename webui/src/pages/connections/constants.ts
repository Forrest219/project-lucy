export interface MetricMeta {
  title: string;
  hint: string;
}

/**
 * Page-level UX copy for the four connection-overview metric cards.
 * Keep this in the page folder — it's not part of the API data model.
 */
export const METRIC_METADATA = {
  connections: {
    title: "数据连接",
    hint: "分子：ktx.yaml connections[] 声明数；分母：无（绝对计数）。可在下方连接卡片逐一核对。"
  },
  missingManifestSchemas: {
    title: "缺 Manifest 的 Schema",
    hint: "分子：已声明 Schema 中本地无对应 Manifest 文件的数量；分母：所有已声明 Schema 数。可在下方 Schema 行查看。"
  },
  localCatalogTables: {
    title: "服务器目录已发现表",
    hint: "分子：当前所有 Schema Manifest 中 tables[] 条目数之和；分母：无（绝对计数，取决于已读取的 Manifest 范围）。"
  },
  unenabledTables: {
    title: "未启用表",
    hint: "分子：本地表目录中未加入 enabled_tables 的表数；分母：本地表目录中已知表总数（缺 Manifest 的未知表不计入分子也不计入分母）。"
  }
} satisfies Record<string, MetricMeta>;

export type MetricType = keyof typeof METRIC_METADATA;
