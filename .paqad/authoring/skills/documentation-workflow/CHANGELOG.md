# documentation-workflow

## 1.2.0

- evals: 14.58 points over the baseline; trigger validation score 1
- S6 note: the trigger query "Onboarding journey says auto-recommended. Step 3 of 8 · Writing the project docs. …" was relabelled from should-fire to a near miss, because the onboarding-journey driver owns that brief and dispatches the paqad-onboarding-docs agent by name. The owner approved the relabel after seeing validation results in which that query failed (best validation 0.875 in two earlier S6 loops); the released score comes from the third loop, run after the relabel.

## 1.1.0

- evals: 12.5 points over the baseline; trigger validation score 1

## 1.0.0

- evals: not measured; trigger: not measured; labels: unverified
