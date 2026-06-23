# Config Visibility and Preservation

User-facing configuration is the team's to own and read. It must live, in full,
in `.paqad/project-profile.yaml`. paqad never hides a user-facing knob behind a
silent default, and never overwrites a value the team set.

This is the deliberate counterpart to the `.paqad` light-directory principle: the
framework's own machinery (static assets, internal state, version bookkeeping)
belongs in the install, out of the project; but anything a team is meant to
decide belongs in the profile, where they can see and change it. The dividing
line is ownership of the value, not whether it has a default.

## Rules

- **Materialize every user-facing knob.** When onboarding writes
  `project-profile.yaml`, write each user-facing section with its explicit value,
  including the default. A knob that only exists as an "absent means X" default in
  code is invisible and undiscoverable, which is not allowed. Examples that must
  always be present: `paqad.enabled` (default `true`), the `enterprise` block, and
  the `intelligence` (RAG) block.
- **Absent still resolves safely.** Readers must keep treating an absent value as
  its documented default, so an older or hand-trimmed profile never breaks. Always
  writing the value and always tolerating its absence are complementary, not
  alternatives.
- **Preserve on re-onboard and update.** `paqad-ai onboard` and `paqad-ai update`
  are a refresh, not a reset. Read the existing profile first and carry every
  user-set section forward unchanged. Only add newly introduced keys and remove
  retired ones. Never clobber a value the team set (`enterprise`, `intelligence`,
  `paqad.enabled`, `strictness`, `escalation`, `model_routing`, `mcp`, and the
  rest).
- **Detection-derived fields are the one exception.** Fields computed from
  repository reality on every run — `active_capabilities` and `stack_profile` — are
  refreshed from detection, not preserved. They are framework-owned outputs, not
  team-owned config.
- **Explicit overrides still win.** A programmatic caller passing
  `profileOverrides` (the desktop app, tests) takes precedence over the on-disk
  value, which in turn takes precedence over the built-in default.

## How this is enforced

`OnboardingOrchestrator` reads the existing profile and merges it
(`mergeProfileOverrides`) as the base for `buildProjectProfile`, so a re-onboard
preserves user config. `buildProjectProfile` emits `paqad.enabled` (and the
`enterprise` block) explicitly. Regression tests assert that a re-onboard keeps a
flipped `enterprise.enabled`, a flipped `rag_enabled`, and `paqad.enabled`, and
that a fresh onboard writes `paqad.enabled: true`.
