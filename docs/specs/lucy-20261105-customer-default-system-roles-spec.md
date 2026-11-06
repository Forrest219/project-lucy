# 客户默认系统正式 Role Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 产品功能合同 / **v0.4** |
| 日期 / 目标版本 | 2026-11-05 / 不绑定产品版本号 |
| 功能编号 / 优先级 | **无** / **P0**（客户交付 · 访问治理开箱） |
| 状态 | **v0.4 功能合同已收口（2026-11-05）**。SC-01–SC-12 本机自动化通过，证据见 [`docs/reviews/2026-11-05-customer-default-system-roles-closure.md`](../reviews/2026-11-05-customer-default-system-roles-closure.md)。**本条收口不表示可上线**——浏览器 E2E、Docker 重建、镜像与客户现场不在本条出口 |
| 决策来源 | 2026-11-05 产品确认；Codex CLI 第 1–2 轮（摘录 `inbox/codex-review-customer-default-system-roles-round{1,2}.txt`） |
| 需求来源 | 客户新装 / 平滑升级后缺少正式 `lucy_admin`，仅有参考模板不可绑；与「特殊系统 Role 开箱即有」目标冲突 |
| 实施主体 | Lucy：客户种子、启动 ensure、`ops-evidence` ensure 写 Role 例外、原子写盘、相关单测与文档指针。不改 ACL 编译代数 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) |
| 与既有 Spec 的关系 | **修订** Spec 131 §3.3；**修订** Spec 149（Non-goals／§7／伪代码／SC-11）与可问治理面 D22、术语标准中「ensure 永不写 access.yaml」的**绝对值句**——例外仅限本条 §3.2；已存在 Role 扩表禁令保留 |
| 实施计划 | [`docs/plans/lucy-20261105-customer-default-system-roles-plan.md`](../plans/lucy-20261105-customer-default-system-roles-plan.md) |
| 修订记录 | v0.1 初稿；v0.2 R01–R05；v0.3 N01／N02；v0.4 Codex 第 3 轮小修订（SC-06／§4.2／定稿状态） |

## 闭口层级

- 层级：功能合同
- 本条承诺：客户路径下正式 Role `lucy_admin` 与 `lucy_ops_reader` 在约定时机可绑定；缺则幂等写入规范定义，已存在不覆盖；本条 ensure **不**新增／改绑任何 Agent 或 Token。
- 本条出口：SC-01–SC-12 的本机自动化（含局部写盘故障注入与恢复门禁拒绝写入）。
- 不在本条出口：浏览器 E2E、移动窄屏、整库旅程、客户现场升级、镜像／Helm 发布取证、已存在 Role 强制收敛或表选择器自动扩权、预置业务演示以外的生产 Agent。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| English | 中文主术语 | 允许同义 | 禁用 | 备注 |
|---|---|---|---|---|
| System Formal Role | 系统正式 Role | 开箱正式 Role、默认系统 Role | 参考模板（作已落盘主称）、超管 Role、WebUI 管理员 Role | 本条保证落盘的 `lucy_admin` / `lucy_ops_reader`；`source=yaml` |

沿用并强调：Lucy Admin Role、Ops Evidence Role、Persisted Role、Reference Role Template、Demo Ops Agent（仅 Docker demo）。

Forbidden：把参考模板说成已可绑定；把「全部表」写成物理库未启用表或 `tables: ["*"]`；把本条写成自动创建／改绑 Agent；把客户示例 `customer_agent` 称为本条系统预置。

实施时更新术语标准：Lucy Admin Role 备注（客户包／ensure 可落盘正式 Role）；Ops Evidence Role 备注中「ensure 永不写 access.yaml」改为指向本条例外。

## Design System Compliance

### Referenced Specs

- 无新增页面或控件；沿用既有 Role／Agent 管理面与 Spec 131／149 高权限警示。

### What This Change Follows

- [x] 不新增导航、Tab、向导
- [x] Role id／工具名／`catalog_bound` 继续 `notranslate`／`translate="no"`
- [x] 不把 `lucy_admin` 写成 WebUI 所有者文案

### Exceptions (If Any)

- None.

### Follow-up Needed

- None（ensure 失败 WebUI 横幅另开呈现 Spec）。

---

## 1. 问题与证据

1. Spec 131 §3.3 与客户镜像种子默认不落盘正式 `lucy_admin`。
2. 平滑升级保留 `access.yaml`；旧 entrypoint 只补工具、从不创建缺失 Role。
3. Spec 149／D22 曾写 ensure **永不**写 `access.yaml`；正式 `lucy_ops_reader` 依赖手复制。
4. 产品目标：Agent 自建；系统正式 Role 开箱即有。

## 2. 目标与非目标

### 2.1 目标

1. 客户新装：正式 `lucy_admin` 可绑定（种子 + 缺则 ensure）。
2. 存量平滑升级：缺 `lucy_admin` 则幂等写入；已存在不覆盖（允许补缺失工具名）。
3. ops-evidence ensure 在 **§3.2 状态表允许** 时：缺 `lucy_ops_reader` 则写入；否则不写。
4. 本条 ensure／客户系统路径：**不**新增 Agent、Token，**不**改绑既有 `users`；客户种子**禁止**静态 `lucy_ops_reader`。

### 2.2 非目标

- 覆盖或重置客户已改过的同名 Role；自动扩已存在 `lucy_ops_reader.names`。
- 删除或改写客户示例中的 `customer_agent`／示例 Token 哈希（属配置示例，非本条系统 Role 合同）；也不把它们升级为绑定系统 Role。
- 修改 `catalog_bound`／AbsoluteDeny／`lucy-ops` 连接可见谓词。
- 将「全部表」扩为物理库未启用对象或 Role `tools`／`tables` 星号。

## 3. 行为合同

### 3.1 `lucy_admin`

| 项 | 合同 |
|---|---|
| 规范定义 | 与 `ROLE_TEMPLATES.lucy_admin` 去掉模板 `id` 后字段等价：`permission_model_version: 2`，`source_scope: catalog_bound`，`connections: ["*"]`，`tools = LUCY_ADMIN_TOOLS` |
| 新装种子 | `customer-config.example/webui/config/access.yaml`（及镜像 `project-template`）**必须**含该正式 Role；可与示例业务 Role 并存；**不得**含 `lucy_ops_reader` |
| Ensure 时机 | **仅进程启动／entrypoint seed 路径**（WebUI 对外服务前）；客户与 demo 均执行 |
| 缺则写入 | 无 `roles.lucy_admin` → 写入规范块 |
| 已存在 | 不改 connections／source_scope／description／既有 tools 相对顺序；**仅**幂等追加规范工具集中缺失的工具名 |
| 二次执行 | 再跑 ensure：无新变更则文件语义不变（允许 YAML 无意义空白差由实现约定为「不写盘」） |
| 非目标保护 | 不改其他 Role、`users`、`defaults`、Token |

### 3.2 `lucy_ops_reader`

| 项 | 合同 |
|---|---|
| 规范定义 | 与 `ROLE_TEMPLATES.lucy_ops_reader` 去掉 `id` 后等价；`names` = **执行时**冻结 `OPS_EVIDENCE_FROZEN.sourceName` 全集；禁止 `catalog_bound`；不并入 `lucy_admin` |
| 静态种子 | 客户包／`customer-config.example` **禁止**预置该 Role（权威路径仅为 ensure） |
| 写入挂点 | 仅在 `ensureOpsEvidence` **即将成功返回前**（见状态表），且 `roles.lucy_ops_reader` 缺失时 |
| 已存在 | 整块不覆盖、不扩 `names` |
| Agent | 不创建 `demo_ops`；客户路径不创建任何系统 Agent |

#### 3.2.1 写入状态表（对接 `ensure.ts`）

| `connectionWrite` | `readiness` | 是否写缺失的 `lucy_ops_reader` |
|---|---|---|
| `conflict` | `conflict` | **否** |
| `unchanged`（镜像失败提前返回） | `not_ready` | **否** |
| `inserted`／`expanded`／`unchanged` | `reload_required` | **是**（首次插入常态；daemon 尚未重载不影响 Role 落盘） |
| `inserted`／`expanded`／`unchanged` | `current` | **是** |
| 任意 | 抛异常／函数失败 | **否**（原文件保留） |

说明：资产 `conflict`（定制 Manifest／Skill／Wiki）**不**单独否决 Role 写入——只要连接块路径已走到上表「是」行。禁止用 CLI 退出码 0 代替上表。`failed` 不是 `connectionWrite` 枚举值；实现勿发明第三套枚举。

### 3.3 写盘与恢复（启动路径）

1. **时机**：仅 entrypoint／启动 ensure（含其调用的 ops-evidence ensure）。**不**在已对外服务的热路径用裸 `writeFile` 绕过协调器；本条 **不授权**运行期路径（若未来另授，必须走 `writeAccessConfigFileWithAuditClosure`）。
2. **恢复准入（每个 ACL 写入口强制）**：写前先 `readAccessRecoveryState(projectRoot)`，再 `assertAccessWritesAllowed(state)`（**禁止**仅调用无参内存闸）：
   - 恢复状态为 `required`、marker 不可读／损坏、存在未终结 durable intent → **禁止写入**；保留原文件字节与恢复现场；打警告（含原因码）；**不**清除／改写恢复 marker。
   - 恢复闸不可判定（IO 错误）→ 同「禁止写入」。
   - 仅当闸证明可写时，才进入校验与原子写。
   - 容器／进程仍可按既有规则继续启动；**不得**因跳过系统 Role 写入而假装 Role 已落盘。
3. **校验**：写入前 YAML 可解析；目标 Role 块符合规范字段；否则不写盘并打警告。
4. **原子性**：临时文件写入 + `rename` 替换；失败则保留原 `access.yaml` 字节。
5. **审计**：启动 ensure 无登录主体；日志标明 `system_ensure_formal_roles`；`config_change_log` 启动期可写则记，否则实施可选、不挡 SC。
6. **半份文件**：禁止留下截断正式路径；失败只保留原字节或成功整文件。

### 3.3.1 允许变更集合与比较口径

对任一 ensure 调用，解析前后的 `access.yaml`：

| 分支 | 允许变更（且仅这些） | 比较口径 |
|---|---|---|
| A. 创建缺失 `lucy_admin` | 新增 `roles.lucy_admin` = 规范块 | 该 Role：**解析后语义相等**于规范；其余 keys：**解析后语义相等**于调用前 |
| B. 补齐已有 `lucy_admin` 工具 | 仅 `roles.lucy_admin.allow.tools` 追加缺失名 | 该 Role 除 tools 外字段语义不变；tools 为超集且无删减；其余 keys 语义不变 |
| C. 创建缺失 `lucy_ops_reader` | 新增 `roles.lucy_ops_reader` = 规范块 | 同 A |
| D. 已存在 `lucy_ops_reader`／闸拒绝／写失败／状态表否 | **无变更** | 正式路径文件与调用前 **字节相等** |
| 二次幂等（A/B/C 成功后再跑） | **无变更** | 目标 Role **语义相等**；实现宜 **不写盘**（若写盘则字节可因无意义空白变化，但语义必须相等，且非目标 keys 语义不变） |

「其余 keys」含：其他 Role、全部 `users`（含 tokens／role 绑定／enabled／note 等字段）、`defaults`、以及文件中其它顶层键。  
**禁止**把「只搜 demo_ops」当作非目标保护的充分条件。

### 3.4 Agent／Token 口径

| 范围 | 合同 |
|---|---|
| 本条 ensure | 不新增 `users` 条目；不改 Token；不改 `role`／`roles` 绑定 |
| 客户种子示例 | 允许保留既有示例 `customer_agent` + 示例哈希（绑定业务示例 Role）；**不得**绑定 `lucy_admin`／`lucy_ops_reader` |
| Docker demo | `demo_ops` 仍仅 demo 模板；平滑升级不补写；本条客户路径禁止 |

### 3.5 共享约束

- 权限事实源仍是 `access.yaml` 正式 Role；开箱后同名正式 Role 为 `source=yaml`。
- `lucy_admin` Admin 删除保护保持 Spec 131。

## 4. 对既有 Spec／术语的修订指针

### 4.1 Spec 131

- §2 Non-Goal「不强制预置 Agent」保留。
- §3.3 有效口径＝本 Spec §3.1；旧「客户包默认不自动落盘」已作废。

### 4.2 Spec 149

- Non-goals「确保逻辑不写 access.yaml」→ **已作废为绝对值**；有效例外＝本 Spec §3.2（仅缺则创建 `lucy_ops_reader`）。
- §8 伪代码 `do not write access.yaml` → 改为调用本条 ensure（状态表）。
- 149 SC-11：废止「整文件字节不变」绝对值；有效验收改指本 Spec §3.3.1——创建成功时非目标内容**语义相等**；已有 reader／闸拒绝／写失败时正式路径**字节相等**。

### 4.3 可问治理面 D22／术语

- D22「永不写 access.yaml」→ 对**已存在** Role／Agent 仍禁止；对**缺失** `lucy_ops_reader` 的创建以本条为准（旧绝对值句就地作废标记）。
- 术语 Ops Evidence Role 备注同步。

## 5. 核心流程（伪代码）

```text
ensure_lucy_admin_on_startup(access_path, project_root):
  if not access_writes_allowed(project_root):  # recovery gate
    warn_skip; return  # keep bytes + recovery markers
  raw = read(access_path) or empty
  doc = parse_yaml(raw) or abort_warn_keep_file
  if roles.lucy_admin missing:
    doc.roles.lucy_admin = normative_from_template()
  else:
    append_missing_tools_only(doc.roles.lucy_admin, LUCY_ADMIN_TOOLS)
  if semantic_unchanged_vs_raw(doc, raw): return
  atomic_write(access_path, render(doc))  # fail ⇒ keep raw

# only when §3.2.1 status table says yes:
ensure_lucy_ops_reader_after_ops_connection_ok(access_path, project_root):
  if not access_writes_allowed(project_root):
    warn_skip; return
  raw = read(access_path)
  doc = parse_yaml(raw) or abort_warn_keep_file
  if roles.lucy_ops_reader exists: return  # branch D
  doc.roles.lucy_ops_reader = normative_from_template(frozen_source_names_now)
  atomic_write(access_path, render(doc))  # fail ⇒ keep raw
```

## 6. 验收（SC）

| ID | 断言 |
|---|---|
| SC-01 | 分支 A：缺 `lucy_admin` → 创建后符合 §3.3.1 A；第二次幂等符合「二次幂等」行 |
| SC-02 | 分支 B：自定义 description + 缺工具 → 符合 §3.3.1 B；第二次幂等 |
| SC-03 | 分支 C：状态表「是」且缺 reader → 符合 §3.3.1 C；第二次幂等；非目标 keys 语义不变 |
| SC-04 | 状态表「否」或抛错 → 分支 D：正式路径 **字节相等** |
| SC-05 | 已有窄 `names` 的 reader → 分支 D：字节相等 |
| SC-06 | ensure 前后 `users` **全字段语义相等**（含 tokens／绑定／enabled／note）；**不新增** `demo_ops`；**不新增或改变**任何 user 对 `lucy_admin`／`lucy_ops_reader` 的绑定。调用前已存在的合法绑定与 demo 用户须保留。客户静态种子「不得绑定系统 Role」由 SC-08 单独检查 |
| SC-07 | 文档契约：131／149／D22／术语无未作废绝对值「永不写 access.yaml」；旧 149 SC-11 测试已改兼容例外 |
| SC-08 | 客户示例：`lucy_admin` 全字段＝规范；不含 `lucy_ops_reader`；示例 agent 未绑系统 Role |
| SC-09 | 原子写失败 → 字节相等 + 警告；随后闸允许且条件满足时重试可走到规范结果并二次稳定 |
| SC-10 | 与 `role-templates.ts` 漂移则种子／ensure 测试失败 |
| SC-11 | 恢复闸 `required`／marker 损坏／未终结 intent／闸不可读 → 两路 ensure 均不写盘（字节相等），marker／intent 现场保留 |
| SC-12 | 写失败后再成功（SC-09）与闸拒绝（SC-11）可区分：前者无恢复 marker 要求；后者必须保留恢复现场 |

## 7. 风险与开放点

| 风险 | 处置 |
|---|---|
| 同名窄权限 Role | 不覆盖；手册注明系统 id |
| 冻结集变大 | 已存在 Role 不自动扩 |
| 启动写与日后 Admin 保存竞态 | v0.2 限定启动前；运行期另授 |

开放点：ensure 失败 WebUI 横幅 → 另开呈现 Spec。

## 8. 检查点

- [x] SC-01–SC-12 自动化通过
- [x] 149／D22／术语绝对值句已作废并指针
- [x] 术语 Lucy Admin／Ops Evidence 备注已更新
- [x] 配对 Plan 同步 v0.4
- [x] 收口时状态镜像
