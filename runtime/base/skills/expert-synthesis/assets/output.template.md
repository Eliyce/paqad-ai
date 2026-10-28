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
      "ruling": "pick",
      "recommendation": "generate the file in a background job and email a link",
      "rationale": "a bulk export on a large table is too slow to stream in the request path"
    },
    {
      "target": "export file name",
      "ruling": "compatible",
      "merged_claim": "name the file after the account and the date range, and never include the customer email",
      "rationale": "one expert asked for a readable name and the other for no personal data; both hold at once"
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
  "renames": [{ "id": "EX-db-expert-2", "target": "customers" }],
  "questions": [],
  "tokens": 1200
}
```

- `verdict`: `ready | needs-answers | not-ready`.
- Every merged finding id appears once across `accepted` and `declined`.
- Each merge conflict gets one row with a `ruling`. Rule `compatible` with a non-empty `merged_claim` when the claims can all be true at once; rule `pick` with a `recommendation` that is one of its claims verbatim only when following one claim means not following another. Never pick between claims that agree.
- A gap's `question` is optional.
- `renames` is optional: for each voice warning, rename the finding's target to the project's word, or leave it out when the word stands. Every `id` must be one the merge knows.
