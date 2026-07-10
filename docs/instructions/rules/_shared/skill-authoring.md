# Skill Authoring

Every skill under `runtime/**/skills/*` obeys this contract so the LLM does only the reasoning it must, and every deterministic step is a tested script. Read it before you create or modify a skill, or add a script to one. Specific to this repo (paqad-ai). The machine-checkable parts are enforced by `tests/unit/skills/coverage-completeness.test.ts`.

A skill folder has this shape:

```
<skill-name>/
├── SKILL.md          # required — LLM-reasoning layer only, loaded at activation
├── references/       # optional — detail loaded on demand, cited from SKILL.md
├── assets/           # optional — output templates, schemas, lookup tables
├── scripts/          # optional — deterministic helpers
└── agents/           # optional — adapter-specific descriptors (e.g. openai.yaml)
```

## SKILL.md

- Use the documented frontmatter and no invented fields: `name`, `description`, `model_tier`, `triggers`, `cacheable`, `cache_key_inputs`, `output_format`, `input_schema`. Mirror an existing peer skill.
- Set `name` to the folder name, and write `description` from the user's perspective ("Detect X", "Verify Y") because it is the activation hint.
- Keep `SKILL.md` under ~500 lines (~5,000 tokens). Move detail into `references/<topic>.md` and cite it with a load condition ("Read `references/X.md` before doing Y"), never a generic "see references".
- Order the body exactly: `## What It Does`, `## Use This When`, `## Inputs`, `## Procedure`, `## Output Contract`, `## Escalate / Stop Conditions`, `## Resources`.
- Route every deterministic procedure step (parse, derive an inventory, normalize, validate, diff, look up a table) to a script in `scripts/`. MUST NOT re-derive that work in prose.
- Keep judgment steps (severity, ambiguity, whether a hit is a real finding) in prose, and name the boundary: "Run script X for candidates; the LLM picks severity per `references/Y.md`."
- List every script and referenced file under `## Resources` with a one-line purpose. The meta-test fails on any backticked path there that does not exist.

## Scripts: interface contract

- Give each script one verb (`parse-X`, `extract-Y`, `derive-Z`, `diff-X`, `match-X-to-Y`). If you would name it `do-stuff`, split it.
- Make `--help` exit 0 and document usage, flags, output shape, and exit codes, tersely. It lands in the agent's context every run.
- Write structured data to stdout (TSV by default; JSON when the consumer is `node`/`jq`) and all diagnostics to stderr, so stdout stays parseable.
- Give an unrecognized or out-of-range input a clear message and the right exit code, never a bare "error: 1".
- Take all input via flags, env vars, or stdin. MUST NOT block on an interactive prompt, which hangs the agent.
- Keep scripts idempotent: a re-run on the same input produces the same output, including stable id sequences.
- Default to a summary when output can grow unbounded, and accept `--out`/`--limit` for the full version. Harnesses truncate around 10–30K characters.

Exit codes are a fixed contract:

```
0  success — including "no rows" / "no match" (emit an empty result, do not error)
1  a real failure or unrecognized non-usage input
2  a usage error — missing required arg, unknown flag, or a required input file not found
```

## Scripts: portability

Scripts run on macOS bash 3.2, BSD grep, and POSIX awk in CI, and `bash -n` is checked by the meta-test. Each workaround below is load-bearing. Document it inline so a future contributor does not "correct" it and break CI.

- Put `set -euo pipefail` at the top, and pair `|| true` with any subshell whose non-zero exit is expected (a `grep` that finds nothing).
- Iterate with `while IFS= read -r line; do … done` instead of `mapfile`, which bash 3.2 lacks.
- Guard the last line with `while IFS= read -r x || [ -n "${x:-}" ]; do …` so input without a trailing newline is not dropped.
- Write word boundaries as explicit character classes like `(^|[^A-Za-z0-9_-])…([^A-Za-z0-9_-]|$)`; POSIX awk has no `\b`.
- Prefer `[^class]?foo` over `(^|[^class])foo` on BSD grep, where the alternation fails to match start-of-line cases.
- Lowercase both sides before `match()` in awk when you matched case-insensitively in grep, then map `RSTART`/`RLENGTH` back onto the original casing. Awk's `match()` ignores grep's `-i`.
- Use an explicit byte set (`[ABCDEFGHIJKLMNOPQRSTUVWXYZ]`) for an "uppercase-only" filter; `[A-Z]` collates to include lowercase in some CI locales. `[A-Za-z]` is safe.
- Do the work in awk rather than shelling out per line. Each subprocess is a real cost across hundreds of files.

## Assets and references

- Keep `assets/output.template.{md,json}` as the canonical output shape. Agents pattern-match templates more reliably than prose.
- Keep `assets/<vocabulary>.txt` flat and grep-friendly for the closed sets the script and agent share (severity words, axe-rule → WCAG map).
- Put no logic in assets. Logic lives in `scripts/`; assets are static data and templates.
- Cite every `references/<topic>.md` from `SKILL.md` with a load condition. A reference nothing cites is dead weight, and a procedure a reference describes becomes a script.

## Testing: one test per script

Every script has a spec at `tests/unit/skills/<skill>.test.ts` that references it by basename, exercised end to end against real fixtures.

- Make the first test of each `describe` assert `--help` exits 0, and assert usage errors exit 2 with the expected stderr.
- Give each documented behavior its own `it(...)`. Do not bundle "parses, ignores prose, handles empty" into one test.
- Assert on structured output (`expect(rows).toContain('color.primary.500\t#1a73e8\tcolor')`), not on a prose regex.
- Assert both the success and the skip path: every finding script has a "finds the violation" and a "skips exempt files" test; every required flag has a "rejects missing flag" test.
- Test each portability workaround explicitly (feed a missing-trailing-newline input to the code that defends against it). The fix is silent otherwise.
- Depend on no developer-machine state: no real `git`, network, or Playwright. Build tempdirs and fixtures with `withTempDir`, and keep larger fixtures under `tests/fixtures/…/<skill>/`.

## Before opening the PR

```
- SKILL.md has the seven sections in order; description triggers on the right prompts, not near-misses.
- Every deterministic step calls a script; every script has --help, structured stdout, stderr diagnostics, exit codes 0/1/2.
- Every script is listed under ## Resources and has a spec referencing it by basename, with an it(...) per behavior.
- Fixtures live under tests/fixtures/…; portability workarounds are documented inline.
- `pnpm run ci` is green locally.
```

When in doubt, copy the shape of an existing peer skill rather than inventing a new one. The `coverage-completeness` meta-test is the enforcement. MUST NOT bypass it.
