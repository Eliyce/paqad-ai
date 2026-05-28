<!--
Markdown summary template for the reconciler's output block.
Fill `## Reconciliation Findings` from `count-by-code.sh` output and
`## Pending User Decisions` from each surfaced Decision Pause packet.
-->

## Reconciliation Findings

<!-- One line per code with count > 0; populate from `count-by-code.sh`. -->

- `MM-ADD`: {{count}}
- `MM-FEAT-ADD`: {{count}}
- `MM-REMOVE`: {{count}}
- `MM-FEAT-STALE`: {{count}}
- `MM-DOC-ORPHAN`: {{count}}
- `MM-DOC-MISSING`: {{count}}
- `MM-MISMATCH`: {{count}}

## Pending User Decisions

<!-- One bullet per surfaced Decision Pause packet — question + selected option. -->

- **{{question}}** — {{selected_option}}
