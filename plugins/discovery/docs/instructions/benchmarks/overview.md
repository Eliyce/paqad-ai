# Benchmarks

What this repository measures, the limits it must stay within, and where the numbers come from.
Measured values are in [measured.md](measured.md).

| Benchmark | Limit | Requirement | Enforced today |
|---|---|---|---|
| Unit tests pass on Python 3.9 | 0 failures | CI-7 | Yes, in `ci.yml` |
| Script branch coverage | 90% or more | CI-7 | No (coverage gate not wired) |
| Standard library only | no third-party import | CI-7, PLG-5 | No automated check |
| Deterministic build | two builds byte-identical | CI-8 | Yes, in `ci.yml` |
| `dist/` size | under 5 MB | CI-10 | No (placeholder) |
| `dist/` file count | under 300 files | CI-10 | No (placeholder) |
| `SKILL.md` length | under 500 lines | CI-2, PLG-3 | No (placeholder); AC-1 unit test checks frontmatter |
| Skill `description` length | at most 1,024 characters | CI-1, PLG-3 | Unit test (AC-1) |
| Reply length (conversation) | about 80 words of prose; questions about 40 | TALK-1, CI-12 | No (evals not run yet) |
| Eval stability | each property holds in 3 of 3 runs | CI-12 | No (evals not run yet) |

Re-measure after any change to `skills/`, `shared/` or `build/`.
