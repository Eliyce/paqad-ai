# React Environment

- Resolve environment values through typed config wrappers, not ad hoc `process.env` or `import.meta.env` calls across the app.
- Keep public and server-only environment keys separated explicitly.
- Drive API endpoints, feature flags, and analytics settings from config modules, not literals.
- Fail fast when required configuration for the selected deploy target is missing.
- Update project tool references when environment loading behavior changes.
