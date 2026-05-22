# Flutter Environment

- Resolve environment values through typed configuration wrappers, not directly inside widgets.
- Keep environment keys synchronized across `.env.example` and any flavor-specific files.
- Drive API endpoints, feature flags, and analytics settings from explicit config, not literals.
- Fail fast when required configuration is missing for the selected flavor.
- Use the patterns in `docs/tools/flutter/environment-loading.md` when environment setup changes.
