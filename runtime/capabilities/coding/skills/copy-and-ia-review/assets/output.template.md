## Findings

- **medium** (patterns.md → terminology) — {{module}} / copy: `User` and `Member` used interchangeably across `/settings` and `/team`; glossary declares `Member`. Evidence: `src/pages/Settings.tsx:42`. Required action: replace `User` with `Member` on all user-facing strings per `patterns.md`.
- **low** (patterns.md → voice) — {{module}} / copy: button label `OK` instead of declared action verb. Evidence: `src/components/Dialog.tsx:18`. Required action: replace `OK` with `Done` or `Confirm` per `patterns.md` action-verb set.

## Open Questions

- {{omit when none}}
