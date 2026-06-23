---
'paqad-ai': minor
---

Add a global enable/disable toggle with graceful degradation (#220)

Teams can now turn paqad fully off for a fair A/B baseline, and an
absent or disabled install can no longer hard-fail an IDE.

- **One off-signal, read everywhere.** A committed `paqad.enabled: false`
  in `.paqad/project-profile.yaml`, or a per-run `PAQAD_DISABLED=1`
  override (which wins), turns paqad off. Absent means on, so existing
  projects are unchanged. The signal is read three dist-less ways that
  agree: a TS predicate, a shell primitive, and an `.mjs` primitive.
- **Off is a pure no-op.** Both entry gates, the decision-pause gate, the
  completion hooks, the verification backstop, and silent-update all
  early-exit when off. No block, no `[paqad]` stdout injection, and zero
  `.paqad/` writes, so a disabled turn leaves a clean tree.
- **No IDE dead-ends.** Every host entry file now carries a graceful
  fallback clause: if the framework pointer cannot be resolved or paqad is
  disabled, the agent proceeds as a normal assistant instead of blocking.
- **`paqad-ai enable` / `paqad-ai disable`** flip the durable flag with no
  re-onboarding, and `paqad-ai doctor` reports the disabled (vanilla mode)
  state as healthy.
