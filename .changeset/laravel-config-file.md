---
'paqad-ai': minor
---

Move framework configuration out of `project-profile.yaml` into a Laravel-style `.paqad/.config` layer.

Framework knobs (the `paqad` enable switch, `enterprise`, RAG/`intelligence`, `strictness`, `escalation`, `features`, `research`, `model_routing`, and decision tuning) are no longer project facts living in `project-profile.yaml`. Their defaults now live in code, a git-ignored `.paqad/.config` (flat `KEY=VALUE`) overrides them, and a tracked, commented `.paqad/.config.example` documents every knob. `project-profile.yaml` keeps only project facts (name, commands, capabilities, stack, MCP servers).

Adds two new knobs: `AUTO_UPDATE` (the canonical auto-update switch; `skip_version_check` is now a deprecated alias) and `MINIMUM_VERSION` (default `latest`; pin a version to force the background self-update past its throttle until the floor is met).

`paqad-ai enable`/`disable` and the dashboard's config surface now read and write `.paqad/.config`. The off-signal (`PAQAD_ENABLED=false`) is honored by all three enforcement primitives (TS, shell, and `.mjs`).

Note for projects that hand-edited framework values in `project-profile.yaml`: this is a hard cutover, so those inline values are no longer read. Move any non-default settings into `.paqad/.config` (see `.paqad/.config.example`). Defaults are unchanged, so projects on defaults are unaffected.
