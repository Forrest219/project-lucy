# 正常语义写入读取等待：功能合同收口复核

结论：**P1-70／REQ-030-091 功能合同收口，证据等级为本机自动化与真实Docker。** 远端CI未执行；新测试已纳入既有CI选择器。正式30分钟组合独立严格FAIL保留，本结论不签整套UAT、发布、客户环境或WebUI通过。

## 授权、终审与候选

委托人已明示批准补合同及修复；[合同终审](2026-11-20-semantic-read-write-settle-contract-review.md)和[代码终审](2026-11-20-semantic-read-write-settle-code-review.md)均通过，原REQUEST CHANGES及修正记录保留。实际运行源码未在后续夹具修订中改变：候选`sha256:ae0eb26a73d9331f45e4276f9839c442f9c8ada0ff2701366c7c2b099b8f7a4f`，Node22.23.5／KTX0.16.0；G3已核1247镜像文件一致。四运行文件hash为：

| 文件 | SHA256 |
|---|---|
| publish-coordinator.ts | c81c2f4de4e34ac1ea37d3fc35820cee306455b73f6f597979fda7dc6ba0ffe5 |
| semantic-recovery-journal.ts | a5863c17e66c614e62b20bafa9d6fef405f5aa719d4bbe062a5f85007f748993 |
| catalog-assets.ts | 65d323faa40f25d369e595531e8c7f172860bd533a8e358ffe6f19ebedd08df0 |
| mcp-proxy.ts | 281b430efaeb7e518b4e1ac5c82add323baf59de9c170505e3620812cbe2c353 |

## 功能出口逐项

本Spec明确以SC-01–07为局部功能出口，SC-08记录独立组合结果。组件与真实进程证据共同覆盖出口，不新增“每个交错都必须再造Docker全集”或整库发布旅程前置。

| SC | 已核事实 |
|---|---|
| 01 | 360项集成回归、相关95项及真实HTTP先红后绿；真实Docker三工具各自绑定真实owner／WAL／写阶段等待，正常files_saved后原RPC成功；SQL逐工具1／0／0、预算各一次 |
| 02 | 固定入口20秒及原更紧预算分支由组件覆盖；真实读者到入口20秒截止、writer仍持锁和真实I/O，随后原身份原问题显式恢复；不重置started／round／window |
| 03 | 孤儿／损坏／未知／未绑定及失败保持原屏障；真实mirror失败、原writer真实释放后沿既有函数及实际semantic_restore锁恢复，原Node合法查询和新写均成功 |
| 04 | 8个真实目录／WAL／mirror／mark／后续终态case（旧7FAIL／1PASS→8／8通过）覆盖阶段边界；正常Docker新authoring与mirror摘要一致、files_saved先于读者醒来，不冒充最终publish或reload确认 |
| 05 | 真实Token吊销提交与双ack、原请求精确403；内部cancelled属于该已审源码的res.close取消顺序，原事件不改，规范授权原因另列；原拒绝SQL0，旧Token持续401，合法未受影响身份实际2／30恢复 |
| 06 | 取消、原ABS／elapsed／settled／budget-off、两个guard与无自等由组件和真实HTTP覆盖；真实TERM原503、退出143／非OOM／1.377秒，原容器原卷原Token恢复；读者结束不伪退writer |
| 07 | 发布前同步绑定、原owner集合、迟到／继任／新WAL及代次不匹配等组件反例通过；真实case关联原ingress／RPC／journal／release／stage终态，当前权限与fresh catalog重查；预算及durable审计独立验证 |
| 08 | [正式30分钟](../qa/uat/suites/core-availability/runs/2026-11-20-codex-followup-r6-1800.md)执行1800秒／12周期，业务及性能与完整审计有证；在线采集1超时＋2漏采导致独立严格FAIL，不追补PASS；该组合结果依已批准闭口层级独立登记 |

## 独立真实取证

[定向跑次与完整原始档案](../qa/uat/suites/core-availability/runs/2026-11-20-codex-followup-r6-directed.md)包含normal／deadline／revoke／failure／TERM五个实际case及所有旧失败。非作者独立验证器`1135260fc004302f198b6d1286824a8f1dccaba6e3947d011450506f62a2c5ed`实际exit0，五项均为INDEPENDENT SCOPED VALID；不导入生产者oracle或复述其判定。11个实际请求（含4次恢复／合法身份补偿）＝7成功＋4失败，失败留分母；超时／失败／TERM的显式重试分别另计票据，撤权只由合法另一身份补偿，不重开旧Token。

五份封闭备份先验gzip／解码双hash与尺寸，再只读SQL重算；24条审计均唯一有效同用户关联，无孤儿、重复、错属或水位缺口。normal三个scope各calls＝attempts＝1；deadline／failure／TERM同scope原拒绝与恢复合计2，revoke两身份各1，current均0。各实际业务SQL位于唯一成功原RPC区间，未把恢复执行归给原拒绝。临时解码已全部删除。

## 证据边界

本机用例已进入既有`.github/workflows/lucy-ci.yml`的spec-and-webui→webui `npm test`→`server/**/*.test.ts`选择器；这里只主张已接入，**不声称远端CI已绿**。治理将证据等级与发布取证分层，未规定本次必须先commit／push才可裁定本机功能出口；本轮不新增专用CI job或越过既有提交授权。

真实运维函数及TERM后辅助容器仅用于撤回本任务故障注入、验证既有恢复；未新增公开修复API、客户部署形态或自动清latch能力。辅助容器只恢复精确自有backup，原WAL摘要不变，原应用startup recovery仍按生产规则执行。无前台WebUI变更，浏览器豁免保持。

采集工具stdin截止／操作关联的后续候选已完成独立静态及71项本机红绿资格，尚未合入canonical或新候选，不能据此洗去旧正式FAIL。P1-69完整矩阵及F61／F62／F63／R-CAV范围外缺口另账，不因本条收口自动通过。
