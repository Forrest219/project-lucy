export type AuthoringHowToKind = "schema_manifest" | "business_wiki";

const SCHEMA_MANIFEST_NOTES = `# 如何生成 Schema Manifest

把这份说明交给任意 Agent。让它连接用户的数据库，生成一份 Lucy 可以上传的 Schema Manifest。不要假定用户使用哪一个客户端。

## 先向用户确认

- 数据库类型、主机、库名、Schema
- 要包含哪些表。用户没指定时，先列出该 Schema 的表并请用户确认，不要自行选全库

若 Lucy 已经能从这套数据库读取表结构，告诉用户回到接入向导第 2 步，点「从数据库读取表结构」。那条路径会写入最小 Schema Manifest，不必再生成文件。

## 需要文件时的产出

一个 YAML 文件，文件名为 \`<schema>.yaml\`。

\`\`\`yaml
tables:
  orders:
    table: chatbi.orders
    columns:
      - name: id
        type: number
      - name: created_at
        type: time
      - name: status
        type: string
    descriptions:
      db: 订单事实表，一行一笔订单
      ai: 订单
\`\`\`

## 规则

- \`table\` 写成 \`schema.物理表名\`
- 列 \`type\` 只能是 \`string\`、\`number\`、\`time\`、\`boolean\`
- 日期和时间映射为 \`time\`，文本映射为 \`string\`，数值映射为 \`number\`
- \`descriptions.db\` 和 \`descriptions.ai\` 用中文写业务含义
- 若写 joins，\`relationship\` 只能是 \`many_to_one\`、\`one_to_many\`、\`one_to_one\`
- 不要写 \`many_to_many\`
- 不要编造用户没确认的指标公式

## 交给用户

把 YAML 交给用户。用户回到 Lucy 接入向导第 2 步，点「我已有 Schema Manifest」，上传或粘贴这份文件。
`;

const BUSINESS_WIKI_NOTES = `# 如何写业务 Wiki

把这份说明交给任意 Agent。让它为 Lucy 写一份中文口径说明。不要假定用户使用哪一个客户端。

## 先向用户确认

- 连接 ID、Schema、已经启用的表
- 用户在意的指标、单位、统计口径、容易算错的地方
- 用户暂时说不清口径时，按表和字段注释起草，并把不确定的句子标成「待确认」

## 产出

一份 Markdown。要让 Lucy 把文档关联到表时，文件开头写成：

\`\`\`yaml
---
visibility: private
sl_refs:
  - <connectionId>/<schema>/<source_name>
---
\`\`\`

\`source_name\` 与 Schema Manifest 里的表键一致。

正文用中文，写清：

- 这张表代表什么业务对象
- 指标怎么算、单位是什么
- 哪些过滤不能漏
- 常见的算错方式

## 交给用户

用户把正文贴进 Lucy 接入向导第 5 步，或上传这个 Markdown 文件。没有现成口径时，可以先跳过这一步。
`;

export function authoringHowToFilename(kind: AuthoringHowToKind): string {
  return kind === "schema_manifest" ? "lucy-schema-manifest-howto.md" : "lucy-business-wiki-howto.md";
}

export function authoringHowToNotes(kind: AuthoringHowToKind): string {
  return kind === "schema_manifest" ? SCHEMA_MANIFEST_NOTES : BUSINESS_WIKI_NOTES;
}

export function downloadAuthoringHowTo(kind: AuthoringHowToKind): void {
  const content = authoringHowToNotes(kind);
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = authoringHowToFilename(kind);
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
