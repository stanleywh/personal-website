# Stanley Dashboard Design System

This document describes the visual system implemented by the website. The shared
tokens and primitives in `/styles.css` are the implementation source of truth.
Page-specific styles may compose those primitives but should not replace them.

## Visual direction

The dashboard uses a warm, quiet, paper-like interface with centered content,
generous surrounding whitespace, soft translucent surfaces, restrained shadows,
rounded geometry, and Manrope typography. Desktop layouts intentionally match
the physical density of the former site at approximately 80% browser zoom while
the browser remains at 100%.

The design is not a generic compact theme. Large headings remain expressive,
surface hierarchy remains clear, and mobile controls remain comfortably usable.

## Colour tokens

| Token | Value | Purpose |
| --- | --- | --- |
| `--color-background` | `#eee8dc` | Page canvas |
| `--color-surface` | `#f8f4eb` | Primary cards and dialogs |
| `--color-surface-strong` | `#fffdf8` | Active and hover surfaces |
| `--color-surface-muted` | `#e9e1d3` | Segmented controls and quiet fills |
| `--color-text` | `#2f2a24` | Primary text and dark actions |
| `--color-muted` | `#7d7469` | Supporting text |
| `--color-faint` | `#aaa093` | De-emphasized calendar content |
| `--color-border` | `rgba(63, 54, 43, .14)` | Default borders |
| `--color-border-strong` | `rgba(63, 54, 43, .24)` | Hover/dialog borders |
| `--color-accent` | `#78634b` | Brand accent |
| `--color-accent-dark` | `#5e4c39` | Strong accent and hover |
| `--color-danger` | `#9a5348` | Destructive and error states |

Do not introduce a second palette for an individual page. Event and label
colours are data-driven tracker exceptions.

## Typography

- Typeface: Manrope, with Segoe UI and sans-serif fallbacks.
- Weights: 400 for prose, 500 for display headings, 600 for supporting
  emphasis, and 700 for controls, labels, and kickers.
- Display text uses tight line height and negative letter spacing. Body copy
  uses approximately 1.5–1.7 line height.
- Semantic tokens provide display, page-title, section-title, card-title, and
  account-title scales.
- At desktop widths, fixed `clamp()` endpoints are reduced while the fluid
  viewport coefficient remains unchanged. This reproduces the target density
  without changing browser zoom.
- Small labels remain optically larger than a literal 80% conversion where
  needed for legibility.

## Spacing and geometry

The shared spacing scale is `--space-1` through `--space-8`. Compact desktop
values are 3, 6, 10, 13, 19, 26, 38, and 51px. Tablet and mobile use 4, 8, 12,
16, 24, 32, 48, and 64px.

Use the spacing scale for new work. Avoid one-off multipliers or nested
calculations when an existing token expresses the intended rhythm.

### Page shells

Every route uses `.page-shell` with a page modifier:

| Modifier | Compact/tablet maximum | Desktop maximum |
| --- | ---: | ---: |
| `.page-shell--home` | 1120px | 896px |
| `.page-shell--tracker` | 1440px | 1152px |
| `.page-shell--account` | 650px | 520px |

The page gutter is 24px by default, 19px on desktop, and reduced only where a
narrow layout requires it. Content stays centered.

### Breakpoints

- `1024px` and above: compact desktop density.
- `768–1023px`: tablet layout; the tracker agenda stacks below the calendar.
- `641–767px`: compact header, form, and table-tool layout.
- `640px` and below: mobile cards, calendar toolbar, and table rows.
- `420px` and below: the tracker status control becomes icon-only.

CSS custom properties cannot be used in media-query conditions, so these values
must remain synchronized manually with this document.

## Borders, radii, and shadows

- Borders remain one CSS pixel at every density. This is a deliberate clarity
  exception to literal 80% scaling.
- Radius tokens are small, medium, large, extra-large, and pill. Desktop values
  are 8, 10, 14, 21, and 999px.
- `--shadow-control`, `--shadow-card`, and `--shadow-dialog` are the shared
  elevation levels.
- Use shadows sparingly. Borders and background contrast should establish most
  hierarchy.

## Components

### Buttons and icon buttons

Use `.button` with `.button--primary`, `.button--quiet`, or
`.button--danger`. Add `.button--compact` only in dense desktop toolbars.
Use `.icon-button` and `.icon-button--compact` for icon-only actions.

Desktop controls are 34px high to match the reference density. Tablet/mobile
primary controls are 44px, and compact toolbar controls expand to approximately
40px. Disabled and focus states are part of the shared primitive.

### Form controls

Use `.form-control` for ordinary inputs. Tracker `.field` controls and account
fields consume the same height, border, radius, colour, and focus conventions.
Inputs must have visible labels, meaningful autocomplete attributes where
applicable, and inline error text linked with `aria-describedby`.

### Cards and panels

Use `.surface-card` and override its local custom properties only when a
composition needs a different radius, fill, or elevation. Directory cards,
account cards, and tracker panels all use this primitive.

### Modals

Use the native `dialog` element with `.modal`. Dialogs inherit the shared
surface, border, radius, and shadow, use a constrained viewport height, and
become nearly full-width on mobile. Keep destructive confirmation in the
existing in-app confirmation dialog rather than `window.confirm`.

### Popovers

Popovers use an opaque elevated surface with the shared border, radius, and
dialog shadow so underlying controls never show through. Keep the title and a
real close button aligned in a distinct header, use a responsive width that
stays within the viewport, and scroll only the body when a deliberate maximum
height is genuinely exceeded. Overflowing bodies inherit the shared native
scrollbar treatment. Calendar event rows show one title; all-day events omit
time, while timed events show at most one visually distinct time label.

### Segmented and status controls

Use `.segmented` for mutually exclusive compact choices and keep
`aria-pressed` synchronized. Use `.status-control` for passive state with an
optional action. Status must never be conveyed by colour alone.

### Navigation

The homepage directory card is the primary navigation pattern. Interior pages
use the existing back link and page-level actions. Do not restore Finance or
Projects unless a separate product change explicitly adds them.

## Scrolling and overflow

The document is the default scrolling surface. Create an internal scroll
container only when a component has a deliberate height boundary and its
overflow must remain reachable without expanding the page, such as the timed
calendar grid or a viewport-constrained modal. Use `overflow: auto` so a
scrollbar appears only when content exceeds that boundary. Do not add overflow
to cards, panels, or page shells merely to make them potential scrollers, and
avoid nested scrolling when normal page flow is sufficient.

Desktop scrollbars use the following shared tokens:

| Token | Value | Purpose |
| --- | --- | --- |
| `--scrollbar-desktop-size` | `8px` | Native scrollbar width and height on fine-pointer devices |
| `--scrollbar-track` | `transparent` | Keeps the underlying surface visible |
| `--scrollbar-thumb` | `rgba(125, 116, 105, .46)` | Discoverable neutral thumb at rest |
| `--scrollbar-thumb-hover` | `rgba(125, 116, 105, .62)` | Stronger pointer-hover state |
| `--scrollbar-thumb-active` | `rgba(94, 76, 57, .76)` | Strongest drag/active state |

Firefox receives `scrollbar-width: thin` and `scrollbar-color`. Chromium,
Edge, and Safari use native WebKit scrollbar pseudo-elements with an
eight-pixel channel, a rounded thumb, transparent track and corner, and no
visible arrow buttons. Styling is global because it does not create overflow
and because FullCalendar measures a temporary native scroller to align its
columns. Mobile and coarse-pointer devices keep their platform-native overlay
and momentum behavior. Forced-colour mode reverts the custom parts and colours
so the operating system can provide an operable high-contrast scrollbar.

Scrollbar visibility must not depend on hover: the resting thumb remains
visible. Native scrolling, wheel and trackpad input, touch momentum, keyboard
navigation, and browser zoom must continue to work. Do not replace native
scrolling with JavaScript, fake tracks, or hidden scrollbars.

FullCalendar has a deliberate exception. Its Week and Day timed grid remains
internally scrollable through the full day. The non-liquid all-day section uses
`overflow-y: auto` and a `--calendar-all-day-max-height` of 120px on compact
layouts and 96px at the desktop-density breakpoint, so empty and fitting rows
show no scrollbar while genuine event overflow remains reachable. FullCalendar
still reserves the measured scrollbar width across its header, all-day, and
timed sections; that transparent compensation is required to keep the final
day column aligned. Month cell minimum heights apply only to Month view.

Apply these conventions to future sidebars, lists, tables, modal bodies, and
panels only after defining the component's intended height boundary. Test both
fitting and overflowing content, mouse and keyboard scrolling, touch behavior,
forced colours, supported responsive widths, and browser zoom above 100%.

## Responsive and accessibility rules

- Never use CSS `zoom`, whole-application transforms, JavaScript browser-scale
  changes, or viewport-meta scaling.
- The page must not create horizontal document scrolling at supported widths.
- Browser zoom must compose naturally with the layout. At high zoom, media
  queries may intentionally produce the tablet or mobile layout.
- Keep the three-pixel focus ring, semantic headings, skip link, labels, live
  regions, and keyboard-operable controls.
- Mobile controls must remain approximately 44px high where space permits.
- Preserve `prefers-reduced-motion` behavior.
- One-pixel borders and accessibility-sensitive targets are not reduced on
  desktop merely to obtain mathematical 80% scaling.

## Tracker-specific rules

- FullCalendar height is controlled by `--calendar-height`: the existing
  `clamp(560px, 72vh, 720px)` on compact layouts and
  `clamp(448px, 72vh, 576px)` on desktop.
- The timed grid is intentionally scrollable. The all-day area scrolls only
  when its events exceed `--calendar-all-day-max-height`; preserve the shared
  scrollbar-width compensation that aligns its columns with the header.
- Month cells use a 74px desktop minimum; Week and Day keep readable slot
  heights.
- The selected-day agenda is 196px wide on desktop and stacks below 1024px.
- The render-after-auth sequence and post-reveal `calendar.updateSize()` call
  are required. Do not render the calendar in the hidden shell without the
  follow-up size update.
- Do not apply transforms, filters, backdrop filters, perspective, or paint
  containment to the calendar card or its ancestors: FullCalendar's fixed drag
  mirror must keep viewport coordinates accurate for selection, dragging, and
  resizing.
- Event and label colours may vary because they are user data, but surrounding
  controls use the shared palette.

## Building a matching new page

1. Load `/styles.css` in the document head and add `site-page` to the body.
2. Wrap content in `.page-shell` with the closest existing modifier, or add one
   shared maximum-width token when the page has a genuinely new content mode.
3. Compose `.surface-card`, button, form, modal, segmented, and status
   primitives before adding page-specific CSS.
4. Use the semantic typography and spacing tokens instead of raw one-off
   dimensions.
5. Add page-specific rules only for layout or behavior unique to the page.
6. Verify 1440px, 1280px, tablet, 390px mobile, keyboard focus, reduced motion,
   horizontal overflow, and browser zoom above 100%.
7. Update this document whenever the shared visual system changes.
