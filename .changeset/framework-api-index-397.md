---
'paqad-ai': minor
---

Verify framework reuse claims against the version you actually have installed (#397).

A plan could already declare it was reusing a framework API — "I'll use React's `useId()`
instead of hand-rolling one" — but nothing checked the claim. Now paqad reads the
declaration files shipped inside the installed package and answers two questions before
the plan compiles: does that symbol exist at your installed version, and is it
`@deprecated`? A plan naming a removed API fails with the nearest existing symbol; one
naming a deprecated API fails citing the deprecation message. No AI, no network.

New: `paqad-ai index framework-api build` and `paqad-ai index framework-api query
<package> <symbol>`.

Nothing new is installed for this. `typescript` is an optional peer dependency resolved
from your own project, so a Laravel, Flutter, or Python project pays nothing for a
JS-only check, and a project without it degrades to a visible warning rather than a
block. Anything paqad cannot verify statically — a dynamically-provided member, an
unindexed package, a missing index — warns instead of failing, because a false "this
does not exist" would block a perfectly good plan.
