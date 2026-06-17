import { execFile, type ExecFileException } from "node:child_process";

export type Issue = {
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  issues?: Issue[];
};

export class KtxCliError extends Error {
  code = "KTX_CLI_ERROR";
  statusCode = 503;

  constructor(message: string) {
    super(message);
    this.name = "KtxCliError";
  }
}

type ExecFileImpl = typeof execFile;

function issuesFromOutput(stdout: string, stderr: string): Issue[] {
  return `${stderr}\n${stdout}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((message) => ({ message }));
}

export async function validateSource(
  projectRoot: string,
  conn: string,
  _schema: string,
  table: string,
  execFileImpl: ExecFileImpl = execFile
): Promise<ValidationResult> {
  return new Promise((resolve, reject) => {
    execFileImpl(
      "ktx",
      ["sl", "validate", table, "--connection-id", conn],
      { cwd: projectRoot, timeout: 60_000, env: { ...process.env, POSTHOG_DISABLED: process.env.POSTHOG_DISABLED ?? "1" } },
      (error: ExecFileException | null, stdout: string | Buffer, stderr: string | Buffer) => {
        const out = stdout.toString();
        const err = stderr.toString();
        if (!error) {
          resolve({ ok: true, exitCode: 0, stdout: out, stderr: err, issues: [] });
          return;
        }

        if (error.code === "ENOENT") {
          reject(new KtxCliError("ktx CLI was not found in PATH"));
          return;
        }

        const exitCode = typeof error.code === "number" ? error.code : 1;
        resolve({
          ok: false,
          exitCode,
          stdout: out,
          stderr: err,
          issues: issuesFromOutput(out, err)
        });
      }
    );
  });
}
