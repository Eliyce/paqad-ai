# Turn an answer into an idea: technical

## Module Boundaries

| Path | Owned |
|---|---|
| `skills/ask-project/SKILL.md` (steps 6 and 7 of "What it does", and the Output section) | Yes |
| `skills/product-discovery/` | No: owned by idea-journey, which receives the hand-over |

## Data Contracts

The hand-over produces a seed for two record blocks. The skill names the blocks but defines no exact seed format; the block shapes are those in `skills/product-discovery/assets/record-template.md`:

```json
{
  "idea": { "goal": "", "who_benefits": "", "success": "", "constraints": "" },
  "today": [ { "area": "", "source_path": "", "section_status": { "<section>": "real" } } ]
}
```

How much of `idea` an answer can fill is not determinable from the source; `today` entries carry the answer's source paths (GRD-5).

## Script Interfaces

None: this feature is instruction-only. `ask-project` does not import `record.py`; any record write happens in `product-discovery` through `record.py update`.

## State Management

`ask-project` holds no state. On acceptance, the seed is applied by the idea journey, which creates the record (`record.py init`, revision 0, step 0) and writes blocks under the expected-revision rule. The source does not specify whether the journey still runs step 0 (get connected) before using the seed; AC-23 only requires the journey to start with the answer and sources already in `idea` and `today`.

## Error Codes

None.

## Dependencies

| Kind | Item |
|---|---|
| Shared imports | Same as Answer a question with sources (`build/skills.yml`, entry `ask-project`) |
| Modules | idea-journey (receiver, not declared as a dependency in the module map), conversation-standards (`consulting.md` for CON-9) |
| Host capabilities | None beyond the chat |

## Configuration

None.

## Testing Entry Points

| Kind | Entry point |
|---|---|
| Eval scenarios (`tests/evals/scenarios/s1.yml`) | `ac-23` (carry an answer into the idea journey: `no-reask`, `source-every-fact`, `one-line-status`), `ac-22` (`offer-to-shape-idea`) |
| Unit | None specific to the hand-over |
