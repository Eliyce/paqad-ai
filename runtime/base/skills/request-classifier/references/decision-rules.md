# Classification Decision Rules

verified: 2026-11-02

Prefer explicit request language over inference.

When unsure:

- keep scope narrow unless the request names multiple modules or interfaces
- raise risk when data loss, auth, migration, or customer-facing failure is possible
- mark UI impact only when screens, components, or interaction states change
