---
'paqad-ai': patch
---

Fixing a missing feature title no longer splits a change in two. The end-of-turn check used to advise `stage start planning --title`, which opened a second, near-empty bundle and paused the one holding the plan, spec and review, and the HUD then said Safe to merge for the empty one. Now `stage start --title` names an untitled active change in place, a new `paqad-ai feature title "<title>"` names it without touching the stages (and is what the check now suggests), and a turn that judges an empty bundle while the same session has unfinished work in another one reads Inconclusive and names both.
