# 发版台账（Release Ledger）

每个已发布产品版本一份机器可读记录，回答四个问题：**这个版本是什么、它来自哪个提交、交付物是什么、验证到了什么程度。**

`git tag` 只表达**意图**（"我打算在这个点发布"），台账表达**事实**（"发布的就是这个提交，交付物是这些摘要，门禁跑了这些"）。两者必须都在，才能追溯。

## 怎么用

| 想问 | 去哪看 |
|---|---|
| 客户手上的包对应哪个提交？ | 对应版本的 `deliveryPackage.builtFromCommit` |
| 这一版跑了哪些门禁、哪些没跑、为什么？ | 对应版本的 `gates[]`（每条 `notExecuted` 必须写原因） |
| 这一版是哪几次跑批验的？ | 对应版本的 `runs[]` |
| 这一版能不能直接给客户？ | `deliveryPackage.productionReady` 与 `productionReadyReason` |
| 客户在跑的是不是新版本？ | 当前版本线先看产品版本顺序，再用**构建提交**确认具体构建（见下） |
| 某个旧版本当时是什么状态？ | 该版本的 `.json` 文件 |

## 同一版本线按数值递增

同一产品版本线必须保持数值递增。当前 `0.x` 版本线为 `0.20.0 > 0.17.0 > 0.2.0`；`0.20.0` 接替短命的 `0.2.0`。错误的 `2.0.0` 切线已废止，其 tag 与 Release 仅作为历史事实保留，不作为当前 `0.x` 版本线的承接基准。

判断客户运行的是哪一个具体构建，使用**构建提交**（40 位 commit）。完整提交看 `/api/health.data.gitSha`、镜像内 `/app/BUILD_REVISION`，或 WebUI「系统设置 / 版本信息」页的复制内容；该页可见文本是前 12 位。构建提交是对产品版本的补充，不能用来允许当前版本线倒退。

产品版本与 Docker、Helm Chart、纯 Manifest 等部署制品解耦。同一产品版本可以发布一种或多种制品，每种制品分别记录支持状态和门禁结果；未发布的制品必须写明原因，不得由其他制品的验收结果推定。

## 文件

- `v0.20.0.json` — 当前版本，annotated tag 已指向 `abb503c`，正式 GitHub Release 已按 `v0.20.0-release-notes.md` 创建。main 跑批 `40088995603` 与 tag 跑批 `40097259604` 的四项 Required checks 均通过；项目所有者确认客户已成功部署且版本与当前 `0.20.0` 一致，**仅客户实际部署路径按人工验收放行**。两项既有非必需 demo 冒烟检查失败并获准留到下一轮修复；GHCR 权限问题导致 GitHub 客户放行链未执行，其他制品不在放行范围内。本版未新登记交付包、镜像摘要或包哈希。
- `v0.2.0.json` — 历史版本，已被 `v0.20.0` 取代。原提交、tag、Release 与门禁事实保持不变；其中“版本号不承担大小序”是当时已撤销的错误口径。
- `v2.0.0.json` — 历史版本。`v2.0.0` tag 与 Release 保留为历史事实，未删除、未移动。该版本号的客户候选包 `20261021-r7` 实际构建自 `a93880e`（比 tag 早 36 个提交，不含本次 11 项门禁修复），台账用 `builtFromDiffersFromReleaseCommit` 如实留痕。

## 维护规则

1. **打 tag 前**先写条目，`commit` 暂填 `"PENDING"`；tag 打好后回填真实 SHA。门禁会拒绝 `PENDING` 状态下的其他不一致。
2. **一版一条**，文件名 = 产品版本号（例如 `v0.20.0.json`）。不允许同一版本号有两条记录。
3. **`deliveryPackage: null` 必须写 `noDeliveryReason`** ——「本版无交付包」是合法状态，但必须显式说明，不能靠字段缺失蒙混。
4. **`notExecuted` 的门禁必须写 `reason`** ——未跑的门禁不是缺失信息，是交付结论的一部分。
5. **交付包与发布提交不一致时**，必须显式设 `builtFromDiffersFromReleaseCommit: true` 并在 `builtFromDiffNote` 解释；否则门禁直接判失败。
6. **`runs[]` 必须列出这次发布涉及的全部跑批**，每条要有 `id` 与 `trigger`；每条 `gates[].run` 必须是 `runs[]` 里的某个 id，否则门禁判失败。
7. 跑 `npm run lint:release-ledger` 校验。
8. **从 v0.20.0 的下一产品版本起**，`deliveryPackage.productionReady === true` 必须有一条 `webui-ux-review`：`required: true`、`manual: true`、`status: passed`，`evidence` 指向已存在的 `docs/releases/ux/<产品版本>.md`，且该文件的结果块是 passed 组合。手工通过不填 CI `run`。v0.20.0 不追补这条门禁。三个阻断原因类不能被记成 passed。记录格式见 [`ux/README.md`](ux/README.md)。

## 一次发布不止一次跑批

`runs[]` 不是冗余字段。一次发布至少涉及**两次** CI 跑批，而**它们跑的门禁集合不同**：

| 跑批 | 触发 | 跑什么 |
|---|---|---|
| push run | 合并到 `main`（head = 被发布的提交） | 四项 Required check 与常规门禁。**权威的放行依据** |
| tag run | 推送 `v*` tag（head 仍是同一个提交） | 只在 tag ref 上才执行的门禁，主要是 `customer-amd64-native` |

`customer-amd64-native` 的条件是 `startsWith(github.ref, 'refs/tags/v')`——在 push / PR 跑批里它是 `skipped`，**在 tag 跑批里它会真跑**。所以「它没跑」和「它跑了并失败」必须由**不同的 run id** 分别记录，不能合并成一条。

门禁会强制 `gates[].run ∈ runs[].id`：这样一条门禁就不可能引用到不属于本次发布的跑批。

## 校验

```bash
npm run lint:release-ledger        # 校验台账完整性
npm run lint:release-ledger:test   # 校验器自身的测试
```

门禁检查：当前 `VERSION` 必须有对应条目；每条必需字段齐全；`releaseTag` 与 `productVersion` 一致；`commit` 是完整 40 位 SHA（或 `PENDING`）；同一版本号不重复；`runs[]` 非空且每条有 `id` + `trigger`；每条 `gates[].run` 必须是 `runs[]` 里的 id。

### 门禁状态是三态，不是两态

`gates[].status` 有三个取值，**"跑了并失败"和"没跑"是两回事，不能混记**：

| status | 含义 | 必填 |
|---|---|---|
| `passed` | 跑了，过了 | `run`（CI run id） |
| `failed` | 跑了，**没过** | `run` + `reason`；且 `required` 不得为 `true` |
| `notExecuted` | 没跑（skipped / 被阻塞 / 手工项） | `reason` |

`failed` 且 `required: true` 会直接判门禁失败——**一份带红 Required check 的发版记录不允许存在**。若某个非 Required 门禁红了（当前是 `demo-db-smoke` / `postgres-demo-db-smoke`），就如实记 `failed` + 原因，并在评审文档里登记为已知缺陷待修，而不是记成 `notExecuted` 混过去。

`passed` 与 `failed` 必须写 `run`：门禁的价值在于「指向哪一次跑批」，没有 run id 的记录无法被复核。
