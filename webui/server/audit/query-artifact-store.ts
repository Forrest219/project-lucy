import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "../project.js";
import { resolveWritable, assertReadable } from "../fs-safe.js";
import {
  decryptQueryArtifactPayload,
  encryptQueryArtifactPayload,
  isQueryArtifactEncryptionAvailable,
  resolveQueryArtifactKey,
  type QueryArtifactKind
} from "./query-artifact-crypto.js";

export type QueryArtifactRecord = {
  version: 1;
  ref: string;
  kind: QueryArtifactKind;
  tool: string;
  requestId: string;
  traceId?: string;
  queryHash: string;
  createdAt: string;
  alg: "aes-256-gcm";
  nonceB64: string;
  ciphertextB64: string;
  tagB64: string;
};

export type WriteQueryArtifactInput = {
  kind: QueryArtifactKind;
  tool: string;
  requestId: string | number;
  traceId?: string;
  plaintext: string;
  queryHash?: string;
};

const DEFAULT_REL_DIR = ".ktx-ui/audit-cold/query-artifacts";

export function coldArtifactsRelDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.LUCY_AUDIT_COLD_DIR?.trim();
  if (override) {
    // Allow absolute override outside project via direct fs; relative stays under project.
    if (path.isAbsolute(override)) return override;
    return override.replaceAll("\\", "/").replace(/\/+$/, "");
  }
  return DEFAULT_REL_DIR;
}

function artifactFileName(ref: string): string {
  return `${ref}.json`;
}

function buildRef(requestId: string, queryHash: string): string {
  const digest = createHash("sha256")
    .update(`${requestId}\0${queryHash}`)
    .digest("hex")
    .slice(0, 24);
  return `qa_${digest}`;
}

export async function writeQueryArtifact(
  input: WriteQueryArtifactInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ref: string; queryHash: string } | null> {
  const key = resolveQueryArtifactKey(env);
  if (!key) return null;
  const plaintext = input.plaintext?.trim();
  if (!plaintext) return null;

  const requestId = String(input.requestId);
  const queryHash =
    input.queryHash ?? createHash("sha256").update(plaintext).digest("hex");
  const ref = buildRef(requestId, queryHash);
  const sealed = encryptQueryArtifactPayload(plaintext, key);
  const record: QueryArtifactRecord = {
    version: 1,
    ref,
    kind: input.kind,
    tool: input.tool,
    requestId,
    traceId: input.traceId,
    queryHash,
    createdAt: new Date().toISOString(),
    alg: "aes-256-gcm",
    ...sealed
  };

  const projectRoot = await resolveProjectRoot();
  const relDir = coldArtifactsRelDir(env);
  if (path.isAbsolute(relDir)) {
    await mkdir(relDir, { recursive: true });
    await writeFile(path.join(relDir, artifactFileName(ref)), `${JSON.stringify(record)}\n`, "utf8");
  } else {
    const absDir = await resolveWritable(projectRoot, relDir);
    await mkdir(absDir, { recursive: true });
    const absFile = await resolveWritable(projectRoot, path.posix.join(relDir, artifactFileName(ref)));
    await writeFile(absFile, `${JSON.stringify(record)}\n`, "utf8");
  }
  return { ref, queryHash };
}

export async function readQueryArtifact(
  ref: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ record: QueryArtifactRecord; plaintext: string } | null> {
  const key = resolveQueryArtifactKey(env);
  if (!key) {
    const err = new Error("LUCY_AUDIT_QUERY_KEY is not configured") as Error & {
      code?: string;
      statusCode?: number;
    };
    err.code = "ERR_QUERY_ARTIFACT_KEY_MISSING";
    err.statusCode = 503;
    throw err;
  }
  if (!/^qa_[a-f0-9]{24}$/.test(ref)) return null;

  const projectRoot = await resolveProjectRoot();
  const relDir = coldArtifactsRelDir(env);
  let raw: string;
  try {
    if (path.isAbsolute(relDir)) {
      raw = await readFile(path.join(relDir, artifactFileName(ref)), "utf8");
    } else {
      const absFile = await assertReadable(projectRoot, path.posix.join(relDir, artifactFileName(ref)));
      raw = await readFile(absFile, "utf8");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  const record = JSON.parse(raw) as QueryArtifactRecord;
  if (record.version !== 1 || record.ref !== ref) return null;
  const plaintext = decryptQueryArtifactPayload(record, key);
  return { record, plaintext };
}

export function queryArtifactEncryptionEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return isQueryArtifactEncryptionAvailable(env);
}

export function hashQueryPlaintext(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}
