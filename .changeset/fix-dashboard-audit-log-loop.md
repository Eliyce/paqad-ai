---
'paqad-ai': patch
---

Stop the dashboard audit-log feedback loop on legacy project profiles.

On projects whose `.paqad/project-profile.yaml` predates the canonical
capabilities model, `readProjectProfile` could flag a profile as "migrated"
even when the canonical rewrite was byte-identical (a declared `coding`
capability with no usable stack profile). Every read then re-appended the
"Migrated project profile to canonical capabilities model" line to
`.paqad/audit.log`. With `paqad-ai dashboard` running, the `.paqad/` watcher
saw each append, rebuilt the report, read the profile again, and looped
roughly every 500ms, growing the audit log forever and firing the SSE
`dashboard-updated` stream continuously.

Two changes close the loop:

- Profile migration now reports `migrated` only when the canonical form
  actually differs from what is on disk. `coding` active without a stack
  profile is treated as a valid converged state (stack detection may simply
  not have run yet), so the migration converges after a single write.
- The `.paqad/` watcher ignores append-only logs the report build and
  dashboard mutations write themselves (`audit.log`, `logs/`), so a log
  append can never re-trigger the build that produced it.
