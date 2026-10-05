# Shape the idea with options and risks: technical

## Module Boundaries

| Path | Owned |
|---|---|
| `skills/shape-idea/SKILL.md` | Yes: step 3 procedure and checklist |
| `skills/shape-idea/references/playback-template.md` | Yes: goal-first playback shape |
| `skills/shape-idea/references/expert-lenses.md` | Yes: the six lenses (ported from the 0.2.0 consult-expert specialties, as questions, not subagents) |
| `skills/shape-idea/references/challenge-guide.md` | Yes: when and how to challenge |

Step skill (PLG-8). No script; not script-bearing.

## Data Contracts

Produces the `playback` block (written by `product-discovery` through `record.py update` once the user accepts):

```json
{ "goal_first_playback": "", "lenses": [], "options": [], "smaller_first_step": "", "recommendation": "" }
```

The recommendation may name a non-build outcome (already exists, experiment, process change, defer, stop). The element shape of `lenses` and `options` is not specified in the source.

## Script Interfaces

None: this feature is instruction-only.

## State Management

Reads `idea` and `today`. `playback` is the step 3 required block (`record.REQUIRED[3]`). Changing `playback` stales `decisions`, `ticket_set_ref`, `readiness`, `posted`; a change to `idea` or `today` stales `playback`.

## Error Codes

None.

## Dependencies

| Kind | Item |
|---|---|
| Shared imports (`build/skills.yml`) | `references/voice.md` |
| Modules | conversation-standards, discovery-record (via the coordinator) |
| Host capabilities | Chat only |

## Configuration

None.

## Testing Entry Points

| Kind | Entry point |
|---|---|
| Eval scenarios (`s1.yml`) | `ac-26` (`already-exists-flagged`, `no-tickets-unless-asked`), `ac-27` (`privacy-risk-raised`), `ac-28` (`smaller-first-step-offered`) |
| Fixture | `tests/evals/fixture-repo/docs/modules/data-export/features/export-customer-data/business.md` |
| Authoring | `tests/scripts/test_authoring.py::TriggerHygieneTest` (AC-19), `VoiceBlockTest` (AC-13) |
