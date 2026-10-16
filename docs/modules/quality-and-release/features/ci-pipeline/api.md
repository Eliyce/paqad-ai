# CI and release workflows: API

This feature has no network or HTTP API. Its surface is the GitHub Actions workflows under
`.github/workflows/`, their triggers, and the repository variables and secrets that switch the
guarded steps on.

| Workflow | Trigger | Runs today |
|---|---|---|
| `ci.yml` | pull request, manual dispatch | Unit tests (CI-1, CI-2, CI-4, CI-5, CI-11, CI-20), CI-3 forbidden content, CI-6 secret scan, CI-10 budget, CI-19 host-verdict integrity, CI-8 deterministic build, and CI-7 branch coverage at 90 percent on Python 3.9 and 3.12. CI-9 validators run only when `ENABLE_PLUGIN_VALIDATORS` is `true` |
| `verify.yml` | nightly at 03:00 UTC, manual dispatch | CI-12 structural parity over the built dist and CI-13 scenario coverage. Live conversational parity stays manual |
| `release.yml` | manual dispatch | CI-14 version bump and rebuild; CI-15 tag, release zip and private push when `ENABLE_RELEASE` is set; CI-16 directory zip artifact and push of `dist/hosts/claude` to the public repo when `ENABLE_PUBLIC_RELEASE` is set |

## Switches

| Name | Kind | Turns on |
|---|---|---|
| `ENABLE_PLUGIN_VALIDATORS` | repository variable | CI-9: pinned `npx -y @anthropic-ai/claude-code@2.1.300 plugin validate --strict` on `dist/hosts/claude` and on `dist/hosts/claude/plugins/paqad-product-discovery`, plus `skills-ref validate dist` |
| `ENABLE_RELEASE`, `DISTRIBUTION_REPO`, `DISTRIBUTION_TOKEN` | variable, variable, secret | CI-15 tag, GitHub release zip and push of `dist/` to the private distribution repo |
| `ENABLE_PUBLIC_RELEASE`, `PUBLIC_DISTRIBUTION_REPO`, `PUBLIC_DISTRIBUTION_TOKEN` | variable, variable, secret | CI-16 directory zip artifact and push of `dist/hosts/claude` to the public repo (`Eliyce/paqad-product-discovery-plugin`) on `main`, tagged `vX.Y.Z` |

No workflow accepts inputs beyond its GitHub event trigger and these switches.
