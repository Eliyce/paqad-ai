---
name: dependency-advisory-triage
description: Normalize dependency advisories across native audits and OSV evidence.
metadata:
  model_tier: reasoning
  cacheable: 'false'
  output_format: markdown
  paqad-meta: skill.meta.yaml
---

## What It Does

Normalizes native package-manager audit output and online advisory results into one dependency finding model so package risk is deduplicated before reporting.

## Use This When

Use this during the pentest workflow after dependency audit scripts and advisory lookups have produced raw artifacts that need to be merged into stable findings.

## Inputs

- Read the raw dependency audit artifacts first.
- Read `references/advisory-normalization.md` before deciding whether two advisories are the same issue.
- Read installed package versions from the stack snapshot when it exists.

## Procedure

1. Run `scripts/normalize-advisories.sh <artifact1> <artifact2> ...` to merge npm/pnpm/OSV outputs into one JSONL stream keyed by (ecosystem, package, advisory_id).
2. For each merged record, write one finding using `assets/output.template.md`.
3. Keep remediation focused on upgrade, replacement, or compensating control.
4. Validate with `scripts/lint-output.sh` — duplicate keys fail the build.

## Output Contract

- Match `assets/output.template.md`: `## Dependency Findings` with `### {{ecosystem}}:{{package}} — {{advisory-id}}` per finding plus Severity/Installed/Sources/Title/Remediation lines.
- Output must pass `scripts/lint-output.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when a package name or installed version cannot be matched to the advisory evidence.
- Warn when audit output and advisory services disagree on whether the package is affected.
- Do not assume a package is fixed just because one advisory source is silent.

## Resources

- `references/advisory-normalization.md`
- `scripts/normalize-advisories.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `agents/openai.yaml`
