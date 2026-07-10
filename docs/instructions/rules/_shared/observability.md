# Observability

- Log meaningful events with enough structured context (identifiers, operation, outcome) to trace a request or job end-to-end. <!-- @rule RL-6f5e -->
- Never log secrets, credentials, or personal data. <!-- @rule RL-493d -->
- Fail loudly: surface errors with actionable messages and do not swallow exceptions silently. <!-- @rule RL-6a20 -->
- Make externally observable failures diagnosable from logs and metrics alone, without reproducing locally. <!-- @rule RL-3f55 -->
