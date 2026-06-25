---
'paqad-ai': minor
---

Move framework configuration out of `project-profile.yaml` into a Laravel-style four-surface config layer.

Framework knobs (the `paqad_enable` switch, `enterprise`, RAG/`intelligence`, `strictness`, `escalation`, `features`, `research`, `model_routing`, and decision tuning) are no longer project facts living in `project-profile.yaml`. Their defaults now live in code, and a team or developer overrides them through four surfaces, highest precedence last (local wins over team):

1. framework code defaults (the `FRAMEWORK_CONFIG_SPECS` registry)
2. `.paqad/configs/.config.*` — tracked, team-shared, merged grouped files (`.config.app`, `.config.rag`, `.config.models`, `.config.policy`)
3. `.paqad/.config` — git-ignored, per-developer (local wins)
4. `PAQAD_*` environment variables — per-run escape hatch

Keys are bare and readable (`enterprise=true`); each maps to a `PAQAD_*` env equivalent (`PAQAD_ENTERPRISE`). A tracked `.paqad/.config.example` documents every knob and is never read at runtime. `project-profile.yaml` keeps only project facts (name, commands, capabilities, stack, MCP servers).

Adds two new knobs: `auto_update` (the canonical auto-update switch; `skip_version_check` is now a deprecated alias) and `minimum_version` (default `latest`; pin a version to force the background self-update past its throttle until the floor is met).

`paqad-ai enable`/`disable` and the dashboard config surface read and write the config layer. The off-signal (`paqad_enable=false`, plus the `PAQAD_DISABLED` hard switch) is honored identically by all three enforcement primitives (the TS predicate, the shell kill switch, and the `.mjs` hook), pinned by a shared golden-fixture parity test.

Onboarding and update reconcile, they never reset: they refresh the catalog and prune only keys this version no longer knows from your override files, preserving every value you set.

Note for projects that hand-edited framework values in `project-profile.yaml`: this is a hard cutover, so those inline values are no longer read. Move any non-default settings into `.paqad/configs/.config.*` or `.paqad/.config` (see `.paqad/.config.example`). Onboarding prints a one-time notice listing any non-default value it found so nothing reverts silently. Defaults are unchanged, so projects on defaults are unaffected.
