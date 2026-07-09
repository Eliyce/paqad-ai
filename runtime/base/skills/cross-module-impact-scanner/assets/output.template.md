## Cross-Module Impact

### Impact Map

| Surface | Type | Consumer | Severity | Coordinated change |
| ------------------------- | ---------------- | ----------- | ---------- | ------------------ | ------------ | --------------- | --------------------------------------- |
| `{{POST /users payload}}` | {{API contract}} | {{billing}} | {{breaking | additive           | silent-shift | internal-only}} | {{minimum change required in consumer}} |

### Decision Packets Required

<!-- Include only when any breaking or silent-shift impact has no deprecation window. -->

1. Decision Packet: `{{api-breakage|event-contract-breakage|schema-breakage|config-breakage}}` — {{one-line description}}.

### Open Questions

- {{surfaces that could not be classified from available docs; "none" allowed}}

<!-- If the change has only internal-only impacts, replace this entire body with: -->
<!-- Cross-Module Impact: internal-only — no consumers affected. -->
