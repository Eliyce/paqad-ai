---
'paqad-ai': minor
---

Framework-native reuse now covers PHP/Laravel, Python and Java/Spring, not just JS/TS
(#398). Each ecosystem gets an adapter behind the same normalized schema: resolve the
version actually installed, read the declaration layer that ships with it, and answer
whether a symbol exists and whether it is deprecated — so `plan compile` checks a Laravel,
Django or Spring reuse claim exactly as it already checked a React one.

Laravel facades resolve through their `@method static` docblocks rather than reporting
`__callStatic`, and the version-pinned Laravel Upgrade Guide is folded in as a
`doc-derived` deprecation backstop for the deprecations Laravel documents but never tags.
Metaprogrammed members always read "could not verify statically", never a false "does not
exist".

`FRAMEWORK_PACKAGE_MAP` also gains the Spring Boot, Django, FastAPI and Rails coordinates
it was missing, so those projects are detected and indexed instead of silently producing
nothing.
