# 访问关系图图优先呈现 — Claude Code（coder）交付提示词

| 元数据 | 内容 |
|---|---|
| 文档类型 | 开发交付提示词 |
| 版本 / 日期 | v1.0 / 2026-11-01 |
| 角色 | **coder**（按已批准 Spec/Plan 实现；不得私改 Spec） |
| 主 Spec | [`docs/specs/lucy-20261101-access-map-chart-first-spec.md`](../specs/lucy-20261101-access-map-chart-first-spec.md) v0.1 |
| 主 Plan | [`docs/plans/lucy-20261101-access-map-chart-first-plan.md`](lucy-20261101-access-map-chart-first-plan.md) v0.1 |
| 权威语义 | [`webui/docs/187-access-relation-sankey-spec.md`](../../webui/docs/187-access-relation-sankey-spec.md)（本条不改语义） |
| 前序呈现 | [`docs/specs/lucy-20261030-access-map-quiet-reading-spec.md`](../specs/lucy-20261030-access-map-quiet-reading-spec.md)（页壳被本条取代；着色/抽屉/表保持） |
| 委托人 | xingchen |

## 0. 使用方法

1. 新开 Claude Code 会话。
2. 粘贴下方「§1 完整提示词」整段发送。
3. 审阅其交付报告：RED/GREEN 有真实命令输出；diff 不越界；SC 有落点。
4. **不要**让 coder 自行 `git commit` / `git push`（除非你另发提交指令）。
5. 完整交付模式交接文件：仓库根或 `inbox/` 下的 `IMPLEMENTATION_NOTES.md`（见 `docs/agent-pipeline.md`）。

---

## 1. 完整提示词（直接粘贴）

```text
你是 project-lucy 的 coder（实现角色）。按已批准的呈现修订 Spec / Plan 落地代码与测试。你只改实现与测试契约；不得私改 Spec 正文决策。

【权威依据 — 先读再写，禁止凭印象】
1. docs/specs/lucy-20261101-access-map-chart-first-spec.md （主合同 v0.1；D1–D8 已拍板；SC-01–SC-14）
2. docs/plans/lucy-20261101-access-map-chart-first-plan.md （S1→S2→S3；文件落点与验收命令）
3. webui/docs/187-access-relation-sankey-spec.md （语义权威：API、边状态、两档措辞、Token 句、URL 值 — 本条不改）
4. docs/specs/lucy-20261030-access-map-quiet-reading-spec.md （§5.3 着色、§5.5 抽屉、§5.6 表保持；§5.1 三卡+双折叠被本条取代）
5. AGENTS.md → docs/governance/DEVELOPMENT.md
6. webui/docs/00-product-terminology-standard.md
7. docs/agent-pipeline.md（coder：可修实现，不可私改 SPEC；自愈 ≤ 3 次）

【本条产品决议（必须做到）】
- 方案 A′：去掉默认首屏三张信号 Metric Card；去掉「口径说明」「快照」两个独立宽条 details。
- 本轮不做信号筛选 UI（删除筛选 state / 死代码优先）。
- 关系图视图：图例短行（仅四项色块/线型）在图正上方；data-testid="access-map-legend"。
- 图下方单个弱入口「口径与快照」（默认关）：迁入口径全文、覆盖率、调用数、孤儿说明、trust/window ISO、access-map-snapshot-id 等（见 Spec §5.4）。
- Partial 等降级保留为轻量 pl-notice +「前往配置审计」；保留 access-map-partial-notice。
- 抬高图区 min-height、加大列间距；节点/边自定义可读悬停浮层（不能只靠 SVG <title>）；点击边仍开既有抽屉。
- 不改 /api/admin/access-map、KTX、边状态机、两档措辞、Token 过滤原文、URL 参数合法值。
- 禁止页面标题/导航使用「桑基图」；需复核文案禁止出现「越权」。
- 选中态禁止 pl-btn--primary。不新增运行时依赖；不新增裸十六进制颜色。

【硬约束】
1. 开工先 `git status --short` 记录基线；只改本任务相关文件（见 Plan §3）；不碰无关 dirty 文件。
2. TDD：每个可测切片先 RED（跑失败）再实现再 GREEN（跑通过）。不要只写测试不运行。
3. 按 Plan S1 → S2 → S3 顺序；不要跳过页壳先做悬停又留下三卡。
4. 发现 Spec 与代码冲突、或必须改语义才能完成：停止并写 SPEC_GAP_REPORT.md（inbox/ 可），不要私改 Spec 决策句。
5. 自愈同一失败最多 3 次；仍失败写 IMPLEMENTATION_BLOCKER.md 并停止。
6. 不执行 git commit / git push；不构建客户镜像；不部署。本地若需看效果可用 npm run demo:upgrade（保留数据；不要 --no-cache；非用户要求不要 --fresh）。浏览器走查不是本条出口，除非委托人另加。
7. 默认不做移动窄屏测试。
8. 会话结束必须留下 IMPLEMENTATION_NOTES.md（建议路径：inbox/2026-11-01-access-map-chart-first-IMPLEMENTATION_NOTES.md），并在聊天里输出交付报告。

【建议改动面（以 Plan §3 为准）】
- webui/src/pages/admin/AccessMap.tsx
- webui/src/components/admin/AccessMapSignalBar.tsx（三卡卸下；Notes 复用进弱入口）
- webui/src/components/admin/AccessMapLegend.tsx（短行四项 vs trust/window 拆分）
- webui/src/components/admin/AccessMapCanvas.tsx（栏距、min-height、悬停浮层）
- webui/src/__tests__/access-map.test.tsx
- webui/src/__tests__/access-map-layout.test.tsx
- docs/qa/selector-contract.md（必要行）
- S3：quiet-reading Spec / Spec 187 的交叉引用指针（仅指针句，不改语义表）

【验收命令（GREEN 必须真实跑过）】
cd webui && npx vitest run src/__tests__/access-map.test.tsx src/__tests__/access-map-layout.test.tsx
cd <repo-root> && npm run lint:terminology && npm run lint:spec-docs

【立即停止并回报】
- 需要恢复信号卡筛选、改 API、改两档措辞或 URL 语义；
- 大面积无关测试红且无法解释；
- Spec 缺口导致无法按原文实现。

【交付报告格式】
1. 一句话结果：完成 / 部分完成 / BLOCKED
2. 改动文件清单（对照开工 git status 基线，确认无越界）
3. S1/S2/S3 完成情况
4. RED：命令 + 关键失败摘录；GREEN：命令 + 通过摘录；lint 结果
5. SC-01–SC-14 逐条：通过 / 未做 / 受阻（写清测试落点）
6. IMPLEMENTATION_NOTES.md 路径
7. 已知限制与需人决策项
```

---

## 2. 可选：分会话切片（若单会话过长）

每个切片仍先粘贴 §1 中的权威依据与硬约束摘要，再追加下列任务句。

### 会话 A · S1 页壳

```text
【本会话只做 Plan S1】移除三 Metric Card 与双独立 details；图例短行置顶；图下「口径与快照」弱入口；partial notice 保留；删除信号筛选 state。先改 access-map.test.tsx 相关断言再改 DOM。不要做悬停浮层与栏距（留给 S2）。
```

### 会话 B · S2 图面

```text
【本会话只做 Plan S2】在 S1 已合并前提下：加大列间距、图区 min-height、节点/边自定义悬停浮层；回归着色与抽屉。更新 access-map-layout.test.tsx。不要改 API。
```

### 会话 C · S3 文档与门禁

```text
【本会话只做 Plan S3】quiet-reading / Spec 187 呈现指针；selector-contract 收尾；跑 lint:terminology 与 lint:spec-docs；写 IMPLEMENTATION_NOTES.md。不新开功能。
```
