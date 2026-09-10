# expert-notes output template

Return exactly this JSON shape (one note, for the role in your brief):

```json
{
  "notes": [
    {
      "role": "db-expert",
      "findings": [
        {
          "target": "invoices",
          "claim": "every new filter needs an index on invoices.customer_id",
          "kind": "requirement",
          "severity": "must",
          "evidence": "doc: docs/modules/billing/index.md"
        }
      ],
      "questions": [
        {
          "business_text": "How many invoices should one customer expect to download at once?",
          "why_it_matters": "a bulk export on a large table needs a plan",
          "options": ["a handful", "hundreds", "thousands or more"],
          "grounded_in": null
        }
      ]
    }
  ],
  "tokens": { "db-expert": 900 }
}
```

- `findings` may be empty (you looked and had nothing to add).
- `questions` may be empty.
- `kind`: `requirement | invariant | acceptance | risk | non-goal`.
- `severity`: `must | should | could`.
- `evidence` is optional (a grounding reference).
