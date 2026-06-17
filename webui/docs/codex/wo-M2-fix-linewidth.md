# 返工工单 M2-FIX · YAML 序列化折行破坏 round-trip

> 先读 [README.md 总纲](README.md)。这是 M2 验收**打回**的返工单,只修一处根因 + 补测试盲区。依赖:M2 已交付的代码。

## codex 直投 prompt
```
工作目录：/Users/forrest/Projects/project-lucy/webui。先读 docs/codex/wo-M2-fix-linewidth.md、docs/01-architecture.md(ADR-01)。
任务：修复 YAML 序列化默认折行(lineWidth:80)破坏 round-trip 的 bug，并补长行测试盲区。
关键约束：serialize/serializeOverlay 改用 doc.toString({ lineWidth: 0 })；不得改动其它逻辑；保持 "on" 引号、ai 桶、未知键、他表不变。
完成后 npm test 贴结果，并按本单「真实数据复验」跑一次活体 round-trip，按 DoD 收尾交回。
```

## 背景(已交叉验证确认)
M2 的 round-trip 红线在**真实数据**上被破坏:只改一行(给 `order_id` 加 `human` 描述),实测 diff 却把 **7 处无关的超长 `ai:` 描述跨多张表全部重新折行**:
```diff
-      ai: Master registry of all superstore_orders, capturing identity, segmentation, regional assignment, and account lifecycle status.
+      ai: Master registry of all superstore_orders, capturing identity, segmentation, regional
+        assignment, and account lifecycle status.
```
**根因**:`serialize()` = `doc.toString()` 用 yaml 默认 `lineWidth: 80`,把长标量按 80 列折叠。已实测:
- `doc.toString()` === 原文 → **false**
- `doc.toString({ lineWidth: 0 })` === 原文 → **true**(完美无损)

直接违反 **ADR-01**(「naive 序列化触发无意义 git diff」)。`semantic-layer.roundtrip.test.ts` 没抓到,是因为 fixture 描述全短于 80 字符,从不触发折行——**测试盲区**。

## 必读
`01-architecture.md` ADR-01;`04-data-model.md §3`。

## 交付文件
```
server/semantic-layer.ts                       # serialize() 加 { lineWidth: 0 }
server/overlay.ts                              # serializeOverlay() 加 { lineWidth: 0 }
server/__tests__/semantic-layer.roundtrip.test.ts   # 补长行(>80 字符)fixture 用例
```

## 实现步骤
1. `server/semantic-layer.ts`:
   ```ts
   export function serialize(doc: Document): string {
     return doc.toString({ lineWidth: 0 });   // lineWidth:0 关闭折行，保证无损 round-trip(ADR-01)
   }
   ```
2. `server/overlay.ts` `serializeOverlay()` 同样改为 `doc.toString({ lineWidth: 0 })`(防长 measure/segment 描述被折行)。
3. **补测试盲区**:在 `semantic-layer.roundtrip.test.ts` 的 fixture 里加一条 **>80 字符的长描述**,并新增用例:对该表只改一处描述,断言:
   - `preview.files` 长度为 1;
   - diff 的增删行**只有新增的 `human:` 那一行**(无任何 `ai:` 行被删/被改、无折行产生);
   - proposed 中长 `ai:` 描述**仍是单行**(`expect(proposed).toContain('<完整长描述单行>')`)。

## 约束(重点)
- **只动序列化的 lineWidth**,不要改 applyPatch/overlay 的其它逻辑。
- 仍须保住:`"on"` 双引号、`descriptions.ai` 不被覆盖、未知键保留、其它表纹丝不动。

## 自验
```bash
npm test   # roundtrip 含新长行用例,全绿
```
**真实数据复验(必跑,贴结果)**——证明红线真的修好:
```bash
# 把项目复制到临时目录,避免动真实语义层
TMP=$(mktemp -d); cp /Users/forrest/Projects/project-lucy/ktx.yaml "$TMP/"
mkdir -p "$TMP/semantic-layer" "$TMP/wiki" "$TMP/.ktx-ui"
cp -R /Users/forrest/Projects/project-lucy/semantic-layer/* "$TMP/semantic-layer/"
KTX_PROJECT_ROOT="$TMP" npx tsx server/index.ts &   # 起服务
# 改一行描述,dryRun 预览:
curl -s -X PUT http://127.0.0.1:5174/api/sources/mysql-aliyun/dataforai/superstore_orders \
  -H 'content-type: application/json' \
  -d '{"dryRun":true,"patch":{"columns":[{"name":"order_id","description":"人工：客户主键"}]}}'
# 期望:diff 的 +/- 业务行只有 1 行(新增 human:),无任何 ai: 折行
pkill -f "tsx server/index.ts"; rm -rf "$TMP"
```

## DoD
总纲 §3 全项 + roundtrip 长行用例绿 + 真实数据复验 diff 仅 1 行(无折行)+ 临时副本与进程已清理。完成后**停下交回**。

> 顺带(非本单强制,但建议同批做):M5 验收在真实项目留了残留(`wiki/global/m5-acceptance.md`、`.ktx-ui/` 等)。若顺手,清理掉或改用临时副本冒烟;不在本单 DoD 内。

---
_返工工单 by Claude (架构师 / 工单发布者) · 2026-06-16_
