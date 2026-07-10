# Testing

- Add or update tests for every behavior change, in the same change.
- Cover failure and edge paths, not just the happy path.
- Keep tests deterministic and isolated: no reliance on network, real clocks, shared state, or test execution order.
- Assert on observable behavior and outputs, not private implementation details.
- When code resolves real shipped resources (packs, templates, runtime roots, bundled assets), add a test that loads the real resource and asserts a non-empty, expected result. A wrong path must fail the suite loudly, not yield an empty set that looks like a valid "nothing here".
- Run the narrowest relevant suite while iterating, then the full gate before treating the work as done; maintain the project's coverage bar.
