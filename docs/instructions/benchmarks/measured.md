# Measured benchmarks

Measured on 2026-10-05 at commit `f4abcb5` (S1b), macOS, Python 3.9.6 (`/usr/bin/python3`).

| Benchmark | Measured | Limit | Status |
|---|---|---|---|
| Unit tests | 154 run, 0 failures, 0.42 s | 0 failures | Pass |
| Build time | 0.05 s | none set | n/a |
| Deterministic build | `diff -r` of two builds is empty | identical | Pass |
| `dist/` size | 524 KB | under 5 MB | Pass |
| `dist/` file count | 96 files | under 300 | Pass |
| Longest `SKILL.md` | 104 lines (`product-discovery`) | under 500 | Pass |
| All `SKILL.md` combined | 847 lines across 13 skills | none set | n/a |
| Em or en dash in `skills/`, `shared/`, `hosts/`, `build/`, `tests/`, `README.md`, `REQUIREMENTS.md` | none found | none | Pass |
| Host or vendor names in `skills/`, `shared/` | none found | none | Pass |
| "How to talk" block in every `SKILL.md` | 13 of 13 | 13 of 13 | Pass |
| Script branch coverage | not measured | 90% | Unknown |
| Conversation evals | not run | all properties, 3 of 3 runs | Unknown |

## Environment note

On the machine used for this run, the shell's `python3` alias pointed at a removed Homebrew
Python (`/opt/homebrew/Cellar/python@3.13/3.13.1`), so `python3` failed while
`/usr/bin/python3` worked. This is a local setup issue, not a repository issue, but it makes
the `test`, `build` and `format` commands in `.paqad/project-profile.yaml` fail on that machine
until the alias is fixed.
