# React Testing

- Write component tests with React Testing Library on Vitest or Jest; render the component and assert on what the user sees and does, not on internal state or implementation details.
- Query by accessible role/label/text (`getByRole`, `getByLabelText`, `findByText`); avoid `container.querySelector` and test-id queries except as a last resort.
- Drive interactions with `@testing-library/user-event` (not raw `fireEvent`) so events match real browser sequences (focus, keydown, input).
- Await async UI with `findBy*` / `waitFor`; wrap state-updating interactions so no "act(...)" warnings appear — treat those warnings as test failures to fix.
- Mock network at the boundary with MSW rather than stubbing `fetch` or the data-library hooks, so tests exercise real request/response handling.
- Cover the meaningful branches of changed behavior — success, loading, empty, and error states — not just the happy path.
- Reserve end-to-end browser tests (Playwright/Cypress) for critical user journeys; do not duplicate unit-level logic there.
