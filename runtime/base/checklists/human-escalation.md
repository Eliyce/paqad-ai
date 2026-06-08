# Human Escalation

- Escalate destructive changes.
- Escalate unresolved policy conflicts.
- Escalate blockers caused by missing external access.

## Stuck after N build-check-fix rounds (issue #108)

The build-check-fix loop runs quietly: the person is not shown intermediate
rounds or the problems found and fixed within them — that is plumbing. The
round-by-round record is kept internally
(`.paqad/session/build-check-fix-rounds.json`) for the agent's own use, not
surfaced.

- Stopping is a clean, predictable rule, not a vague giving-up. The loop stops
  when the work is done (`isDone()`), at the lane-scaled `max_rounds` cap, or
  when futility detection sees no net progress across rounds.
- On stopping unclean, emit **exactly one** honest report via the `stop`
  escalation: where it stands (failing gate / acceptance criterion), the last
  evidence, how many rounds were used, and the one or two things a human must
  decide. No per-round spam, nothing buried.
- A slice that exhausts its per-slice retry attempts (the circuit breaker)
  feeds the feature-level round/stop decision — it does **not** produce a
  separate user message. One honest "stuck" report, not two.
