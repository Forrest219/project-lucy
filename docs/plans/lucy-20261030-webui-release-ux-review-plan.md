# 发版前 WebUI 三层检查实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | v1.2 / 2026-10-30 |
| 主 Spec | [发版前 WebUI 三层检查 Spec](../specs/lucy-20261030-webui-release-ux-review-spec.md)（v1.2） |
| 状态 | **v1.2 已落地 S1–S4**。契约夹具上结构套件曾 27 项中 3 项红（`/admin/usage`、`/publish/history`、`/admin/config-audit`），**2026-10-30 当日已修，复跑 27/27 全绿**。走查未开始，不构成发版通过 |
| 授权边界 | 用户于 2026-10-30 授权按本 Plan 落地。不授权客户出包，不改页面产品行为 |
| 验收 | SC-01–SC-13 的机器部分已有测试。走查与签字未执行 |
| 已拍板决策 | D1–D12，见 Spec §3。第 1 轮 F01–F08 与第 2 轮 F09 的处置见 Spec §12 |

## 1. 目标

把发版前的三层检查写成可执行的结构套件、走查清单和台账门禁。结构层只证明侧栏页面的结构不变量。观感由走查留下证据，由 xingchen 签字后才能把 `webui-ux-review` 记成通过。

## 2. 开工前置

D1–D12 已由 Spec 冻结。无未决产品决策。功能编号待 PM 指派，不阻塞文档审阅，也不因此写入 v0.25 升级建议书。

开发分四段。2026-10-30 用户授权一并落地。

| 段 | 内容 | 依赖 |
|---|---|---|
| S1 | 结构套件第一批：独立 config、`e2e:release-ux`、SC-01–SC-06、SC-08 | 已落地 |
| S2 | runbook、表面清单测试、`docs/releases/ux/README.md`、设计规范治理里的指针。SC-07、SC-09、SC-12 | 已落地 |
| S3 | 发版台账接受手工 `evidence`，并在 `productionReady: true` 时强制消费该门禁。SC-10、SC-11、SC-13 | 已落地 |
| S4 | 把 Spec §7 的表面登记为 UI 台账 Open 项 | 已落地。不修页面 |

S1 只做 Spec D3。页头动作数量、空态面板、跨状态矛盾留在走查，不提前做成易碎断言。

## 3. 文件落点

这些文件已按 2026-10-30 的实现授权创建。

| 路径 | 段 | 改动 |
|---|---|---|
| `webui/playwright.release-ux.config.ts` | S1 | 独立 config。`testDir` 不在 `webui/tests/e2e/specs`。一个 Chromium 项目，视口 1920×1080。沿用夹具的 development、回环、认证关闭。失败才截图 |
| `webui/tests/release-ux/structure.spec.ts` | S1 | 从 `navigation.ts` 读取路由。断言 Spec D3 |
| `webui/package.json` | S1 | `e2e:release-ux` 指向该 config。不改 `e2e:smoke`、`e2e:contract:release`、`e2e:real*` |
| `webui/src/__tests__/navigation.test.ts` 或同级新测试 | S2 | 每个 `navGroups` 路由和四个代表编辑器都能在 runbook 表面表中找到。未被代表行覆盖的变更编辑器必须另有一行；代表行注明同时覆盖该变更时，不要求第二行。S1 不读这份尚未创建的 runbook |
| `docs/governance/test-layers-and-release-gates.md` | S1 | §2 与 §8 登记命令。写明不是 PR 阻塞项，也不签发客户发布 |
| `docs/runbooks/webui-release-ux-checklist.md` | S2 | UX-R01–UX-R12、八句问法、基准页、禁止词、与 UX-01–UX-07 的分界 |
| `docs/releases/ux/README.md` | S2 | §9 记录字段。目录可先只有说明，没有版本记录 |
| `webui/docs/design-system/99-governance.md` | S2 | 一段指针 |
| `scripts/release/release-ledger.mjs` 与其测试 | S3 | `manual: true` 的 passed 用 `evidence` 代替 CI `run`。文件必须存在，且结果块是 Spec §9 的 passed 组合。下一产品版本在 `productionReady: true` 时必须有这条 required passed 门禁；缺失、`notExecuted`、结果块不匹配都拒绝。三个 `reasonClass` 不能被记成 passed。`required: true` 且 `failed` 仍拒绝。v0.20.0 不套用存在性检查 |
| `docs/releases/README.md` | S3 | 说明 `webui-ux-review` 从下一产品版本起才出现，v0.20.0 不追补 |
| `docs/ui-ux-feedback/pages/*.md` | S4 | 只追加 Spec §7 的 Open 项 |

`docs/releases/v0.20.0.json` 不在落点里。

## 4. 验收

按 Spec §10 的 SC-01–SC-13。S1 覆盖 SC-01–SC-06 与 SC-08。S2 覆盖 SC-07、SC-09 与 SC-12。S3 覆盖 SC-10、SC-11 与 SC-13。S4 没有对应的 SC：它是第一次走查的输入，完成定义是 Spec §7 的每个表面都有一条 Open。

结构套件通过不等于 `productionReady`。走查记录本身也不等于签字。

## 5. 完成定义

- Spec D1–D12 仍是唯一口径，实现没有另写一套通过条件。
- `cd webui && npm run e2e:release-ux` 存在，且 `cd webui && npx playwright test --list` 使用默认 config 时列不出这些用例。
- 侧栏新增路由会让清单测试失败。
- 可生产发布要有 xingchen 签过字的 `docs/releases/ux/<version>.md`。结果块是 passed 组合，台账用 `evidence` 指向它。脏构建、结构层红、走查阻断都不能靠表面行全绿绕过。
- `npm run lint:spec-docs` 对本 Spec / Plan 无形态违规。
- `docs/releases/v0.20.0.json` 的内容与实现前一致。

## 6. 风险

- 默认 Playwright 配置的 `testDir` 是 `webui/tests/e2e/specs`，全量命令没有 grep。结构用例若放进这个目录，会在四套浏览器项目里被 `e2e:contract:release` 跑到。S1 用独立 config 和独立目录避开。
- 帮助中心正文含英文技术词。禁止词扫描若覆盖全文，会把手册正文打成失败。扫描范围按 Spec §5，停在页头、指标名、表头、空态和 Toast。
- 现有台账规定 passed 和 failed 必须引用 `runs[]` 里的 CI id。手工签字若伪造一个 run id，复核时会对不上。S3 只给 `manual: true` 增加 `evidence`，不放宽「Required 且 failed 不得写入台账」。
- 阻断项未关时，不能记 passed，也不能记 required+failed。非生产记录的 `notExecuted` 必须带三个原因类之一，并与 UX 记录一致。结构层红时原因写走查未开始。走查做完后的阻断写 `walk-blocked`。实现时不要把这条收成「红了也能过台账校验」。
- 2026-10-30 的分数是基线。后续版本改回打分，或只截通过的页面，都会让 UX-R11 失效。
- 夹具数据与候选实例不同。结构层绿不证明候选实例上的空态和明细可读。走查必须跑在版本页提交与台账一致的实例上。
