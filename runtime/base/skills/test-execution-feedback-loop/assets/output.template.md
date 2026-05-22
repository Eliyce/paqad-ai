## Fix Proposals

### Failure {{N}} — {{gate}} > {{ac_id}} — {{short test name}}

- **AC:** {{ac_id or "untraced"}}
- **Failure category:** {{test-failure | test-error | test-timeout | gate-failure}}
- **Anchor:** `{{file}}:{{line}}`
- **Observed vs expected:** {{short excerpt from failure message}}
- **Root cause hypothesis:** `{{file}}:{{line}}` — {{one-sentence cause}}
- **Proposed fix:** {{smallest change; never weakens the test}}
- **Risk if applied:** {{low | medium | high — single line}}
- **Confidence:** {{high | medium | low}}

### Failure {{...next or combined}}

Total failures: {{N}} | Combined into {{M}} proposals | High-confidence: {{H}} | Defer to human: {{D}}

<!-- If the evidence has no failures, replace this entire body with: -->
<!-- Fix Proposals: none — verification passed. -->
