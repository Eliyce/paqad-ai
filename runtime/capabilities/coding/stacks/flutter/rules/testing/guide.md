# Flutter Testing

- Write widget tests with `flutter_test`'s `testWidgets`, driving the tree via `WidgetTester` (`pumpWidget`, `pump`, `pumpAndSettle`) and asserting with `find.byType`/`find.byKey`/`find.text` plus `expect(..., findsOneWidget)`.
- Prefer `find.byKey(ValueKey(...))` and `Semantics`-based finders over `find.text` so tests survive copy and localization changes.
- Use golden (image-snapshot) tests for visual regressions via `matchesGoldenFile`, regenerating intentionally with `flutter test --update-goldens`; for larger suites use the `alchemist` package (the maintained successor to the discontinued `golden_toolkit`) and run its CI variant so text renders as deterministic blocks.
- Test business logic and notifiers/blocs in plain Dart unit tests without a widget tree; mock collaborators with `mocktail` or `mockito` and inject them rather than reaching for globals.
- Cover the loading, data, and error branches of async UI explicitly — pump the loading frame, then settle and assert the resolved state.
- Reserve `integration_test` (driving a real build) for end-to-end flows; keep fast widget/unit tests as the default layer.
- Make tests deterministic: pump a fixed clock / fake async, avoid real network and real `DateTime.now()`, and key list items so finders are stable.
