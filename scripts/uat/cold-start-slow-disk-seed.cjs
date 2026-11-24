// 在**旧版（0.25.0）镜像内**运行：向它自己建好的 audit.sqlite 灌入客户规模的 access_log。
// 用法（由 cold-start-slow-disk.mjs 调用，不要手工跑）：
//   docker run --rm --entrypoint node -v <vol>:/data/lucy -v <this>:/seed.cjs:ro -e ROWS=200000 -e USERS=67 <old-image> /seed.cjs
// 形状取自 2026-11-17 客户事故复盘：约 20 万行、67 个用户、30 天，库文件约 880MB（每行带约 4KB 文本）。
// 只写合成数据；不读、不连任何客户库。
const Database = require("/app/webui/node_modules/better-sqlite3");

const ROWS = Number(process.env.ROWS ?? 200000);
const USERS = Number(process.env.USERS ?? 67);
const DAYS = 30;
const DB_PATH = process.env.AUDIT_DB ?? "/data/lucy/.ktx-ui/audit.sqlite";

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
const before = db.prepare("SELECT COUNT(*) AS c FROM access_log").get().c;
if (before > 0) {
  console.log(JSON.stringify({ seeded: false, reason: "access_log not empty", rows: before }));
  process.exit(0);
}

const pad = (label) => `${label} `.repeat(Math.ceil(1400 / (label.length + 1))).slice(0, 1400);
const argsPad = pad("args_summary_synthetic_uat_cold_start");
const sqlPad = pad("SELECT synthetic FROM uat_cold_start");
const previewPad = pad("preview_synthetic_uat_cold_start");

const insert = db.prepare(`INSERT INTO access_log
  (ts, user_id, token_label, client, tool, args_summary, generated_sql, query_preview, outcome, duration_ms, request_id, trace_id)
  VALUES (@ts, @user_id, @token_label, @client, @tool, @args_summary, @generated_sql, @query_preview, @outcome, @duration_ms, @request_id, @trace_id)`);

const end = Date.now();
const start = end - DAYS * 86_400_000;
const step = (end - start) / ROWS;
const BATCH = 10_000;
for (let offset = 0; offset < ROWS; offset += BATCH) {
  db.transaction(() => {
    for (let i = offset; i < Math.min(offset + BATCH, ROWS); i += 1) {
      const user = `uat-cold-user-${String(i % USERS).padStart(3, "0")}`;
      insert.run({
        ts: new Date(start + i * step).toISOString(),
        user_id: user,
        token_label: "uat",
        client: "uat-cold-start",
        tool: "lucy_query",
        args_summary: argsPad,
        generated_sql: sqlPad,
        query_preview: previewPad,
        outcome: "success",
        duration_ms: 50,
        request_id: `uat-cold-${i}`,
        trace_id: `uat-cold-trace-${i}`
      });
    }
  })();
}
db.pragma("wal_checkpoint(TRUNCATE)");
const after = db.prepare("SELECT COUNT(*) AS c FROM access_log").get().c;
db.close();
console.log(JSON.stringify({ seeded: true, rows: after, users: USERS, days: DAYS }));
