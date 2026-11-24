# 2026-11-13-cursor-docker-p0-qa — UAT-SUITE-CALIBER-BINDING

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-CALIBER-BINDING` |
| 总账 | P0-1／REQ-030-027 |
| 环境 | 本机 demo Docker compose-lucy-1 + MCP :57881 |
| Health | lucyVersion=0.30.0; gitSha=3aa402c9bd657cbf7e72a68b6fa271540da29690 |
| Agent | cursor |
| 凭据 | Bearer 仅从 /Users/forrest/Desktop/lucy token.txt 读入进程；未写入本跑次正文 |
| 证据 JSON | [`inbox/uat-p0-qa-mainpath-2026-11-13/evidence.json`](../../../../../inbox/uat-p0-qa-mainpath-2026-11-13/evidence.json) |

## 结果

| Case | 结果 | 备注 |
|---|---|---|
| UAT-R0 | **PASS** | health ok |
| UAT-CALIBER-01 | **PASS** | caliberBinding.status=none; order_count=1000 |
| UAT-CALIBER-02 | **BLOCKED** | 缺 published caliber-bindings 夹具；未降级冒充 |

## 套件判定

**PASS WITH GAP** — 可选 CALIBER-02 BLOCKED（无绑定资产）

## 禁止项确认

- 未用 vitest／CR 冒充 PASS
- 未把 Bearer／密码写入本文件
