# Shape the idea with options and risks: technical

## Module Boundaries

| Path | Owned |
|---|---|
| `skills/shape-idea/SKILL.md` | Yes: step 3 procedure and checklist |
| `skills/shape-idea/references/playback-template.md` | Yes: goal-first playback shape |
| `skills/shape-idea/references/expert-lenses.md` | Yes: the six lenses (ported from the 0.2.0 consult-expert specialties, as questions, not subagents) |
| `skills/shape-idea/references/challenge-guide.md` | Yes: when and how to challenge |
| `shared/references/paqad-docs-map.md` | No: owned by project-grounding; copied in for "What the documents prove" (GRD-8 to GRD-11) |

Step skill (PLG-8). No script; not script-bearing.

## Data Contracts

Produces the `playback` block (written by `product-discovery` through `record.py update` once the user accepts):

```json
{ "goal_first_playback": "", "lenses": [], "options": [], "smaller_first_step": "", "recommendation": "" }
```

The recommendation may name a non-build outcome (already exists, experiment, process change, defer, stop). The element shape of `lenses` and `options` is not specified in the source.

The playback follows "What the documents prove" in `references/paqad-docs-map.md`: an area the `today` block does not document is called not documented, and nothing states or implies, in any wording, that it is not built; a document's status line covers only the exact thing it names; and a `today` entry's `code_suggests` line keeps the label "the code suggests" wherever it is used. Step 5 recommends already exists when the idea is a documented capability or when a `code_suggests` line shows it exists. `playback-template.md` carries the example "the code suggests members can earn points" under What exists today.

## Script Interfaces

None: this feature is instruction-only.

## State Management

Reads `idea` and `today`. `playback` is the step 3 required block (`record.REQUIRED[3]`). Changing `playback` stales `decisions`, `ticket_set_ref`, `readiness`, `posted`; a change to `idea` or `today` stales `playback`.

## Error Codes

None.

## Dependencies

| Kind | Item |
|---|---|
| Shared imports (`build/skills.yml`) | `references/voice.md`, `references/paqad-docs-map.md` |
| Modules | conversation-standards, project-grounding (the docs map only), discovery-record (via the coordinator) |
| Host capabilities | Chat only |

## Configuration

None.

## Testing Entry Points

| Kind | Entry point |
|---|---|
| Eval scenarios (`s1.yml`) | `ac-26` (`already-exists-flagged`, `no-tickets-unless-asked`), `ac-27` (`privacy-risk-raised`), `ac-28` (`smaller-first-step-offered`) |
| Fixture | `tests/evals/fixture-repo/docs/modules/data-export/features/export-customer-data/business.md` |
| Authoring | `tests/scripts/test_authoring.py::TriggerHygieneTest` (AC-19), `VoiceBlockTest` (AC-13) |
| Unit | `tests/scripts/test_evidence_rules.py` (`SkillPointerTest`: declares and points to the section, checklist does the rules by hand; `DocsMapBuildTest`: the docs map is shipped into the skill; `TemplateTest`: the playback template) |
