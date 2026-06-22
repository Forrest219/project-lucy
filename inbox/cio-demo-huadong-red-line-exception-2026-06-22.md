# 红线豁免记录 — CIO Demo 华东区域 VIEW（CREATE VIEW on 生产库）

| 元数据 | 内容 |
|---|---|
| 文档类型 | 过程留痕 / 红线豁免记录 |
| 日期 | 2026-06-22 |
| 涉及红线 | `docs/DEVELOPMENT.md` §红线："生产数据库（Aliyun RDS MySQL）：只读查询，禁止 DDL/DML 写操作" |
| 关联 commit | `84e32b6` Add region-scoped VIEW + role for CIO demo (superstore_orders_huadong) |
| 关联 review | `inbox/review-huadong-view-pseudo-table-2026-06-22.md`（独立复核，P2-1 指出本记录的缺失） |

## 为什么会触红线

CIO 48 小时 demo 需要演示"区域负责人只能看自己区域订单"。完整行级权限引擎改造
（改 `mcp-proxy.ts` 拦截层 + `access.yaml` 新增 `row_filter` 字段，见
`docs/access-governance-design.md` §3.2）工程量过大，选择了更便宜的替代方案：
在生产 Aliyun RDS 上为目标区域建一个 SQL VIEW，当成"另一张表"接入现有表级 ACL。

```sql
CREATE VIEW dataforai.superstore_orders_huadong AS
SELECT * FROM dataforai.superstore_orders WHERE region = '华东';
```

`CREATE VIEW` 是 DDL，字面触犯"禁止 DDL/DML 写操作"红线。

## 豁免理由

1. **不改基表**：只新建一个只读 VIEW，`superstore_orders` 物理表零修改，零行数据写入/删除。
2. **可逆**：`DROP VIEW dataforai.superstore_orders_huadong` 即完全还原，无残留状态。
3. **VIEW 内部仍是只读 SELECT**：`SELECT * FROM superstore_orders WHERE region = '华东'`，不引入写路径。
4. **范围明确**：仅这一个 demo 用途，不是给客户的通用产品能力（`ktx.yaml.example` 未同步此项，避免被误当作可复制模式）。

## 走过的确认路径

本次改动在 Claude Code 会话内通过 **Plan Mode** 走完整流程：

1. 用户提出"增加一个区域的 SQL VIEW"后，助手主动 `EnterPlanMode`，列出 DDL 原文、
   `ktx.yaml` 改动点、以及"新 VIEW 故意不带 joins"的安全考量。
2. 用户通过 `ExitPlanMode` 批准该计划后才执行 `CREATE VIEW` 与后续步骤。
3. Plan 文件存档于 Claude Code 本地（`~/.claude/plans/optimized-tinkering-hamming.md`），
   不在本仓库 git 历史中——这正是本记录要补的缺口：让红线豁免在仓库内有留痕，
   不只存在于一次性的 session 工具状态里。

## 后续如果要复用这个模式

- 每个新切片（区域/产品线/退货等）都需要重复"建 VIEW + overlay + role"三步，
  不是参数化方案，见 `docs/access-governance-design.md` §3.2「已验证的运行时变通方案」。
- 如果未来要支持的切片数量明显增多（比如全部 6 个区域都要对应角色），应该重新评估
  是否值得投入 `row_filter` 的引擎级实现，而不是继续堆 VIEW。
- 任何后续走这条路径的人，都应该在 `inbox/` 留一份同样的红线豁免记录，而不是只依赖
  Plan Mode 的批准（那个批准对仓库外部不可见）。

## Demo 收尾清单

- [x] Token 已轮换为带 `expires_at`（2026-06-24T00:00:00Z）的版本，旧 token 已撤销。
- [ ] Demo 结束后确认是否需要 `DROP VIEW dataforai.superstore_orders_huadong`，
      或保留供后续复用（视产品决定）。
- [ ] 若决定保留，应同步评估要不要把 `superstore_region_huadong` 提升为
      `webui/server/admin/role-templates.ts` 里的正式模板。
