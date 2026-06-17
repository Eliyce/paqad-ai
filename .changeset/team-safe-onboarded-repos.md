---
'paqad-ai': minor
---

Make onboarded repos team-safe so parallel branches no longer collide.

- Decision IDs are now collision-free ULIDs (`D-<ULID>` / `MD-<ULID>`) instead of monotonic counters, so two developers raising decisions on diverged branches mint different filenames and merge cleanly. Existing `D-1`/`MD-0001` files keep loading, resolving, and listing unchanged.
- The `.gitignore` paqad section is now a reconciling managed block that updates on re-onboard (previously it bailed the moment it saw its marker and never shipped new entries). It quarantines per-machine runtime state, the compliance ledger, and all module-health from version control.
- Re-onboarding untracks any now-ignored path an earlier onboarding had committed, keeping the working-tree files.
- Onboarding writes a managed `.gitattributes` block so the shared decision index merges by union.
