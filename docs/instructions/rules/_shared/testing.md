# Testing

- Add or update tests for every behavior change, in the same change. <!-- @rule RL-3143 -->
- Cover failure and edge paths, not just the happy path. <!-- @rule RL-365a -->
- Keep tests deterministic and isolated: no reliance on network, real clocks, shared state, or test execution order. <!-- @rule RL-2efa -->
- Assert on observable behavior and outputs, not private implementation details. <!-- @rule RL-83fd -->
- When code resolves real shipped resources (packs, templates, runtime roots, bundled assets), add a test that loads the real resource and asserts a non-empty, expected result. A wrong path must fail the suite loudly, not yield an empty set that looks like a valid "nothing here". <!-- @rule RL-6d7a -->
- Run the narrowest relevant suite while iterating, then the full gate before treating the work as done; maintain the project's coverage bar. <!-- @rule RL-a754 -->
