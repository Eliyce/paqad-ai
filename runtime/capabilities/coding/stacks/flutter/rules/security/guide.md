# Flutter Security

- Store tokens, credentials, and sensitive values with `flutter_secure_storage` (iOS Keychain / Android Keystore); never put them in `shared_preferences`, a plaintext local database, or app files.
- Do not embed API keys, secrets, or signing material in Dart source or `--dart-define`/bundled `.env` — anything in the app binary is extractable; keep true secrets server-side.
- Validate TLS properly: use `https` for all network calls and do not override `badCertificateCallback` to return `true`; for high-assurance apps pin certificates rather than disabling verification.
- Request only the platform permissions the feature needs and declare them in `AndroidManifest.xml` / `Info.plist` with usage strings; check and handle denial at runtime (e.g. via `permission_handler`) instead of assuming grant.
- Validate and sanitize any data rendered into a `WebView` or passed to `url_launcher`; do not enable arbitrary JavaScript or load untrusted URLs without checking the scheme/host.
- Keep secrets out of logs and crash reports; do not `debugPrint` tokens or full request/response bodies that may contain credentials.
- Avoid `dart:mirrors` and dynamic code loading; do not interpolate untrusted input into database queries — use parameterized queries (drift/sqflite bind variables).
