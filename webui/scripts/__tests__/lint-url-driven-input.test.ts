// @vitest-environment node
//
// Unit tests for the URL-driven controlled-input gate.
//
// Spec: docs/specs/lucy-20261029-url-driven-input-ime-composition-spec.md
//   §5.1 判定算法, §5.5 门禁语义, §6.2 SC-15 / SC-16.
//
// The gate's judgement is about where a controlled text input's `value`
// comes from — NOT about whether `onChange` writes the URL. These tests pin
// the four judgement categories the spec requires (SC-16) plus the
// zero-false-positive samples of SC-15.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectTextInputs,
  collectUrlDerivedVars,
  isUrlDriven,
  scanFileContent
} from "../lint-url-driven-input.mjs";

const webuiRoot = path.resolve(import.meta.dirname, "..", "..");

function defectsIn(source: string): Array<{ line: number; label: string }> {
  return scanFileContent(source, "fixture.tsx").map((issue) => ({
    line: issue.line,
    label: issue.label
  }));
}

describe("lint-url-driven-input: URL-derived variable detection", () => {
  it("treats a useSearchParams-derived local constant as URL-derived", () => {
    const seeds = collectUrlDerivedVars(
      `const user = searchParams.get("user") ?? "";\n`
    );
    expect(seeds.has("user")).toBe(true);
  });

  it("treats a useParams destructure as URL-derived", () => {
    const seeds = collectUrlDerivedVars(`const { roleId } = useParams();\n`);
    expect(seeds.has("roleId")).toBe(true);
  });

  it("follows the transitive closure over local constants", () => {
    const seeds = collectUrlDerivedVars(
      [
        `const keySearch = searchParams.get("key") ?? "";`,
        `const turnSearch = searchParams.get("turnSearch") ?? "";`,
        `const tableSearch = searchParams.get("tableSearch") ?? "";`,
        `const unifiedSearchValue = keySearch || (tab === "turns" ? turnSearch : tableSearch);`
      ].join("\n")
    );
    expect(seeds.has("unifiedSearchValue")).toBe(true);
  });

  it("does not follow a constant that only embeds the seed in an API call", () => {
    // `data` here is a server response, not the URL's text. Following it
    // would drag every derived local into the seed set (false positives).
    const seeds = collectUrlDerivedVars(
      [
        `const { userId } = useParams();`,
        `const data = await apiPatch(\`/api/admin/agents/\${userId}\`, {});`,
        `const agent = data?.agent;`
      ].join("\n")
    );
    expect(seeds.has("userId")).toBe(true);
    expect(seeds.has("data")).toBe(false);
    expect(seeds.has("agent")).toBe(false);
  });
});

describe("lint-url-driven-input: judgement categories (SC-16)", () => {
  it("flags a controlled text input whose value comes from the URL", () => {
    const defects = defectsIn(
      [
        `export function Page() {`,
        `  const [searchParams] = useSearchParams();`,
        `  const user = searchParams.get("user") ?? "";`,
        `  return (`,
        `    <input`,
        `      aria-label="按 Agent 名称或 ID 筛选"`,
        `      value={user}`,
        `      onChange={(e) => setSearchParams(next)}`,
        `    />`,
        `  );`,
        `}`
      ].join("\n")
    );
    expect(defects).toHaveLength(1);
    expect(defects[0].label).toBe("按 Agent 名称或 ID 筛选");
  });

  it("does not flag a controlled text input driven by local state", () => {
    const defects = defectsIn(
      [
        `export function Page() {`,
        `  const [searchParams, setSearchParams] = useSearchParams();`,
        `  const [draft, setDraft] = useState("");`,
        `  return (`,
        `    <input`,
        `      aria-label="搜索"`,
        `      value={draft}`,
        `      onChange={(e) => { setDraft(e.target.value); setSearchParams(next); }}`,
        `    />`,
        `  );`,
        `}`
      ].join("\n")
    );
    expect(defects).toHaveLength(0);
  });

  it("does not flag useState(searchParams.get(...)) — the controlled source is local", () => {
    const defects = defectsIn(
      [
        `export function Page() {`,
        `  const [searchParams] = useSearchParams();`,
        `  const [turnId, setTurnId] = useState(searchParams.get("turnId") ?? "");`,
        `  return (`,
        `    <input`,
        `      aria-label="问询 ID"`,
        `      value={turnId}`,
        `      onChange={(e) => setTurnId(e.target.value)}`,
        `    />`,
        `  );`,
        `}`
      ].join("\n")
    );
    expect(defects).toHaveLength(0);
  });

  it("does not flag non-text inputs — they host no IME composition", () => {
    const defects = defectsIn(
      [
        `export function Page() {`,
        `  const [searchParams] = useSearchParams();`,
        `  const outcome = searchParams.get("outcome") ?? "";`,
        `  const since = searchParams.get("since") ?? "";`,
        `  return (`,
        `    <>`,
        `      <select aria-label="结果状态" value={outcome} onChange={onChange} />`,
        `      <input type="checkbox" aria-label="显示协议调用" checked={includeProtocol} />`,
        `      <input type="datetime-local" aria-label="开始时间" value={since} />`,
        `      <input type="date" aria-label="快照日期" value={since} />`,
        `      <input type="radio" aria-label="全部" value={outcome} />`,
        `    </>`,
        `  );`,
        `}`
      ].join("\n")
    );
    expect(defects).toHaveLength(0);
  });

  it("flags a select-shaped value only when it is a text input", () => {
    // `type="search"` IS a text input — the Token page uses it.
    const defects = defectsIn(
      [
        `export function Page() {`,
        `  const [searchParams] = useSearchParams();`,
        `  const search = searchParams.get("search") ?? "";`,
        `  return <input type="search" aria-label="搜索 Token" value={search} />;`,
        `}`
      ].join("\n")
    );
    expect(defects).toHaveLength(1);
    expect(defects[0].label).toBe("搜索 Token");
  });

  it("does not flag a local state property that shares a name with a route local", () => {
    const defects = defectsIn(
      [
        `export function Page() {`,
        `  const { roleId: routeRoleId } = useParams();`,
        `  const roleId = routeRoleId ?? "";`,
        `  const [draft, setDraft] = useState({ roleId: "" });`,
        `  return <input aria-label="角色标识" value={draft.roleId} />;`,
        `}`
      ].join("\n")
    );
    expect(defects).toHaveLength(0);
  });
});

describe("lint-url-driven-input: text input collection", () => {
  it("skips the non-text input types listed by the spec", () => {
    const inputs = collectTextInputs(
      [
        `<input type="checkbox" value={a} />`,
        `<input type="hidden" value={a} />`,
        `<input type="range" value={a} />`,
        `<input type="file" value={a} />`,
        `<input type="datetime-local" value={a} />`,
        `<input type="time" value={a} />`,
        `<input type="text" value={a} />`,
        `<input value={a} />`,
        `<textarea value={a} />`
      ].join("\n")
    );
    expect(inputs).toHaveLength(3);
  });

  it("records the value expression and a readable label", () => {
    const inputs = collectTextInputs(
      `<input placeholder="工具名" value={tool} onChange={x} />`
    );
    expect(inputs[0].valueExpr).toBe("tool");
    expect(inputs[0].label).toBe("工具名");
  });

  it("treats a static value prop as not URL-driven", () => {
    const inputs = collectTextInputs(`<input aria-label="固定" value="fixed" />`);
    expect(inputs[0].valueExpr).toBeNull();
    expect(isUrlDriven(inputs[0], new Set(["fixed"]))).toBe(false);
  });
});

describe("lint-url-driven-input: zero false positives on known-good pages (SC-15)", () => {
  const samples = [
    "pages/HelpCenter.tsx",
    "pages/admin/AgentList.tsx",
    "pages/admin/RoleList.tsx",
    "pages/skills/SkillList.tsx",
    "pages/admin/AccessMap.tsx"
  ];

  for (const relative of samples) {
    it(`reports no defect in ${relative}`, () => {
      const file = path.join(webuiRoot, "src", relative);
      const content = readFileSync(file, "utf8");
      expect(scanFileContent(content, file)).toEqual([]);
    });
  }
});
