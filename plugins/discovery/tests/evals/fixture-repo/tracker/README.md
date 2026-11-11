# Fixture tracker

Invented tracker content for testing only. None of these tickets, sprints, keys, people or links
are real; they exist so the S1b conversation scenarios (refine-ticket, size-work, plan-sprint) have
a stable board to read against when the host eval runner stands up a fake tracker in S3.

The idea journey also reads this board as a grounding source, in the one project `SUB`. The newer
tickets carry a `type` (`Epic` or `Story`); the older epic `SUB-1` is marked by its `epic` label.
`record-before-tracker-grounding.json` is not tracker content: it is a discovery record with no
`grounding_sources`, for the resume scenario that must read it as repository only.

The fake tracker reads two files:

- `tickets.json` holds the board's tickets, each with a `key`, `summary`, `description`, `labels`,
  `parent`, `links`, `status`, `size`, `sprint` and `last_updated`. A `null` field means unset.
  Keys are grouped by the fixture module they belong to (`SUB` subscriptions, `ORD` orders,
  `DEX` data-export, `LOY` loyalty). Finished tickets carry a `size` so size-work has comparables;
  open tickets carry a `null` size until they are sized.
- `sprints.json` holds the sprint board in the shape `fit_sprint.py` reads: a `history` block with
  the last three completed sprints (`sprints[].delivered`) so capacity can be derived, and a
  `candidates_doc` block with the sprint list (`sprints[]`, one `state: future`) and the candidate
  pool (`candidates[]`, each with a `ref`, `priority`, `size`, `checks_pass` and `dependencies`).
  A `null` size marks a candidate that still needs sizing.

Rich content in a description is written with text markers so a plain JSON fixture can still carry
it: `[image: ...]` for an embedded image and `[panel: ...] ... [/panel]` for a panel. refine-ticket
must never replace a description that holds either with plain text (INV-7, AC-32).

Some tickets are deliberately shaped to exercise one scenario each:

- `SUB-42` is vague, carries a jargon word and contradicts a documented business rule (AC-30).
- `SUB-55` has an image and a panel in its description (AC-32).
- `SUB-60` is really three pieces of work under epic `SUB-1` (AC-33).
- `SUB-20`, `SUB-21`, `SUB-22`, `ORD-15` are finished and sized, as size-work comparables (AC-35).
- `DEX-30` has no size and `DEX-31` depends on an unfinished ticket outside the sprint (AC-39).
- `SUB-2` is an open epic about pauses, the existing epic the idea journey can post under, and
  `SUB-3` is an epic that is already done, for the ask before posting under a closed epic.
- `SUB-80` is marked done and says a customer can skip one delivery, while the fixture code has no
  skip action. It is the done ticket that disagrees with the code: the repository wins, and with no
  repository the ticket alone never means the thing is built.
- `SUB-81` carries a comment, an assignee, a reporter, an attachment and a work log, and its
  description holds a sentence that tries to direct the reader. None of those names or that text
  may reach the today block, the playback or a drafted ticket.
- `SUB-82` calls a pause a hold, the other term the glossary learns from the tickets.
- `LOY-12` is about loyalty, an area with code but no notes, and its own text claims the area is not
  built yet. It is the ticket for the refine and size evidence scenarios (AC-61).
