# Rule classification guide

The rubric the rule-analyzer applies to every rule under `docs/instructions/rules/**`.

## Step 1 — already enforced?

Before classifying verifiability, check whether an existing tool already enforces the rule. If so, record it in `enforced_by` and generate **no** script (avoids double-enforcement and check-stage bloat).

| Source              | How to detect                                                      | `enforced_by` value                                |
| ------------------- | ------------------------------------------------------------------ | -------------------------------------------------- |
| ESLint              | Rule maps to an enabled rule in `eslint.config.js` / `.eslintrc.*` | `eslint:<rule-name>` (e.g. `eslint:no-debugger`)   |
| TypeScript          | Rule is covered by a `tsconfig.json` strictness flag               | `tsconfig:<flag>` (e.g. `tsconfig:noUnusedLocals`) |
| Prettier            | Rule is a formatting concern Prettier owns                         | `prettier`                                         |
| paqad module-health | Rule is about module test/coverage health                          | `paqad:module-health`                              |
| paqad design-test   | Rule is a design-system conformance concern                        | `paqad:design-test`                                |
| paqad pentest       | Rule is a security concern the pentest runner covers               | `paqad:pentest`                                    |

When `enforced_by` is non-empty, leave `scripts: []` and do not generate.

## Step 2 — verifiability

| Kind            | Test                                                                                         | Examples                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `deterministic` | A script can decide pass/fail with no judgement.                                             | "No `debugger` statements." "No TODO without an issue link." "All exports are named."    |
| `heuristic`     | A script can flag _candidates_; a human/LLM adjudicates. These inform `review`, never block. | "Business logic belongs in hooks/services, not screens." "Avoid god-objects."            |
| `unverifiable`  | No script can decide it; record a `reason`.                                                  | "Match repo conventions." "Keep changes coherent." "Commit one logical phase at a time." |

Bias toward `unverifiable` (with a reason) over a brittle script. A bad deterministic script that over-flags is worse than an honest "unverifiable".

## Step 3 — conflict pass

Scan all rules for direct contradictions before writing the map. Classic example:

- "Always use named exports." vs. "React components should use default exports."

Surface every conflict via the Decision Pause Contract, quoting **both** rules verbatim, and await the user's resolution before writing `rule-script-map.yml`. Do not pick a winner silently.

## Output

The classifications file passed to `write-map.mjs` is:

```json
[
  {
    "id": "RL-7f3a",
    "verifiability": { "kind": "deterministic" },
    "enforced_by": ["eslint:no-debugger"]
  },
  { "id": "RL-2c9b", "verifiability": { "kind": "heuristic" }, "enforced_by": [] },
  {
    "id": "RL-3d11",
    "verifiability": { "kind": "unverifiable", "reason": "Coherence is judgment-dependent." },
    "enforced_by": []
  }
]
```
