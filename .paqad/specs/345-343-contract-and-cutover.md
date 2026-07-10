# Spec: feature-dev contract delivery/enforcement (#345) + per-feature evidence cutover (#343)

## Behaviour summary

On a feature-development route paqad's own rule contract must reach the model un-corrupted,
correctly scoped, and enforced; and the per-feature evidence bundle becomes the single home
for the frozen spec plus new per-feature receipt/AI-BOM slices, retiring the legacy
`.paqad/specs` and `.paqad/plans` directories. No non-feature-development route loads rules,
module docs, rule-scripts, or arms a decision pause.

## Functional requirements

- **FR-1**: Rule compilation derives `trigger_patterns` only from an explicit `<!-- trigger: -->` directive or, failing that, from inline-code spans that are path/glob-shaped; prose and fenced-code contents are never treated as triggers, and a doc with no path-shaped token yields `**`.
- **FR-2**: The rule manifest never emits the corrupted `` `, ` `` token sequence and preserves each rule's inline code spans intact.
- **FR-3**: The retrieval section dedupes assembled slices so no identical slice appears twice.
- **FR-4**: On a feature-development change with no or empty rule-script map, the checks rule-scripts verdict explicitly reports that no rule-scripts are armed rather than passing silently.
- **FR-5**: The conservative decision-pause self-arm is default-on for high-confidence forks on the feature-development route only, an environment override can still disable it, and a compact decision-pause reminder is injected into the feature-development context; no non-feature-development route arms a pause.
- **FR-6**: The spec-change guard reads the frozen spec from the per-feature bundle `specification.json`, `spec freeze` writes only `specification.json`, and the legacy frozen-spec sidecar store is removed.
- **FR-7**: The `.yaml` planning-manifest readers, the dashboard inventory, the narration contract, and the path constants no longer reference `.paqad/specs` or `.paqad/plans`.
- **FR-8**: A per-feature `receipt.json` and `ai-bom.json` are projected from a feature bundle's own rows, the whole-project receipt and AI-BOM project from the union of feature dirs, and per-feature slices honour the same enterprise gating as the whole-project artifacts.

## Acceptance criteria

- **AC-1**: Given a rule doc with inline-code prose and a fenced code block, when rules compile, then trigger_patterns holds only path or glob tokens and a doc with no path token yields the star-star pattern (proof: automated).
- **AC-2**: Given a compiled-rules store with a backtick-heavy rule, when the manifest is composed, then a grep for the corrupted comma sequence returns zero and the rule inline code survives (proof: automated).
- **AC-3**: Given two identical retrieval slices, when the retrieval section composes, then the slice appears once (proof: automated).
- **AC-4**: Given the repository live rules, when the session-context artifact is regenerated, then its corruption count is zero and it is materially smaller than the prior baseline (proof: manual).
- **AC-5**: Given no or empty rule-script map on a feature-development change, when the rule-scripts verdict is produced, then it reports no rule-scripts armed rather than a silent pass (proof: automated).
- **AC-6**: Given each non-feature-development route, when the session context composes, then no rule slice and no module-doc enforcement and no rule-scripts and no self-arm occur (proof: automated).
- **AC-7**: Given a feature-development route with a high-confidence reuse-or-create fork, when the pre-mutation seam runs, then a packet is minted by default and the context carries a decision-pause reminder while non-feature-development routes arm nothing (proof: automated).
- **AC-8**: Given a frozen spec stored only as a feature bundle specification.json, when its source markdown moves, then the spec-change guard mints a spec.change pause and grep for the removed sidecar helpers is clean (proof: automated).
- **AC-9**: Given the cutover, when readers and constants are repointed, then no code reader touches the legacy specs or plans directories (proof: automated).
- **AC-10**: Given a seeded feature bundle, when per-feature projection runs, then a receipt and ai-bom are projected from that feature rows and the whole-project projection unions the feature dirs under the same enterprise gating (proof: automated).
- **AC-11**: Given this change, when CI runs, then full CI is green including branch coverage at or above 95 percent, the stage-evidence 100 percent floor, and the Windows job (proof: automated).

## Invariants

- **INV-1**: No non-feature-development route ever composes rules, module-doc enforcement, rule-scripts, or a decision pause.
- **INV-2**: The trigger fix never drops a real path trigger; when scoping is ambiguous it over-includes with the star-star pattern rather than omitting a rule.
- **INV-3**: Persisted keys use posix separators, never node path backslashes.
- **INV-4**: Branch coverage stays at or above 95 percent globally and 100 percent on src/stage-evidence.
- **INV-5**: The feature-development plan-and-spec-before-code gate is never weakened, and the session-context artifact remains the authoritative rule contract with its fail-safe marker behavior intact.
