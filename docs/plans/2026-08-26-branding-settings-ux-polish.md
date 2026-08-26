# Branding Settings UX Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refine the existing branding settings page so Logo management, brand preview, default-value semantics, save state, and accessibility are clear and testable without changing the global app-shell layout.

**Architecture:** Keep the change local to `BrandingSettings.tsx` and its focused component test. Reuse the existing Lucy design-system classes and shared `BrandMark`; add no new global component or color/typography primitive. Derive clean/dirty form state from the fetched overrides, render contextual sidebar/login preview surfaces, and keep the native file input accessible while visually hidden.

**Tech Stack:** React 19, TypeScript, TanStack Query, Tailwind utility classes, Vitest, Testing Library, Codex in-app browser.

---

### Task 1: Lock the approved UX contract with focused tests

**Files:**
- Modify: `webui/src/__tests__/branding-settings.test.tsx`

**Step 1: Add failing assertions**

- Assert the hidden file input has the accessible name `选择客户 Logo 文件` and the visible trigger says `更换 Logo` when a custom Logo exists.
- Assert default override inputs are empty while the helper text explicitly exposes `默认值：Lucy WebUI` and `默认值：Data Agent MCP`.
- Assert the save button is disabled and described as unchanged after initial load, then enabled after editing.
- Assert sidebar and login preview surfaces have stable test ids and display both effective title and tagline where applicable.

**Step 2: Run the focused test and verify it fails**

Run: `cd webui && npm test -- src/__tests__/branding-settings.test.tsx`

Expected: FAIL because the new labels, helpers, preview surfaces, and dirty-state contract are not implemented yet.

### Task 2: Refine Logo management and preview composition

**Files:**
- Modify: `webui/src/pages/admin/BrandingSettings.tsx`

**Step 1: Implement the Logo management row**

- Replace the current stacked button cluster with a responsive row containing the 36px Logo mark, current asset status, and a right-aligned action group.
- Use `上传 Logo` for the default state and `更换 Logo` for a custom asset.
- Add an explicit `<label className="sr-only">` linked to the file input, plus helper/status ids wired through `aria-describedby`.
- Give pending mutations `data-loading` and `aria-busy` states.

**Step 2: Implement contextual previews**

- Render the sidebar preview inside a recessed navigation mock with brand block treatment.
- Render the login preview inside a muted canvas with a compact login-card mock that mirrors the real login page hierarchy.
- Keep previews non-interactive and mark decorative chrome as hidden from assistive technology.

**Step 3: Run the focused test**

Run: `cd webui && npm test -- src/__tests__/branding-settings.test.tsx`

Expected: remaining failures should be limited to form-state behavior from Task 3.

### Task 3: Clarify defaults and save-state behavior

**Files:**
- Modify: `webui/src/pages/admin/BrandingSettings.tsx`

**Step 1: Derive form state**

- Compare `productTitle` and `tagline` with the fetched override values to compute `isTextDirty`.
- Disable `保存更改` while clean, while loading, or while the save mutation is pending.
- After a successful save, update the query cache so the form becomes clean without resetting valid input.

**Step 2: Make defaults explicit**

- Keep override inputs empty when defaults are active.
- Replace default-looking placeholders with action-oriented placeholders.
- Add per-field helper text containing the effective default value and connect it with `aria-describedby`.

**Step 3: Align the primary action**

- Place the primary action at the right edge of the form footer.
- Expose an explanation for the disabled clean state through `aria-describedby`.

### Task 4: Verify code and live browser behavior

**Files:**
- Test asset: `/Users/zhangxingchen/Nutstore Files/AI Projects/202808-lucy-test/auto-config/test-logo-k-48.png`

**Step 1: Run automated checks**

Run:

```bash
cd webui
npm test -- src/__tests__/branding-settings.test.tsx
npm run lint:terminology
npm run build
```

Expected: all commands exit 0.

**Step 2: Run browser acceptance**

- Open `http://127.0.0.1:55176/admin/branding`.
- Upload the specified 48×48 PNG.
- Verify the Logo management row reports a custom Logo and exposes `更换 Logo` plus enabled `恢复默认 Logo`.
- Verify the uploaded image appears in the live sidebar, sidebar preview, and login preview.
- Verify clean `保存更改` is disabled; editing either override enables it; reverting disables it again.
- Verify keyboard/accessibility names for the file input and action buttons from the visible DOM.
- Leave the supplied test Logo configured; do not invoke the destructive restore action during acceptance.

## Design System Compliance

- `00-principles.md`: clearer hierarchy, keyboard-readable controls, and explicit interaction state.
- `02-foundations-grid-spacing.md`: reuse the existing 4/8/12/16/24 spacing rhythm; no global breakpoint changes.
- `10-components-button.md`: one primary action per form, secondary maintenance actions, explainable disabled state, and pending `aria-busy`/`data-loading` state.
- `20-patterns-page-layout.md`: primary editing workspace remains left; preview remains a visually secondary region.

