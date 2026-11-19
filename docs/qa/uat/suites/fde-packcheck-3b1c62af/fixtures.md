# Fixtures — UAT-SUITE-FDE-PACKCHECK

| 键 | 值 | 备注 |
|---|---|---|
| 候选 SHA | `3b1c62af32af7b6d045caef7fa10ccc92300ae97` | 干净 worktree：`/private/tmp/lucy-fde-3b1c62af`（以 R0 实际路径为准） |
| 基线 worktree | `ff4762c9`／`3a9f0711`／`84becc34` | 只读；`git status --short` 须为空 |
| Node | 22（固定） | 本机默认 v24.13.1，不得用于 L1 |
| L2 镜像 | `project-lucy:fde-3b1c62af`；84 基线镜像 `project-lucy:fde-84becc34`（D3 已批） | 有缓存构建；`BUILDPLATFORM=linux/arm64`；记录 `ktx install layer` |
| L2 沙箱 | 独立 compose project／volume；端口与 demo 错开 | **不得**触碰 `compose-lucy-1`；不 `down -v` demo |
| 3a9 旧基线容器 | `lucy-old3a9`（镜像 `project-lucy:old-3a9f0711`） | 仅用于 UAT-FDE-05 旧基线；只读使用 |
| 数据库 | `compose-demo-db-1`（MySQL 8.4）；宽表种子 `scripts/uat/seed-large-schema-fixtures.sh all` | 规模下限见 `UAT-SUITE-LARGE-SCHEMA`，不得降低 |
| 外部目录 lab | `lucy-uat-hive-hms`、`doris-lab-2014-fe-1`、`lucy-krb-hms`、`kdc-lab` | UAT-FDE-02／03 |
| 延迟注入 | 独立代理容器置于数据库／目录前，仅沙箱使用 | D2 授权范围；跑次须写明注入参数 |
| FDE 证据目录 | `/Users/zhangxingchen/Nutstore Files/WIP@坚果云/lucy 升级相关/Lucy升级检查_3b1c62af_20261119/证据/` | L1 脚本来源；复制到 worktree `inbox/`，**只改 import 路径**并保留 diff |
| 登录凭据文件 | 路径 only，由执行时填写（仓库外） | 勿粘贴密码 |
| 证据输出 | `inbox/uat-fde-3b1c62af-2026-11-19/`（`l1/`、`l2/`） | `inbox/` 为 tmp，可随时删除；跑次文件落本套件 `runs/` |
| 清理 | worktree 删除；沙箱容器与 volume 删除；临时连接 id 前缀 `uat-fde-` | `uat_` 前缀种子库按 UAT README 约定处理 |

可写：容器名、镜像名、端口、命令、凭据文件路径。禁写：密码、token、secret 内容、客户生产主机口令。


## 修复候选模式 fixtures（P1-57 已确认；执行时填写实值）

| 键 | 要求 |
|---|---|
| 模式 | `fix-retest`；原 `baseline-repro` 的3b1c62af／ff／3a9／84配置不覆盖 |
| 修复候选 | 含 d8c3f097 与本批整改的完整新 SHA；当前待实现，不填伪 SHA；干净 checkout，gitDirty=false |
| 运行制品 | 独立缓存构建；image ID／architecture／构建时间／运行源码SHA256入run；本机arm64不外推amd64 |
| 隔离 | 独立compose project／数据卷／临时端口。demo只读核对；必要更新按确认后的demo:upgrade保留账号／ACL／日志 |
| R1/R2数据库 | `uat_fde_` 前缀实验库／临时只读用户；真实50×400、30表mixed；R2为600表（50×1500＋550×30＝91500字段）MySQL MyISAM 元数据夹具，先确认lab支持，不触及生产数据库 |
| 延迟代理 | 只在沙箱数据库前；记录6000ms规则、范围、命中次数与撤除时点；正常夹具无代理另跑 |
| D5拒绝代理 | 已授权；先全真构造失败后才允许指定语法／t0权限拒绝；合法字段不伪造；跑次／INDEX标受控降级。未确认则BLOCKED |
| 审计基线 | 新实例正常初始化与真实调用形成 canonical ledger／projection／attribution journal 基线；不补demo历史、不写假基线；基线失败单列 |
| 审计满量 | 复用P1-47固定满量合成夹具，额外预置多级现存跨界问询／关联与交错会话；记录各表实际行数、用户数、链长、闭包内外对象摘要 |
| RPB工况 | 沿用P1-47套件当前资源与I/O参数、默认维护器；三次独立冷启动×120秒窗口，身份固定。不以正常小样本代满量 |
| 凭据 | 仅仓库外文件路径／环境引用；密码、token和cookie不得落测试台／inbox |
| 证据 | 确认后每轮另建 `runs/YYYY-MM-DD-<agent>-fde-fix-<sha>.md`，绑定case、mode、注入范围、命令与退出码；本轮不新造执行证据 |
