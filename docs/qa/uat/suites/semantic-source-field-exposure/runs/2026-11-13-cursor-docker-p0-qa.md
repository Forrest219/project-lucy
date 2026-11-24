# 2026-11-13-cursor-docker-p0-qa — UAT-SUITE-FIELD-EXPOSURE

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-FIELD-EXPOSURE` |
| 总账 | P0-A／REQ-030-012 |
| 环境 | 本机 demo Docker compose-lucy-1 + MCP :57881 |
| Health | lucyVersion=0.30.0; gitSha=3aa402c9bd657cbf7e72a68b6fa271540da29690 |
| Agent | cursor |
| 凭据 | Bearer 仅从 /Users/forrest/Desktop/lucy token.txt 读入进程；未写入本跑次正文 |
| 证据 JSON | [`inbox/uat-p0-qa-mainpath-2026-11-13/evidence.json`](../../../../../inbox/uat-p0-qa-mainpath-2026-11-13/evidence.json) |

## 结果

| Case | 结果 | 备注 |
|---|---|---|
| UAT-R0 | **PASS** | health ok |
| UAT-EXPOSURE-01 | **PASS** | demo 无 field-exposure 台账 → SC-02 全暴露基线 |
| UAT-EXPOSURE-02 | **BLOCKED** | 缺 field-exposure 台账夹具；未把「列不存在」冒充 field_not_exposed |

## 套件判定

**PASS WITH GAP** — 可选 EXPOSURE-02 BLOCKED（无台账）

## 禁止项确认

- 未用 vitest／CR 冒充 PASS
- 未把 Bearer／密码写入本文件
