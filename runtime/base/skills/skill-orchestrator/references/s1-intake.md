# S1 intake

verified: 2026-10-31

Fill every field from the frozen spec, the ticket, the task trace and the project docs, in the project's own words (the Project voice vocabulary).

```yaml
purpose: '<what the skill enables, one sentence>'
triggers: ['<phrase or situation>']
output_format: '<file, JSON shape, report template, or free text>'
verifiability: objective
skill_class: workflow
scope: { in: ['<in scope>'], out: ['<out of scope>'] }
dependencies: ['<package@version or none>']
```

`verifiability` is objective or subjective. `skill_class` picks the S5 test type:

| Class      | S5 test type                                |
| ---------- | ------------------------------------------- |
| discipline | pressure scenarios                          |
| technique  | application and missing-information tests   |
| pattern    | recognition and counter-examples            |
| reference  | retrieval and gap tests                     |
| workflow   | an end-to-end run with checklist completion |

When nothing the project holds answers a field, ask the owner with `paqad-ai skill intake <name> --gap <field> --question "<question>" --option "<a>" --option "<b>" --recommend "<a>"`. Offer two to four answers in the project's words.
