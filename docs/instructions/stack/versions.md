# Versions

| Component | Version | Source |
|---|---|---|
| Plugin `paqad-product-discovery` | 3.2.0 | `build/skills.yml` (`version`) |
| Python floor | 3.9 | PLG-5; CI runs `actions/setup-python@v5` with `3.9` |
| Python verified locally | 3.9.6 (`/usr/bin/python3`) | 2026-10-05 benchmark run |
| `actions/checkout` | v4 | `.github/workflows/ci.yml` |
| `actions/setup-python` | v5 | `.github/workflows/ci.yml` |
| Licence | MIT | `build/skills.yml` (`license`); full text in `publish/claude/LICENSE` |
| Claude Code CLI for CI-9 validation | 2.1.300 (pinned, run through `npx -y @anthropic-ai/claude-code@2.1.300`) | `.github/workflows/ci.yml` |
| paqad framework (dev tooling only) | 1.95.0 | `.paqad/framework-version.txt` |

The plugin version is `3.2.0`, set by hand for the plugin directory submission (OD-22), until
changeset-driven versioning lands in S3 (CI-14). Every manifest in `dist/` takes its version from `build/skills.yml` and nowhere else
(PLG-11).

The paqad framework is used to develop this repository. It is not a runtime dependency of the
plugin (D-2).
