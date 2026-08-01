// @vitest-environment node

import { describe, expect, it } from "vitest";

// @ts-ignore lint fixture imports the script directly without generated declarations.
import { RULE_IDS, scanText } from "../../scripts/lint-ia-boundary.mjs";

describe("lint-ia-boundary.mjs", () => {
  it("flags a bare upload YAML action in the connection module", () => {
    const issues = scanText(
      "/repo/webui/src/pages/connections/ConnectionOverview.tsx",
      `<button>上传 YAML</button>`
    );

    expect(issues.map((issue: { ruleId: string }) => issue.ruleId)).toContain(RULE_IDS.CONNECTION_BARE_UPLOAD_YAML);
  });

  it("allows a typed Manifest upload action in the connection module", () => {
    const issues = scanText(
      "/repo/webui/src/pages/connections/ConnectionOverview.tsx",
      `<button>上传 Manifest</button>`
    );

    expect(issues).toEqual([]);
  });

  it("flags semantic modeling actions in the connection module", () => {
    const issues = scanText(
      "/repo/webui/src/pages/connections/ConnectionOverview.tsx",
      `<button>新增指标</button>`
    );

    expect(issues.map((issue: { ruleId: string }) => issue.ruleId)).toContain(
      RULE_IDS.CONNECTION_SEMANTIC_MODELING_ACTION
    );
  });

  it("flags connection onboarding actions in TableEditor", () => {
    const issues = scanText("/repo/webui/src/pages/TableEditor.tsx", `<button>添加 Schema</button>`);

    expect(issues.map((issue: { ruleId: string }) => issue.ruleId)).toContain(
      RULE_IDS.SEMANTIC_LAYER_CONNECTION_ACTION
    );
  });

  it("allows documentation that types YAML upload assets", () => {
    const issues = scanText(
      "/repo/webui/docs/example.md",
      `上传 YAML 资产：Schema Manifest 或 semantic overlay。`
    );

    expect(issues).toEqual([]);
  });
});
