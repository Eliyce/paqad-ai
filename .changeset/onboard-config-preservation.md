---
'paqad-ai': patch
---

Preserve user config on re-onboard, always show the enable switch, and stop the dashboard in vanilla mode (#220 follow-up)

- **Re-onboard no longer clobbers config.** `paqad-ai onboard` now reads the
  existing `project-profile.yaml` and carries every user-set section forward
  (`enterprise`, `intelligence`/RAG, `paqad.enabled`, and the rest), only
  refreshing detection-derived fields (`active_capabilities`, `stack_profile`)
  and adding newly introduced keys. Previously a re-onboard reset those sections
  to defaults.
- **The enable switch is always visible.** Onboarding now writes
  `paqad.enabled: true` into the profile so the global toggle is discoverable and
  editable, never a hidden default. Absent still resolves to ON for older
  profiles. Added `paqad` to the project-profile schema.
- **Vanilla mode includes the dashboard.** `paqad-ai dashboard` (and the `graph`
  alias) no longer start the server when paqad is disabled
  (`paqad.enabled: false` or `PAQAD_DISABLED=1`); they print a short notice and
  exit.
- Added a `config-visibility` rule so this contract (visible config, preserved on
  refresh) is durable.
