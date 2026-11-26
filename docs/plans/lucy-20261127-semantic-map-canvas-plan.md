# 语义地图（只读 Canvas）· 实施计划

| 元数据 | 内容 |
|---|---|
| 文档名称 | 语义地图（只读 Canvas）· 实施计划 |
| 文档类型 / 版本 | Plan／**v1.0** |
| 日期 / 功能编号 | 2026-11-27／**REQ-0121**（P1） |
| 阶段 | S2 |
| 状态 | S2｜v1.0。配对 Spec **终稿已确权**（委托人 2026-11-27）。Plan／UAT 经 Kimi Code 三轮对抗终轮 **Approve with nits**（见[评审](../reviews/2026-11-27-semantic-map-plan-uat-adversarial-review.md)）。**未获开发授权**；浏览器验证未执行；测试台 `UAT-SUITE-SEMANTIC-MAP`＝**NOT RUN**。≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 授权边界 | Spec 终稿已确权 ≠ 开发授权。未获另发开发授权前禁止改 `webui/**` 运行代码与运行时配置。改 `navigation.ts` 另须 IA 独立确认 |
| 验收 | Spec `SC-01`–`SC-16`；交互合同 E1–E12；`UAT-SUITE-SEMANTIC-MAP` |
| 关联 | [Spec](../specs/lucy-20261127-semantic-map-canvas-spec.md) · [设计](../design/design-2026-11-27-semantic-map-canvas.md) · [REQ-0121](../backlog/entries/REQ-0121-semantic-map-canvas.md) · [UAT](../qa/uat/suites/semantic-map/suite.md) · [INDEX](../qa/uat/INDEX.md) |

## 目标

按 Spec 落地只读语义地图：按连接投影 formal join 并集拓扑（Schema 岛 → 连通团 → 表侧栏），支持筛选／降级态／钻取工作台；无写盘；规模上守节点预算。不改 ACL／MCP 问数语义；不挂未确认导航。

## 开工前置

1. Spec 终稿确权已取得（2026-11-27）。
2. **开发授权尚未取得**。
3. 术语 New terms 实现 PR 同批登记（Spec N1）。
4. 测试台已登记 `UAT-SUITE-SEMANTIC-MAP`；宣称 PASS 前须真实前台浏览器跑次。
5. G1 现网抽样：与开发并行启动；未产出前禁止「现网已验证并集」措辞。
6. 核对：`semantic-identity.ts` join 并集读法、`tableYaml` 不含 overlay joins、display-snapshot 代次合同。

## 任务分解

### Task 0：现网／夹具取证（G1，可并行）

- 逐连接统计 joins 在 Manifest／overlay／冲突占比；产出写入 `inbox/` 或评审附件。
- **不挡** Task 1+ 编码授权后的实现，挡对外「已验证」主张。

### Task 1：只读投影 API＋全站解析索引

- **建议落点**：`webui/server/semantic-map.ts`（或等价）、`webui/server/index.ts` 路由注册。
- **合同**：`GET` 按连接返回岛／团摘要＋formal 边；分类用全站 `SemanticModelIndex`（可缓存、计代次）；跳过 `authorizedAgentCount`；挂展示快照；`payload 代次 > index 代次` ⇒ 边分类用「未判定」。
- **单测**：并集边（overlay-only）、冲突并列、共享 overlay 出边、断引用／外部引用／未判定三态、作用域标签。
- **验收**：SC-03／04／05／06／07／09／10／13。

### Task 2：前端语义地图页（只读）

- **建议落点**：`webui/src/pages/SemanticMap.tsx`（名可调）、路由注册（深链 `/semantic-map`；**不改 navigation.ts 菜单**除非 IA 已确认）。
- **落地**：岛总览→岛内团／孤立区→侧栏；筛选；节点预算；降级组件；打开工作台；合成 YAML 旁注。
- **验收**：SC-01／02／08／11／12／14／15；UAT-SM-01–10。

### Task 3：Catalog／工作台「在地图中查看」互链（M3 切片）

- 深链带 `conn`／`schema`／`table`；非法参数降级。
- **验收**：UAT-SM-08；不替代 Catalog 心智。

### Task 4：术语、门禁与 UAT 执行

- 登记术语；`lint:spec-docs`／`lint:inventory-stage` 绿。
- 开发授权后：lean 跑必做 WebUI 用例（含 **SC-16／UAT-SM-10** `lucy_query` 冒烟）；规模项按 fixtures 选 scale／customer-stability 或记 BLOCKED／SKIPPED 纪律。
- 回写 INDEX。

## 浏览器验证

- 路由：/semantic-map
- 视口：1920×1080
- **UAT 必做覆盖**：E1、E3–E7、E9–E11（见 `UAT-SM-01`–`10`）。**E2** 由 SM-01 加载占位子步骤覆盖；**E8** 由 SM-07 单岛失败选项覆盖；**E12** 由 SM-04 无命中关键字子步骤覆盖。
- 证据：未执行（开发授权后）

## 验收

- SC-01–SC-16 有单测与／或前台浏览器证据。
- `UAT-SUITE-SEMANTIC-MAP` 必做写入 INDEX；禁止 CR 冒充。
- 相关 lint／单测绿。

## 完成定义

Spec 终稿（已）→ 另发开发授权 → Task 1–3 实现与单测 → Task 4 术语＋UAT → 委托人验收 → 功能合同收口（S5）。本 Plan 定稿 ≠ 可开发／可上线。

## 风险

| 风险 | 缓解 |
|---|---|
| 只读 Manifest 假绿 | Task 1 单测强制 overlay-only 边；SC-03 |
| 索引陈旧误标断引用 | G3／SC-06；未判定字样 |
| 3000 表散点卡死 | 节点预算＋筛选仍受限；SC-11 |
| 与访问关系图混淆 | 术语＋入口分离；UAT-SM-04 禁用混称文案摘录 |
| 未确认 IA 改导航 | Plan 明示；Task 2 默认深链 |

## Changelog

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-11-27 | Spec 终稿后初稿；Kimi Plan／UAT 对抗（R1–R3）定稿句以评审终轮为准 |
