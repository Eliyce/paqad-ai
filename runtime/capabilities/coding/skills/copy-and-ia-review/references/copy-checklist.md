# Copy & IA Checklist

For each user-facing string:

- **Case style** — sentence case vs title case must match `patterns.md`. Mixed case within a page is a finding.
- **Action verbs on buttons** — declared verb set (e.g. `Save | Cancel | Delete | Submit | Create | Update | Done`). Unusual labels (`OK`, `Yes`, `Got it`) need explicit allowance.
- **Error format** — declared template (e.g. "What happened. What to do."). Errors that only say "Error" are findings.
- **Terminology** — one term per concept. Mixing `User / Account / Member` across the same app is a finding.
- **Empty-state copy** — declared format (illustration + headline + action). Plain "No items" is a finding.

## IA checks

- **Route labels are unique** within a navigation group.
- **Breadcrumbs match route hierarchy.** A breadcrumb that says "Settings > Profile" must lead to a URL whose segments match.
- **Tab/segment labels don't lie.** A tab labeled "Active" that shows archived items is a finding.

## Exemptions

- Test data, fixture strings.
- Strings inside `console.log`, error stack traces, dev-only banners.
