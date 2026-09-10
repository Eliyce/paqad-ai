# expert-synthesis output template

Return exactly this JSON shape:

```json
{
  "verdict": "needs-answers",
  "accepted": ["EX-db-expert-1", "EX-security-auditor-1"],
  "declined": [
    { "id": "EX-performance-analyst-2", "reason": "duplicates the db-expert index finding" }
  ],
  "conflicts": [
    {
      "target": "orders",
      "recommendation": "generate the file in a background job and email a link",
      "rationale": "a bulk export on a large table is too slow to stream in the request path"
    }
  ],
  "gaps": [
    {
      "area": "non-default currency invoices",
      "why_it_matters": "nobody said what happens to an invoice in a currency other than the account default",
      "question": {
        "business_text": "Should the export include invoices in other currencies?",
        "why_it_matters": "it changes what the customer sees in the file",
        "options": ["include them", "exclude them", "ask per download"],
        "grounded_in": null
      }
    }
  ],
  "questions": [],
  "tokens": 1200
}
```

- `verdict`: `ready | needs-answers | not-ready`.
- Every merged finding id appears once across `accepted` and `declined`.
- Each merge conflict gets one row; `recommendation` is one of its claims verbatim.
- A gap's `question` is optional.
