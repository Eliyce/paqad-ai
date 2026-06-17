<!--
Markdown summary template for the update workflow's output block.
Fill `## Module Health Update` from the refresh report (one row per module,
tier read back from .paqad/module-health/<slug>.json). The `Updated` column is
"yes" for slugs from `list-updated.sh`. The blocked-metrics column is populated
from `list-blocked-metrics.sh`; leave `—` when nothing is blocked.
`## Unattributed Coverage Files` is filled from `list-unattributed.sh`.
-->

## Module Health Update

| Module     | Tier     | Updated this run | Blocked metrics     |
| ---------- | -------- | ---------------- | ------------------- |
| `{{slug}}` | {{tier}} | {{updated}}      | {{blocked_metrics}} |

## Unattributed Coverage Files

<!-- One path per line from `list-unattributed.sh`. These are MM-ADD
     candidates — hand off to the module-map reconciler. Omit the section
     entirely when the list is empty. -->

- `{{path}}`
