# Flutter Documentation

- Write `///` dartdoc comments on public classes, widgets, and methods; the first sentence is the summary line and should state what the API does, not how.
- Document every public widget's required constructor parameters and any non-obvious lifecycle expectation (e.g. "caller must `dispose` the passed controller").
- Reference other API elements with `[ClassName]` / `[method]` square-bracket links so `dart doc` resolves them; do not paste bare type names.
- Keep `README.md` setup steps (Flutter/Dart SDK version, `flutter pub get`, code-generation commands like `dart run build_runner build`) accurate and runnable.
- Do not document private (`_`-prefixed) members with dartdoc as if public; explain non-obvious private logic with inline `//` comments instead.
