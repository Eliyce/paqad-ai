# CI/CD

- CI must run the same format, lint, test, and build gates that block local delivery.
- Keep the pipeline green; do not merge on red.
- Commit the lockfile and pin tool versions so CI and local environments resolve the same dependencies.
- Fail the build on high or critical dependency advisories.
