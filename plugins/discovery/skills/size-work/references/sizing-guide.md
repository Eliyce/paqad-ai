# Sizing guide

How to turn finished work into a labelled suggested size. Follow it in order. The rules are EST-1 to
EST-7.

## 1. Find the team scale (EST-1)

At first use, find how the project sizes work:

- Story points, and which field holds them.
- T-shirt sizes (for example XS to XL).
- Nothing, the team does not size.

Look in the tracker configuration and in recently finished tickets before asking. If it cannot be
found, ask once, then remember the answer in the record so later sizings reuse it rather than asking
again.

## 2. Pick comparables (EST-2)

Find similar completed tickets in the same project and read their recorded sizes. Match on:

- Module or area of the product.
- Labels and components.
- Key phrases in the summary and description.

Use the two to five closest, each with a link. Fewer than two is reported honestly as a thin basis;
never invent comparables to reach a number. The comparables are the evidence for the suggestion, so
show them.

## 3. Derive the drivers (EST-3)

State what drives the size, in plain words, for example:

- "touches two areas" (more surface, more size).
- "new rules for refunds" (new logic, not a copy of existing work).
- "the docs on this area are a blank template" (unknowns, which also lowers confidence).

The drivers explain the number so the team can challenge it. A size with no drivers is not useful.

## 4. Set the confidence (EST-3)

Give a confidence of low, medium or high:

- High: several close comparables, clear documents, little unknown.
- Medium: some comparables, some unknowns.
- Low: few comparables, large unknowns, or the size itself is big.

Lower the confidence and state the reason when the area's documents are template text or missing: the
unknowns are real and the team should see them. `scripts/compare_sizes.py suggest` takes
`--area-docs <docs.md>` and lowers the confidence with a stated reason when those docs are template
text (AC-36).

## 5. Recommend a split when it is big (EST-4)

If the suggestion is above what the team usually finishes in a sprint, or confidence is low because of
size, recommend how to split the work and point the user to `refine-ticket` to carry the split out.

## 6. Present it as a labelled suggestion (EST-5, EST-7)

Show the result as a "suggested size" with its basis: the size or range, the drivers, the confidence,
and the comparables with links. Never present it as a delivery date or a promise, and never derive a
date from it. A size is a labelled suggestion, never written as fact (EST-7, TKT-5).

## 7. Writing a size (EST-6)

By default the suggestion is shown, or added as a comment if the user asks. Writing into the size
field needs an explicit "set it". Guard the write with `scripts/compare_sizes.py set --field-value
<current> [--replace]`:

- If the field is empty, the write is allowed.
- If the field already holds a value, the write is refused unless `--replace` is given, so an existing
  size is never overwritten silently (AC-37).
