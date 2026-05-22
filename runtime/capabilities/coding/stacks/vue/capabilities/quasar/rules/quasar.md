# Quasar

- Use Quasar primitives intentionally and avoid wrapping them in thin abstractions without a clear reuse gain.
- Keep framework config, boot files, and platform-specific behavior documented and close to the owning feature.
- Treat responsive behavior, dialogs, drawers, and platform mode differences as part of the feature contract.
- Prefer composables and stores for shared behavior rather than embedding business logic inside Quasar page components.
- Re-verify browser and device-specific UI behavior when changing Quasar plugins, boot order, or layout primitives.
