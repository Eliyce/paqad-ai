# The idea journey

Six steps, in order. Each step has a purpose, a step skill that does the work, and an exit
condition: the record block that must be present and not stale before the journey moves on. Show
each step change as one short line (TALK-12).

## Step 0. Get connected (get-connected)

Purpose: confirm the project documents are reachable and onboarded, and the tracker can be written
to. Read the tracker project's setup.

Exit condition: the `setup` block is filled (tracker kind, project key, issue types, required
fields, link types, size and sprint field ids, can-create, run label).

## Step 1. Your idea (understand-idea)

Purpose: one question at a time until the goal, who benefits, what success looks like and the
constraints are clear.

Exit condition: the `idea` block has goal, who_benefits, success and constraints.

## Step 2. What exists today (ground-in-project)

Purpose: read the project documents in reading order, find the related areas, report what they do,
what is unknown and anything that conflicts.

Exit condition: the `today` block lists each related area with its source path and, per section,
whether it is real or template.

## Step 3. Shape it (shape-idea)

Purpose: play the idea back starting with the goal, look through the expert lenses, offer options
and trade-offs, a smaller first step where useful, and a recommendation.

Exit condition: the `playback` block has the goal-first playback, lenses, options, the smaller
first step and a recommendation.

## Step 4. Decide (decide-together)

Purpose: settle the open choices one at a time, record each decision with who decided and why, and
record accepted defaults as assumptions. Set the outcome (CON-8).

Exit condition: the `decisions` block has each decision, and the `outcome` block has the type,
reason and next action.

## Step 5. Draft and check (write-tickets, then check-tickets)

Purpose: draft the epics and tickets, then check them for gaps, duplicates, jargon and untestable
outcomes, fix, and check again.

Exit condition: `ticket_set_ref` points to the ticket set with its digest and revision, and
`readiness` records the checks as passed or lists what is still open.

## Step 6. Post (post-tickets)

Purpose: recommend the outcome. For build: show the final set and, on an explicit "post it", create
it in the tracker, read back and return the links. For any other outcome: give a short written
summary and offer to post a single tracker item if the user wants one.

Exit condition: the `posted` block records each item as created, uncertain or not applied, with the
read-back result.

## Going back: the invalidation map

When an earlier block changes, these later blocks go stale, in this exact order. Raise the revision
by one, mark the dependents stale, and keep every block not listed.

| Changed block | Dependents marked stale |
|---|---|
| idea | today, playback, decisions, ticket_set_ref, readiness, posted |
| today | playback, decisions, ticket_set_ref, readiness, posted |
| playback | decisions, ticket_set_ref, readiness, posted |
| decisions | ticket_set_ref, readiness, posted |
| ticket_set_ref | posted |
| readiness | posted |

run, setup, glossary and assumptions are not dependents of a goal change, so an unrelated decision
survives a goal change. A required block that is present but stale counts as not satisfied, so the
step that owns it is redone before the journey moves on.
