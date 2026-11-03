# 访问关系图与访问日志口径对齐 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.3** / 2026-11-02 |
| 目标版本 / 优先级 | 不绑定产品版本号 / **P1**。功能编号无，不进入 v0.25 登记册 |
| 主 Spec | [`docs/specs/lucy-20261102-access-map-audit-echo-spec.md`](../specs/lucy-20261102-access-map-audit-echo-spec.md)（**v0.3 可定稿**） |
| 权威语义 | Spec 187 路径／信任；inquiry-kind Spec；Spec 194／`usage-classification`；chart-first 弱入口 |
| 状态 | **Deferred → `0.30.0` 池 [`REQ-030-003`](lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)（2026-11-03）**。v0.3 可定稿保留；本版不授权开发。本条收口不表示可上线。记录见 [A／B 剥离](../reviews/2026-11-03-product-close-peel-a-b.md) |
| 授权边界 | 文档与 Codex 审阅已完成。**仍未授权**改 `webui/server`／`webui/src` 运行代码、git commit、镜像、部署、浏览器走查——须用户另行明确授权落地 |
| 验收 | 以主 Spec §7 SC-01–SC-20 为准 |
| 实施主体 | Lucy：`webui/server/admin/access-map.ts`、`webui/src/pages/admin/AccessMap.tsx`、相关组件与测试 |
| 待拍板 | D1–D13 以主 Spec §4 为准。定稿不自动授权开发 |
| 审阅 | [`docs/reviews/2026-11-02-codex-review-access-map-audit-echo.md`](../reviews/2026-11-02-codex-review-access-map-audit-echo.md) |

## 1. 目标

1. 主工具条：问询种类、访问等级；缺省与访问日志一致（参数缺省时）。
2. 「问询计入」→ 弱入口「关联口径」；筛选行对齐。
3. 投影集合 E 与跨边并集可打假；非法新参数 400。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | 主 Spec 经 Codex 两轮后定稿 | **满足**（v0.3） |
| P2 | 用户明确授权改 access-map 服务端与页面 | 未满足 |
| P3 | 基线可跑：`p1-access-map.test.ts`、`access-map.test.tsx`、`access-map-layout.test.tsx` | 开工时确认 |

未满足 P1／P2 时停在文档。

## 3. 文件落点

### 3.1 预计修改

| 路径 | 改动 | 阶段 |
|---|---|---|
| `webui/server/admin/access-map-echo.ts`（新建）或等价 | EchoFilter、关联解析、E 构建；复用 inquiry-kind 与 accessGradeSql；触发与审计相同的推断重建准备 | S1 |
| `webui/server/admin/access-map.ts` | 构建 B／E／D；路径用 E；deniedCalls=\|D\|；meta.echo.enteringAllowCallCount=\|E\|（结构筛选前）；parse 非法 inquiryKind／accessGrade → 400 | S1 |
| `webui/server/admin/routes/access-map.ts` | 若需，保持非法 400 行为 | S1 |
| `webui/server/__tests__/p1-access-map.test.ts` | SC-03（服务端）、SC-09–SC-16、SC-19 | S1 |
| `webui/src/pages/admin/AccessMap.tsx` | 工具条下拉；弱入口关联口径；空态文案 | S2 |
| `webui/src/components/admin/AccessMapLegend.tsx` | 「关联口径」 | S2 |
| `webui/src/__tests__/access-map.test.tsx` | SC-01–SC-09（组件）、SC-17–SC-18 | S2 |
| `webui/docs/187-access-relation-sankey-spec.md` | §4.2／§5.2／§6.3／§7.4 指针 | S3 |
| `docs/specs/lucy-20261101-access-map-chart-first-spec.md` | 工具条／弱入口指针 | S3 |
| `webui/docs/00-product-terminology-standard.md` | 退役「问询计入」产品句 | S3 |
| `docs/README.md`／`docs/plans/README.md` | 状态镜像 | S3 |

### 3.2 不改

- `usage-classification.ts` 名单
- `audit-inquiry-kind.ts` 判定逻辑（只复用）
- 授权构图与 geometry
- 凭证清单 Default Usage
- KTX

## 4. 分阶段实施

### S1 服务端（SC-03 服务端、SC-09–SC-16、SC-19）

1. 非法 `inquiryKind`／`accessGrade` → 400；缺省未出现 → management／exclude_connect。
2. 推断重建准备失败 → access unavailable。
3. D6 关联序；构建 B／E／D；路径用 E；deniedCalls=\|D\|；meta.echo.enteringAllowCallCount=\|E\|（标明结构筛选前）；结构筛选前 ⋃I(e)=E。
4. 夹具覆盖 SC-10–SC-15、SC-19；含 scope／focus 后并集变小但 count 不变、layer 不改 E、deny 进 D 不进 E；期望 id 集预写，禁止只比数量。

### S2 工具条与弱入口（SC-01–SC-09 组件、SC-17–SC-18）

1. 去掉主工具条 trust 分段与 hint。
2. 问询种类／访问等级下拉；弱入口关联口径。
3. LegendMeta「关联口径」；E 空提示不声称全量无访问。

### S3 文档指针（SC-20）与落盘自查

1. 更新 Spec 187 §4.2／§5.2／§6.3／§7.4、chart-first、术语标准。
2. 按 DEVELOPMENT 落盘清单自查；跑 `lint:spec-docs`、`lint:spec`、`lint:terminology`、`lint:ia-boundary` 并记结果。
3. 同步 Spec／Plan／索引状态镜像。

## 5. 验收

```bash
cd webui && npx vitest run src/__tests__/access-map.test.tsx src/__tests__/access-map-layout.test.tsx
cd webui && npx vitest run server/__tests__/p1-access-map.test.ts
npm run lint:spec-docs && npm run lint:spec && npm run lint:terminology && npm run lint:ia-boundary
```

## 6. 完成定义

- SC-01–SC-20 有对应证据
- 无「问询计入」主控件；弱入口可改关联口径
- 无第二份枚举；E 与期望集逐项相等有测
- 文档指针与索引镜像已更新；四项 lint 记录在实施笔记
- 本条收口不表示可上线

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 缺省变严图空 | 夹具＋空态文案 |
| 重建失败被吞 | unavailable＋SC-12 |
| trust 400 与新参 400 | SC-09／SC-19 |

## 8. Codex 审阅

- 用户指定两轮。第 1 轮退回 → v0.2；第 2 轮退回（中 2）→ v0.3 闭合定稿，未开第 3 轮。
- 摘录：`inbox/codex-prompt-access-map-audit-echo-roundN.md`、`inbox/codex-review-access-map-audit-echo-roundN.txt`
- 汇总：`docs/reviews/2026-11-02-codex-review-access-map-audit-echo.md`
