# Config Visibility and Preservation

paqad separates two kinds of settings, and each lives where it belongs. Project
facts (what this repo *is*) live in `.paqad/project-profile.yaml`. Framework
knobs (how paqad *behaves*) live in code defaults, overridden by a git-ignored
`.paqad/.config` file, and made discoverable through a tracked
`.paqad/.config.example`. The dividing line is project-fact vs framework-knob,
not whether a value has a default.

This is the deliberate counterpart to the `.paqad` light-directory principle: the
framework's own machinery (static assets, internal state, version bookkeeping)
belongs in the install, out of the project. A team still owns the values it is
meant to decide, but those values now sit in the layer that matches what they are.

## The two layers

- **`project-profile.yaml` holds project facts only.** Project name / id /
  description, the project's own `commands` (test / build / lint), `mcp.servers`,
  the detection-derived `active_capabilities` and `stack_profile`, and the
  project-owned `custom` arrays (`classification_dimensions`,
  `verification_plugins`, `escalation_rules`) plus the advanced decision sub-keys
  (`preferred_option_keys`, `ttl_overrides_days`, `max_pending`). These describe
  the repository; they are not framework behaviour.
- **Framework config: defaults in code, overrides in `.paqad/.config`.** The
  knobs that tune behaviour live in `src/core/framework-config.ts`
  (`DEFAULT_FRAMEWORK_CONFIG`). A team overrides any of them in `.paqad/.config`,
  a flat `KEY=VALUE` file modelled on Laravel's `.env`. It is git-ignored, so each
  environment can differ without churning a tracked file. Knobs that live here
  include `PAQAD_ENABLED`, the whole `enterprise` block, RAG / intelligence
  (`RAG_ENABLED`, `RAG_EMBEDDING_PROVIDER` / `RAG_EMBEDDING_MODEL`,
  `RAG_SIMILARITY_THRESHOLD`, `RAG_TOP_N`, `RAG_MAX_FILE_SIZE`), strictness
  (`FULL_LANE_DEFAULT`, `REQUIRE_ADVERSARIAL_REVIEW`, `BLOCK_ON_STALE_DOCS`,
  `REQUIRE_DB_REVIEW_FOR_MIGRATIONS`), escalation (`ESCALATE_*`), feature flags
  (`FEATURE_*`), `RESEARCH_DEPTH`, model routing (`MODEL_DEFAULT` /
  `MODEL_REASONING` / `MODEL_FAST`), the simple decision knobs
  (`DECISIONS_ASK_THRESHOLD`, `MAX_SCREENS_PER_TASK`, `IDLE_TIMEOUT_MINUTES`), and
  the version / update knobs (`AUTO_UPDATE`, default `true`; `MINIMUM_VERSION`,
  default `latest`).

## Rules

- **`.config.example` is the discoverability surface.** Onboarding writes a
  tracked, fully commented `.paqad/.config.example` listing every framework knob
  with its default and a one-line explanation. This is how a team learns a knob
  exists. It is a template only and is **never read at runtime**; copy a line into
  `.paqad/.config` to actually change behaviour. A knob that is invisible and
  undiscoverable is not allowed; the example file is what keeps every knob visible.
- **Resolution precedence is fixed.** Framework defaults (code) → `.paqad/.config`
  → programmatic overrides (the desktop app, tests). The on-disk override beats the
  default; an explicit programmatic override beats both.
- **Absent resolves to the default.** Any knob not set in `.paqad/.config` resolves
  to its documented code default, so a missing or hand-trimmed `.config` never
  breaks. `.config` itself is optional: with no file, every knob is at its default.
- **Hard cutover: the YAML no longer carries knobs.** Framework knobs are sourced
  *only* from defaults + `.config`. Any such key left over in an existing
  `project-profile.yaml` is ignored on read and stripped on write. Do not
  re-introduce a framework knob into the profile schema, and do not read one from
  the profile.
- **Detection-derived fields are refreshed, not preserved.** `active_capabilities`
  and `stack_profile` are computed from repository reality on every run. They are
  framework-owned outputs in the profile, not team-owned config.
- **Preserve project facts on re-onboard and update.** `paqad-ai onboard` and
  `paqad-ai update` are a refresh, not a reset. Read the existing profile first and
  carry every project-owned section forward unchanged (name, commands, `mcp`, the
  `custom` arrays, advanced decision sub-keys). Only add newly introduced keys and
  remove retired ones. Never clobber a value the team set. `.paqad/.config` is the
  team's file and is left untouched.

## How this is enforced

`src/core/framework-config.ts` is the single source of truth for framework knobs:
one `FRAMEWORK_CONFIG_SPECS` table drives the defaults, the `.config` parser, the
in-memory overlay, and the generated `.config.example`, so the three cannot drift
(a test asserts the example round-trips). `paqad-ai enable` / `disable` and the
dashboard config surface read and write `.paqad/.config`, not the profile.
`OnboardingOrchestrator` reads the existing profile and merges it
(`mergeProfileOverrides`) so a re-onboard preserves project facts, while framework
knobs resolve through the `.config` layer independent of the YAML.
