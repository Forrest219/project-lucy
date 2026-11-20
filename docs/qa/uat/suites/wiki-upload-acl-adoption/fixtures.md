# Fixtures — Wiki 覆盖上传 YAML 授权采用

版本：v0.2；夹具设计已定稿；本轮不执行创建、配置或清理。

| 项 | 值／约束 |
|---|---|
| WebUI | `http://127.0.0.1:${LUCY_DEMO_WEBUI_HOST_PORT:-55176}` |
| MCP Proxy | `http://127.0.0.1:${LUCY_DEMO_PROXY_HOST_PORT:-57881}` |
| 容器 | `compose-lucy-1`（或实际 demo project）；执行前记录 health、镜像 ID／digest、产品版本 |
| 登录 | 仓库外凭据文件（如 `config_for_agents/lucy-docker-demo-webui.txt`）；`adminId`＋密码，不进入跑次正文 |
| 目标页 | 优先 `global/uat-wua-<run>-<case>-<subcase>.md`，每例／每子例独立；历史 `global/demo-superstore.md` 仅为旧基线目标，不默认再次覆盖 |
| 基线正文 | 每页含本次 run／case／subcase 非敏感唯一标记；保存创建前或恢复前的完整原始 Markdown，不只记录 ACL |
| API | `POST /api/wiki/upload/preview`、`POST /api/wiki/upload/commit`；`POST /api/wiki/:key/access/preview`、`PUT /api/wiki/:key/access`；`GET /api/wiki/:key` |
| MCP | 仅经 Proxy Bearer，使用相应正式 Role 且 Wiki 搜索／读取通道有效的隔离 Agent；不要求 WebUI 账号或宿主 |

## 声明与角色符号

B／W／C 是夹具符号，不是新增产品术语；执行时记录实际已存在的正式 Role ID。

| 符号 | 声明 | 独立前置 |
|---|---|---|
| B | 基准两个角色，如 `demo_readonly`、`lucy_admin` | 有仅绑定 B 内角色的 Agent |
| W | B 加一个正式角色，如 `lucy_ops_reader` | B 真子集于 W；有仅绑定增量角色的 Agent，不得同时绑定 B |
| C | 与 B 不同、与 W 不同的合法角色集 | 可取 B 的一个角色＋另一个正式角色，构成与 B 等长且发生替换的集合；有只在 C 的读取 Agent，并有只在 B／W、不在 C 的负控 Agent |
| all | `allowed_roles: ["*"]` | 独立全角色确认；只对有 Wiki 通道的 Agent 验读 |
| empty | `allowed_roles: []` | 显式字段存在；空授权确认 |
| missing | 没有 `allowed_roles` 字段 | 不能通过写 `[]` 冒充；虽同为无人可见，声明规范键与 empty 不同 |
| corrupt | YAML 语法合法，但 `allowed_roles: 42` 等类型非法 | 可被原解析器识别为 corrupt；不是整个 frontmatter 无法解析 |

若现有角色不满足 C／隔离条件，先在执行授权覆盖的 demo 范围内准备 UAT 专用正式 Role／Agent，记录 setup，执行后删除；不得复用管理员／多角色 Agent 导致负控漏检。凭据缺失须如实记录，不能省掉纯 MCP 检查点却算完整通过。

## 逐例隔离与可核对前置

1. 每例／每个子例先准备唯一 key；若复用 key，先恢复完整原始 Markdown 与声明，读回并记录**新的** `file_version`，不能继续使用恢复前版本。配置／角色快照保持固定。
2. 用真实受支持 API 创建／恢复合法夹具，保存 setup 证据；需要 corrupt 原始声明时，仅对新建 UAT 专用文件准备原始夹具，读回核对原始字节。直接文件准备只能算 setup，不能冒充上传或管理访问测量结果。不得手改共享 demo 正式页。
3. 每次测量前记录：key、完整 Markdown SHA-256、字段存在性／声明值／解析态、文件版本、原始上传体 hash、预期最终声明。setup 与 measured operation 分开。
4. 03 固定当前 B／上传 W，先断言 B≠W，再取保留 digest，采用提交；两次请求使用同一原始体与当前版本。不可接着 02 的 W 状态测负控。拒绝后比较完整字节 hash／声明／版本均不变。
5. 05 固定从独立 B 真正改为 W，保存前验证增量角色拒绝、保存后验证版本变化与 MCP 可读。不能从 W 再写 W，以 noop 冒充补救。
6. 06 必须在对应写入之后、任何后续覆盖之前执行；记录正文标记与角色身份的非敏感 ID。空／corrupt 预期拒绝；从管理访问恢复 C 后再验合法读。
7. 07 的 M1–M9、10 的 K1–K5、11 各同键组、12 的 T1–T4 分别独立；乱序／网络失败仅作用于测试客户端的真实请求，禁止生产代码钩子或对共享服务故障注入。

## 禁写

不把口令、Cookie、Token、客户生产 host 或带凭据请求头写入跑次、日志与截图；不访问／修改客户生产实例。

## 清理与异常出口

删除本次专用 Wiki、专用角色／Agent，恢复临时改变的客户端网络设置；如复用了页则恢复完整正文和声明并核对。保留不含凭据的前后 hash 与清理结果。清理失败须登记残留与负责人，不声称套件完整完成；不 `docker compose down -v`，不改无关角色／Agent。本轮未执行清理，不伪写已恢复。
