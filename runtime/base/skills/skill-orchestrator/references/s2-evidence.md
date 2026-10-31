# S2 evidence

verified: 2026-10-31

Collect sources from the task trace, the repository (the context the spec pipeline grounded on), web research for any outside API or format, and the installed skills. Write one row per fact:

```markdown
| S-ID | Fact                                     | Origin                    | Date       | Verified |
| ---- | ---------------------------------------- | ------------------------- | ---------- | -------- |
| S-1  | Invoices are soft-deleted via deleted_at | app/Models/Invoice.php:41 | YYYY-MM-DD | yes      |
```

At least one origin has to be something other than `model`. A writing skill with no repository artifacts passes `--sources-kind no-repo`.

`paqad-ai skill evidence <name> sources.md` also scores the purpose and triggers against every installed skill. A score at or above the collision threshold raises an overlap decision for the owner: extending the installed skill is the recommended answer. Rerun the verb with `--decision <id>` once it is answered. A name taken in another scope fails the gate until the skill is renamed.

The catalog budget is a warning, never a block: it names the skills most likely to drop out of the host's listing, least recently fired first.
