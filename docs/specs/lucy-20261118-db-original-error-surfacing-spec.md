# 外部目录读字段失败：透出数据库原始错误 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Spec / **v0.1-draft** |
| 日期 / 目标版本 | 2026-11-18／产品线 `0.30.0` |
| 功能编号 / 优先级 | **P1-43**／REQ-030-064／**P1**（优先级待委托人裁定）。**不入 0.30 核心分母** |
| 台账号 | 无。挂现行 `0.30` 执行总账，不占用 v0.25 登记册 |
| 阶段 | S1 |
| 状态 | **S1｜v0.1-draft。仅登记，不开发。外部目录读字段失败时，Lucy 页面与接口应带出脱敏后的数据库错误类别与可展开的技术详情，使握手失败、元数据服务慢、元数据服务起不来可区分；加诊断信息不改变既有成功／失败判定，也不影响合法用户的读取主路径。本稿只含问题、方案选项、伪代码与验收草案，范围限外部目录单表读字段及复用该路径的结构差异检查；表列表读取、连接测试等其他路径未验证。终稿未确权；未获开发授权；未授权不改运行代码；测试台 not_registered；不入核心分母；≠ 可上线** |
| 决策来源 | 2026-11-18 委托人：「Lucy 屏蔽了原始数据库的错误，解决问题起来就会非常费劲」，并指示「先登记 spec 即可，不开发」 |
| 需求来源 | 客户 `hive_jd`（SelectDB 外部目录、Kerberos 元数据服务）读不到字段的排障。本机 Kerberos 模拟确认四种成因在 Lucy 页面是同一句话。证据见错题 [2026-11-18-db-original-error-not-surfaced](../lessons/2026-11-18-db-original-error-not-surfaced.md) |
| 实施主体 | WebUI 服务端 `webui/server/schema-structure.ts`（读取与拒绝文案）、`webui/server/admin/live-discovery.ts`（结构差异检查）。不改 KTX，不改 SelectDB |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」与「功能闭口与发布取证」 |
| 与既有 Spec 的关系 | 延续 P1-16／REQ-030-037（目录扫描读路径）与 P1-20／REQ-030-041（外部目录列读取，见错题 [2026-11-13-external-catalog-column-read-ktx-describe](../lessons/2026-11-13-external-catalog-column-read-ktx-describe.md)）。不改它们的读取顺序（`DESC`、`SHOW COLUMNS`、`DESCRIBE`）与成功判定。与 P1-34／REQ-030-055（大 Schema 接入）共用单表读取预算，本条只在 OQ-4 讨论是否对齐超时判定 |
| 实施计划 | 未起草。待委托人裁定优先级与范围后再起草 |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1-draft | 初稿。只登记问题、事实、方案选项、伪代码与验收草案。开放项 OQ-1 至 OQ-6 待委托人决策。终稿未确权；测试台 not_registered |

## 闭口层级

- 层级：功能合同
- 本条承诺：外部目录读字段失败时，用户能看到足以区分失败成因的信息（错误类别，以及脱敏后的原始错误片段）；该信息只增不减，不改变哪些表被判为读取成功、哪些被判为失败，也不影响成功路径的响应与耗时。
- 本条出口：SC-01 至 SC-08（见「验收」）。
- 不在本条出口：客户 `hive_jd` 的根因定位与修复、SelectDB 或 Kerberos 配置、单表读取预算与探针次数的调整（OQ-4，若并入须另行写明）、表列表读取与连接测试等其他读取路径（OQ-1 核实前不入范围）、客户现场升级与复测、移动窄屏。
- 上线关系：本条收口不表示可上线

## 1. 背景与已核实事实

| 事实 | 依据 |
|---|---|
| 拒绝结构只有 `{table, reason}`，`reason` 是 7 值枚举：`missing`、`ambiguous`、`unreadable`、`permission`、`timeout`、`too_large`、`too_wide`。数据库原文无处可放 | `webui/server/schema-structure.ts` 中 `SchemaColumnRejection` |
| 原文（`stderr`、SQL、耗时）只经 `logSchemaStructureFailure` 写容器日志，不进接口响应 | 同上 |
| 读取抛出的异常在 `catch` 中统一归为 `unreadable` | 同上，`readCatalogTableColumns` |
| `rejectionMessage` 只对权限、超时、过宽三种给单独文案，其余一律「表「…」没有读到字段。」 | 同上 |
| 单表读取预算 8 秒，三条探针各等一次，合计约 24 秒后放弃 | `PER_TABLE_TIMEOUT_MS` 与本机实测 24043 ms、24062 ms |
| 单表路径超时文本 `Catalog connection/query timed out` 既不匹配连接失败正则，`columnScanTimedOut` 又按 120 秒判定，超时文案走不到 | 同上，`CONNECTION_FAILURE`、`columnScanTimedOut` |
| 本机 Kerberos 模拟：四种成因页面同文，SelectDB 的 `DESC` 返回对其中两种只是 `Unknown database 'default_cluster:app'`，真正原因在 `SHOW DATABASES` 返回与 `fe.log` | 错题第 2 节与本机 `inbox/20261118-0011-hive-jd-kerberos-fingerprint-dictionary.md`（临时文件） |

**重要含义：** 即使 Lucy 完整转发 SelectDB 对 `DESC` 的原文，对「握手失败」类成因，原文本身也可能只是 `Unknown database`，不含 `GSS`。所以本条不承诺「用户看到原文就能定位根因」，只承诺「不再比原文更少」；是否额外补一次只读探测（如 `SHOW DATABASES`）以取到更直接的证据，见 OQ-3。

## 2. 问题陈述

- 现场同事无法从页面判断成因，必须登录 Lucy 容器翻日志。客户现场这一步最难做到。
- 失败信息以枚举形式在类型层面被丢弃，后续任何文案改进都无处取值。
- 既有测试只断言「被归类」，不断言「用户能据此排障」。

## 3. 目标与非目标

**目标**

1. 读取失败的每一张表，响应里带出错误类别和脱敏后的原始错误片段。
2. 页面默认只展示类别与一句话原因；原始片段放在可展开的「技术详情」里。
3. 既有的成功与失败判定、成功路径的响应形态和耗时不变。

**非目标**

- 不定位或修复客户 `hive_jd` 的根因，不改 SelectDB、Kerberos、KTX。
- 不新增持久化表，不改审计表结构。
- 不改读取顺序与探针次数（OQ-4 另议）。
- 不把原文写进导出文件或对外 MCP 响应（OQ-2 裁定前一律不写）。

## 4. 方案选项（待裁定）

| 选项 | 内容 | 优点 | 代价与风险 |
|---|---|---|---|
| A | 只扩展错误类别（如：认证失败、连接失败、超时、权限、对象不存在、未知）并配固定中文文案 | 无泄露面；改动小 | 类别靠正则匹配原文，可能误判；对「`Unknown database` 掩盖 GSS」这类情形仍然帮不上忙 |
| B | A 加折叠的「技术详情」，展示脱敏并截断后的原始错误片段 | 能直接拿到原文用于排障 | 需要脱敏规则与长度上限；原文可能含内网主机名、SQL、principal |
| C | B，且「技术详情」只对管理员可见 | 泄露面最小 | 要确认「准备表结构」页面当前是否本就仅管理员可达（OQ-2）；非管理员只看类别 |

**倾向：B 起步，可见范围按 OQ-2 裁定。** 这只是起草人倾向，不是决定。

## 5. 核心流程（伪代码）

```text
for each table in 请求表:
  for probe in [DESC, SHOW COLUMNS, DESCRIBE]:        # 顺序不变
    result = run(probe)
    if result 可映射出列:  记成功并停止               # 成功判定不变
    last_failure = result                                # 新增：保留最后一次失败，不再丢弃

  if 全部失败:
    reason   = sqlFailureReason(last_failure)            # 既有枚举，不变
    category = classify(last_failure.text)               # 新增：认证／连接／超时／权限／对象不存在／未知
    detail   = scrub(clip(last_failure.text, MAX_LEN))   # 新增：截断后脱敏
    rejection = { table, reason, category, detail }      # 追加字段，旧字段不变

响应:
  rejections[i] = { table, reason, message, category, technicalDetail? }   # 新字段为可选，只增不减
  technicalDetail 是否返回由 OQ-2 的可见范围决定

scrub(text):  # 规则待 OQ-2 裁定；起草时的最低要求
  去掉密码、令牌、keytab 内容与路径中的密钥片段
  SQL 与内网主机名是否保留由 OQ-2 决定
```

结构差异检查（`live-discovery.ts`）复用同一读取，沿用同一结构，不单独实现第二套。

## 6. 验收（草案）

每条分「约束生效」与「合法用户仍可用」两面。

| 编号 | 验收 | 验证方式 |
|---|---|---|
| SC-01 | 约束生效：同一张表在四种成因下（反向解析不一致、时钟偏差、HMS 起不来、HMS 变慢），页面的类别或技术详情彼此不同，且与成因相符 | 本机 Kerberos 模拟，沿用错题第 2 节的四个场景；单测用同样的原文夹具 |
| SC-02 | 合法用户仍可用：同一输入下，被判成功与被判失败的表集合与改动前完全一致 | 回归测试，对比改前改后；读取顺序测试不改 |
| SC-03 | 合法用户仍可用：全部读取成功时，响应与改动前逐字段一致，不新增必填字段，耗时无可测增加 | 回归测试加简单计时 |
| SC-04 | 约束生效：技术详情中不出现密码、令牌、keytab 内容 | 单测，用含这些内容的样例原文 |
| SC-05 | 向后兼容：新字段全部可选；不认识新字段的旧前端行为不变 | 契约测试 |
| SC-06 | 约束生效：按 OQ-2 裁定的可见范围，范围外用户收不到技术详情，只收到类别 | 接口测试，两种身份 |
| SC-07 | 约束生效：超过长度上限的原文被截断并带截断标记，不拖垮响应 | 单测 |
| SC-08 | 容器日志中既有的 `read failed` 记录不变 | 回归测试 |

测试台：not_registered。本条不写任何 UAT PASS 主张；若要挂 UAT，须另建 Suite 并在 `docs/qa/uat/INDEX.md` 登记。

## 7. 开放项（待委托人决策）

| 编号 | 问题 | 起草人倾向 |
|---|---|---|
| OQ-1 | 范围：是否在写 Spec 终稿前先核实表列表读取、连接测试、SQL 执行等其他路径是否同样吞原文？ | 是。先核实，再定范围 |
| OQ-2 | 可见范围与脱敏：原文含内网主机名、SQL、principal。谁能看？主机名是否保留（保留利于排障，也是泄露面）？导出文件与 MCP 响应是否永不带原文？ | 仅管理员可见；主机名保留；导出与 MCP 永不带 |
| OQ-3 | 是否在读取失败时额外做一次只读探测（如 `SHOW DATABASES`），取更直接的证据？这会新增一次外部调用 | 先不做；只转发已有原文 |
| OQ-4 | 是否并入「超时判定与单表 8 秒预算的一致性」及「超时后是否继续试后两条探针」？这会改变失败耗时，但不改变成败 | 分开处理，不并入本条 |
| OQ-5 | 类别集合与中文文案，须符合术语标准，须由委托人确认 | 见 Terminology Compliance |
| OQ-6 | 优先级是 P1 还是更高？是否挡 0.30 | 保持 P1，不入核心分母，不挡原 P0 |

## 8. 风险与失败模式

| 风险 | 表现 | 缓解 |
|---|---|---|
| 脱敏漏项 | 技术详情带出密钥或内部信息 | SC-04；可见范围收窄；宁可多脱 |
| 类别误判 | 分类正则把 A 类归成 B 类，误导排障 | 类别只作辅助，技术详情提供原文；分类用保守匹配，匹配不上归「未知」 |
| 原文自身误导 | `Unknown database` 掩盖 GSS | 页面上写明「这是数据库的返回」，不写成 Lucy 的结论；OQ-3 |
| 响应体变大 | 大量失败表各带 500 字符 | SC-07 截断；单次响应总量上限 |
| 破坏主路径 | 新代码在成功路径上抛错 | SC-02、SC-03；新代码只在失败分支执行 |

## 9. 迁移与回滚

- 无持久化变更，无数据迁移。
- 响应字段只增不减；回滚＝移除新字段，旧前端不受影响。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: None.

复用既有术语「技术详情」（折叠展示原始输出，见术语标准 Validation Technical Detail）。错误类别的中文名称须在终稿前对照术语标准确认，若需要新增，先补术语标准再写文案（见 OQ-5）。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [ ] 不新增页面、颜色或间距
- [ ] 技术详情沿用既有折叠样式，默认收起
- [ ] 错误文案符合术语标准

### Exceptions (If Any)

- None

### Follow-up Needed

- 终稿前须确认页面改动范围；若涉及页面元素，须补交互合同与元素清单后才能请求开发授权。本草案不含页面路由与元素清单
- OQ-1 至 OQ-6 须在终稿确权前闭合
