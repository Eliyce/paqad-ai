---
name: plan-sprint
description: Propose a sprint plan for the team to take into planning, as a consultant, not a decider. Use it when someone asks to "plan the next sprint", "fill the sprint", or "see what fits". It finds the target sprint through the sprint field, finds capacity by asking or offering one derived from the last three completed sprints shown with its numbers, and filters the backlog to ready tickets. It proposes a goal, the tickets that fit in priority order within capacity, stretch tickets, what was left out and why, the total against capacity, and the risks. It applies only on an explicit "apply it", setting the sprint field on the chosen tickets alone and reading each back. It never creates, starts, closes, renames or reorders a sprint or the backlog, and gives a by-hand list when the sprint field cannot be set. Produces the sprint_plan block of the record.
---

# plan-sprint

How to talk: before replying, follow `references/voice.md`. Short by default, lead with the answer,
plain business words, no narration, one short sources line at the end. Those rules win over
everything else here.

## When this runs

Starts when the user asks to plan a sprint ("plan the next sprint", "what fits in the sprint?", "fill
the sprint"). You may invite direct use. The plan is a proposal for the team's planning meeting; the
team decides, not the plugin (SPR-5).

## What it does

Propose a sprint plan. The full procedure is in `references/sprint-procedure.md`; Jira fields and
tool-name variants are in `references/tracker-profiles-jira.md`.

1. Find the sprint (SPR-1). Identify the target sprint through the sprint field of issues on the
   board, usually the next future sprint or one the user names. If no future sprint exists, say so and
   create nothing: the user or their scrum master creates a sprint in the tracker (AC-41).
2. Find the capacity (SPR-2). Ask the user for the team's capacity, or offer one derived from the last
   three completed sprints (the total size finished in each), labelled as derived, with the numbers
   shown. Never invent a capacity.
3. Choose ready candidates (SPR-3). Start from the ordered backlog the user points to. A candidate is
   ready when it passes the ticket checks, has a size, and its dependencies are done or in the same
   sprint. List unready candidates separately with what each one needs, and point them to
   `refine-ticket` or `size-work`.
4. Propose the plan (SPR-4). Show the suggested goal in business words, the fitting tickets in the
   user's priority order within capacity, the stretch tickets, what was left out and why, the total
   against capacity, and the risks (dependencies outside the sprint, template-documented areas, one
   person holding too much). Build this with `scripts/fit_sprint.py plan --sprint-field <id>
   --candidates <candidates.json> --history <last-three-sprints.json> [--target-sprint <sprint>]`.
5. Consult, do not decide (SPR-5). Offer trade-offs when the plan does not fit ("dropping ABC-12 makes
   room for the two refund tickets, which serve the goal better"). The user decides.
6. Apply on approval only (SPR-6). After an explicit "apply it" for that exact plan, set the sprint
   field on the chosen tickets only with `scripts/fit_sprint.py apply --plan <plan.json>
   --expect-digest <d> [--tracker-state <state.json>]`, bound to the plan digest. `--tracker-state`
   is optional: include it, mapping each ticket ref to the sprint the host set, to read the chosen
   tickets back; with no tracker-state file the read-back is a clean skip, not a mismatch, and you
   read each ticket back by hand with `scripts/check_readback.py`. Report partial results honestly.
7. Stay within the limits (SPR-7). Never create, start, close, rename or reorder a sprint, never
   reorder the backlog or the board, and never change the sprint goal field unless the user asks for
   that exact text. If the sprint field cannot be set, give the plan as a by-hand list the user can
   apply in the tracker (U-14); `fit_sprint.py` returns `by_hand` true for this.

Record state is kept through `scripts/record.py` and checked with `scripts/check_record.py` (plan
mode); digests use `scripts/canonical.py`.

## If the checks cannot run

When no tool can run the scripts, plan by hand with this checklist:

- Find the target sprint through the sprint field; if no future sprint exists, say so and create
  nothing.
- Get the capacity from the user, or offer one derived from the last three completed sprints, labelled
  as derived with the numbers shown; never invent one.
- Filter the backlog to ready tickets: passes checks, has a size, dependencies done or in the sprint.
  List unready ones separately with what each needs.
- Propose the goal, the fitting tickets in priority order within capacity, stretch, left-out-with-
  reasons, the total against capacity, and the risks.
- Offer trade-offs; let the user decide.
- Apply only on an explicit "apply it" for that exact plan, setting the sprint field on the chosen
  tickets only; any edit to the plan voids the approval. Read each back and report partial honestly.
- Never create, start, close, rename or reorder a sprint or the backlog. If the sprint field cannot be
  set, hand over the plan as a by-hand list.

## Output

Fills the `sprint_plan` block of the record (plan mode): the sprint, the capacity with what it was
derived from, the goal, the chosen and stretch tickets, the left-out tickets with reasons, the total,
the risks, the `by_hand` flag, and the plan digest. The applied tickets and the read-back result are
reported to the user in plain words.
