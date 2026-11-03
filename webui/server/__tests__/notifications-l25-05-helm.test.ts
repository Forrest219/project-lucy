import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { parseSmtpProfile } from "../notifications/profile.js";

/**
 * Lucy v0.25 — L25-05 S3: the Helm delivery wiring (SMTP-22／23／24).
 *
 * These assertions run a REAL `helm template` render, so "the chart refuses
 * this values file" is proven by the render actually failing — not by
 * reading a template and hoping.
 *
 * The chart never reaches the network while rendering, and the probes never
 * touch SMTP.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const chartDir = path.join(repoRoot, "deploy/k8s/helm/lucy");
const baseValues = path.join(chartDir, "examples/values.local-test.yaml");

function helmAvailable(): boolean {
  try {
    execFileSync("helm", ["version", "--short"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), "l25-05-helm-"));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function render(values?: Record<string, unknown>): { ok: boolean; output: string } {
  const args = ["template", "lucy", chartDir, "-f", baseValues];
  if (values) {
    const file = path.join(workDir, `values-${Math.random().toString(36).slice(2)}.yaml`);
    // The values file is written synchronously: helm runs in a child process.
    execFileSync("sh", ["-c", `cat > '${file}' <<'YAML'\n${JSON.stringify(values, null, 2)}\nYAML`]);
    args.push("-f", file);
  }
  try {
    const output = execFileSync("helm", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, output };
  } catch (error) {
    const failure = error as { stderr?: Buffer | string; stdout?: Buffer | string };
    return {
      ok: false,
      output: `${String(failure.stdout ?? "")}\n${String(failure.stderr ?? "")}`
    };
  }
}

/** Every rendered document, reduced to the fields the assertions need. */
function parseDocuments(output: string): { kind?: string; name?: string }[] {
  const documents: { kind?: string; name?: string }[] = [];
  for (const raw of output.split(/^---$/m)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      const parsed = parseYaml(trimmed) as { kind?: string; metadata?: { name?: string } };
      if (!parsed || typeof parsed !== "object") continue;
      documents.push({ kind: parsed.kind, name: parsed.metadata?.name });
    } catch {
      // A document that is not a mapping is not a resource.
    }
  }
  return documents;
}

const ENABLED_SMTP = {
  smtp: {
    enabled: true,
    host: "smtp.customer.internal",
    port: 587,
    security: "starttls",
    from: "lucy@customer.internal",
    username: "lucy-notifier",
    recipients: ["data-ops@customer.internal", "sre@customer.internal"],
    auditHealth: true,
    existingSecret: "customer-smtp-secret",
    passwordKey: "password",
    ca: { enabled: true, existingSecret: "customer-smtp-ca", key: "ca.pem" }
  }
};

describe.skipIf(!helmAvailable())("L25-05 Helm SMTP wiring", () => {
  it("SMTP-22 默认关闭：渲染产物里没有任何 SMTP 资源、挂载或 env", () => {
    const result = render();
    expect(result.ok).toBe(true);
    expect(result.output).not.toContain("LUCY_SMTP_");
    expect(result.output).not.toContain("smtp-profile");
    expect(result.output).not.toContain("smtp-password");
    expect(result.output).not.toContain("smtp-ca");
    expect(result.output).not.toContain("-smtp-profile");
  });

  it("SMTP-23 启用：profile 走只读 ConfigMap，密码与 CA 走客户自有 Secret，只出现文件路径 env", () => {
    const result = render(ENABLED_SMTP);
    expect(result.ok).toBe(true);

    // The profile is a ConfigMap; the password and the CA are volumes that
    // reference the customer's own Secret, and the chart renders no Secret
    // for SMTP (it may render other, unrelated Secrets).
    expect(result.output).toContain("name: lucy-smtp-profile");
    expect(result.output).toContain("secretName: customer-smtp-secret");
    expect(result.output).toContain("secretName: customer-smtp-ca");
    for (const doc of parseDocuments(result.output)) {
      if (doc.kind !== "Secret") continue;
      expect(String(doc.name ?? "")).not.toContain("smtp");
    }

    // Only file paths reach the process.
    expect(result.output).toContain("LUCY_SMTP_PROFILE_FILE");
    expect(result.output).toContain("LUCY_SMTP_PASSWORD_FILE");
    expect(result.output).toContain("LUCY_SMTP_CA_FILE");
    expect(result.output).toContain("/data/lucy/smtp/profile.yaml");

    // No password value anywhere in the rendered manifests.
    expect(result.output).not.toContain("hunter2");
  });

  it("SMTP-23 渲染出的 profile 能被运行时的 profile 合同解析", () => {
    const result = render(ENABLED_SMTP);
    expect(result.ok).toBe(true);
    const match = /profile\.yaml: \|-\n([\s\S]*?)\n(?=---|\s*$)/.exec(result.output);
    expect(match).not.toBeNull();
    const profileYaml = (match?.[1] ?? "")
      .split("\n")
      .map((line) => (line.startsWith("    ") ? line.slice(4) : line))
      .join("\n");
    const profile = parseSmtpProfile(profileYaml);
    expect(profile.enabled).toBe(true);
    expect(profile.host).toBe("smtp.customer.internal");
    expect(profile.port).toBe(587);
    expect(profile.security).toBe("starttls");
    expect(profile.from).toBe("lucy@customer.internal");
    expect(profile.username).toBe("lucy-notifier");
    expect(profile.recipients).toEqual(["data-ops@customer.internal", "sre@customer.internal"]);
    expect(profile.notifications.auditHealth).toBe(true);
  });

  it("SMTP-23 有 username 但缺 Secret 时渲染失败", () => {
    const result = render({
      smtp: {
        enabled: true,
        host: "smtp.customer.internal",
        port: 587,
        security: "starttls",
        from: "lucy@customer.internal",
        username: "lucy-notifier",
        recipients: ["data-ops@customer.internal"]
      }
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("smtp.existingSecret");
  });

  it("SMTP-23 values 内联密码时渲染失败", () => {
    for (const key of ["password", "pass", "secret"]) {
      const result = render({
        smtp: {
          enabled: true,
          host: "smtp.customer.internal",
          port: 587,
          security: "starttls",
          from: "lucy@customer.internal",
          recipients: ["data-ops@customer.internal"],
          [key]: "hunter2"
        }
      });
      expect(result.ok).toBe(false);
      expect(result.output).toContain(`smtp.${key}`);
    }
  });

  it("SMTP-23 明文 SMTP 与非法值渲染失败", () => {
    const base = {
      enabled: true,
      host: "smtp.customer.internal",
      port: 587,
      security: "starttls",
      from: "lucy@customer.internal",
      recipients: ["data-ops@customer.internal"]
    };
    const cases: [Record<string, unknown>, string][] = [
      [{ ...base, security: "plaintext" }, "smtp.security"],
      [{ ...base, port: 0 }, "smtp.port"],
      [{ ...base, port: 70000 }, "smtp.port"],
      [{ ...base, port: "abc" }, "smtp.port"],
      [{ ...base, host: "https://smtp.customer.internal" }, "smtp.host"],
      [{ ...base, host: "smtp.customer.internal:587" }, "smtp.host"],
      [{ ...base, from: "not-an-address" }, "smtp.from"],
      [{ ...base, from: "a@b.com\r\nBcc: x@y.com" }, "smtp.from"],
      [{ ...base, recipients: [] }, "smtp.recipients"],
      [{ ...base, recipients: Array.from({ length: 21 }, (_, i) => `ops${i}@customer.internal`) }, "smtp.recipients"]
    ];
    for (const [smtp, needle] of cases) {
      const result = render({ smtp });
      expect(result.ok).toBe(false);
      expect(result.output).toContain(needle);
    }
  });

  it("SMTP-23 extraEnvFrom 覆盖 SMTP env 或投影密码 Secret 时渲染失败", () => {
    const shadow = render({
      smtp: ENABLED_SMTP.smtp,
      extraEnvFrom: [{ prefix: "LUCY_SMTP_", configMapRef: { name: "somewhere-else" } }]
    });
    expect(shadow.ok).toBe(false);
    expect(shadow.output).toContain("LUCY_SMTP");

    const project = render({
      smtp: ENABLED_SMTP.smtp,
      extraEnvFrom: [{ secretRef: { name: "customer-smtp-secret" } }]
    });
    expect(project.ok).toBe(false);
    expect(project.output).toContain("customer-smtp-secret");
  });

  it("SMTP-24 probes 不访问 SMTP", () => {
    const result = render(ENABLED_SMTP);
    expect(result.ok).toBe(true);
    // The probes are HTTP-only; no probe may reference SMTP.
    const probeLines = result.output
      .split("\n")
      .filter((line) => /startupProbe|readinessProbe|livenessProbe|path: \/api\/health/.test(line));
    expect(probeLines.length).toBeGreaterThan(0);
    for (const line of probeLines) expect(line.toLowerCase()).not.toContain("smtp");
  });
});
