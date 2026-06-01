# Observability

- Log meaningful events with enough structured context (identifiers, operation, outcome) to trace a request or job end-to-end.
- Never log secrets, credentials, or personal data.
- Fail loudly: surface errors with actionable messages and do not swallow exceptions silently.
- Make externally observable failures diagnosable from logs and metrics alone, without reproducing locally.
