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
    hint: "已接入的数据库连接数量。可在下方卡片逐一查看。"
  },
  missingManifestSchemas: {
    title: "缺 Manifest 的 Schema",
    hint: "还没有表结构说明的 Schema 数量。可在下方对应行补齐。"
  },
  localCatalogTables: {
    title: "已发现的表",
    hint: "当前已读取到的表数量。"
  },
  unenabledTables: {
    title: "未启用表",
    hint: "已发现但尚未开放查询的表数量。"
  }
} satisfies Record<string, MetricMeta>;

export type MetricType = keyof typeof METRIC_METADATA;
