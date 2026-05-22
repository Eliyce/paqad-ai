## Correctness Risks

- {{query path: incorrect filter / non-deterministic ordering / wrong join}}

<!-- "Correctness Risks: none" allowed -->

## Migration Safety Risks

- {{query path: relies on schema/index that does not exist}}

<!-- "Migration Safety Risks: none" allowed -->

## Performance Risks

- {{query path: N+1 / over-fetch / leading-wildcard / unbounded result set}} — {{remediation tied to expected data scale}}

<!-- "Performance Risks: none" allowed -->
