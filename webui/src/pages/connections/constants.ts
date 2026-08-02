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
    hint: "统计 ktx.yaml 中已声明的连接，可在下方连接卡片逐一核对。"
  },
  missingManifestSchemas: {
    title: "缺 Manifest 的 Schema",
    hint: "统计已配置但还没有本地 Manifest 的 Schema，可在下方 Schema 行查看。"
  },
  localCatalogTables: {
    title: "本地表目录",
    hint: "统计本地 Schema Manifest 中已经读到的表，可对应下方本地表数。"
  },
  unenabledTables: {
    title: "未启用表",
    hint: "统计本地表目录里尚未加入 enabled_tables 的表，缺 Manifest 的未知表不计入。"
  }
} satisfies Record<string, MetricMeta>;

export type MetricType = keyof typeof METRIC_METADATA;
