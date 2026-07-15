---
'paqad-ai': patch
---

Harden `SchemaValidator` against resource exhaustion (CodeQL `js/resource-exhaustion-from-deep-object-traversal`). The ajv instance no longer sets `allErrors: true`, so validation short-circuits at the first error instead of traversing an entire (potentially deeply nested, attacker-influenced) object to collect every error. `verbose` is retained so error output still carries the offending value. Validation results still report at least the first failure; callers that render `errors` see the first violation rather than all of them.
