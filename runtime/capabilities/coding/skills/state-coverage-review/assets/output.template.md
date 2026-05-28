## Findings

- **high** (components.md → Button > focus) — {{module}} / state: focus state not implemented; no `:focus-visible` selector or `data-state="focused"`. Evidence: `src/components/Button.tsx:1`. Required action: add visible focus ring per `components.md` clause `Button > focus`.
- **medium** (components.md → Input > error) — {{module}} / state: error state declared but no Playwright test exercises it. Evidence: `src/components/Input.tsx:24`. Required action: add a Playwright test that drives `Input` into the `error` state and asserts the error message.

## Open Questions

- {{omit when none}}
