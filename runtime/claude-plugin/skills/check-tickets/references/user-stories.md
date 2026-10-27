# User stories and acceptance criteria

This is the single source for how a ticket is written as a user story (TKT-6). write-tickets drafts
by it and check-tickets judges by it. The canonical ticket set does not change: each acceptance
criterion is one `done_when` item, refs stay E1-T1, and a ticket keeps 2 to 8 criteria.

## Contents

- Two hard filters
- Intake before drafting
- The line-break rule
- The story: role, I want, So that
- Acceptance criteria
- Permissions in the criteria
- The silent self-audit
- API then UI
- Refusal
- Titles and the rest of the ticket
- Worked example

## Two hard filters

1. Real user value. Every ticket has a So that line naming a real outcome for a named role. If the
   value cannot be put in plain words, it is not a user story.
2. Implementation-clear. Anyone reading the ticket knows what success looks like and what gates the
   work, without having to ask.

## Intake before drafting

Settle these before any ticket is written. Ask only for what is missing, one short question at a
time, through the host's choice prompt.

- Implementation Target: API or UI, never both. A piece that needs both is two tickets, the API
  ticket first.
- Module Name: the plain area name from the today block or the project's module list. When it is
  not obvious, ask once.
- Feature Name and Roadmap Reference: optional. Include a line only when the user gave it; never
  write "N/A" and never ask for them.
- Permissions: when the capability is gated, infer the key as can verb noun from the role and the
  capability (a team admin who invites people: `can invite user`). Confirm it through the choice
  prompt before drafting, with "Use another key" as the write-in. Use exactly the key the user
  confirms; never invent one. A public capability (sign up, a public page) has no permission
  criterion and no permission question.

## The line-break rule

Markdown joins single lines into one run-on sentence. So every line inside a multi-line block ends
with two trailing spaces, which the reader sees as a line break. This applies to the header lines,
the As a, I want and So that block, and every Given, When, Then, And or But line of a criterion.
The last line of each block needs none, because a blank line follows. In a `done_when` item the
lines are joined by two trailing spaces and a newline. Check the breaks before showing a ticket.

## The story: role, I want, So that

- Role: specific, for example first-time saver, team admin, invited user, signed-in member. Use a
  plain "user" only when it is truly everyone. Never developer, platform or system: that is an
  engineering task wearing a story, so find the real person behind it or refuse.
- I want: the capability in plain words, not how it is built. "I want to see every saving I have
  planned this month", not "I want a list call that returns my savings".
- So that: the real outcome. Not the build ("so that the screen can show a list") and not vague
  ("so that I can manage my account").

## Acceptance criteria

An acceptance criterion is a condition the work must meet to be accepted, written as behaviour the
role can observe. One bullet per criterion. Inside it, Given, When and Then are bold, each on its
own line; And or But continue the same criterion and never start a new bullet. A criterion may
name state ("Given the member is signed in") but never another ticket ref. Describe any response in
plain words ("the saver is told they cannot see it"), never a code or status name. Keep 2 to 8
criteria per ticket.

## Permissions in the criteria

A gated capability carries its confirmed key inside the criteria as inline code, with one positive
and one negative criterion. There is no separate permissions line.

- Positive: Given the member has `can view savings`, When they open the calendar, Then their
  planned savings are shown.
- Negative: Given the member does not have `can view savings`, When they open the calendar, Then
  they are told they cannot see it.

## The silent self-audit

Before showing any ticket, walk these ten concerns silently. Never show the list or the reasoning;
show only the criteria it produced. Add a criterion for any concern that applies and is missing.

1. Happy path: always.
2. At least one failure path: always (bad input, a clash, not found, or a system it relies on
   failing).
3. Permission-positive: when the capability is gated.
4. Permission-negative: when the capability is gated.
5. Repeat-safe: when the action can be repeated (a double tap, a retry).
6. Linked records: what happens to related records when one is created or deleted.
7. Rate limit: when the action is limited in how often it can run.
8. Edge inputs: empty, longest allowed, special characters.
9. Two people on the same record at once.
10. Empty, loading and error states: when the target is UI.

When the audit needs more than 8 criteria, split the ticket into two stories, each with 2 to 8.

## API then UI

When a feature needs both, write the API ticket first and the UI ticket second, whose Depends on
names the API ticket's ref (for example E1-T2 depends on E1-T1). Give them different titles. API
criteria are what the system returns or keeps; UI criteria are what the user sees and does, and
assume the API works. When only one applies, write only that one; never invent the missing half.

## Refusal

Refuse in one line when, after one honest try to find the user value, there is none: a pure code
change (rename a table, tidy up the code) or work whose only role is developer, platform or system.
Say: "This is an engineering task with no user-facing outcome, so it is not a story." Then offer,
through the choice prompt, to leave it out or to name the user pain it removes. Never invent a So
that line to fill the format. Most such work does have a user outcome (faster, more reliable,
cheaper, more trusted); try once to name it before refusing.

## Titles and the rest of the ticket

- Title: under about 10 words and at most 80 characters, action-oriented. The preview shows
  "E1-T1: title".
- Depends on: refs or tracker keys, or "Depends on: none" when there are none.
- After Depends on come What exists today, Not included (required), Open questions (optional) and
  Sources (last, with the run label and item reference).
- No product, library or tool names, no file paths and no web addresses in the story or criteria.

## Worked example

Two paired tickets for a savings calendar. Every line but the last of each block ends with two
trailing spaces, not shown here.

```
E1-T1: Keep each member's planned savings
**Implementation Target:** API
**Module Name:** `Savings`
**Epic:** E1 Plan savings on a calendar

**As a** signed-in member,
**I want** my planned savings kept by date,
**So that** I can see what I will put aside each week.

**Acceptance Criteria**
- **Given** the member has `can view savings`,
  **When** they ask for this month,
  **Then** every planned saving for the month is returned by date.
- **Given** the member does not have `can view savings`,
  **When** they ask for this month,
  **Then** they are told they cannot see it.
- **Given** a saving was already planned for a date,
  **When** the same saving is sent twice,
  **Then** it is kept once.

**Depends on:** none
```

The UI ticket, E1-T2 "Show planned savings on the calendar", targets UI, has the same role and an
I want of seeing the month at a glance, carries criteria for the shown savings, the empty month,
loading, an error with a way to try again, and the negative permission case, and ends with
"Depends on: E1-T1".
