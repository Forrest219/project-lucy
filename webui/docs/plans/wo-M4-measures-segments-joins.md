# 工单 M4 · Measures / Segments / Joins

> 先读 [README.md 总纲](README.md)。依赖：M3 完成。可与 M5 并行。

## codex 直投 prompt
```
工作目录：/Users/forrest/Projects/project-lucy/webui。先读 docs/codex/README.md、docs/04-data-model.md(§3,§5)、docs/01-architecture.md(ADR-01/10)。
任务：M4 measures/segments/joins 编辑 + candidate join sidecar（见本工单）。
前置：先 spike 验证 yaml Document API 能否增删嵌套节点；`measures/segments` 按 ADR-10 写 overlay 文件。
关键约束：仅 confirmed(formal) join 写正式 YAML；candidate/rejected 写 .ktx-ui sidecar，不污染语义层。
完成后 npm test 贴结果，按 DoD 收尾，停下交回。
```

## 目标
支持编辑 measures / segments，以及 join 的查看/候选/确认；候选关系隔离在 sidecar，不污染正式语义层。

## 必读
`04-data-model.md §3(写入规则) §5(sidecar)`；`01-architecture.md` ADR-01/10；`03-api-spec.md`（joins/candidates）。

## 交付文件
```
server/overlay.ts          # 复用 M2 模块，扩展 measures/segments overlay 写入
server/semantic-layer.ts   # applyPatch 扩展：joins(formal) 写 _schema 节点
server/joins-sidecar.ts    # .ktx-ui/join-candidates.json 读写(经 fs-safe)
src/pages/JoinEditor.tsx
src/components/{MeasureForm,SegmentForm}.tsx
server/__tests__/{semantic-layer.measures,joins-sidecar}.test.ts
```

## 实现步骤
1. **前置 spike**：在 M2 的 `overlay.ts` 基础上，用 `yaml` Document API 在 `semantic-layer/<conn>/<table>.yaml` overlay 中新增 `measures:` / `segments:` 序列节点并 `toString()`，确认增删嵌套结构可行且不破坏文件。结论写进收尾。
2. `overlay.ts` 扩展 measures/segments 写入（复用 M2 的 grain overlay 路径）；`semantic-layer.ts applyPatch` 仅处理 joins 中 `source:formal` 写入 `_schema` 正式 YAML。
3. `joins-sidecar.ts`：candidate/rejected 写 `.ktx-ui/join-candidates.json`（格式见 04 §5），经 fs-safe。→ `GET/PUT /api/joins/candidates`。
4. JoinEditor：展示现有 joins；基于字段名（如 `*_id`）提示候选 join；关系类型 many_to_one/one_to_many/one_to_one；可信度 confirmed/candidate/rejected；confirmed→提升入正式 YAML（走 M3 保存流程）。
5. MeasureForm/SegmentForm：name/expr/filter/description 编辑，接入 dryRun diff + Save。

## 约束（重点）
- **candidate/rejected 绝不进 `semantic-layer/*.yaml`**，只进 `.ktx-ui/` sidecar。
- 新增 measures/segments 写入 overlay 文件，保留既有结构与注释；不要写入 `_schema/<schema>.yaml`。

## 自验
```bash
npm test   # measures 写入 round-trip / sidecar 读写 / confirmed-only 入正式 YAML 用例绿
npm run dev
# 在 superstore_orders 标一个 candidate join → 只进 sidecar，YAML 不变
# confirm 后 → 进 YAML 且 validate 通过
```

## DoD
总纲 §3 全项 + confirmed join 入 YAML 且 validate 通过 + candidate 仅入 sidecar + measures/segments 写入不破坏文件 + spike/探测结论已报告。完成后**停下交回**。
