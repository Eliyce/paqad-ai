# Flutter UI Platform Behavior

- Centralize platform branching behind `Theme.of(context).platform`, `defaultTargetPlatform`, or `Platform.isIOS`/`isAndroid` in a single adaptive helper/widget; do not sprinkle platform `if`s through feature code.
- Prefer built-in adaptive widgets (`Switch.adaptive`, `CircularProgressIndicator.adaptive`, `showAdaptiveDialog`) and `SafeArea` over hand-rolled per-platform layouts.
- Make layouts responsive with `LayoutBuilder` / `MediaQuery.sizeOf(context)` and `Flexible`/`Expanded`/`Wrap`; do not assume a fixed screen size or hard-code pixel widths for full-width content.
- Navigate through the typed router (`go_router` named routes / `context.go`/`context.push`) using route constants, not hard-coded path strings scattered in widgets.
- Guard platform-only APIs: use `kIsWeb` before touching `dart:io`, and feature-detect rather than assuming a capability exists on the current target.
- Treat permissions, secure storage access, and deep-link/`AppLinks` handling as explicit, reviewed code paths — handle the denied/unavailable case rather than assuming success.
