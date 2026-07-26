# Repository instructions

Before any visual or UI change, read `docs/design/DESIGN_SYSTEM.md`.

- Treat `/styles.css`, its shared tokens, and reusable components as the visual
  implementation source of truth.
- Use `docs/design/references/` when judging layout density and direction.
- New pages must use the shared page shell, typography, spacing, components,
  and responsive rules.
- Do not add isolated page-specific styling when a shared token or component
  already covers the need.
- Reuse the shared native scrollbar tokens and rules. Create an internal scroll
  container only for a deliberate height boundary, and use automatic overflow
  so fitting content does not display a scrollbar.
- Preserve accessible native scrolling; do not introduce JavaScript or fake
  scrollbar replacements. Keep FullCalendar header, all-day, and timed-grid
  columns aligned.
- Update the design-system document whenever the established visual system
  changes.
- After UI changes, run relevant tests, type checking, production and
  GitHub-Actions-mode builds, distribution verification, route checks, and
  desktop/tablet/mobile visual and overflow checks. Scrollable components must
  also cover fitting and overflowing content, keyboard input, mobile behavior,
  and browser zoom.
