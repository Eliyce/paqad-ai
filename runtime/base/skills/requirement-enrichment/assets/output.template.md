The output is a JSON object — the FR-4 two-layer question batch the spec
pipeline's `questions` step consumes. `questions[]` is the only required field;
each question is a `PipelineQuestion` (see `src/spec-pipeline/types.ts`).

```json
{
  "questions": [
    {
      "business_text": "Today, an export includes the archived invoices too. Keep including them, or leave them out?",
      "why_it_matters": "It changes what every downstream reader sees in the exported file.",
      "options": [
        "Keep the archived invoices in the export",
        "Leave the archived invoices out of the export"
      ],
      "grounded_in": "docs/modules/exports/overview.md",
      "technical_note": "archived == status:archived rows in the export serializer"
    },
    {
      "business_text": "When the export can't be delivered, what should happen?",
      "why_it_matters": "It decides whether a stuck export fails loudly or waits.",
      "options": [
        "Keep trying quietly for an hour, then notify someone",
        "Fail straight away and tell the user"
      ],
      "grounded_in": null
    }
  ]
}
```

Rules:

- `business_text` and every `options[]` entry use the project's own words —
  grounding terms first, then the prompt's wording, then plain English.
- `options[]` are OUTCOMES, never mechanisms (no "exponential backoff").
- `grounded_in` is a doc/glossary ref, or `null` when the wording can't be tied
  to project evidence.
- `technical_note` is optional and internal — never shown to the user.
