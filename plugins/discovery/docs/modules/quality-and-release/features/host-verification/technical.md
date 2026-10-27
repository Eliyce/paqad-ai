# Manual host verification: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `hosts/claude.md` | Manual install (8 steps) and 9 verdict rows: U-1, U-3, U-5, U-6, U-8, U-9, U-14, U-15, U-16 |
| `hosts/chatgpt.md` | Manual install (7 steps) and 13 rows: U-1, U-2, U-3, U-4, U-7, U-8, U-9, U-10, U-11, U-14, U-15, U-16, U-17 |
| `hosts/codex.md` | Manual install (7 steps) and 10 rows: U-1, U-3, U-8, U-9, U-11, U-12, U-13, U-14, U-15, U-16 |

Not shipped: `build/skills.yml` and `build/build.py` copy only `skills/` and declared `shared/` files, so `hosts/` never reaches `dist/`.

## Data Contracts

Verdict table columns, identical in all three files:

| Column | Content |
|---|---|
| Unknown | `U-n`, with `(shared)` when it applies to more than one host |
| What to check | The question |
| How to check on this host | Manual procedure |
| Verdict | Token `pending` until a person records a result |
| Evidence | Empty today |
| If it fails | Fallback, citing the requirement it relies on (PUB-3, SPR-7, EDT-7, PUB-8, PLG-12) |

No verdict vocabulary beyond `pending` is defined in these files. CI-19 names the per-release support states `packaged`, `installed`, `verified`.

## Script Interfaces

None: this feature is instruction-only. Install steps call `python3 build/build.py`.

## State Management

The `Verdict` and `Evidence` columns are the only state, edited by hand.

## Error Codes

None.

## Dependencies

| Kind | Detail |
|---|---|
| Other modules | plugin-build (the install steps build `dist/`); tracker-checks jira-profile (U-3, U-9, U-14 to U-17 test its assumptions) |
| External | Each host's plugin install path, the Atlassian connector or app per host, a Jira sandbox project (CI-18) |

## Configuration

None.

## Testing Entry Points

| File | Tests |
|---|---|
| `tests/scripts/test_authoring.py` | `HousePromptTest.test_no_em_or_en_dash` scans `hosts/` for long dashes |

Host behaviour itself has no automated test. Planned: CI-18 post-release smoke scenario per host (connect, explore, draft, check, post, read back, delete sandbox issues by hand).
