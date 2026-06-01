# Laravel Testing

- Write tests with the project's configured runner (Pest or PHPUnit) under `tests/Feature` and `tests/Unit`; run them with `php artisan test`. Match the existing style — do not mix Pest `test()`/`it()` syntax into PHPUnit `extends TestCase` files or vice versa.
- Use the `RefreshDatabase` trait (or `DatabaseTransactions`) on tests that hit the database so each test runs against a clean, migrated schema; do not depend on leftover rows from other tests.
- Create test data with model factories (`Post::factory()->count(3)->create()`), not hand-written `DB::insert` or hardcoded IDs. Add a factory for every new model.
- Test HTTP endpoints as feature tests with `$this->getJson()/postJson()` and assert on `assertStatus`/`assertOk`/`assertCreated`, `assertJson`/`assertJsonStructure`, and `assertJsonValidationErrors` for `422` paths.
- Test authorization explicitly: assert a forbidden user gets `403` and `assertDatabaseMissing` confirms no write happened; assert the permitted user succeeds. Use `actingAs($user)` to authenticate.
- Assert persistence with `assertDatabaseHas`/`assertDatabaseMissing`/`assertDatabaseCount` rather than re-querying with Eloquent and comparing by hand.
- Fake external side effects: `Queue::fake()` then `assertPushed`, `Mail::fake()`/`Notification::fake()` then `assertSent`, `Event::fake()`, `Storage::fake()`, `Http::fake()`. Do not hit real queues, mailers, or third-party APIs in tests.
- For queued jobs, test the job's `handle()` directly for logic and assert dispatch separately with `Queue::fake()`; assert idempotency for jobs that may retry.
- Add a regression test in the same PR as a bug fix that fails before the fix and passes after.
- Do not assert on translated/localized strings; assert on translation keys, status codes, or stable identifiers instead.
