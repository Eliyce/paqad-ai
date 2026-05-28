# Component Conformance Checklist

For each component in the AST-derived inventory, check the contract in `components.md`. For each override hit emitted by `scan-overrides.sh`, decide whether it points at a missing variant or a code smell.

## Per-component checks

- **Declared?** Component name appears in `components.md`. If not → `documentation-drift`.
- **Variants implemented?** Each declared variant (e.g. `primary | secondary | ghost`) maps to a prop value the component actually accepts. Missing → `component` finding, high severity.
- **States implemented?** `default / hover / focus / disabled / loading / error / empty` per the declared spec. Missing → `state` finding (cross-reference with `state-coverage-review`).
- **Primitive wrapping.** If the component wraps a primitive (e.g. shadcn `Button`, Radix `Dialog`), it must apply the contract — not just re-export. Pure re-exports of an unwrapped primitive that doesn't satisfy the contract are findings.
- **Composition rules.** If `components.md` declares "Icon must be inside Button", a usage that violates that is a `component` finding.

## Override hits

- **`!important`** — almost always a finding. Either the underlying component is missing a prop (add it) or specificity is being abused. `medium` severity unless `patterns.md` declares an `override_budget` that this exceeds, then `blocker`.
- **Inline `style={{ ... }}`** — every property is a token-conformance candidate AND a component-conformance signal. If the property is for a value the component already accepts as a prop, that's a `component` finding (use the prop). Otherwise hand off to `token-conformance-review`.
- **Tailwind arbitrary values `[#...]`, `[12px]`** — bypass the theme; finding.
- **Tailwind combo not in `patterns.md`** — undocumented utility combination that creates a de-facto variant. Either declare the variant in `components.md` or refactor to use the existing variant.
- **`className` overrides on declared components** — `<Button className="bg-purple-500">` is a finding when `Button` has a declared `variant` prop instead.

## Exemptions

- `**/*.test.*`, `**/*.stories.*`, `**/__tests__/**`
- Layout primitives that legitimately receive arbitrary styles (rare; document each one in `patterns.md`).
