// UAT-SUITE-ACCESS-MAP-SANKEY Docker 全真复验：在宿主上生成某个 profile 的数据目录（ktx.yaml／access.yaml／语义层／审计库）。
// 用法（在 webui/ 下）：SANKEY_PROFILE=rich SANKEY_DATA=/tmp/lucy-sankey-docker/rich/data npx tsx ../scripts/uat/sankey-docker/seed.mts
// 通常由 up.sh 调用。
import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { SANKEY_PROFILES, buildDataset, expectedCounts, seedAudit, writeProject, type SankeyProfile } from "../../../webui/tests/uat/access-map-sankey-fixture.ts";

const profile = process.env.SANKEY_PROFILE as SankeyProfile;
if (!SANKEY_PROFILES.includes(profile)) throw new Error(`bad profile ${profile}`);
const data = process.env.SANKEY_DATA!;
await rm(data, { recursive: true, force: true });
await mkdir(path.join(data, ".ktx-ui"), { recursive: true });
await writeProject(data, buildDataset(profile));

process.env.KTX_PROJECT_ROOT = data;
process.env.LUCY_CONTENT_ROOT = path.join(data, "config");
process.env.LUCY_AUDIT_DB = path.join(data, ".ktx-ui", "audit.sqlite");
process.env.LUCY_DEPLOYMENT_MODE = "development";
process.env.LUCY_CHART_DEPLOYMENT_MODE = "development";
process.env.LUCY_WEBUI_AUTH = "off";
delete process.env.VITEST;

const { getAuditDb } = await import("../../../webui/server/admin/audit.ts");
const db = await getAuditDb();
const n = seedAudit(db, profile);
db.pragma("wal_checkpoint(TRUNCATE)");
db.close();
console.log(JSON.stringify({ profile, seededCalls: n, expected: expectedCounts(profile) }));
process.exit(0);
