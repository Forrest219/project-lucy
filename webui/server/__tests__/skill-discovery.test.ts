import { mkdir, mkdtemp, rename, rm, symlink, utimes, writeFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readSkillDiscovery, skillDiscoveryMetrics, verifySkillDiscovery } from "../skills/discovery";

let beforeStat: ((file: string) => Promise<void> | undefined) | undefined;
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, lstat: async (file: string) => {
    await beforeStat?.(file);
    return fs.lstat(file);
  } };
});

let root: string;
let directory: string;
const markdown = (name: string, role = "analyst") => `---\nname: ${name}\nstatus: published\nroles_allowed: [${role}]\n---\nprivate body\n`;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "lucy-skill-discovery-"));
  directory = path.join(root, "skills", "operations");
  await mkdir(directory, { recursive: true });
});

afterEach(async () => {
  beforeStat = undefined;
  await rm(root, { recursive: true, force: true });
});

function read(metrics = skillDiscoveryMetrics()) {
  return readSkillDiscovery(path.join(root, "skills"), metrics);
}

it("merges concurrent refreshes and shares only immutable discovery facts", async () => {
  await writeFile(path.join(directory, "read.md"), markdown("read"));
  const first = skillDiscoveryMetrics();
  const join = skillDiscoveryMetrics();
  const [a, b] = await Promise.all([read(first), read(join)]);
  expect(a).toBe(b);
  expect(first).toMatchObject({ directories: 2, reads: 1, parses: 1 });
  expect(join).toMatchObject({ directories: 0, reads: 0, parses: 0, joins: 1 });
  expect(a.skills[0]).toMatchObject({ name: "read", roles_allowed: ["analyst"] });
  expect(a.skills[0]).not.toHaveProperty("content");
  expect(a.skills[0]).not.toHaveProperty("raw");
  expect(Object.isFrozen(a.skills[0].roles_allowed)).toBe(true);
  const warm = skillDiscoveryMetrics();
  expect(await read(warm)).toBe(a);
  expect(warm).toMatchObject({ directories: 0, reads: 0, parses: 0, checks: 3 });
});

it("merges a verification batch and checks again for a late arrival after revocation", async () => {
  const entry = path.join(directory, "read.md");
  const skillsRoot = path.join(root, "skills");
  await writeFile(entry, markdown("read"));
  const snapshot = await read();
  const first = skillDiscoveryMetrics();
  const join = skillDiscoveryMetrics();
  const firstCheck = verifySkillDiscovery(skillsRoot, snapshot, first);
  const joinedCheck = verifySkillDiscovery(skillsRoot, snapshot, join);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await rm(entry);
  const late = skillDiscoveryMetrics();
  expect(await verifySkillDiscovery(skillsRoot, snapshot, late)).toBe(false);
  expect(await firstCheck).toBe(await joinedCheck);
  expect(first.batches).toBe(1);
  expect(join).toMatchObject({ batches: 0, checks: 0, joins: 1 });
  expect(late.joins).toBe(0);
  expect((await read()).skills).toEqual([]);
});

it("keeps the next verification batch open while the previous refresh is reading", async () => {
  await writeFile(path.join(directory, "read.md"), markdown("read"));
  const skillsRoot = path.join(root, "skills");
  const snapshot = await read();
  let enter!: () => void;
  let resume!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const held = new Promise<void>((resolve) => { resume = resolve; });
  beforeStat = () => {
    beforeStat = undefined;
    enter();
    return held;
  };

  const older = read();
  await entered;
  const first = skillDiscoveryMetrics();
  const joined = skillDiscoveryMetrics();
  const earlierCheck = verifySkillDiscovery(skillsRoot, snapshot, first);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const laterCheck = verifySkillDiscovery(skillsRoot, snapshot, joined);
  resume();

  expect(await older).toBe(snapshot);
  expect(await Promise.all([earlierCheck, laterCheck])).toEqual([true, true]);
  expect(first).toMatchObject({ batches: 1, checks: 3 });
  expect(joined).toMatchObject({ batches: 0, checks: 0, joins: 1 });
});

it("rechecks an in-flight snapshot after ACL replacement, then drops a deleted file without reparsing peers", async () => {
  const entry = path.join(directory, "read.md");
  await writeFile(entry, markdown("read", "analyst"));
  await writeFile(path.join(directory, "keep.md"), markdown("keep"));
  const snapshot = await read();
  const replaced = path.join(directory, "replacement");
  const previous = await stat(entry);
  await writeFile(replaced, markdown("read", "manager"));
  await utimes(replaced, previous.atime, previous.mtime);
  await rename(replaced, entry);
  const changed = skillDiscoveryMetrics();
  const [current, oldIsCurrent] = await Promise.all([
    read(changed), verifySkillDiscovery(path.join(root, "skills"), snapshot)
  ]);
  expect(oldIsCurrent).toBe(false);
  expect(changed).toMatchObject({ reads: 1, parses: 1 });
  expect(current.skills.find((item) => item.name === "read")?.roles_allowed).toEqual(["manager"]);
  await rm(entry);
  const deleted = skillDiscoveryMetrics();
  expect((await read(deleted)).skills.map((item) => item.name)).toEqual(["keep"]);
  expect(deleted).toMatchObject({ reads: 0, parses: 0 });
});

it("discovers a newly added nested Skill and drops an existing entry replaced by a symlink", async () => {
  expect((await read()).skills).toEqual([]);
  const child = path.join(directory, "new");
  await mkdir(child);
  const file = path.join(child, "read.md");
  await writeFile(file, markdown("new"));
  expect((await read()).skills.map((item) => item.name)).toEqual(["new"]);
  const external = path.join(root, "external.md");
  await writeFile(external, markdown("outside"));
  await rm(file);
  await symlink(external, file);
  expect((await read()).skills).toEqual([]);
});
