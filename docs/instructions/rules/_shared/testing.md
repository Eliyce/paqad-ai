# Testing

- Add or update tests for every behavior change, in the same change.
- Cover failure and edge paths, not just the happy path.
- Keep tests deterministic and isolated: no reliance on network, real clocks, shared state, or test execution order.
- Assert on observable behavior and outputs, not private implementation details.
- Run the narrowest relevant suite while iterating, then the full gate before treating the work as done; maintain the project's coverage bar.
