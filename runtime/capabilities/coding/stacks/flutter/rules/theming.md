# Flutter Theming

- Define colors once in a `ColorScheme` (build it with `ColorScheme.fromSeed`) attached to `ThemeData`, and read them via `Theme.of(context).colorScheme.*`; do not instantiate raw `Color(0xFF...)` literals inside widgets.
- Read typography from `Theme.of(context).textTheme.*` (e.g. `bodyMedium`, `titleLarge`) rather than constructing ad-hoc `TextStyle`s per widget; override the theme's `textTheme` centrally when the design demands it.
- Provide both `theme` and `darkTheme` (with matching light/dark `ColorScheme`s) on `MaterialApp` whenever the app supports dark mode, and let `ThemeMode` drive switching instead of branching on brightness in widgets.
- Centralize spacing, radii, and elevation as named constants or a `ThemeExtension` (`ThemeData.extensions`) and read them through `Theme.of(context).extension<T>()`; do not scatter magic `EdgeInsets`/`BorderRadius` numbers across widgets.
- Style component instances through component themes (`elevatedButtonTheme`, `cardTheme`, `appBarTheme`, etc.) on `ThemeData` rather than restyling each widget inline.
- Keep semantic intent in token names (e.g. `colorScheme.error`, a `surfaceVariant` role) rather than literal color names so light/dark and rebrands stay consistent.
