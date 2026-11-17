# Run — 2026-11-17 — cursor-copy-probe-first

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-COPY-FAKE-SUCCESS` |
| Agent | Cursor |
| 环境 | 本机 demo，**局域网 IP** `http://192.168.3.46:55176`（明文 HTTP，非安全上下文）；容器 `compose-lucy-1` healthy；构建 `abb389133356`；Playwright Chromium headless |
| 开始／结束 | 2026-11-17 ≈21:00 CST（探针总耗时约 14 秒） |
| 总判定 | **FAIL**（必做 R0／03 PASS；01 FAIL；02 FAIL） |
| 证据 | `inbox/uat-copy-fake-success-2026-11-17/probe-result.{json,md}`（临时目录，可删；下表为摘要） |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-COPY-R0 | **PASS** | 登录 200；`isSecureContext=false`；`navigator.clipboard` 不存在；阳性对照（`focus()+select()` 写入哨兵再粘贴读回）＝true，说明读回法能看见真实复制 |
| UAT-COPY-01 | **FAIL** | helper 三个载荷（`ascii-40hex`／`cjk-multiline`／`long-3k`）全部：helper 自报 `{ok:true}`，`execCommand("copy")` 返回 `true`，但调用瞬间选区内容为空串，粘贴读回仍是哨兵串＝**FAKE-SUCCESS 3/3** |
| UAT-COPY-02 | **FAIL** | 7 个可点入口全部 **FAKE-SUCCESS**（界面提示已复制，读回不变）；1 个 NOT-RUN（见下表） |
| UAT-COPY-03 | **PASS** | `lint:copy-surfaces`：13 个文件／15 个调用点与登记表一致；`lint-copy-surfaces.test.ts` 14 条全过（含反例） |
| UAT-COPY-04 | **NOT-RUN** | 可选；本波未跑公网实例（需确认可接受其上的 `ktx connection test` 真跑）。2026-11-17 早先对公网版本页的手工浏览器复现已记入错题，不等同本用例 |

## UAT-COPY-02 逐入口

| 入口 | 界面说已复制 | 剪贴板确有内容 | 判定 |
|---|---|---|---|
| 版本信息：复制构建提交 | 是 | 否 | **FAKE-SUCCESS** |
| 新建 Token：复制 Token 明文 | 是 | 否 | **FAKE-SUCCESS** |
| 新建 Token：复制当前配置 | 是 | 否 | **FAKE-SUCCESS** |
| Agent 详情：复制 Token hash | 是 | 否 | **FAKE-SUCCESS** |
| 审计对账：复制表排行全文 | — | — | NOT-RUN：按钮禁用（demo 无审计数据，`rankedTables` 为空） |
| 概览：复制 MCP 配置 | 是 | 否 | **FAKE-SUCCESS** |
| 连接测试：复制命令 | 是 | 否 | **FAKE-SUCCESS** |
| 连接测试：复制 Log | 是 | 否 | **FAKE-SUCCESS** |

## 登记表中未点击的入口（原因必写）

| 入口 | 原因 |
|---|---|
| 审计：复制事件／问询 ID | demo 审计问询为 0 条，无 ID 按钮可点 |
| 审计：复制触达表清单 | 需要含触达表的真实问询行 |
| 行级策略：复制表身份 | 需要已配置行策略的表行 |
| 连接概览：复制路径 | 仅在存在缺失 Manifest 警告时出现 |
| 启用表：复制 Manifest 路径 | 仅在空态提示出现 |
| 接入向导第 6 步：复制提示／Token／配置 | 已完成接入的实例 `/onboarding` 跳转到概览，步骤不可达 |
| 接入向导：复制撰写说明 | 同上 |
| 审计信任列：复制用户 ID | 无审计行；该控件无成功态，失败才提示 |

这 8 个入口共用同一个 helper，其可信度由 UAT-COPY-01 承载：01 已 FAIL，故它们**同样不可信**，只是未被逐个点到。

## 结论与影响面

- 根因在共享 helper `webui/src/lib/clipboard.ts` 的 `execCommand` 降级路径：隐藏 textarea 只做了 `addRange(selectNodeContents)`，没有 `focus()`／`select()`，Chromium 对表单控件得到空选区，`execCommand("copy")` 仍返回 `true`。
- **全部 15 个调用点共享此根因**；7 个入口已被真实点击证伪，其余 8 个由 01 间接证伪。
- 现有单测与 e2e 全部 stub 了 `execCommand`，或跑在回环（安全上下文），因此一直是绿的。
- 本跑次**没有**改任何运行代码；`clipboard.ts` 未修复，修复须另获委托人开发授权。

## 备注

- 探针是否使用 `docker restart`：否；本跑次未改容器、ACL、Agent、连接配置。
- 新建 Token 的签发请求在浏览器里打桩（`lucy_copy_probe_stub_token`），未写入真实 Token。
- 连接测试为只读真跑。凭据只读入进程，未打印、未落盘。
- 探针迭代：首次跑出现过两处探针自身的误判（计数式判定漏掉「命令已复制→Log 已复制」文案替换；禁用按钮点击超时），已改为「新增文本行」判定与禁用态 NOT-RUN；本记录取修正后的第三次运行。
- **≠ 功能合同收口**；**≠ 可上线**。
