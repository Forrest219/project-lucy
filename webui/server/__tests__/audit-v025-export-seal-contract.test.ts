/**
 * Lucy v0.25 / L25-09 — S06 导出封存与跨出口版本一致性。
 *
 * 本文件补的是收口前**没有行为断言**的两处：
 *   - §9.3(b) 清单校验必须**重算文件内容**的 sha256（改内容 / 删文件要能被检出）
 *   - §9.3(c) 跨文件关联校验：调用行的问询 ID 要么能在问询 CSV 找到，要么在例外集里
 *
 * 以及 §4.3(a) 末段「API、UI、CSV、证据包调用同一版本分类函数」的**漂移守卫**：
 * 分类、派生、预览、摘要、关联头、as-of 证明与对账侧的版本常量必须彼此一致。
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyCrossFileRelations, verifyExportFiles } from "../admin/audit-export-v2";
import { DERIVATION_VERSION } from "../proxy/audit-derivation";
import {
  CLASSIFICATION_VERSION_V2P5,
  DIGEST_VERSION_V2P5,
  PREVIEW_VERSION_V2P5
} from "../proxy/audit-classification";
import { CORRELATION_HEADERS_VERSION } from "../proxy/ingress-registry";
import { AS_OF_PROOF_VERSION } from "../proxy/audit-as-of-proof";
import {
  RECONCILIATION_CLASSIFICATION_VERSION,
  RECONCILIATION_DERIVATION_VERSION
} from "../admin/reconciliation-context";
import { UNIT_DEFINITIONS } from "../proxy/audit-reconcile";

const sha256 = (content: Buffer): string => createHash("sha256").update(content).digest("hex");

describe("§9.3(b) 清单校验重算文件内容", () => {
  const content = Buffer.from("id,outcome\n1,ok\n", "utf8");
  const digest = sha256(content);

  it("内容一致时校验通过", () => {
    const result = verifyExportFiles(
      [{ name: "access_log.csv", sha256: digest }],
      new Map([["access_log.csv", content]])
    );
    expect(result.ok).toBe(true);
    expect(result.files[0]).toMatchObject({
      name: "access_log.csv",
      declared: digest,
      actual: digest,
      match: true,
      missing: false
    });
  });

  it("文件内容被改（字节级）时校验失败，且报出实际摘要", () => {
    const tampered = Buffer.from("id,outcome\n1,error\n", "utf8");
    const result = verifyExportFiles(
      [{ name: "access_log.csv", sha256: digest }],
      new Map([["access_log.csv", tampered]])
    );
    expect(result.ok).toBe(false);
    expect(result.files[0].match).toBe(false);
    expect(result.files[0].missing).toBe(false);
    expect(result.files[0].actual).toBe(sha256(tampered));
    expect(result.files[0].actual).not.toBe(digest);
  });

  it("文件缺失时按 missing 处理并令整体校验失败", () => {
    const result = verifyExportFiles(
      [{ name: "access_log.csv", sha256: digest }],
      new Map<string, Buffer>()
    );
    expect(result.ok).toBe(false);
    expect(result.files[0].missing).toBe(true);
    expect(result.files[0].match).toBe(false);
  });

  it("任一文件不符即整体不通过（不按比例通过）", () => {
    const ok = Buffer.from("a\n", "utf8");
    const bad = Buffer.from("b\n", "utf8");
    const result = verifyExportFiles(
      [
        { name: "a.csv", sha256: sha256(ok) },
        { name: "b.csv", sha256: sha256(ok) }
      ],
      new Map([
        ["a.csv", ok],
        ["b.csv", bad]
      ])
    );
    expect(result.ok).toBe(false);
    expect(result.files[0].match).toBe(true);
    expect(result.files[1].match).toBe(false);
  });
});

describe("§9.3(c) 跨文件关联校验", () => {
  it("调用行的问询 ID 在问询 CSV 找不到时报错", () => {
    const result = verifyCrossFileRelations({
      callTurnIds: ["turn-1", "turn-2"],
      questionIds: new Set(["turn-1"])
    });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("turn-2");
  });

  it("全部能对上时通过", () => {
    const result = verifyCrossFileRelations({
      callTurnIds: ["turn-1", null, "turn-2"],
      questionIds: new Set(["turn-1", "turn-2"])
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("例外集里的问询 ID 不算错，但必须被显式列出", () => {
    const result = verifyCrossFileRelations({
      callTurnIds: ["turn-1", "turn-9"],
      questionIds: new Set(["turn-1"]),
      declaredExceptions: new Set(["turn-9"])
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.exceptions).toContain("turn-9");
  });
});

describe("§4.3(a) 末段 — 各出口使用同一版本分类函数", () => {
  it("分类 / 派生 / 预览 / 摘要 / 关联头 / as-of 证明的版本常量彼此一致", () => {
    const versions = [
      DERIVATION_VERSION,
      CLASSIFICATION_VERSION_V2P5,
      PREVIEW_VERSION_V2P5,
      DIGEST_VERSION_V2P5,
      CORRELATION_HEADERS_VERSION,
      AS_OF_PROOF_VERSION,
      RECONCILIATION_CLASSIFICATION_VERSION,
      RECONCILIATION_DERIVATION_VERSION
    ];
    expect(new Set(versions).size).toBe(1);
    expect(versions[0]).toBe("v2p5-1");
  });

  it("五个计量单位的版本与派生版本一致（metric_id 带版本）", () => {
    for (const unit of Object.values(UNIT_DEFINITIONS)) {
      expect(unit.version).toBe(DERIVATION_VERSION);
      expect(unit.metricId.endsWith(`/${DERIVATION_VERSION}`)).toBe(true);
    }
  });
});
