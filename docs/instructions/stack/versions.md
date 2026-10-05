# Versions

| Component | Version | Source |
|---|---|---|
| Plugin `paqad-product-discovery` | 0.0.0 | `build/skills.yml` (`version`) |
| Python floor | 3.9 | PLG-5; CI runs `actions/setup-python@v5` with `3.9` |
| Python verified locally | 3.9.6 (`/usr/bin/python3`) | 2026-10-05 benchmark run |
| `actions/checkout` | v4 | `.github/workflows/ci.yml` |
| `actions/setup-python` | v5 | `.github/workflows/ci.yml` |
| Licence | MIT | `build/skills.yml` (`license`) |
| paqad framework (dev tooling only) | 1.95.0 | `.paqad/framework-version.txt` |

The plugin version stays fixed at `0.0.0` until changeset-driven versioning lands in S3
(CI-14). Every manifest in `dist/` takes its version from `build/skills.yml` and nowhere else
(PLG-11).

The paqad framework is used to develop this repository. It is not a runtime dependency of the
plugin (D-2).
