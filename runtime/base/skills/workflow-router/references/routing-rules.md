# Workflow Router Rules

verified: 2026-11-02

Use deterministic request-pattern matching to select one canonical workflow. Prefer the highest-priority matching rule, then the most specific pattern. If no rule matches, return no workflow.
