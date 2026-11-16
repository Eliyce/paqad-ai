# Testing

Baseline testing rules for every change, in every stack. These always load. A stack rule (for example `coding/stacks/react/testing.md`) names the concrete runner and libraries; it does not repeat these.

<!-- trigger: ** -->

- Add or update a test for every behavior change, in the same change. Untested behavior is unfinished behavior. <!-- @rule RL-7557 -->
- Cover the failure and edge paths the change introduces, not only the happy path. <!-- @rule RL-0b1a -->
- Keep tests deterministic and isolated: no dependence on the network, the real clock, shared mutable state, or the order tests run in. Inject or fake those inputs. <!-- @rule RL-edc2 -->
- Assert on observable behavior and outputs, not on private fields or internal call order. <!-- @rule RL-5dc4 -->
- When code resolves a real shipped resource (a pack, template, runtime root, or bundled asset), add a test that loads the real resource and asserts a non-empty, expected result, so a wrong path fails loudly instead of returning an empty set that reads as "nothing here". <!-- @rule RL-1dc7 -->
- Run the narrowest relevant suite while iterating, then run the full gate (`pnpm ci`) before you call the work done, and hold the project's coverage bar. <!-- @rule RL-312d -->
- Prove every bug fix with a test that fails before the fix and passes after it. <!-- @rule RL-2592 discovered:rd-20261116-061901 -->
- Every `.resolves`/`.rejects` assertion is awaited or returned, and vi.mock/vi.unmock/vi.hoisted are called only at module top level. <!-- @rule RL-f307 discovered:rd-20261116-061901 -->

## Verify

```bash
# A source change is accompanied by a test change:
git diff --name-only | grep -qE '(^|/)src/' && git diff --name-only | grep -qE '(test|spec|__tests__)'
# The full gate is green (format, lint, typecheck, test, build, coverage):
pnpm ci
# Determinism smell — flag real time/network/randomness reached from test files (review each hit):
git grep -nE '\b(Date\.now|Math\.random|fetch|new Date\(\))\b' -- 'tests/**' '**/*.test.ts'
```
