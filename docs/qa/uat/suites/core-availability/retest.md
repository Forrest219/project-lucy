# 核心可用性 UAT 复测手册

本手册适用于同事和具备本机终端的 Agent。使用本机隔离 Docker、真实 MySQL 和合成数据。以[本套件](suite.md)、[用例](cases.md#标准复测档位)和[通用复测标准](../../retest-standard.md)为入口。

## 选择档位

| 档位 | 窗口和夹具 | 结论 |
|---|---|---|
| `calibration` | 120 秒，每 60 秒一个周期，1883 张以上启用表，20,000 条初始审计记录，60 秒故障控制 | 只核对测程、回执、证据与清理。有效通过输出 `CALIBRATION PASS`。 |
| `formal` | 1800 秒，每 150 秒一个周期，1883 张以上启用表，200,000 条初始审计记录，120 秒故障控制 | 验证 [STD-01～05](cases.md#标准复测档位)。同一候选上完成全部必做项后，核验器输出该组合场景的 `PASS`。 |

两个档位每次后续变更都写入 3,000 条合成历史记录。正式档固定 12 个周期和 12 个轮转 MCP 身份。旧 7200 秒剧本和历史时长保留在原用例及跑次。F61／F62／F63／F69 完整矩阵和 R-CAV 的真实数据源停服、TERM 等额外演练继续各自登记。

标准场景的 HTTP 和纯 MCP 走真实 loopback 转发。反代按协议转发并记录独立请求 ID，上游连通性出错会留下网关 503。直连探针和反代 `readyz` 同窗独立采样。纯 MCP 走实际 HTTP 传输与 Bearer 身份，验 `initialize`、`tools/list` 和真实 `lucy_query`。SQL oracle 为订单数 4、合计 100。此场景覆盖 API 和原生 MCP 协议，WebUI 页面与具体 Agent 应用的交互可按各自套件复测。

## 准备候选

需要 Python 3.9+、本机 Docker Linux 引擎、至少 4 个 Docker CPU、5 GiB Docker 可用内存和 4 GiB 本地证据空间。候选与 MySQL 镜像都用 Docker 原生架构。留出独立重负载时间窗，按团队现有隔离资源约定与其他 Docker 压测错峰。脚本为本跑次生成端口、网络、卷和测试凭据。

使用团队已冻结的 Lucy 镜像和完整 Git SHA，或者从已提交的源码构建。以下在仓库根目录运行，`linux/arm64` 可换成本机 Docker 的 `linux/amd64`。

```bash
git_sha="$(git rev-parse HEAD)"
lucy_image="project-lucy:uat-cav-${git_sha:0:12}"

git archive --format=tar "$git_sha" | docker build \
  --platform linux/arm64 \
  --build-arg "LUCY_GIT_SHA=$git_sha" \
  --build-arg LUCY_GIT_DIRTY=0 \
  --tag "$lucy_image" -

docker pull mysql:8.4
mysql_image="$(docker image inspect mysql:8.4 --format '{{.Id}}')"
lucy_image="$(docker image inspect "$lucy_image" --format '{{.Id}}')"
```

同架构的独立复跑使用相同镜像 ID，可以通过团队已有的镜像分发途径获取。入口记录 Lucy 和 MySQL 实际镜像 ID，并在容器启动后核对 Lucy 自报的 Git SHA 与干净标记。

## 执行

```bash
python3 scripts/uat/core-availability-uat.py preflight \
  --image "$lucy_image" --git-sha "$git_sha" --mysql-image "$mysql_image"

run="inbox/cav-$(date +%Y%m%d-%H%M%S)-calibration"
python3 scripts/uat/core-availability-uat.py run --profile calibration \
  --image "$lucy_image" --git-sha "$git_sha" --mysql-image "$mysql_image" --out "$run"
```

校准出口为 0 时，用新的输出目录和 `--profile formal` 执行正式跑次。正式窗口 30 分钟，镜像启动、夹具准备、显式恢复、故障控制、审计收敛和清理各有独立时间。失败也会留下报告。输出目录须不存在，便于把每次尝试与证据一一对应。中止时发一次 Ctrl-C 或 TERM，并等脚本完成隔离资源清理。清理证明见 `candidate/cleanup.json`。

## 独立重算

把整个跑次目录交给第二执行者。目录内含运行时实际使用的工具副本和原始证据哈希。离线重算可以在无 Docker 的终端执行。先用同一版可信仓库工具，也可审阅并核对目录中的工具副本后，从副本所在目录执行。

```bash
python3 scripts/uat/core-availability-uat.py verify --run "$run"

# 在另一目录使用已核对的冻结工具副本
python3 "$run/tools/scripts/uat/core-availability-uat.py" verify --run "$run"
```

以 `verdict.json` 的 `strictAcceptanceVerdict`、逐项结果、各路分母和失败分类为交接结论。求值耗时和复测的实际延迟会随环境变化，同一份冻结证据应得到同一口径。退出码 0 表示 `PASS` 或 `CALIBRATION PASS`，1 表示 `FAIL`，2 表示 `BLOCKED`。启动后形成的正式必做项失败，包括在线诊断采集漏发，保留为 `FAIL`。历史 `PASS WITH GAP` 继续按原用例范围引用。

| 必查证据 | 内容 |
|---|---|
| `freeze.json`、`candidate/run-identity.json` | 测程文件哈希、固定档位、实际镜像与 Git 构建身份 |
| `tools/scripts/uat/`、`evidence-sha256.json` | 自包含的测程副本与证据文件哈希。核验不访问 Docker，重复核验只替换 `verdict.json`。 |
| `events.jsonl`、`gateway.jsonl` | 计划、发起、漏发、完成、截尾及独立网关请求关联。网关记录不含凭据或请求正文。 |
| `candidate/scale-*.json`、变更回执、`candidate/exec-bindings/` | 规模、真实保存重载及运行进程，诊断采集的请求与实际执行票据 |
| `candidate/io-control-*.json`、`candidate/cleanup.json` | 真实诊断进程终止、同进程恢复、隔离资源清理 |
| `audit-evidence.json`、`audit-evidence.sqlite.gz` | 合成审计库一致快照。核验器先核对压缩与解压哈希，再重算正确关联和合法 MCP 的恢复证明。 |
| `summary.json`、`verdict.json` | 运行器结果、独立重算结果。以独立判定为准。 |

正式交接按[跑次索引](runs/README.md)留存经过检查的证据。凭据由夹具临时生成，证据只分享测试结果和合成数据。
