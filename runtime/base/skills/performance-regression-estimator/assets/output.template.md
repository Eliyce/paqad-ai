## Performance Hazards

### Hazard Map

| #   | Hazard                         | Path            | On hot path?   | Severity           | Remediation |
| --- | ------------------------------ | --------------- | -------------- | ------------------ | ----------- | ------ | ----- | ---------------- |
| 1   | {{N+1 query inside .map(...)}} | `{{file:line}}` | {{yes (GET /x) | no (nightly job)}} | {{high      | medium | low}} | {{concrete fix}} |

### Recommended Pre-Merge Actions

1. `{{file:line}}` — {{remediation summary}}.

### Open Questions

- {{paths whose hot-path status could not be confirmed; "none" allowed}}

<!-- If no hazards are detected, replace this entire body with the literal: -->
<!-- Performance Hazards: none detected. -->
