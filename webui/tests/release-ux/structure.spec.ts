// Release UX menu shell. Clicks every sidebar group and item from navigation.ts.
// /help is outside the sidebar and is opened directly.
// Does not judge empty-state copy or contradictory status labels.

import { expect, test, type Page } from "@playwright/test";
import { navGroups } from "../../src/app/navigation";
import {
  datetimeViolation,
  errorTextViolations,
  forbiddenPrimaryLabels,
  h1Violation,
  headerActionViolation,
  pageHeaderViolation,
  type DatetimeFact
} from "./invariants";

interface PageFacts {
  h1s: string[];
  errorText: string;
  labels: string[];
  datetime: DatetimeFact | null;
  pageHeader: boolean;
  headerActionCount: number | null;
}

async function factsFor(page: Page, scanLabels: boolean): Promise<PageFacts> {
  return page.evaluate((includeLabels) => {
    const skipped = (el: Element | null) => {
      if (!el) return true;
      return Boolean(el.closest("pre, code, [translate='no']"));
    };
    const h1s = [...document.querySelectorAll("h1")]
      .filter((el) => !skipped(el))
      .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean);

    const chunks: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      if (parent && !skipped(parent)) {
        const text = node.textContent ?? "";
        if (text.trim()) chunks.push(text);
      }
      node = walker.nextNode();
    }

    const labels: string[] = [];
    if (includeLabels) {
      const nodes = document.querySelectorAll(
        ".pl-page-header button, .pl-page-header a, .pl-page-header h1, .pl-page-header h2, th, [class*='metric'], [data-testid*='metric'], [data-testid*='kpi'], [data-sonner-toast], [class*='empty'], [data-testid*='empty']"
      );
      for (const el of nodes) {
        if (skipped(el)) continue;
        const name = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim();
        if (name) labels.push(name);
      }
    }

    const selected = [...document.querySelectorAll("[aria-pressed='true'], [aria-selected='true'], option:checked")].some(
      (el) => /近\s*\d+/.test(el.textContent ?? "")
    );
    const inputs = ([...document.querySelectorAll("input[type='datetime-local']")] as HTMLInputElement[]).filter((el) => {
      if (el.closest(".sr-only")) return false;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const datetime =
      inputs.length >= 2
        ? { presetSelected: selected, start: inputs[0]?.value ?? "", end: inputs[1]?.value ?? "" }
        : null;

    const actions = document.querySelector("[data-testid='page-header-actions']");
    const headerActionCount = actions
      ? [...actions.querySelectorAll("button, a")].filter((el) => {
          const style = getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }).length
      : null;

    return {
      h1s,
      errorText: chunks.join("\n"),
      labels,
      datetime,
      pageHeader: Boolean(document.querySelector("[data-testid='page-header']")),
      headerActionCount
    };
  }, scanLabels);
}

async function assertShell(page: Page, expectedLabel: string | null) {
  await expect.poll(async () => page.locator("h1").count(), { timeout: 20_000 }).toBeGreaterThan(0);
  const facts = await factsFor(page, expectedLabel !== null);
  const h1 = h1Violation(facts.h1s, expectedLabel);
  const errors = errorTextViolations(facts.errorText);
  const forbidden = expectedLabel === null ? [] : forbiddenPrimaryLabels(facts.labels);
  const datetime = datetimeViolation(facts.datetime);
  const header = expectedLabel === null ? null : pageHeaderViolation(facts.pageHeader);
  const actions = expectedLabel === null ? null : headerActionViolation(facts.headerActionCount);
  expect({ h1, errors, forbidden, datetime, header, actions }, expectedLabel ?? "/help").toEqual({
    h1: null,
    errors: [],
    forbidden: [],
    datetime: null,
    header: null,
    actions: null
  });
}

for (const group of navGroups) {
  for (const item of group.items) {
    test(`menu shell ${group.title} / ${item.label}`, async ({ page }) => {
      await page.goto("/overview");
      const toggle = page.getByTestId(`nav-group-toggle-${group.id}`);
      await expect(toggle).toBeVisible();
      if ((await toggle.getAttribute("aria-expanded")) !== "true") {
        await toggle.click();
      }
      await expect(page.getByTestId(`nav-group-${group.id}`)).toHaveAttribute("data-open", "true");
      await expect(page.getByTestId(`nav-group-items-${group.id}`)).toBeVisible();
      await page.getByTestId(`nav-link-${item.id}`).click();
      await expect.poll(() => new URL(page.url()).pathname).toBe(item.to);
      await expect(page.getByTestId(`nav-link-${item.id}`)).toHaveAttribute("aria-current", "page");
      await assertShell(page, item.label);
    });
  }
}

test("menu shell /help has one non-empty h1", async ({ page }) => {
  await page.goto("/help");
  await assertShell(page, null);
});
