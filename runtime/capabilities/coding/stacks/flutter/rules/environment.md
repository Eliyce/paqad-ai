# Flutter Environment

- Inject build-time configuration with `--dart-define` / `--dart-define-from-file` read via `String.fromEnvironment` / `int.fromEnvironment` / `bool.fromEnvironment`, or load a runtime `.env` with `flutter_dotenv`; do not hard-code endpoints, keys, or flags in widgets.
- Expose configuration through a single typed config class (e.g. `AppConfig` with `final` fields), not scattered `fromEnvironment` calls throughout the codebase.
- Validate required config at startup and fail fast (throw or assert in `main`) when a required value for the selected flavor is missing.
- Commit a `.env.example` with every key present but no real values; keep real `.env` files git-ignored and never commit secrets.
- Use Flutter flavors (Android product flavors / iOS schemes, selected with `flutter run --flavor`) to separate dev/staging/prod, and drive endpoint/flag differences from the flavor's config, not from `if (kDebugMode)` scattered in UI.
- Do not place client secrets that must stay confidential in `--dart-define` or bundled `.env`; these ship inside the app binary and are extractable.
