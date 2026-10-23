# 客户 MCP Session 400 修复与升级动作单

| 元数据 | 内容 |
|---|---|
| 文档名称 | 客户 MCP Session 400 修复与升级动作单 |
| 文档类型 | Runbook / 客户升级动作单（含对外沟通稿） |
| 版本 | v1.0 |
| 撰写日期 | 2026-10-21 |
| 适用范围 | 客户运行 `lucy-k8s-integration-20260828-v1`（Chart 0.1.0 / Lucy 0.16.0），Agent 侧出现 `MCP initialize request is required before session traffic.` |
| 关联 | [升级后取证与验收](../uat/uat-mcp-session-customer-verification.md)、[`deploy/k8s/helm/lucy/UPGRADE.md`](../../deploy/k8s/helm/lucy/UPGRADE.md)、[`webui/docs/07-mcp-auth-proxy-spec.md`](../../webui/docs/07-mcp-auth-proxy-spec.md) §4.3 / §6.1.2 / §6.1.3 |

## 1. 结论

1. **客户当前运行的版本不含该修复**，因此客户现在重测仍会复现 400，不能用"再试一次"结案。
2. **修复在 2026-09-27 已进主线**，当前正式发布版 `lucy-k8s-integration-20261009-v1` 已包含，**升级到该版本即可修复**。
3. **只换镜像不够**：客户现役 Chart 0.1.0 低于原地升级门槛（chart < 0.2.3 不得用于原地升级），**镜像与 Helm Chart / values 必须一起升**。
4. 升级后必须按 [取证与验收文档](../uat/uat-mcp-session-customer-verification.md) 取证，形成可交付客户的证明材料。
5. 完整路径（Lucy 2.0.0 / Chart 0.2.6 / 含 2026-10-18 安全加固）目前是**待现场验收的候选包**，不作为客户正式版发放。

## 2. 对外沟通稿（可直接转发客户）

> 以下正文为对外稿，转发时不得夹带内部路径、内部提交号以外的内部过程记录，也不得添加"原计划时间 / 提前 N 天"等内部对账信息。
>
> **关于 Agent 取数报 `MCP initialize request is required before session traffic.` 的说明**
>
> 一、现象
> 目录可以正常看到（`lucy_catalog` 成功），但发起取数（`lucy_query` / `lucy_read_source`）时服务端返回 HTTP 400，报 `MCP initialize request is required before session traffic.`。数据库与语义层本身没有问题。
>
> 二、原因
> 贵司当前运行的版本（`lucy-k8s-integration-20260828-v1`）在代理层采用"会话标识原样透传"的方式转发请求，需要 Agent 客户端在初始化之后、每一次后续请求都回传会话标识。贵司现有客户端没有回传该标识，因此被上游按协议拒绝。
> 而目录查询由代理本地服务、不经过上游，所以目录照常返回——这造成了"目录能看、数据查不了"的半通现象。该现象不代表数据源异常。
>
> 三、修复
> 新版本改为由代理自行持有并维护上游会话：代理在需要时自动完成一次协议握手，并对被拒绝的请求自动重试一次。因此**无论客户端是否回传会话标识，取数都能正常完成**。修复随 `lucy-k8s-integration-20261009-v1`（正式发布版）交付。
>
> 四、需要贵司配合的事项
> 1. 安排一次维护窗口，执行一次版本升级（镜像与部署配置同步升级，详见随包《升级部署说明》）。
> 2. 升级后用贵司原有的 Agent 客户端重测一次取数。
> 3. 由贵司管理员按我们提供的取证清单核对一次访问日志，确认调用成功且已留痕。
> 4. 建议：贵司客户端在后续请求中回传会话标识，可减少一次内部握手往返。修复不依赖此改动，但补上更稳。
>
> 五、我们提供的材料
> 升级后我们出具一份《MCP Session 修复验证报告》，含版本对照、升级前后行为对照、自动化取证结果与访问日志核对结论，可作为本次问题闭环的证明材料。
>
> 升级过程需要停机，请贵司确认维护窗口时间。升级不涉及删除业务数据，原有连接、语义层、权限、Token 与审计记录均会保留。

## 3. 版本对照与硬证据

| 项目 | 客户现役 | 快路径（建议） | 完整路径（候选） |
|---|---|---|---|
| 交付包 | `lucy-k8s-integration-20260828-v1` | `lucy-k8s-integration-20261009-v1` | `lucy-k8s-integration-delivery-20261021-r6` |
| 发布状态 | 正式版（2026-08-28） | **正式版 / Latest**（2026-10-09） | Draft 候选，未放行 |
| Lucy 产品版本 | 0.16.0 | 0.17.0 | 2.0.0 |
| Helm Chart | 0.1.0 | 0.2.4 | 0.2.6 |
| 内置 KTX | 0.16.0 | 0.16.0 | 0.16.0 |
| 源码提交 | 2026-08-28 代码状态 | `project-lucy@e08de17` | `7de67e774a5760ab94b2a6225c7ff9aa53fbaf3e`（clean） |
| v1.6 上游会话持有（`43dd169`） | ❌ 不含 | ✅ 含 | ✅ 含 |
| 会话归属加固 T04-2（`a4ba5eb`） | ❌ 不含 | ❌ 不含 | ✅ 含 |
| 撤销屏障 T04-3（`b2ecc58`） | ❌ 不含 | ❌ 不含 | ✅ 含 |
| 升级门槛（chart ≥ 0.2.3） | ❌ 低于门槛 | ✅ | ✅ |

**"客户现役版本不含修复"的验证方式**（不依赖文档断言，靠代码事实）：

```bash
# 仓库侧
git cat-file -e <客户版源码提交>:webui/server/proxy/upstream-session.ts   # 预期：不存在
git merge-base --is-ancestor 43dd169 <客户版源码提交>                    # 预期：非 0
```

**修复提交**（`project-lucy` 主线）：

| 提交 | 日期 | 内容 |
|---|---|---|
| `43dd169` | 2026-09-22 | 代理持有 KTX 传输会话（v1.6 主体） |
| `31449d3` | 2026-09-27 | 上述修复并入主线 |
| `a4ba5eb` | 2026-10-18 | 会话按 `(Agent, Token, 下游会话)` 归属（T04-2） |
| `b2ecc58` | 2026-10-18 | 授权撤销屏障 + 关闭 skills 透传（T04-3） |

**规范与实现锚点**（供客户与第三方自行复核）：

- 规范：`webui/docs/07-mcp-auth-proxy-spec.md` §4.3（MCP Session 透传与上游 Session 归属）、§6.1.2（上游失败分类）、§6.1.3（审计裁决码 `upstream_session_required` / `upstream_session_recovered`）
- 实现：`webui/server/proxy/upstream-session.ts`（会话归属与生命周期）、`webui/server/proxy/mcp-proxy.ts`（`handshakeUpstreamSession` / `forwardToKtxWithSession`）
- 回归锚点：`webui/server/__tests__/mcp-proxy-upstream-session.test.ts`（强制覆盖"从不回传 `Mcp-Session-Id` 的客户端"）、`webui/server/__tests__/mcp-proxy-upstream-failure.test.ts`
- 行为开关：`LUCY_ENABLE_UPSTREAM_SESSION_KEEPALIVE`（`!== "false"` 即启用，默认开启；置 `false` 退回纯透传，400 会原样出现）

## 4. 升级路径选择

| 判据 | 快路径 `20261009-v1` | 完整路径 r6 |
|---|---|---|
| 能否修复客户的 400 | ✅ 能 | ✅ 能 |
| 是否已正式发布 | ✅ 是（当前正式版 / Latest） | ❌ Draft 候选 |
| 是否已完成原生现场验收 | 部分（见包内验收项） | ❌ 未完成（原生 amd64 升级与恢复验收待完成） |
| 是否含会话归属加固与撤销屏障 | ❌ | ✅ |
| 交付风险 | 低：已发布、文档齐备 | 高：不得作为客户正式版发放 |
| 建议 | **本次采用** | 待原生验收完成后单独安排 |

**结论**：本次 400 闭环走快路径。会话归属加固与撤销屏障属安全增强，与 400 闭环解耦，单独排期。

完整路径候选身份（**当前为 Draft 候选，不发放客户**）：

| 项 | 值 |
|---|---|
| 软件包 | `lucy-k8s-integration-delivery-20261021-r6.tar.gz` |
| SHA256 | `18effb4f93565d4c20c36c885bd7c72537b1ca41a0cea7014583e80e43ceb642` |
| 镜像 | `project-lucy:customer-amd64-2.0.0-20261021-7de67e7`（linux/amd64） |
| 源码 | `7de67e774a5760ab94b2a6225c7ff9aa53fbaf3e`（clean） |
| 版本 | Lucy 2.0.0 / KTX 0.16.0 / Chart 0.2.6 |
| 状态 | Draft 候选：原生 amd64 升级与恢复验收待完成，不作为客户正式版，不替换 Latest |

> 前一版候选 r5 在上传前检查发现包含嵌套本机运行状态，未上传；r6 采用新镜像、新软件包与新摘要修正。两版均未公开发布。

## 5. 快路径升级动作单

> **供支持与交付团队使用**：客户现场的现象不必等旧镜像即可在本地复现——把
> `LUCY_ENABLE_UPSTREAM_SESSION_KEEPALIVE` 置 `false` 重建容器，代理即退回修复前的
> 纯透传行为，同一客户端形状（`initialize` 后不回传会话标识）会出现"目录能看、取数被拒"。
> 详细步骤与判别特征见[取证与验收文档 §10](../uat/uat-mcp-session-customer-verification.md)。
>
> 客户现役版本早于上游失败分类的引入，因此他们看到的是**裸 HTTP 400 文本**；当前版本
> 在故障态返回结构化 JSON-RPC 错误。失败模式相同，错误外泄形态不同——对客户说明时不要
> 把两者说成"一模一样"。

### 5.1 包身份与核验

| 项 | 值 |
|---|---|
| Release | `https://github.com/Forrest219/lucy-customer-delivery/releases/tag/lucy-k8s-integration-20261009-v1` |
| 资产 | `lucy-k8s-integration-delivery-20261009-v1.tar.gz`（1,050,136,037 字节） |
| 资产 SHA256 | `01b2713a112ea3e10c0477b027472473cbfc124be50e7e878e0020376400144b` |
| 源码 | `project-lucy@e08de17`（tag `customer-delivery-20261009-v1`） |
| 版本 | Lucy 0.17.0 / Chart 0.2.4 / KTX 0.16.0 / linux-amd64 |

现场核验（与包内 `BUILD-INFO.json` 逐项对照）：

```bash
shasum -a 256 -c lucy-k8s-integration-delivery-20261009-v1.tar.gz.sha256
docker image inspect <导入的镜像> --format '{{.Os}}/{{.Architecture}}'   # 必须 linux/amd64
```

### 5.2 Chart 0.1.0 → 0.2.4 必改项

来源：`deploy/k8s/helm/lucy/UPGRADE.md` "Required values changes when coming from chart 0.1.x / v1/v2 packages"。

| 旧（0.1.x / v1 / v2） | 新（0.2.4+） |
|---|---|
| exec 启动 / 就绪探针 | HTTP `/api/health`（Chart 默认） |
| `service.webuiPort` 同时用作容器端口 | 拆分：`containerPorts.webui: 5174`、`service.webuiPort: 8276` |
| 可选 `runtime-preflight` init 容器 | **整体移除**；`project-migrate` + `secrets-sync` 已内置 |
| Secret 挂载到 `/data/lucy/.ktx/secrets` | 由 `secrets-sync` 复制进卷；容器不再挂载 Secret |
| `runAsUser: 0` | `runAsUser: 10001`、`fsGroup: 10001` |
| `service.type: ClusterIP`（K3s 测试） | `LoadBalancer`（对外暴露 8276/8277） |
| 旧内容布局被静默忽略 | pre-M31 PVC 显式设置 `env.LUCY_CONTENT_ROOT: "."` |
| 资源名随 release 变化 | 资源名已存在时用 `fullnameOverride` |
| 仅用可变镜像 tag | 不可变 tag（registry 安装另加 `image.digest`） |

客户环境模板：`deploy/k8s/helm/lucy/examples/values.customer.example.yaml`。

**只换镜像不升 Chart 的后果**：Chart < 0.2.3 把 Secret 直接挂到 `.ktx/secrets`，新建数据源会报 `EROFS`（只读文件系统）；`LUCY_PUBLIC_MCP_URL` 若不在 values 中，WebUI 会进入 MCP fallback——**这会再次造成"目录能看、数据查不了"的半通**。

### 5.3 停机、备份与回滚

- 升级为 **Recreate 切换**，含停机窗口，不承诺零停机。
- 升级前对 `/data/lucy` 做**停机完整备份**（卷快照或归档），并记录 `helm history`、当前镜像 digest、当前 values。
- **保留原 PVC**（RWO，`/data/lucy`），不删除；同名资源、连接、语义层、Wiki、Skill、权限、数据库密码、MCP Token、审计记录随 PVC 保留。
- 回滚见 `deploy/k8s/helm/lucy/ROLLBACK.md`：恢复旧镜像 + 初始备份，再验证业务。
- 升级后管理员会话需重新登录（v2 会话不跨升级保留），Token 与权限不受影响。

### 5.4 禁止事项

- 禁止删除 PVC 除非明确要重建环境。
- 禁止把 KTX 端口 `7878` 暴露到 Service / Ingress。
- 禁止把 `LUCY_PUBLIC_MCP_URL` 用 `kubectl set env` 注入——必须写在 Helm values 里并 `helm upgrade`。
- 禁止使用可变 tag 作为不同构建的身份。
- 禁止用可变 tag / 可变包覆盖已分发的正式资产。
- 禁止把 Token 用 `--token` 传参或贴进报告与截图。
- 禁止用本地演示或合成集群回归结果代替原生现场验收结论。

## 6. 现场回传项

| 阶段 | 回传内容 | 形式 |
|---|---|---|
| 升级前 | 包 SHA256 核验结果、镜像架构、升级前 `helm status` / 资源清单 / 当前 values 摘要、备份哈希 | 脱敏文本 |
| 升级中 | 每步 PASS / FAIL / 待验 + 脱敏错误（阶段、错误码、异常类型） | 脱敏文本 |
| 升级后 | `helm status`、`rollout status`、Pod 1/1 Ready、`/api/health` 200 与 `bundledKtxVersion`、`ktx --version`、业务取数一次成功 | 脱敏文本 |
| 修复专项 | [取证与验收文档](../uat/uat-mcp-session-customer-verification.md) 的 `evidence.json` + 访问日志核对结论 | 证据文件 + 核对表 |
| 恢复演练 | RECOVERY.md 执行结果：还原旧卷与旧版本并验证业务，再次升级 | 脱敏文本 |

**不得回传**：密钥、密码、Cookie、完整 values、PVC 备份、Secret、Token 明文。

## 7. 边界与不得宣称事项

1. **不得在客户现役版本上宣称"已修复"**——该版本不含修复，结论只能是"需升级"。
2. **不得把快路径说成含安全加固**——`20261009-v1` 不含 2026-10-18 的会话归属绑定与撤销屏障。
3. **不得把 r6 候选作为客户正式版发放**——原生 amd64 升级与恢复验收未完成，候选状态为 Draft。
4. **会话缓存是进程内状态**：多副本 KTX 需要共享存储或粘性路由；客户当前为单副本 Recreate，边界成立。
5. **修复不替代客户端合规**：建议客户端回传 `Mcp-Session-Id`，减少一次内部握手往返。
6. **不承诺零停机**：升级含停机完整备份与 Recreate 切换。
7. 客户环境为 Apache Doris，属 gated 支持（每环境需独立证据），本次取证结论只覆盖该环境。

## 8. 相关文档

- [升级后取证与验收](../uat/uat-mcp-session-customer-verification.md)
- [`deploy/k8s/helm/lucy/UPGRADE.md`](../../deploy/k8s/helm/lucy/UPGRADE.md)、[`ROLLBACK.md`](../../deploy/k8s/helm/lucy/ROLLBACK.md)
- [客户交付与镜像上线 Checklist](customer-delivery-preflight-checklist.md)
- [客户 2.0 升级交付 Checklist](customer-v2-upgrade-release-checklist.md)
- [MCP Session 回归 UAT](../uat/uat-mcp-session-regression.md)
- [`webui/docs/07-mcp-auth-proxy-spec.md`](../../webui/docs/07-mcp-auth-proxy-spec.md) §4.3 / §6.1
