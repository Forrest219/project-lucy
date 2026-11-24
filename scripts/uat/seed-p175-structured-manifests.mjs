import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const targetBytes = 6_482_102;
const peakBytes = 2_347_590;
const demoManifest = await readFile(new URL("../../examples/docker-demo/project-template/semantic-layer/demo-mysql/_schema/dataforai.yaml", import.meta.url));
const distribution = [5, 2, 8, 5, 1, 1, 1];
const extraTableCount = 1_440;
const peakTableCount = 384;
const output = process.argv[2];
if (!output) throw new Error("Usage: node scripts/uat/seed-p175-structured-manifests.mjs <new-output-directory>");
await mkdir(output);

const pad = (value, length = 2) => String(value).padStart(length, "0");
const column = (index) => `field_${pad(index, 3)}`;
const tableHeader = (schema, table) => [
  `  ${table}:`,
  `    table: ${schema}.${table}`,
  "    columns:",
  "      - name: id",
  "        type: number",
  "        pk: true"
].join("\n") + "\n";
const manifestField = (index) => [
  `      - name: ${column(index)}`,
  "        type: number",
  "        nullable: false",
  "        descriptions:",
  `          db: Observed quantity for observation group ${pad(index, 3)}.`,
  `          ai: Sum this quantity within group ${pad(index, 3)} before comparing reporting periods.`
].join("\n") + "\n";

const fieldByteLength = Buffer.byteLength(manifestField(1));
const manifests = distribution.flatMap((count, connectionIndex) => Array.from({ length: count }, (_, schemaIndex) => ({
  connection: `p175-width-${pad(connectionIndex + 1)}`,
  schema: `p175w_${pad(connectionIndex + 1)}_${pad(schemaIndex + 1)}`,
  peak: connectionIndex === 4
})));
const regularCount = manifests.length - 1;
const regularTables = extraTableCount - peakTableCount;
const regularBytes = targetBytes - peakBytes - demoManifest.length;
const connections = {};
const sql = [];
const receipts = [];
let regularIndex = 0;

for (const { connection, schema, peak } of manifests) {
  const count = peak ? peakTableCount : Math.floor(regularTables / regularCount) + Number(regularIndex++ < regularTables % regularCount);
  const tables = Array.from({ length: count }, (_, index) => `${schema}_t${pad(index + 1, 3)}`);
  const budget = peak ? peakBytes : Math.round(regularBytes * count / regularTables);
  const headers = tables.map((table) => tableHeader(schema, table));
  const fixedBytes = Buffer.byteLength("tables:\n") + headers.reduce((bytes, header) => bytes + Buffer.byteLength(header), 0);
  const fieldCount = Math.round((budget - fixedBytes) / fieldByteLength);
  const fieldCounts = tables.map((_, index) => Math.floor(fieldCount / count) + Number(index < fieldCount % count));
  const yaml = "tables:\n" + headers.map((header, index) => header + Array.from(
    { length: fieldCounts[index] }, (_, fieldIndex) => manifestField(fieldIndex + 1)
  ).join("")).join("");
  const dir = path.join(output, "semantic-layer", connection);
  await mkdir(path.join(dir, "_schema"), { recursive: true });
  await writeFile(path.join(dir, "_schema", `${schema}.yaml`), yaml);
  receipts.push({ connection, schema, tables: count, columns: fieldCount + count, bytes: Buffer.byteLength(yaml), sha256: createHash("sha256").update(yaml).digest("hex") });

  connections[connection] ??= { driver: "mysql", host: "demo-db", port: 3306, database: schema, schemas: [], enabled_tables: [] };
  connections[connection].schemas.push(schema);
  connections[connection].enabled_tables.push(...tables.map((table) => `${schema}.${table}`));
  sql.push(`CREATE DATABASE IF NOT EXISTS \`${schema}\`;`, `GRANT SELECT ON \`${schema}\`.* TO 'lucy'@'%';`);
  tables.forEach((table, index) => {
    const fields = Array.from({ length: fieldCounts[index] }, (_, fieldIndex) => `${column(fieldIndex + 1)} INT NOT NULL DEFAULT 0`);
    sql.push(`CREATE TABLE IF NOT EXISTS \`${schema}\`.\`${table}\` (id INT NOT NULL PRIMARY KEY, ${fields.join(", ")});`);
  });
}

const oracle = { connection: "p175-width-01", schema: "p175w_01_01", table: "p175w_01_01_t001", count: 3 };
sql.push(`INSERT IGNORE INTO \`${oracle.schema}\`.\`${oracle.table}\` (id) VALUES (1), (2), (3);`);
await writeFile(path.join(output, "semantic-layer", oracle.connection, `${oracle.table}.yaml`), [
  `name: ${oracle.table}`,
  "grain: [id]",
  "measures:",
  "  - name: record_count",
  "    expr: count(distinct id)",
  "    description: Number of unique synthetic records.",
  ""
].join("\n"));

const summary = {
  baseline: { connection: "demo-mysql", manifestBytes: demoManifest.length, sourceCount: 3 },
  total: {
    connections: Object.keys(connections).length + 1,
    manifests: receipts.length + 1,
    sources: extraTableCount + 3,
    generatedColumns: receipts.reduce((sum, receipt) => sum + receipt.columns, 0),
    bytes: demoManifest.length + receipts.reduce((sum, receipt) => sum + receipt.bytes, 0),
    largestManifestBytes: Math.max(...receipts.map(({ bytes }) => bytes))
  },
  oracle,
  manifests: receipts
};
await Promise.all([
  writeFile(path.join(output, "connections.json"), JSON.stringify(connections, null, 2) + "\n"),
  writeFile(path.join(output, "mysql.sql"), sql.join("\n") + "\n"),
  writeFile(path.join(output, "manifest-summary.json"), JSON.stringify(summary, null, 2) + "\n")
]);
console.log(JSON.stringify(summary.total));
