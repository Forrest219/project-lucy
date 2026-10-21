import assert from "node:assert/strict";
import { test } from "node:test";
import { forbiddenBrowserCalls } from "../lib/real-browser-source-guard.mjs";

test("network mock guard ignores documentary strings and comments, including multiline comments", () => {
  assert.deepEqual(forbiddenBrowserCalls(`
    // Never use page.route()
    /* context.route('**', handler) */
    const notes = "Never uses page.route() or route.fulfill";
    await page.goto('/connections');
  `), []);
});

test("network mock guard catches executable interception, optional calls and bracket access", () => {
  for (const code of [
    "await page.route('**', handler)", "await context.route('**', handler)",
    "await page?.route?.('**', handler)", "await page['route']('**', handler)",
    "await route.fulfill({body: 'fake'})", "await page.routeFromHAR('fake.har')", "mockApi()"
  ]) assert.equal(forbiddenBrowserCalls(code).length, 1, code);
});
