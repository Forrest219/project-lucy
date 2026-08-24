import { describe, expect, it } from "vitest";
import { sanitizeSemanticSourceYaml, stripManifestOnlyColumnKeys } from "../semantic-overlay-sanitize";

describe("semantic overlay sanitize", () => {
  it("strips pk/nullable from column objects", () => {
    const { columns, strippedKeys } = stripManifestOnlyColumnKeys([
      { name: "id", type: "number", pk: true, nullable: false },
      { name: "label", type: "string", nullable: true, descriptions: { ai: "Label" } }
    ]);
    expect(strippedKeys.sort()).toEqual(["nullable", "pk"]);
    expect(columns).toEqual([
      { name: "id", type: "number" },
      { name: "label", type: "string", descriptions: { ai: "Label" } }
    ]);
  });

  it("sanitizes overlay YAML but leaves schema manifests untouched", () => {
    const overlay = `name: demo_source
table: chatbi.demo
columns:
  - name: id
    type: number
    pk: true
    nullable: false
`;
    const sanitized = sanitizeSemanticSourceYaml(overlay);
    expect(sanitized.stripped).toBe(true);
    expect(sanitized.strippedKeys.sort()).toEqual(["nullable", "pk"]);
    expect(sanitized.text).toContain("name: demo_source");
    expect(sanitized.text).not.toContain("pk:");
    expect(sanitized.text).not.toContain("nullable:");

    const manifest = `tables:
  demo_source:
    table: chatbi.demo
    columns:
      - name: id
        type: number
        pk: true
        nullable: false
`;
    const leftAlone = sanitizeSemanticSourceYaml(manifest);
    expect(leftAlone.stripped).toBe(false);
    expect(leftAlone.text).toContain("nullable: false");
  });
});
