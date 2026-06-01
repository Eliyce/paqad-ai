# Flutter Localization

- Route every user-facing string through the localization layer (`AppLocalizations.of(context)` from `flutter_localizations` + `gen-l10n`, or `easy_localization`'s `.tr()`); do not hard-code display strings in widgets, state, or error messages.
- Add each new key to every supported locale's ARB/JSON file in the same change; a key missing from one locale is a defect, not a fallback.
- Use placeholder/ICU syntax for interpolation and plurals (ARB `{count}` with `plural`) instead of string concatenation, so word order and pluralization stay translatable.
- Centralize enum-to-label mapping in one place (e.g. an extension on the enum) so widgets resolve a label by key rather than duplicating `switch` statements.
- Wrap the app with the configured `localizationsDelegates` and `supportedLocales`, and use `Intl`/`DateFormat`, `NumberFormat` for dates, numbers, and currency rather than manual formatting.
- In tests, assert on keys, widget state, or `Semantics` rather than on translated literal text so tests survive copy changes.
