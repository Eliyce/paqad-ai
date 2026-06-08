# Quality Ratchet — measure → tool mapping

The quality ratchet (issue #110) records four measures at the project's real
level today and only ever allows equal-or-better. It reuses existing per-language
tools — it does **not** reinvent metric tooling. Each measure is normalised to a
**deficiency count where lower is better** (violations / orphan files / disabled
strict flags), so "worse" is always "the number went up".

## The four measures and where each comes from

| Measure          | What it means                    | How it is measured (per pack)                                                                                            | Confidence                                      |
| ---------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `tangledness`    | how tangled the code is          | the language's complexity tool, run via rule-scripts (TS/JS: ESLint `complexity`; Python: pylint/radon; Rust: clippy; …) | `mature` where a real tool exists, else `lower` |
| `dead_code`      | dead / unused code               | **consumed** from #109's reachability/orphan output — never re-scanned                                                   | `mature`                                        |
| `risky_patterns` | risky patterns                   | existing security / risky-pattern lint + pentest (OWASP) findings                                                        | `mature` where wired, else `lower`              |
| `strictness`     | how strictly the code is written | the strict-config surface, read directly (TS: `tsconfig` strict flags; others: equivalent)                               | `mature` for TS, else `lower`                   |

A measure with no tool for the stack is recorded **lower-confidence / blocked** —
never a fabricated number — and a blocked measure never blocks the gate.

## Per-pack wiring

- **This repo (TypeScript)** — strictness from `tsconfig` strict flags; dead code
  from #109; tangledness from ESLint `complexity`; risky patterns from the
  security lint + pentest findings.
- **Other languages** — wire the complexity and risky-pattern runners through the
  pack's rule-scripts; mark measures with weak tooling `lower` confidence (mirrors
  #105 mutation testing). Strictness and dead code carry over as above.

## The rule (for agents)

- A change is allowed only if every measure is **equal or better** than the
  recorded baseline. New / changed code is held to at least the existing level
  (clean-as-you-code), so the recorded level can only tighten.
- The `fast` lane is not blocked by complexity / dead-code / risky noise, but it
  **cannot loosen the baseline** (a strictness-loosening fast change still trips).
- A genuine, legitimate need to worsen a measure opens a
  `quality.ratchet_exception` Decision Pause — approved once, reused for the same
  kind. Do not work around the ratchet by deleting unrelated code to keep a total
  flat; bring the measure back, or open the exception.
