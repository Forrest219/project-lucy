# WO-202610-11 客户离线评测

| 元数据 | 内容 |
|---|---|
| 工单号 | 202610-11 |
| 标题 | 客户独立运维的离线评测：套件约定、跑批、运行明细、现场提问、现场对照 |
| 状态 | 按 Spec 161 v0.2 实现。G3 已拍板：不完整结果文件整体拒收 |
| 来源 Spec | `webui/docs/161-offline-eval-customer-ops-spec.md` v0.2 |
| 来源计划 | `docs/plans/2026-10-11-eval-module-functional-upgrade.md` v0.4 |
| 撰写日期 | 2026-10-11 |
| 适用范围 | `webui/server/eval/**`、`webui/src/pages/eval/**`、`webui/src/app/navigation.ts`、`scripts/eval/**`、`webui/docs/00-product-terminology-standard.md`、对应测试 |

按 Spec 161 v0.2 实现。任务按依赖排序。

## 目标

按 Spec 161 让维护质量的人在客户自己的 Lucy 里走完一轮：维护 v2 套件，离线跑批，上传结果，在运行明细里看见答对了、答错了或没答出来，并把反复出现的业务失败收成用例。通过率不含没答出来。现场区块不点亮红线。

## 任务

- [ ] **T1 术语登记。** 评审通过后，把 Spec 161 Terminology Compliance 的新行写入 `webui/docs/00-product-terminology-standard.md` §4.4。界面文案只使用这些主术语。验收：术语 lint 能认出新页面上的「现场提问」「离线跑批」「截止日期」「待复核」。

- [ ] **T2 套件 v2。** 扩展套件解析，接受 `lucy_eval_schema_version: 2` 的 `executable`、`as_of_binding`、`review_status`。v1 套件继续按 Spec 46 上传和下载。v2 缺可执行约定时预检报字段路径。保存和下载的套件哈希仍按去掉 `suite_hash` 后的规范 JSON 计算。对应 SC-16 的套件侧。

- [ ] **T3a 执行路径。** 跑批经与 `lucy_query` 相同的路径编译和执行，角色取自 domain 已绑定角色。未指定角色或角色未绑定则整批拒绝。不在脚本中另写编译器。单条超时或连接中断记没答出来且不中断整批；进程中断或缺少应执行用例时 `complete = false`。输出结果版本 2，`runner.model` 为空。对应 SC-1、SC-8、SC-20、SC-21。

- [ ] **T3b 结构对照。** 按 Spec 161 §8.1 的列、粒度、身份条件和业务指标检查。只有行数时记答错了。对应 SC-2、SC-3、SC-6。

- [ ] **T3c 勾稽与语句。** 勾稽不一致记答错了。语句不合规不改变主列。对应 SC-4。

- [ ] **T4 结果归档与通过率。** 在现有 eval 库初始化处为 `eval_run` / `eval_run_case` 增加 v2 列：`result_version`、`as_of`、`not_answered_count`、`complete`、`role_id`、`outcome`、`reason`、`policy_status`、`window_json`。`POST /api/eval/results/import` 接受结果版本 2。模型名非空或 runner 不是离线跑批时预检拒绝。`complete != true` 预检整体拒收，不写入运行历史。哈希规则保持 Spec 46。通过率按 Spec 161 §8.2。旧运行不回填。对应 SC-5、SC-16、SC-17、SC-19。

- [ ] **T5 运行明细。** `/eval/runs/:id` 主列显示答对了、答错了、没答出来和中文原因。页头显示截止日期和窗口。语句不合规在次列。和另一次运行对比时，新增失败只统计新的答错了，没答出来单独计数。旧运行仍显示原来的通过率。对应 SC-1 至 SC-5。

- [ ] **T6 用例编辑。** 「问题 & 期望」编辑问法、截止日期绑定、必须列、粒度、条件、业务指标和勾稽。SQL 断言与结果断言留在次级区域。问法为空不能保存。评测用例列表的本地运行命令改为 T3 的跑批命令。对应 SC-6、SC-13 的保存侧。

- [ ] **T7 待复核。** 当前发布的 `sourceMapVersion` 与用例上的 `semantic_version_seen` 不同时，用例变为待复核。人确认后写回版本并恢复可跑。跑批跳过待复核用例，通过率不含它们。对应 SC-8。

- [ ] **T8 现场提问。** 建 `field_question` 表。新页面 `/eval/field-questions`，导航放在安全评测候选旁边。抽取按 Spec 161 §8.3：证据包不完整则拒绝且不插入；权限拒绝不进；成功调用不进；推断问询超过 50 次调用按查法拆开。收成用例只预填指标、维度和过滤字段，问法留空。安全评测候选的抽取和晋升不改。对应 SC-9 至 SC-13。

- [ ] **T9 趋势监控。** 通过率指标卡旁展示没答出来计数，不点亮黄线或红线。同一天新旧口径并存时标注旧口径 / 新口径。`GET /api/eval/monitor/field` 按 Spec 161 §8.4，客户端族在读取时按整段名称分类。domain 的 `roleIds` 为空时不查询访问日志。点原因跳到现场提问；T8 未完成时链接不可用。对应 SC-14、SC-15、SC-18、SC-22。

- [ ] **T10 测试与文档索引。** 覆盖 §12 的 SC-1 至 SC-6、SC-8 至 SC-22。更新 `webui/docs/README.md` 中本 Spec 的状态。Help 里质量评测三条路径改为：维护套件、离线跑批、上传结果。

## 实现顺序

1. T1 与 T2 先落地，后续页面只用已登记的说法和 v2 字段。
2. T3a、T3b、T3c 与 T4 一起做，保证跑批文件能被预检接受。
3. T5 与 T6 一起做，否则现场提问收进来的草稿仍只能写成标量。
4. T7 随 T6。
5. T8 等 T5 的原因词稳定后再做。
6. T9 可与 T5 并行开发数据接口；跳转链接等 T8。
7. T10 收口。

## 验收口径

以 Spec 161 §12 为唯一验收表。最低一条不能少：SC-1、SC-5、SC-9、SC-11、SC-16、SC-17、SC-18、SC-20，以及 SC-19（不完整文件预检整体拒收、不写入运行历史）。

## 验证命令

```bash
cd webui
npm run lint:terminology
npm test -- --run server/__tests__/eval-suite-schema.test.ts server/__tests__/eval-results-import.test.ts server/__tests__/eval-offline-batch.test.ts server/__tests__/eval-field-questions.test.ts src/__tests__/eval-cases.test.tsx src/__tests__/eval-run-detail.test.tsx src/__tests__/monitor.test.tsx
npm run build
```

跑批程序若落在 `scripts/eval/`：

```bash
node --test scripts/eval/offline-batch.test.mjs
```

## 风险与边界

| 风险 | 处理 |
|---|---|
| v1 套件被跑批程序读入后产生空通过率 | 跑批拒绝没有 `executable` 的用例，并在结果里说明跳过原因；不把它们算成答对 |
| 勾稽两边查询都失败 | 按第一条失败的编译原因记没答出来，不记成勾稽不符 |
| 现场抽取把拒绝日志写进业务池 | 抽取先排除 denied 与 forbidden，单测用一条权限拒绝锁住 |
| 未绑定角色时现场区块扫到全库 | `roleIds` 为空时接口返回说明，不执行访问日志查询 |
| 旧通过率被新分母重算 | `result_version < 2` 或 outcome 为空时继续 pass / total |
| 跑批绕过角色看到更宽的结果 | 必须带 domain 已绑定的 `role_id`，走 `lucy_query` 同一条 ACL。未绑定角色不执行 |

## 回滚

- 隐藏现场提问导航和趋势监控现场区块。
- 跑批命令从评测用例菜单撤下，恢复 Spec 46 的说明。
- v2 结果不再接受新的导入；已归档的 v2 运行保留只读。
- 不删除 v1 套件和旧运行。
