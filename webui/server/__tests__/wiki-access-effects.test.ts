import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildWikiAccessSummary,
  classifyAccessDirection,
  loadWikiAccessConfigSnapshot,
  resolveWikiAccessEffects,
  sameCanonicalAcl,
  canonicalAclKey,
  type WikiAccessConfigSnapshot
} from "../wiki-access-effects";
import { parseObjectAcl, type ObjectAcl } from "../proxy/context-acl";

/**
 * Spec 193 §4.2 / §4.3 / §10.1 — the Wiki → Role effect projection.
 *
 * Synthetic Roles and Agents only: the temporary project root owns its own
 * `webui/config/access.yaml`, so the real repository configuration is never
 * read or written.
 */

let projectRoot: string;
let prevRoot: string | undefined;

const ACCESS_YAML = `
roles:
  finance:
    description: search + read
    allow:
      tools:
        - wiki_search
        - wiki_read
  ops:
    description: search only
    allow:
      tools:
        - wiki_search
  support:
    description: read only
    allow:
      tools:
        - wiki_read
  auditor:
    description: no wiki channel
    allow:
      tools:
        - lucy_skill_search
  template-role:
    description: a reference template without an allow block
users:
  - id: agent-a
    name: Agent A
    enabled: true
    roles:
      - finance
  - id: agent-b
    name: Agent B
    enabled: true
    roles:
      - finance
      - ops
  - id: agent-disabled
    name: Disabled Agent
    enabled: false
    roles:
      - finance
  - id: agent-no-role
    name: Agent Without Role
    enabled: true
  - id: agent-unknown-role
    name: Agent On A Non Formal Role
    enabled: true
    roles:
      - ghost-role
`;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-wiki-effects-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(path.join(projectRoot, "wiki", "global"), { recursive: true });
  await mkdir(path.join(projectRoot, ".ktx-ui"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  prevRoot = process.env.KTX_PROJECT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
});

afterEach(async () => {
  if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = prevRoot;
  await rm(projectRoot, { recursive: true, force: true });
});

async function snapshot(): Promise<WikiAccessConfigSnapshot> {
  return loadWikiAccessConfigSnapshot(projectRoot);
}

describe("Spec 193 §4.2 — the declared authorization and the channel effect are two different facts", () => {
  it("projects none / exact roles / all roles / a corrupt ACL", async () => {
    const snap = await snapshot();

    const none = resolveWikiAccessEffects({ state: "missing" }, snap);
    expect(none.declared_role_count).toBe(0);
    expect(none.role_effects).toEqual([]);
    expect(none.declared_without_discover).toBe(0);
    expect(none.declared_without_read).toBe(0);

    const empty = resolveWikiAccessEffects({ state: "empty" }, snap);
    expect(empty.declared_role_count).toBe(0);
    expect(empty.role_effects).toEqual([]);

    const exact = resolveWikiAccessEffects({ state: "roles", roles: ["finance"] }, snap);
    expect(exact.declared_role_count).toBe(1);
    expect(exact.role_effects).toHaveLength(1);
    expect(exact.role_effects[0]?.role_id).toBe("finance");

    const all = resolveWikiAccessEffects({ state: "all" }, snap);
    // `all` expands over the FORMAL roles only: a role without an `allow`
    // block is a reference template, not an assignable Role.
    expect(all.declared_role_count).toBeNull();
    expect(all.role_effects.map((effect) => effect.role_id)).toEqual([
      "auditor",
      "finance",
      "ops",
      "support"
    ]);

    const corrupt = resolveWikiAccessEffects({ state: "corrupt", detail: "wildcard_mixed" }, snap);
    expect(corrupt.declared_role_count).toBeNull();
    expect(corrupt.role_effects).toEqual([]);
  });

  it("keeps an unknown Role id but gives it no channel and no Agent", async () => {
    const snap = await snapshot();
    const effects = resolveWikiAccessEffects({ state: "roles", roles: ["finance", "ghost-role"] }, snap);

    expect(effects.declared_role_count).toBe(2);
    const unknown = effects.role_effects.find((effect) => effect.role_id === "ghost-role");
    expect(unknown).toBeTruthy();
    expect(unknown?.known).toBe(false);
    expect(unknown?.discover_enabled).toBe(false);
    expect(unknown?.read_enabled).toBe(false);
    expect(unknown?.assigned_agent_count).toBe(0);
    expect(unknown?.assigned_agent_ids).toEqual([]);

    const known = effects.role_effects.find((effect) => effect.role_id === "finance");
    expect(known?.known).toBe(true);
  });

  it("distinguishes search+read, search only, read only and neither", async () => {
    const snap = await snapshot();
    const effects = resolveWikiAccessEffects(
      { state: "roles", roles: ["finance", "ops", "support", "auditor"] },
      snap
    );
    const byRole = new Map(effects.role_effects.map((effect) => [effect.role_id, effect]));

    expect(byRole.get("finance")).toMatchObject({
      discover_enabled: true,
      read_enabled: true
    });
    expect(byRole.get("ops")).toMatchObject({ discover_enabled: true, read_enabled: false });
    expect(byRole.get("support")).toMatchObject({ discover_enabled: false, read_enabled: true });
    expect(byRole.get("auditor")).toMatchObject({ discover_enabled: false, read_enabled: false });

    // "neither" is still DECLARED authorization — it is counted as a declared
    // Role without a channel, not as "nobody is authorized".
    expect(effects.declared_role_count).toBe(4);
    expect(effects.declared_without_discover).toBe(2);
    expect(effects.declared_without_read).toBe(2);
  });

  it("counts only enabled Agents that really bind the formal Role", async () => {
    const snap = await snapshot();
    const effects = resolveWikiAccessEffects({ state: "roles", roles: ["finance"] }, snap);
    const finance = effects.role_effects[0];

    // agent-a and agent-b are enabled and bind `finance`; agent-disabled is
    // disabled; agent-unknown-role binds a non-formal role.
    expect(finance?.assigned_agent_count).toBe(2);
    expect(finance?.assigned_agent_ids).toEqual(["agent-a", "agent-b"]);

    const ops = resolveWikiAccessEffects({ state: "roles", roles: ["ops"] }, snap).role_effects[0];
    expect(ops?.assigned_agent_count).toBe(1);
    expect(ops?.assigned_agent_ids).toEqual(["agent-b"]);

    const auditor = resolveWikiAccessEffects({ state: "roles", roles: ["auditor"] }, snap).role_effects[0];
    expect(auditor?.assigned_agent_count).toBe(0);
    expect(auditor?.assigned_agent_ids).toEqual([]);
  });

  it("sorts deterministically and produces a stable global role_channel_version", async () => {
    const first = await snapshot();
    const second = await snapshot();

    expect(first.role_channel_version).toBe(second.role_channel_version);
    expect(first.role_channel_version).toMatch(/^rcv-[0-9a-f]{32}$/);

    const effects = resolveWikiAccessEffects(
      { state: "roles", roles: ["support", "finance", "ops"] },
      first
    );
    expect(effects.role_effects.map((effect) => effect.role_id)).toEqual(["finance", "ops", "support"]);
  });

  it("changes the role_channel_version when a Role channel or an Agent binding changes", async () => {
    const before = await snapshot();

    // `finance` loses its `wiki_read` channel.
    await writeFile(
      path.join(projectRoot, "webui", "config", "access.yaml"),
      ACCESS_YAML.replace(
        "        - wiki_search\n        - wiki_read\n  ops:",
        "        - wiki_search\n  ops:"
      ),
      "utf8"
    );
    const afterChannelChange = await snapshot();
    expect(afterChannelChange.role_channel_version).not.toBe(before.role_channel_version);

    await writeFile(
      path.join(projectRoot, "webui", "config", "access.yaml"),
      ACCESS_YAML.replace("  - id: agent-a\n    name: Agent A\n    enabled: true", "  - id: agent-a\n    name: Agent A\n    enabled: false"),
      "utf8"
    );
    const afterBindingChange = await snapshot();
    expect(afterBindingChange.role_channel_version).not.toBe(before.role_channel_version);
  });

  it("never leaks a token, a body or a credential field", async () => {
    const snap = await snapshot();
    const summary = buildWikiAccessSummary({
      key: "global/effects.md",
      file_version: "sha256:abc",
      acl: { state: "roles", roles: ["finance"] },
      snapshot: snap
    });

    expect(Object.keys(summary).sort()).toEqual([
      "acl",
      "declared_role_count",
      "declared_without_discover",
      "declared_without_read",
      "file_version",
      "key",
      "role_channel_version",
      "role_effects"
    ]);
    const serialized = JSON.stringify(summary);
    for (const forbidden of ["token", "body", "content", "secret", "password", "credential", "session"]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
    for (const effect of summary.role_effects) {
      expect(Object.keys(effect).sort()).toEqual([
        "assigned_agent_count",
        "assigned_agent_ids",
        "discover_enabled",
        "known",
        "read_enabled",
        "role_id"
      ]);
    }
  });
});

describe("Spec 193 §4.3 — the authorization change direction", () => {
  const cases: Array<[string, ObjectAcl, ObjectAcl, string]> = [
    ["identical roles are neutral", { state: "roles", roles: ["a"] }, { state: "roles", roles: ["a"] }, "neutral"],
    ["the same roles in another order are neutral", { state: "roles", roles: ["a", "b"] }, { state: "roles", roles: ["b", "a"] }, "neutral"],
    ["missing → missing is neutral", { state: "missing" }, { state: "missing" }, "neutral"],
    ["empty → empty is neutral", { state: "empty" }, { state: "empty" }, "neutral"],
    ["all → all is neutral", { state: "all" }, { state: "all" }, "neutral"],
    ["a strict subset narrows", { state: "roles", roles: ["a", "b"] }, { state: "roles", roles: ["a"] }, "narrow"],
    ["all → roles narrows", { state: "all" }, { state: "roles", roles: ["a"] }, "narrow"],
    ["a superset widens", { state: "roles", roles: ["a"] }, { state: "roles", roles: ["a", "b"] }, "widen"],
    ["a mixed add + remove widens", { state: "roles", roles: ["a", "b"] }, { state: "roles", roles: ["b", "c"] }, "widen"],
    ["roles → all widens", { state: "roles", roles: ["a"] }, { state: "all" }, "widen"],
    ["missing → roles widens", { state: "missing" }, { state: "roles", roles: ["a"] }, "widen"],
    ["empty → roles widens", { state: "empty" }, { state: "roles", roles: ["a"] }, "widen"],
    ["corrupt → non-empty widens", { state: "corrupt", detail: "wildcard_mixed" }, { state: "roles", roles: ["a"] }, "widen"],
    ["all → empty narrows", { state: "all" }, { state: "empty" }, "narrow"],
    ["missing → all widens", { state: "missing" }, { state: "all" }, "widen"],
    ["corrupt → corrupt is neutral", { state: "corrupt", detail: "not_an_array" }, { state: "corrupt", detail: "not_an_array" }, "neutral"]
  ];

  it.each(cases)("%s", (_label, current, next, expected) => {
    expect(classifyAccessDirection(current, next)).toBe(expected);
  });

  it("classifies a narrowing to \"nobody\" as a narrowing", () => {
    // Spec 193 §4.3: "new is a strict subset of old → narrow", and
    // `runtimeSet(missing | empty | corrupt) = {}` is a strict subset of `{a}`.
    // A narrowing must NOT be parked in `needs_review` by the crash recovery,
    // so the direction has to be exact here.
    expect(classifyAccessDirection({ state: "roles", roles: ["a"] }, { state: "empty" })).toBe("narrow");
    expect(classifyAccessDirection({ state: "roles", roles: ["a"] }, { state: "missing" })).toBe("narrow");
    expect(classifyAccessDirection({ state: "roles", roles: ["a"] }, { state: "corrupt", detail: "x" })).toBe("narrow");
    // `all` → `missing` is the universe narrowed to nobody.
    expect(classifyAccessDirection({ state: "all" }, { state: "missing" })).toBe("narrow");
    // A corrupt declaration grants nobody, so repairing it to nobody is neutral
    // and repairing it to any non-empty set is a widening.
    expect(classifyAccessDirection({ state: "corrupt", detail: "x" }, { state: "empty" })).toBe("neutral");
    expect(classifyAccessDirection({ state: "corrupt", detail: "x" }, { state: "roles", roles: ["a"] })).toBe("widen");
  });

  it("compares the normalized runtime set, not the YAML text or the Role order", () => {
    const fromYaml = parseObjectAcl(["b", "a"], true);
    const toYaml = parseObjectAcl(["a"], true);
    expect(classifyAccessDirection(fromYaml, toYaml)).toBe("narrow");
    expect(canonicalAclKey(fromYaml)).toBe("roles:a,b");
    expect(canonicalAclKey(toYaml)).toBe("roles:a");
    expect(sameCanonicalAcl(fromYaml, toYaml)).toBe(false);
    expect(sameCanonicalAcl({ state: "roles", roles: ["a", "b"] }, { state: "roles", roles: ["b", "a"] })).toBe(true);
  });
});
