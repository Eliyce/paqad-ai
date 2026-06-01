# Flutter Data

- Use a maintained SQLite-backed library for relational local storage — `drift` for type-safe, reactive queries, or `sqflite` when raw SQL is acceptable. Avoid `isar` and `hive` for new code: Hive is slated for deprecation by its author and Isar has had long maintenance gaps against current Flutter.
- Run all database opens, queries, and migrations off the UI isolate path via the package's async API; never call blocking I/O inside a `build` method or synchronously in an event handler.
- Version the schema and write an explicit migration for every schema change (drift `MigrationStrategy.onUpgrade` / sqflite `onUpgrade`); never bump the table shape without a migration, and never drop user data silently.
- Wrap multi-statement writes in a transaction (`transaction()` / `batch()`) so partial failures roll back.
- Keep persistence types separate from domain models — map rows/DTOs to domain objects in a repository, and do not pass database row classes into widgets.
- Do not store secrets, tokens, or credentials in a plaintext local database or `shared_preferences`; use `flutter_secure_storage` (Keychain / Android Keystore) for those.
- For remote data, define explicit request/response models with `fromJson`/`toJson` (hand-written or `json_serializable`); do not index into raw `Map<String, dynamic>` in widgets or business logic.
