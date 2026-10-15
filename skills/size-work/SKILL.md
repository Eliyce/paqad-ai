---
name: size-work
description: Suggest a size for a ticket from comparable finished work, as a labelled suggestion the team still owns. Use it when someone asks "how big is this?", "roughly how much work is ABC-12?", or wants a backlog item sized. It finds the team's sizing scale at first use, picks two to five of the closest finished tickets with links, and gives a size or range with the drivers behind it and a confidence of low, medium or high, lowered and explained when the area's documents are template text. Every result is labelled a suggested size, never a date or a commitment. It writes nothing into the size field unless the user says "set it", and it refuses to overwrite an existing size unless the user asks to replace it. Produces the sizing block of the record.
---

# size-work

How to talk: before replying, follow `references/voice.md`. Short by default, lead with the answer,
plain business words, no narration, one short sources line at the end. Those rules win over
everything else here.

## When this runs

Starts when the user asks for a size ("how big is this?", "size ABC-12", "roughly how much work is
this?"). You may invite direct use. A size from this skill is always a suggestion for the team; the
team still owns the number.

## What it does

Suggest a size from finished work. The full method is in `references/sizing-guide.md`; Jira fields and
tool-name variants are in `references/tracker-profiles-jira.md`. Only when you read area documents,
get them as in `references/connect-repository.md`; missing documents still only lower confidence.

1. Find the team scale (EST-1). At first use, find how the project sizes work: story points and which
   field holds them, T-shirt sizes, or nothing. Ask once if it cannot be found, and remember it in
   the record so later sizings reuse it.
2. Compare with finished work (EST-2). Find similar completed tickets in the same project by module,
   labels and key phrases, with their recorded sizes. Use the two to five closest, each with a link,
   as the basis of the suggestion.
3. Suggest with drivers and confidence (EST-3). Give a size or a range, the drivers behind it (for
   example "touches two areas", "new rules for refunds", "the docs on this area are a blank
   template"), and a confidence of low, medium or high. Missing or template documentation lowers the
   confidence and says so, but is never a driver such as "new area" or "not built yet". When whether
   the area already exists drives the size and the code is reachable, check that area's code
   (GRD-11) and label that driver "the code suggests"; when the look finds nothing under the area's
   name, the driver says no code was found under its name and the confidence stays lowered. Follow
   "What the documents prove" in `references/paqad-docs-map.md`.
   Run `scripts/compare_sizes.py suggest --target <target.json> --pool <finished.json> --scale
   <scale.json> [--area-docs <docs.md>]` to build this.
4. Recommend a split when it is big (EST-4). If the suggestion is above what the team usually finishes
   in a sprint, or confidence is low because of size, recommend how to split it and point the user to
   `refine-ticket`.
5. Label it, never commit (EST-5, EST-7). Show every size as a "suggested size". Never present it as a
   delivery date or a promise, and never derive a date from it. A size is never written as fact.
6. Write only on "set it" (EST-6). By default show the suggestion, or add it as a comment if the user
   asks. Writing into the size field needs an explicit "set it". Guard the write with
   `scripts/compare_sizes.py set --field-value <current> [--replace]`: it refuses when the field
   already holds a value unless `--replace` is given.

Record state is kept through `scripts/record.py` and checked with `scripts/check_record.py` (size
mode); digests use `scripts/canonical.py`.

## If the checks cannot run

When no tool can run the scripts, size by hand with this checklist:

- Find the team's scale (points and which field, T-shirt, or nothing); ask once if unknown and note
  it in the record.
- Find two to five of the closest finished tickets by module, labels and key phrases, each with a
  link and its recorded size.
- Give a size or range, list the drivers behind it, and set a confidence of low, medium or high.
- Lower the confidence and state the reason when the area's documents are template text or missing.
- Do "What the documents prove" in `references/paqad-docs-map.md` by hand: say an area the
  documents do not cover is not documented; never say or imply it is not built; report a document's
  status line as what the docs say, for the exact thing it names only; never use a requirements
  document as current behaviour; when the code is reachable, look at that area's names, open at
  most 5 files, and say at most one line per area, labelled "the code suggests".
- Recommend a split when the size is above a sprint's worth or confidence is low because of size.
- Label the result "suggested size"; never show a date or a commitment, and never write a size as
  fact.
- Write into the size field only on an explicit "set it"; refuse to overwrite an existing size unless
  the user asks to replace it.

## Output

Fills the `sizing` block of the record (size mode): the scale, the target ticket, the two to five
comparables with their keys, links and sizes, and the suggestion with its size, range, drivers,
confidence and the reason for the confidence. The sizing block carries no approval digest and no
dependents, because sizing never writes a field on its own.
