# 2026-11-13-cursor-docker-p0-qa — UAT-SUITE-CATALOG-SEMANTICS

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-CATALOG-SEMANTICS` |
| 总账 | P0-2／REQ-030-023 |
| 环境 | 本机 demo Docker compose-lucy-1 + MCP :57881 |
| Health | lucyVersion=0.30.0; gitSha=3aa402c9bd657cbf7e72a68b6fa271540da29690 |
| Agent | cursor |
| 凭据 | Bearer 仅从 /Users/forrest/Desktop/lucy token.txt 读入进程；未写入本跑次正文 |
| 证据 JSON | [`inbox/uat-p0-qa-mainpath-2026-11-13/evidence.json`](../../../../../inbox/uat-p0-qa-mainpath-2026-11-13/evidence.json) |

## 结果

| Case | 结果 | 备注 |
|---|---|---|
| UAT-R0 | **PASS** | health ok |
| UAT-CATSEM-01 | **PASS** | superstore with desc=3 |
| UAT-CATSEM-02 | **SKIPPED** | 可选范围裁剪深检未跑 |

## 套件判定

**PASS**

## 禁止项确认

- 未用 vitest／CR 冒充 PASS
- 未把 Bearer／密码写入本文件
