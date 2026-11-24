# Fixtures — UAT-SUITE-COLD-START-SLOW-DISK

| 键 | 值 | 备注 |
|---|---|---|
| 脚本 | `scripts/uat/cold-start-slow-disk.mjs`、`scripts/uat/cold-start-slow-disk-seed.cjs` | `npm run uat:cold-start -- …` |
| 对照镜像（0.25.0） | `project-lucy:old-9c78b0e3` | 客户上一次平滑升级 `20261111-r1` 的运行镜像（`gitSha=9c78b0e3…`）。`UAT_COLD_OLD_IMAGE` 可覆盖。缺失时从 `9c78b0e3` 构建：`docker build --build-arg BUILDPLATFORM=linux/arm64 --build-arg TARGETPLATFORM=linux/arm64 --build-arg TARGETARCH=arm64 --build-arg LUCY_GIT_SHA=<40 位全 sha> --build-arg LUCY_GIT_DIRTY=false -t project-lucy:old-9c78b0e3 .` |
| 改前基线镜像 | `project-lucy:cold-head-<sha8>` | 在被测提交的 detached worktree 上构建，`LUCY_GIT_SHA` 必须是 40 位小写 hex |
| 候选镜像 | `--new-image <tag>` | |
| 种子快照卷 | `lucy-uat-cold-snap-old` | 0.25.0 建表后灌入 200,000 行、67 用户、30 天，约 943MB。`seed --reseed` 重建 |
| 已迁移快照卷 | `lucy-uat-cold-snap-mig-<镜像 tag>` | 候选镜像在**正常盘、热缓存**下先迁移一次再停机后快照。`--remigrate` 重做 |
| 运行卷／容器 | `lucy-uat-cold-run-data`／`lucy-uat-cold-run` | 每个用例从快照整卷复制，互不污染 |
| 端口 | WebUI `55391`、MCP 代理 `57991` | `UAT_COLD_WEBUI_PORT`／`UAT_COLD_PROXY_PORT` 覆盖 |
| 限速（默认＝复盘值） | 读写各 30MB/s；读 300 IOPS；写 100 IOPS；2 核 | `UAT_COLD_READ_MBPS`／`WRITE_MBPS`／`READ_IOPS`／`WRITE_IOPS`／`CPUS` 覆盖；设备自动探测，`UAT_COLD_DEVICE` 覆盖 |
| 冷缓存 | `docker run --privileged --pid=host alpine nsenter -t 1 -m sh -c "sync; echo 3 > /proc/sys/vm/drop_caches"` | 每次启动前执行 |
| 引导密钥 | `${TMPDIR}/lucy-uat-cold-secrets/bootstrap-token` | 脚本自生成，0700／0600，不入仓、不打印 |
| 证据目录 | `inbox/uat-cold-start-<label>/` | `UAT-COLD-xx.json`、`-samples.csv`、`-container.log`。不含密钥。`runs/` 只抄路径与数字 |
| 健康路径 | 新：`/api/livez`、`/api/readyz`；0.25.0：`/api/health` | 0.25.0 无 livez／readyz，对照项用 health 判就绪 |

## 诊断开关（不用于正式判定）

- `UAT_EXTRA_DOCKER_ARGS`：空格分隔，追加到 `docker run`（例如 `-v 工作树源码:容器路径:ro` 把未打包源码挂进候选镜像，或 `-e NODE_OPTIONS=--cpu-prof` 取 profile）。
- `UAT_KEEP_CONTAINER=1`：用例结束后保留已停止的容器，便于 `docker cp` 取证。
- 用这两个开关跑出的结果**不入测试台、不得写进 INDEX**；正式跑次必须整镜像、不带开关。

## 禁止

- 把密码、token 写入本目录、跑次或聊天回复。
- 用读代码、热缓存单测或 CI 绿代替本套件 PASS。
- 用 `docker restart` 代替「干净冷启动」。
- 在业务高峰对客户实例做任何写操作；UAT-COLD-06 只读。
- 把本机限速演练写成「客户盘实测」。
