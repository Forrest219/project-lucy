# 错题：大目录下任意访问配置写入都把显示读压成 503；并发写直接被发布窗口拒绝

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-26 |
| 标签 | `gate-gap` `ux-regression` `contract-stack` `sev-med` |
| 环境 | 本机 Docker Desktop compose demo（`deploy/compose/docker-compose.demo.yml`），lucy 0.35.0（gitSha `b4bc7c6e`，dirty），MySQL 8.4；目录含 2000 张已启用表 |
| 相关 | 需求池 [REQ-0117](../backlog/entries/REQ-0117-create-2000-table-roles-webui-503.md)；历史近亲 [2026-11-23-roster-busy-and-mcp-latency.md](2026-11-23-roster-busy-and-mcp-latency.md) |
| 状态 | `fix_landed`（修复已落地待验收：REQ-0117 实现＋UAT 部分证据；登记 ≠ 授权，现值以 Spec 头部为准） |

## 1. 症状与影响

- 治理方在 WebUI「角色」页创建一个关联 2000+ 张表的角色（表单入口），保存期间／保存后页面数据请求返回 503，用户看到失败提示。
- 影响面：主路径可感知。创建本身最终成功（200），但同窗的读取与重叠写入返回 503；目录越大，窗口越长。

## 2. 复现要点

1. demo 栈中给 `demo-mysql` 连接声明新 schema，物理建 2000 张表，经 `POST /api/catalog/assets/upload`（`assetKind: schema_manifest`）一次性写入 `_schema/<schema>.yaml`，再 `PUT /api/connections/demo-mysql/enabled-tables` 全量启用。
2. 以 WebUI 表单同形载荷调用 `POST /api/admin/roles`（先 `dryRun:true` 再 `dryRun:false`）创建关联 2000 表的角色；创建耗时 5–12s。
3. 创建进行中，以 0.1–0.25s 间隔轮询 `GET /api/admin/roles`：出现 1–3 次 `503`，响应体 `{"code":"DISPLAY_SNAPSHOT_BUSY"}`；`/api/health` 的 `displayBusy.recent` 记录到 `name: role-list`、`reason: write_pending`。
4. 同窗再发第二个创建请求：0.08s 内返回 `503 PUBLISH_COORDINATOR_BUSY`。
5. 对照基线：目录只有 5 张启用表时，同样的 1 表角色创建 3.4s，轮询零 503。

## 3. 根因

- **写成本随目录规模放大，而非随角色大小**：任一 `access.yaml` 写都要走 catalog 重载、策略运行时重载与展示快照重建，成本主要由启用表总数决定。2000 表目录下小角色创建也要 ~5–10s；角色本身再关联 2000 表只额外增加 ~1.5–2s（权限预览 + YAML diff + 策略重建）。
- **503 来源一（B 类，可重试）**：写窗口内展示写屏障（`hasPendingDisplayWrite`）对 P/C/L/D 作用域持续挂起；`GET /api/admin/roles` 的读预算（3 次尝试＋构建等待）耗尽后由 `display-snapshot.ts` 抛 `DisplaySnapshotBusyError("write_pending")` → 503 `DISPLAY_SNAPSHOT_BUSY`。
- **503 来源二（零等待拒绝）**：`publish-coordinator.ts` 的 `withPublishCoordinator` 对重叠写**不等待**，直接抛 `PublishCoordinatorBusyError` → 503。窗口长达 ~10s 时，双击保存、客户端重试或第二个管理员都会命中。
- 创建请求自身从未返回 503：用户看到的 503 全部来自并发读与重叠写，是「慢写 + 两个零等待/预算耗尽出口」的叠加，不是某个写分支主动报错。

## 4. 为何漏检

- WebUI 浏览器验收只覆盖单请求、小目录；没有「大目录 + 写入同窗并发读/并发写」的用例。
- 503 被归类为「可重试的忙」，服务端视角是正确降级；但没有从用户视角验收「创建期间页面不得报错」。
- 目录规模与写耗时/屏障时长的关系没有性能基线（P1-79/P1-89 的现行面未覆盖 access 写路径）。

## 5. 举一反三

- 任何触发 catalog/策略/展示快照重载的写路径，必须在「大目录规模」下测写耗时与写屏障时长，并配并发读验收；只测单请求小目录等于没测。
- 凡是「忙即 503」的出口（发布协调器、展示快照），都要回答：窗口最长能有多久？该时长下用户路径是否仍可用？超过某个量级就必须给有界等待或进度反馈，而不是立即拒绝。
- 复现规模类缺陷时，先放大环境规模（表数量、启用表数量），再放大单对象；两者贡献差异要分开测量。
- 批量启用 2000 表这类治理操作本身也会重排 `ktx.yaml`／策略运行时，属于同一写窗口，验收要一并覆盖。

## 6. 后续动作

| 动作 | 状态 | 说明 |
|---|---|---|
| REQ-0117 复现与根因登记 | 完成 | 见需求池正文 |
| 修复立项（Spec/Plan） | 未开 | 入池 ≠ 开发授权 |
| 大目录写路径性能基线 | 未开 | 可并入 P1-79/P1-89 现行面 |

## 7. 证据指针

- 过程取证与请求体：`inbox/req0117/`（临时，可删）
- `/api/health` → `displayBusy.recent[]`：`name=role-list`、`reason=write_pending`、`eventLoopMaxMs≈804–827ms`
- 源码：`webui/server/display-snapshot.ts`（B 类 `write_pending` → `DisplaySnapshotBusyError`）、`webui/server/publish-coordinator.ts`（`PublishCoordinatorBusyError`）、`webui/server/admin/roles.ts`（创建写路径与发布窗口）
