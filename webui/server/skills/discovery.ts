import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { metaSignature } from "../display-revisions.js";
import { readContextFile } from "../fs-safe.js";
import { parseSkillMarkdown } from "./loader.js";
import type { SkillAsset } from "./types.js";

export type SkillDiscoveryAsset = Readonly<Pick<SkillAsset, "uri" | "name" | "title" | "description" | "status" | "roles_allowed_invalid">> & {
  readonly roles_allowed: readonly string[];
};

export type SkillDiscoveryMetrics = {
  scan_read: number;
  markdown_parse: number;
  directories: number;
  checks: number;
  reads: number;
  parses: number;
  joins: number;
  batches: number;
};

export function skillDiscoveryMetrics(): SkillDiscoveryMetrics {
  return { scan_read: 0, markdown_parse: 0, directories: 0, checks: 0, reads: 0, parses: 0, joins: 0, batches: 0 };
}

export type SkillDiscoverySnapshot = { readonly skills: readonly SkillDiscoveryAsset[] };
type CachedSkill = { signature: string; skill: SkillDiscoveryAsset | null };
type Inventory = {
  canonicalRoot: string | null;
  signatures: Map<string, string>;
  files: Map<string, CachedSkill>;
  snapshot: SkillDiscoverySnapshot;
};
type State = {
  root: string;
  inventory?: Inventory;
  pending?: Promise<SkillDiscoverySnapshot>;
  verification?: { snapshot: SkillDiscoverySnapshot; result: Promise<boolean> };
};

let active: State | undefined;
const STAT_BATCH_SIZE = 32;

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function inspect(file: string, metrics: SkillDiscoveryMetrics) {
  metrics.checks += 1;
  try {
    const info = await lstat(file);
    return { info, signature: `${info.dev}:${info.mode}:${metaSignature(info)}` };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function resolveRoot(root: string): Promise<string | null> {
  try {
    return await realpath(root);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function matchesInventory(inventory: Inventory, metrics: SkillDiscoveryMetrics): Promise<boolean> {
  const entries = [...inventory.signatures];
  for (let offset = 0; offset < entries.length; offset += STAT_BATCH_SIZE) {
    const matches = await Promise.all(entries.slice(offset, offset + STAT_BATCH_SIZE).map(async ([file, signature]) => (
      (await inspect(file, metrics))?.signature === signature
    )));
    if (matches.includes(false)) return false;
  }
  return true;
}

function discoveryFacts(asset: SkillAsset | null): SkillDiscoveryAsset | null {
  if (!asset) return null;
  const { name, uri, title, description, status, roles_allowed, roles_allowed_invalid } = asset;
  return Object.freeze({
    name, uri, title, description, status, roles_allowed_invalid,
    roles_allowed: Object.freeze(roles_allowed)
  });
}

async function rebuild(
  root: string | null,
  prior: Inventory | undefined,
  metrics: SkillDiscoveryMetrics
): Promise<Inventory> {
  const signatures = new Map<string, string>();
  const files = new Map<string, CachedSkill>();
  const skills: SkillDiscoveryAsset[] = [];
  async function visit(dir: string, canonicalRoot: string): Promise<void> {
    const directory = await inspect(dir, metrics);
    if (!directory?.info.isDirectory()) throw new Error("Skill directory changed during discovery");
    signatures.set(dir, directory.signature);
    metrics.directories += 1;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        await visit(file, canonicalRoot);
      }
      if (!entry.isFile() || !/\.md(?:arkdown)?$/.test(entry.name)) continue;
      const before = await inspect(file, metrics);
      if (!before?.info.isFile()) throw new Error("Skill file changed during discovery");
      signatures.set(file, before.signature);
      let parsed = prior?.files.get(file);
      if (parsed?.signature !== before.signature) {
        metrics.reads += 1;
        const { content } = await readContextFile(canonicalRoot, path.relative(canonicalRoot, file));
        if ((await inspect(file, metrics))?.signature !== before.signature) {
          throw new Error("Skill file changed while reading discovery metadata");
        }
        const start = performance.now();
        metrics.parses += 1;
        const skill = discoveryFacts(parseSkillMarkdown(content, file, path.dirname(canonicalRoot)));
        metrics.markdown_parse += performance.now() - start;
        parsed = { signature: before.signature, skill };
      }
      files.set(file, parsed);
      if (parsed.skill) skills.push(parsed.skill);
    }
    if ((await inspect(dir, metrics))?.signature !== directory.signature) {
      throw new Error("Skill directory changed while listing discovery metadata");
    }
  }
  if (root) await visit(root, root);
  return { canonicalRoot: root, signatures, files, snapshot: Object.freeze({ skills: Object.freeze(skills) }) };
}

function stateFor(root: string): State {
  if (active?.root !== root) active = { root };
  return active;
}

function refresh(state: State, metrics: SkillDiscoveryMetrics): Promise<SkillDiscoverySnapshot> {
  if (state.pending) {
    metrics.joins += 1;
    return state.pending;
  }
  const prior = state.inventory;
  metrics.batches += 1;
  const start = performance.now();
  const parsingAtStart = metrics.markdown_parse;
  state.pending = (async () => {
    const root = await resolveRoot(state.root);
    if (prior && prior.canonicalRoot === root && await matchesInventory(prior, metrics)) return prior.snapshot;
    const next = await rebuild(root, prior, metrics);
    state.inventory = next;
    return next.snapshot;
  })().finally(() => {
    metrics.scan_read += performance.now() - start - (metrics.markdown_parse - parsingAtStart);
    state.pending = undefined;
  });
  return state.pending;
}

/** Share filesystem work and body-free metadata. Authorization remains request-local. */
export function readSkillDiscovery(root: string, metrics: SkillDiscoveryMetrics): Promise<SkillDiscoverySnapshot> {
  return refresh(stateFor(root), metrics);
}

/** Fence responses with a shared check started after every admitted waiter built its instructions. */
export async function verifySkillDiscovery(
  root: string,
  snapshot: SkillDiscoverySnapshot,
  metrics = skillDiscoveryMetrics()
): Promise<boolean> {
  const state = stateFor(root);
  if (state.inventory?.snapshot !== snapshot) return false;
  if (state.verification?.snapshot === snapshot) {
    metrics.joins += 1;
    return state.verification.result;
  }
  const result = new Promise<void>((resolve) => setImmediate(resolve)).then(async () => {
    // Keep admitting waiters while an older scan drains. Seal this batch just before starting its own scan.
    while (state.pending) await state.pending;
    if (state.verification?.result === result) state.verification = undefined;
    if (active !== state || state.inventory?.snapshot !== snapshot) return false;
    return await refresh(state, metrics) === snapshot && active === state;
  }).finally(() => {
    if (state.verification?.result === result) state.verification = undefined;
  });
  state.verification = { snapshot, result };
  return result;
}
