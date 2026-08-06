# 上传包目录约定

默认输出到用户桌面或指定目录：

```text
lucy_upload_<domain>/
  README.md                          # 中文导入说明
  <schema>.yaml                      # Schema Manifest
  <source>.yaml                      # 每个 source 一个 overlay
  wiki/global/<playbook>.md          # 业务 Wiki
  evals/<domain>/eval/<domain>-eval-cases.yaml
```

## 导入 Lucy

1. **连接**：`ktx.yaml` 已声明 connection + schema；表在 `enabled_tables`。
2. **语义**：Publish Workbench 上传 Manifest + overlays → Dry-Run → 发布。
3. **Wiki**：打开 `/wiki`，上传 `wiki/global/*.md`（核对 `sl_refs` 的 connection id）。
4. **Eval**：按项目既有 Eval 导入/落盘路径放入 `evals/`（或 WebUI Eval 入口，若环境已支持）。

## connection / sl_refs 格式

```text
<connectionId>/<schema>/<source_or_table>
示例：mysql-aliyun/chatbi/ai_intl_country_daily
```
