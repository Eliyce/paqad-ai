# State Coverage Checklist

Default state set (when `components.md` does not declare otherwise): `default / hover / focus / disabled / loading / error / empty`.

## Static implementation evidence

- **default** — the component renders without any state prop set.
- **hover** — `:hover` selector, `data-hover` attribute, or `useHover` hook.
- **focus** — `:focus-visible` selector with a non-zero outline, OR a focus ring rendered via `data-state="focused"`.
- **disabled** — `disabled` prop OR `aria-disabled="true"` with pointer-events handled.
- **loading** — conditional render for `loading` prop (spinner, skeleton).
- **error** — conditional render for `error` prop (error text, error border).
- **empty** — conditional render for "no data" cases (placeholder, illustration).

## Test coverage evidence

A state is "tested" when at least one Playwright test:

- visits a route where the component renders, and
- drives it into that state (hover via `.hover()`, focus via `.focus()` or `keyboard.press('Tab')`, disabled via fixture data, loading via slow network, error via mock failure, empty via empty fixture), and
- asserts at least one observable property (computed style, text, attribute, screenshot).

A test that _renders_ the component without driving the state does not count for that state.

## Severity rules

- Missing `focus` implementation → **high** (accessibility blocker; cross-link with `accessibility-review`).
- Missing `error` implementation → **high** (silent failure surface).
- Missing `disabled` implementation when the prop exists → **high** (broken contract).
- Missing `loading` / `empty` → **medium**.
- Missing `hover` → **low** (often a design preference rather than a contract).
- Implemented but untested → **medium** (regression risk).
