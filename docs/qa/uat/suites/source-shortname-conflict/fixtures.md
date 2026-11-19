# 隔离复现夹具

- 入口：`python3 scripts/uat/reproduce-source-shortname-conflict.py`；本机需已有 `project-lucy:demo` 与 `mysql:8.4`。修复后拟增加 `--mode verify`，当前尚未实现。
- 两个一次性 Docker 容器与专属网络，名称前缀 `lucy-snc-`；端口仅绑定 127.0.0.1，随机分配。
- 物理表：`weather.city(id INT PRIMARY KEY, name VARCHAR(50))` 与 `ods.city`，各插入一条合成数据；连接名 `hive-1`，实际数据库为 MySQL。
- 管理员：真实 bootstrap；普通数据面 Agent：`repro_reader`，Role 只授予 hive-1 的启用表范围与指定 MCP 工具。
- 数据目录及随机凭据：进程临时目录，目录 0700、凭据文件 0600；证据只保留脱敏后的响应。脚本 finally 删除容器、网络及私有目录。
- 原始证据：`inbox/source-shortname-conflict/evidence/<UTC跑次>/`；完成后留档本套件 `runs/`。
- 本夹具不依赖或修改现有 demo 数据卷，不访问远程管理台；不代表客户 SelectDB／Hive 元数据适配已验。

## 修复后扩展夹具（NOT RUN）

- 二次前缀占用：同 Connection 的合法 `ods_city`，验证 `ods_city_2`。
- 并发候选：两个不同 Schema 的裸 `city` 内容，验证发布锁内复核与失败方零推进。
- 旧冲突：直接写入隔离项目的 Manifest 夹具，模拟升级前已损坏资产；不修改产品代码、现有 demo 或客户配置。
- 多组冲突：至少六组可独立唯一化的合成 Manifest，验证逐份修复不死锁；不外推为客户现场六对已核验。
- 引用兼容：weather.city／ods_city 的 Role、overlay 与已保存查询，重扫后检查短名、文件和查询结果不漂移。
- 所有扩展均须真实 API／MCP 执行；环境不能构造时记 BLOCKED，未经独立授权不得用 mock 或 Code Review 替代。
