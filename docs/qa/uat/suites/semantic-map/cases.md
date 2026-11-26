# UAT-SUITE-SEMANTIC-MAP · cases

> 全真：本机 demo Docker＋**真实前台浏览器**（1920×1080）。计时与 API 耗时分列。开发未落地 → 记 BLOCKED，不得 PASS。

| ID | 前置 | 步骤 | 期望 | 证据 |
|---|---|---|---|---|
| UAT-SM-R0 | lean demo | 1. `demo:upgrade` 至 healthy 2. 打开 WebUI 登录管理员 3. 记录端口与 gitSha | `/api/health` 200；会话可用；视口 1920×1080 | 跑次头 |
| UAT-SM-01 | R0 | 1. 前台打开 `/semantic-map` 2. 观察加载占位（投影未就绪时不得空白假成「无边真空」）3. 选连接 `demo-mysql` 4. 记导航→岛卡可见计时；另记投影 API 耗时 | 加载占位可感知（E2）；岛卡可见；计时与 API **分列**；不得仅用 API 主张页面 PASS | 截图＋计时表 |
| UAT-SM-02 | SM-01 | 1. 进入含 `superstore_*` 的 Schema 岛 2. 观察默认渲染 | 见连通团和／或孤立区；**不得**默认挂载该岛全部表散点（前台 DOM／无障碍树计数；**禁止** vitest/jsdom 冒充） | 截图＋节点计数 |
| UAT-SM-03 | SM-02 | 0. **跑前核对**（fixtures）：运行实例上 `superstore_orders` Manifest 节点无 joins；不成立 → 本用例 BLOCKED，不得照跑 1. 定位 `superstore_orders` 2. 核对边／团 | 该表不在「全连接 0 边」态；与 returns／people 的 formal 关系在地图可观察 | 前提核对摘录＋截图＋侧栏 |
| UAT-SM-04 | SM-02 | 1. 开「仅孤立表」筛选 2. 断言 `superstore_returns` 与 `superstore_people` **不在**命中列表 3. 若有命中表则抽查其入出度皆 0 4. 输入无命中关键字，观察空态引导 5. 摘录本页文案 | 负对照成立；真孤立入出度 0；无命中引导改条件（E12）；文案不含「无任何依赖」，且不含禁用混称「拓扑图／ER 图／知识图谱／访问关系图」 | 截图＋文案摘录 |
| UAT-SM-05 | SM-03 | 1. 选中 `superstore_orders` 2. 点「打开工作台」3. 打开合成 YAML 入口并读旁注 | 到达表工作台 URL；旁注含 overlay joins 缺口含义 | 截图＋URL |
| UAT-SM-06 | SM-01 | 1. 观察岛卡／工具条汇总数与措辞 | 可见作用域标签；全量口径数字**不得**与概览「待补语义」措辞混用 | 截图＋文案 |
| UAT-SM-07 | R0＋可注入 | 1. 按 fixtures：浏览器 route 拦截投影 API **或** 单岛失败注入 **或** stale／pending 2. 观察画布 | 出现失败／部分可见／「数据可能不是最新」诚实态；**不得**假空 0 边真空；单岛失败时汇总数标不完整（E8） | 截图＋网络 |
| UAT-SM-08 | SM-05 或互链 | 1. 带 `conn=demo-mysql` 与表深链打开地图（或工作台互链） | 侧栏或高亮定位到目标表 | 截图＋URL |
| UAT-SM-09 | SM-01 | 1. 遍历页内控件 2. 监听本页触发的网络请求 | **默认拒绝**：除 GET／HEAD（及会话／静态／心跳白名单）外任何本页触发请求 → FAIL；已知写路径列入 fixtures 辅助 | 网络日志摘要 |
| UAT-SM-10 | SM-01 后 | 1. 打开 Catalog 2. MCP `lucy_catalog` 3. MCP `lucy_query`（demo-mysql／superstore 只读度量，如 `superstore_orders` 订单计数类） | Catalog 可用；catalog 列表成功；**lucy_query 成交**（问数主路径冒烟） | 截图＋MCP 摘要 |
| UAT-SM-11 | 冲突夹具 | 1. 按 fixtures 造冲突 2. 打开地图侧栏 | 可见来源冲突标注或双列 `on` | 截图 |
| UAT-SM-12 | 多连接夹具 | 1. 用 `demo-mysql`＋`lucy-ops`（或第二连接）构造跨连接 `to` 2. 观察角标／未判定 | 不画跨连接边；外部引用或「未判定」 | 截图 |
| UAT-SM-13 | scale 前置 | 1. scale／customer-stability 达标 2. 大 Schema 筛选／总览计时 | 表点不突破合同上限；总览可交互计时；lean 不得 PASS | 计时＋档位证明 |

## 自动化指针

- 实现后可加 Playwright／组件测；**不替代**上表前台浏览器必做。
- SC-03 并集边可另挂服务端单测，但 UAT-SM-03 仍须浏览器可见＋跑前 Manifest 核对。
