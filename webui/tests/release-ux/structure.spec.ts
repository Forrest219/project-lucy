// Release UX structure suite. Opens every sidebar route from navigation.ts plus /help.
// Does not click section tabs, count header actions, or judge empty-state copy.

import { expect, test, type Page } from "@playwright/test";
import { navGroups } from "../../src/app/navigation";
import {
  datetimeViolation,
  errorTextViolations,
  forbiddenPrimaryLabels,
  h1Violation,
  type DatetimeFact
} from "./invariants";

interface PageFacts {
  h1s: string[];
  errorText: string;
  labels: string[];
  datetime: DatetimeFact | null;
}

const routes = navGroups.flatMap((group) => group.items.map((item) => ({ to: item.to, label: item.label })));

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

    return { h1s, errorText: chunks.join("\n"), labels, datetime };
  }, scanLabels);
}

async function assertRoute(page: Page, route: string, expectedLabel: string | null) {
  await page.goto(route);
  await expect.poll(async () => page.locator("h1").count(), { timeout: 20_000 }).toBeGreaterThan(0);
  const facts = await factsFor(page, expectedLabel !== null);
  const h1 = h1Violation(facts.h1s, expectedLabel);
  const errors = errorTextViolations(facts.errorText);
  const forbidden = expectedLabel === null ? [] : forbiddenPrimaryLabels(facts.labels);
  const datetime = datetimeViolation(facts.datetime);
  expect({ h1, errors, forbidden, datetime }, route).toEqual({
    h1: null,
    errors: [],
    forbidden: [],
    datetime: null
  });
}

for (const item of routes) {
  test(`structure ${item.label} ${item.to}`, async ({ page }) => {
    await assertRoute(page, item.to, item.label);
  });
}

test("structure /help has one non-empty h1", async ({ page }) => {
  await assertRoute(page, "/help", null);
});
