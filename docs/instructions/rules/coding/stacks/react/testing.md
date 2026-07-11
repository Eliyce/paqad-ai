# React Testing

Loads when you write React component tests. Sharpens `_shared/testing.md` with the concrete libraries.

- Test components with React Testing Library on Vitest: render the component and assert on what the user sees and does, not on internal state. <!-- @rule RL-2aca -->
- Query by accessible role, label, or text (`getByRole`, `getByLabelText`, `findByText`), and reach for `container.querySelector` or a test id only as a last resort. <!-- @rule RL-865f -->
- Drive interactions with `@testing-library/user-event`, not raw `fireEvent`, so events match a real browser sequence (focus, keydown, input). <!-- @rule RL-13e6 -->
- Await async UI with `findBy*`/`waitFor`, and treat an `act(...)` warning as a test failure to fix, not to silence. <!-- @rule RL-5c3a -->
- Mock the network at the boundary with MSW instead of stubbing `fetch` or the data-library hooks, so the test exercises real request and response handling. <!-- @rule RL-dd48 -->
- Cover the changed branches, success, loading, empty, and error, not only the happy path. <!-- @rule RL-d109 -->
- Reserve end-to-end browser tests (Playwright) for critical journeys, and do not duplicate unit-level logic there. <!-- @rule RL-9058 -->
