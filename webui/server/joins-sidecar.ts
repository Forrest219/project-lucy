import { readFile } from "node:fs/promises";
import { assertReadable, safeWrite } from "./fs-safe";
import type { Join } from "./model";

export type JoinCandidate = {
  conn: string;
  schema: string;
  fromTable: string;
  join: Join;
  confidence: "candidate" | "rejected";
  note?: string;
};

export type JoinCandidatesFile = {
  version: 1;
  candidates: JoinCandidate[];
};

const REL_PATH = ".ktx-ui/join-candidates.json";

function emptySidecar(): JoinCandidatesFile {
  return { version: 1, candidates: [] };
}

function normalize(value: unknown): JoinCandidatesFile {
  if (!value || typeof value !== "object" || !Array.isArray((value as { candidates?: unknown }).candidates)) {
    return emptySidecar();
  }
  const candidates = (value as { candidates: unknown[] }).candidates.filter((item): item is JoinCandidate => {
    if (!item || typeof item !== "object") return false;
    const record = item as Partial<JoinCandidate>;
    return typeof record.conn === "string" && typeof record.schema === "string" && typeof record.fromTable === "string" && Boolean(record.join);
  });
  return { version: 1, candidates };
}

export async function readJoinCandidates(projectRoot: string): Promise<JoinCandidatesFile> {
  try {
    const text = await readFile(await assertReadable(projectRoot, REL_PATH), "utf8");
    return normalize(JSON.parse(text));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptySidecar();
    }
    throw error;
  }
}

export async function writeJoinCandidates(projectRoot: string, candidates: JoinCandidate[]): Promise<JoinCandidatesFile> {
  const sidecar: JoinCandidatesFile = { version: 1, candidates };
  await safeWrite(projectRoot, REL_PATH, `${JSON.stringify(sidecar, null, 2)}\n`);
  return sidecar;
}

export function joinCandidatesPath(): string {
  return REL_PATH;
}
