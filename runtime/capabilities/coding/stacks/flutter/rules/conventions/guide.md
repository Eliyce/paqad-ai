# Flutter Conventions

- Add a `const` constructor to every widget whose fields are all `final`, and instantiate widgets with `const` wherever the arguments are compile-time constants — this lets Flutter skip rebuilding those subtrees.
- Use `UpperCamelCase` for types/widgets, `lowerCamelCase` for members and locals, and `lowercase_with_underscores` for file names and directories (Dart effective-style).
- Mark fields `final` unless they are reassigned; prefer `const` for compile-time constants.
- Type all public API surfaces explicitly (return types, parameters, fields); do not rely on inferred `dynamic`.
- Run `dart format` and resolve all `flutter analyze` / `dart analyze` warnings before committing; do not leave `// ignore:` comments without a reason in the same line.
- Prefer `??`, `?.`, and `late` over manual null checks; do not use `!` (bang) on a nullable unless the non-null invariant is guaranteed at that point.
- Annotate overrides with `@override` and async work that returns no value as `Future<void>`, not `void` (so callers can await and errors surface).
- Avoid `print` for diagnostics; use `debugPrint` or a logger so output is throttled and strippable in release builds.
