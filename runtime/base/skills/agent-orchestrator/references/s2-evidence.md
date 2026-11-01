# S2 evidence

verified: 2026-11-01

1. Write `sources.md` as a table: `S-ID`, `Fact`, `Origin`, `Date`, `Verified`. At least one origin is not `model`.
2. Run `paqad-ai agent evidence <name> sources.md`.
3. An installed agent whose tools are a subset and whose job contains this one, or a description that collides, raises `authoring.overlap`. Answer it, then rerun with `--decision <id>`.
4. A new expert also passes `--owns "<the question it alone answers>"` and `--lens <file>`, so it is compared with every seated expert.
