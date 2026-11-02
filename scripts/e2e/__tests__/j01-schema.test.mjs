import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { journeySchemaName } from "../lib/j01-schema.mjs";

describe("J01-02 run-scoped schema", () => {
  it("does not reuse the fixture schema", () => {
    const name = journeySchemaName("Run-2026-11-01");
    assert.equal(name, "j25_run_2026_11_01");
    assert.notEqual(name, "analytics");
  });

  it("SC-10 uses journeySchemaName for the wizard and does not close the 2026-10-25 schema choice", () => {
    // Passing this assertion does not close the 2026-10-25 report §5.2 PM choice,
    // does not re-verify that trial, and does not check the seed or dataset digest.
    const name = journeySchemaName("local-run");
    assert.equal(name, "j25_local_run");
    assert.notEqual(name, "analytics");
    const schema = readFileSync(new URL("../lib/j01-schema.mjs", import.meta.url), "utf8");
    const spec = readFileSync(new URL("../../../webui/tests/real-e2e/journey-v025.spec.ts", import.meta.url), "utf8");
    const wizard = readFileSync(new URL("../../../webui/tests/real-e2e/helpers/journey-v025.ts", import.meta.url), "utf8");
    assert.match(schema, /const schema = journeySchemaName\(run\.runId\)/);
    assert.match(spec, /const schema = await provisionJourneySchema/);
    assert.match(wizard, /connectionSchemas\)\.fill\(params\.schema\)/);
  });
});
