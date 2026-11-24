# UAT-SUITE-ACCESS-MAP-SANKEY — 访问关系图桑基还原

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-ACCESS-MAP-SANKEY` |
| 总账 ID | **P1-41**／REQ-030-062 |
| 目标 | 证明访问关系图在任一数据形态下仍是「四列＋带状流」的桑基，而不是文字、发丝线或塌缩的零厚度流带；证明未确认关联不会被静默吞掉 |
| 合同回链 | [桑基还原 Spec](../../../../specs/lucy-20261117-access-map-sankey-restoration-spec.md)；前序套件 [`UAT-SUITE-ACCESS-MAP`](../access-map-sankey-empty/suite.md)；错题 [`2026-11-13-access-map-sankey-empty`](../../../../lessons/2026-11-13-access-map-sankey-empty.md)、[`2026-11-17-access-map-sankey-regression`](../../../../lessons/2026-11-17-access-map-sankey-regression.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md)（含 5 套确定性种子数据与沙箱启动方式） |
| runs | [runs/](runs/) |

## 与前序套件的分工

`UAT-SUITE-ACCESS-MAP` 用 demo 里的少量真实数据，守「空桑基修复」。本套件用**可控种子数据**覆盖 demo 构造不出来的形态：宽授权、42 个 Agent、全为未确认关联、零访问。两者不互相替代。

## 必做／可选

| 产品侧必做 | 可选基线对照 | 发布取证 |
|---|---|---|
| SANKEY-R0、01、02、04、05；D0＝C 时加 03 | SANKEY-06（旧码对照基线） | SANKEY-07（明确要求验收线上实例时执行） |

## 环境约定

沙箱不碰 demo 容器与 `lucy-demo-data`。**默认不要求** Docker 重建，沙箱是宿主上的隔离进程（关闭鉴权）。线上实例判定只在 SANKEY-07。
