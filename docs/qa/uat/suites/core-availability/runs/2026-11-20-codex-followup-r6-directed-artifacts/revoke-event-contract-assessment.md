# P170 B7 revoke：事件标签与真实授权结果的只读裁定

结论：现有证据支持**辅助checker对endOutcome的单值要求过严**，不支持修改生产响应/取消优先级。旧 actual FAIL 保留；其后的SQL/预算/审计/修复和合法身份补偿未完成，不能补签SC05或整条revoke PASS。仅做小文本/源码复核，没有运行测试、Docker或SQL。

## 合同与类型依据

正式 `lucy-20261120-semantic-read-write-settle-spec.md`「真实阶段的有界工程取证」明确列出允许值：owner_settled / timeout / cancelled / term / authorization_revoked / blocked。因此不能说Spec没有枚举；准确说法是**有允许值枚举，但没有“canonical403与authorization_revoked事件标签必须一一对应”的强制映射**。cancelled本身是合法工程终态标签。

同Spec「决策二」明确私有AbortController监听req.aborted、res.close、socket timeout；「决策三」要求真实吊销优先、原发送/响应屏障保留，成功仅执行一次；SC05要求等待期间吊销不得旧授权放行、被吊销身份拒绝、原预算消费一次和约束保持。验收的用户结果是当前授权裁决，不是工程标签必须包含唯一根因。

冻结proxy `281b430e…` 中SemanticReadWaitContext只有通用AbortSignal，没有承诺其reason是精确撤权分类；emit的endOutcome参数为内部string。createSemanticReadWaitContext约2323–2335把res.close接到controller.abort；awaitSemanticReadRecovery.interrupted约2363–2368先查signal.aborted→cancelled，再查TERM、barrier、deadline。readSemanticRecoveryDenial约2418–2443在等待结果/异常后再次优先核barrier，保护真实授权结果。

既有authorization-barrier.ts的GuardedRequest.cancel先令自身失效并取消上游，再deny→writeHead403/end原-32003授权信封。该响应的close可早于等待循环下一次观察。因此真实可达顺序为：durable revoke触发barrier拒绝原RPC并结束响应→res.close将私有signal置aborted→等待循环记录cancelled。这不意味着用户收到普通取消、semantic200或授权被降级。

## 本次实际事实与未完成部分

`docker-driver/r6-revision7/revoke/post-fail-event-assessment.json` 保留actualStatus=FAIL、driverError=wrong/reversed wait terminal；原RPC真实HTTP403，JSON-RPC code=-32003、message精确Access denied: authorization_revoked；响应operation header关联原ingress `mcp_8306488b-8588-41ae-97e5-fe1b4cb377b0`。真实revoke API200由B/M原证据核定。

同一原rpcId2、ingress/holder/journal/release的registered→read_wait_begin→read_wait_end(cancelled)→writer failed链已保存；begin mono40753.441727，end45991.444897，同原入口37191.754517及有效deadline57191.754517。未见owner或时间倒置造成该断言失败。

旧checker在要求endOutcome==authorization_revoked处终止；原始FAIL、清理记录和后续未运行事实不得覆盖。现有证据只足以解释该断言为何不被合同要求，**不等于已证明rawSQL0、原预算/有效审计闭包、故障修复与合法b身份恢复全部满足**。term/failure亦不能由它代签。

## 仅新revision可采用的严格判定条件

新checker如处理cancelled分支，必须同时要求以下真实事实，缺任一保持FAIL/GAP：

1. 真实管理员吊销API200且目标为原请求使用的同一身份/Token；吊销发生在同一原RPC的真实等待阶段内，不能借无关Token的成功回执。
2. 原RPC收到精确canonical HTTP403、JSON-RPC -32003、authorization_revoked；响应operation/attempt关联原RPC，不能以任意403/semantic200/transport错误或客户端自断代替。
3. 唯一begin/end与registered和真实owner终态保持原ingress/rpcId/固定owner-journal-release全相等、时序及deadline合格；end允许authorization_revoked，或在上述已证canonical撤权结果下的cancelled。不得把任意cancelled全局映射为撤权。
4. 原始MySQL/general_log证明原问题业务SQL0；沿原ticket真实预算消费/settlement一次、唯一适用拒绝审计闭包；不能套P169入口503零预算，也不能从日志标签推断SQL/审计。
5. 真实writer失败/settle和既有受控修复完成；已吊销Token维护后仍拒绝，未受影响合法b的原Token/session/问题显式成功，其SQL/预算/有效审计按原oracle核验。不得新发Token或清latch冒充恢复。

该窄判定不改变产品合同、不添加任何semantic错误豁免、不放宽deadline/owner/预算/实际SQL。应在新driver源/新out中补错HTTP、错目标/关联、缺owner、缺SQL/审计、缺合法恢复等反例并独立复核；旧B7 actual FAIL不得直接改写为PASS。是否授予新offline/实际窗口由M另行调度。
