# S6 delegation

verified: 2026-11-01

A dispatched agent skips this stage: `paqad-ai agent delegation plan <name>` records the skip.

1. Write 8 to 10 requests that should delegate to the agent and 8 to 10 near misses that should not.
2. Run `paqad-ai agent delegation plan <name> requests.json`. It splits them 60/40 into train and validation with seed 42.
3. Run each request three times per description and revise the description from train failures only.
4. Check 5 to 10 fresh requests on the host after the last iteration.
5. Run `paqad-ai agent delegation record <name> results.json`. The best validation score at or above `agent_delegation_threshold` wins and goes into the draft.
