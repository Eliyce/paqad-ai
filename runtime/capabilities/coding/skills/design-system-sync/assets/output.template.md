## Proposals

### docs/instructions/design-system/tokens.md

```diff
@@ color.primary @@
 color.primary.500 = #1a73e8
+color.primary.dark = #0d47a1
```

Reason: `src/design-tokens/colors.ts:42` adds `primaryDark`.

### docs/instructions/design-system/components.md

```diff
@@ components @@
+## Foo
+- variants: []
+- states: default, hover, focus, disabled
+- composition: TBD (set during documentation_sync)
```

Reason: `src/components/Foo.tsx` is new.

## Open Questions

- {{omit when none}}
