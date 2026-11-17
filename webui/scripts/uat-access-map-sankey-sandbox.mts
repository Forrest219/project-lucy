/**
 * Isolated sandbox for UAT-SUITE-ACCESS-MAP-SANKEY: seeds one fixture profile and serves the
 * Lucy WebUI on a free port with auth off. Never touches the demo container or its volume.
 *
 *   SANKEY_PROFILE=rich SANKEY_PORT=58101 SANKEY_DIST=/tmp/lucy-sankey/dist-head \
 *     npx tsx scripts/uat-access-map-sankey-sandbox.mts
 *
 * Open: http://127.0.0.1:<port>/admin/access-map?window=168h&inquiryKind=all&accessGrade=all
 * Profiles: grants-only | sparse | rich | candidate-only | dense (see the suite fixtures.md).
 * Set SANKEY_EMIT=1 to print the expected counts and exit without serving.
 */
import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { SANKEY_PROFILES, buildDataset, expectedCounts, seedAudit, writeProject, type SankeyProfile } from "../tests/uat/access-map-sankey-fixture.ts";

const profile = (process.env.SANKEY_PROFILE ?? "rich") as SankeyProfile;
if (!SANKEY_PROFILES.includes(profile)) throw new Error(`unknown SANKEY_PROFILE=${profile}; one of ${SANKEY_PROFILES.join(", ")}`);
const expected = expectedCounts(profile);
if (process.env.SANKEY_EMIT === "1") {
  console.log(JSON.stringify(expected, null, 2));
  process.exit(0);
}

const base = process.env.SANKEY_ROOT ?? `/tmp/lucy-sankey/${profile}`;
const root = path.join(base, "root");
await rm(base, { recursive: true, force: true });
await mkdir(root, { recursive: true });
await writeProject(root, buildDataset(profile));

process.env.KTX_PROJECT_ROOT = root;
process.env.LUCY_CONTENT_ROOT = path.join(root, "config");
process.env.LUCY_AUDIT_DB = path.join(base, "audit.sqlite");
process.env.LUCY_WEBUI_DIST_DIR = process.env.SANKEY_DIST ?? path.resolve("dist");
process.env.LUCY_DEPLOYMENT_MODE = "development";
process.env.LUCY_CHART_DEPLOYMENT_MODE = "development";
process.env.LUCY_WEBUI_AUTH = "off";
delete process.env.VITEST;

const { getAuditDb } = await import("../server/admin/audit.ts");
const seeded = seedAudit(await getAuditDb(), profile);
const { buildServer } = await import("../server/index.ts");
const app = buildServer();
await app.listen({ host: "127.0.0.1", port: Number(process.env.SANKEY_PORT ?? 0) });
const addr = app.server.address();
const port = typeof addr === "object" && addr ? addr.port : 0;
console.log(JSON.stringify({ ready: `http://127.0.0.1:${port}`, profile, seededCalls: seeded, expected }, null, 2));
