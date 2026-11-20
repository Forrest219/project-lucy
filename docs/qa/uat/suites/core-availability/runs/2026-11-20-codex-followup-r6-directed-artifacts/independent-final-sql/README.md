# P170 五实际case独立最终SQL复核

standalone verify.py只用Python标准库，不导入生产者或独立旧oracle。身份范围从实际original-rpc-dispatched/terminal、原server operation header、原RPC/user/session/tool和SQLite稳定token_hash_prefix关联；不读取Token原文或已删fixtureprivate，不扩大凭据取证。

范围：7normal三个serial原RPC→SQL1/0/0、各scope calls1；7deadline同a/session拒绝+显式成功retry→calls2，原SQL0/recovery1；8revoke a被撤销失败calls1、b合法NORTH2/30恢复calls1；10failure同a/session原失败+显式retrycalls2；11term原503+同Token/session原卷重启后成功→calls2。每个失败保留分母，旧FAIL跑次不更改。

先核compressed bytes/hash，流式解码再核decoded bytes/hash；只有已验证封闭SQLite备份才使用mode=ro&immutable=1。逐RPC唯一审计/同user-session-token/tool/requestid/outcome、真实query SQL+lowerselect或metadata null字段、唯一有效同用户turnlink；全DB非空用户关联、全link orphan/dupe、每用户complete/MAX(id)水位全量核。

只读取summary.originalBudgetAtWait这一当时直接SQL snapshot行作pre-retry观测，禁止使用summary.independentBudgetAudit/判定结论。normal无预快照，明确其有限证据：round/window0、origin=started且在首个实际请求区间；其它有pre的scope比started/round/window逐字保持。对未记录全时间线不声称额外过程采样。

业务SQL独立严格白名单：仅实际此fixture固定metadata原SQL、成功原RPC compiled whole SQL或固定单层KTXwrapper；其它Query/Execute一律unsupported失败，绝不签SQL0。原normal前后raw行用multiset差集各自归因，不抄producer分类。Prepare不执行，metadata log查询不计业务。

执行命令（需M唯一资格窗口，禁止自行Docker）：

```sh
python3 /Users/zhangxingchen/Projects/project-lucy/inbox/core-availability-followup/20261120-execution/10-semantic-read-delta/independent-final-sql/verify.py --base /Users/zhangxingchen/Projects/project-lucy/inbox/core-availability-followup/20261120-execution/10-semantic-read-delta/docker-driver --out /Users/zhangxingchen/Projects/project-lucy/inbox/core-availability-followup/20261120-execution/10-semantic-read-delta/independent-final-sql/attempt-1
```

每case30s deadline，temporary directory finally删除，readonly无sidecar；actual argv/sourcehash/exit会另存。所选分支独立VALID不等于完整P170SC／UAT／发布；正式SC08 strictFAIL不变。
