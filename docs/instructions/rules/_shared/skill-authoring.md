# Skill Authoring

## Purpose

Every skill in `runtime/**/skills/*` must obey this contract so the LLM does only the reasoning it actually needs to do, and every deterministic step is a tested script. This is the project rule that backs the agentskills.io guidelines — read it before creating or modifying a skill, and before adding a script to an existing skill.

## Skill anatomy

Every skill is a folder with this shape:

```
<skill-name>/
├── SKILL.md          # required — LLM-reasoning layer only
├── references/       # optional — detail loaded on demand (cite from SKILL.md)
├── assets/           # optional — output templates, schemas, lookup tables
├── scripts/          # optional — deterministic helpers
└── agents/           # optional — adapter-specific descriptors (e.g. openai.yaml)
```

`SKILL.md` is the only file loaded at activation. Everything else is referenced from it and loaded on demand (progressive disclosure).

## SKILL.md rules

- Use the documented frontmatter — `name`, `description`, `model_tier`, `triggers`, `cacheable`, `cache_key_inputs`, `output_format`, `input_schema`. Mirror the shape of an existing peer skill rather than inventing new fields.
- `name` matches the folder name. `description` is the activation hint — write it from the user's perspective ("Detect X", "Verify Y"), not the implementation's.
- Keep `SKILL.md` under ~500 lines / ~5,000 tokens. Move detail to `references/<topic>.md` and tell the agent _when_ to load it ("Read `references/X.md` before doing Y") — never a generic "see references for details".
- The body must contain, in order: `## What It Does`, `## Use This When`, `## Inputs`, `## Procedure`, `## Output Contract`, `## Escalate / Stop Conditions`, `## Resources`.
- Procedure steps that are deterministic (parse a file, derive an inventory, normalize a value, validate a payload, emit a diff, look up a table) **must** call a script in `scripts/` — do not re-derive the work in prose.
- Procedure steps that are judgment (severity, ambiguity, whether a flagged hit is a real finding) belong in prose. Make the boundary explicit: "Run script X to get the candidates; the LLM picks severity per the checklist in `references/Y.md`."
- Resources section lists every script with a one-line purpose and every referenced file. The meta-test fails if any backticked path under Resources doesn't exist.

## Scripts rules — interface contract

Every script in `scripts/` follows this contract. The agentskills.io guidance is the spec; this rule is how we enforce it in this project.

- **One verb per script.** A script does one thing — `parse-X`, `extract-Y`, `derive-Z`, `diff-X`, `match-X-to-Y`, `propose-X`. If you find yourself naming a script `do-stuff`, split it.
- **`--help` exits 0** and documents `Usage`, accepted flags, output shape, and exit codes. Keep it terse — `--help` lands in the agent's context window every time.
- **Stdout is structured.** Default to TSV (`<col1>\t<col2>\t...`); use JSON when the consumer is `node`/`jq` (e.g. live-phase results). Never mix data and diagnostics on stdout.
- **Stderr carries diagnostics.** Notes, warnings, "directory not found" hints — all stderr. Stdout stays parseable.
- **Meaningful exit codes:**
  - `0` — success (including "no rows" / "no match" — emit an empty result, don't error)
  - `1` — the operation surfaced a real failure or unrecognized input that isn't usage
  - `2` — usage error (missing required arg, unknown flag, file-not-found for required input)
- **Helpful error messages.** "Error: X is required. Usage: ..." — never bare "error: 1". The agent reads stderr to decide the next attempt.
- **No interactive prompts.** All input via flags, env vars, or stdin. A script that blocks on a TTY prompt hangs the agent indefinitely.
- **Idempotent.** Agents retry. "Create if not exists" is safer than "create and fail on duplicate". Re-runs on the same input produce the same output (this includes stable id sequences — see `design-system-coverage/scripts/gap-report.sh`).
- **Defaults over menus.** When multiple paths are reasonable, pick a sensible default and mention the alternative briefly. Don't dump a menu the agent has to pick from.
- **Predictable output size.** If output can grow unbounded, default to a summary and accept a flag (`--out`, `--limit`) for the full version. Many agent harnesses truncate around 10–30K characters.
- **Trust internal callers, validate at boundaries.** Reject ambiguous or out-of-range input with a clear error and `exit 2` rather than guessing.

## Scripts rules — portability

`bash -n` is checked by the meta-test. The scripts also need to run on macOS bash 3.2 and BSD grep / POSIX awk that ship in CI. Workarounds we've already paid for:

- **No `mapfile`.** Bash 3.2 doesn't have it. Use `while IFS= read -r line; do ... done` or write the list to a tempfile and iterate.
- **No `\b` in awk.** POSIX awk regex has no word-boundary metachar. Use explicit boundary character classes like `(^|[^A-Za-z0-9_-])...([^A-Za-z0-9_-]|$)`.
- **BSD grep's `(^|...)` alternation is fragile.** When `(^|[^class])foo` fails to match start-of-line cases on macOS, use the `[^class]?foo` zero-or-one quantifier instead and let post-processing in awk handle the rest.
- **awk's `match()` is case-sensitive even when grep used `-i`.** If you matched case-insensitively in grep, you must lowercase both sides in awk before calling `match()`, then map `RSTART`/`RLENGTH` back onto the original casing for reporting.
- **`read` drops the last line when there's no trailing newline.** Always write `while IFS= ... read -r x || [ -n "${x:-}" ]; do ...; done` so a one-line input doesn't get silently skipped.
- **`set -euo pipefail`** at the top of every script. Pair with `|| true` on any subshell whose non-zero exit is non-fatal (e.g. `grep` that finds nothing).
- **`[A-Z]` / `[a-z]` ranges are locale-dependent.** On some POSIX locales (seen on GitHub's macOS runner) `[A-Z]` collates as `aBcDeF...` and matches lowercase too. When the filter is meant to be "uppercase only" or "lowercase only", use an explicit byte set (`[ABCDEFGHIJKLMNOPQRSTUVWXYZ]`). `[A-Za-z]` is safe because it already covers both cases. This applies to **both bash `case` patterns and awk regexes**.
- **Don't shell out for what `awk` already does.** Each subprocess is a real cost when the agent runs the script across hundreds of files.
- **Inline comments document each workaround.** If a future contributor sees `[^class]?foo` and thinks "that's wrong, it should be `(^|[^class])foo`", they will revert the fix and break CI. The comment is load-bearing.

## Assets rules

- `assets/output.template.{md,json}` — the canonical shape of the skill's output. Agents pattern-match against templates far more reliably than against prose descriptions.
- `assets/<vocabulary>.txt` — closed sets the script and the agent both consume (e.g. severity vocabulary, axe-rule → WCAG mapping). Keep them flat and grep-friendly.
- Never put logic in assets. Logic is in `scripts/`. Assets are static lookup data and templates.

## References rules

- `references/<topic>.md` — detail the agent loads only when it needs it.
- Every reference must be cited from `SKILL.md` with a load condition ("Read `references/X.md` before evaluating Y"). A reference that's never cited is dead weight.
- References are reading material, not executable. If the document describes a procedure, that procedure becomes a script.

## Testing rules — one test per script

Every script in `scripts/` has a corresponding test that exercises it end-to-end. This is enforced by `tests/unit/skills/coverage-completeness.test.ts`:

1. **Every skill with `scripts/` has a spec at `tests/unit/skills/<skill>.test.ts`.**
2. **Every script in that dir is referenced by basename in the spec.** A script with no test reference fails CI.
3. **Every script passes `bash -n`** (syntax check).
4. **Every backticked path under `## Resources` in `SKILL.md` exists on disk.**

Inside each spec:

- **`--help` must exit 0.** First test of every `describe` block.
- **Usage errors must exit 2** with stderr matching the expected guidance.
- **Each documented behavior is a separate `it(...)`.** Don't bundle "parses tokens, ignores prose, handles empty" into one test — fail them independently so failures point at one thing.
- **Tests use real fixtures.** Fixture files live under `tests/fixtures/design-skills/<skill>/` (or the equivalent path for non-design skills). Inline strings via `withTempDir + writeFile` are fine for small one-offs (a CSS line, a single .tsx); anything larger goes in `tests/fixtures/`.
- **Tests assert on structured output, not prose.** `expect(rows).toContain('color.primary.500\t#1a73e8\tcolor')`, not `expect(stdout).toMatch(/primary/)`.
- **Tests assert both success and failure modes.** Every script that emits findings has both "finds the expected violation" and "skips exempt files" tests. Every script with required flags has a "rejects missing flag" test.
- **No reliance on developer machine state.** No real `git`, no real network, no real Playwright. If the script needs a tempdir or a fixture, build it with `withTempDir`. The script must run identically on Node 22 / 24 / ubuntu / macOS.
- **Test the portability workarounds explicitly.** If a script defends against missing trailing newline, write a test that feeds it a missing-trailing-newline input. The fix is silent without it.

## Skill creation checklist

Before opening a PR that adds or modifies a skill:

- [ ] `SKILL.md` has the seven required sections in order.
- [ ] `description` triggers on the right prompts and not on near-misses.
- [ ] Every deterministic procedure step calls a script in `scripts/`.
- [ ] Every script has `--help`, structured stdout, stderr diagnostics, and meaningful exit codes.
- [ ] Every script is referenced under `## Resources` with a one-line purpose.
- [ ] Every script has a spec file at `tests/unit/skills/<skill>.test.ts` that references it by basename.
- [ ] Every script's documented behavior has its own `it(...)` test, including usage errors.
- [ ] Fixtures live under `tests/fixtures/design-skills/<skill>/` (or the analogous path) — not inline blobs spread through the spec.
- [ ] `pnpm run ci` is green locally before pushing.
- [ ] Any portability workaround is documented inline so a future contributor doesn't undo it.

## Rules

- Skills are the LLM-reasoning layer. Anything mechanical lives in `scripts/`.
- One script per verb. Structured stdout, stderr diagnostics, `--help`, exit codes 0/1/2.
- Every script has a real test against fixtures — not a smoke check.
- Scripts must run on bash 3.2 + BSD grep + POSIX awk. Workarounds documented inline.
- `SKILL.md` ≤ ~500 lines. Detail goes in `references/` with explicit load triggers.
- The meta-test (`coverage-completeness`) is the enforcement; do not bypass it.
- When in doubt, copy the shape of an existing peer skill rather than inventing a new one.
