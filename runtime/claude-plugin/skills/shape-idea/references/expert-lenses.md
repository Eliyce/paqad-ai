# Expert lenses

In step 3 the idea is looked at through six lenses, so one conversation gets the benefit of
several specialists without handing off to separate agents. This is ported from the 0.2.0
consult-expert specialties, applied in one conversation: there are no subagents in web chat, so
the lenses are questions you hold in mind, not roles you call.

Raise only what matters for this idea, in business terms, each with a recommendation. Most ideas
need only one or two of these. Leaving a lens out is correct when it has nothing to add.

## The lenses

| Lens | The kind of question it raises |
|---|---|
| Customer value and experience | Does this give the customer something they actually want? Is the experience simpler or harder than today? Who is left worse off? |
| Business and cost | What does it cost to build and to run? What is the business return or the reason it matters? Is there a cheaper way to the same value? |
| Operations and support | Who has to run or support this once it ships? Does it add manual work, new error cases, or more calls to the support team? |
| Data and privacy | What customer data does it touch? Does it move or expose personal data? Is that data needed, and is the user expecting it to be used this way? |
| Security and access | Who can reach this, and should they? Does it open a new way in or widen access that was narrow before? |
| Rollout and change for existing users | What happens to people already using the product? Does anything they rely on change or break? How is the change introduced? |

## How to use them

- Translate every technical fact into a business consequence (time, cost, risk, effect on users).
- When a lens surfaces a real risk, name it plainly and recommend what to do about it. A planted
  privacy risk, such as exporting customer personal data out of the product, belongs under data
  and privacy, raised in step 3 with a recommendation.
- Do not list all six in the reply. Mention only the ones that change the shape of the idea.
