# Laravel Localization

- Wrap every user-facing string in `__('messages.key')` or the `@lang`/`trans()` helper; do not hardcode English copy in controllers, Form Request `messages()`, notifications, mailables, or Blade views.
- Store translations under `lang/{locale}/*.php` (or `lang/{locale}.json`) and reference them by stable dot-notation keys; do not key translations by the English sentence text.
- Localize validation messages via `lang/{locale}/validation.php` and the `attributes` array, not inline custom strings, so messages stay consistent across requests.
- Return translation keys or enum case names (not pre-translated labels) in API/JSON responses when the client renders the label; keep the key identical to the one the frontend i18n uses.
- For enums shown to users, add a method that maps each case to a translation key (`__("enums.status.{$this->value}")`) rather than returning a hardcoded display string.
- Pass dynamic values as named replacements (`__('orders.total', ['amount' => $amount])`) instead of concatenating strings, so word order can vary by locale.
- Use `trans_choice()` for pluralized copy rather than building singular/plural branches manually.
- In tests, assert on translation keys, enum values, or status codes — never on a translated string, which breaks when copy changes.
