# UAT-SUITE-ENABLED-TABLES-LOAD-STATE — 启用表范围表清单三态诚实展示

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-ENABLED-TABLES-LOAD-STATE` |
| 总账／需求 | **P1-80**／REQ-030-101 |
| 授权 | 委托人 2026-11-23 明示「授权修复，并完成 uat」 |
| 修复合同 | [Spec](../../../../specs/lucy-20261123-enabled-tables-load-state-honesty-spec.md)／[Plan](../../../../plans/lucy-20261123-enabled-tables-load-state-honesty-plan.md) SC-01–SC-07 |
| 目标 | 在本机 demo Docker 真实前台浏览器验证 `/tables` pending／error／success-empty／healthy 文案分流；健康刷新恢复基线；**禁止**点击「移出无效启用」 |
| 范围 | WebUI `/connections/enabled-tables`；仅浏览器侧 fetch 注入改写 `/tables`；不改磁盘 Manifest、不保存启用表 |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 必做

| ID | 对应 Spec | 要点 |
|---|---|---|
| `UAT-ETL-R0` | 环境 | demo healthy；管理员登录；健康基线无假阳性缺 Manifest／无效启用 |
| `UAT-ETL-01` | SC-01／SC-06 A | pending：可见「正在读取表清单…」；无缺 Manifest／无效启用 |
| `UAT-ETL-02` | SC-02／SC-06 B | error：可见「表清单读取失败，请重试。」；无假阳性；移出不可达或禁用 |
| `UAT-ETL-03` | SC-03／SC-06 C | success `tables:[]`：允许缺 Manifest／无效启用 |
| `UAT-ETL-04` | SC-04／SC-06 恢复 | 解除注入后刷新：恢复健康基线（已选计数覆盖启用表） |
| `UAT-ETL-05` | SC-07 | 术语：断言用 Spec／术语标准定稿文案；不含禁用别名 |

组件单测 SC-01–SC-05 为开发台证据，不替代本套件前台浏览器 SC-06。

## 边界

- **禁止**验收中点击「移出无效启用」或靠重传 Manifest「清症状」。
- 不修 display snapshot BUSY／首页超时。
- ≠ 功能合同收口（收口另按产品侧修复收口）；≠ 可上线。
