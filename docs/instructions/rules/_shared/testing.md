# Testing

Baseline testing rules for every change, in every stack. These always load. A stack rule (for example `coding/stacks/react/testing.md`) names the concrete runner and libraries; it does not repeat these.

<!-- trigger: ** -->

- Add or update a test for every behavior change, in the same change. Untested behavior is unfinished behavior.
- Cover the failure and edge paths the change introduces, not only the happy path.
- Keep tests deterministic and isolated: no dependence on the network, the real clock, shared mutable state, or the order tests run in. Inject or fake those inputs.
- Assert on observable behavior and outputs, not on private fields or internal call order.
- When code resolves a real shipped resource (a pack, template, runtime root, or bundled asset), add a test that loads the real resource and asserts a non-empty, expected result, so a wrong path fails loudly instead of returning an empty set that reads as "nothing here".
- Run the narrowest relevant suite while iterating, then run the full gate (`pnpm ci`) before you call the work done, and hold the project's coverage bar.

## Verify

```bash
# A source change is accompanied by a test change:
git diff --name-only | grep -qE '(^|/)src/' && git diff --name-only | grep -qE '(test|spec|__tests__)'
# The full gate is green (format, lint, typecheck, test, build, coverage):
pnpm ci
# Determinism smell — flag real time/network/randomness reached from test files (review each hit):
git grep -nE '\b(Date\.now|Math\.random|fetch|new Date\(\))\b' -- 'tests/**' '**/*.test.ts'
```
