# Feature Spec & "Done" Bar — Technical

> **Slug:** `spec-and-done-bar` &nbsp;·&nbsp; **Issue:** #102

## Source footprint

| Concern | Location |
|---|---|
| Structured spec types | `src/core/types/feature-spec.ts` |
| Spec JSON schema | `src/validators/schemas/feature-spec.schema.json` (registered as `feature-spec` in `src/validators/validator.ts`) |
| Sidecar builder | `src/spec/feature-spec-builder.ts` |
| Freeze gate | `src/spec/spec-freeze.ts` |
| Frozen-spec sidecar store | `src/spec/frozen-spec-store.ts` (`writeFrozenSpec` / `readFrozenSpecs`) |
| Freeze CLI verb | `src/cli/commands/spec.ts` (`paqad-ai spec freeze`) |
| "Done" bar | `src/spec/definition-of-done.ts` |
| Spec decision packets | `src/spec/spec-decisions.ts` |
| Decision categories | `src/planning/decision-packet.ts` (`spec.change`, `spec.contradiction`) |
| Stage strictness | `src/pipeline/feature-development-policy.ts` (`require_spec_signoff`) |

## The spec object

The human-readable `.paqad/specs/S-<id>-<slug>.md` stays the source of truth. `buildFeatureSpec()`
derives a validated structured sidecar (`.paqad/specs/S-<id>.spec.json`) from that markdown — never
hand-maintained — by extending the compliance obligation extractor:

- **behaviour** — functional + non-functional obligations, rendered `FR-n: …` / `NFR-n: …`.
- **acceptance_criteria** — reuse the `VerificationCriterion` shape (`AC-n`, given/when/then,
  `proof_type`). Dotted ids collapse to a flat `AC-n`; numbered-list criteria get sequential ids.
- **invariants** — author-written `INV-n` lines plus rule-sourced suggestions, each `confirmed: false`
  until a human signs off.

The schema sets `additionalProperties: false`, so typos are rejected like every other paqad schema.

## Freeze

`evaluateSpecFreeze(spec, review)` returns `{ can_freeze, blockers }`. A spec freezes only when all three
sections are present, every acceptance criterion has a `proof_type`, no open questions remain, every
invariant is human-confirmed, and no *critical* spec-review defect is still open. `freezeSpec()` stamps
`{ frozen_at, spec_hash, signed_off_by }` and throws on any blocker. `isFrozenSpecStale()` detects when
the source markdown changed after freeze.

The `specification` stage carries framework-owned strictness `require_spec_signoff: true` (escalation
`missing_spec_signoff: stop`). Like every `require_*` flag it is merge-safe — a project override cannot
downgrade it. The `fast` lane omits the specification stage, so trivial work is unaffected.

The agent runs the freeze mid-turn via the CLI (issue #317): `npx paqad-ai spec freeze <spec-file>
--signed-off-by <name> --confirm-invariants` wires `buildFeatureSpec → evaluateSpecFreeze → freezeSpec
→ writeFrozenSpec`. It prints every blocker and exits non-zero (nothing written) when the spec is not
freezable; on a clean spec it writes the frozen sidecar (`.paqad/specs/<id>.frozen.json`). The
`--confirm-invariants` flag is the operator's sign-off act — without it, unconfirmed invariants stay
blockers so a freeze is never implied. The verb only invokes the engine; it reimplements no freeze logic.

## The "done" bar

`isDone({ gates_passed, acceptance_criteria, findings })` returns `done` only when gates pass, every
acceptance criterion's proof passes, and no confirmed non-taste finding remains. Findings of kind
`taste` never flip the bar — they are recorded for triage (#107). `renderDefinitionOfDone()` renders the
checklist and names the failing gate / acceptance criterion / finding.

## Spec-lifecycle decisions

`buildSpecChangePacket()` and `buildSpecContradictionPacket()` produce Decision Packets in the new
`spec.change` and `spec.contradiction` categories. The change packet recommends "update and re-freeze";
the contradiction packet offers "fix code" / "change spec" with **no** recommendation — the agent never
silently resolves a contradiction.
