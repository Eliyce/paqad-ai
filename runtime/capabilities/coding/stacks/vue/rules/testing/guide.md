# Vue Testing

- Write component tests on Vitest with `@vue/test-utils` (or Testing Library Vue); mount the component and assert on rendered output and user-visible behavior, not on internal reactive state.
- Prefer querying by accessible role/label/text (Testing Library) or stable `data-test` attributes over brittle CSS/class selectors.
- After triggering an update, `await nextTick()` (or `await wrapper.find(...).trigger(...)`, which flushes) before asserting; Vue's DOM updates are asynchronous.
- Test Pinia stores in isolation with a fresh `createTestingPinia()`/`setActivePinia(createPinia())` per test so state does not leak between tests.
- Mock network at the boundary with MSW rather than stubbing the fetch/data composable, so request and response handling is exercised.
- Cover the meaningful branches of changed behavior — success, loading, empty, and error states — not just the happy path.
- Reserve end-to-end browser tests (Playwright/Cypress) for critical user journeys; do not duplicate unit-level logic there.
