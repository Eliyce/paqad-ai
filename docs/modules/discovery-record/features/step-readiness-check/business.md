# Step readiness check: business

## Overview

Before the run moves on, or when a run is resumed, the plugin checks whether the current step has what it needs: each required section filled in and not out of date. The check only reads; it changes nothing. It tells a resumed run exactly what still has to be redone.

## User Roles

| Role | What they do |
|---|---|
| Business user | Sees a run continue only when the step is complete |
| The plugin's skills | Ask the check before moving on or on resume |

## User Flows

| Flow | What happens |
|---|---|
| Before moving on | The check lists any missing or out-of-date section for the current step (REC-3). |
| On resume | The check tells which sections must be redone after a go-back (AC-15). |

## Business Rules

| Rule | Detail |
|---|---|
| Filled and current | A section must hold content and must not be marked out of date. |
| Out of date is not done | A filled but out-of-date section counts as not satisfied. |
| Mode aware | Building an idea uses steps 0 to 6; refining, sizing and planning use their own required sections. |
| Read only | The check never changes the record. |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Step change or resume | A pass or a list of problems; no change to the record |

## Error States

| Situation | What the user sees |
|---|---|
| Required section empty | Named as missing |
| Required section out of date | Named as needing to be redone |
| Record has no run details | Reported as a broken record |
| Unknown step in build mode | Reported as an unknown step |

## Glossary

| Term | Meaning |
|---|---|
| Required section | What a step must produce before the run moves on |
| Stale | Out of date after an earlier answer changed |

Sources: shared/scripts/check_record.py, shared/scripts/record.py.
