# CLI Command Registry

Source: `src/cli/commands/*.ts`. Regenerate when adding/removing commands.

## Lifecycle & diagnostics

| Command         | File                              | Purpose                                        |
| --------------- | --------------------------------- | ---------------------------------------------- |
| `onboard`       | `src/cli/commands/onboard.ts`     | Detect stack, write `.paqad/` and rules        |
| `refresh`       | `src/cli/commands/refresh.ts`     | Refresh detection + profile                    |
| `update`        | `src/cli/commands/update.ts`      | Update framework assets                        |
| `install`       | `src/cli/commands/install.ts`     | Install/relink runtime                         |
| `doctor`        | `src/cli/commands/doctor.ts`      | Diagnostics                                    |
| `status`        | `src/cli/commands/status.ts`      | Print a one-shot dashboard report (Markdown or JSON) |
| `dashboard`     | `src/cli/commands/dashboard.ts`   | Open the project dashboard in a local web view |

## Intelligence & graph

| Command         | File                              | Purpose                                        |
| --------------- | --------------------------------- | ---------------------------------------------- |
| `rag`           | `src/cli/commands/rag.ts`         | Manage optional hybrid RAG context retrieval (`init`/`rebuild`/`status`/`clear`) |
| `graph`         | `src/cli/commands/graph.ts`       | Open a local web view of the project graph     |

## Module map & health

| Command            | File                                | Purpose                                        |
| ------------------ | ----------------------------------- | ---------------------------------------------- |
| `module-health`    | `src/cli/commands/module-health.ts` | Module-level health scan                       |
| `module-map`       | `src/cli/commands/module-map.ts`    | Reconcile `module-map.yml` against the source tree (`reconcile`) |
| `module-decisions` | `src/cli/commands/module-decisions.ts` | Inspect MD-XXXX prospective module decisions (`list`/`show`/`expire-stale`/`extract`) |
| `module-events`    | `src/cli/commands/module-events.ts` | Inspect the module-map `events.jsonl` audit trail (`list`/`since`/`for-module`) |

## Governance, compliance & trust

| Command         | File                              | Purpose                                        |
| --------------- | --------------------------------- | ---------------------------------------------- |
| `capabilities`  | `src/cli/commands/capabilities.ts`| Inspect / toggle capabilities                  |
| `compliance`    | `src/cli/commands/compliance.ts`  | Spec compliance verification tools (`extract`/`review`/`check`/`skeleton`/`doctor`/`boundary`/`patterns`) |
| `packs`         | `src/cli/commands/packs.ts`       | List / install compliance packs                |
| `patterns`      | `src/cli/commands/patterns.ts`    | Inspect detection patterns                     |
| `evidence`      | `src/cli/commands/evidence.ts`    | Render verification evidence as a scannable PR comment (Markdown or JSON); move old spec runs into their bundles (`migrate [--dry-run]`) |
| `audit`         | `src/cli/commands/audit.ts`       | Export the evidence ledger to your own SIEM — OCSF/ECS/CEF/JSONL, read-only, local-first (`export`) |
| `duplication`   | `src/cli/commands/duplication.ts` | Flag new code that near-copies existing helpers, new-code-only and deterministic (`scan`) |
| `visual-evidence` | `src/cli/commands/visual-evidence.ts` | Screenshot evidence for frontend changes: capture documented flows (`run`), attach your own PNGs (`attach`), dry-run the plan (`plan`), provision the browser (`setup`) |

## Change records & organization rollout

| Command            | File                                | Purpose                                        |
| ------------------ | ----------------------------------- | ---------------------------------------------- |
| `debt`             | `src/cli/commands/debt.ts`          | Record findings a change will not fix as `TD-<ULID>` items under `docs/instructions/tech-debt/` (`add`/`list`/`promote`/`close`) |
| `rules override`   | `src/cli/commands/rules.ts`         | Record a person allowing one edit past a rule-script stop with the stop's one-time token; refused for a stop enforced by managed settings. With `--outcome landed|refused|still-blocked` it records, once per tool call, what happened to that edit |
| `fix prove`        | `src/cli/commands/fix.ts`           | Run the proof test for a fix and record `red` (before the fix) or `green` (after it) in the bundle's `fix-proof.json` |
| `checks run`       | `src/cli/commands/checks.ts`        | Run the pack's format, test and build commands into the bundle's `checks.json`; build and test are reused when the newest real run of the same command was green on the identical working tree, lockfile, Node version and build output, and `--no-reuse` runs every command for real |
| `report speed`     | `src/cli/commands/report.ts`        | Read-only report of where each change's time went (busy time by owner, owner wait, edit gate, test runs, with reused checks runs counted apart) from the ledger and the session transcripts; `--change`, `--since`, `--json`, `--transcripts-root` |
| `delivery-link merge` | `src/cli/commands/delivery-link.ts` | Stamp HEAD as the merge commit on the bundle whose branch matches the current branch only; with no match it stamps nothing (it no longer falls back to the active change) |
| `delivery-link commit-decision` | `src/cli/commands/delivery-link.ts` | Record the answer to the commit question on the change's `delivery.json` (`commit`/`decline`/`ignored`/`user-requested`) |
| `delivery-link refresh` | `src/cli/commands/delivery-link.ts` | Read push, PR and CI for the branch change through git and gh and save only `push`, `pr`, `ci` and `ci_read` in its `delivery.json`; a gh failure keeps the stored reading. `--min-age-seconds <n>` skips gh while the stored reading is younger. Prints one JSON line `{refreshed, feature, reason, push, ci}`. The HUD runs it while an open PR's CI is pending |
| `hook`             | `src/cli/commands/hook.ts`          | Run a packaged edit gate (`capability-gate`, `decision-pause-gate`) for Claude Code managed settings; `--managed` marks it as enforced by the organization |
| `managed-settings` | `src/cli/commands/managed-settings.ts` | Print or write (`--write <dir>`) the Claude Code managed settings that enforce paqad on every machine; needs `enterprise.enabled=true` |
| `skill`            | `src/cli/commands/skill.ts`         | Take a new or edited skill through its gated pipeline: `justify`, `intake`, `evidence`, `draft`, `lint`, `test`, `eval plan`/`record`, `trigger plan`/`record`, `release`, then `learn`, `drift`, `catalog`; `status` and `improve` show and resume the gates, `override` records an owner-approved skip from a resolved decision |
