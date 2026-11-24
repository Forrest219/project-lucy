# WebUI 性能复测指南

同事或 Agent 可独立使用本指南，在本机 Docker 和前台桌面浏览器复测页面卡顿。先选用例、冻结夹具和期望，再执行和归档。客户站点地址用于定位历史记录。模拟场景使用本地实例和合成数据。

## 1. 交接前填齐

| 项目 | 记录内容 |
|---|---|
| 场景 | 套件、用例编号、用户角色、起始页、操作顺序、预期看到的数据或反馈 |
| 构建 | 改前与候选的 `/api/health` 版本、`gitSha`／`gitDirty`，以及 Docker 镜像 ID 或 digest。dirty 构建附差集摘要或源码清单 |
| 夹具 | seed 或构造步骤、实际数量与分布、审计历史量、测试对象标签、时钟窗口及清理范围。未知现场条件写为未知，合成规模标明来源 |
| 环境 | Compose 项目、环回 URL、浏览器版本与视口、Docker CPU／内存、账号角色及已备好的登录方式。凭据只引用仓库外私有文件或受管凭据 |
| 判定 | 必跑与可选项、每档轮数、就绪条件、超时与预算。引用用例或 Spec 原文，观测参照线与修复合同预算分别记录 |

从仓库根目录运行下列检查。`LUCY_UAT_PROJECT` 和 `LUCY_UAT_WEB` 由执行者设为本次 Compose 项目及其环回地址。版本或镜像与交接单不同，先更正候选再开始计时。

```sh
docker compose -p "$LUCY_UAT_PROJECT" -f deploy/compose/docker-compose.demo.yml ps
docker compose -p "$LUCY_UAT_PROJECT" -f deploy/compose/docker-compose.demo.yml images
curl -fsS "$LUCY_UAT_WEB/api/health"
```

需要从源码起新环境时，使用冻结的工作副本和专用 Compose 项目。按 [demo compose](../../../deploy/compose/docker-compose.demo.yml) 配置空闲的 WebUI、MCP 和 MySQL 端口及对应的 `LUCY_PUBLIC_MCP_URL`。将 `LUCY_DEMO_SECRET_DIR` 设为本次仓库外私有目录，`TARGETARCH` 设为构建平台的 `arm64` 或 `amd64`，再运行下列命令。实例健康后，按 WebUI 首次创建管理员的流程使用本次引导文件。已有测试管理员时直接登录。

```sh
bash scripts/upgrade/ensure-bootstrap-token.sh "$LUCY_DEMO_SECRET_DIR/webui-bootstrap-token"
export TARGETARCH LUCY_DEMO_SECRET_DIR
export TARGETPLATFORM="linux/$TARGETARCH"
export LUCY_GIT_SHA="$(git rev-parse HEAD)"
if [ -n "$(git status --porcelain)" ]; then
  export LUCY_GIT_DIRTY=1
else
  export LUCY_GIT_DIRTY=0
fi
docker compose -p "$LUCY_UAT_PROJECT" -f deploy/compose/docker-compose.demo.yml up -d --build
```

## 2. 执行和取证

1. 用前台 Chrome 登录本地测试站点，转到约定起点。使用 DevTools Performance／Network 或能控制前台浏览器的 Agent 客户端。记录前台可见且有焦点，浏览器视口按套件约定。登录在本指南中通常是环境准备。
2. 每种状态独立计时。**浏览器冷进入**使用新浏览器上下文，在非目标页完成登录，首次打开目标页；记录静态资源缓存策略。**热导航**先完成目标页加载，离开后从约定侧栏回访。**服务端冷读**按专项夹具制造快照首次构建或失效，取证前避免预读该接口。首轮侧栏点击只记录为首次站内导航，服务端冷态须有独立证据。
3. 开始时清理 Network 记录，启动前台计时或录制。硬导航以 Navigation Timing 的起点为准，站内导航、搜索与筛选以本次点击或输入事件为准。结束时刻取本次期望内容完成绘制的时点，可用浏览器 `performance.now()` 加绘制帧、或 Performance trace 中的事件与截图帧。保留目标路径与当次内容的证据。骨架、标题、任意表格行和缓存旧行均不满足真实新数据就绪；明确验证有效热缓存时，核对它显示的是预期对象和窗口。
4. 另记实际页面请求的 HTTP 状态、业务响应是否成功、记录数、请求耗时，适用时记响应字节与 `Server-Timing`。额外采样的 API 单独标为独立请求，避免预热冷轮。保留所有超时、错误与失败轮次。样本较少时逐轮列值和最大值，正式分位按专项用例要求采样。
5. 同场景比较修复前后时，使用等价夹具、资源、浏览器和操作；两边各自验证实际 `gitSha`。已通过的正常场景可作回归基线。原症状在合成夹具中始终未出现，记录“未复现”，该跑次只给已测场景结论。
6. 清理本次创建的测试对象，验证回到基线；记录清理前后计数和未清理原因。用 [跑次模板](templates/run-record.md) 向既有套件 `runs/` 交付，保留可复查的脱敏表格与证据指纹。导出的请求记录、截图及日志需去掉凭据、Cookie、认证头和客户数据。

逐轮最小记录可直接复制到跑次。

| 构建／用例／轮次 | 数据档与冷热层 | 用户动作及就绪证据 | 页面 ms | API 状态／ms／条数／字节 | 判定与缺口 |
|---|---|---|---:|---|---|
|  |  |  |  |  |  |

按 [UAT 判定约定](CONVENTIONS.md#判定) 给结论。`PASS WITH GAP` 要列出实际通过的选择器及留存缺口。当前声明范围内的必跑断言失败记 `FAIL`，环境无法支撑必跑步骤记 `BLOCKED`。先前的完整矩阵结果与本次子集结果同时保留。

## 3. 两个现成复测入口

| 页面 | 执行入口 | 用户可见的就绪点 |
|---|---|---|
| `/admin/agents` | [UAT-PERF-AGENT-01／02](suites/roles-agent-page-perf/cases.md#uat-perf-agent-01--agent-冷进不预拉-roles) 核对首进请求与新建弹窗；[RACS B1](suites/roles-agent-concurrency-scale/suite.md#首批b12026-11-20分批决议) 核对名册及统计恢复；[F66-A](suites/agent-roster-summary/suite.md#出口与分层) 核对摘要和按需详情 | 在 `agent-list-table` 内看到本次指定 `agent-row-<id>`，可搜索或打开指定详情。统计窗口与恢复另计，核对所选窗口的新数据。需要复核冷编译、首访或大规模预算时，选现有完整 F58／F66 相应用例及夹具 |
| `/admin/tokens` | [UAT-PDS-01](suites/page-dom-scale/cases.md#uat-pds-01--token-凭据页admintokens) 覆盖基线和凭据规模档 | 在 `tokens-table` 内看到指定 `token-row-<label>`，搜索能返回该凭据，清空搜索后回到完整列表。按本轮请求和期望条数核对结果 |

仓库的 [页面 DOM 探针](../../../scripts/uat/page-dom-probe.mjs) 与 [Agent DOM 探针](../../../scripts/uat/racs-browser-dom-probe.mjs) 可给出辅助采样。探针的 `colder` 是登录后的首次站内导航，行数门槛和退出码只提供探针输出。交叉复测仍需核对路由、指定行、当前 API 成功响应和明确的冷热层。
