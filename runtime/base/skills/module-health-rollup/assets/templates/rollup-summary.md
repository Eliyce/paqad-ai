<!--
Markdown summary template for the rollup's output block.
Fill `## Module Health Rollup` from the rollup report and
`## Unattributed Coverage Files` from `list-unattributed.sh`.
-->

## Module Health Rollup

<!-- One row per module. blocked-metrics column populated from
     `list-blocked-metrics.sh`; leave `—` when nothing is blocked. -->

| Module     | Tier     | Coverage %       | Tests                               | Blocked metrics     |
| ---------- | -------- | ---------------- | ----------------------------------- | ------------------- |
| `{{slug}}` | {{tier}} | {{coverage_pct}} | {{tests_passing}} / {{tests_total}} | {{blocked_metrics}} |

## Unattributed Coverage Files

<!-- One path per line from `list-unattributed.sh`. These are MM-ADD
     candidates — hand off to the module-map reconciler. Omit the section
     entirely when the list is empty. -->

- `{{path}}`
