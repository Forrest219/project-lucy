# L25-04 业务 Skill 负责人 —— 功能合同收口记录

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-01（Asia/Shanghai） |
| Spec | [`docs/specs/lucy-20261025-v0p25-skill-owner-spec.md`](../specs/lucy-20261025-v0p25-skill-owner-spec.md)（收口后 **v0.5**） |
| Plan | [`docs/plans/2026-10-26-lucy-v0.25-l25-04-skill-owner-implementation-plan.md`](../plans/2026-10-26-lucy-v0.25-l25-04-skill-owner-implementation-plan.md) |
| 台账号 | L25-04（v0.25 登记册） |
| 层级 | **功能合同** |
| 结论 | **SKO-01–SKO-16 全部关闭。** 本条收口**不表示可上线**——镜像构建、部署、客户交付、客户环境验证均不在本条出口 |
| 授权 | PM 2026-11-01 批准「B 档 + 形态搭车」批次 |

---

## 一、出口矩阵结果（逐条 SKO → 用例 → 文件）

**证据等级：本地自动化（vitest）＋ 本地工程门禁。** 无 CI job 证据，无客户环境证据。

| SC | 结果 | 证据落点（用例名 → 文件） |
|---|---|---|
| SKO-01 | 通过 | 「SKO-01 既有文件没有 owner 时读为未指定，且不产生损坏声明」→ `server/__tests__/skill-owner-l25-04.test.ts`；「SKO-01 既有文件无 owner：读为未指定，读取不回写磁盘（无迁移、无批量回填）」→ `server/__tests__/skill-owner-sko-acceptance.test.ts`；「SKO-01 总览有负责人列，缺省显示「未指定」」→ `src/__tests__/skill-list.test.tsx`；「SKO-01 详情态在没有负责人时显示「未指定」」→ `src/__tests__/skill-owner-sko-acceptance.test.tsx`；「SKO-01/SKO-14 列表与详情返回同一个 owner，缺省为空且不返回正文」→ `skill-owner-l25-04.test.ts` |
| SKO-02 | 通过 | 「SKO-02 新建并指定负责人：文件、响应与审计摘要一致」→ `skill-owner-l25-04.test.ts`；「SKO-02 新建草稿并指定负责人：文件、摘要、详情、响应四处一致，其余默认合同不变」→ `skill-owner-sko-acceptance.test.ts`；「SKO-02/03 编辑态可填写负责人，保存时随载荷提交」→ `skill-list.test.tsx` |
| SKO-03 | 通过 | 「SKO-03 修改已发布 Skill 的负责人只改负责人，不动状态、版本与授权」→ `skill-owner-l25-04.test.ts`；「SKO-03 修改已发布 Skill 的负责人：只改变显式编辑的字段」→ `skill-owner-sko-acceptance.test.ts`；「SKO-03 只改标题时载荷仍带原负责人，不会被静默清空」→ `skill-owner-sko-acceptance.test.tsx` |
| SKO-04 | 通过 | 「SKO-04 清除负责人后读回未指定，文件里不再有该键」→ `skill-owner-l25-04.test.ts`；「SKO-04 清除负责人：保存后读回未指定，磁盘与后续读取都无旧值残留」→ `skill-owner-sko-acceptance.test.ts`；「SKO-04 清除负责人：提交显式的空字符串，保存后总览显示「未指定」」→ `skill-owner-sko-acceptance.test.ts` |
| SKO-05 | 通过 | 「SKO-05 写入时首尾空白被 trim，内部空白保留」→ `skill-owner-l25-04.test.ts`；「SKO-05 首尾空白被 trim、内部空白原样保留；注入型文本按纯文本存取，不被解释」→ `skill-owner-sko-acceptance.test.ts`；「SKO-05 预检显示负责人旧值 → 新值」→ `skill-list.test.tsx`；「SKO-05 注入型负责人按纯文本显示：总览与详情都不产生真实元素」→ `skill-owner-sko-acceptance.test.tsx` |
| SKO-06 | 通过 | 「SKO-06 损坏声明在读取时披露，Agent 的授权与读取不受影响」「SKO-06 非字符串 owner 是损坏声明：不被字符串化，且校验为 warning 而非 error」「SKO-06 显式 null 与超长 owner 都判非法，80 个 code point 仍合法」「SKO-06 超长负责人写入被拒，且不落盘」→ `skill-owner-l25-04.test.ts`；「SKO-06 损坏声明在阅读态披露，且不显示为负责人」→ `skill-list.test.tsx`；「SKO-06 总览列对损坏声明显示「声明无效」，且不把损坏原文当负责人展示」→ `skill-owner-sko-acceptance.test.tsx` |
| SKO-07 | 通过 | 「SKO-07 损坏声明必须显式修复：未提供负责人时保存被拒」→ `skill-owner-l25-04.test.ts`；「SKO-07 损坏声明：未修复被拒且磁盘不变；显式清空或 rawContent 修复后可保存」→ `skill-owner-sko-acceptance.test.ts`；「SKO-07 损坏声明未修复前不随保存静默清除」→ `skill-list.test.tsx` |
| SKO-08 | 通过 | 「SKO-08 rawContent 路径使用同一合同：对象不会被字符串化」→ `skill-owner-l25-04.test.ts`；「SKO-08 rawContent 更新路径与创建路径同一合同：对象不被字符串化」→ `skill-owner-sko-acceptance.test.ts` |
| SKO-09 | 通过 | 「SKO-09 预检显示负责人前后值与真实 frontmatter diff，且不写文件」→ `skill-owner-l25-04.test.ts`；「SKO-09 预检显示负责人前后值与真实 diff，且无文件、审计与缓存副作用」→ `skill-owner-sko-acceptance.test.ts`；「SKO-09 预检披露负责人旧值 → 新值」→ `skill-owner-sko-acceptance.test.tsx` |
| SKO-10 | 通过 | 「SKO-10 过期 expected_version 被拒，负责人修改不改变身份」→ `skill-owner-l25-04.test.ts`；「SKO-10 改负责人不改变 URI 与原路径，过期 expected_version 仍被拒」→ `skill-owner-sko-acceptance.test.ts` |
| SKO-11 | 通过 | 「SKO-11 删除审计摘要保留删除前的负责人」→ `skill-owner-l25-04.test.ts`；「SKO-11 配置审计：create／edit／delete 摘要含 owner；edit 同时能看到 actor 与 owner 前后值」→ `skill-owner-sko-acceptance.test.ts` |
| SKO-12 | 通过 | 「SKO-12 意图记录缺失时不写文件」「SKO-12 committed terminal 失败时恢复原文件，审计记 rolled_back，且不返回成功」「SKO-12 恢复也失败时显式要求修复，不谎称已回滚」→ `skill-owner-l25-04.test.ts` |
| SKO-13 | 通过 | 「SKO-13 负责人不是账户或角色：改动它不动 roles_allowed」→ `skill-owner-l25-04.test.ts`；「SKO-13 负责人不是账户或角色：改它不改变授权判定与 MCP 拒绝原因」→ `skill-owner-sko-acceptance.test.ts` |
| SKO-14 | 通过 | 「SKO-01/SKO-14 列表与详情返回同一个 owner，缺省为空且不返回正文」→ `skill-owner-l25-04.test.ts`；「SKO-14 摘要无正文；既有导出保留 owner；MCP 授权集合未新增负责人语义」→ `skill-owner-sko-acceptance.test.ts` |
| SKO-15 | 通过（**本次补 2 条缺口用例**） | 「SKO-15 工作台没有技能市场入口」→ `server/__tests__/skill-owner-sko-acceptance.test.ts`；**新增**「删除是两步确认：第一步只武装删除、不发请求，确认后才发 DELETE」「发布状态进入预检：「状态变化」反映 草稿 → 已发布，且未确认前不写盘」→ `src/__tests__/skill-owner-sko-15-workbench-regression.test.tsx`；其余工作台回归项（创建／编辑／保存／取消／脏数据保护／预检主体）由 `src/__tests__/skill-list.test.tsx` 既有断言承载 |
| SKO-16 | 通过 | 见 §二 工程门禁表。**本条判据是「不新增 issue」，不是「issue 总数为 0」** |

## 二、SKO-16 工程门禁（2026-11-01 实测）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 定向 server／UI 测试 | `npx vitest run --maxWorkers=1`（本条 5 个测试文件） | **5 文件 / 53 条全绿** |
| 构建 | `npm --prefix webui run build` | **exit 0**（vite build + precompress 94 assets） |
| 术语 lint | `npm run lint:terminology` | **exit 0**（1094 files scanned） |
| Spec lint | `npm run lint:spec` | **exit 0** |
| Spec/Plan 形态门禁 | `node scripts/lint-spec-docs.mjs` | **exit 0**（343 files scanned） |
| selector contract | `npm --prefix webui run e2e:selector-contract` | **exit 1**，但**本批新增 0 条 issue**（见下） |
| typecheck | `cd webui && npx tsc --noEmit` | 全仓 **86** 个既存错误（与收口前一致），**本条涉及文件 0 错** |

**selector contract 口径澄清（本批实测更正）**：

- 门禁当前输出 **201 条 issue**，构成：`❌ UNREGISTERED` 143 ＋ `❌ UNREGISTERED TEMPLATE` 56 ＋ `❌ SPEC-DANGLES-IMPL` 2 ＝ **201（决定退出码的 fail 集）**；另有 `⚠️ ORPHAN` **57**（warn，不计入 201）与 `ℹ️ NEGATIVE-REF` 3（信息级）。
- Spec 旧文写的「fail 数保持 **24**」是 **2026-10-26 的旧值**，与今天门禁口径已不可比（fail 集 201）。**本批据实更正为「不新增 issue」判据**。
- **可归因到本条（L25-04）的残留只有 1 条 warn 级 ORPHAN**：`skill-detail-owner`——该 testid 经 `DetailRow` 的 `testId` prop 渲染，而门禁脚本只识别字面量 `data-testid="..."`，运行时实现存在；与基线 ORPHAN 同型。
- 另一条 skill 相关 ORPHAN `skill-field-triggers` 经 git 溯源**不属于本条**（`eb2914f5` 只登记了 `skill-detail-owner` / `skill-owner` / `skill-field-owner` / `skill-preflight-owner` 四个），不在本条残余里。
- **本批新增 0 条 issue 的证明**：把新增用例文件临时移走复跑门禁，issue 行集合**逐条完全相同**（258 行 ↔ 258 行，diff 为空）。原因是本批只**复用已登记的 testid**（`skill-delete` / `skill-delete-confirm` / `skill-cancel-edit` / `skill-dirty` / `skill-preflight*`），**未新增任何 testid**，因此无需新增 selector 合同登记。

## 三、本批为收口补的东西（只加测试，不改运行代码）

| 文件 | 性质 | 为什么需要 |
|---|---|---|
| `webui/src/__tests__/skill-owner-sko-15-workbench-regression.test.tsx` | **新增测试（2 条）** | SKO-15 矩阵列了「删除和发布状态预检不回归」，但 `skill-delete` / `skill-delete-confirm` **全仓无任何断言**，「状态变化」行也没有专项断言。SKO-15 是能打假本条承诺的检查，按 `DEVELOPMENT.md:80` **不能靠收窄出口掩盖**——补用例而非改口径 |

**未改任何运行代码。** 组件行为本来就正确（`skill-delete` → `skill-delete-confirm` 两步确认、预检里 `SKILL_STATUS_LABELS` 渲染的「状态变化」都已实现），补的是**此前不存在的断言**，不是改实现去凑门禁。

**补用例时撞到既有守卫（已修正，记录在案）**：`webui/src/__tests__/skill-owner-sko-acceptance.test.ts` 的 SKO-15 用例会逐文件扫描 `webui/src/` 下所有源文件，出现被禁界面词即判失败。新用例文件**首版注释里引用了 SKO-15 矩阵原文**，其中的界面词触发该守卫，导致合并跑时该用例报红（单跑不报，因为守卫只在自己文件里扫 `webui/src`）。已把注释改为**转述**而非引用原文，并加注说明「本文件位于 `webui/src/` 下，正文被该守卫逐文件扫描」。修正后 5 文件合并跑 53 条全绿。

> 这条守卫是**逐文件全量扫描**，因此**新增任何 `webui/src/` 下的文件都要先过它**——注释里也不能出现被禁词。

## 四、残余

1. `skill-detail-owner` ORPHAN（warn 级）：门禁脚本的静态扫描口径问题，非实现缺陷。**不影响本条收口**。
2. 全仓 selector contract fail 集 201 条：既有欠账，属跨条治理，不在本条出口。
3. 全仓 typecheck 86 个既存错误：既有基线，本条涉及文件 0 错。

## 五、不在本次收口里

- **浏览器实测与移动窄屏验证**（本条未获授权执行）。
- **镜像构建、部署、客户交付、客户环境验证**——本条收口**不表示可上线**，也不构成客户包验收。
- **整库旅程、Agent 路径、跨模块或系统级故障演练、证据等级**——归发布取证层（该层目前 **0 份 Spec** 承载，见 [`2026-11-01-spec-closure-inventory.md`](2026-11-01-spec-closure-inventory.md) §五）。
- **SMTP／OIDC 等邻条**的 `blocked_env` 项，与本条无关。

## 六、复现命令

```bash
cd /Users/forrest/GitHub/project-lucy/webui
CLEAN_PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v "minimax" | tr '\n' ':')
env PATH="$CLEAN_PATH" npx vitest run --maxWorkers=1 \
  server/__tests__/skill-owner-l25-04.test.ts \
  server/__tests__/skill-owner-sko-acceptance.test.ts \
  src/__tests__/skill-list.test.tsx \
  src/__tests__/skill-owner-sko-acceptance.test.tsx \
  src/__tests__/skill-owner-sko-15-workbench-regression.test.tsx
```

> 必须用干净 PATH：本机 `/Users/forrest/.minimax/shims/rm` 是 `mavis-trash` 垫片，非交互子进程里 `rm -rf` 会挂死不返回。
