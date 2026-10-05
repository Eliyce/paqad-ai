# CI and release workflows: API

This feature has no network or HTTP API. Its surface is the GitHub Actions workflows under
`.github/workflows/` and their triggers.

| Workflow | Trigger | Runs today |
|---|---|---|
| `ci.yml` | pull request, manual dispatch | CI-7 unit tests (no coverage gate) and CI-8 deterministic build run for real; the remaining checks are labelled placeholders that print "not yet implemented" and enforce nothing |
| `verify.yml` | nightly at 03:00 UTC, manual dispatch | Placeholders only (CI-12, CI-13); the eval runner is not wired yet |
| `release.yml` | manual dispatch | Placeholders only (CI-14, CI-15); changeset versioning and distribution land in S3 |

No workflow exposes an API or accepts inputs beyond its GitHub event trigger. The honest state of
each check is tracked in the tech-debt doc.
