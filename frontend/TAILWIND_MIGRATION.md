# Tailwind Migration Guide

This project is now configured for Tailwind, but `src/App.css` is still the visual source of truth for most screens. Do not delete `App.css` until every class it owns has been migrated and visually checked.

## Ground Rules

1. Preserve the existing UI first.
2. Migrate one visual class or one isolated component at a time.
3. Do not replace a full page with Tailwind utilities unless screenshots confirm it is identical.
4. Keep complex CSS in CSS when Tailwind utilities would be less exact.
5. After every migration slice, run `npm run build`.
6. After visual changes, check both light and dark theme.
7. Check desktop, tablet, and mobile widths before deleting old CSS.

## Safe Migration Order

Start with isolated classes that have minimal interaction:

1. Single-purpose buttons or badges.
2. Small cards with no responsive behavior.
3. Form controls inside one isolated component.
4. Tables only after table spacing and mobile behavior are confirmed.
5. Page layout classes last.

Avoid migrating these until late:

1. Sidebar and mobile navigation.
2. Print styles.
3. Patient autocomplete dropdown.
4. Prescription workflow and sticky areas.
5. Inventory drawer/table interactions.
6. Any selector using `:has`, `color-mix`, print media, custom animation, or deep descendant selectors.

## Recommended Workflow

1. Run:

```bash
npm run css:audit
```

2. Pick one class from `App.css`.
3. Copy its CSS values exactly into a Tailwind utility string or a small component.
4. Keep the old CSS rule while testing.
5. Compare the screen visually.
6. Only then remove the old CSS rule.

## Important Files

- `src/App.css`: Current visual reference.
- `src/index.css`: Tailwind entry point. Keep this file.
- `tailwind.config.cjs`: Theme token mapping to existing CSS variables.
- `src/styles/ui.ts`: Reusable Tailwind utility constants for new or safely migrated components.
- `src/components/ui/*`: Reusable UI primitives. Use only when they visually match the old CSS.

## What "Fully Migrated" Means Here

The realistic target is not zero CSS. A mature Tailwind app can still keep CSS for:

1. Print layouts.
2. Complex responsive sidebar behavior.
3. Browser-specific selectors.
4. Animations.
5. `:has` and deep state selectors.

The practical goal is to reduce `App.css` to only those special cases while Tailwind handles common cards, buttons, forms, grids, tables, badges, drawers, and modals.
