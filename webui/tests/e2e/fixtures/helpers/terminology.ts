// webui/tests/e2e/fixtures/helpers/terminology.ts
// 关联主文档：docs/qa/lucy-webui-e2e-test-suite.md §0 / §6
// 翻译防御：结构化扫描 + 原文 forbidden terms，不依赖 Chrome Auto-translate

import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * 与 docs/qa/lucy-webui-e2e-test-suite.md §0 完全一致。
 * 变更时同步更新主文档 + 本文件。
 *
 * 注意："待发布变更" 在 §0 中只禁**导航主项**，允许作为页面区域内 section 标题
 * （见 webui/docs/35-semantic-publish-workbench-ia-spec.md §6.3）。本 helper
 * 用简单字符串包含判定；为避免误报，把"待发布变更"移出本列表。L1 E2E-PUB-02
 * 仅断言"待发布变更"不作为导航主项（侧栏 link / 菜单），由 smoke 单独检查。
 */
export const FORBIDDEN_TERMS = [
  // Manifest 误译
  "财政部舱单", "舱单", "模式清单",
  // Connection Test 误译
  "替代测试",
  // Package 误译
  "上传报价包", "报价包",
  // Schema 误译
  "添加架构", "目标架构",
  // Catalog Reload 误译
  "重新加载资产", "重新加载 catalog", "触发 ingest",
  // 旧导航 / 标题（导航主项；"待发布变更"作为 section 标题允许）
  "审阅与校验", "变更审阅", "索引生效", "资产包",
  "Reindex 历史", "维基文档",
  // 旧按钮 / 旧术语
  "发布并 reindex", "Validate changed",
  // 旧 Read-only / Write-risk 英文露出
  "Read-only expected", "Write-risk",
] as const;

/**
 * 必须带 translate="no" + notranslate 防御的可见 token。
 * 与 §0 保持一致。
 */
const PROFESSIONAL_TOKEN_REGEX =
  /(Schema|Manifest|Reindex|YAML|Wiki|Diff|Raw|SlRef|Overlay|Endpoint|KTX|MCP|Agent|yaml|Yml|zip)/;
const PROFESSIONAL_PATH_REGEX =
  /(\.ya?ml|\.md|\.zip|semantic-layer\/|wiki\/|ktx\.yaml|\.ktx-ui\/|http:\/\/127\.0\.0\.1)/;
const DB_OBJECT_REGEX =
  /(mysql-aliyun|dataforai|openclaw_db|superstore_orders|finance_mart)/;

/**
 * 断言页面 DOM 中不出现任何 forbidden term。
 * 同时扫描可见文本与 ARIA 属性。
 */
export async function assertNoForbiddenTerms(page: Page): Promise<void> {
  const content = await page.content();
  const violations: string[] = [];
  for (const term of FORBIDDEN_TERMS) {
    if (content.includes(term)) {
      violations.push(term);
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `Forbidden terms found in page: ${JSON.stringify(violations)}`
    );
  }
}

/**
 * 断言所有含专业 token / 路径 / DB 对象的可见节点都受 translate="no" 保护。
 * 由 Playwright 在浏览器内执行，扫描 Document 树。
 */
export async function assertProfessionalTermsProtected(page: Page): Promise<void> {
  const violations = await page.evaluate(
    ([tokenRe, pathRe, dbRe]: string[]) => {
      const tokObj = new RegExp(tokenRe);
      const pathObj = new RegExp(pathRe);
      const dbObj = new RegExp(dbRe);
      const out: Array<{ text: string; tag: string; cls: string }> = [];
      const all = Array.from(
        document.querySelectorAll("body *")
      ).filter(
        (el) =>
          el.children.length === 0 && (el.textContent ?? "").trim().length > 0
      );
      for (const el of all) {
        const text = (el.textContent ?? "").trim();
        if (
          tokObj.test(text) ||
          pathObj.test(text) ||
          dbObj.test(text)
        ) {
          const protectedEl = el.closest('[translate="no"]');
          if (!protectedEl || !protectedEl.className.includes("notranslate")) {
            out.push({ text: text.slice(0, 80), tag: el.tagName, cls: el.className });
          }
        }
      }
      return out.slice(0, 10);
    },
    [
      PROFESSIONAL_TOKEN_REGEX.source,
      PROFESSIONAL_PATH_REGEX.source,
      DB_OBJECT_REGEX.source,
    ]
  );
  if (violations.length > 0) {
    throw new Error(
      `Unprotected professional terms: ${JSON.stringify(violations, null, 2)}`
    );
  }
}

/**
 * 一键调用：no-forbidden + professional-protected。
 * 用法：`await assertTerminology(page)`
 */
export async function assertTerminology(page: Page): Promise<void> {
  await assertNoForbiddenTerms(page);
  await assertProfessionalTermsProtected(page);
}

/**
 * 断言当前 URL 处于允许的命名空间内（防止 spec 跑偏到错误路由）。
 */
export async function assertUrlMatches(page: Page, pattern: RegExp): Promise<void> {
  expect(page.url()).toMatch(pattern);
}
