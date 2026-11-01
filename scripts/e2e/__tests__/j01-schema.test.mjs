import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { journeySchemaName } from "../lib/j01-schema.mjs";

describe("J01-02 run-scoped schema", () => {
  it("does not reuse the fixture schema", () => {
    const name = journeySchemaName("Run-2026-11-01");
    assert.equal(name, "j25_run_2026_11_01");
    assert.notEqual(name, "analytics");
  });
});
