# Demo Superstore Eval Suite

POC 专用 eval，**仅**用于 `docker-compose.demo.yml` 自包含 Superstore 数据集（1000 行）。

- **Connection**: `demo-mysql`
- **Gold 来源**: `examples/docker-demo/mysql/_baseline.json`（seed=42, rows=1000）
- **勿与** 仓库根 `evals/superstore/`（Aliyun 10194 行快照）混用

运行 demo 栈后，suite 位于容器 `/data/lucy/evals/demo_superstore/`。
