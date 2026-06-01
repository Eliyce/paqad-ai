# Flutter Performance

- Use `const` constructors aggressively — a `const` widget is canonicalized and skipped during rebuild — and keep `setState` / notifier updates scoped to the smallest widget so rebuilds do not cascade up the tree.
- Render long or unbounded lists with `ListView.builder` / `GridView.builder` / `SliverList` (lazy item construction); never build a full `ListView(children: [...])` from a large or network-sized collection.
- Narrow rebuilds with `ValueListenableBuilder`, `Selector` (provider), `context.select`, or `BlocSelector` so a state change only rebuilds the widgets that read the changed field.
- Hoist work out of `build`: do not sort, filter, map, or allocate controllers there; precompute in the state layer and pass results down.
- Wrap expensive, independently-repainting subtrees (animations, custom paint) in `RepaintBoundary` to isolate their paint.
- Load images at the displayed resolution with `cacheWidth`/`cacheHeight` or `ResizeImage`, and prefer `Image.asset`/`Image.network` caching over decoding full-size bitmaps.
- Profile in profile mode (`flutter run --profile`) with the DevTools timeline / "Performance" view before optimizing; confirm jank is real rather than guessing.
