# Review checklist (judgment checks)

The prose and structure scripts catch what a machine can catch. These are the judgment checks a
person makes, from REQUIREMENTS section 8.5. Work through them for the whole set before reporting
readiness.

## The checks

1. **Does each ticket serve its epic's goal?** Every ticket should move its epic's one-sentence
   goal forward. A ticket that does not belong under any epic's goal is in the wrong place or is
   not needed.
2. **Would a developer know when it is done?** Each "done when" statement should be checkable by a
   tester without asking the author. Vague outcomes ("works well", "is improved") are not
   checkable; rewrite them into something observable.
3. **Is anything in "what exists today" contradicted by the docs?** Compare each ticket's "what
   exists today" against the today block and the project documents. A claim the docs contradict,
   or that rests on a template section the docs could not confirm, is flagged rather than kept.
4. **Is the split sensible?** The epics and tickets should break the work along natural lines, not
   too big to finish and not split so finely that the pieces only make sense together. Recommend a
   merge or a split where it reads wrong.
5. **Are there similar issues already in the tracker?** Search by key phrases and show the matches
   to the user before posting. The user decides whether a ticket is new, a duplicate, or should
   extend an existing issue. This search only reads the tracker.

## Reporting

Report readiness as passed only when the scripts are clean (or the by-hand checks are) and these
judgment checks hold. Where something is open, say what it is in one plain line and what would
close it, and leave readiness open rather than calling it passed.
