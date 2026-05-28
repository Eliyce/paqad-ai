# Token Leak Checklist

For each hit emitted by `scan-tokens.sh`, decide whether it is a token leak (a hard-coded value where a declared token exists). Every confirmed leak is a `token` finding.

## Color leaks

- `#1a73e8` in a component file → look in `tokens.md` for a `color.*` entry with this exact hex. If found → finding: "replace `#1a73e8` with `color.primary.500`". If not found → emit a `documentation-drift` finding ("color used in code but not declared") AND a `token` finding ("hard-coded hex; add to tokens.md or replace with existing token").
- `rgb(26, 115, 232)` → same logic; normalize to hex first.
- Tailwind arbitrary value `bg-[#1a73e8]` → finding; replace with `bg-primary-500` if the theme key exists.
- Named CSS colors (`red`, `cornflowerblue`) → almost always a leak; named colors are not in the contract.

## Spacing leaks

- `padding: 16px` → look in `tokens.md` for `spacing.4` (or whatever the 16px slot is). Tailwind's `p-4` is fine if the theme is declared.
- `margin: 1.25rem` → same.
- Inline `style={{ gap: 24 }}` → finding.

## Radius leaks

- `border-radius: 8px` → look for `radius.md` or `radius.lg`. Tailwind `rounded-lg` is fine.

## Shadow leaks

- `box-shadow: 0 2px 4px rgba(0,0,0,0.1)` → look for `shadow.sm` etc. Inline shadow values are nearly always a leak because the parameters are too easy to copy-paste-tweak.

## Typography leaks

- `font-family: 'Helvetica Neue', ...` outside the token file → finding. Tailwind `font-sans` mapped through `tailwind.config.*` is fine.
- `font-size: 14px` → look for `font.size.sm`.
- `font-weight: 600` → look for `font.weight.semibold`.
- `line-height: 1.5` → look for `font.line-height.normal`.

## Override leaks (handled by component-conformance-review, but listed here for cross-reference)

- `!important` — never a token problem per se, but often hides a token leak.
- Inline `style=` — every property in the inline object is a token candidate.

## Exemptions

`scan-tokens.sh` excludes by default:

- `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`
- `**/*.stories.*`, `**/storybook-static/**`
- `**/node_modules/**`, `**/dist/**`, `**/build/**`
- `**/*.snap`
- `src/design-tokens/**` (token source definitions)
- `tailwind.config.*` (the declaration file)

If a finding lands inside one of these paths, drop it silently. If a project legitimately needs additional exemptions, that is a `paqad.config` change (`design_test.token_exemptions`), not a scanner tweak.
