# WCAG 2.2 Mapping

The most common audit findings → WCAG 2.2 success criterion ids. Cite the id in every finding (analog of WSTG ids in pentest).

## Perceivable

- `WCAG-2.2-1.1.1` — Non-text Content (Level A). Missing `alt`, decorative images without `alt=""`.
- `WCAG-2.2-1.3.1` — Info and Relationships (Level A). Missing semantic landmarks, headings out of order, missing form labels.
- `WCAG-2.2-1.4.3` — Contrast (Minimum) (Level AA). Text < 4.5:1, large text < 3:1.
- `WCAG-2.2-1.4.4` — Resize Text (Level AA). Fixed `px` font sizes that prevent zoom.
- `WCAG-2.2-1.4.11` — Non-text Contrast (Level AA). Focus rings, form borders, icon-only buttons < 3:1.
- `WCAG-2.2-1.4.12` — Text Spacing (Level AA). Layouts that break when text spacing is increased.

## Operable

- `WCAG-2.2-2.1.1` — Keyboard (Level A). Anything pointer-only.
- `WCAG-2.2-2.1.2` — No Keyboard Trap (Level A). Modals without escape, focus loops.
- `WCAG-2.2-2.4.3` — Focus Order (Level A). DOM order vs visual order mismatch; positive `tabindex`.
- `WCAG-2.2-2.4.7` — Focus Visible (Level AA). `outline: none` without replacement.
- `WCAG-2.2-2.4.11` — Focus Not Obscured (Minimum) (Level AA, new in 2.2). Sticky headers covering focused element.
- `WCAG-2.2-2.5.5` — Target Size (Enhanced) — best practice; target < 24×24 fails.
- `WCAG-2.2-2.5.8` — Target Size (Minimum) (Level AA, new in 2.2). Pointer targets < 24×24 CSS pixels.
- `WCAG-2.2-3.3.7` — Redundant Entry (Level A, new in 2.2). Forms that re-ask for already-provided info.
- `WCAG-2.2-3.3.8` — Accessible Authentication (Minimum) (Level AA, new in 2.2). CAPTCHAs without alternative.

## Understandable

- `WCAG-2.2-3.1.1` — Language of Page (Level A). Missing `<html lang>`.
- `WCAG-2.2-3.2.2` — On Input (Level A). Form fields that auto-submit on change.

## Motion / preferences

- `WCAG-2.2-2.3.3` — Animation from Interactions (Level AAA — informational). Respect `prefers-reduced-motion`.

## axe-core rule → WCAG mapping (subset)

| axe rule id             | WCAG id          |
| ----------------------- | ---------------- |
| `color-contrast`        | `WCAG-2.2-1.4.3` |
| `image-alt`             | `WCAG-2.2-1.1.1` |
| `button-name`           | `WCAG-2.2-4.1.2` |
| `link-name`             | `WCAG-2.2-2.4.4` |
| `label`                 | `WCAG-2.2-1.3.1` |
| `landmark-one-main`     | `WCAG-2.2-1.3.1` |
| `focus-order-semantics` | `WCAG-2.2-2.4.3` |
| `tabindex`              | `WCAG-2.2-2.4.3` |
| `target-size`           | `WCAG-2.2-2.5.8` |
| `html-has-lang`         | `WCAG-2.2-3.1.1` |

axe emits more rules than this; map novel ones at finding time using the published axe-core docs.
