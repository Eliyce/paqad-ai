# Review — Issue #339 Phase 1 (feature-evidence foundation)

Self-review of the diff (`src/feature-evidence/**`, `src/core/constants/paths.ts`,
`tests/unit/feature-evidence/**`) against correctness, regressions, and rollback.

## Findings & resolutions

- **[correctness — fixed] GitHub ref carried its `#` into the dir name.**
  `detectTicketRefs` returns a github ref verbatim as `#45`, so minting from a
  title like "Fix #45 crash" composed `#45-slug-ULID`, which contains `#` and does
  not parse back via `parseFeatureDirName`. Fixed with `normalizeIssue` in
  `mint.ts` (strips a leading `#`, empties → null) and a defensive `ISSUE_RE` guard
  in `formatFeatureDirName` that throws on an issue ref that would not round-trip.
  Regression tests added (github detect, explicit `#9`, lone `#`, malformed guard).

- **[accuracy — fixed] Overstated "atomically" in `writeSessionControl` doc.**
  The write is a direct `writeFileSync`, not a temp-rename. Comment corrected to
  "write the control to disk (creating dirs)". A control file is small and the
  store is dark; a rename-based atomic write is deferred to the wiring phase if the
  concurrent-writer risk materialises.

## Correctness checks that held

- Dir-name round-trip: github / jira / no-issue all parse back to `{issue,slug,ulid}`;
  ULID is anchored at the tail (uppercase base32) so the slug/ULID split is
  unambiguous. Documented tie-break (`123-abc-…` reads `123` as a github issue) is
  acceptable because `feature.json.issue` is the authoritative value.
- `content_hash` excludes only volatile keys (`content_hash`, `created_at`,
  `updated_at`); stable across timestamps, changes with identity — verified.
- AJV schemas reject unknown keys (`additionalProperties:false`) and bad enums;
  verified for both `feature.json` and `plan.json`.
- Session control: set-active pauses the prior active, resume pops a paused feature
  (returns null for an unknown one, no silent mint), reads are tolerant of
  absent/corrupt/non-object files. All branches covered.

## Regression / rollback risk

- **None to existing behaviour.** The module is dark — nothing imports it outside
  its own tests; the only edit to shared code is three additive `PATHS` constants.
  Rollback is deleting `src/feature-evidence/` + the three constants.
- `src/feature-evidence/**` at 100% line/branch/function coverage; repo global gate
  unaffected.
