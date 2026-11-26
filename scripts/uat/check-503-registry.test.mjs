import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { find503Windows, reconcile, registeredCodes } from "./check-503-registry.mjs";

const SCRIPT = fileURLToPath(new URL("./check-503-registry.mjs", import.meta.url));
const SPEC = `# x\n## 附录 A 503 原因登记表\n| 原因 | 类 |\n|---|---|\n| \`DISPLAY_SNAPSHOT_BUSY\`／\`write_pending\` | B |\n| \`SERVICE_DRAINING\` | B |\n\n## 受影响画像\n| \`NOT_IN_APPENDIX\` |\n`;

test("registeredCodes only reads appendix A", () => {
  const codes = registeredCodes(SPEC);
  assert.ok(codes.has("DISPLAY_SNAPSHOT_BUSY") && codes.has("write_pending") && codes.has("SERVICE_DRAINING"));
  assert.equal(codes.has("NOT_IN_APPENDIX"), false);
});

test("find503Windows picks error-code literals near a 503 and skips comments", () => {
  const src = ["// returns 503 SOMETHING_ELSE", "reply.status(503).send({ error: { code: 'MYSTERY_FAILURE' } });", "const ok = 200;"].join("\n");
  const hits = find503Windows(src);
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].codes, ["MYSTERY_FAILURE"]);
});

test("reconcile reports an unregistered 503 code and passes registered ones", () => {
  const files = [
    { file: "a.ts", source: "reply.status(503).send({ code: 'SERVICE_DRAINING' });" },
    { file: "b.ts", source: "reply.status(503).send({ code: 'BRAND_NEW_503' });" }
  ];
  const res = reconcile({ specText: SPEC, files });
  assert.equal(res.windows, 2);
  assert.deepEqual(res.unregistered, [{ file: "b.ts", line: 1, codes: ["BRAND_NEW_503"] }]);
});

test("CLI runs against the repo spec; --strict exits non-zero only when something is unregistered", () => {
  const lenient = spawnSync(process.execPath, [SCRIPT, "--json"], { encoding: "utf8" });
  assert.equal(lenient.status, 0, lenient.stderr);
  const report = JSON.parse(lenient.stdout);
  assert.ok(report.windows > 0 && report.registered > 0);
  const strict = spawnSync(process.execPath, [SCRIPT, "--strict", "--json"], { encoding: "utf8" });
  assert.equal(strict.status, report.unregistered.length ? 1 : 0);
});
