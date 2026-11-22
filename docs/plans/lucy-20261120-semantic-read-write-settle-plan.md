# 正常语义写入期间 MCP 读取有界等待 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 配对实施 Plan / v1.0 |
| 编号 | P1-70／REQ-030-091；不入核心分母 |
| 日期 | 2026-11-20 |
| 状态 | S5｜阶段:S5｜v1.0。Codex CLI终稿确权及代码终审通过；增量开发授权已获得；功能合同收口（本机自动化与真实Docker）；远端CI未执行；30分钟组合结果独立登记；不入核心分母；≠ 整套UAT PASS；≠ 可上线。 |
| 合同 | [同名 Spec](../specs/lucy-20261120-semantic-read-write-settle-spec.md)，SC-01–08为唯一新增行为合同 |
| 授权边界 | 本轮委托人选择“批准补充合同并修复”；生产实现仍须Codex CLI终稿确权通过；仅本条四文件与必要测试白名单，扩大前由M确权 |
| 验收 | Spec SC-01–08；原guard/预算/权限/TERM断言保留，真实同身份原问题恢复；新候选30分钟组合独立登记，不代签整套UAT或上线 |
| 执行总计划 | [后续计划](lucy-20261120-core-availability-followup-plan.md)，CA-05超出现行合同返回合同流程 |

## 目标与当前结论

修复真实正常Manifest写与普通MCP读取重叠导致立即恢复拒绝的可用性差集，同时保持真实恢复失败关闭。原r4短校准FAIL保留；只前移files_saved是独立阶段准确性修复，不能冒充本次失败已证根因。新增20秒从RPC入口计的等待资格截止与原budget/socket限额分别准确，不能编造原端到端30秒总预算。

本轮最小实现及局部功能出口已验证，详见文末完成登记。本计划只安排同进程manifest_upload与三个具名普通MCP工具，其他发布／报告入口不自动扩范围。总账、REQ、测试台与e2e由M维护；实现与定向证据由C，非作者审查由M另派；Docker只有M显式移交唯一资源锁后执行。

## 开工前置：G0合同与终审

1. M注册P1-70／REQ-030-091、Spec/Plan索引、F70及e2e勾连，状态与Spec现值同句；不写回旧状态。
2. Codex CLI只读终审两文件及准确接缝：真实owner/WAL发布前绑定、deadline、budget.mode、TERM、权限、publish→reload→MCP自等、独立phase缺陷与范围。
3. 保存命令、CLI版本、APPROVED原文、文件hash和时间。未通过则只修文档；通过后再冻结运行白名单并通知M实现开始。委托人批准不是跳过该终审。

## S1：先红反例与接口冻结

**运行白名单四文件：**

- `webui/server/publish-coordinator.ts`：在真实holder下登记／精确查找私有写阶段；不造新controller或按timer释放writer。
- `webui/server/semantic-recovery-journal.ts`：构造journalId后、首次WAL持久化前同步onBeforePersist；原默认guard不松，给内部读取详细阻断集合。
- `webui/server/catalog-assets.ts`：仅Manifest绑定与真实阶段结算；目标/mirror/digest完整后files_saved，保持终态真值。
- `webui/server/proxy/mcp-proxy.ts`：入口等待context、budget只读截止收紧、取消/TERM、恢复gate复用与等待后纯裁决。

**测试白名单：** 现有 `webui/server/__tests__/{api.catalog-assets,semantic-batch-recovery,semantic-batch-journal-lifecycle,mcp-reload-inflight,audit-release-barrier,question-budget-settlement,question-budget-window-mode}.test.ts`；必要新建 `semantic-read-write-settle.test.ts`；只为必要真实反例调整断言，原约束全部保留。权限定向测试由实现前rg定位现有`authorization-revocation`系列准确路径并通知M；未定位不猜文件。

**只读依赖：** question-experience、question-budget-lifecycle、authorization-barrier、process-drain、index、entrypoint、ResponseGate、上游KTX及WebUI。新增helper或扩大写范围先报M，不暗改budget API或process生命周期。

先红组：

1. 真实tmp项目/真实WAL，deferred卡住实际rename/mirror；查询命中正常活跃WAL。旧码立即semantic拒绝，SC-01先红。
2. 真实写/mirror/digest结束但deferred卡静态reload；旧码phase仍write_in_progress，SC-04先红。单列此缺陷。
3. 原入口时钟耗时、budget120秒剩余、elapsed MAX_WALL、settled不套墙钟、原合法最后call、无budget20秒；socket30只能证原timer不变，不伪造overall。
4. WAL发布前同步注册反例，构造回调失败没有WAL/效果；实际写失败、晚结束和新owner错配；原D3全部仍拒绝。

红日志保留准确hash，不为环境EPERM或未完成夹具断言加timeout；localhost真实HTTP按已有环境授权方式运行。

## S2：最小实现与原断言回归

1. MCP入口同步capture monotonic，固定waitDeadline=ingress+20s；内部参数传入，不新增外部header契约。创建/清理abort监听，body正常close不当断连。
2. 原consumePersisted位置与单票据计费不动；成功后snapshotScope(ticket.scopeKey)，按Spec保存ABS120截止，elapsed模式才按startedAt+MAX_WALL转换mono；固定scope/round/window，只收紧不重置。
3. writer先登记后发布WAL；全部写／镜像／核验与files_saved完成结写阶段；异常真实settle不伪释放。未知/故障不能获等待资格。
4. recovery gate只等待固定原owner集合，保留原20秒/更紧截止，醒来检查cancel/TERM/ACL并重读全部WAL；阶段结束不直接放行。覆盖早返回本地explain（原:5831）和slot前共享（原:6989）两个guard，复用私有等待接缝。
5. 等待后纯核验当前权限/语义/配置；不递归重跑handle、不再consume、不重复强制谓词；只首次执行SQL。
6. files_saved准确性与后续reload/append/终态失败处置单列diff，保留open/unconfirmed与重启恢复真值。
7. publish→reload不等MCP的循环必须以deferred反例证伪；真实MCP票据/response-gate退票原合同不动。

## S3：组件与类型验证

在隔离worktree/webui，串行普通定向验证：

```sh
npx vitest run --maxWorkers=1 server/__tests__/semantic-read-write-settle.test.ts server/__tests__/api.catalog-assets.test.ts server/__tests__/semantic-batch-recovery.test.ts server/__tests__/semantic-batch-journal-lifecycle.test.ts server/__tests__/mcp-reload-inflight.test.ts server/__tests__/audit-release-barrier.test.ts server/__tests__/question-budget-settlement.test.ts server/__tests__/question-budget-window-mode.test.ts
npm run typecheck
```

新增文件存在后才运行其命令；权限反例文件准确路径由S1冻结后追加。保持原P1-69定向七文件、entrypoint/lifecycle、Spec162预算/续查/审计和授权收紧相关断言，M在集成候选上串行整合，不与Docker重负载或性能校准争资源。已有通过集合仅新变化关联时重跑，避免无意义重复。

文档门禁按仓库现有lint:spec-docs与e2e检查执行；若本条不新增CI job，不修改registry；新增产品测试须按现行测试入口登记规则由M决定归属。

## S4：非作者只读复核与冻结

另一agent/CLI审查实际owner身份、发布前绑定、真实写终态、错误路径、取消清理、time mode、原预算计费和权限重核验，特别复核“普通write_in_progress不直接放行”及“读者timer不释放writer”。

保存原红、绿、差异、源码/工具hash与残余GAP；M更新状态镜像后统一构建新候选。不得用之前r4镜像签本次实现，也不得重写旧FAIL。

## S5：真实 Docker 取证

1. M唯一Docker资源锁串行安排；独立owned容器/网络/volume/MySQL，无客户repo secret、无原demo改动；token仅进程内，不输出。
2. 同一新镜像真实1883表、原SOURCE和query4/100 oracle。并发正常Manifest上传与原普通MCP；另测read_source授权metadata/业务SQL0、explain plan_only executed:false/业务SQL0，各自原单预算票据/有效审计闭包。两个恢复guard分别覆盖。
3. 记录Spec规定低频stdout registered/files_saved/failed与read_wait_begin/end原事件，以holder/journal/release/原唯一server ingress ID/rpcId精确闭包证明同进程私有绑定和真实等待，再关联实际SQL次数/预算/审计。不另起Node导入私有Map，不按宽窗推断，不新增公开API/P1-68日志产品，不记录Token/问句/DSN；每owner最多两事件、每实际等待RPC最多两事件。
4. >20秒实际阶段、取消、TERM、权限收紧、故障/恢复和连续owner；实际取消/失败均保留。用MySQL已受理事实，不固定sleep猜SQL开始；组件阶段deferred不冒充真实KTX UAT。
5. 校准通过后M执行正式30分钟/12周期同候选组合，普通MCP5秒频率/探针/性能阈值原样。原semantic错误不豁免，SC-03精确503条件不扩大；自然/post-natural分母、预算、执行和有效审计闭包独立重算。
6. 仅声明已实际覆盖SC；范围外留GAP。失败清理必须核实，driver夹具错误另新revision保留原FAIL；不把预计可修写PASS。

## 浏览器验证

不适用：本条实际实现为纯MCP／后端私有等待，不改变用户可见 WebUI 表面。若实际修改保存反馈、Toast或页面状态解释，撤Spec豁免，在同候选追加真实前台浏览器与即时计时，API耗时分列，不用后端回执代签。

## 验收映射与报告

| Spec SC | 交付 |
|---|---|
| SC-01／04 | 两组独立真实目录阶段红绿，不互相代替；query4/100+SQL1、read_source授权metadata+SQL0、explain plan_only/未执行+SQL0；两个guard覆盖，各自单票据/审计 |
| SC-02 | 入口20秒/预算剩余/elapsed与settled/无budget/socket原时限；deadline全边界 |
| SC-03／07 | 真实绑定发布前与故障/孤儿/连续owner/迟到结果，原D3负例保留 |
| SC-05／06 | ACL当前/配置代次、单预算计费、TERM/断连、原MCP真实settle和无自等 |
| SC-08 | 新hash候选短校准＋30分钟组合、完整执行/预算/审计/自然分母，原FAIL保留；四画像等待/间接保存与审计终结延迟全保留，SC-02/06的截止补偿可达 |

所有结果落工程包 `10-semantic-read-delta/`，M登记测试台F70与需求/开发台同句现值。受影响画像与↓补偿以Spec四画像/SC为准。只有合同已确权、实现已验证、对应真实SC有据后才能讨论功能出口；整套UAT PASS与可上线仍独立。

## 完成定义

Spec终稿获Codex CLI确权、授权范围内最小实现完成、先红后绿和全部原约束回归有据、非作者复核关闭真实缺陷、新hash候选对应真实SC与恢复补偿有证，且需求／开发／测试三台账现值一致。未覆盖项保留GAP，原r4失败不洗白。功能合同、30分钟组合UAT与可上线分别判定，不因预算不足或阶段结束自动完成。

## 风险与控制

- 正常活跃owner与孤儿混淆：WAL发布前精确绑定，未知仍guard拒绝，不用PID/时间宽窗。
- phase提前或晚推进：真实目标／镜像／digest／files_saved为边界；独立红绿证明，不提前completed，也不冒充本次失败已证根因。
- writer→reload→MCP自等：读者只等write/mirror阶段，保留原真实MCP票据；deferred反例与原reload回归同时检查。
- 等待悄悄扩预算：入口固定20秒只收紧；ABS120／elapsed MAX_WALL精确原计时，settled不造墙钟，socket30不伪装overall。
- 等待后旧权限或内容放行：醒来全量WAL与原授权barrier/当前纯裁决重核验，不重复consume/改写谓词，不重放SQL。
- 验证相互干扰或叙事越界：M串行Docker资源锁、保留完整失败分母/审计与原FAIL；组件不冒充真实KTX，局部PASS不代签整套UAT或上线。


## 本轮完成登记（2026-11-20）

S1–S5的本条功能出口完成：合同终审及最终代码终审通过，集成28文件360项、本条相关8文件95项与类型检查通过；四运行文件与候选r6保持一致。真实Docker normal三工具、入口deadline、吊销、mirror失败及TERM五项完成，非作者独立SQL验证五项VALID。合计11个实际请求（含4次恢复／合法身份补偿）为7成功＋4失败，失败不从分母删除；24条有效审计无错属／孤儿／重复／水位缺口。

功能SC-01–07由组件、真实目录／HTTP及真实Docker共同证明，见[功能出口复核](../reviews/2026-11-20-semantic-read-write-settle-closure-review.md)与[定向正式跑次](../qa/uat/suites/core-availability/runs/2026-11-20-codex-followup-r6-directed.md)。SC-08正式1800秒／12周期已执行，独立严格FAIL因在线审计采集1超时＋2漏采保留，组合结果独立登记，不推翻已证实的本条局部出口，也不主张整套UAT／上线。既有CI选择器已纳入新增测试，远端CI未执行。本轮不commit／push／发布，不改客户环境。
