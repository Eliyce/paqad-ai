# Flutter Foundation

- Prefer existing Flutter framework widgets and well-maintained pub.dev packages over hand-rolled scaffolding; check `pubspec.yaml` for an already-present dependency before adding a new one.
- Keep `build` methods pure and cheap: no `Future`/Timer creation, no `setState` calls, no allocation of controllers — create those in `initState` and tear them down in `dispose`.
- Dispose every `AnimationController`, `TextEditingController`, `ScrollController`, `StreamSubscription`, and `FocusNode` you create in the owning `State.dispose`.
- Choose `StatelessWidget` unless the widget genuinely holds mutable local state; lift shared state into a controller/notifier or the project's state-management solution rather than threading it through `setState`.
- Use `const` constructors for leaf widgets to let the framework short-circuit rebuilds.
- Handle the three states of async UI explicitly with `FutureBuilder`/`StreamBuilder` (loading, data, error) or an equivalent in the state layer; do not leave the error case unrendered.
- Guard any `BuildContext` use after an `await` with a `if (!context.mounted) return;` check.
