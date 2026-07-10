# Config Visibility and Preservation

paqad separates two kinds of settings, and each lives where it belongs. Project
facts (what this repo _is_) live in `.paqad/project-profile.yaml`. Framework
knobs (how paqad _behaves_) live in code defaults, overridden through a
Laravel-style four-surface config layer, and made discoverable through tracked,
self-documenting per-group config files. The dividing line is project-fact vs
framework-knob, not whether a value has a default.

This is the deliberate counterpart to the `.paqad` light-directory principle: the
framework's own machinery (static assets, internal state, version bookkeeping)
belongs in the install, out of the project. A team still owns the values it is
meant to decide, but those values now sit in the layer that matches what they are.

## The two kinds of settings

- **`project-profile.yaml` holds project facts only.** Project name / id /
  description, the project's own `commands` (test / build / lint), `mcp.servers`,
  the detection-derived `active_capabilities` and `stack_profile`, and the
  project-owned `custom` arrays (`classification_dimensions`,
  `verification_plugins`, `escalation_rules`) plus the advanced decision sub-keys
  (`preferred_option_keys`, `ttl_overrides_days`, `max_pending`). These describe
  the repository; they are not framework behaviour.
- **Framework knobs: defaults in code, overrides in the config layer.** The knobs
  that tune behaviour live in `src/core/framework-config.ts` (the
  `FRAMEWORK_CONFIG_SPECS` registry). A team or developer overrides any of them in
  the config layer below. Knobs that live here include `paqad_enable`, the whole
  `enterprise` block, RAG / intelligence (`rag_enabled`, `rag_embedding_provider`
  / `rag_embedding_model`, `rag_similarity_threshold`, `rag_top_n`,
  `rag_max_file_size`), strictness (`full_lane_default`,
  `require_adversarial_review`, `block_on_stale_docs`,
  `require_db_review_for_migrations`), escalation (`escalate_*`), feature flags
  (`spec_only_mode`, `market_research`, `design_research`, `team_agents`),
  `research_depth`, model routing (`model_default` / `model_reasoning` /
  `model_fast`), the simple decision knobs (`decisions_ask_threshold`,
  `decisions_max_screens_per_task`, `decisions_idle_timeout_minutes`), and the
  version / update knobs (`auto_update`, default `true`; `minimum_version`,
  default `latest`).

## The four surfaces

Keys are bare and readable (`enterprise=true`). Each also has a `PAQAD_*` env
equivalent for a per-run override (`PAQAD_ENTERPRISE`). Resolution precedence,
lowest to highest — **local wins over team**:

| Surface                     | Git      | Owner               | Role                            |
| --------------------------- | -------- | ------------------- | ------------------------------- |
| framework code defaults     | —        | framework           | the source of truth            |
| `.paqad/configs/.config.*`  | tracked  | team                | shared, merged grouped files   |
| `.paqad/.config`            | ignored  | developer           | local override (LOCAL WINS)     |
| `PAQAD_*` env var           | —        | the run             | per-run escape hatch (highest)  |

`.paqad/configs/` holds one file per coarse group (`.config.app`, `.config.rag`,
`.config.models`, `.config.policy`). Onboarding writes each file pre-filled with
every knob in that group, **commented out** at its default and documented with a
one-line explanation and its `PAQAD_*` env equivalent. The files are all globbed
and merged, so a key works in any file and must be globally unique (a collision
warns, last filename wins).

Onboarding also writes a single `.paqad/.config.example` — a tracked catalog of
**every** knob (all groups in one file), commented out, the same copy-paste
reference Laravel's `.env.example` provides. It is **never read at runtime**; copy
a line from it into a `configs/.config.*` file or `.config`, uncomment, and set a
value.

## Rules

- **The group files are self-documenting and inert until edited.** Onboarding
  writes every knob into its group file, commented out, with its default, its
  `PAQAD_*` env equivalent, and a one-line explanation — so a team discovers a knob
  by reading the file it would change. Because every line is commented, a freshly
  onboarded project runs entirely on code defaults; a team uncomments a line to
  override. A knob that is invisible and undiscoverable is not allowed; the
  pre-filled group files are what keep every knob visible.
- **Resolution precedence is fixed, and local wins over team.** Defaults (code) →
  `configs/.config.*` (team, merged) → `.config` (local) → `PAQAD_*` env →
  programmatic overrides (desktop / tests). A local file beats a team file; an env
  var beats both files; a programmatic override beats everything.
- **Absent (or commented) resolves to the default.** Any knob no surface actively
  sets resolves to its documented code default, so a commented, missing, or
  hand-trimmed config never breaks. Every override surface is optional: with no key
  uncommented anywhere, every knob is at its default and behaviour is identical to
  a fresh install.
- **Hard cutover: the YAML no longer carries knobs.** Framework knobs are sourced
  _only_ from the four surfaces above. Any such key left over in an existing
  `project-profile.yaml` is ignored on read and stripped on write. Do not
  re-introduce a framework knob into the profile schema, and do not read one from
  the profile.
- **Detection-derived fields are refreshed, not preserved.** `active_capabilities`
  and `stack_profile` are computed from repository reality on every run. They are
  framework-owned outputs in the profile, not team-owned config.
- **Preserve overrides on re-onboard and update — reconcile, never reset.**
  `paqad-ai onboard` and `paqad-ai update` are a refresh, not a reset. They sync
  the group files — creating any missing file in full, and **appending** knobs a
  new version introduced (commented) to existing files — and they **reconcile** the
  team/local override files against the current registry, pruning _only_ keys this
  version no longer knows and reporting them. They never rewrite a value the team
  uncommented and never reset a file to defaults. Project facts in the profile are
  likewise carried forward unchanged.

## Evolving the config surface (a decision pause)

Adding or removing a knob changes the contract every onboarded team consumes, so
it is a **decision pause**, not a silent edit. Before changing the registry:

1. Pause and confirm the change with the user (in Claude Code, via
   `AskUserQuestion`). This is a repo rule — it is intentionally **not** a new
   distributed `DECISION_CATEGORY`, so the pause lives here and never ships into
   onboarded projects.
2. Edit the one `FRAMEWORK_CONFIG_SPECS` registry entry (key, `PAQAD_*` env, type,
   default, group, comment). The resolver, the parser, the generated group files,
   the validation, and the dashboard fields all derive from it.
3. A test asserts the generated group files round-trip to the defaults (uncomment
   every line and it resolves to the code defaults), so they cannot drift.
4. On the next `onboard` / `update`, a newly-added key is appended (commented) to
   its group file, and a removed key is pruned from every team/local file while all
   still-valid uncommented values are preserved.

## How this is enforced

`src/core/framework-config.ts` is the single source of truth: one
`FRAMEWORK_CONFIG_SPECS` registry drives the defaults, the parser, the layered
resolver, the env mapping, the generated group files, and the reconcile/prune
pass, so they cannot drift. Three independent parsers resolve the disabled signal
— the TS predicate (`framework-enabled.ts`), the `.mjs` hook, and the `.sh` kill
switch — and a shared golden-fixture parity test
(`tests/unit/core/config-parser-parity.test.ts`) pins all three to one precedence
and coercion behaviour. `paqad-ai enable` / `disable` and the dashboard config
surface read and write the config layer (`.paqad/.config`), not the profile.
`OnboardingOrchestrator` and `FrameworkUpdater` sync the group files and run the
reconcile pass so a re-onboard / update refreshes and prunes without ever
resetting a team's values.
