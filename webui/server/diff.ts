import { execFile } from "node:child_process";
import { createTwoFilesPatch } from "diff";

export function previewDiff(oldText: string, newText: string, filePath: string): string {
  if (oldText === newText) {
    return "";
  }
  return createTwoFilesPatch(filePath, filePath, oldText, newText, "current", "proposed", {
    context: 3
  });
}

export type FileDiff = {
  filePath: string;
  status: string;
  diff: string;
};

export type SessionWrittenFile = {
  filePath: string;
};

const REVIEW_PATHS = ["semantic-layer", "wiki", ".ktx-ui"];

function isReviewPath(filePath: string): boolean {
  return REVIEW_PATHS.some((prefix) => filePath === prefix || filePath.startsWith(`${prefix}/`));
}

function execGit(projectRoot: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: projectRoot, timeout: 30_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

async function gitPatch(projectRoot: string, filePath: string): Promise<string> {
  try {
    const { stdout } = await execGit(projectRoot, ["diff", "--", filePath]);
    return stdout;
  } catch {
    return "";
  }
}

export async function changedFiles(projectRoot: string, fallback: SessionWrittenFile[] = []): Promise<FileDiff[]> {
  const files = new Map<string, FileDiff>();

  try {
    const { stdout } = await execGit(projectRoot, ["diff", "--name-status", "--", ...REVIEW_PATHS]);
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const [status, filePath] = trimmed.split(/\s+/, 2);
      if (!filePath || !isReviewPath(filePath)) {
        continue;
      }
      files.set(filePath, {
        filePath,
        status,
        diff: await gitPatch(projectRoot, filePath)
      });
    }
  } catch {
    // Non-git projects fall through to the session-written file fallback.
  }

  for (const item of fallback) {
    if (!files.has(item.filePath) && isReviewPath(item.filePath)) {
      files.set(item.filePath, {
        filePath: item.filePath,
        status: "W",
        diff: ""
      });
    }
  }

  return Array.from(files.values()).sort((a, b) => a.filePath.localeCompare(b.filePath));
}
