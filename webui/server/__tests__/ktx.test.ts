import { describe, expect, it } from "vitest";
import { KtxCliError, validateSource } from "../ktx";

function fakeExecFile(
  impl: (command: string, args: readonly string[], options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv }) => { error: Error | null; stdout: string; stderr: string }
) {
  return ((command: string, args: readonly string[], options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv }, callback: Function) => {
    const result = impl(command, args, options);
    callback(result.error, result.stdout, result.stderr);
  }) as never;
}

describe("validateSource", () => {
  it("calls ktx validate with execFile argument array and short table name", async () => {
    const result = await validateSource(
      "/project",
      "mysql-aliyun",
      "yihe_poc_demo",
      "accrual_demo",
      fakeExecFile((command, args, options) => {
        expect(command).toBe("ktx");
        expect(args).toEqual(["sl", "validate", "accrual_demo", "--connection-id", "mysql-aliyun"]);
        expect(options).toMatchObject({ cwd: "/project", timeout: 60_000 });
        expect(options.env?.POSTHOG_DISABLED).toBe("1");
        return { error: null, stdout: "Valid semantic-layer source", stderr: "" };
      })
    );

    expect(result).toEqual({
      ok: true,
      exitCode: 0,
      stdout: "Valid semantic-layer source",
      stderr: "",
      issues: []
    });
  });

  it("returns validation failures without throwing", async () => {
    const error = new Error("failed") as NodeJS.ErrnoException;
    error.code = "1";
    const result = await validateSource(
      "/project",
      "mysql-aliyun",
      "yihe_poc_demo",
      "missing",
      fakeExecFile(() => ({ error, stdout: "", stderr: "source not found" }))
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.issues).toEqual([{ message: "source not found" }]);
  });

  it("throws KTX_CLI_ERROR when the CLI is unavailable", async () => {
    const error = new Error("spawn ktx ENOENT") as NodeJS.ErrnoException;
    error.code = "ENOENT";

    await expect(
      validateSource(
        "/project",
        "mysql-aliyun",
        "yihe_poc_demo",
        "accrual_demo",
        fakeExecFile(() => ({ error, stdout: "", stderr: "" }))
      )
    ).rejects.toBeInstanceOf(KtxCliError);
  });
});
