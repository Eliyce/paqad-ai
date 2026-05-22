## Correctness Risks

- {{uniqueness rule that would corrupt data without an index}}

<!-- "Correctness Risks: none" allowed -->

## Migration Safety Risks

- {{adding the index would lock a hot table; recommend CONCURRENT or maintenance window}}

<!-- "Migration Safety Risks: none" allowed -->

## Performance Risks

- {{missing or redundant index for: query-shape | query-file | column}} — {{recommendation}}

<!-- "Performance Risks: none" allowed -->
