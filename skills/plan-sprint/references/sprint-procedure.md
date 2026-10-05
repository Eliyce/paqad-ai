# Sprint procedure

The ordered procedure for proposing a sprint plan, with the SPR limits and the by-hand fallback.
Follow it top to bottom. The rules are SPR-1 to SPR-7.

## 1. Find the sprint (SPR-1)

Identify the target sprint through the sprint field of issues on the project's board, usually the next
future sprint or one the user names. If no future sprint exists, say so and create nothing: the plugin
cannot create a sprint, and the user or their scrum master does that in the tracker (AC-41).
`scripts/fit_sprint.py plan` reports this and returns no plan to apply when there is no future sprint.

## 2. Find the capacity (SPR-2)

Ask the user for the team's capacity, or offer one derived from the last three completed sprints: the
total size of work finished in each. Label it as derived and show the numbers it came from. Never
invent a capacity. `fit_sprint.py plan` takes `--history <last-three-sprints.json>` and returns the
capacity with a `derived_from` list of the three sprint identifiers and their counts, so the derivation
is visible.

## 3. Filter readiness (SPR-3)

Start from the ordered backlog the user points to. A candidate is ready when all of these hold:

- It passes the ticket checks (section 8.5 of REQUIREMENTS.md).
- It has a size.
- Its dependencies are done or are in the same sprint.

List unready candidates separately with what each one needs, so the user can send them to
`refine-ticket` or `size-work`. `fit_sprint.py plan` returns a `not_ready` list of `{ ref, needs }`
entries (AC-39). Readiness is a filter, not a rejection: an unready ticket is surfaced with its gap,
not dropped silently.

## 4. Propose the plan (SPR-4)

Show, from `fit_sprint.py plan`:

- The suggested sprint goal in business words.
- The fitting tickets, in the user's priority order, within capacity.
- The stretch tickets.
- What was left out and why.
- The total against the capacity.
- The risks: dependencies outside the sprint, tickets on template-documented areas, and one person
  holding too much work when assignees are set.

## 5. Consult, do not decide (SPR-5)

Offer trade-offs when the plan does not fit, for example "dropping ABC-12 makes room for the two
refund tickets, which serve the goal better". The user decides. The plan is a proposal for the team's
planning meeting, not a decision the plugin makes.

## 6. Apply on approval (SPR-6)

After an explicit "apply it" for that exact plan, set the sprint field on the chosen tickets only.
Bind the write to the plan digest: `scripts/fit_sprint.py apply --plan <plan.json> --expect-digest
<d>` refuses when the digest does not match, so an edited plan is never applied under an old approval.
Read each chosen ticket back with `scripts/check_readback.py` to confirm it landed in the sprint, and
report partial results honestly. Nothing outside the chosen set changes.

## 7. Limits (SPR-7)

The plugin never:

- Creates, starts, closes or renames a sprint.
- Reorders the backlog or the board.
- Changes the sprint goal field unless the user asks for that exact text.

If the connector cannot set the sprint field, give the plan as a by-hand list the user can apply in
the tracker (U-14). `fit_sprint.py plan` returns `by_hand` true in that case, and the plan is still a
complete, ordered list the user can act on manually.
