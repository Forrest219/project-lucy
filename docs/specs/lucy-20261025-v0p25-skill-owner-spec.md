# Lucy v0.25 业务 Skill 负责人 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 | 功能设计基线（Business Context / WebUI / Audit） |
| 文档版本 / 日期 | v0.3-pm-signoff / 2026-10-26，Asia/Shanghai（v0.2-requirements-review 于 2026-10-25 完成联合需求审查） |
| 功能编号 / 目标版本 | L25-04 / v0.25 |
| 优先级 | P2；不改变既有 P0／P1 验收与交付阻断状态 |
| 状态 | **需求审查与 PM 签核已通过（2026-10-26）；暂不开发，不代表实现或验收通过。SKO-01–16 全部未执行；签核只确认设计基线，开发授权另行决定** |
| 需求来源 | [Lucy 2.5 功能升级建议书](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) §2 L25-04；[P0 Final 决议](../reviews/2026-10-24-lucy-v0.25-p0-final-decision.md) §1 保持 P2 |
| 审查记录 | [L25-04／L25-05 Spec 审阅记录](../reviews/2026-10-25-lucy-v0.25-l25-04-05-spec-review-record.md)（F-01–F-08 已关闭；F-09–F-12 为实施前待办，已回写本文） |
| 现有基础 | Skill frontmatter、统一 Skill 工作台、保存预检、`file_version` 乐观并发、`skill` 类配置审计 |
| 实施主体 | Lucy；不修改 KTX，不改变 MCP Skill 授权或问答运行时 |

> 本文件定义拟实现行为，不代表功能已经实现或验收通过。PM 签核只确认设计基线，不授权开发；开发授权另行决定。

## 0. 设计决议摘要

| 编号 | 决议 |
|---|---|
| D01 | 在 Skill frontmatter 增加可选 `owner` 字符串，UI 主术语为「负责人」；缺失或空字符串显示「未指定」。 |
| D02 | 负责人是人员或团队的自由文本治理标签，**不是登录账户引用、所有者角色、邮箱、授权主体或通知订阅**；不建立账户生命周期依赖。 |
| D03 | 复用现有创建、编辑、预检、`expected_version` 和 `skill` 配置审计；不新增独立负责人 API、表或存储。 |
| D04 | 既有 Skill 不迁移、不批量回填；负责人缺省不改变发布状态、版本、可访问角色或 MCP 行为。 |
| D05 | 非法 `owner` 不阻断 Agent 读取既有 Skill，但必须显式披露；未修复前不得通过另一次保存静默清除或改写该声明。 |
| D06 | 只增加总览列、详情字段、编辑字段、预检差异和审计摘要；不增加技能市场、负责人筛选、工作量统计或审批流。 |

## 1. 现状证据与复用边界

### 1.1 已存在的能力

| 现有能力 | 本 Spec 的处理 |
|---|---|
| `SkillFrontmatter`／`SkillAsset` 尚无负责人字段 | 增加 `owner` 与只读 `owner_invalid`；列表摘要和详情复用同一对象 |
| 统一工作台已有名称、域、状态、版本和校验结果列 | 在版本后增加「负责人」列，不重排页面信息架构 |
| 新建／编辑使用结构化元数据和 Markdown 双栏 | 在元数据区增加负责人输入；`Cmd/Ctrl+S` 仍只打开预检 |
| 更新使用原始文件 SHA-256 `file_version` 和 `expected_version` | 负责人修改走同一 CAS，不另设 `owner_version` |
| 预检返回 `proposedMarkdown`、`diff`、`validation` 和 `impact` | `impact` 增加负责人前后值；预检仍不写文件、审计或缓存 |
| `auditedWriteFile` 已持久化 intent／terminal，`assetKind=skill`；当前 Skill writer 未自行处理 terminal 失败后的文件回滚 | 在 old／new summary 增加 `owner`，沿用既有 change type 和 actor；S1 必须补齐 Skill 文件回滚闭包，不得把 helper 的存在误记为已闭环 |
| loader 对损坏 `roles_allowed` 使用显式 invalid 标记 | owner 采用同构的损坏披露，但不把负责人错误升级为授权拒绝 |
| 前端 React 文本输出与 `notranslate` 已有模式 | 负责人按纯文本渲染；不解释 Markdown、HTML 或链接 |

### 1.2 明确不变

- `domain`／`name` 创建后不可变；更新仍写回原路径。
- `roles_allowed` 与 Role 工具授权仍是唯一 Skill 对象／通道权限事实源。
- `published` 仍只是 Skill frontmatter 状态，不进入语义发布流水线。
- 内容校验问题的既有保存策略不变；owner 的结构错误按本 Spec 单独处理。
- MCP `lucy_skill_search`／`lucy_skill_read`、Resource、Prompt 的授权矩阵不变。
- 本地账户「所有者」与业务资产「负责人」是两个概念，不得互相推导。

## 2. 目标与非目标

### 2.1 目标

1. 用户可为一条草稿或已发布 Skill 指定、修改或清除负责人。
2. 总览和详情无需打开原始 Markdown 即可看到负责人。
3. 保存预检和配置审计能区分「负责人是谁」与「这次由谁修改」。
4. 既有 Skill、外部手工文件和损坏元数据均有确定、可验收的兼容行为。

### 2.2 非目标

- 负责人必须是 Lucy 登录账户、必须是唯一人员或必须含邮箱。
- 按负责人授权、审批、通知、搜索、筛选、分页或统计。
- 技能市场、评分、下载量、执行历史或外部客户端安装。
- 批量设置负责人、账户删除后的自动改派或组织目录同步。
- 自动递增 Skill 版本；版本仍由编辑者显式维护。

## 3. 数据契约

### 3.1 frontmatter

```yaml
---
name: revenue-report
domain: analysis
title: 收入分析规程
version: 1.3.0
status: published
owner: 数据治理组
roles_allowed: ["*"]
---
```

`owner` 合同：

| 项 | 规则 |
|---|---|
| 类型 | 可选字符串；禁止数组、对象、数字、布尔值和显式 `null` |
| 规范化 | 只 trim 首尾空白，不折叠内部空白，不转小写 |
| 长度 | trim 后 0–80 个 Unicode code point；空字符串等价于未指定 |
| 字符 | 允许中文、英文、数字、空格及常见团队标点；禁止 C0／C1 控制字符和换行。**控制字符检查作用于 trim 前的原始值**：首尾的 `\n`／`\t` 等同样判非法，不按 trim 结果放行 |
| 缺省 | 缺失显示「未指定」；读取结果为 `owner: ""` |
| 身份 | 不参与 `lucy-skill://<domain>/<name>`，不进入 `file_version` 之外的第二身份 |

实现不得用 `String(value)` 把对象或数组变成看似合法的负责人。

### 3.2 损坏声明

loader 返回：

```ts
owner: string
owner_invalid?: true
```

- 非字符串、超长或含控制字符时，`owner=""`、`owner_invalid=true`，validator 增加 `skill_owner_invalid`，字段为 `owner`，`type` 固定为 `warning`。
- 该 issue 为 warning，**不得使 `validation.valid` 由 `true` 翻转为 `false`**：既有 Skill 因 owner 损坏而新增的校验结论仍是「校验通过」，损坏声明只在总览校验列与详情中披露。`valid` 仍按既有规则判定（只有 `type:"error"` 才使其为 false）。owner 损坏与 `roles_allowed` 损坏不同——后者影响运行时授权，故为 error；前者按 D05 只披露、不阻断。
- 既有文件仍可出现在治理台，Agent 的既有授权与读取不因 owner 损坏而拒绝。
- 阅读态显示「负责人声明无效，请编辑修复」，不得把原始损坏值当作负责人展示。
- 结构化更新若未显式提供合法 `owner`，返回 `400 skill_owner_invalid`；显式填写合法值或空字符串后可保存。
- `rawContent` 必须直接包含合法 `owner` 或移除该键；不能靠输入模型忽略损坏声明。

## 4. API 与审计

### 4.1 现有 API 增量

| API | 增量 |
|---|---|
| `GET /api/skills?includeContent=false` | 每项增加 `owner`，损坏时增加 `owner_invalid`；仍不返回正文 |
| `GET /api/skills/:domain/:name` | 返回同一负责人形状 |
| `POST /api/skills`／`PUT /api/skills/:domain/:name` | `SkillWriteInput` 增加可选 `owner?: string`；更新缺省保留，空字符串清除 |
| 两个 preview API | `impact.owner={from,to}`；diff 与 proposedMarkdown 包含拟写入 frontmatter |
| `DELETE` | 不改变请求；删除审计 old summary 保留删除前负责人 |

除新增 `skill_owner_invalid` 外，不创建一套负责人专用路由或错误码。既有 `skill_write_conflict`、`skill_expected_version_required`、身份不可变和路径冲突合同继续优先适用。

### 4.2 配置审计

- `skill_create.newSummary`、`skill_edit_save.oldSummary/newSummary`、`skill_delete.oldSummary` 增加 `owner` 字符串；损坏声明被显式修复时，对应 summary 增加布尔 `owner_invalid`，不得伪造损坏原文。
- actor、actorType、source、requestId、targetId 继续来自既有可信上下文；`owner` 不得覆盖 actor。
- 配置审计详情可直接回答：谁在哪次写入把哪条 Skill 的负责人从什么值改为什么值。
- 复用现有 intent／terminal 原语，并在 S1 为 Skill 文件补齐回滚闭包。无 intent 不写文件；committed terminal 失败时恢复写入前字节并尽力记录 `rolled_back`，不得返回成功。恢复也失败时必须返回 500、保留 pending／failed 证据并触发修复，不得宣称已回滚。
- 预检没有审计副作用；审计 CSV 和导出不新增第二套负责人事实源。

## 5. WebUI 合同

1. 总览列顺序为：名称、域、状态、版本、**负责人**、校验结果。缺省显示「未指定」，不使用空白或虚构账户头像。
2. 阅读态元数据区增加「负责人」；损坏状态使用既有 warning 样式。
3. 编辑元数据区增加单行文本框，label 为「负责人」，辅助说明「可填写人员或团队；不影响访问权限」。
4. 新建默认为空；从详情进入编辑时载入当前 owner。清除后保存即写入 `owner: ""`，后端可规范化为省略该键，但 API 读取形状保持一致。
5. 预检增加「负责人：旧值 → 新值」，无变化时不需单独高亮；草稿改变后旧预检继续失效。
6. 不新增负责人筛选、下拉账户选择器、邮箱字段或通知开关。
7. `owner`、`skill_owner_invalid`、Skill URI 和文件路径等 DOM 按术语标准做浏览器翻译防御；负责人文本本身可翻译属性不强制，但始终按纯文本转义。
8. 写入失败沿用既有 skills 错误信封：后端 `error` 字段**只返回稳定码**，用户可见中文由前端错误映射表负责。`skill_owner_invalid` 必须登记到 `webui/src/lib/skills.ts` 的错误映射表（与既有 `skill_roles_invalid` 同处），界面不得显示裸码。

## 6. 核心流程（伪代码）

```text
parseOwner(frontmatter):
  if key absent:
    return { value: "", invalid: false }
  if typeof value != string:
    return { value: "", invalid: true }
  normalized = trim(value)
  if codePointLength(normalized) > 80 or containsControlCharacter(value):
    return { value: "", invalid: true }
  return { value: normalized, invalid: false }

load skill:
  parsedOwner = parseOwner(frontmatter)
  asset.owner = parsedOwner.value
  if parsedOwner.invalid: asset.owner_invalid = true
  // owner 不参与 ACL、发布状态或 MCP 裁决

structured update(existing, input, expected_version):
  fresh = reload exact existing URI
  require expected_version == fresh.file_version
  require domain/name unchanged

  if fresh.owner_invalid and input.owner is absent:
    deny 400 skill_owner_invalid
  owner = input.owner is absent ? fresh.owner : validateOwner(input.owner)
  if owner invalid: deny 400 skill_owner_invalid

  candidate = serialize all existing fields + owner + other explicit edits
  preview or write uses the same candidate serializer
  // no version, status or roles_allowed side effect unless explicitly edited

confirm write:
  persist config-audit intent with old/new owner and trusted actor
  atomically write original path
  persist committed terminal
  if committed terminal cannot persist:
    restore previous file bytes atomically
    if restore succeeds: best-effort record rolled_back; return failure
    else: preserve pending/failed evidence; return 500 requiring repair
  invalidate skill cache and return reloaded asset
```

## 7. 用户可见错误与边界

| 场景 | 码／展示 | 行为 |
|---|---|---|
| owner 类型、长度或字符非法 | `skill_owner_invalid`／「负责人格式无效，请输入 80 个字符以内的人员或团队名称」 | 400；不写文件、不写审计成功记录 |
| 已损坏 owner 未显式修复 | `skill_owner_invalid`／「负责人声明无效，请填写或清空后再保存」 | 400；不得静默省略旧键 |
| 并发修改 | 既有 `skill_write_conflict` | 409；重新加载，不覆盖他人修改 |
| 审计不可用 | 沿用既有配置审计错误 | 不把文件修改当作已成功提交 |
| Agent 读取 owner 损坏的旧 Skill | 无新增 MCP 错误 | 原授权结果不变；治理台披露修复 |

表中「码」是后端 `error` 字段返回的稳定码，「展示」是前端错误映射表给出的用户可见文案；**两者不出现在同一个响应里**。后端不得把中文文案塞进 `error` 字段——既有前端按已知码查表映射（`webui/src/lib/skills.ts:103-118`），查不到时直接回显原始字符串，界面会显示裸码或裸中文。

## 8. 验收矩阵

所有用例初始状态均为未执行。设计签核不计任何一项通过；默认不额外执行移动窄屏测试。

| 编号 | 验收场景 | 通过标准 |
|---|---|---|
| SKO-01 | 既有文件无 owner | 读取为 `owner:""`，总览／详情显示「未指定」；无迁移或批量回填 |
| SKO-02 | 新建草稿并指定负责人 | 文件、摘要、详情和响应均为同一 owner；其余默认合同不变 |
| SKO-03 | 已发布 Skill 修改负责人 | 保存后只改变显式编辑字段；不自动改状态、版本或授权 |
| SKO-04 | 清除负责人 | 空字符串保存后显示「未指定」；后续读取无旧值残留 |
| SKO-05 | 中文、团队和首尾空白 | trim 后准确保留内部文本；按纯文本显示，无 HTML／Markdown 注入 |
| SKO-06 | 非字符串、超长、控制字符 | loader 标记 `owner_invalid`；validator 有稳定 code `skill_owner_invalid` 且 `type` 为 warning；首尾带 `\n`／`\t` 的原始值判非法（控制字符检查在 trim 前）；`validation.valid` 不因 owner 损坏翻转为 false；原 Skill 的 MCP 授权不因此改变 |
| SKO-07 | 损坏声明修复 | 未显式提供 owner 的保存被拒；合法填写、清空或 rawContent 修复后可保存 |
| SKO-08 | rawContent 创建／更新 | 与结构化路径使用同一 parseOwner 合同，对象不被字符串化 |
| SKO-09 | 预检 | 显示 owner 前后值和真实 frontmatter diff；无文件、审计或缓存写副作用 |
| SKO-10 | CAS 与身份 | 过期 `expected_version` 拒绝；owner 修改不改变 domain、name、URI 或原路径 |
| SKO-11 | 配置审计 | create／edit／delete 摘要包含 owner；edit 可同时看到 actor 与 owner 前后值 |
| SKO-12 | 审计失败与回滚 | intent 缺失不写文件；committed terminal 失败恢复原文件且不返回成功；恢复失败保留证据并显式要求修复 |
| SKO-13 | 权限隔离 | owner 不是登录账户或角色；修改 owner 不改变 roles_allowed、工具能力或 MCP 拒绝原因 |
| SKO-14 | 摘要与导出 | 摘要仍无正文；既有 Skill 导出保留 owner，MCP 不新增负责人授权语义 |
| SKO-15 | 工作台回归 | 创建、编辑、取消、脏数据保护、删除和发布状态预检不回归；无技能市场入口 |
| SKO-16 | 工程门禁 | 定向 server／UI 测试、构建、术语与 Spec lint 通过；selector contract **不新增 issue**（既有基线为红，见审阅记录 F-12，不在 L25-04 授权范围内）；浏览器测试仅按明确任务要求执行 |

## 9. 实施拆分建议（不代表已授权）

| 阶段 | 内容 | 退出条件 |
|---|---|---|
| S1 数据与写入 | types、loader、validator、writer、rawContent、preview impact、audit summary | SKO-01～14 的服务端用例 |
| S2 工作台 | client types、总览列、详情、编辑字段、预检和错误映射 | SKO-02～05／09／15 的 UI 用例 |
| S3 文档与验证 | selector（新增 `data-testid` 须登记进 `docs/qa/selector-contract.md`）、系统手册、术语复核及定向工程门禁 | SKO-16；未获浏览器测试要求时不自行扩项 |

实施 Plan 应列明实际测试文件和既有配置审计回滚测试复用点，不得把负责人字段扩展成账户或通知子系统。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms（已同步登记到术语标准 §4.10）:

| Canonical Term | UI 主术语 | 禁止文案／边界 |
|---|---|---|
| Skill Owner | 负责人 | 不写成「所有者」「管理员」「审批人」；自由文本人员或团队标签，不授权 |
| Unassigned Skill Owner | 未指定 | 不写成「无负责人账户」；表示缺省，不是异常 |

既有「业务 Skill」「所有者」「可访问角色」「保存并预检」「配置审计」继续按全局标准使用。

## 10. 评审检查点

- [x] 认可 owner 为自由文本治理标签，不绑定登录账户或邮箱。
- [x] 认可既有文件缺省不迁移、损坏不阻断 MCP、保存必须显式修复。
- [x] 认可复用预检、CAS 和配置审计闭环，不新增存储。
- [x] PM 签核设计基线（2026-10-26）：设计基线成立，暂不开发；开发授权与验收另行决定。
