# Metric Cards and Bar Contrast Spec

## 1. Background

Low-gamut and ordinary office displays make the current light surfaces hard to distinguish from the white page background. The main offenders are metric cards and small progress/bar tracks that rely on alpha gray fills without a visible physical edge.

This spec defines a global visual correction for metric cards, muted inner blocks, and progress/bar tracks across the WebUI.

## 2. Goals

- Make metric cards visually distinct on white and near-white surfaces.
- Make progress/bar tracks readable before considering the filled value.
- Preserve the existing console-style density, radius, and restrained palette.
- Keep status meaning visible through semantic colors while improving boundaries.
- Apply the fix globally instead of patching only `/onboarding`.

## 3. Constraints

- Prefer existing CSS tokens and component classes.
- Do not add inline styles to page JSX.
- Do not use `!important` for normal cascade problems.
- Do not scatter raw color values through page components.
- Do not change page information architecture or business logic.

## 4. Global Token Rule

`--token-color-bg-subtle` must be a solid surface color, not alpha over the current parent background.

Target value:

```css
--token-color-bg-subtle: #f9fafb;
```

This keeps nested light surfaces visible on low-gamut displays and avoids white overflow caused by alpha blending over white.

## 5. Metric Card Rule

All `.pl-metric-card` instances must use a visible physical container:

- background: `bg-bg-subtle`
- border: `border border-border-default`
- radius: `rounded-lg`
- shadow: `shadow-card`

Implementation target:

```css
.pl-metric-card {
  @apply grid gap-1 rounded-lg border border-border-default bg-bg-subtle p-3 shadow-card;
}
```

Panel/card reset rules must not later remove the metric card border or shadow.

## 6. Status Metric Rule

Status metric variants keep their semantic background and stronger semantic border:

```css
.pl-metric-card--success { @apply border-success-strong bg-success-soft; }
.pl-metric-card--warning { @apply border-warning-strong bg-warning-soft; }
.pl-metric-card--danger { @apply border-danger-strong bg-danger-soft; }
```

The global metric border rule must not flatten these variants back to neutral gray.

## 7. Progress and Bar Rule

Progress tracks must be visible even at 0% fill.

For the shared progress component:

```css
.pl-progress {
  @apply mt-2 h-2 overflow-hidden rounded-pill border border-border-strong bg-border-default;
  box-sizing: border-box;
}

.pl-progress i,
.pl-progress-bar {
  @apply block h-full rounded-pill bg-primary;
}
```

For local distribution bars, use the same track strategy:

```css
.pl-distribution-row div {
  @apply h-2 overflow-hidden rounded-pill border border-border-strong bg-border-default;
  box-sizing: border-box;
}
```

## 8. Page Coverage

The fix is global and applies to all current `.pl-metric-card` consumers, including:

- `/onboarding`
- `/connections`
- `/eval/monitor`
- `/admin/audit`
- `/admin/audit-sources`
- `/admin/agents`
- `/admin/roles/:id`

Pages should not add per-card inline colors or page-specific utility overrides for this requirement.

## 9. Acceptance

- Metric cards no longer render as borderless alpha-gray panels.
- Metric cards remain visible against `bg-bg-base` and `bg-bg-surface`.
- Success/warning/danger metric variants preserve semantic color.
- `.pl-progress` track is visible before fill.
- `.pl-distribution-row` track is visible before fill.
- No page TSX needs inline styling for metric contrast.
- Tests and build pass:

```bash
npm test
npm run build
```
