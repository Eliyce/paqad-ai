# Rollback Procedure Template

Every story flagged with `reversibility: hard` or `blast-radius: wide` must populate this template before the story is marked ready for implementation.

## Required fields

```markdown
### Story {S-N} — {short name}

- **Reversibility class:** `hard` | `irreversible-with-data-loss`
- **Blast radius:** `moderate` | `wide`
- **Trigger that requires rollback:** the specific signal (failed health check, error rate spike, customer report, regulatory request) that would prompt rolling back.
- **Time-to-rollback:** target window in minutes/hours from the trigger to the system being safe again.
- **Rollback steps:** numbered list of concrete operator actions, in order. Each step must be:
  - executable by the on-call without consulting the original implementer
  - idempotent (safe to retry)
  - verifiable (each step has a check that confirms it succeeded)
- **Forward-only rollback notes:** if the change is not byte-for-byte reversible (e.g. data migration), describe the forward-only recovery path and what data, if any, is permanently lost.
- **Drill plan:** how the team will rehearse this rollback before the change reaches production. `none` is not an acceptable answer for irreversible-with-data-loss changes.
```

## What disqualifies a rollback procedure

- "Revert the commit" alone — that does not reverse data migrations or external side effects.
- Steps that require the original implementer's tacit knowledge.
- Steps that depend on infrastructure that is itself part of the change.
- "Restore from backup" without a target Recovery Point Objective and the actual backup retention window.

## Coupling to deployment

When the change is delivered behind a feature flag or kill switch, list the flag name and where it can be flipped. The flag is the first rollback step, ahead of any code revert or data restore.
