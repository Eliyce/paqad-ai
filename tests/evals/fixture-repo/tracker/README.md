# Fixture tracker

Invented tracker content for testing only. None of these tickets, sprints, keys, people or links
are real; they exist so the S1b conversation scenarios (refine-ticket, size-work, plan-sprint) have
a stable board to read against when the host eval runner stands up a fake tracker in S3.

The fake tracker reads two files:

- `tickets.json` holds the board's tickets, each with a `key`, `summary`, `description`, `labels`,
  `parent`, `links`, `status`, `size`, `sprint` and `last_updated`. A `null` field means unset.
  Keys are grouped by the fixture module they belong to (`SUB` subscriptions, `ORD` orders,
  `DEX` data-export). Finished tickets carry a `size` so size-work has comparables; open tickets
  carry a `null` size until they are sized.
- `sprints.json` holds the sprint board: the one future sprint the team is planning, the last three
  completed sprints with their committed and completed totals so capacity can be derived, and the
  candidate pool the planner draws from.

Rich content in a description is written with text markers so a plain JSON fixture can still carry
it: `[image: ...]` for an embedded image and `[panel: ...] ... [/panel]` for a panel. refine-ticket
must never replace a description that holds either with plain text (INV-7, AC-32).

Some tickets are deliberately shaped to exercise one scenario each:

- `SUB-42` is vague, carries a jargon word and contradicts a documented business rule (AC-30).
- `SUB-55` has an image and a panel in its description (AC-32).
- `SUB-60` is really three pieces of work under epic `SUB-1` (AC-33).
- `SUB-20`, `SUB-21`, `SUB-22`, `ORD-15` are finished and sized, as size-work comparables (AC-35).
- `DEX-30` has no size and `DEX-31` depends on an unfinished ticket outside the sprint (AC-39).
