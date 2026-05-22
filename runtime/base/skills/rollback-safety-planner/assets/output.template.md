## Rollback Plans

### S-{{N}} — {{short story name}}

- **Trigger:** {{condition that demands rollback (alarm, metric threshold, customer report)}}
- **Time-to-rollback:** {{target — e.g. "≤ 5 min from trigger to recovery"}}
- **Steps:**
  1. {{idempotent, verifiable, on-call-runnable step (cite flag/script/command)}}
  2. {{...}}
- **Verification:** {{post-rollback check — metric/query/probe with expected value}}
- **Forward-only recovery:** {{when applicable: data permanently lost on rollback / required reconciliation}}
- **Drill:** {{when and how to dry-run this procedure}}

### S-{{...next story}}

Coverage: Stories needing rollback plans: {{N}} | Plans drafted: {{M}} | Open Questions: {{K}}

<!-- If no stories require a rollback plan, replace this entire body with the literal: -->
<!-- Rollback Plans: none required (all stories have easy reversibility and isolated blast radius). -->
