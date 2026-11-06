# 访问关系图固定已确认关联：对抗审阅

- 审阅方式：用户授权本机 Codex CLI（`codex exec -s read-only --skip-git-repo-check -C …`）。第 1 轮两次调用均因 ChatGPT workspace routing／504 失败（摘录见 `inbox/codex-review-access-map-confirmed-only-round1*.txt`）。**等价对抗审阅**由 Cursor reviewer 子代理（Grok）完成，结论记入本文件。后续轮次优先重试 Codex CLI；若仍不可用则继续等价审阅，计入 3 轮上限。
- 对象：`lucy-20261105-access-map-confirmed-only` Spec／Plan。
- 上限：三轮（用户指定）。

定稿只覆盖这份设计合同。**未获「按本 Plan 开工」授权前**不得改 `webui/` 业务代码（D11 文档改写除外）。定稿不表示开发已授权。本条收口不表示可上线。

## 第 1 轮

对象是 Spec／Plan **v0.1**。结论：**退回修订。** 阻塞 1，高 2，中 2，低 1。代理：[adversarial review](8939d7ce-6481-49d1-ae03-7de1de6bfd6f)。

1. **F01｜阻塞** — 与已收口 hourly-detail／audit-echo／187／chart-first 的「须保留下拉／可切含候选」未闭合；SC-13 允许只加指针。
2. **F02｜高** — trust 空串／空白／大小写／别名可经 `readParam` 静默落到 confirmed；缺对应 SC。
3. **F03｜高** — 小时明细／拒绝集合打假可空过；SC-11「若含 detail」；D 未与 B 同收窄。
4. **F04｜中** — Plan 漏 access-map.ts 第二处 SQL、selector-contract、图例动态标签。
5. **F05｜中** — `lint:spec-docs` 误入功能出口。
6. **F06｜低** — 400 文案／`field` vs `param` 未对齐。

已核对无问题：取消下拉、硬锁 A、方案 1 静态披露、D10、非目标边界、索引已挂、gov-filters 排除。

## 第 1 轮后修订（→ v0.2）

| 项 | 处理 |
|---|---|
| F01 | D11 废止表；SC-13 禁止只加指针；冲突以本 Spec 为准 |
| F02 | D12／D13；专用 parse；SC-05／SC-09 |
| F03 | D6／D8 明确 B→E／D；SC-10 四条预写；SC-11 强制 `view=table` |
| F04 | Plan 列出 access-map 两处 SQL、selector-contract、图例字面量 |
| F05 | SC-14 lint 移出功能出口 → Plan S3 |
| F06 | D14；`param`＋「关联口径只接受已确认关联」 |

## 第 2 轮

对象是 Spec／Plan **v0.2**。结论：**退回修订。** 阻塞 0，高 2，中 3，低 0（Codex CLI）。摘录：`inbox/codex-review-access-map-confirmed-only-round2.txt`。等价复核见 [round2 reviewer](ed697b8e-a8f3-4f35-a1fa-0b909b8e23cb)（另记 F08）。

1. **F02｜高（残留）** — 专用 parse 未接到原始 HTTP 查询串；缺重复键端到端。
2. **F03｜高（残留）** — 强制 table 仍可能空明细通过；缺测试缝逐桶精确相等与正向必现。
3. **F01｜中（残留）** — 废止表遗漏 §5.1／EchoFilter／187 示例与图例句；可拖到 S3。
4. **F06｜中（残留）** — SC 写 `error.param`，HTTP 实为 `data.param`。
5. **F07｜中（新增）** — 「字节级」与 trim 后接受冲突。
6. **F08｜低／中（复核）** — 400 后改其它筛选会抹掉非法 trust；需时间界。

已闭合：F04、F05。

## 第 2 轮后修订（→ v0.3）

| 项 | 处理 |
|---|---|
| F02 | D12 原始 search；Plan 列 routes；SC-05／08–10 HTTP＋未调 provider |
| F03 | D15；SC-11 逐桶 id 精确相等＋已确认必现 |
| F01 | D11 补章节；定稿 S0 非 S3；SC-14 语义复扫 |
| F06 | D14／SC-08 → `body.data.param` |
| F07 | 统一 trim；SC-07 含 `%20confirmed%20` |
| F08 | D13 时间界：仅用户主动改筛选可省略 trust |

## 第 3 轮

对象是 Spec／Plan **v0.3**。结论：**可定稿（附条件）**。阻塞 0，高 0，中 0，低 1。摘录：`inbox/codex-review-access-map-confirmed-only-round3.txt`。

已闭合：F01／F02／F03／F06／F07／F08（设计层）；F04／F05 未回归。

残留（不退回）：

1. **F09｜低** — 审阅记录授权前置措辞与 Plan 开工条件冲突。

## 第 3 轮后补丁（定稿）

| 项 | 处理 |
|---|---|
| F09 | 审阅记录改为「未获按本 Plan 开工前不得改 webui」 |
| 定稿条件 | 同次完成 D11 正文改写、SC-13／SC-14、状态镜像 |

**定稿条件已满足。** 定稿不表示开发已授权，也不表示 SC 已执行。本条收口不表示可上线。
