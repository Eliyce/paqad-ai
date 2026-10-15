# Reuse catalog

Check here before writing a new helper or reference. Shared material lives once under
`shared/` and is copied into a skill only when the skill declares it in `build/skills.yml`
(PLG-9, PLG-10). To reuse something, add it to that skill's `imports:` list; the build fails if a
`SKILL.md` mentions a shared file it did not declare.

## Shared scripts (`shared/scripts/`)

| File | Use it for | Public functions | Imported by |
|---|---|---|---|
| `canonical.py` | Canonical JSON digests, loading JSON, timestamps, the JSON result and issue shapes every script prints, and the one external/tracker-ref check (`is_external_ref`) both check-tickets and post-tickets call | `digest`, `load`, `now`, `text`, `issue`, `result`, `is_external_ref` | product-discovery, check-tickets, post-tickets, refine-ticket, size-work, plan-sprint |
| `record.py` | Creating and changing the discovery record with revision checks, staleness and digest-bound approvals | `new_record`, `validate`, `apply_update`, `apply_advance`, `apply_approve`, `required_for`, `block_digest`, `mint_run_id`, `read`, `write` | product-discovery, refine-ticket, size-work, plan-sprint |
| `check_record.py` | Asking whether a step's required blocks are present and fresh | `check` | product-discovery, refine-ticket, size-work, plan-sprint |
| `check_prose.py` | Linting ticket prose (dashes, code words, jargon deny-list) | `lint_ticket_set`, `lint_item`, `scan`, `load_denylist` | check-tickets, refine-ticket |
| `check_readback.py` | Comparing what the tracker holds to what was approved, after normalisation | `compare`, `expected_items`, `norm_text`, `norm_title`, `norm_ref` | post-tickets, refine-ticket, plan-sprint |
| `check_onboarded.py` | The one GRD-1 onboarded check (ready, partly ready, not set up) and the one reader of area summaries; never re-read `docs/modules/*/index/summary.md` elsewhere | `onboarded_state`, `area_summaries`, `is_onboarded`, `result_payload`; constants `STOP_MESSAGE`, `PARTLY_MESSAGE` | get-connected, ask-project, ground-in-project (and `find_related.py`, which imports it) |
| `find_related.py` | Ranking onboarded modules against free text, from the registry or (no registry) from the area folders and summaries | `rank`, `parse_registry`, `rows_from_modules_dir`, `tokens`, `term_matches` | ask-project, ground-in-project |
| `detect_placeholder.py` | Telling real documentation from unfilled template text | `classify`, `split_sections`, `load_markers` | ask-project, ground-in-project |

## Shared references (`shared/references/`)

| File | Holds | Imported by |
|---|---|---|
| `voice.md` | Section 3A reply rules (TALK-*) | all 13 skills |
| `tracker-profiles-jira.md` | Jira fields, issue types, link types, sprint and size fields | get-connected, post-tickets, refine-ticket, size-work, plan-sprint |
| `tracker-profiles-github.md` | GitHub Issues as an export-only tracker: actions availability, model mapping, export and labels | get-connected, post-tickets |
| `plain-language.md` | Plain-word substitutions and jargon deny-list | write-tickets, check-tickets, refine-ticket |
| `writing-rules.md` | Ticket writing rules (section 8.4) | write-tickets, refine-ticket |
| `consulting.md` | Consultant stance (section 4A) | product-discovery, ask-project |
| `paqad-docs-map.md` | Where things live in a paqad-onboarded repo, the reading order (GRD-2) and what the documents prove (GRD-8 to GRD-11) | ask-project, ground-in-project, shape-idea, refine-ticket, size-work |
| `connect-repository.md` | Choosing, reaching and remembering the repository by capability (GRD-3), the three-state onboarded check with both exact sentences (GRD-1), the never-read list | ask-project, get-connected, ground-in-project, refine-ticket, size-work |
| `template-markers.md` | Markers that identify template text (both doc generations) | ask-project, ground-in-project |

## Skill-local helpers worth knowing

| File | Reusable idea |
|---|---|
| `skills/size-work/scripts/compare_sizes.py` | `jaccard`, `tokens` similarity for comparables |
| `skills/post-tickets/scripts/plan_posting.py` | Claim, receipt and reconcile pattern for idempotent writes |
| `skills/refine-ticket/scripts/diff_ticket.py` | Snapshot vs live conflict detection, rich-content markers |
| `skills/write-tickets/assets/ticket-set.schema.json` | The canonical ticket-set contract |

If a skill-local helper is needed by a second skill, move it to `shared/` and declare it in both
skills rather than copying it.
