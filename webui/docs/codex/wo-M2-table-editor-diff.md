# 工单 M2 · 单表编辑与 diff 预览

> 先读 [README.md 总纲](README.md)。依赖：M1 完成。**本里程碑只 dryRun 预览，不落盘**（落盘在 M3）。

## codex 直投 prompt
```
工作目录：/Users/forrest/Projects/project-lucy/webui。先读 docs/codex/README.md、docs/04-data-model.md、docs/01-architecture.md(ADR-01/03/10)。
任务：M2 YAML 就地补丁 + 单表编辑 + diff 预览（dryRun，不落盘）。
关键约束：YAML 必须 parseDocument 就地改 CST 再 toString，严禁 parse→对象→dump；
人工描述写 descriptions.human 保留 ai；grain 写独立 overlay semantic-layer/<conn>/<table>.yaml（ADR-10 已探测，不再重新探测）。
完成后 npm test 贴 round-trip 用例结果，按 DoD 收尾，停下交回。
```

## 目标
让用户在表单里改表/字段描述与 grain，实时看到 diff 与 proposed YAML —— 但**不写盘**。核心难点是 YAML round-trip 不破坏原文件。

## 必读
`01-architecture.md` ADR-01/03/10；`04-data-model.md §2-3`（TableModel / TablePatch / 写入规则）；`03-api-spec.md`（PUT dryRun）。

## 交付文件
```
server/semantic-layer.ts   # 增 applyPatch(就地, _schema 描述) + serialize
server/overlay.ts          # grain overlay 读/创建/合并 + 序列化(M4 measures/segments 复用)
server/diff.ts             # previewDiff(jsdiff, unified)
src/pages/TableEditor.tsx  # 三栏：导航 / 表单(RHF+zod) / preview+diff
src/components/DiffViewer.tsx
server/__tests__/semantic-layer.roundtrip.test.ts
src/__tests__/table-editor.test.tsx
```

## 实现步骤
1. `applyPatch(doc, table, patch)`：在 **CST 节点**上增改——
   - 表/字段描述 → 写/建 `descriptions.human`，**不动 `ai`**；
   - 定位 `tables[table]`、`columns[i]` 节点做就地 set；
   - **不删** patch 未覆盖的键（未知键保留）。
2. `serialize(doc)` = `doc.toString()`，验证保留 `"on"` 引号、注释、key 顺序。
3. `grain` 编辑：按 ADR-10 写入或创建 `semantic-layer/<conn>/<table>.yaml` overlay，不写 `_schema/<schema>.yaml`；dryRun 返回 overlay diff。
4. `diff.ts previewDiff(old,new,path)` → unified diff。
5. `PUT /api/sources/:conn/:schema/:table` 带 `dryRun:true`：加载现有 doc → applyPatch → serialize → previewDiff，返回 `{diff, proposedYaml}`，**不落盘**。
6. TableEditor 三栏：左表/字段导航，中表单（react-hook-form + zod），右 preview+diff；表单变更防抖触发 dryRun。

## 约束（重点）
- ROUND-TRIP 是验收红线：对 `dataforai.superstore_orders` 只改一条描述，diff 必须**只有那一行**变化，`"on"`/注释/顺序/其它表纹丝不动。
- dryRun 期间磁盘文件 mtime/内容不得改变。

## 自验
```bash
npm test   # roundtrip 用例：单字段改动 diff 最小化；human 不覆盖 ai；未知键保留
npm run dev
# 编辑 superstore_orders.order_id 描述 → 右侧 diff 只显示该行；磁盘文件未变
```

## DoD
总纲 §3 全项 + round-trip 单测绿（最小 diff / 保 `"on"` / 保未知键 / 保 ai）+ dryRun 不落盘已验证。完成后**停下交回**。
